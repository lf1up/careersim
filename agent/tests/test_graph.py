"""Basic tests for the conversation graph."""

import os

import pytest
from unittest.mock import patch, MagicMock


def test_data_loader():
    """Test that data loader can load simulations."""
    from careersim_agent.services import list_simulations, load_simulation, load_persona
    
    # List simulations
    sims = list_simulations()
    assert len(sims) >= 1
    assert "slug" in sims[0]
    assert "title" in sims[0]
    
    # Load a specific simulation
    sim, persona = load_simulation(sims[0]["slug"])
    assert sim["slug"] == sims[0]["slug"]
    assert "conversationGoals" in sim
    assert "name" in persona


def test_state_creation():
    """Test initial state creation."""
    from careersim_agent.services import load_simulation
    from careersim_agent.graph.state import create_initial_state
    
    sims_list = [
        {"slug": "behavioral-interview-brenda"},
        {"slug": "tech-cultural-interview-alex"},
        {"slug": "saying-no-to-extra-work-sarah"},
    ]
    
    for sim_info in sims_list:
        sim, persona = load_simulation(sim_info["slug"])
        state = create_initial_state(
            session_id="test-123",
            simulation=sim,
            persona=persona,
        )
        
        assert state["session_id"] == "test-123"
        assert state["turn"] == "ai"
        assert len(state["goal_progress"]) == len(sim.get("conversationGoals", []))
        assert state["proactive_count"] == 0


def test_graph_builds():
    """Test that the graph builds without errors."""
    from careersim_agent.graph.builder import build_graph, get_graph, reset_graph
    
    # Reset any cached graph
    reset_graph()
    
    # Build fresh graph
    graph = build_graph()
    assert graph is not None
    
    # Get compiled graph
    compiled = get_graph()
    assert compiled is not None


def test_prompts():
    """Test prompt generation."""
    from careersim_agent.services import load_simulation
    from careersim_agent.prompts import (
        build_persona_system_prompt,
        build_proactive_start_prompt,
    )
    
    sim, persona = load_simulation("behavioral-interview-brenda")
    
    # Test system prompt
    system_prompt = build_persona_system_prompt(persona, sim)
    assert "Brenda Vance" in system_prompt
    assert "Behavioral Interview" in system_prompt
    
    # Test start prompt
    start_prompt = build_proactive_start_prompt(persona, sim)
    assert "Brenda Vance" in start_prompt


@pytest.mark.skipif(
    not os.environ.get("OPENAI_API_KEY"),
    reason="OPENAI_API_KEY not set"
)
def test_eval_service():
    """Test eval service (requires API key)."""
    from careersim_agent.services import get_eval_service

    service = get_eval_service()

    result = service.analyze_text("I'm very happy today!")
    assert result["sentiment"] in ("positive", "neutral", "negative")
    assert "emotion" in result
    assert result["source"] == "eval"


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
