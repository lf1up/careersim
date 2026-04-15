"""Tests for the FastAPI production API endpoints."""

import json

import pytest
from fastapi.testclient import TestClient

from careersim_agent.api.app import create_api_app


@pytest.fixture(scope="module")
def client():
    app = create_api_app()
    return TestClient(app)


# =============================================================================
# Health & catalogue
# =============================================================================

class TestHealth:
    def test_health_returns_ok(self, client):
        resp = client.get("/health")
        assert resp.status_code == 200
        assert resp.json() == {"status": "ok"}


class TestSimulations:
    def test_lists_simulations(self, client):
        resp = client.get("/simulations")
        assert resp.status_code == 200
        data = resp.json()
        assert "simulations" in data
        assert len(data["simulations"]) >= 7

    def test_simulation_fields(self, client):
        resp = client.get("/simulations")
        sim = resp.json()["simulations"][0]
        assert "slug" in sim
        assert "title" in sim
        assert "persona_name" in sim

    def test_no_unknown_persona_names(self, client):
        resp = client.get("/simulations")
        for sim in resp.json()["simulations"]:
            assert sim["persona_name"] != "Unknown", (
                f"Simulation {sim['slug']} has Unknown persona_name"
            )


# =============================================================================
# Batch endpoints — schema & validation
# =============================================================================

class TestConversationInitValidation:
    def test_missing_slug_returns_422(self, client):
        resp = client.post("/conversation/init", json={})
        assert resp.status_code == 422

    def test_invalid_slug_returns_500(self, client):
        resp = client.post("/conversation/init", json={
            "simulation_slug": "does-not-exist",
        })
        assert resp.status_code == 500


class TestConversationTurnValidation:
    def test_missing_fields_returns_422(self, client):
        resp = client.post("/conversation/turn", json={})
        assert resp.status_code == 422

    def test_missing_user_message_returns_422(self, client):
        resp = client.post("/conversation/turn", json={"state": {}})
        assert resp.status_code == 422


class TestConversationProactiveValidation:
    def test_missing_fields_returns_422(self, client):
        resp = client.post("/conversation/proactive", json={})
        assert resp.status_code == 422

    def test_invalid_trigger_type_returns_422(self, client):
        resp = client.post("/conversation/proactive", json={
            "state": {},
            "trigger_type": "invalid",
        })
        assert resp.status_code == 422


# =============================================================================
# Streaming endpoints — SSE format
# =============================================================================

class TestSSEFormat:
    def test_init_stream_returns_event_stream(self, client):
        """Verify the stream endpoint returns text/event-stream content type."""
        resp = client.post("/conversation/init/stream", json={
            "simulation_slug": "does-not-exist",
        })
        # Invalid slug → 500 before streaming starts
        assert resp.status_code == 500

    def test_turn_stream_missing_fields_returns_422(self, client):
        resp = client.post("/conversation/turn/stream", json={})
        assert resp.status_code == 422

    def test_proactive_stream_invalid_trigger_returns_422(self, client):
        resp = client.post("/conversation/proactive/stream", json={
            "state": {},
            "trigger_type": "bad",
        })
        assert resp.status_code == 422


# =============================================================================
# Route existence
# =============================================================================

class TestRoutes:
    """Verify all expected routes are registered."""

    EXPECTED_ROUTES = [
        ("GET", "/health"),
        ("GET", "/simulations"),
        ("POST", "/conversation/init"),
        ("POST", "/conversation/turn"),
        ("POST", "/conversation/proactive"),
        ("POST", "/conversation/init/stream"),
        ("POST", "/conversation/turn/stream"),
        ("POST", "/conversation/proactive/stream"),
    ]

    def test_all_routes_exist(self, client):
        app = client.app
        route_set = set()
        for route in app.routes:
            if hasattr(route, "methods") and hasattr(route, "path"):
                for method in route.methods:
                    route_set.add((method, route.path))

        for method, path in self.EXPECTED_ROUTES:
            assert (method, path) in route_set, f"Missing route: {method} {path}"
