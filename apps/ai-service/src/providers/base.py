from abc import ABC, abstractmethod
from typing import AsyncIterator


class LLMProvider(ABC):
    """Abstract base class for LLM provider implementations."""

    @abstractmethod
    async def stream_chat(
        self,
        messages: list[dict],
        system: str = "",
    ) -> AsyncIterator[str]:
        """
        Stream a chat completion, yielding text delta strings as they arrive.

        Args:
            messages: List of message dicts with 'role' and 'content' keys.
                      Role is one of 'user' | 'assistant'.
            system:   System prompt string.

        Yields:
            str: Incremental text tokens as they are produced.
        """
        # Required to make the abstract method a generator signature
        # Subclasses override this with an async generator.
        raise NotImplementedError
        yield  # make the type-checker happy that this is an async generator

    @abstractmethod
    async def complete(
        self,
        messages: list[dict],
        system: str = "",
    ) -> str:
        """
        Perform a non-streaming chat completion and return the full response.

        Args:
            messages: List of message dicts with 'role' and 'content' keys.
            system:   System prompt string.

        Returns:
            str: The complete assistant response text.
        """
        ...
