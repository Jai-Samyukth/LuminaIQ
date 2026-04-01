"""
General API Rate Limiter

A process-singleton asyncio semaphore that gates LLM-heavy general API operations
(chat, quiz, notes generation, knowledge graph, etc.).

Cap: settings.MAX_CONCURRENT_GENERAL (default 40)
Behaviour: extra requests do NOT fail — they wait in the asyncio queue until a
slot opens. This is non-blocking from the caller's perspective (async/await).

Usage:
    from utils.general_limiter import get_general_semaphore

    async def my_handler():
        async with get_general_semaphore():
            result = await expensive_llm_call(...)
        return result

Or use the decorator:
    from utils.general_limiter import rate_limited

    @rate_limited
    async def my_endpoint_handler():
        ...
"""

import asyncio
import functools
from typing import Optional, Callable, TypeVar, Coroutine, Any
from utils.logger import logger

_general_semaphore: Optional[asyncio.Semaphore] = None
F = TypeVar("F")


def get_general_semaphore() -> asyncio.Semaphore:
    """
    Returns the process-singleton general concurrency semaphore.
    Limit is read from settings.MAX_CONCURRENT_GENERAL.
    """
    global _general_semaphore
    if _general_semaphore is None:
        try:
            from config.settings import settings
            limit = settings.MAX_CONCURRENT_GENERAL
        except Exception:
            limit = 40  # safe fallback

        _general_semaphore = asyncio.Semaphore(limit)
        logger.info(f"[GeneralLimiter] Initialized with limit={limit}")

    return _general_semaphore


def rate_limited(func: Callable) -> Callable:
    """
    Decorator: wraps an async function with the general semaphore.

    Example:
        @rate_limited
        async def generate_quiz(...):
            ...
    """
    @functools.wraps(func)
    async def wrapper(*args, **kwargs):
        semaphore = get_general_semaphore()
        async with semaphore:
            return await func(*args, **kwargs)
    return wrapper
