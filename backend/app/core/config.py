"""CoThink AI 应用配置。"""
from __future__ import annotations

from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # ── 数据库 ──
    db_url: str = Field(alias="DB_URL")

    # ── Redis ──
    redis_url: str = Field(
        default="redis://localhost:6379/0", alias="REDIS_URL"
    )

    # ── JWT ──
    jwt_secret: str = Field(
        default="cothink-secret-change-me", alias="JWT_SECRET"
    )
    jwt_algorithm: str = "HS256"
    jwt_expire_minutes: int = Field(default=1440, alias="JWT_EXPIRE_MINUTES")

    # ── LLM API Keys（平台统一配置） ──
    deepseek_api_key: str = Field(default="", alias="DEEPSEEK_API_KEY")
    kimi_api_key: str = Field(default="", alias="KIMI_API_KEY")
    doubao_api_key: str = Field(default="", alias="DOUBAO_API_KEY")
    zhipu_api_key: str = Field(default="", alias="ZHIPU_API_KEY")
    tongyi_api_key: str = Field(default="", alias="TONGYI_API_KEY")
    openai_api_key: str = Field(default="", alias="OPENAI_API_KEY")
    gemini_api_key: str = Field(default="", alias="GEMINI_API_KEY")
    claude_api_key: str = Field(default="", alias="CLAUDE_API_KEY")

    # ── Embedding（云端 API） ──
    embedding_api_key: str = Field(default="", alias="EMBEDDING_API_KEY")
    embedding_base_url: str = Field(
        default="https://dashscope.aliyuncs.com/compatible-mode/v1",
        alias="EMBEDDING_BASE_URL",
    )
    embedding_model: str = Field(
        default="text-embedding-v3", alias="EMBEDDING_MODEL"
    )
    embedding_dimensions: int = Field(
        default=1024, alias="EMBEDDING_DIMENSIONS"
    )

    # ── LLM 并发与超时 ──
    llm_max_concurrency: int = Field(
        default=10, alias="LLM_MAX_CONCURRENCY"
    )
    llm_stream_timeout_s: float = Field(
        default=60.0, alias="LLM_STREAM_TIMEOUT_S"
    )
    llm_chunk_timeout_s: float = Field(
        default=10.0, alias="LLM_CHUNK_TIMEOUT_S"
    )

    # ── AI Worker 池 ──
    ai_worker_count: int = Field(default=3, alias="AI_WORKER_COUNT")
    ai_queue_stream: str = Field(
        default="ai:requests", alias="AI_QUEUE_STREAM"
    )
    ai_queue_group: str = Field(
        default="ai-workers", alias="AI_QUEUE_GROUP"
    )
    ai_queue_max_wait_s: float = Field(
        default=120.0, alias="AI_QUEUE_MAX_WAIT_S"
    )

    # ── 对话上下文 ──
    context_window_size: int = Field(
        default=10, alias="CONTEXT_WINDOW_SIZE"
    )

    # ── CORS ──
    cors_origins: str = Field(
        default="*", alias="CORS_ORIGINS",
        description="逗号分隔的 CORS 白名单，生产环境应设为具体域名",
    )


@lru_cache
def get_settings() -> Settings:
    return Settings()
