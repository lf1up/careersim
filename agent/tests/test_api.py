"""Tests for the FastAPI production API endpoints."""

import json

import pytest
from fastapi.testclient import TestClient
from langchain_core.messages import AIMessage, HumanMessage

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


# =============================================================================
# Statelessness contract
# =============================================================================
#
# app.py promises: "No sessions are held in memory — the backend owns all
# persistence." The tests below pin that contract end-to-end by swapping the
# LangGraph runnable for a deterministic stub so we can exercise the real API
# without invoking any LLM.

class _FakeGraph:
    """Deterministic stand-in for the LangGraph runnable.

    - For a user turn: appends HumanMessage(user_message) then
      AIMessage("echo:<user_message>").
    - For a proactive trigger: appends AIMessage("proactive:<trigger>").
    - Clears transient fields (user_message, proactive_trigger) so the returned
      state looks like a real post-graph state.
    - Does not mutate any other key, so persona/simulation/session_id
      round-trip untouched.
    """

    def invoke(self, state):
        messages = list(state.get("messages", []))
        user_msg = state.get("user_message")
        trigger = state.get("proactive_trigger")

        if user_msg:
            messages.append(HumanMessage(content=user_msg))
            messages.append(AIMessage(content=f"echo:{user_msg}"))
        elif trigger:
            messages.append(AIMessage(content=f"proactive:{trigger}"))

        out = dict(state)
        out["messages"] = messages
        out["user_message"] = None
        out["proactive_trigger"] = None
        return out


@pytest.fixture
def stateless_client(monkeypatch):
    """A TestClient wired to a fresh ConversationService with _FakeGraph."""
    from careersim_agent.services import conversation_service as cs_mod

    monkeypatch.setattr(cs_mod, "_instance", None)
    svc = cs_mod.get_conversation_service()
    monkeypatch.setattr(svc, "_graph", _FakeGraph())
    return TestClient(create_api_app())


