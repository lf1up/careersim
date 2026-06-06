"""Live caption publisher for voice mode.

Publishes interim and final transcripts on a LiveKit data channel so
the web client can render captions without re-doing STT. Falls back
to a no-op publisher when LiveKit isn't available (unit tests, smoke
script in dry-run mode), keeping the pipeline import-safe.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from typing import Any, Optional, Protocol

logger = logging.getLogger(__name__)


@dataclass
class Caption:
    """One caption frame published on the data channel."""
    role: str  # "user" | "ai"
    text: str
    is_final: bool = False
    confidence: Optional[float] = None


class CaptionPublisher(Protocol):
    """Tiny Protocol so tests don't need a LiveKit room."""

    async def publish(self, caption: Caption) -> None: ...
    async def publish_control(self, payload: dict[str, Any]) -> None: ...
    async def aclose(self) -> None: ...


class LiveKitCaptionPublisher:
    """Publishes captions on a LiveKit room data channel.

    Each caption is JSON-encoded and sent on a topic the web client
    subscribes to via ``useDataChannel``. We use ``RELIABLE`` because
    captions are small and we'd rather drop a frame than show
    out-of-order text.
    """

    TOPIC = "voice-captions"
    # Out-of-band control messages (e.g. quota warning / cutoff) ride a
    # separate topic so the client can dispatch them without parsing
    # them as captions.
    CONTROL_TOPIC = "voice-control"

    def __init__(self, room: Any) -> None:
        self._room = room

    async def publish(self, caption: Caption) -> None:
        try:
            payload = json.dumps({
                "role": caption.role,
                "text": caption.text,
                "is_final": caption.is_final,
                "confidence": caption.confidence,
            }).encode("utf-8")
            await self._room.local_participant.publish_data(
                payload,
                topic=self.TOPIC,
                # RELIABLE -> retransmit on packet loss; latency stays
                # well under the human eye's caption-perception budget.
                reliable=True,
            )
        except Exception:
            logger.exception("failed to publish caption")

    async def publish_control(self, payload: dict[str, Any]) -> None:
        """Publish a control event (quota warning / exhaustion) to the client."""
        try:
            data = json.dumps(payload).encode("utf-8")
            await self._room.local_participant.publish_data(
                data,
                topic=self.CONTROL_TOPIC,
                reliable=True,
            )
        except Exception:
            logger.exception("failed to publish control event")

    async def aclose(self) -> None:  # pragma: no cover - rooms manage lifetime
        return None


class NullCaptionPublisher:
    """No-op publisher used in tests / smoke / dry-run scenarios."""

    async def publish(self, caption: Caption) -> None:
        logger.debug("caption(null): role=%s text=%r final=%s", caption.role, caption.text, caption.is_final)

    async def publish_control(self, payload: dict[str, Any]) -> None:
        logger.debug("control(null): %r", payload)

    async def aclose(self) -> None:
        return None
