"""Configuration settings using pydantic-settings."""

from functools import lru_cache
from typing import Optional

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # OpenAI API Configuration
    openai_api_key: str = ""
    openai_base_url: Optional[str] = None
    openai_model: str = "gpt-4o-mini"
    openai_provider: str = "openai"
    openai_max_tokens: int = 1000
    openai_temperature: float = 0.7
    openai_top_p: float = 1.0
    openai_frequency_penalty: float = 0.0
    openai_presence_penalty: float = 0.0

    # Evaluation Model Configuration (optional, falls back to main model)
    openai_eval_model: Optional[str] = None
    openai_eval_provider: Optional[str] = None
    openai_eval_max_tokens: Optional[int] = None
    openai_eval_temperature: Optional[float] = None
    openai_eval_top_p: Optional[float] = None
    openai_eval_frequency_penalty: Optional[float] = None
    openai_eval_presence_penalty: Optional[float] = None

    # RAG Configuration
    rag_enabled: bool = True
    rag_embedding_model: str = "text-embedding-3-small"
    rag_chunk_size: int = 800
    rag_chunk_overlap: int = 100
    rag_top_k: int = 4
    rag_chroma_persist_dir: str = ".chroma_db"

    # Gradio Configuration
    gradio_server_port: int = 7860
    gradio_share: bool = False

    # Logging
    log_level: str = "INFO"

    # -------------------------------------------------------------------
    # Internal API authentication
    #
    # Shared secret used to authenticate the Node/Fastify API when it
    # calls into this agent service. When empty, the agent logs a
    # warning on startup and accepts requests without the header —
    # this keeps local dev, Gradio-only mode, and the pytest suite
    # working out of the box. In any real deployment this MUST be set
    # to a long random string that matches `AGENT_INTERNAL_KEY` on the
    # API side.
    # -------------------------------------------------------------------
    agent_internal_key: str = ""

    @property
    def openai_config(self) -> dict:
        """Get OpenAI configuration as a dict."""
        config = {
            "api_key": self.openai_api_key,
            "model": self.openai_model,
            "temperature": self.openai_temperature,
            "max_tokens": self.openai_max_tokens,
            "top_p": self.openai_top_p,
            "frequency_penalty": self.openai_frequency_penalty,
            "presence_penalty": self.openai_presence_penalty,
        }
        if self.openai_base_url:
            config["base_url"] = self.openai_base_url
        return config

    @property
    def openai_eval_config(self) -> dict:
        """Get OpenAI configuration for evaluation tasks."""
        config = {
            "api_key": self.openai_api_key,
            "model": self.openai_eval_model or self.openai_model,
            "max_tokens": self.openai_eval_max_tokens if self.openai_eval_max_tokens is not None else self.openai_max_tokens,
            "temperature": self.openai_eval_temperature if self.openai_eval_temperature is not None else 0.3,
            "top_p": self.openai_eval_top_p if self.openai_eval_top_p is not None else self.openai_top_p,
            "frequency_penalty": self.openai_eval_frequency_penalty if self.openai_eval_frequency_penalty is not None else 0.3,
            "presence_penalty": self.openai_eval_presence_penalty if self.openai_eval_presence_penalty is not None else 0.3,
        }
        if self.openai_base_url:
            config["base_url"] = self.openai_base_url
        return config


@lru_cache
def get_settings() -> Settings:
    """Get cached settings instance."""
    return Settings()
