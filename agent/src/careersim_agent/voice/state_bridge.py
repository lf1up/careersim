"""HTTP bridge between the voice worker and the API service.

The voice worker is stateless w.r.t. the database — it never opens a
direct connection. Instead it uses the API's internal-only endpoints
(authenticated via the existing ``X-Internal-Key`` shared secret)
to:

1. Pull the freshest ``state_snapshot`` for a session right before
   the call begins (``GET /internal/sessions/:id/state-for-voice``).
2. Push every completed turn back through the user-facing
   ``POST /sessions/:id/messages`` flow so goal eval, sentiment /
   emotion, nudges, etc. all run unchanged.

Keeping persistence funneled through the API also means the
per-user voice quota can be debited atomically alongside the new
messages, without the worker needing to know SQL.
"""

from __future__ import annotations

import logging
from typing import Any, Optional

import httpx

from ..config import get_settings

logger = logging.getLogger(__name__)


class APIClient:
    """Async HTTP client targeting the internal API surface.

    A single instance is shared across all sessions handled by one
    voice worker process. Connection pooling is left to httpx's
    defaults (good for 100s of concurrent sessions on one worker).
    """

    def __init__(
        self,
        base_url: str,
        internal_key: str,
        *,
        timeout: float = 30.0,
    ) -> None:
        self._base_url = base_url.rstrip("/")
        self._internal_key = internal_key
        self._timeout = timeout
        self._client: Optional[httpx.AsyncClient] = None

    @classmethod
    def from_env(cls) -> "APIClient":
        """Construct a client using the agent's existing settings.

        ``AGENT_INTERNAL_KEY`` doubles as the shared secret here —
        same value the API already trusts for graph-call auth.
        ``API_BASE_URL`` is currently inferred from the docker-compose
        service name; expose an override env later if the worker needs
        to talk to a remote API.
        """
        settings = get_settings()
        # Resolved against the in-compose hostname by default. Workers
        # outside compose set VOICE_API_BASE_URL via .env (we read it
        # here directly to avoid bloating Settings for one knob).
        import os
        base = os.environ.get("VOICE_API_BASE_URL", "http://api:8000")
        return cls(base_url=base, internal_key=settings.agent_internal_key)

    async def _ensure_client(self) -> httpx.AsyncClient:
        if self._client is None:
            self._client = httpx.AsyncClient(
                timeout=self._timeout,
                headers={"X-Internal-Key": self._internal_key},
            )
        return self._client

    async def aclose(self) -> None:
        if self._client is not None:
            await self._client.aclose()
            self._client = None

    # -- Endpoints --------------------------------------------------------

    async def fetch_state_for_voice(
        self,
        session_id: str,
    ) -> dict[str, Any]:
        """Pull the wire-format state snapshot for a voice call."""
        client = await self._ensure_client()
        url = f"{self._base_url}/internal/sessions/{session_id}/state-for-voice"
        resp = await client.get(url)
        if resp.status_code != 200:
            raise RuntimeError(
                f"state-for-voice fetch failed for {session_id}: "
                f"{resp.status_code} {resp.text[:200]}"
            )
        return resp.json()

    async def post_user_message(
        self,
        session_id: str,
        user_text: str,
        *,
        bearer_token: str,
    ) -> dict[str, Any]:
        """Persist a user turn via the public messages endpoint.

        Voice turns are user-initiated, so we use the user's bearer
        token (forwarded from the web client at call-start time) so
        the existing ownership + rate-limit policies in
        ``api/src/modules/sessions/sessions.route.ts`` apply
        unchanged.
        """
        client = await self._ensure_client()
        url = f"{self._base_url}/sessions/{session_id}/messages"
        resp = await client.post(
            url,
            json={"content": user_text},
            headers={"Authorization": f"Bearer {bearer_token}"},
        )
        if resp.status_code >= 400:
            raise RuntimeError(
                f"post user message failed for {session_id}: "
                f"{resp.status_code} {resp.text[:200]}"
            )
        return resp.json()

    async def report_call_end(
        self,
        session_id: str,
        seconds_used: int,
        *,
        bearer_token: str,
        voice_analysis: Optional[dict[str, Any]] = None,
    ) -> None:
        """Notify the API that a voice call ended; debits quota.

        ``voice_analysis`` is an optional aggregate payload (the
        ``VoiceSignals`` produced by ``LangGraphAdapter.finalize_voice_analysis``).
        When provided, the API merges it into the session's
        ``state_snapshot.analysis.voice`` so the post-session feedback
        view can render pacing / fillers / latency without re-running
        any analytics on the worker.
        """
        client = await self._ensure_client()
        url = f"{self._base_url}/sessions/{session_id}/voice/end"
        body: dict[str, Any] = {"seconds_used": seconds_used}
        if voice_analysis:
            body["voice_analysis"] = voice_analysis
        try:
            await client.post(
                url,
                json=body,
                headers={"Authorization": f"Bearer {bearer_token}"},
            )
        except httpx.HTTPError:  # best-effort; we logged the call
            logger.exception("voice/end notification failed for %s", session_id)
