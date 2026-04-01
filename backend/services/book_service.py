"""
Book Store Service

Handles all operations for the Book Store:
- Listing public books (with search + tag filtering)
- Reading a user's own books
- Importing a public book into a project (copies txt, re-embeds)
- Updating book metadata / visibility
- Deleting a book (owner only)
"""

import asyncio
from typing import Optional, List, Dict, Any
from db.client import get_supabase_client, async_db
from config.settings import settings
from utils.logger import logger
from utils.embedding_queue import EmbeddingQueue


class BookService:

    def __init__(self):
        self.client = get_supabase_client()

    # ──────────────────────────────────────────────────────────────────────────
    # READ
    # ──────────────────────────────────────────────────────────────────────────

    async def get_public_books(
        self,
        page: int = 1,
        page_size: int = None,
        search: Optional[str] = None,
        tags: Optional[List[str]] = None,
    ) -> Dict[str, Any]:
        """
        Return paginated list of public books for the Book Store.
        Supports full-text search on title/author/description and tag filtering.
        """
        page_size = page_size or settings.BOOK_STORE_PAGE_SIZE
        offset = (page - 1) * page_size

        def _query():
            supabase = get_supabase_client()
            q = (
                supabase.table("books")
                .select(
                    "id, title, author, description, cover_url, file_size, file_type, "
                    "tags, import_count, created_at, user_id",
                    count="exact",
                )
                .eq("is_public", True)
                .order("import_count", desc=True)
                .order("created_at", desc=True)
                .range(offset, offset + page_size - 1)
            )

            if search:
                # Use ilike for case-insensitive partial match across key fields
                q = q.or_(
                    f"title.ilike.%{search}%,"
                    f"author.ilike.%{search}%,"
                    f"description.ilike.%{search}%"
                )

            if tags:
                # Filter books that contain ALL the requested tags (Postgres array overlap)
                q = q.contains("tags", tags)

            return q.execute()

        try:
            result = await async_db(_query)
            total = result.count or 0
            return {
                "books": result.data or [],
                "total": total,
                "page": page,
                "page_size": page_size,
                "total_pages": max(1, (total + page_size - 1) // page_size),
            }
        except Exception as e:
            logger.error(f"Failed to fetch public books: {e}")
            raise

    async def get_user_books(self, user_id: str) -> List[Dict]:
        """Return all books (public + private) belonging to the current user."""
        def _query():
            return (
                get_supabase_client()
                .table("books")
                .select("*")
                .eq("user_id", user_id)
                .order("created_at", desc=True)
                .execute()
            )

        try:
            result = await async_db(_query)
            return result.data or []
        except Exception as e:
            logger.error(f"Failed to fetch user books: {e}")
            raise

    async def get_book(self, book_id: str, user_id: str) -> Optional[Dict]:
        """
        Return a single book.
        Returns None if book doesn't exist or user doesn't have read access.
        """
        def _query():
            return (
                get_supabase_client()
                .table("books")
                .select("*")
                .eq("id", book_id)
                .execute()
            )

        try:
            result = await async_db(_query)
            if not result.data:
                return None
            book = result.data[0]
            # Check access: public books are visible to all; private only to owner
            if not book["is_public"] and book["user_id"] != user_id:
                return None
            return book
        except Exception as e:
            logger.error(f"Failed to fetch book {book_id}: {e}")
            raise

    async def check_import_status(
        self, book_id: str, project_id: str, user_id: str
    ) -> Optional[Dict]:
        """
        Check if a book has already been imported into a project.
        Returns the import record or None.
        """
        def _query():
            return (
                get_supabase_client()
                .table("book_imports")
                .select("*")
                .eq("book_id", book_id)
                .eq("project_id", project_id)
                .eq("user_id", user_id)
                .maybe_single()
                .execute()
            )

        try:
            result = await async_db(_query)
            return result.data if result else None
        except Exception as e:
            logger.error(f"Failed to check import status: {e}")
            return None

    # ──────────────────────────────────────────────────────────────────────────
    # WRITE
    # ──────────────────────────────────────────────────────────────────────────

    async def import_book(
        self, book_id: str, project_id: str, user_id: str
    ) -> Dict[str, Any]:
        """
        Import a public book into a user's project.

        Flow:
        1. Validate book exists and is public
        2. Check for duplicate import
        3. Read the extracted .txt from Supabase texts/ bucket
        4. Create a new document record in the target project
        5. Save the txt to the target project's path in texts/ bucket
        6. Trigger background embedding pipeline
        7. Record the import in book_imports
        8. Increment import_count on books table

        Returns the new document record.
        """
        # 1. Validate book
        book = await self.get_book(book_id, user_id)
        if not book:
            raise ValueError("Book not found or not accessible")
        if not book["is_public"]:
            raise PermissionError("This book is not publicly available")

        # 2. Check duplicate
        existing = await self.check_import_status(book_id, project_id, user_id)
        if existing:
            raise ValueError("This book has already been imported into this project")

        # 3. Read extracted text from texts/ bucket
        source_text_path = book.get("text_path")
        if not source_text_path:
            raise ValueError(
                "This book's text content is not available for import. "
                "Please ask the owner to re-process it."
            )

        def _read_text():
            supabase = get_supabase_client()
            return supabase.storage.from_(settings.BOOK_IMPORT_TEXTS_BUCKET).download(
                source_text_path
            )

        try:
            text_bytes = await async_db(_read_text)
            text_content = text_bytes.decode("utf-8")
        except Exception as e:
            logger.error(f"Failed to download text for book {book_id}: {e}")
            raise ValueError("Failed to read book content from storage")

        # 4. Create a new document record in the target project
        doc_data = {
            "project_id": project_id,
            "filename": f"{book['title']}.txt",
            "file_type": "text/plain",
            "file_size": len(text_bytes),
            "upload_status": "pending",
            "user_id": user_id,
        }

        def _insert_doc():
            return (
                get_supabase_client()
                .table("documents")
                .insert(doc_data)
                .execute()
            )

        doc_result = await async_db(_insert_doc)
        if not doc_result.data:
            raise RuntimeError("Failed to create document record for imported book")

        document = doc_result.data[0]
        document_id = document["id"]

        # 5. Save text to target project path in texts/ bucket
        target_text_path = f"{project_id}/{document_id}.txt"
        try:
            def _upload_text():
                get_supabase_client().storage.from_(
                    settings.BOOK_IMPORT_TEXTS_BUCKET
                ).upload(
                    file=text_bytes,
                    path=target_text_path,
                    file_options={"content-type": "text/plain"},
                )

            await async_db(_upload_text)

            # Update document with text_storage_path
            def _update_path():
                return (
                    get_supabase_client()
                    .table("documents")
                    .update({"text_storage_path": target_text_path})
                    .eq("id", document_id)
                    .execute()
                )
            await async_db(_update_path)
        except Exception as e:
            logger.warning(f"Failed to copy text to target path: {e}")
            # Non-fatal — we'll still embed from in-memory text

        # 6. Trigger embedding pipeline (non-blocking background task)
        asyncio.create_task(
            self._embed_imported_text(
                document_id=document_id,
                project_id=project_id,
                filename=doc_data["filename"],
                text_content=text_content,
            )
        )

        # 7. Record the import
        def _record_import():
            return (
                get_supabase_client()
                .table("book_imports")
                .insert({
                    "book_id": book_id,
                    "user_id": user_id,
                    "project_id": project_id,
                    "document_id": document_id,
                })
                .execute()
            )

        await async_db(_record_import)

        # 8. Increment import_count (best-effort)
        try:
            def _increment():
                supabase = get_supabase_client()
                current = (
                    supabase.table("books")
                    .select("import_count")
                    .eq("id", book_id)
                    .single()
                    .execute()
                )
                count = (current.data or {}).get("import_count", 0) + 1
                return (
                    supabase.table("books")
                    .update({"import_count": count})
                    .eq("id", book_id)
                    .execute()
                )

            await async_db(_increment)
        except Exception as e:
            logger.warning(f"Failed to increment import_count: {e}")

        logger.info(
            f"Book '{book['title']}' imported into project {project_id} "
            f"as document {document_id}"
        )
        return document

    async def _embed_imported_text(
        self,
        document_id: str,
        project_id: str,
        filename: str,
        text_content: str,
    ):
        """
        Background task: chunk and embed the imported book's text content.
        Uses the same pipeline as regular document processing.
        """
        from utils.progress_manager import get_progress_manager
        from utils.text_chunker import TextChunker
        from services.qdrant_service import qdrant_service
        from services.embedding_service import embedding_service

        progress = get_progress_manager()
        doc_semaphore = EmbeddingQueue.get_doc_semaphore()

        try:
            if doc_semaphore.locked():
                await progress.emit(document_id, "queued", 0, "Waiting for processing slot...")

            async with doc_semaphore:
                await progress.emit(document_id, "chunking", 0, "Chunking book content...")

                chunker = TextChunker(
                    chunk_size=settings.CHUNK_SIZE,
                    overlap=settings.CHUNK_OVERLAP,
                )
                loop = asyncio.get_running_loop()
                chunks = await loop.run_in_executor(
                    None, lambda: chunker.chunk_text(text_content)
                )

                if not chunks:
                    await self._update_doc_status(document_id, "failed", "No content chunks")
                    return

                await progress.emit(
                    document_id, "chunking", 100,
                    f"Generated {len(chunks)} chunks"
                )

                # Embed
                collection_name = f"project_{project_id}"
                await qdrant_service.create_collection(collection_name)

                await progress.emit(document_id, "embedding", 0, f"Embedding {len(chunks)} chunks...")

                from services.document_service import document_service
                await document_service._process_embeddings_direct(
                    chunks, document_id, filename, collection_name
                )

                # Topics
                await progress.emit(document_id, "topics", 0, "Generating topics...")
                llm_semaphore = EmbeddingQueue.get_llm_semaphore()
                try:
                    from services.mcq_service import mcq_service
                    async with llm_semaphore:
                        await mcq_service.generate_document_topics(project_id, document_id)
                    await progress.emit(document_id, "topics", 100, "Topics generated")
                except Exception as te:
                    logger.warning(f"Topic generation skipped for import: {te}")
                    await progress.emit(document_id, "topics", 100, "Topics skipped")

                await self._update_doc_status(document_id, "completed")
                await progress.emit(document_id, "completed", 100, "Book import complete")
                logger.info(f"Imported book {filename} embedded successfully")

        except Exception as e:
            logger.error(f"Failed to embed imported book {document_id}: {e}")
            await self._update_doc_status(document_id, "failed", str(e))
            await progress.emit(document_id, "failed", 0, str(e))

    async def _update_doc_status(self, document_id: str, status: str, message: str = None):
        try:
            update = {"upload_status": status}
            if message:
                update["error_message"] = message
            await async_db(
                lambda: self.client.table("documents")
                .update(update)
                .eq("id", document_id)
                .execute()
            )
        except Exception as e:
            logger.warning(f"Failed to update doc status: {e}")

    async def update_book(
        self, book_id: str, user_id: str, updates: Dict[str, Any]
    ) -> Dict:
        """Update book metadata / visibility. Only owner can update."""
        # Ensure user is the owner
        book = await self.get_book(book_id, user_id)
        if not book:
            raise ValueError("Book not found")
        if book["user_id"] != user_id:
            raise PermissionError("Only the book owner can edit this book")

        # Whitelist updatable fields
        allowed = {"title", "author", "description", "cover_url", "tags", "is_public"}
        safe_updates = {k: v for k, v in updates.items() if k in allowed}

        if not safe_updates:
            return book

        if "description" in safe_updates and safe_updates["description"]:
            safe_updates["description"] = safe_updates["description"][
                :settings.BOOK_STORE_MAX_DESCRIPTION
            ]

        def _update():
            return (
                get_supabase_client()
                .table("books")
                .update(safe_updates)
                .eq("id", book_id)
                .execute()
            )

        result = await async_db(_update)
        return result.data[0] if result.data else book

    async def delete_book(self, book_id: str, user_id: str):
        """
        Delete a book from the store.
        Only the original uploader can delete.
        Also cleans up the text file from storage.
        """
        book = await self.get_book(book_id, user_id)
        if not book:
            raise ValueError("Book not found")
        if book["user_id"] != user_id:
            raise PermissionError("Only the book owner can delete this book")

        # Delete text from storage (non-fatal)
        if book.get("text_path"):
            try:
                def _delete_text():
                    get_supabase_client().storage.from_(
                        settings.BOOK_IMPORT_TEXTS_BUCKET
                    ).remove([book["text_path"]])

                await async_db(_delete_text)
            except Exception as e:
                logger.warning(f"Could not delete text file for book {book_id}: {e}")

        # Delete book record (cascade deletes book_imports)
        def _delete_book():
            return (
                get_supabase_client()
                .table("books")
                .delete()
                .eq("id", book_id)
                .execute()
            )

        await async_db(_delete_book)
        logger.info(f"Book {book_id} deleted by user {user_id}")


book_service = BookService()
