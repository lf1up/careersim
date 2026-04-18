"""FastAPI production API — stateless, message-based."""

from .app import create_api_app

__all__ = ["create_api_app"]
