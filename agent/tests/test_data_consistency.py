"""Tests that validate data consistency across personas.json and simulations.json."""

import pytest

from careersim_agent.services.data_loader import (
    _load_personas,
    _load_simulations,
    list_simulations,
    load_persona,
    load_simulation,
)


class TestPersonaSlugConsistency:
    """Every simulation's personaSlug must point to an existing persona."""

    def test_all_persona_slugs_resolve(self):
        personas = {p["slug"] for p in _load_personas()}
        simulations = _load_simulations()

        for sim in simulations:
            slug = sim["personaSlug"]
            assert slug in personas, (
                f"Simulation '{sim['slug']}' references persona '{slug}' "
                f"which does not exist. Available: {sorted(personas)}"
            )

    def test_no_unknown_names_in_listing(self):
        for s in list_simulations():
            assert s["personaName"] != "Unknown", (
                f"Simulation '{s['slug']}' resolved persona name to 'Unknown'"
            )


class TestAllSimulationsLoadable:
    """Every simulation in the catalogue can be fully loaded with its persona."""

    def test_load_every_simulation(self):
        for summary in list_simulations():
            sim, persona = load_simulation(summary["slug"])
            assert sim["slug"] == summary["slug"]
            assert "name" in persona
            assert "conversationGoals" in sim
            assert len(sim["conversationGoals"]) > 0


class TestAllPersonasLoadable:
    """Every persona in personas.json can be loaded by slug."""

    def test_load_every_persona(self):
        for p in _load_personas():
            persona = load_persona(p["slug"])
            assert persona["slug"] == p["slug"]
            assert "name" in persona
            assert "conversationStyle" in persona


class TestPersonaRequiredFields:
    """Every persona has the fields the graph nodes depend on."""

    REQUIRED_STYLE_FIELDS = [
        "startsConversation",
        "burstiness",
        "typingSpeedWpm",
    ]

    def test_conversation_style_fields(self):
        for p in _load_personas():
            style = p.get("conversationStyle", {})
            for field in self.REQUIRED_STYLE_FIELDS:
                assert field in style, (
                    f"Persona '{p['slug']}' missing conversationStyle.{field}"
                )

    def test_typing_speed_is_positive(self):
        for p in _load_personas():
            wpm = p["conversationStyle"]["typingSpeedWpm"]
            assert isinstance(wpm, int) and wpm > 0, (
                f"Persona '{p['slug']}' has invalid typingSpeedWpm: {wpm}"
            )
