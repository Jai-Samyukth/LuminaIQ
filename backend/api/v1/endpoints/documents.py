import os
import asyncio
import tempfile
from typing import List, Optional
from fastapi import (
    APIRouter,
    UploadFile,
    File,
    HTTPException,
    Depends,
    Form,
    status,
)
from pydantic import BaseModel
from services.document_service import document_service
from services.embedding_service import embedding_service
from services.qdrant_service import qdrant_service
from models.schemas import DocumentUploadResponse, DocumentList
from config.settings import settings
from api.deps import get_current_user
from utils.embedding_queue import get_embedding_queue
from utils.logger import logger
from db.client import async_db, get_supabase_client

router = APIRouter()


class SearchRequest(BaseModel):
    query: str
    document_ids: Optional[List[str]] = None
    limit: int = 10


class SearchResult(BaseModel):
    text: str
    document_id: str
    document_name: Optional[str] = None
    chunk_id: Optional[int] = None
    score: float


@router.post("/upload", response_model=DocumentUploadResponse)
async def upload_document(
    file: UploadFile = File(...),
    project_id: str = Form(...),
    is_public: bool = Form(False),
    book_title: Optional[str] = Form(None),
    book_author: Optional[str] = Form(None),
    book_description: Optional[str] = Form(None),
    book_tags: Optional[str] = Form(None),  # comma-separated string from frontend
    current_user: dict = Depends(get_current_user),
):
    """
    Upload a document and start processing.

    UNIFIED FLOW:
    1. Validate file type & size
    2. Save to temp file (memory efficient for large files)
    3. Create document DB record
    4. Background: extract text → save .txt to Supabase texts/ bucket → chunk → embed → topics → knowledge graph
    5. If is_public=True: create a book record in the books table
    6. Real-time SSE progress via /api/v1/progress/{document_id}

    NOTE: Raw original files are NOT stored in Supabase Storage.
    Only the extracted .txt is stored (10-50x smaller than PDFs).
    """
    temp_path = None
    try:
        # 1. Validate File Type
        allowed_mimes = [
            # Document formats
            "application/pdf",
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            "text/plain",
            "text/html",
            "text/markdown",
            # Image formats — processed via Azure Computer Vision OCR
            "image/jpeg",
            "image/png",
            "image/bmp",
            "image/tiff",
            "image/gif",
            "image/webp",
            # Some browsers send these for JPEG
            "image/jpg",
            "image/x-png",
        ]
        if file.content_type not in allowed_mimes:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                "Invalid file type. Supported: PDF, DOCX, TXT, HTML, MD (documents) "
                "and JPEG, PNG, BMP, TIFF, GIF, WebP (images — processed via OCR).",
            )

        file_ext = os.path.splitext(file.filename)[1].lower().replace(".", "")
        if file_ext not in settings.ALLOWED_EXTENSIONS:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                f"Invalid file extension. Allowed: {settings.ALLOWED_EXTENSIONS}",
            )

        # 2. Stream to temp file (memory-efficient for large files)
        os.makedirs("temp", exist_ok=True)
        temp_file = tempfile.NamedTemporaryFile(
            delete=False, suffix=f".{file_ext}", dir="temp"
        )

        file_size = 0
        chunk_size = 1024 * 1024  # 1MB chunks

        while True:
            chunk = await file.read(chunk_size)
            if not chunk:
                break
            file_size += len(chunk)
            if file_size > settings.MAX_FILE_SIZE:
                temp_file.close()
                os.unlink(temp_file.name)
                raise HTTPException(
                    status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                    f"File size exceeds limit of {settings.MAX_FILE_SIZE} bytes",
                )
            temp_file.write(chunk)

        temp_file.close()
        temp_path = temp_file.name

        # 3. Create document record in Supabase
        doc_data = {
            "project_id": project_id,
            "filename": file.filename,
            "file_type": file.content_type,
            "file_size": file_size,
            "upload_status": "pending",
            "user_id": current_user.get("id"),
        }

        response = await async_db(
            lambda: get_supabase_client()
            .table("documents")
            .insert(doc_data)
            .execute()
        )

        if not response.data:
            raise HTTPException(500, "Failed to create document record")

        document = response.data[0]
        document_id = document["id"]

        # 4. Start CONCURRENT background processing
        # asyncio.create_task = truly parallel (vs Starlette BackgroundTasks which are serial)
        book_meta = None
        if is_public:
            book_meta = {
                "title": book_title or file.filename,
                "author": book_author,
                "description": book_description,
                "tags": [t.strip() for t in (book_tags or "").split(",") if t.strip()],
                "file_size": file_size,
                "file_type": file.content_type,
                "user_id": current_user.get("id"),
            }

        asyncio.create_task(
            document_service.process_document(
                document_id=document_id,
                project_id=project_id,
                file_path=temp_path,
                filename=file.filename,
                user_id=current_user.get("id"),
                book_meta=book_meta,
            )
        )

        logger.info(
            f"Document {file.filename} upload started, processing in background "
            f"(public={is_public})"
        )

        return document

    except HTTPException:
        if temp_path and os.path.exists(temp_path):
            try:
                os.unlink(temp_path)
            except Exception:
                pass
        raise
    except Exception as e:
        if temp_path and os.path.exists(temp_path):
            try:
                os.unlink(temp_path)
            except Exception:
                pass
        logger.error(f"Upload error: {str(e)}")
        raise HTTPException(500, str(e))


