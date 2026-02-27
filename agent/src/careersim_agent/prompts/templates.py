"""Prompt templates for persona-based conversations.

Ported from backend/src/services/langgraph/prompts.ts
"""

from typing import Any, Optional
import json
import sys
from pathlib import Path

# Ensure we can import from graph.state
project_root = Path(__file__).parent.parent.parent
if str(project_root) not in sys.path:
    sys.path.insert(0, str(project_root))

from careersim_agent.graph.state import get_current_goal, ConversationState


def _format_conversation_style(style: Optional[dict]) -> str:
    """Format conversation style for prompt injection."""
    if not style:
        return "Natural, professional conversation"
    
    try:
        # Extract key style elements
        parts = []
        if style.get("tone"):
            parts.append(f"Tone: {style['tone']}")
        if style.get("formality"):
            parts.append(f"Formality: {style['formality']}")
        if style.get("pace"):
            parts.append(f"Pace: {style['pace']}")
        if style.get("emotionalRange"):
            parts.append(f"Emotional range: {', '.join(style['emotionalRange'])}")
        
        return "\n".join(parts) if parts else json.dumps(style, indent=2)
    except Exception:
        return str(style)


def _format_skills_to_learn(skills: Optional[list[str]]) -> str:
    """Format skills to learn section for prompt."""
    if not skills:
        return ""
    return f"- Skills being practiced: {', '.join(skills)}"


def _format_success_criteria(criteria: Optional[dict]) -> str:
    """Format success criteria section for prompt."""
    if not criteria:
        return ""
    
    sections = []
    if criteria.get("communication"):
        sections.append(f"  - Communication: {', '.join(criteria['communication'])}")
    if criteria.get("problemSolving"):
        sections.append(f"  - Problem Solving: {', '.join(criteria['problemSolving'])}")
    if criteria.get("emotional"):
        sections.append(f"  - Emotional Intelligence: {', '.join(criteria['emotional'])}")
    
    if not sections:
        return ""
    
    return f"- Success Criteria (what the user should demonstrate):\n" + "\n".join(sections)


def _get_goal_status(
    goal_progress: list[dict], 
    goal_number: int
) -> str:
    """Get status of a specific goal."""
    for p in goal_progress:
        if p.get("goalNumber") == goal_number:
            return p.get("status", "not_started")
    return "not_started"


def _format_goal_list(
    simulation: dict, 
    goal_progress: list[dict]
) -> str:
    """Format goals list for prompt."""
    goals = simulation.get("conversationGoals", [])
    if not goals:
        return "(No conversation goals configured)"
    
    sorted_goals = sorted(goals, key=lambda g: g.get("goalNumber", 0))
    
    lines = []
    for goal in sorted_goals:
        num = goal.get("goalNumber", 0)
        optional = " (optional)" if goal.get("isOptional") else ""
        status = _get_goal_status(goal_progress, num)
        title = goal.get("title", "Untitled")
        lines.append(f"#{num}{optional} [{status}] {title}")
    
    return "\n".join(lines)


