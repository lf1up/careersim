"""Configuration settings using pydantic-settings."""

from functools import lru_cache
from typing import Literal, Optional

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
    # App attribution shown in OpenRouter activity logs / rankings
    # (sent as X-Title and HTTP-Referer headers on each request).
    openai_app_name: str = "CareerSim"
    openai_app_url: str = ""
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

    # -------------------------------------------------------------------
    # Persona / simulation data from S3
    #
    # When `personas_s3_enabled` is true, the agent downloads the cast
    # (personas.json, simulations.json, avatars/, documents/) from the
    # configured bucket into the local data dir *before* any load, then
    # rewrites those files in place. Default is off so local git-backed
    # `agent/data` remains the source of truth for development.
    #
    # Credentials use the standard boto3 chain (env keys, shared config,
    # instance/task role). See `services/persona_sync.py`.
    # -------------------------------------------------------------------
    personas_s3_enabled: bool = False
    personas_s3_bucket: str = ""
    # Key prefix inside the bucket. Objects are mirrored relative to this
    # prefix into the local data dir (e.g. prefix `cast/` + key
    # `cast/personas.json` → `data/personas.json`). Trailing slash optional.
    personas_s3_prefix: str = ""
    # Optional override; empty defers to AWS_REGION / the SDK default chain.
    aws_region: str = ""

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

    # -------------------------------------------------------------------
    # Voice mode
    #
    # Browser-native WebRTC voice via a self-hosted LiveKit SFU plus a
    # chained STT -> existing LangGraph turn -> TTS pipeline. All
    # config below is read by the `agent-voice` worker (see
    # `careersim_agent.voice`); the FastAPI app and existing chat
    # surface ignore these fields entirely.
    #
    # `voice_enabled=False` is a clean kill switch: the worker logs
    # one info line and exits 0 at startup, matching the API's 503
    # behavior on the same flag.
    # -------------------------------------------------------------------
    voice_enabled: bool = False

    # LiveKit (self-hosted by default; cloud just swaps the URL + keys)
    livekit_url: str = "ws://livekit:7880"
    livekit_api_key: str = ""
    livekit_api_secret: str = ""

    # STT / TTS provider selection. Defaults are the self-hosted
    # in-process providers (faster-whisper, Piper). Cloud opt-ins are
    # gated on the corresponding API key being non-empty.
    voice_stt_provider: Literal[
        "whisper_local",
        "whisper_openai",
        "deepgram",
    ] = "whisper_local"
    voice_tts_provider: Literal[
        "piper_local",
        "openai_tts",
        "elevenlabs",
    ] = "piper_local"

    # faster-whisper (default STT) tuning. Models are prefetched into
    # the agent Docker image during build.
    voice_whisper_model: str = "base.en"
    voice_whisper_device: Literal["cpu", "cuda"] = "cpu"
    voice_whisper_compute_type: str = "int8"

    # whisper_openai (cloud STT) model. Posted to
    # `/v1/audio/transcriptions` and reuses `openai_api_key` /
    # `openai_base_url`. Defaults to OpenAI's `whisper-1`; set to a
    # provider-specific id (e.g. `openai/whisper-large-v3` on
    # OpenRouter) to match your configured base URL.
    voice_whisper_openai_model: str = "whisper-1"

    # openai_tts model. The OpenAI-compatible TTS provider (`openai_tts`)
    # adapts its request shape to the configured `openai_base_url`: real
    # OpenAI uses a bare model id, while OpenRouter needs a namespaced slug
    # (e.g. `openai/gpt-4o-mini-tts`). This value is used on the OpenRouter
    # path, where the slug must be namespaced — the OpenAI SDK's own
    # transcription multipart upload, by contrast, OpenRouter 400s on, so
    # STT handles that separately via `voice_whisper_openai_model`.
    voice_openai_tts_model: str = "openai/gpt-4o-mini-tts"

    # Piper (default TTS) tuning. Voice models live in a named volume.
    voice_piper_model_dir: str = "/app/.piper_models"
    voice_piper_default_voice: str = "en_US-libritts_r-medium"

    # Cloud provider keys (empty unless the matching provider is
    # selected). OpenAI providers reuse `openai_api_key` /
    # `openai_base_url` from the chat configuration above.
    deepgram_api_key: str = ""
    elevenlabs_api_key: str = ""

    @property
    def openai_default_headers(self) -> dict:
        """Attribution headers read by OpenRouter for activity logs / rankings.

        Only includes a header when the corresponding value is set. Safe to
        send to other OpenAI-compatible providers (unknown headers are ignored).
        """
        headers: dict = {}
        if self.openai_app_name:
            headers["X-Title"] = self.openai_app_name
        if self.openai_app_url:
            headers["HTTP-Referer"] = self.openai_app_url
        return headers

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
        if self.openai_default_headers:
            config["default_headers"] = self.openai_default_headers
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
        if self.openai_default_headers:
            config["default_headers"] = self.openai_default_headers
        return config


@lru_cache
def get_settings() -> Settings:
    """Get cached settings instance."""
    return Settings()