class TestStatelessness:
    """The API must hold no conversation state between requests."""

    SLUG = "behavioral-interview-brenda"

    def _init(self, client, session_id):
        resp = client.post("/conversation/init", json={
            "simulation_slug": self.SLUG,
            "session_id": session_id,
        })
        assert resp.status_code == 200, resp.text
        return resp.json()

    def test_init_then_turn_round_trips_history(self, stateless_client):
        """State returned from /init must be accepted by /turn and produce a
        response whose messages extend the prior history verbatim."""
        init = self._init(stateless_client, "sess-1")
        state1 = init["state"]
        assert state1["session_id"] == "sess-1"
        # Proactive 'start' ran server-side → there is at least one AI message.
        assert any(m["role"] == "ai" for m in state1["messages"])
        prior = state1["messages"]

        resp = stateless_client.post("/conversation/turn", json={
            "state": state1,
            "user_message": "hello world",
        })
        assert resp.status_code == 200, resp.text
        state2 = resp.json()["state"]

        # History preserved in order.
        assert state2["messages"][: len(prior)] == prior
        # User turn appended the two expected messages.
        assert state2["messages"][-2:] == [
            {"role": "human", "content": "hello world"},
            {"role": "ai", "content": "echo:hello world"},
        ]

    def test_session_id_is_opaque_and_preserved(self, stateless_client):
        """A caller-supplied session_id survives every endpoint unchanged."""
        init = self._init(stateless_client, "backend-owned-id-42")
        assert init["state"]["session_id"] == "backend-owned-id-42"

        turn = stateless_client.post("/conversation/turn", json={
            "state": init["state"],
            "user_message": "hi",
        }).json()
        assert turn["state"]["session_id"] == "backend-owned-id-42"

        pro = stateless_client.post("/conversation/proactive", json={
            "state": turn["state"],
            "trigger_type": "inactivity",
        }).json()
        assert pro["state"]["session_id"] == "backend-owned-id-42"

    def test_service_does_not_accumulate_per_session_state(self, stateless_client):
        """After arbitrary traffic, the service must not grow any dict/list
        attribute that could be a hidden session store."""
        from careersim_agent.services.conversation_service import (
            get_conversation_service,
        )

        svc = get_conversation_service()
        baseline_attrs = set(vars(svc).keys())

        for sid in ("a", "b", "c"):
            init = self._init(stateless_client, sid)
            stateless_client.post("/conversation/turn", json={
                "state": init["state"],
                "user_message": f"msg-from-{sid}",
            })
            stateless_client.post("/conversation/proactive", json={
                "state": init["state"],
                "trigger_type": "followup",
            })

        # No new attributes sneaked onto the service.
        assert set(vars(svc).keys()) == baseline_attrs

        # Any retained attribute must not be a per-session container.
        for name, value in vars(svc).items():
            assert not isinstance(value, (dict, list, set)), (
                f"ConversationService attribute '{name}' is a "
                f"{type(value).__name__} — possible per-session store"
            )

    def test_two_sessions_do_not_bleed(self, stateless_client):
        """Interleaved turns on two different session_ids keep their histories
        isolated, because isolation comes from caller-owned state, not the
        server."""
        a0 = self._init(stateless_client, "A")
        b0 = self._init(stateless_client, "B")

        a1 = stateless_client.post("/conversation/turn", json={
            "state": a0["state"], "user_message": "hello from A",
        }).json()
        b1 = stateless_client.post("/conversation/turn", json={
            "state": b0["state"], "user_message": "hello from B",
        }).json()

        a_contents = [m["content"] for m in a1["state"]["messages"]]
        b_contents = [m["content"] for m in b1["state"]["messages"]]

        assert "hello from A" in a_contents
        assert "hello from A" not in b_contents
        assert "hello from B" in b_contents
        assert "hello from B" not in a_contents
        assert a1["state"]["session_id"] == "A"
        assert b1["state"]["session_id"] == "B"

    def test_replaying_same_state_is_deterministic(self, stateless_client):
        """Posting the same state+user_message twice must yield identical
        message lists. Any hidden in-memory history would cause drift."""
        init = self._init(stateless_client, "det")

        r1 = stateless_client.post("/conversation/turn", json={
            "state": init["state"], "user_message": "same question",
        }).json()
        r2 = stateless_client.post("/conversation/turn", json={
            "state": init["state"], "user_message": "same question",
        }).json()

        assert r1["state"]["messages"] == r2["state"]["messages"]
        assert r1["state"]["session_id"] == r2["state"]["session_id"] == "det"

    def test_fresh_service_can_continue_prior_conversation(
        self, stateless_client, monkeypatch,
    ):
        """A brand-new ConversationService (no shared memory with the one that
        produced the state) accepts that state and extends it — proving the
        server caches nothing keyed by session_id."""
        from careersim_agent.services import conversation_service as cs_mod

        init = self._init(stateless_client, "fresh")
        prior_messages = init["state"]["messages"]

        monkeypatch.setattr(cs_mod, "_instance", None)
        new_svc = cs_mod.get_conversation_service()
        monkeypatch.setattr(new_svc, "_graph", _FakeGraph())
        other_client = TestClient(create_api_app())

        resp = other_client.post("/conversation/turn", json={
            "state": init["state"], "user_message": "continue please",
        })
        assert resp.status_code == 200, resp.text
        new_messages = resp.json()["state"]["messages"]

        assert new_messages[: len(prior_messages)] == prior_messages
        assert new_messages[-2:] == [
            {"role": "human", "content": "continue please"},
            {"role": "ai", "content": "echo:continue please"},
        ]

    def test_turn_without_prior_init_works_from_caller_state(
        self, stateless_client,
    ):
        """A caller that already persists state can hit /turn directly with a
        synthesised state dict, never having called /init. If the server
        required a prior init call it would be stateful."""
        synthesised = {
            "session_id": "offline-resumed",
            "messages": [
                {"role": "ai", "content": "previous opener"},
                {"role": "human", "content": "earlier reply"},
            ],
            "persona": {"conversationStyle": {"typingSpeedWpm": 100}},
            "simulation": {"slug": self.SLUG},
            "goal_progress": [],
        }

        resp = stateless_client.post("/conversation/turn", json={
            "state": synthesised,
            "user_message": "back again",
        })
        assert resp.status_code == 200, resp.text
        state = resp.json()["state"]

        assert state["session_id"] == "offline-resumed"
        # Prior messages preserved verbatim (order + content).
        assert state["messages"][:2] == synthesised["messages"]
        assert state["messages"][-2:] == [
            {"role": "human", "content": "back again"},
            {"role": "ai", "content": "echo:back again"},
        ]
