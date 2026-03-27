from .base import LLMProvider
from src.config import settings


def get_provider() -> LLMProvider:
    """
    Return the configured LLM provider instance.

    Reads settings.AI_PROVIDER (default 'anthropic') and instantiates the
    appropriate concrete implementation.

    Raises:
        ValueError: If the configured provider is unknown or missing required keys.
    """
    provider_name = settings.AI_PROVIDER.lower()

    if provider_name == "anthropic":
        from .anthropic_provider import AnthropicProvider
        return AnthropicProvider()

    if provider_name == "openai":
        from .openai_provider import OpenAIProvider
        return OpenAIProvider()

    raise ValueError(
        f"Unknown AI_PROVIDER '{provider_name}'. Supported values: 'anthropic', 'openai'."
    )
