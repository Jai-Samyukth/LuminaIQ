import os
import asyncio
from typing import Optional, List, Dict, Any
from concurrent.futures import ThreadPoolExecutor
from db.client import get_supabase_client, async_db
from config.settings import settings
from utils.file_parser import FileParser
from utils.text_chunker import TextChunker
from services.embedding_service import embedding_service
from services.qdrant_service import qdrant_service
from utils.logger import logger
from utils.embedding_queue import get_embedding_queue, EmbeddingJob, EmbeddingQueue
from utils.progress_manager import get_progress_manager


class DocumentService:
    """
    Unified document processing service.

    Handles the complete pipeline:
        extract → save txt to Supabase → chunk → embed → topics → knowledge graph

    Storage strategy:
        - Raw uploaded files are NOT stored permanently (temp file is deleted after extraction)
        - Only the extracted .txt is stored in the Supabase 'texts/' bucket
        - This is 10-50x smaller than the original PDF

    Features:
    - Parallel batch embedding with global concurrency control (configurable via settings.py)
    - Real-time SSE progress for frontend
    - Automatic temp file cleanup
    - Creates book record if document is marked public
    - Retry with exponential backoff for transient failures
    """

    def __init__(self):
        self.client = get_supabase_client()
        self.file_parser = FileParser()
        self.text_chunker = TextChunker(
            chunk_size=settings.CHUNK_SIZE, overlap=settings.CHUNK_OVERLAP
        )
        self.batch_size = getattr(settings, "EMBEDDING_BATCH_SIZE", 100)
        # Dedicated thread pool for CPU-heavy file extraction
        # Prevents PDF parsing from competing with embedding API calls for threads
        self._extraction_executor = ThreadPoolExecutor(
            max_workers=8, thread_name_prefix="file_extract"
        )

    async def process_document(
        self,
        document_id: str,
        project_id: str,
        file_path: str,
        filename: str,
        user_id: str = "",
        book_meta: Optional[Dict[str, Any]] = None,
    ):
        """
        Process uploaded document: extract text → save txt → chunk → embed → topics → graph.
        Optionally creates a book record if book_meta is provided.

        Emits SSE progress events at each stage for real-time frontend updates.
        """
        progress = get_progress_manager()

        try:
            # Gate with doc_semaphore: max MAX_CONCURRENT_DOCUMENT_UPLOADS docs process concurrently.
            doc_semaphore = EmbeddingQueue.get_doc_semaphore()

            # Notify frontend if doc is queued (semaphore full)
            if doc_semaphore.locked():
                await progress.emit(
                    document_id, "queued", 0,
                    "Waiting for other documents to finish..."
                )
                await self._update_document_status(
                    document_id, "queued", "Waiting for processing slot..."
                )
                logger.info(f"[{filename}] Queued — waiting for doc_semaphore slot")

            async with doc_semaphore:
                await self._run_pipeline(
                    document_id, project_id, file_path, filename, progress,
                    user_id=user_id, book_meta=book_meta
                )

        except Exception as e:
            logger.error(f"Error processing document {filename}: {str(e)}")
            await self._update_document_status(document_id, "failed", str(e))
            await progress.emit(document_id, "failed", 0, str(e))

        finally:
            # Always clean up temp file
            self._cleanup_temp_file(file_path)

    async def _run_pipeline(
        self,
        document_id: str,
        project_id: str,
        file_path: str,
        filename: str,
        progress,
        user_id: str = "",
        book_meta: Optional[Dict[str, Any]] = None,
    ):
        """
        The actual processing pipeline, called inside doc_semaphore.
        Separated so the semaphore scope is clear.
        """
        try:
            await self._update_document_status(document_id, "processing")
            await progress.emit(document_id, "extracting", 0, "Extracting text...")

            loop = asyncio.get_running_loop()

            # ── 1. Extract text ────────────────────────────────────────────────
            logger.info(f"Extracting text from {filename}")
            await self._update_document_status(
                document_id, "processing", "Extracting text..."
            )
            text = await loop.run_in_executor(
                self._extraction_executor, self.file_parser.extract_text, file_path
            )

            if not text:
                raise ValueError(
                    "Extraction failed: no usable text could be extracted from the document."
                )

            await progress.emit(
                document_id, "extracting", 100,
                f"Extracted {len(text)} characters"
            )

            # ── 2. Save extracted text to Supabase texts/ bucket ──────────────
            text_storage_path = await self._save_text_to_storage(
                document_id, project_id, filename, text
            )
            if text_storage_path:
                await self._update_document_text_path(document_id, text_storage_path)

            # ── 3. Chunk text ──────────────────────────────────────────────────
            logger.info(f"Chunking text from {filename}")
            await self._update_document_status(
                document_id, "processing", "Chunking text..."
            )
            await progress.emit(document_id, "chunking", 0, "Splitting into chunks...")

            chunks = await loop.run_in_executor(
                None, lambda: self.text_chunker.chunk_text(text)
            )

            if not chunks:
                await self._update_document_status(
                    document_id, "failed", "No chunks generated"
                )
                await progress.emit(
                    document_id, "failed", 0, "No chunks generated from text"
                )
                return

            await progress.emit(
                document_id, "chunking", 100,
                f"Generated {len(chunks)} chunks"
            )

            # ── 4. Create Qdrant collection ────────────────────────────────────
            collection_name = f"project_{project_id}"
            await qdrant_service.create_collection(collection_name)

            # ── 5. Process embeddings with global limits + progress ────────────
            await progress.emit(
                document_id, "embedding", 0,
                f"Embedding {len(chunks)} chunks..."
            )
            await self._process_embeddings_direct(
                chunks, document_id, filename, collection_name
            )

            # ── 6. Generate Topics (LLM-gated) ────────────────────────────────
            await self._update_document_status(
                document_id, "processing", "Generating topics..."
            )
            await progress.emit(
                document_id, "topics", 0, "Generating document topics..."
            )
            llm_semaphore = EmbeddingQueue.get_llm_semaphore()
            try:
                from services.mcq_service import mcq_service

                async with llm_semaphore:
                    await mcq_service.generate_document_topics(project_id, document_id)
                logger.info(f"Topics generated for {filename}")
                await progress.emit(document_id, "topics", 100, "Topics generated")
            except Exception as topic_err:
                logger.error(f"Failed to generate topics for {filename}: {topic_err}")
                await progress.emit(document_id, "topics", 100, "Topic generation skipped")

            # ── 7. Auto-build knowledge graph from all project topics ──────────
            await progress.emit(document_id, "graph", 0, "Building knowledge graph...")
            try:
                from services.knowledge_graph_service import knowledge_graph

                docs = await async_db(
                    lambda: get_supabase_client()
                    .table("documents")
                    .select("topics")
                    .eq("project_id", project_id)
                    .eq("upload_status", "completed")
                    .execute()
                )
                all_topics = []
                for d in docs.data or []:
                    all_topics.extend(d.get("topics") or [])

                # Also include topics from the current doc (not yet marked completed)
                current_doc = await async_db(
                    lambda: get_supabase_client()
                    .table("documents")
                    .select("topics")
                    .eq("id", document_id)
                    .execute()
                )
                if current_doc.data:
                    all_topics.extend(current_doc.data[0].get("topics") or [])

                all_topics = list(set(all_topics))
                if len(all_topics) >= 2:
                    logger.info(
                        f"Auto-building knowledge graph with {len(all_topics)} topics"
                    )
                    async with llm_semaphore:
                        await knowledge_graph.build_graph_from_topics(
                            project_id, all_topics, force_rebuild=True
                        )
                    logger.info(f"Knowledge graph built for {filename}")
                await progress.emit(document_id, "graph", 100, "Knowledge graph updated")
            except Exception as kg_err:
                logger.error(f"Failed to build knowledge graph: {kg_err}")
                await progress.emit(document_id, "graph", 100, "Knowledge graph skipped")

            # ── 8. Update status to completed ──────────────────────────────────
            await self._update_document_status(document_id, "completed")
            await progress.emit(
                document_id, "completed", 100, "Document processed successfully"
            )
            logger.info(f"Document {filename} processed successfully")

            # ── 9. Create book record if public ───────────────────────────────
            if book_meta:
                await self._create_book_record(document_id, text_storage_path, book_meta)

        except Exception as e:
            logger.error(f"Error in pipeline for {filename}: {str(e)}")
            await self._update_document_status(document_id, "failed", str(e))
            await progress.emit(document_id, "failed", 0, str(e))

    # ──────────────────────────────────────────────────────────────────────────
    # Storage helpers
    # ──────────────────────────────────────────────────────────────────────────

    async def _save_text_to_storage(
        self,
        document_id: str,
        project_id: str,
        filename: str,
        text: str,
    ) -> Optional[str]:
        """
        Upload extracted text as a .txt file to Supabase 'texts/' bucket.
        This is much smaller than the original file (10-50x compression).

        Returns the storage path on success, None on failure (non-fatal).
        """
        try:
            storage_path = f"{project_id}/{document_id}.txt"
            text_bytes = text.encode("utf-8")

            def _upload():
                supabase = get_supabase_client()
                supabase.storage.from_(settings.BOOK_IMPORT_TEXTS_BUCKET).upload(
                    file=text_bytes,
                    path=storage_path,
                    file_options={"content-type": "text/plain"},
                )

            await async_db(_upload)
            logger.info(
                f"Saved extracted text to texts/{storage_path} "
                f"({len(text_bytes):,} bytes)"
            )
            return storage_path

        except Exception as e:
            logger.error(f"Failed to save text to storage for {document_id}: {e}")
            return None

    async def _update_document_text_path(self, document_id: str, path: str):
        """Update text_storage_path in the documents record."""
        try:
            await async_db(
                lambda: self.client.table("documents")
                .update({"text_storage_path": path})
                .eq("id", document_id)
                .execute()
            )
        except Exception as e:
            logger.warning(f"Failed to update text_storage_path: {e}")

    async def _create_book_record(
        self,
        document_id: str,
        text_path: Optional[str],
        book_meta: Dict[str, Any],
    ):
        """
        Create a record in the books table for publicly shared books.
        Called after successful processing so failed uploads don't appear in the store.
        """
        try:
            book_data = {
                "user_id": book_meta.get("user_id"),
                "document_id": document_id,
                "title": book_meta.get("title"),
                "author": book_meta.get("author"),
                "description": book_meta.get("description"),
                "tags": book_meta.get("tags", []),
                "file_size": book_meta.get("file_size"),
                "file_type": book_meta.get("file_type"),
                "text_path": text_path,
                "is_public": True,
            }

            result = await async_db(
                lambda: self.client.table("books").insert(book_data).execute()
            )

            if result.data:
                logger.info(
                    f"Book record created (id={result.data[0]['id']}) "
                    f"for document {document_id}"
                )
        except Exception as e:
            logger.error(f"Failed to create book record for {document_id}: {e}")
            # Non-fatal — document is already processed successfully

    # ──────────────────────────────────────────────────────────────────────────
    # Embedding helpers
    # ──────────────────────────────────────────────────────────────────────────

    def _cleanup_temp_file(self, file_path: str):
        """Remove temporary file after processing"""
        try:
            if file_path and os.path.exists(file_path):
                os.unlink(file_path)
                logger.info(f"Cleaned up temp file: {file_path}")
        except Exception as e:
            logger.warning(f"Failed to clean up temp file {file_path}: {e}")

    async def _process_embeddings_direct(
        self, chunks: List[str], document_id: str, filename: str, collection_name: str
    ):
        """
        Process embeddings using GLOBAL concurrency limits (shared across all docs).
        Emits SSE progress events after each batch for real-time frontend updates.
        """
        progress = get_progress_manager()

        batches = []
        for i in range(0, len(chunks), self.batch_size):
            batch_data = chunks[i: i + self.batch_size]
            batches.append((i, batch_data))

        total_batches = len(batches)

        embed_semaphore = EmbeddingQueue.get_embed_semaphore()
        db_semaphore = EmbeddingQueue.get_db_semaphore()

        logger.info(
            f"[{filename}] Starting embedding: {len(chunks)} chunks, "
            f"{total_batches} batches (global limits)"
        )

        completed = [0]
        failed_batches = []

        async def process_batch(batch_idx: int, start_index: int, batch_data: List[str]):
            retries = 3
            for attempt in range(retries):
                try:
                    async with embed_semaphore:
                        batch_embeddings = await embedding_service.generate_embeddings(
                            batch_data
                        )

                    batch_metadata = [
                        {
                            "document_id": document_id,
                            "document_name": filename,
                            "chunk_id": start_index + k,
                        }
                        for k in range(len(batch_data))
                    ]

                    async with db_semaphore:
                        await qdrant_service.upsert_chunks(
                            collection_name=collection_name,
                            chunks=batch_data,
                            embeddings=batch_embeddings,
                            metadata=batch_metadata,
                        )

                    completed[0] += 1
                    pct = int((completed[0] / total_batches) * 100)

                    await progress.emit(
                        document_id, "embedding", pct,
                        f"Batch {completed[0]}/{total_batches}"
                    )

                    if completed[0] % 5 == 0 or completed[0] == total_batches:
                        logger.info(
                            f"[{filename}] Progress: {completed[0]}/{total_batches} batches"
                        )
                    return

                except Exception as e:
                    error_str = str(e).lower()
                    is_retryable = any(
                        x in error_str
                        for x in [
                            "429", "too many requests", "timeout",
                            "timed out", "connection", "temporary", "unavailable",
                        ]
                    )

                    if is_retryable and attempt < retries - 1:
                        wait_time = (2 ** attempt) + (0.1 * (batch_idx % 5))
                        logger.warning(
                            f"[{filename}] Batch {batch_idx + 1} retry {attempt + 1}/{retries} "
                            f"in {wait_time:.1f}s: {e}"
                        )
                        await asyncio.sleep(wait_time)
                        continue

                    logger.error(f"[{filename}] Batch {batch_idx + 1} failed: {e}")
                    if attempt == retries - 1:
                        failed_batches.append(batch_idx)
                        return  # Let other batches complete

        tasks = [
            process_batch(idx, start_idx, batch)
            for idx, (start_idx, batch) in enumerate(batches)
        ]
        await asyncio.gather(*tasks)

        if failed_batches:
            logger.warning(
                f"[{filename}] Completed with {len(failed_batches)} failed batches: {failed_batches}"
            )
        else:
            logger.info(f"[{filename}] Embedding completed: {total_batches} batches")

    # ──────────────────────────────────────────────────────────────────────────
    # Database helpers
    # ──────────────────────────────────────────────────────────────────────────

    async def _update_document_status(
        self, document_id: str, status: str, message: Optional[str] = None
    ):
        """Update document processing status in database (non-blocking)"""
        try:
            update_data = {"upload_status": status}
            if status == "completed":
                update_data["error_message"] = None
            elif message:
                update_data["error_message"] = message

            await async_db(
                lambda: self.client.table("documents")
                .update(update_data)
                .eq("id", document_id)
                .execute()
            )

        except Exception as e:
            logger.error(f"Error updating document status: {str(e)}")

    async def delete_document(self, project_id: str, document_id: str):
        """Delete document from DB, Vector Store, and Storage (non-blocking)"""
        try:
            collection_name = f"project_{project_id}"
            await qdrant_service.delete_vectors(collection_name, document_id)

            # Delete extracted text from texts/ bucket
            try:
                text_storage_path = f"{project_id}/{document_id}.txt"

                def _delete_text():
                    self.client.storage.from_(
                        settings.BOOK_IMPORT_TEXTS_BUCKET
                    ).remove([text_storage_path])

                await async_db(_delete_text)
                logger.info(f"Deleted text file texts/{text_storage_path}")
            except Exception as storage_err:
                logger.warning(f"Failed to delete text from storage: {storage_err}")

            await async_db(
                lambda: self.client.table("documents")
                .delete()
                .eq("id", document_id)
                .execute()
            )
            logger.info(f"Deleted document {document_id} from project {project_id}")
        except Exception as e:
            logger.error(f"Error deleting document: {str(e)}")
            raise

    async def process_chunks_direct(
        self, document_id: str, project_id: str, filename: str, chunks: List[str]
    ):
        """
        Process chunks received directly from PDF service (legacy webhook support).
        Kept for backward compatibility.
        """
        queue = get_embedding_queue()

        queue_stats = queue.get_queue_stats()
        active = queue_stats["processing"] + queue_stats["queued"]

        if active > 0:
            await self._update_document_status(
                document_id, "embedding", f"Processing with {active} other documents..."
            )
        else:
            await self._update_document_status(
                document_id, "embedding", "Generating embeddings..."
            )

        async def process_job(job: EmbeddingJob):
            """Called by queue for processing"""
            try:
                await self._update_document_status(
                    document_id, "embedding", "Generating embeddings..."
                )

                logger.info(f"Processing {len(chunks)} chunks for document {filename}")

                collection_name = f"project_{project_id}"
                await qdrant_service.create_collection(collection_name)
                await self._process_embeddings_direct(
                    chunks, document_id, filename, collection_name
                )

                await self._update_document_status(
                    document_id, "embedding", "Generating topics..."
                )
                try:
                    from services.mcq_service import mcq_service
                    await mcq_service.generate_document_topics(project_id, document_id)
                    logger.info(f"Topics generated for {filename}")
                except Exception as topic_err:
                    logger.error(f"Failed to generate topics: {topic_err}")

                try:
                    from services.knowledge_graph_service import knowledge_graph
                    docs = await async_db(
                        lambda: get_supabase_client()
                        .table("documents")
                        .select("topics")
                        .eq("project_id", project_id)
                        .eq("upload_status", "completed")
                        .execute()
                    )
                    all_topics = []
                    for d in docs.data or []:
                        all_topics.extend(d.get("topics") or [])
                    current_doc = await async_db(
                        lambda: get_supabase_client()
                        .table("documents")
                        .select("topics")
                        .eq("id", document_id)
                        .execute()
                    )
                    if current_doc.data:
                        all_topics.extend(current_doc.data[0].get("topics") or [])
                    all_topics = list(set(all_topics))
                    if len(all_topics) >= 2:
                        await knowledge_graph.build_graph_from_topics(
                            project_id, all_topics, force_rebuild=True
                        )
                except Exception as kg_err:
                    logger.error(f"Failed to build knowledge graph: {kg_err}")

                await self._update_document_status(document_id, "completed")
                logger.info(f"Document {filename} embeddings completed successfully")

            except Exception as e:
                logger.error(f"Error processing chunks for {filename}: {str(e)}")
                await self._update_document_status(document_id, "failed", str(e))
                raise

        await queue.enqueue(
            document_id=document_id,
            project_id=project_id,
            filename=filename,
            chunks=chunks,
            process_callback=process_job,
        )


document_service = DocumentService()
