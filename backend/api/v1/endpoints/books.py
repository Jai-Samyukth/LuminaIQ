"""
Book Store API Endpoints

GET  /books/              — List all public books (paginated, searchable)
GET  /books/my            — Current user's books (public + private)
GET  /books/{book_id}     — Get a single book
POST /books/{book_id}/import — Import a public book into a project
PATCH /books/{book_id}   — Update book metadata/visibility (owner only)
DELETE /books/{book_id}  — Delete a book (owner only)
"""

from typing import Optional, List
from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from services.book_service import book_service
from api.deps import get_current_user
from utils.logger import logger

router = APIRouter()


# ── Request / Response Models ─────────────────────────────────────────────────

class BookUpdateRequest(BaseModel):
    title: Optional[str] = None
    author: Optional[str] = None
    description: Optional[str] = None
    cover_url: Optional[str] = None
    tags: Optional[List[str]] = None
    is_public: Optional[bool] = None


class ImportBookRequest(BaseModel):
    project_id: str = Field(..., description="Target project to import the book into")


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("/")
async def list_public_books(
    page: int = Query(1, ge=1, description="Page number"),
    page_size: int = Query(20, ge=1, le=100, description="Books per page"),
    search: Optional[str] = Query(None, description="Search title, author, description"),
    tags: Optional[str] = Query(None, description="Comma-separated tag filter"),
    current_user: dict = Depends(get_current_user),
):
    """
    Browse the public Book Store.
    Results are sorted by popularity (import_count) then recency.
    """
    try:
        tag_list = [t.strip() for t in tags.split(",")] if tags else None
        return await book_service.get_public_books(
            page=page,
            page_size=page_size,
            search=search,
            tags=tag_list,
        )
    except Exception as e:
        logger.error(f"Error listing public books: {e}")
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, str(e))


@router.get("/my")
async def list_my_books(current_user: dict = Depends(get_current_user)):
    """List all books uploaded by the current user (public + private)."""
    try:
        return await book_service.get_user_books(current_user["id"])
    except Exception as e:
        logger.error(f"Error listing user books: {e}")
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, str(e))


@router.get("/{book_id}")
async def get_book(book_id: str, current_user: dict = Depends(get_current_user)):
    """Get details for a single book."""
    try:
        book = await book_service.get_book(book_id, current_user["id"])
        if not book:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Book not found")
        return book
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error fetching book {book_id}: {e}")
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, str(e))


@router.post("/{book_id}/import")
async def import_book(
    book_id: str,
    request: ImportBookRequest,
    current_user: dict = Depends(get_current_user),
):
    """
    Import a public book into one of your projects.
    This creates a new document in the target project and triggers embedding.
    Returns the new document record immediately; processing continues in background.
    """
    try:
        document = await book_service.import_book(
            book_id=book_id,
            project_id=request.project_id,
            user_id=current_user["id"],
        )
        return {
            "message": "Book import started successfully",
            "document": document,
        }
    except ValueError as e:
        raise HTTPException(status.HTTP_409_CONFLICT, str(e))
    except PermissionError as e:
        raise HTTPException(status.HTTP_403_FORBIDDEN, str(e))
    except Exception as e:
        logger.error(f"Error importing book {book_id}: {e}")
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, str(e))


@router.patch("/{book_id}")
async def update_book(
    book_id: str,
    request: BookUpdateRequest,
    current_user: dict = Depends(get_current_user),
):
    """Update book metadata or public/private visibility. Only the owner can do this."""
    try:
        updated = await book_service.update_book(
            book_id=book_id,
            user_id=current_user["id"],
            updates=request.model_dump(exclude_none=True),
        )
        return updated
    except ValueError as e:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(e))
    except PermissionError as e:
        raise HTTPException(status.HTTP_403_FORBIDDEN, str(e))
    except Exception as e:
        logger.error(f"Error updating book {book_id}: {e}")
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, str(e))


@router.delete("/{book_id}")
async def delete_book(book_id: str, current_user: dict = Depends(get_current_user)):
    """Delete a book from the store. Only the original uploader can delete."""
    try:
        await book_service.delete_book(book_id=book_id, user_id=current_user["id"])
        return {"message": "Book deleted successfully"}
    except ValueError as e:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(e))
    except PermissionError as e:
        raise HTTPException(status.HTTP_403_FORBIDDEN, str(e))
    except Exception as e:
        logger.error(f"Error deleting book {book_id}: {e}")
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, str(e))
