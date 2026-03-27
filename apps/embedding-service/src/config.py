from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    REDIS_URL: str = "redis://redis:6379"
    QDRANT_URL: str = "http://qdrant:6333"

    # fastembed model name
    EMBEDDING_MODEL: str = "BAAI/bge-small-en-v1.5"

    # Chunking defaults
    CHUNK_SIZE: int = 512
    CHUNK_OVERLAP: int = 50

    # Qdrant collection name for notes
    NOTES_COLLECTION: str = "notes"

    # CORS
    CORS_ORIGINS: list[str] = ["*"]


settings = Settings()
