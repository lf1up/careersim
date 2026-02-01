"""Load personas and simulations from JSON configuration files.

Supports auto-reload when files change (based on modification time).
"""

import json
import logging
from pathlib import Path
from typing import TypedDict, Optional

logger = logging.getLogger(__name__)


class ConversationStyle(TypedDict, total=False):
    """Persona conversation style configuration."""
    tone: str
    formality: str
    pace: str
    emotionalRange: list[str]
    commonPhrases: list[str]
    startsConversation: bool | str  # bool or "sometimes"
    inactivityNudgeDelaySec: dict[str, int]
    inactivityNudges: dict[str, int]
    burstiness: dict[str, int]
    typingSpeedWpm: int  # Used for client-side pacing/indicators
    openingStyle: str
    nudgeStyle: str


class Persona(TypedDict, total=False):
    """Persona definition."""
    slug: str
    name: str
    role: str
    category: str  # JOB_SEEKING, WORKPLACE_COMMUNICATION, LEADERSHIP
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


class SuccessCriteria(TypedDict, total=False):
    """Simulation success criteria by category."""
    communication: list[str]
    problemSolving: list[str]
    emotional: list[str]


class Simulation(TypedDict, total=False):
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
    # New fields
    skillsToLearn: list[str]  # Skills being practiced in this simulation
    tags: list[str]  # Tags for categorization/search
    successCriteria: SuccessCriteria  # High-level success criteria


class SimulationSummary(TypedDict, total=False):
    """Summary of a simulation for listing."""
    slug: str
    title: str
    description: str
    personaName: str
    difficulty: int
    goalCount: int
    skillsToLearn: list[str]
    tags: list[str]


# Cache for loaded data with modification tracking
_personas_cache: Optional[list[Persona]] = None
_personas_mtime: Optional[float] = None
_simulations_cache: Optional[list[Simulation]] = None
_simulations_mtime: Optional[float] = None

# Auto-reload flag (can be disabled for production)
_auto_reload_enabled: bool = True


def enable_auto_reload(enabled: bool = True) -> None:
    """Enable or disable auto-reload of data files.
    
    When enabled, files are checked for modifications on each access.
    When disabled, files are cached and only reloaded explicitly.
    
    Args:
        enabled: Whether to enable auto-reload
    """
    global _auto_reload_enabled
    _auto_reload_enabled = enabled
    logger.info(f"Auto-reload {'enabled' if enabled else 'disabled'}")


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


def _check_file_changed(filepath: Path, cached_mtime: Optional[float]) -> bool:
    """Check if a file has been modified since it was cached.
    
    Args:
        filepath: Path to the file
        cached_mtime: The cached modification time, or None if not cached
        
    Returns:
        True if the file has changed or wasn't cached
    """
    if cached_mtime is None:
        return True
    
    try:
        current_mtime = filepath.stat().st_mtime
        return current_mtime != cached_mtime
    except OSError:
        return True


def _load_personas() -> list[Persona]:
    """Load all personas from JSON file.
    
    Auto-reloads if the file has been modified since last load.
    """
    global _personas_cache, _personas_mtime
    
    data_dir = _get_data_dir()
    personas_file = data_dir / "personas.json"
    
    # Check if we need to reload
    if _auto_reload_enabled and _check_file_changed(personas_file, _personas_mtime):
        if _personas_cache is not None:
            logger.info(f"Reloading personas.json (file changed)")
        _personas_cache = None
    
    if _personas_cache is not None:
        return _personas_cache
    
    with open(personas_file, "r", encoding="utf-8") as f:
        _personas_cache = json.load(f)
    
    _personas_mtime = personas_file.stat().st_mtime
    logger.debug(f"Loaded {len(_personas_cache)} personas from {personas_file}")
    
    return _personas_cache


def _load_simulations() -> list[Simulation]:
    """Load all simulations from JSON file.
    
    Auto-reloads if the file has been modified since last load.
    """
    global _simulations_cache, _simulations_mtime
    
    data_dir = _get_data_dir()
    simulations_file = data_dir / "simulations.json"
    
    # Check if we need to reload
    if _auto_reload_enabled and _check_file_changed(simulations_file, _simulations_mtime):
        if _simulations_cache is not None:
            logger.info(f"Reloading simulations.json (file changed)")
        _simulations_cache = None
    
    if _simulations_cache is not None:
        return _simulations_cache
    
    with open(simulations_file, "r", encoding="utf-8") as f:
        _simulations_cache = json.load(f)
    
    _simulations_mtime = simulations_file.stat().st_mtime
    logger.debug(f"Loaded {len(_simulations_cache)} simulations from {simulations_file}")
    
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
        
        summary: SimulationSummary = {
            "slug": sim["slug"],
            "title": sim["title"],
            "description": sim["description"],
            "personaName": persona_name,
            "difficulty": sim["difficulty"],
            "goalCount": len(sim.get("conversationGoals", [])),
        }
        
        # Include new fields if present
        if sim.get("skillsToLearn"):
            summary["skillsToLearn"] = sim["skillsToLearn"]
        if sim.get("tags"):
            summary["tags"] = sim["tags"]
        
        summaries.append(summary)
    
    return summaries


def reload_data() -> None:
    """Force reload of data from JSON files.
    
    Useful during development when modifying JSON files.
    Note: With auto-reload enabled, this is usually not needed
    as files are automatically reloaded when modified.
    """
    global _personas_cache, _simulations_cache, _personas_mtime, _simulations_mtime
    _personas_cache = None
    _simulations_cache = None
    _personas_mtime = None
    _simulations_mtime = None
    logger.info("Data cache cleared, files will be reloaded on next access")