def build_persona_system_prompt(
    persona: dict[str, Any],
    simulation: dict[str, Any],
    goal_progress: list[dict] = None,
) -> str:
    """Build the main system prompt for persona conversation.
    
    Args:
        persona: Persona configuration
        simulation: Simulation configuration
        goal_progress: Current goal progress state
        
    Returns:
        Formatted system prompt
    """
    if goal_progress is None:
        goal_progress = []
    
    # Format objectives
    objectives = simulation.get("objectives", [])
    objectives_str = ", ".join(objectives) if isinstance(objectives, list) else str(objectives)
    
    # Get current goal
    temp_state = ConversationState(
        simulation=simulation,
        goal_progress=goal_progress,
    )
    current_goal = get_current_goal(temp_state)
    goal_list = _format_goal_list(simulation, goal_progress)
    
    # Format current goal details
    if current_goal:
        current_title = f"#{current_goal.get('goalNumber', 0)} — {current_goal.get('title', '')}"
        current_description = current_goal.get("description", "(none)")
        key_behaviors = current_goal.get("keyBehaviors", [])
        current_behaviors = "; ".join(key_behaviors) if key_behaviors else "(none)"
    else:
        current_title = "(All goals complete)"
        current_description = "(none)"
        current_behaviors = "(none)"
    
    conv_style = _format_conversation_style(persona.get("conversationStyle"))
    
    # Format new fields
    skills_section = _format_skills_to_learn(simulation.get("skillsToLearn"))
    criteria_section = _format_success_criteria(simulation.get("successCriteria"))
    
    # Build optional sections
    extra_context = ""
    if skills_section:
        extra_context += f"\n{skills_section}"
    if criteria_section:
        extra_context += f"\n{criteria_section}"
    
    return f"""You are {persona.get('name', 'Unknown')}, a {persona.get('role', 'professional')} with the following characteristics:

**Personality**: {persona.get('personality', 'Professional and courteous')}

**Primary Goal**: {persona.get('primaryGoal', 'Have a productive conversation')}

**Hidden Motivation**: {persona.get('hiddenMotivation', 'None specified')}

**Difficulty Level**: {persona.get('difficultyLevel', 3)}

**Simulation Context**:
- Title: {simulation.get('title', 'Conversation')}
- Scenario: {simulation.get('scenario', 'A professional conversation')}
- Objectives: {objectives_str}{extra_context}

**Conversation Goals (ordered stages)**:
{goal_list}

**CURRENT STAGE (drive the conversation around this goal)**:
- Goal: {current_title}
- Description: {current_description}
- Key behaviors the user must demonstrate: {current_behaviors}

**Stage Rules**:
- Stay in this stage until the goal is achieved.
- Do NOT act as if later stages are happening yet.
- If the user tries to jump ahead (e.g., closing early), acknowledge briefly and steer back to the current stage.
- Ask questions / shape the interaction to elicit the key behaviors.

**Conversation Style**: {conv_style}

**Style Guidelines**:
- Stay completely in character at all times
- Respond naturally and authentically to the user's messages
- Use appropriate vocabulary and tone for your role
- Reference your goals and motivations subtly when relevant
- Adapt your difficulty level to challenge the user appropriately
- Keep responses VERY conversational and short:
  - 1–3 short sentences (the less is better)
  - Ask at most 1 question per message
  - Avoid bullet points, numbered lists, and multi-paragraph answers unless the user explicitly asks for a detailed explanation

**Important**: You are engaged in a realistic simulation. The user is practicing their skills. Be authentic, helpful, and true to your character."""


def build_proactive_start_prompt(
    persona: dict[str, Any],
    simulation: dict[str, Any],
) -> str:
    """Build prompt for starting a conversation proactively.
    
    Args:
        persona: Persona configuration
        simulation: Simulation configuration
        
    Returns:
        Formatted start prompt
    """
    conv_style = persona.get("conversationStyle", {})
    opening_style = conv_style.get("openingStyle", "Natural and welcoming")
    
    return f"""You are {persona.get('name', 'Unknown')}, a {persona.get('role', 'professional')}. You are starting a conversation.

**Your Goal**: Open the conversation in a natural, engaging way that fits your character and the simulation context.

**Simulation**: {simulation.get('title', 'Conversation')}
**Scenario**: {simulation.get('scenario', 'A professional conversation')}

**Opening Style Hint**: {opening_style}

**Guidelines**:
- Keep it brief and welcoming (1-2 sentences)
- Set the tone for the conversation
- Make it feel natural, not scripted
- Introduce yourself if appropriate for the context
- Give the user a clear opening to respond

Start the conversation now."""


