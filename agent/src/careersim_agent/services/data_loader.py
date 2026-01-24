"""Load personas and simulations from JSON configuration files."""

import json
from pathlib import Path
from typing import TypedDict, Optional


class ConversationStyle(TypedDict, total=False):
    """Persona conversation style configuration."""
    tone: str
    formality: str
    pace: str
    emotionalRange: list[str]
    commonPhrases: list[str]
    startsConversation: bool
    inactivityNudgeDelaySec: dict[str, int]
    inactivityNudges: dict[str, int]
    burstiness: dict[str, int]
    openingStyle: str
    nudgeStyle: str


class Persona(TypedDict):
    """Persona definition."""
    slug: str
    name: str
    role: str
    personality: str
    primaryGoal: str
    hiddenMotivation: str
    difficultyLevel: int
    conversationStyle: ConversationStyle


class EvaluationConfig(TypedDict, total=False):
    """Goal evaluation configuration."""
    behaviorThreshold: float
    successThreshold: float
    strongEvidenceScore: float
    minEvidenceCount: int
    minStrongEvidenceCount: int


class ConversationGoal(TypedDict, total=False):
    """Conversation goal definition."""
    goalNumber: int
    title: str
    description: str
    keyBehaviors: list[str]
    successIndicators: list[str]
    isOptional: bool
    evaluationConfig: EvaluationConfig


class Simulation(TypedDict):
    """Simulation definition."""
    slug: str
    title: str
    description: str
    scenario: str
    objectives: list[str]
    personaSlug: str
    estimatedDurationMinutes: int
    difficulty: int
    conversationGoals: list[ConversationGoal]


class SimulationSummary(TypedDict):
    """Summary of a simulation for listing."""
    slug: str
    title: str
    description: str
    personaName: str
    difficulty: int
    goalCount: int


# Cache for loaded data
_personas_cache: Optional[list[Persona]] = None
_simulations_cache: Optional[list[Simulation]] = None


def _get_data_dir() -> Path:
    """Get the data directory path."""
    # Look for data dir relative to this file's package
    package_dir = Path(__file__).parent.parent.parent.parent
    data_dir = package_dir / "data"
    if data_dir.exists():
        return data_dir
    
    # Fallback to current working directory
    cwd_data = Path.cwd() / "data"
    if cwd_data.exists():
        return cwd_data
    
    raise FileNotFoundError(
        f"Data directory not found. Checked: {data_dir}, {cwd_data}"
    )


def _load_personas() -> list[Persona]:
    """Load all personas from JSON file."""
    global _personas_cache
    if _personas_cache is not None:
        return _personas_cache
    
    data_dir = _get_data_dir()
    personas_file = data_dir / "personas.json"
    
    with open(personas_file, "r", encoding="utf-8") as f:
        _personas_cache = json.load(f)
    
    return _personas_cache


def _load_simulations() -> list[Simulation]:
    """Load all simulations from JSON file."""
    global _simulations_cache
    if _simulations_cache is not None:
        return _simulations_cache
    
    data_dir = _get_data_dir()
    simulations_file = data_dir / "simulations.json"
    
    with open(simulations_file, "r", encoding="utf-8") as f:
        _simulations_cache = json.load(f)
    
    return _simulations_cache


def load_persona(slug: str) -> Persona:
    """Load a persona by slug.
    
    Args:
        slug: The persona's unique identifier
        
    Returns:
        The persona definition
        
    Raises:
        ValueError: If persona not found
    """
    personas = _load_personas()
    for persona in personas:
        if persona["slug"] == slug:
            return persona
    
    available = [p["slug"] for p in personas]
    raise ValueError(f"Persona '{slug}' not found. Available: {available}")


def load_simulation(slug: str) -> tuple[Simulation, Persona]:
    """Load a simulation by slug with its associated persona.
    
    Args:
        slug: The simulation's unique identifier
        
    Returns:
        Tuple of (simulation, persona)
        
    Raises:
        ValueError: If simulation or persona not found
    """
    simulations = _load_simulations()
    for sim in simulations:
        if sim["slug"] == slug:
            persona = load_persona(sim["personaSlug"])
            return sim, persona
    
    available = [s["slug"] for s in simulations]
    raise ValueError(f"Simulation '{slug}' not found. Available: {available}")


def list_simulations() -> list[SimulationSummary]:
    """List all available simulations with summary info.
    
    Returns:
        List of simulation summaries
    """
    simulations = _load_simulations()
    personas = {p["slug"]: p for p in _load_personas()}
    
    summaries = []
    for sim in simulations:
        persona = personas.get(sim["personaSlug"])
        persona_name = persona["name"] if persona else "Unknown"
        
        summaries.append({
            "slug": sim["slug"],
            "title": sim["title"],
            "description": sim["description"],
            "personaName": persona_name,
            "difficulty": sim["difficulty"],
            "goalCount": len(sim.get("conversationGoals", [])),
        })
    
    return summaries


def reload_data() -> None:
    """Force reload of data from JSON files.
    
    Useful during development when modifying JSON files.
    """
    global _personas_cache, _simulations_cache
    _personas_cache = None
    _simulations_cache = None
