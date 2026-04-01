from pydantic_settings import BaseSettings
from pydantic import Field
from typing import Optional, List


class Settings(BaseSettings):
    # Supabase Configuration
    SUPABASE_URL: str
    SUPABASE_KEY: str
    SUPABASE_SERVICE_KEY: str

    # ─────────────────────────────────────────────────────────
    # Azure OpenAI (primary LLM — used for chat, topics, graph)
    # .env keys: AZURE_OPENAI_API_KEY, AZURE_OPENAI_ENDPOINT,
    #            AZURE_OPENAI_DEPLOYMENT, AZURE_OPENAI_API_VERSION
    # ─────────────────────────────────────────────────────────
    AZURE_OPENAI_API_KEY: Optional[str] = None
    AZURE_OPENAI_ENDPOINT: Optional[str] = None
    AZURE_OPENAI_API_VERSION: str = "2024-12-01-preview"

    # Deployment name in Azure (your .env uses AZURE_OPENAI_DEPLOYMENT)
    AZURE_OPENAI_DEPLOYMENT: str = "gpt4o"

    # Alias kept for backward-compat with any service that imports this name
    @property
    def AZURE_OPENAI_CHAT_DEPLOYMENT(self) -> str:
        return self.AZURE_OPENAI_DEPLOYMENT

    # Embedding deployment (optional — currently using Together AI)
    AZURE_OPENAI_EMBED_DEPLOYMENT: str = "text-embedding-3-large"

    # ─────────────────────────────────────────────────────────
    # Legacy OpenAI-compatible LLM fields
    # Kept so any old service import doesn't crash.
    # Defaults to Azure values so they're usable even if not set.
    # ─────────────────────────────────────────────────────────
    LLM_API_KEY: str = Field(default="")
    LLM_BASE_URL: str = Field(default="")
    LLM_MODEL: str = Field(default="gpt4o")

    # Webhook
    MAIN_API_WEBHOOK_SECRET: str = Field(default="supersecretwebhook")
    MAIN_API_WEBHOOK_URL: str = Field(default="http://localhost:8000/api/v1/webhook/document-ready")

    # ─────────────────────────────────────────────────────────
    # Embeddings — Together AI (multilingual-e5-large)
    # ─────────────────────────────────────────────────────────
    EMBEDDING_API_KEY: str
    EMBEDDING_BASE_URL: str
    EMBEDDING_MODEL: str
    EMBEDDING_DIMENSION: int = 1024

    # ─────────────────────────────────────────────────────────
    # Qdrant Vector Store
    # ─────────────────────────────────────────────────────────
    QDRANT_URL: str = "http://localhost:6333"
    QDRANT_API_KEY: Optional[str] = None

    # ─────────────────────────────────────────────────────────
    # Azure Computer Vision — OCR for scanned PDFs and images
    # ─────────────────────────────────────────────────────────
    # Set these to enable cloud OCR (replaces local Tesseract fallback).
    # Format: https://<region>.api.cognitive.microsoft.com/
    AZURE_CV_ENDPOINT: str = ""
    AZURE_CV_KEY: str = ""

    # Together AI (optional - for some services)
    TOGETHER_API_KEY: str = Field(default="")

    # ─────────────────────────────────────────────────────────
    # Application
    # ─────────────────────────────────────────────────────────
    ENVIRONMENT: str = "development"
    SECRET_KEY: str = "supersecretkey"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24 * 8  # 8 days

    # CORS
    BACKEND_CORS_ORIGINS: List[str] = [
        "http://localhost:5173",
        "http://localhost:3000",
        "https://lumina-iq-livid.vercel.app",
        "https://luminaiq.fun",
    ]

    UPLOAD_DIR: str = "./uploads"
    MAX_FILE_SIZE: int = 10485760  # 10MB
    ALLOWED_EXTENSIONS: List[str] = [
        "pdf", "docx", "txt", "html", "md",
        # Image formats — processed via Azure CV OCR
        "jpg", "jpeg", "png", "bmp", "tiff", "tif", "gif", "webp",
    ]

    CHUNK_SIZE: int = 800
    CHUNK_OVERLAP: int = 80

    # ─────────────────────────────────────────────────────────
    # Concurrency — all limits in one place for easy tuning
    # ─────────────────────────────────────────────────────────

    # General LLM-heavy operations (chat, quiz, notes, knowledge graph, etc.)
    MAX_CONCURRENT_GENERAL: int = 40

    # Document upload + embedding pipeline
    MAX_CONCURRENT_DOCUMENT_UPLOADS: int = 10

    # Global limits inside the embedding pipeline (shared across all docs)
    MAX_GLOBAL_DB_OPERATIONS: int = 20      # Qdrant write concurrency
    MAX_GLOBAL_EMBEDDINGS: int = 15         # Concurrent embedding API calls
    MAX_CONCURRENT_LLM: int = 5             # Concurrent LLM calls (topic/graph gen)

    # Batch size for embedding API calls
    EMBEDDING_BATCH_SIZE: int = 50
    EMBEDDING_DELAY_MS: int = 0  # 0 = no artificial delay (Azure has no rate limits)

    # Gunicorn workers for production
    # Recommended: (2 * CPU cores) + 1. Azure 1-core = 3 workers.
    GUNICORN_WORKERS: int = 3

    # Webhook secret
    WEBHOOK_SECRET: str = "supersecretwebhook"

    # ─────────────────────────────────────────────────────────
    # Book Store
    # ─────────────────────────────────────────────────────────
    BOOK_STORE_PAGE_SIZE: int = 20
    BOOK_STORE_MAX_DESCRIPTION: int = 2000
    BOOK_IMPORT_TEXTS_BUCKET: str = "texts"   # Supabase bucket for extracted .txt files

    class Config:
        env_file = ".env"
        case_sensitive = True


settings = Settings()
