import asyncio
import os
from typing import Optional
from utils.logger import logger


class FileParser:
    """
    File parser with multi-stage extraction and smart OCR routing.

    PDF extraction order:
    1. PyMuPDF4LLM (best for digital/structured PDFs)
    2. PyPDF2        (solid fallback)
    3. Raw PyMuPDF   (last standard resort)
    → If < 200 chars extracted (likely scanned):
    4. Azure Computer Vision Read API   (preferred — cloud, high accuracy)
    5. Tesseract / pdf2image             (local fallback if Azure not configured)

    Image files (.jpg, .jpeg, .png, .bmp, .tiff, .gif, .webp):
    → Azure Computer Vision OCR  (primary)
    → Tesseract via PIL           (fallback if Azure not configured)
    """

    # Minimum chars to consider primary extraction successful
    MIN_TEXT_CHARS = 200
    # Minimum chars for images (images may have less dense text)
    MIN_IMAGE_CHARS = 50

    # ──────────────────────────────────────────────────────────────────────────
    # Public entry point
    # ──────────────────────────────────────────────────────────────────────────

    @staticmethod
    def extract_text(file_path: str) -> Optional[str]:
        """
        Extract text from any supported file format.

        This is synchronous and safe to call from run_in_executor.
        Azure OCR (async) is invoked via asyncio.run() inside the executor thread.

        Supported: pdf, docx, txt, html, md, jpg, jpeg, png, bmp, tiff, tif, gif, webp
        """
        logger.info(f"[FileParser] Extracting from: {file_path}")

        try:
            _, ext = os.path.splitext(file_path)
            ext = ext.lower()

            if ext == ".pdf":
                return FileParser._extract_pdf(file_path)
            elif ext in [".docx", ".doc"]:
                return FileParser._extract_docx(file_path)
            elif ext == ".txt":
                return FileParser._extract_txt(file_path)
            elif ext == ".html":
                return FileParser._extract_html(file_path)
            elif ext == ".md":
                return FileParser._extract_markdown(file_path)
            elif ext in [".jpg", ".jpeg", ".png", ".bmp", ".tiff", ".tif", ".gif", ".webp"]:
                return FileParser._extract_image(file_path)
            else:
                logger.error(f"[FileParser] Unsupported file type: {ext}")
                return None

        except ValueError:
            raise  # Re-raise so document_service marks the doc as failed
        except Exception as e:
            logger.error(f"[FileParser] Error extracting from {file_path}: {e}")
            import traceback
            logger.error(f"[FileParser] Traceback: {traceback.format_exc()}")
            return None

    # ──────────────────────────────────────────────────────────────────────────
    # PDF extraction — 2-stage pipeline
    # ──────────────────────────────────────────────────────────────────────────

    @staticmethod
    def _extract_pdf(file_path: str) -> Optional[str]:
        """
        2-stage PDF extraction pipeline:

        Stage 1 — Standard extraction (PyMuPDF4LLM → PyPDF2 → raw PyMuPDF).
                   Fast path for digital/text-layer PDFs.

        Stage 2 — OCR, triggered when Stage 1 yields < MIN_TEXT_CHARS:
            2a — Azure Computer Vision Read API  (preferred, cloud-based)
            2b — Tesseract + pdf2image           (local fallback)

        Raises ValueError if all stages fail — never silently returns garbage.
        """
        # ── Stage 1: Standard text extraction ─────────────────────────────────
        text = FileParser._try_primary_extraction(file_path)

        if text and len(text.strip()) >= FileParser.MIN_TEXT_CHARS:
            logger.info(
                f"[FileParser] Digital PDF: primary extraction succeeded "
                f"({len(text)} chars). Azure OCR not needed."
            )
            return text

        # Stage 1 yielded nothing or too little — this is a scanned PDF
        char_count = len(text.strip()) if text else 0
        logger.warning(
            f"[FileParser] Primary extraction yielded only {char_count} chars "
            f"(< {FileParser.MIN_TEXT_CHARS}). PDF appears to be scanned. "
            f"Escalating to OCR..."
        )

        # ── Stage 2a: Azure Computer Vision OCR ───────────────────────────────
        azure_text = FileParser._try_azure_ocr_sync(file_path)
        if azure_text and len(azure_text.strip()) >= FileParser.MIN_TEXT_CHARS:
            return azure_text

        if azure_text is not None:
            # Azure ran but returned too little — log and continue to Tesseract
            logger.warning(
                f"[FileParser] Azure OCR returned only {len(azure_text.strip())} chars "
                f"— trying Tesseract fallback"
            )

        # ── Stage 2b: Tesseract local OCR fallback ─────────────────────────────
        ocr_text = FileParser._try_tesseract_ocr(file_path)
        if ocr_text and len(ocr_text.strip()) >= FileParser.MIN_TEXT_CHARS:
            return ocr_text

        # ── All stages exhausted ───────────────────────────────────────────────
        best_text = azure_text or ocr_text or text
        final_count = len(best_text.strip()) if best_text else 0
        raise ValueError(
            f"Complete PDF extraction failure: all methods (PyMuPDF, PyPDF2, "
            f"Azure OCR, Tesseract) yielded only {final_count} chars. "
            "The file may be encrypted, corrupt, or a scanned image with no "
            "readable text."
        )

    # ──────────────────────────────────────────────────────────────────────────
    # Image extraction — always OCR
    # ──────────────────────────────────────────────────────────────────────────

    @staticmethod
    def _extract_image(file_path: str) -> Optional[str]:
        """
        Extract text from image files using OCR.

        Primary:  Azure Computer Vision Read API
        Fallback: Tesseract via PIL (if Azure not configured)

        Supported: jpg, jpeg, png, bmp, tiff, tif, gif, webp
        """
        _, ext = os.path.splitext(file_path)
        logger.info(
            f"[FileParser] Image file detected ({ext.lower()}) — routing to OCR"
        )

        # ── Primary: Azure Computer Vision ────────────────────────────────────
        azure_text = FileParser._try_azure_ocr_sync(file_path)
        if azure_text and len(azure_text.strip()) >= FileParser.MIN_IMAGE_CHARS:
            return azure_text

        if azure_text is not None:
            logger.warning(
                f"[FileParser] Azure OCR returned only {len(azure_text.strip())} chars "
                f"on image — trying Tesseract fallback"
            )

        # ── Fallback: Tesseract via PIL ────────────────────────────────────────
        tesseract_text = FileParser._try_tesseract_image(file_path)
        if tesseract_text and len(tesseract_text.strip()) >= FileParser.MIN_IMAGE_CHARS:
            return tesseract_text

        # ── Both failed ────────────────────────────────────────────────────────
        best = azure_text or tesseract_text
        char_count = len(best.strip()) if best else 0

        if azure_text is None and tesseract_text is None:
            # Azure not configured and Tesseract not available
            raise ValueError(
                f"Image OCR unavailable: neither Azure CV (AZURE_CV_KEY not set) "
                "nor Tesseract is configured. Cannot extract text from image files."
            )

        raise ValueError(
            f"Image OCR produced insufficient text ({char_count} chars). "
            "The image may contain no readable text, or text may be too small/blurry."
        )

    # ──────────────────────────────────────────────────────────────────────────
    # OCR engines
    # ──────────────────────────────────────────────────────────────────────────

    @staticmethod
    def _try_azure_ocr_sync(file_path: str) -> Optional[str]:
        """
        Synchronous wrapper for Azure Computer Vision OCR.

        Calls the async AzureOCRService via asyncio.run(), which is safe here
        because this method is always called from a run_in_executor thread
        (i.e., not the main asyncio event loop thread — no loop conflict).

        Returns:
            Extracted text string, or None if Azure is not configured / any failure.
        """
        try:
            from utils.azure_ocr_service import get_azure_ocr_service

            service = get_azure_ocr_service()
            if service is None:
                # Azure not configured — caller will try Tesseract instead
                logger.debug(
                    "[FileParser] Azure CV not configured — skipping Azure OCR"
                )
                return None

            logger.info(f"[FileParser] Calling Azure CV Read API for: {file_path}")
            # asyncio.run() creates a fresh event loop in this executor thread
            result = asyncio.run(service.extract_text(file_path))
            return result

        except RuntimeError as e:
            # asyncio.run() failed — should not happen in executor thread
            logger.error(f"[FileParser] Azure OCR asyncio error: {e}")
            return None
        except Exception as e:
            logger.error(f"[FileParser] Azure OCR call failed: {e}")
            return None

    @staticmethod
    def _try_tesseract_ocr(file_path: str) -> Optional[str]:
        """
        OCR fallback for PDFs using pdf2image + pytesseract (local Tesseract).

        Requires: poppler-utils (OS) + pytesseract + tesseract (OS)
        Returns extracted text or None if dependencies are missing.

        Raises ValueError if Tesseract runs but yields < 200 chars (explicit failure).
        """
        try:
            from pdf2image import convert_from_path
            import pytesseract

            logger.info("[FileParser] Trying Tesseract OCR (pdf2image + pytesseract)...")
            images = convert_from_path(file_path)
            pages_text = [pytesseract.image_to_string(img) for img in images]
            text = "\n\n".join(t for t in pages_text if t.strip())

            if not text or len(text.strip()) < FileParser.MIN_TEXT_CHARS:
                char_count = len(text.strip()) if text else 0
                raise ValueError(
                    f"Tesseract OCR produced insufficient text ({char_count} chars). "
                    "The file may be a low-quality scan or an image with no readable text."
                )

            logger.info(
                f"[FileParser] Tesseract succeeded: {len(text)} chars "
                f"from {len(images)} pages"
            )
            return text.strip()

        except (ImportError, FileNotFoundError) as e:
            logger.warning(
                f"[FileParser] Tesseract/Poppler not installed — local OCR unavailable: {e}"
            )
            return None
        except ValueError:
            raise  # Re-raise explicit "insufficient text" error
        except Exception as e:
            logger.error(f"[FileParser] Tesseract OCR failed: {e}")
            return None

    @staticmethod
    def _try_tesseract_image(file_path: str) -> Optional[str]:
        """
        Direct image OCR using Tesseract + PIL (no pdf2image needed).
        Used for .jpg, .png, .bmp, .tiff, .gif, .webp files.

        Returns extracted text or None if Tesseract is not available.
        """
        try:
            import pytesseract
            from PIL import Image

            logger.info(f"[FileParser] Trying Tesseract image OCR for: {file_path}")
            img = Image.open(file_path)
            text = pytesseract.image_to_string(img)

            if text and text.strip():
                logger.info(
                    f"[FileParser] Tesseract image OCR: {len(text)} chars extracted"
                )
                return text.strip()

            logger.warning("[FileParser] Tesseract image OCR returned empty text")
            return None

        except ImportError as e:
            logger.warning(f"[FileParser] Tesseract/PIL not installed: {e}")
            return None
        except Exception as e:
            logger.error(f"[FileParser] Tesseract image OCR failed: {e}")
            return None

    # ──────────────────────────────────────────────────────────────────────────
    # Standard text extraction — unchanged
    # ──────────────────────────────────────────────────────────────────────────

    @staticmethod
    def _try_primary_extraction(file_path: str) -> Optional[str]:
        """
        Attempt text extraction using standard (non-OCR) methods:
        1. PyMuPDF4LLM — best for structured/digital PDFs
        2. PyPDF2      — solid fallback
        3. Raw PyMuPDF — last resort before OCR

        Returns extracted text (may be short/empty for scanned PDFs) or None.
        """
        # Method 1: PyMuPDF4LLM
        try:
            import pymupdf4llm
            logger.info("[FileParser] Trying PyMuPDF4LLM...")
            text = pymupdf4llm.to_markdown(file_path)
            if text and text.strip():
                logger.info(f"[FileParser] PyMuPDF4LLM: {len(text)} chars")
                return text.strip()
            logger.warning("[FileParser] PyMuPDF4LLM returned empty text")
        except Exception as e:
            logger.warning(f"[FileParser] PyMuPDF4LLM failed: {e}")

        # Method 2: PyPDF2
        try:
            from PyPDF2 import PdfReader
            logger.info("[FileParser] Trying PyPDF2...")
            reader = PdfReader(file_path)
            pages_text = []
            for i, page in enumerate(reader.pages):
                try:
                    page_text = page.extract_text()
                    if page_text:
                        pages_text.append(page_text)
                except Exception as page_err:
                    logger.warning(f"[FileParser] PyPDF2 page {i} failed: {page_err}")
            if pages_text:
                text = "\n\n".join(pages_text)
                logger.info(
                    f"[FileParser] PyPDF2: {len(text)} chars from {len(pages_text)} pages"
                )
                return text.strip()
            logger.warning("[FileParser] PyPDF2 extracted no text")
        except ImportError:
            logger.warning("[FileParser] PyPDF2 not installed")
        except Exception as e:
            logger.warning(f"[FileParser] PyPDF2 failed: {e}")

        # Method 3: Raw PyMuPDF/fitz
        try:
            import fitz
            logger.info("[FileParser] Trying raw PyMuPDF...")
            doc = fitz.open(file_path)
            pages_text = []
            for i, page in enumerate(doc):
                try:
                    page_text = page.get_text()
                    if page_text:
                        pages_text.append(page_text)
                except Exception as page_err:
                    logger.warning(f"[FileParser] PyMuPDF page {i} failed: {page_err}")
            doc.close()
            if pages_text:
                text = "\n\n".join(pages_text)
                logger.info(
                    f"[FileParser] Raw PyMuPDF: {len(text)} chars from {len(pages_text)} pages"
                )
                return text.strip()
            logger.warning("[FileParser] Raw PyMuPDF extracted no text")
        except Exception as e:
            logger.warning(f"[FileParser] Raw PyMuPDF failed: {e}")

        return None

    # ──────────────────────────────────────────────────────────────────────────
    # Text-based file formats
    # ──────────────────────────────────────────────────────────────────────────

    @staticmethod
    def _extract_docx(file_path: str) -> Optional[str]:
        """Extract text from DOCX files."""
        try:
            from docx import Document
            doc = Document(file_path)
            text = "\n".join([p.text for p in doc.paragraphs])
            logger.info(f"[FileParser] DOCX extracted: {len(text)} chars")
            return text.strip() if text.strip() else None
        except Exception as e:
            logger.error(f"[FileParser] DOCX extraction failed: {e}")
            return None

    @staticmethod
    def _extract_txt(file_path: str) -> Optional[str]:
        """Extract text from TXT files with encoding auto-detection."""
        encodings = ["utf-8", "latin-1", "cp1252", "iso-8859-1"]
        for encoding in encodings:
            try:
                with open(file_path, "r", encoding=encoding) as f:
                    text = f.read().strip()
                    if text:
                        logger.info(
                            f"[FileParser] TXT extracted ({encoding}): {len(text)} chars"
                        )
                        return text
            except UnicodeDecodeError:
                continue
            except Exception as e:
                logger.error(f"[FileParser] TXT extraction failed: {e}")
                return None
        logger.error("[FileParser] TXT extraction failed — all encodings tried")
        return None

    @staticmethod
    def _extract_html(file_path: str) -> Optional[str]:
        """Extract visible text from HTML files."""
        try:
            from bs4 import BeautifulSoup
            with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
                soup = BeautifulSoup(f.read(), "html.parser")
                text = soup.get_text().strip()
                logger.info(f"[FileParser] HTML extracted: {len(text)} chars")
                return text if text else None
        except Exception as e:
            logger.error(f"[FileParser] HTML extraction failed: {e}")
            return None

    @staticmethod
    def _extract_markdown(file_path: str) -> Optional[str]:
        """Extract text from Markdown files (strips markup)."""
        try:
            import markdown
            from bs4 import BeautifulSoup
            with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
                md_text = f.read()
                html = markdown.markdown(md_text)
                soup = BeautifulSoup(html, "html.parser")
                text = soup.get_text().strip()
                logger.info(f"[FileParser] Markdown extracted: {len(text)} chars")
                return text if text else None
        except Exception as e:
            logger.error(f"[FileParser] Markdown extraction failed: {e}")
            return None
