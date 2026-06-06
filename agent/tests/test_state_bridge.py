"""Unit tests for the worker<->API HTTP bridge.

These pin the internal-route contract the voice worker relies on:

  * ``fetch_voice_budget`` GETs ``/internal/sessions/:id/voice-budget``
  * ``report_call_end`` POSTs the *internal* end route (NOT the
    user-facing one) and never attaches a user bearer token — the
    worker is authoritative via the ``X-Internal-Key`` shared secret.

We drive a real ``APIClient`` against an ``httpx.MockTransport`` so the
URL building, headers, and JSON body are all exercised without a live
API.
"""

from __future__ import annotations

import json

import httpx
import pytest

from careersim_agent.voice.state_bridge import APIClient


def _install_mock(api: APIClient, handler) -> None:
    """Swap in an AsyncClient backed by a mock transport.

    Mirrors the default-header wiring in ``APIClient._ensure_client`` so
    the test sees exactly the headers production would send.
    """
    api._client = httpx.AsyncClient(  # noqa: SLF001 - test seam
        transport=httpx.MockTransport(handler),
        headers={"X-Internal-Key": api._internal_key},  # noqa: SLF001
    )


@pytest.mark.asyncio
async def test_fetch_voice_budget_hits_internal_route() -> None:
    captured: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        captured.append(request)
        return httpx.Response(
            200, json={"remaining_seconds": 1200, "cap_seconds": 3600}
        )

    api = APIClient(base_url="http://api:8000", internal_key="secret-key")
    _install_mock(api, handler)
    try:
        budget = await api.fetch_voice_budget("sess-1")
    finally:
        await api.aclose()

    assert budget == {"remaining_seconds": 1200, "cap_seconds": 3600}
    assert len(captured) == 1
    req = captured[0]
    assert req.method == "GET"
    assert req.url.path == "/internal/sessions/sess-1/voice-budget"
    assert req.headers["X-Internal-Key"] == "secret-key"


@pytest.mark.asyncio
async def test_fetch_voice_budget_raises_on_non_200() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(404, text="nope")

    api = APIClient(base_url="http://api:8000", internal_key="secret-key")
    _install_mock(api, handler)
    try:
        with pytest.raises(RuntimeError):
            await api.fetch_voice_budget("missing")
    finally:
        await api.aclose()


@pytest.mark.asyncio
async def test_report_call_end_posts_internal_route_without_bearer() -> None:
    captured: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        captured.append(request)
        return httpx.Response(
            200, json={"seconds_recorded": 30, "quota_remaining_seconds": 90}
        )

    api = APIClient(base_url="http://api:8000", internal_key="secret-key")
    _install_mock(api, handler)
    try:
        await api.report_call_end(
            "sess-9", 30, voice_analysis={"user_avg_wpm": 130}
        )
    finally:
        await api.aclose()

    assert len(captured) == 1
    req = captured[0]
    assert req.method == "POST"
    assert req.url.path == "/internal/sessions/sess-9/voice/end"
    # Authoritative end is internal-key authenticated; it must NOT carry
    # a user bearer token.
    assert "authorization" not in {k.lower() for k in req.headers.keys()}
    assert req.headers["X-Internal-Key"] == "secret-key"
    body = json.loads(req.content.decode())
    assert body == {"seconds_used": 30, "voice_analysis": {"user_avg_wpm": 130}}


@pytest.mark.asyncio
async def test_report_call_end_omits_analysis_when_absent() -> None:
    captured: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        captured.append(request)
        return httpx.Response(200, json={})

    api = APIClient(base_url="http://api:8000", internal_key="k")
    _install_mock(api, handler)
    try:
        await api.report_call_end("sess-x", 5)
    finally:
        await api.aclose()

    body = json.loads(captured[0].content.decode())
    assert body == {"seconds_used": 5}
