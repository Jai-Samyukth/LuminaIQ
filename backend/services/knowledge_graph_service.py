"""
Knowledge Graph Service - Topic Relationship Mapping

Features:
1. Auto-generate topic relationships from documents using LLM
2. Store graph in adjacency list format
3. Find related topics using BFS/DFS
4. Generate learning paths using Topological Sort
5. Suggest prerequisites for any topic
6. Track document source for each topic

DSA Used:
- Adjacency List for graph storage
- BFS for finding related topics at distance K
- DFS for detecting cycles
- Topological Sort (Kahn's Algorithm) for learning path generation
- Priority Queue for weighted path finding
"""

import heapq
from collections import defaultdict, deque
from typing import List, Dict, Any, Optional, Set, Tuple
from db.client import get_supabase_client, async_db
from services.llm_service import llm_service
from utils.logger import logger
from uuid import uuid4
import json
import asyncio
from weakref import WeakValueDictionary


class KnowledgeGraph:
    """
    Knowledge Graph implementation using Adjacency List.

    Graph Structure:
    - Nodes: Topics (strings)
    - Edges: Relationships (prerequisite, related, subtopic)
    - Weights: Relationship strength (0.0-1.0)

    Storage: Supabase `topic_relations` table

    DSA:
    - Adjacency List: O(1) add edge, O(V+E) traversal
    - BFS: Find topics within K hops
    - Topological Sort: Generate learning order
    """

    # Batch size for processing topics (to avoid token limits)
    BATCH_SIZE = 25
    MAX_TOKENS = 4000  # Higher limit for JSON output

    # Per-project build locks — prevents concurrent /build calls racing each other
    _build_locks: WeakValueDictionary = WeakValueDictionary()
    _locks_meta_lock = asyncio.Lock()

    def __init__(self):
        self.client = get_supabase_client()

    async def _get_project_lock(self, project_id: str) -> asyncio.Lock:
        """Return (creating if needed) a per-project asyncio.Lock."""
        async with self._locks_meta_lock:
            lock = self._build_locks.get(project_id)
            if lock is None:
                lock = asyncio.Lock()
                self._build_locks[project_id] = lock
            return lock

    # ============== Graph Building ==============

    async def build_graph_from_topics(
        self, project_id: str, topics: List[str], force_rebuild: bool = False
    ) -> Dict[str, Any]:
        """
        Build knowledge graph from document topics using LLM.

        Thread-safe: uses a per-project asyncio.Lock so concurrent requests
        for the same project queue up instead of racing and producing duplicates.
        """
        # ── Acquire per-project lock ──────────────────────────────────────────
        project_lock = await self._get_project_lock(project_id)
        if project_lock.locked():
            logger.info(
                f"[KnowledgeGraph] Build already in progress for {project_id}, skipping."
            )
            return {"edges_created": 0, "message": "Build already in progress"}

        async with project_lock:
            return await self._build_graph_locked(project_id, topics, force_rebuild)

    async def _build_graph_locked(
        self, project_id: str, topics: List[str], force_rebuild: bool
    ) -> Dict[str, Any]:
        """Inner build — runs while the per-project lock is held."""
        try:
            if not topics or len(topics) < 2:
                return {"edges_created": 0, "message": "Need at least 2 topics"}

            if not force_rebuild:
                # Re-check inside lock — another request may have built it already
                existing = await async_db(lambda:
                    self.client.table("topic_relations")
                    .select("id")
                    .eq("project_id", project_id)
                    .limit(1)
                    .execute()
                )
                if existing.data:
                    return {
                        "edges_created": 0,
                        "message": "Graph already exists. Use force_rebuild=True to rebuild.",
                    }
            else:
                # Wipe before LLM calls so we don't accumulate stale edges
                await async_db(lambda:
                    self.client.table("topic_relations")
                    .delete()
                    .eq("project_id", project_id)
                    .execute()
                )

            unique_topics = list(set(topics))
            logger.info(f"Building knowledge graph for {len(unique_topics)} topics")

            all_edges: List[Dict] = []

            if len(unique_topics) <= self.BATCH_SIZE:
                all_edges.extend(
                    await self._generate_relationships_for_batch(
                        project_id, unique_topics, unique_topics
                    )
                )
            else:
                batches = self._create_overlapping_batches(unique_topics)
                logger.info(f"Processing {len(batches)} batches")
                for i, batch in enumerate(batches):
                    logger.info(
                        f"Processing batch {i + 1}/{len(batches)} ({len(batch)} topics)"
                    )
                    all_edges.extend(
                        await self._generate_relationships_for_batch(
                            project_id, batch, unique_topics
                        )
                    )
                    if i < len(batches) - 1:
                        await asyncio.sleep(0.5)

            # Deduplicate in-memory (cross-batch overlaps can produce the same edge)
            seen: set = set()
            unique_edges: List[Dict] = []
            for edge in all_edges:
                key = (edge["from_topic"], edge["to_topic"])
                if key not in seen:
                    seen.add(key)
                    unique_edges.append(edge)

            if unique_edges:
                # Use upsert so any remaining duplicates (e.g. from retries) are
                # silently ignored instead of raising a 23505 constraint error.
                for i in range(0, len(unique_edges), 100):
                    chunk = unique_edges[i: i + 100]
                    await async_db(lambda c=chunk: (
                        self.client.table("topic_relations")
                        .upsert(c, on_conflict="project_id,from_topic,to_topic")
                        .execute()
                    ))

                logger.info(
                    f"Upserted {len(unique_edges)} topic relationships for {project_id}"
                )

            return {
                "edges_created": len(unique_edges),
                "message": f"Successfully created {len(unique_edges)} relationships",
            }

        except Exception as e:
            logger.error(f"Error building knowledge graph: {e}")
            import traceback
            logger.error(traceback.format_exc())
            return {"edges_created": 0, "message": f"Error: {str(e)}"}

    def _create_overlapping_batches(self, topics: List[str]) -> List[List[str]]:
        """Create batches with some overlap for cross-batch relationships"""
        batches = []
        overlap = 5  # Topics shared between batches

        for i in range(0, len(topics), self.BATCH_SIZE - overlap):
            batch = topics[i : i + self.BATCH_SIZE]
            if len(batch) >= 3:  # Need at least 3 topics for meaningful relationships
                batches.append(batch)

        return batches

    async def _generate_relationships_for_batch(
        self, project_id: str, batch_topics: List[str], all_topics: List[str]
    ) -> List[Dict[str, Any]]:
        """Generate relationships for a batch of topics"""

        topics_str = "\n".join(f"{i + 1}. {t}" for i, t in enumerate(batch_topics))

        target_relationships = max(15, len(batch_topics) * 2)

        prompt = f"""You are an expert curriculum designer. Create a learning dependency graph for these topics.

TOPICS:
{topics_str}

TASK: Identify which topics must be learned before others.

RELATIONSHIP TYPES:
- "prerequisite": Topic A MUST be learned before Topic B
- "related": Topics are connected but order doesn't matter

RULES:
1. Use EXACT topic names from the numbered list (copy exactly)
2. Every topic should connect to at least one other topic
3. Foundational/intro topics have no prerequisites
4. Create {target_relationships} relationships total
5. Weight: 0.9 = essential prerequisite, 0.5 = helpful, 0.3 = loosely related

OUTPUT FORMAT - Return ONLY valid JSON, no markdown:
[
  {{"from_topic": "Topic 1 Name", "to_topic": "Topic 2 Name", "relation_type": "prerequisite", "weight": 0.9}}
]"""

        messages = [{"role": "user", "content": prompt}]

        try:
            response = await llm_service.chat_completion(
                messages, temperature=0.2, max_tokens=self.MAX_TOKENS
            )
        except Exception as llm_err:
            logger.error(f"LLM call failed for knowledge graph batch: {llm_err}")
            return []

        # Parse with repair logic for truncated JSON
        relations = self._parse_json_with_repair(response)

        if not relations:
            return []

        # Normalize topic names for matching
        topics_lower = {t.lower().strip(): t for t in all_topics}

        # Build edges
        edges = []
        for rel in relations:
            if not isinstance(rel, dict):
                continue

            from_topic_raw = rel.get("from_topic", "").strip()
            to_topic_raw = rel.get("to_topic", "").strip()

            from_topic = topics_lower.get(from_topic_raw.lower(), from_topic_raw)
            to_topic = topics_lower.get(to_topic_raw.lower(), to_topic_raw)

            from_exists = from_topic_raw.lower() in topics_lower
            to_exists = to_topic_raw.lower() in topics_lower

            if from_exists and to_exists and from_topic != to_topic:
                relation_type = rel.get("relation_type", "related")
                if relation_type not in [
                    "prerequisite",
                    "related",
                    "subtopic",
                    "builds_on",
                ]:
                    relation_type = "related"
                if relation_type in ["builds_on", "subtopic"]:
                    relation_type = "prerequisite"

                edges.append(
                    {
                        "id": str(uuid4()),
                        "project_id": project_id,
                        "from_topic": from_topic,
                        "to_topic": to_topic,
                        "relation_type": relation_type,
                        "weight": min(1.0, max(0.1, float(rel.get("weight", 0.5)))),
                    }
                )

        logger.info(f"Generated {len(edges)} edges from batch")
        return edges

    def _parse_json_with_repair(self, response: str) -> List[Dict]:
        """Parse JSON with repair logic for truncated responses"""
        if not response:
            return []

        clean_response = response.strip()

        # Remove markdown code blocks
        if clean_response.startswith("```"):
            lines = clean_response.split("\n")
            if lines[0].startswith("```"):
                lines = lines[1:]
            if lines and lines[-1].strip() == "```":
                lines = lines[:-1]
            clean_response = "\n".join(lines)

        # Find JSON array
        start = clean_response.find("[")
        if start == -1:
            logger.warning("No JSON array start '[' found")
            return []

        end = clean_response.rfind("]")

        if end > start:
            # Complete JSON array found
            json_str = clean_response[start : end + 1]
            try:
                return json.loads(json_str)
            except json.JSONDecodeError as e:
                logger.warning(f"JSON parse error: {e}")

        # Truncated response - try to repair
        logger.warning("JSON appears truncated, attempting repair...")
        json_str = clean_response[start:]

        # Try to find the last complete object
        repaired = self._repair_truncated_json_array(json_str)
        if repaired:
            try:
                result = json.loads(repaired)
                logger.info(
                    f"Successfully repaired JSON, got {len(result)} relationships"
                )
                return result
            except json.JSONDecodeError:
                pass

        # Last resort: extract individual objects
        objects = self._extract_json_objects(json_str)
        if objects:
            logger.info(f"Extracted {len(objects)} objects from truncated JSON")
            return objects

        logger.error("Failed to parse or repair JSON response")
        return []

    def _repair_truncated_json_array(self, json_str: str) -> Optional[str]:
        """Attempt to repair a truncated JSON array"""
        # Find the last complete object (ends with })
        last_complete = json_str.rfind("}")
        if last_complete == -1:
            return None

        # Truncate after the last complete object
        truncated = json_str[: last_complete + 1]

        # Remove any trailing comma
        truncated = truncated.rstrip().rstrip(",")

        # Close the array
        if not truncated.endswith("]"):
            truncated += "]"

        return truncated

    def _extract_json_objects(self, json_str: str) -> List[Dict]:
        """Extract individual JSON objects from a potentially malformed array"""
        objects = []
        depth = 0
        current_obj = ""
        in_string = False
        escape_next = False

        for char in json_str:
            if escape_next:
                current_obj += char
                escape_next = False
                continue

            if char == "\\":
                escape_next = True
                current_obj += char
                continue

            if char == '"' and not escape_next:
                in_string = not in_string

            if not in_string:
                if char == "{":
                    depth += 1
                elif char == "}":
                    depth -= 1

            if depth > 0 or char == "{":
                current_obj += char

            if depth == 0 and current_obj.strip():
                try:
                    obj = json.loads(current_obj)
                    if (
                        isinstance(obj, dict)
                        and "from_topic" in obj
                        and "to_topic" in obj
                    ):
                        objects.append(obj)
                except:
                    pass
                current_obj = ""

        return objects

    async def add_relationship(
        self,
        project_id: str,
        from_topic: str,
        to_topic: str,
        relation_type: str = "related",
        weight: float = 0.5,
    ) -> Dict[str, Any]:
        """Manually add a relationship between topics."""
        try:
            edge = {
                "id": str(uuid4()),
                "project_id": project_id,
                "from_topic": from_topic,
                "to_topic": to_topic,
                "relation_type": relation_type,
                "weight": min(1.0, max(0.1, weight)),
            }

            result = await async_db(lambda: self.client.table("topic_relations").insert(edge).execute())
            return result.data[0] if result.data else {}

        except Exception as e:
            logger.error(f"Error adding relationship: {e}")
            raise

    # ============== Graph Queries ==============

    async def get_adjacency_list(
        self, project_id: str
    ) -> Dict[str, List[Dict[str, Any]]]:
        """Get graph as adjacency list."""
        try:
            result = await async_db(lambda: 
                self.client.table("topic_relations")
                .select("*")
                .eq("project_id", project_id)
                .execute()
            )

            edges = result.data or []
            adj_list = defaultdict(list)

            for edge in edges:
                adj_list[edge["from_topic"]].append(
                    {
                        "to": edge["to_topic"],
                        "type": edge["relation_type"],
                        "weight": edge["weight"],
                    }
                )

                if edge["relation_type"] == "related":
                    adj_list[edge["to_topic"]].append(
                        {
                            "to": edge["from_topic"],
                            "type": "related",
                            "weight": edge["weight"],
                        }
                    )

            return dict(adj_list)

        except Exception as e:
            logger.error(f"Error getting adjacency list: {e}")
            return {}

    async def find_related_topics(
        self, project_id: str, topic: str, max_distance: int = 2
    ) -> List[Dict[str, Any]]:
        """Find topics related to a given topic using BFS."""
        try:
            adj_list = await self.get_adjacency_list(project_id)

            if topic not in adj_list and not any(
                topic in [e["to"] for e in edges] for edges in adj_list.values()
            ):
                return []

            visited = {topic}
            queue = deque([(topic, 0)])
            related = []

            while queue:
                current, distance = queue.popleft()

                if distance > 0:
                    related.append({"topic": current, "distance": distance})

                if distance < max_distance:
                    for neighbor in adj_list.get(current, []):
                        if neighbor["to"] not in visited:
                            visited.add(neighbor["to"])
                            queue.append((neighbor["to"], distance + 1))

            related.sort(key=lambda x: x["distance"])
            return related

        except Exception as e:
            logger.error(f"Error finding related topics: {e}")
            return []

    async def get_prerequisites(self, project_id: str, topic: str) -> List[str]:
        """Get all prerequisite topics for a given topic."""
        try:
            result = await async_db(lambda: 
                self.client.table("topic_relations")
                .select("from_topic")
                .eq("project_id", project_id)
                .eq("to_topic", topic)
                .eq("relation_type", "prerequisite")
                .execute()
            )

            return [edge["from_topic"] for edge in (result.data or [])]

        except Exception as e:
            logger.error(f"Error getting prerequisites: {e}")
            return []

    async def get_dependents(self, project_id: str, topic: str) -> List[str]:
        """Get topics that depend on the given topic."""
        try:
            result = await async_db(lambda: 
                self.client.table("topic_relations")
                .select("to_topic")
                .eq("project_id", project_id)
                .eq("from_topic", topic)
                .eq("relation_type", "prerequisite")
                .execute()
            )

            return [edge["to_topic"] for edge in (result.data or [])]

        except Exception as e:
            logger.error(f"Error getting dependents: {e}")
            return []

    # ============== Learning Path Generation ==============

    async def generate_learning_path(
        self, project_id: str, target_topics: Optional[List[str]] = None
    ) -> List[Dict[str, Any]]:
        """
        Generate optimal learning path using Topological Sort.
        Includes document source for each topic.
        """
        try:
            # Get topic-to-document mapping
            topic_doc_map = await self._get_topic_document_mapping(project_id)

            # Get all edges
            result = await async_db(lambda: 
                self.client.table("topic_relations")
                .select("*")
                .eq("project_id", project_id)
                .eq("relation_type", "prerequisite")
                .execute()
            )

            edges = result.data or []

            if not edges:
                # No prerequisites - return topics with doc info
                if target_topics:
                    return [
                        {
                            "topic": t,
                            "order": i + 1,
                            "prerequisites": [],
                            "document": topic_doc_map.get(t, "Unknown"),
                        }
                        for i, t in enumerate(target_topics)
                    ]

                # Get all topics from documents
                all_topics = list(topic_doc_map.keys())
                if all_topics:
                    return [
                        {
                            "topic": t,
                            "order": i + 1,
                            "prerequisites": [],
                            "document": topic_doc_map.get(t, "Unknown"),
                        }
                        for i, t in enumerate(sorted(all_topics))
                    ]

                return []

            # Build graph and in-degree count
            graph = defaultdict(list)
            in_degree = defaultdict(int)
            all_topics = set()

            for edge in edges:
                from_topic = edge["from_topic"]
                to_topic = edge["to_topic"]

                graph[from_topic].append(to_topic)
                in_degree[to_topic] += 1
                all_topics.add(from_topic)
                all_topics.add(to_topic)

                if from_topic not in in_degree:
                    in_degree[from_topic] = 0

            # Filter if target_topics provided
            if target_topics:
                needed = set(target_topics)
                to_check = list(target_topics)

                while to_check:
                    topic = to_check.pop()
                    for edge in edges:
                        if (
                            edge["to_topic"] == topic
                            and edge["from_topic"] not in needed
                        ):
                            needed.add(edge["from_topic"])
                            to_check.append(edge["from_topic"])

                all_topics = needed

            # Kahn's Algorithm
            queue = deque()
            for topic in all_topics:
                if in_degree.get(topic, 0) == 0:
                    queue.append(topic)

            learning_path = []
            order = 1

            while queue:
                topic = queue.popleft()

                if topic in all_topics:
                    prereqs = [
                        e["from_topic"]
                        for e in edges
                        if e["to_topic"] == topic and e["from_topic"] in all_topics
                    ]

                    learning_path.append(
                        {
                            "topic": topic,
                            "order": order,
                            "prerequisites": prereqs,
                            "document": topic_doc_map.get(topic, "Unknown"),
                        }
                    )
                    order += 1

                for dependent in graph.get(topic, []):
                    in_degree[dependent] -= 1
                    if in_degree[dependent] == 0:
                        queue.append(dependent)

            # Handle cycles
            processed_topics = {item["topic"] for item in learning_path}
            remaining_topics = all_topics - processed_topics

            if remaining_topics:
                logger.warning(
                    f"Cycle detected - adding {len(remaining_topics)} remaining topics"
                )
                for topic in sorted(remaining_topics):
                    prereqs = [
                        e["from_topic"]
                        for e in edges
                        if e["to_topic"] == topic and e["from_topic"] in all_topics
                    ]
                    learning_path.append(
                        {
                            "topic": topic,
                            "order": order,
                            "prerequisites": prereqs,
                            "document": topic_doc_map.get(topic, "Unknown"),
                        }
                    )
                    order += 1

            return learning_path

        except Exception as e:
            logger.error(f"Error generating learning path: {e}")
            import traceback

            logger.error(traceback.format_exc())
            return []

    async def _get_topic_document_mapping(self, project_id: str) -> Dict[str, str]:
        """Get mapping of topic -> document name"""
        try:
            result = await async_db(lambda: 
                self.client.table("documents")
                .select("id, filename, topics")
                .eq("project_id", project_id)
                .eq("upload_status", "completed")
                .execute()
            )

            topic_doc_map = {}
            for doc in result.data or []:
                doc_name = doc.get("filename", "Unknown")
                topics = doc.get("topics") or []
                for topic in topics:
                    if topic not in topic_doc_map:
                        topic_doc_map[topic] = doc_name

            return topic_doc_map

        except Exception as e:
            logger.error(f"Error getting topic-document mapping: {e}")
            return {}

    async def detect_cycle(self, project_id: str) -> bool:
        """Detect if there's a cycle in the prerequisite graph."""
        try:
            result = await async_db(lambda: 
                self.client.table("topic_relations")
                .select("*")
                .eq("project_id", project_id)
                .eq("relation_type", "prerequisite")
                .execute()
            )

            edges = result.data or []

            if not edges:
                return False

            graph = defaultdict(list)
            all_topics = set()

            for edge in edges:
                graph[edge["from_topic"]].append(edge["to_topic"])
                all_topics.add(edge["from_topic"])
                all_topics.add(edge["to_topic"])

            color = {topic: 0 for topic in all_topics}

            def dfs(node: str) -> bool:
                color[node] = 1

                for neighbor in graph.get(node, []):
                    if color.get(neighbor, 0) == 1:
                        return True
                    if color.get(neighbor, 0) == 0 and dfs(neighbor):
                        return True

                color[node] = 2
                return False

            for topic in all_topics:
                if color[topic] == 0:
                    if dfs(topic):
                        return True

            return False

        except Exception as e:
            logger.error(f"Error detecting cycle: {e}")
            return False

    # ============== Graph Statistics ==============

    async def get_graph_stats(self, project_id: str) -> Dict[str, Any]:
        """Get statistics about the knowledge graph."""
        try:
            result = await async_db(lambda: 
                self.client.table("topic_relations")
                .select("*")
                .eq("project_id", project_id)
                .execute()
            )

            edges = result.data or []

            if not edges:
                return {
                    "total_nodes": 0,
                    "total_edges": 0,
                    "prerequisites": 0,
                    "related": 0,
                    "subtopics": 0,
                    "has_cycle": False,
                }

            nodes = set()
            edge_counts = {"prerequisite": 0, "related": 0, "subtopic": 0}

            for edge in edges:
                nodes.add(edge["from_topic"])
                nodes.add(edge["to_topic"])
                edge_type = edge.get("relation_type", "related")
                edge_counts[edge_type] = edge_counts.get(edge_type, 0) + 1

            has_cycle = await self.detect_cycle(project_id)

            return {
                "total_nodes": len(nodes),
                "total_edges": len(edges),
                "prerequisites": edge_counts.get("prerequisite", 0),
                "related": edge_counts.get("related", 0),
                "subtopics": edge_counts.get("subtopic", 0),
                "has_cycle": has_cycle,
            }

        except Exception as e:
            logger.error(f"Error getting graph stats: {e}")
            return {}

    async def get_full_graph(self, project_id: str) -> Dict[str, Any]:
        """Get full graph data for visualization.
        
        Always includes ALL topics from documents, even if no relations exist yet.
        """
        try:
            result = await async_db(lambda: 
                self.client.table("topic_relations")
                .select("*")
                .eq("project_id", project_id)
                .execute()
            )

            edges = result.data or []
            topic_doc_map = await self._get_topic_document_mapping(project_id)

            nodes = set()
            vis_edges = []

            for edge in edges:
                nodes.add(edge["from_topic"])
                nodes.add(edge["to_topic"])
                vis_edges.append(
                    {
                        "source": edge["from_topic"],
                        "target": edge["to_topic"],
                        "type": edge["relation_type"],
                        "weight": edge["weight"],
                    }
                )

            # Always include ALL topics from documents even without relations
            for topic in topic_doc_map:
                nodes.add(topic)

            return {
                "nodes": [
                    {"id": n, "label": n, "document": topic_doc_map.get(n, "Unknown")}
                    for n in nodes
                ],
                "edges": vis_edges,
            }

        except Exception as e:
            logger.error(f"Error getting full graph: {e}")
            return {"nodes": [], "edges": []}


# Singleton instance
knowledge_graph = KnowledgeGraph()
