import asyncio
import logging
from typing import AsyncIterator

import anthropic

from .base import LLMProvider
from src.config import settings

logger = logging.getLogger(__name__)

# Retry configuration
MAX_RETRIES = 3
RETRY_BASE_DELAY = 1.0  # seconds


class AnthropicProvider(LLMProvider):
    """LLM provider backed by Anthropic's Claude API."""

    MODEL = "claude-sonnet-4-6"
    MAX_TOKENS = 4096

    def __init__(self) -> None:
        if not settings.ANTHROPIC_API_KEY:
            raise ValueError("ANTHROPIC_API_KEY is required for the Anthropic provider")
        self._client = anthropic.AsyncAnthropic(api_key=settings.ANTHROPIC_API_KEY)

    async def stream_chat(
        self,
        messages: list[dict],
        system: str = "",
    ) -> AsyncIterator[str]:
        """
        Stream tokens from Claude using the Messages Streaming API.
        Retries on rate-limit errors with exponential back-off.
        """
        for attempt in range(MAX_RETRIES):
            try:
                async with self._client.messages.stream(
                    model=self.MODEL,
                    max_tokens=self.MAX_TOKENS,
                    system=system or anthropic.NOT_GIVEN,
                    messages=messages,  # type: ignore[arg-type]
                ) as stream:
                    async for text in stream.text_stream:
                        yield text
                return
            except anthropic.RateLimitError as exc:
                if attempt == MAX_RETRIES - 1:
                    raise
                delay = RETRY_BASE_DELAY * (2 ** attempt)
                logger.warning(
                    "Anthropic rate limit hit (attempt %d/%d), retrying in %.1fs: %s",
                    attempt + 1,
                    MAX_RETRIES,
                    delay,
                    exc,
                )
                await asyncio.sleep(delay)
            except anthropic.APIStatusError as exc:
                logger.error("Anthropic API error: %s", exc)
                raise

    async def complete(
        self,
        messages: list[dict],
        system: str = "",
    ) -> str:
        """Return a full (non-streaming) response from Claude."""
        for attempt in range(MAX_RETRIES):
            try:
                kwargs: dict = {
                    "model": self.MODEL,
                    "max_tokens": self.MAX_TOKENS,
                    "messages": messages,
                }
                if system:
                    kwargs["system"] = system

                response = await self._client.messages.create(**kwargs)
                # Extract text from the first content block
                for block in response.content:
                    if hasattr(block, "text"):
                        return block.text
                return ""
            except anthropic.RateLimitError as exc:
                if attempt == MAX_RETRIES - 1:
                    raise
                delay = RETRY_BASE_DELAY * (2 ** attempt)
                logger.warning(
                    "Anthropic rate limit hit (attempt %d/%d), retrying in %.1fs",
                    attempt + 1,
                    MAX_RETRIES,
                    delay,
                )
                await asyncio.sleep(delay)
            except anthropic.APIStatusError as exc:
                logger.error("Anthropic API error during complete(): %s", exc)
                raise

        return ""
