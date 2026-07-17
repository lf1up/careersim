"""Tests for the voice worker entry point.

Specifically the kill-switch path (``VOICE_ENABLED=false``) which
must exit 0 cleanly so docker-compose's restart policy doesn't loop
on a disabled deployment. The actual LiveKit-bound entrypoint isn't
exercised here — that's a smoke / integration concern.
"""

from __future__ import annotations

import logging

from careersim_agent import config as config_module
from careersim_agent.voice.worker import run_worker


def _reset_settings() -> None:
    config_module.get_settings.cache_clear()


def test_kill_switch_returns_zero(monkeypatch, caplog) -> None:
    monkeypatch.setenv("VOICE_ENABLED", "false")
    _reset_settings()

    synced: list[str] = []
    monkeypatch.setattr(
        "careersim_agent.services.persona_sync.ensure_personas_synced",
        lambda: synced.append("sync"),
    )

    with caplog.at_level(logging.INFO):
        code = run_worker()

    assert code == 0
    assert synced == []
    assert any(
        "voice disabled" in r.getMessage().lower() for r in caplog.records
    )


def test_returns_nonzero_when_livekit_url_missing(monkeypatch) -> None:
    monkeypatch.setenv("VOICE_ENABLED", "true")
    monkeypatch.setenv("LIVEKIT_URL", "")
    monkeypatch.setenv("LIVEKIT_API_KEY", "k")
    monkeypatch.setenv("LIVEKIT_API_SECRET", "s")
    _reset_settings()

    synced: list[str] = []
    monkeypatch.setattr(
        "careersim_agent.services.persona_sync.ensure_personas_synced",
        lambda: synced.append("sync"),
    )

    code = run_worker()
    assert code == 2
    assert synced == ["sync"]


def test_returns_nonzero_when_livekit_key_missing(monkeypatch) -> None:
    monkeypatch.setenv("VOICE_ENABLED", "true")
    monkeypatch.setenv("LIVEKIT_URL", "ws://livekit:7880")
    monkeypatch.setenv("LIVEKIT_API_KEY", "")
    monkeypatch.setenv("LIVEKIT_API_SECRET", "")
    _reset_settings()

    code = run_worker()
    assert code == 2
