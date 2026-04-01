"""
LLM Service — Azure OpenAI

Uses langchain_openai.AzureChatOpenAI, driven by:
    AZURE_OPENAI_API_KEY       (from .env)
    AZURE_OPENAI_ENDPOINT      (from .env)
    AZURE_OPENAI_DEPLOYMENT    (from .env, e.g. "gpt4o")
    AZURE_OPENAI_API_VERSION   (from .env, e.g. "2024-12-01-preview")

Falls back to legacy OpenAI-compatible client if Azure vars are not set.
"""

from langchain_core.messages import HumanMessage, AIMessage, SystemMessage
from config.settings import settings
from typing import List, Dict
from utils.logger import logger


def _build_client(temperature: float = 0.7, max_tokens: int = 1000):
    """
    Returns either an AzureChatOpenAI or ChatOpenAI client
    depending on which credentials are populated in settings.
    """
    if settings.AZURE_OPENAI_ENDPOINT and settings.AZURE_OPENAI_API_KEY:
        from langchain_openai import AzureChatOpenAI
        logger.debug(
            f"[LLMService] Using AzureChatOpenAI — "
            f"deployment={settings.AZURE_OPENAI_DEPLOYMENT}, "
            f"api_version={settings.AZURE_OPENAI_API_VERSION}"
        )
        return AzureChatOpenAI(
            azure_deployment=settings.AZURE_OPENAI_DEPLOYMENT,
            azure_endpoint=settings.AZURE_OPENAI_ENDPOINT,
            api_key=settings.AZURE_OPENAI_API_KEY,
            api_version=settings.AZURE_OPENAI_API_VERSION,
            temperature=temperature,
            max_tokens=max_tokens,
        )

    # Fallback: legacy OpenAI-compatible (Groq etc.)
    from langchain_openai import ChatOpenAI
    logger.warning("[LLMService] Azure vars not set — falling back to ChatOpenAI")
    return ChatOpenAI(
        model=settings.LLM_MODEL or "gpt-3.5-turbo",
        openai_api_key=settings.LLM_API_KEY,
        openai_api_base=settings.LLM_BASE_URL or None,
        temperature=temperature,
        max_tokens=max_tokens,
    )


def _convert_messages(messages: List[Dict[str, str]]):
    """Convert dict messages to LangChain message objects."""
    converted = []
    for msg in messages:
        role = msg.get("role", "user")
        content = msg.get("content", "")
        if role == "user":
            converted.append(HumanMessage(content=content))
        elif role == "assistant":
            converted.append(AIMessage(content=content))
        elif role == "system":
            converted.append(SystemMessage(content=content))
        else:
            converted.append(HumanMessage(content=content))
    return converted


class LLMService:
    def __init__(self):
        using_azure = bool(settings.AZURE_OPENAI_ENDPOINT and settings.AZURE_OPENAI_API_KEY)
        if using_azure:
            logger.info(
                f"[LLMService] Initialized with Azure OpenAI — "
                f"deployment={settings.AZURE_OPENAI_DEPLOYMENT}"
            )
        else:
            logger.warning("[LLMService] Azure OpenAI not configured — using fallback LLM.")

    def _get_client(self, temperature: float = 0.7, max_tokens: int = 1000):
        return _build_client(temperature=temperature, max_tokens=max_tokens)

    async def chat_completion(
        self,
        messages: List[Dict[str, str]],
        temperature: float = 0.7,
        max_tokens: int = 1000,
    ) -> str:
        """Generate chat completion (non-streaming)."""
        try:
            client = self._get_client(temperature=temperature, max_tokens=max_tokens)
            lc_messages = _convert_messages(messages)
            logger.info(
                f"[LLMService] Sending {len(lc_messages)} messages "
                f"(temp={temperature}, max_tokens={max_tokens})"
            )
            response = await client.ainvoke(lc_messages)
            answer = response.content if getattr(response, "content", None) else ""
            if not answer:
                logger.warning(
                    f"[LLMService] Empty response. Metadata: "
                    f"{getattr(response, 'response_metadata', 'N/A')}"
                )
            logger.info(f"[LLMService] Completion: {len(answer)} chars")
            return answer
        except Exception as e:
            logger.error(f"[LLMService] chat_completion error: {e}")
            import traceback
            logger.error(traceback.format_exc())
            raise

    async def chat_completion_stream(
        self,
        messages: List[Dict[str, str]],
        temperature: float = 0.7,
        max_tokens: int = 1000,
    ):
        """Generate streaming chat completion."""
        try:
            client = self._get_client(temperature=temperature, max_tokens=max_tokens)
            lc_messages = _convert_messages(messages)
            async for chunk in client.astream(lc_messages):
                if chunk.content:
                    yield chunk.content
        except Exception as e:
            logger.error(f"[LLMService] streaming error: {e}")
            raise


llm_service = LLMService()
