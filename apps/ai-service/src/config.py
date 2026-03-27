from typing import Optional
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # Database
    DATABASE_URL: str = "postgresql+asyncpg://postgres:postgres@postgres:5432/notebooklm"

    # Redis
    REDIS_URL: str = "redis://redis:6379"

    # AI provider credentials
    ANTHROPIC_API_KEY: Optional[str] = None
    OPENAI_API_KEY: Optional[str] = None

    # Which LLM provider to use: 'anthropic' | 'openai'
    AI_PROVIDER: str = "anthropic"

    # Downstream services
    VAULT_SERVICE_URL: str = "http://vault-service:3002"
    SEARCH_SERVICE_URL: str = "http://search-service:3004"
    EMBEDDING_SERVICE_URL: str = "http://embedding-service:3006"

    # Context window budget (in approximate tokens)
    MAX_CONTEXT_TOKENS: int = 8000

    # CORS
    CORS_ORIGINS: list[str] = ["*"]

    # JWT secret for validating incoming tokens
    JWT_ACCESS_SECRET: str = "change-me-in-production"


settings = Settings()
