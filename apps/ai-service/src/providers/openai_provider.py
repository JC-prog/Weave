import logging
from typing import AsyncIterator

import openai
from openai import AsyncOpenAI

from .base import LLMProvider
from src.config import settings

logger = logging.getLogger(__name__)


class OpenAIProvider(LLMProvider):
    """LLM provider backed by OpenAI's GPT-4o API."""

    MODEL = "gpt-4o"
    MAX_TOKENS = 4096

    def __init__(self) -> None:
        if not settings.OPENAI_API_KEY:
            raise ValueError("OPENAI_API_KEY is required for the OpenAI provider")
        self._client = AsyncOpenAI(api_key=settings.OPENAI_API_KEY)

    async def stream_chat(
        self,
        messages: list[dict],
        system: str = "",
    ) -> AsyncIterator[str]:
        """
        Stream tokens from GPT-4o using the Chat Completions streaming API.
        Yields each text delta as it arrives.
        """
        # Prepend the system message if provided
        full_messages: list[dict] = []
        if system:
            full_messages.append({"role": "system", "content": system})
        full_messages.extend(messages)

        try:
            stream = await self._client.chat.completions.create(
                model=self.MODEL,
                max_tokens=self.MAX_TOKENS,
                messages=full_messages,  # type: ignore[arg-type]
                stream=True,
            )
            async for chunk in stream:
                delta = chunk.choices[0].delta if chunk.choices else None
                if delta and delta.content:
                    yield delta.content
        except openai.RateLimitError as exc:
            logger.error("OpenAI rate limit error: %s", exc)
            raise
        except openai.APIStatusError as exc:
            logger.error("OpenAI API error: %s", exc)
            raise

    async def complete(
        self,
        messages: list[dict],
        system: str = "",
    ) -> str:
        """Return a full (non-streaming) response from GPT-4o."""
        full_messages: list[dict] = []
        if system:
            full_messages.append({"role": "system", "content": system})
        full_messages.extend(messages)

        try:
            response = await self._client.chat.completions.create(
                model=self.MODEL,
                max_tokens=self.MAX_TOKENS,
                messages=full_messages,  # type: ignore[arg-type]
                stream=False,
            )
            content = response.choices[0].message.content if response.choices else ""
            return content or ""
        except openai.RateLimitError as exc:
            logger.error("OpenAI rate limit error: %s", exc)
            raise
        except openai.APIStatusError as exc:
            logger.error("OpenAI API error during complete(): %s", exc)
            raise
