"""Shared pytest configuration for the agent test suite.

The agent's `Settings` reads from `agent/.env` via pydantic-settings,
which ships with a non-empty `AGENT_INTERNAL_KEY` placeholder so
`docker compose up` wires auth end-to-end out of the box. That's the
right default for operators but the wrong one for the unit suite: the
default mode we want to test is "dev / unauthenticated" so every
existing test doesn't need to pass the header. Tests that *do* want
to exercise the enforcement path set the env var explicitly (see
`TestInternalApiKey` in `test_api.py`) and clear the settings cache.

Clearing `AGENT_INTERNAL_KEY` before any test collects or imports the
app fixes both concerns: the default suite stays simple, and the
hardened-mode tests still get a clean slate via their own monkeypatch.
"""

import os

import pytest


@pytest.fixture(autouse=True, scope="session")
def _force_unauthenticated_agent_default() -> None:
    """Run the default test suite with `AGENT_INTERNAL_KEY` unset.

    We clear both the process env (so pydantic-settings picks up the
    empty value ahead of any `Settings()` instantiation) and the
    cached settings singleton. The per-test hardened-mode fixture
    resets both again around its own cases.
    """
    os.environ["AGENT_INTERNAL_KEY"] = ""
    from careersim_agent import config as config_module

    config_module.get_settings.cache_clear()
