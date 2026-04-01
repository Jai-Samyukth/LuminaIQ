"""
Azure Computer Vision — Read API (v3.2) OCR Service

Replaces the Tesseract/poppler local OCR fallback with Microsoft Azure's
cloud OCR for superior accuracy on:
  - Scanned PDFs (triggered automatically when PyMuPDF extracts < 200 chars)
  - Image files (.jpg, .png, .bmp, .tiff, .gif, .webp)
  - Handwritten text and mixed-language documents

API Flow:
  1. POST {endpoint}/vision/v3.2/read/analyze  (Content-Type: application/octet-stream)
     → 202 Accepted, Operation-Location header
  2. GET {operation_location}  (poll every 2s until status = "succeeded" | "failed")
  3. Parse analyzeResult.readResults[].lines[].text → join into plain text

Supported formats: JPEG, PNG, BMP, PDF, TIFF  (up to 50 MB, 2000 pages)
"""

import asyncio
import aiohttp
from typing import Optional
from utils.logger import logger


class AzureOCRService:
    """
    Async Azure Computer Vision Read API client.

    Usage (from a sync context, e.g., run_in_executor thread):
        asyncio.run(service.extract_text(file_path))

    Usage (from an async context):
        text = await service.extract_text(file_path)
    """

    READ_API_PATH = "vision/v3.2/read/analyze"
    POLL_INTERVAL_S = 2.0    # seconds between status polls
    MAX_POLL_TIME_S = 180.0  # max wait before timeout (3 minutes)
    SUBMIT_TIMEOUT_S = 60    # timeout for the initial POST
    POLL_TIMEOUT_S = 30      # timeout per GET poll request

    def __init__(self, endpoint: str, key: str):
        # Normalize: remove trailing slash so URL joins work cleanly
        self.endpoint = endpoint.rstrip("/")
        self.key = key
        self.analyze_url = f"{self.endpoint}/{self.READ_API_PATH}"

    # ──────────────────────────────────────────────────────────────────────────
    # Public API
    # ──────────────────────────────────────────────────────────────────────────

    async def extract_text(self, file_path: str) -> Optional[str]:
        """
        Full OCR pipeline: submit → poll → parse.

        Args:
            file_path: Absolute or relative path to the file to OCR.

        Returns:
            Extracted text as a plain string, or None on any failure.
        """
        try:
            with open(file_path, "rb") as fh:
                file_bytes = fh.read()

            file_size_mb = len(file_bytes) / (1024 * 1024)
            logger.info(
                f"[AzureOCR] Submitting {file_size_mb:.2f} MB to Azure CV Read API "
                f"({self.analyze_url})"
            )

            # Step 1 — Submit
            operation_location = await self._submit_file(file_bytes)
            if not operation_location:
                return None

            # Step 2 — Poll
            return await self._poll_result(operation_location)

        except FileNotFoundError:
            logger.error(f"[AzureOCR] File not found: {file_path}")
            return None
        except PermissionError:
            logger.error(f"[AzureOCR] Permission denied reading: {file_path}")
            return None
        except Exception as e:
            logger.error(f"[AzureOCR] Unexpected error for {file_path}: {e}")
            import traceback
            logger.error(f"[AzureOCR] {traceback.format_exc()}")
            return None

    # ──────────────────────────────────────────────────────────────────────────
    # Internal — Submit
    # ──────────────────────────────────────────────────────────────────────────

    async def _submit_file(self, file_bytes: bytes) -> Optional[str]:
        """
        POST raw file bytes to the Read API.

        Returns:
            The Operation-Location URL to poll, or None on failure.
        """
        headers = {
            "Ocp-Apim-Subscription-Key": self.key,
            "Content-Type": "application/octet-stream",
        }

        try:
            async with aiohttp.ClientSession() as session:
                async with session.post(
                    self.analyze_url,
                    headers=headers,
                    data=file_bytes,
                    timeout=aiohttp.ClientTimeout(total=self.SUBMIT_TIMEOUT_S),
                ) as resp:
                    if resp.status == 202:
                        op_location = resp.headers.get("Operation-Location", "")
                        if op_location:
                            logger.info(
                                f"[AzureOCR] Job accepted. Operation: {op_location}"
                            )
                            return op_location
                        logger.error(
                            "[AzureOCR] 202 received but Operation-Location header is missing"
                        )
                        return None

                    # Non-202 response
                    body = await resp.text()
                    logger.error(
                        f"[AzureOCR] Submit failed [{resp.status}]: {body[:500]}"
                    )
                    return None

        except aiohttp.ClientResponseError as e:
            logger.error(f"[AzureOCR] HTTP error during submit: {e.status} {e.message}")
            return None
        except aiohttp.ClientConnectionError as e:
            logger.error(f"[AzureOCR] Connection error during submit: {e}")
            return None
        except asyncio.TimeoutError:
            logger.error(
                f"[AzureOCR] Submit timed out after {self.SUBMIT_TIMEOUT_S}s"
            )
            return None

    # ──────────────────────────────────────────────────────────────────────────
    # Internal — Poll
    # ──────────────────────────────────────────────────────────────────────────

    async def _poll_result(self, operation_location: str) -> Optional[str]:
        """
        Poll the operation URL until the job succeeds or fails.

        Returns:
            Extracted text on success, None on failure or timeout.
        """
        headers = {"Ocp-Apim-Subscription-Key": self.key}
        elapsed = 0.0

        logger.info(
            f"[AzureOCR] Polling (max {self.MAX_POLL_TIME_S:.0f}s, every {self.POLL_INTERVAL_S:.0f}s)..."
        )

        async with aiohttp.ClientSession() as session:
            while elapsed < self.MAX_POLL_TIME_S:
                await asyncio.sleep(self.POLL_INTERVAL_S)
                elapsed += self.POLL_INTERVAL_S

                try:
                    async with session.get(
                        operation_location,
                        headers=headers,
                        timeout=aiohttp.ClientTimeout(total=self.POLL_TIMEOUT_S),
                    ) as resp:
                        if resp.status != 200:
                            logger.warning(
                                f"[AzureOCR] Poll returned [{resp.status}] — retrying"
                            )
                            continue

                        data = await resp.json()
                        status = data.get("status", "unknown")

                        if status == "succeeded":
                            logger.info(
                                f"[AzureOCR] Job succeeded after ~{elapsed:.0f}s"
                            )
                            return self._parse_result(data)

                        elif status == "failed":
                            errors = (
                                data.get("analyzeResult", {})
                                .get("errors", [])
                            )
                            logger.error(f"[AzureOCR] Job failed: {errors}")
                            return None

                        elif status in ("running", "notStarted"):
                            logger.debug(
                                f"[AzureOCR] Status={status} ({elapsed:.0f}s elapsed)"
                            )

                        else:
                            logger.warning(f"[AzureOCR] Unknown status: {status!r}")

                except asyncio.TimeoutError:
                    logger.warning(
                        f"[AzureOCR] Poll request timed out at {elapsed:.0f}s — retrying"
                    )
                    continue
                except aiohttp.ClientError as e:
                    logger.warning(f"[AzureOCR] Poll connection error: {e} — retrying")
                    continue

        logger.error(
            f"[AzureOCR] Timed out waiting for result after {self.MAX_POLL_TIME_S:.0f}s"
        )
        return None

    # ──────────────────────────────────────────────────────────────────────────
    # Internal — Parse JSON result
    # ──────────────────────────────────────────────────────────────────────────

    def _parse_result(self, data: dict) -> Optional[str]:
        """
        Convert the Azure CV Read API JSON result into plain text.

        Structure:
            data.analyzeResult.readResults[]   ← one entry per page
              .lines[]                         ← one entry per text line
                .text                          ← the full line text (pre-joined by Azure)
                .words[]                       ← individual word tokens (confidence, bbox)

        Strategy: use line.text directly (it's the clean concat of words).
        Skip blank lines. Join lines with \\n, pages with \\n\\n.
        """
        try:
            analyze_result = data.get("analyzeResult", {})
            read_results = analyze_result.get("readResults", [])

            if not read_results:
                logger.warning("[AzureOCR] No readResults in API response")
                return None

            pages_text = []
            total_lines = 0

            for page_idx, page in enumerate(read_results):
                lines = page.get("lines", [])
                page_lines = []

                for line in lines:
                    line_text = line.get("text", "").strip()
                    if line_text:
                        page_lines.append(line_text)

                if page_lines:
                    pages_text.append("\n".join(page_lines))
                    total_lines += len(page_lines)
                    logger.debug(
                        f"[AzureOCR] Page {page_idx + 1}: {len(page_lines)} lines"
                    )

            if not pages_text:
                logger.warning("[AzureOCR] Parsed result but found zero text lines")
                return None

            full_text = "\n\n".join(pages_text)
            logger.info(
                f"[AzureOCR] Parsed {total_lines} lines across "
                f"{len(pages_text)} page(s) → {len(full_text)} chars"
            )
            return full_text

        except Exception as e:
            logger.error(f"[AzureOCR] Failed to parse API result: {e}")
            import traceback
            logger.error(f"[AzureOCR] {traceback.format_exc()}")
            return None


# ──────────────────────────────────────────────────────────────────────────────
# Factory
# ──────────────────────────────────────────────────────────────────────────────

def get_azure_ocr_service() -> Optional[AzureOCRService]:
    """
    Return a configured AzureOCRService if credentials exist in settings.
    Returns None if AZURE_CV_ENDPOINT or AZURE_CV_KEY is not set,
    allowing callers to fall back to Tesseract gracefully.
    """
    try:
        from config.settings import settings
        if settings.AZURE_CV_ENDPOINT and settings.AZURE_CV_KEY:
            return AzureOCRService(
                endpoint=settings.AZURE_CV_ENDPOINT,
                key=settings.AZURE_CV_KEY,
            )
        logger.debug(
            "[AzureOCR] AZURE_CV_ENDPOINT or AZURE_CV_KEY not configured — Azure OCR disabled"
        )
        return None
    except Exception as e:
        logger.error(f"[AzureOCR] Failed to initialise service: {e}")
        return None