def build_proactive_inactivity_prompt(
    persona: dict[str, Any],
    simulation: dict[str, Any],
    last_user_message: Optional[str] = None,
    last_ai_message: Optional[str] = None,
    recent_ai_messages: list[str] = None,
) -> str:
    """Build prompt for inactivity nudge.
    
    Args:
        persona: Persona configuration
        simulation: Simulation configuration
        last_user_message: Last message from user
        last_ai_message: Last message from AI
        recent_ai_messages: Recent AI messages to avoid repetition
        
    Returns:
        Formatted nudge prompt
    """
    if recent_ai_messages is None:
        recent_ai_messages = []
    
    conv_style = persona.get("conversationStyle", {})
    nudge_style = conv_style.get("nudgeStyle", "Friendly and encouraging")
    
    recent_formatted = "\n".join(
        f"{i+1}. \"{msg[:150]}...\"" 
        for i, msg in enumerate(recent_ai_messages)
    ) if recent_ai_messages else "(No recent messages)"
    
    return f"""You are {persona.get('name', 'Unknown')}, a {persona.get('role', 'professional')}. The user has been silent for a while.

**Your Character**:
- Personality: {persona.get('personality', 'Professional')}
- Primary Goal: {persona.get('primaryGoal', 'Have a productive conversation')}
- Current Context: {simulation.get('scenario', 'A professional conversation')}

**What You Just Said**: 
{last_ai_message or '(No previous message from you)'}

**What User Last Said**: 
{last_user_message or '(No recent message)'}

**Your Goal**: Send a brief, in-character nudge that DIRECTLY FOLLOWS UP on what you just said. Reference your last message and guide them forward.

**Nudge Style Hint**: {nudge_style}

**Recent Messages to Avoid Repetition**: 
{recent_formatted}

**Critical Guidelines**:
- Keep it very brief (1-2 sentences max)
- DIRECTLY reference what you just asked or said in your last message
- Stay completely in character with your personality and role
- Be friendly and non-pushy, but contextually relevant
- If you asked a question, gently prompt them to answer it
- If you gave instructions, encourage them to follow through
- DO NOT repeat phrases or ideas from your recent messages above
- Use completely different vocabulary and approach than previous nudges
- Make it feel like a natural continuation of YOUR LAST MESSAGE, not a random comment

Send a nudge now that follows up on what you just said."""


def build_proactive_followup_prompt(
    persona: dict[str, Any],
    last_user_message: Optional[str] = None,
    last_ai_message: Optional[str] = None,
    recent_ai_messages: list[str] = None,
) -> str:
    """Build prompt for follow-up message.
    
    Args:
        persona: Persona configuration
        last_user_message: Last message from user
        last_ai_message: Last message from AI
        recent_ai_messages: Recent AI messages to avoid repetition
        
    Returns:
        Formatted follow-up prompt
    """
    if recent_ai_messages is None:
        recent_ai_messages = []
    
    recent_formatted = "\n".join(
        f"{i+1}. \"{msg[:100]}...\"" 
        for i, msg in enumerate(recent_ai_messages)
    ) if recent_ai_messages else "(No recent messages)"
    
    # Build anti-repetition guidance
    anti_rep = ""
    if recent_ai_messages:
        anti_rep = f"""
You recently said: {'; '.join(f'"{m[:100]}..."' for m in recent_ai_messages)}

Your new message MUST:
- Use completely different vocabulary and phrasing
- Add a SMALL new detail or clarification that stays within the same context
- Never reuse sentence structures or patterns from above
- Avoid new questions; if you must guide, do it as a statement (no question marks)"""
    
    return f"""You are {persona.get('name', 'Unknown')}. You want to add something to continue the conversation naturally.

**Context**: 
- Last User Message: {last_user_message or '(No recent user message)'}
- Your Last Message: {last_ai_message or '(No recent AI message)'}

**Your Goal**: Add a VERY SHORT follow-up that stays in the SAME context as your last message.

**Recent Messages to Avoid Repetition**: 
{recent_formatted}

**Critical Anti-Repetition Rules**:
{anti_rep}

**Guidelines**:
- Keep it VERY concise (1–2 short sentences; the less is better)
- DO NOT ask any new questions (no question marks)
- DO NOT introduce new topics or make radical context shifts
- Only add a small clarification, one extra detail, or a brief reassurance that directly relates to your last message
- Make it feel like a quick addendum, not a new turn

Add your follow-up now."""