@router.get("/{project_id}", response_model=DocumentList)
async def list_documents(
    project_id: str, current_user: dict = Depends(get_current_user)
):
    """List all documents for a project"""
    try:
        response = await async_db(
            lambda: document_service.client.table("documents")
            .select("*")
            .eq("project_id", project_id)
            .execute()
        )
        return {"documents": response.data}
    except Exception as e:
        raise HTTPException(500, str(e))


@router.delete("/{document_id}")
async def delete_document(
    document_id: str, project_id: str, current_user: dict = Depends(get_current_user)
):
    """Delete a document"""
    try:
        await document_service.delete_document(project_id, document_id)
        return {"message": "Document deleted successfully"}
    except Exception as e:
        raise HTTPException(500, str(e))


@router.get("/queue/status")
async def get_queue_status(current_user: dict = Depends(get_current_user)):
    """
    Get embedding queue status and current concurrency limits.

    Returns:
        - queued: Number of documents waiting
        - processing: Currently processing
        - limits: Currently active concurrency limits
    """
    try:
        queue = get_embedding_queue()
        return queue.get_queue_stats()
    except Exception as e:
        raise HTTPException(500, str(e))


@router.get("/queue/{document_id}")
async def get_document_queue_status(
    document_id: str, current_user: dict = Depends(get_current_user)
):
    """Get queue status for a specific document."""
    try:
        queue = get_embedding_queue()
        doc_status = queue.get_document_status(document_id)
        if not doc_status:
            return {"status": "not_in_queue", "message": "Document not found in queue"}
        return doc_status
    except Exception as e:
        raise HTTPException(500, str(e))


@router.post("/{project_id}/search")
async def search_documents(
    project_id: str,
    request: SearchRequest,
    current_user: dict = Depends(get_current_user),
):
    """Semantic search across documents in a project."""
    try:
        collection_name = f"project_{project_id}"

        # Generate embedding for the search query
        query_embedding = await embedding_service.generate_embedding(request.query)

        # Build filter conditions
        filter_conditions = None
        if request.document_ids and len(request.document_ids) > 0:
            filter_conditions = {"document_ids": request.document_ids}

        # Search in Qdrant
        results = await qdrant_service.search(
            collection_name=collection_name,
            query_vector=query_embedding,
            limit=request.limit,
            filter_conditions=filter_conditions,
        )

        # Get document names from the database for richer results
        doc_names = {}
        if results:
            doc_ids = list(
                set(r.get("document_id") for r in results if r.get("document_id"))
            )
            if doc_ids:
                try:
                    docs_response = await async_db(
                        lambda: document_service.client.table("documents")
                        .select("id, filename")
                        .in_("id", doc_ids)
                        .execute()
                    )
                    for doc in docs_response.data:
                        doc_names[doc["id"]] = doc["filename"]
                except Exception as e:
                    logger.warning(f"Could not fetch document names: {e}")

        # Format results
        search_results = []
        for result in results:
            doc_id = result.get("document_id")
            search_results.append(
                {
                    "text": result.get("text", ""),
                    "document_id": doc_id,
                    "document_name": doc_names.get(doc_id, "Unknown"),
                    "chunk_id": result.get("chunk_id"),
                    "score": result.get("score", 0),
                }
            )

        return {"results": search_results, "query": request.query}

    except Exception as e:
        logger.error(f"Search error: {str(e)}")
        raise HTTPException(500, f"Search failed: {str(e)}")
