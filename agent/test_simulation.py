#!/usr/bin/env python3
"""
Flexible simulation test script for CareerSIM Agent.

Supports:
- Any simulation (behavioral, technical, saying-no, etc.)
- AI-generated or manual responses
- Real-time goal progress tracking
- Debug information display
- Full conversation logging to file

Usage:
    python test_simulation.py                    # Interactive mode
    python test_simulation.py --auto             # Auto-run with AI responses
    python test_simulation.py --sim tech-cultural-interview-alex --auto
    python test_simulation.py --auto --log       # Auto-run with logging to file
"""

import argparse
import json
import sys
from datetime import datetime
from pathlib import Path
from typing import Optional, TextIO

from dotenv import load_dotenv
from gradio_client import Client

# Load environment variables
load_dotenv(Path(__file__).parent / ".env")


# ============================================================
# SIMULATION LOGGER - Captures everything to a file
# ============================================================
class SimulationLogger:
    """Logger that captures all simulation output to a file."""
    
    def __init__(self, log_dir: str = "logs", sim_slug: str = "simulation"):
        self.log_dir = Path(log_dir)
        self.log_dir.mkdir(exist_ok=True)
        
        # Create timestamped filename
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        self.log_file = self.log_dir / f"{sim_slug}_{timestamp}.log"
        self.file: Optional[TextIO] = None
        
        # Conversation tracking
        self.conversation_log = []
        self.goal_snapshots = []
        self.turn_count = 0
        
    def open(self):
        """Open the log file."""
        self.file = open(self.log_file, 'w', encoding='utf-8')
        self._write_header()
        
    def close(self):
        """Close the log file."""
        if self.file:
            self._write_footer()
            self.file.close()
            self.file = None
            
    def _write_header(self):
        """Write log file header."""
        if not self.file:
            return
        self.file.write("=" * 80 + "\n")
        self.file.write(f"CAREERSIM SIMULATION LOG\n")
        self.file.write(f"Generated: {datetime.now().isoformat()}\n")
        self.file.write("=" * 80 + "\n\n")
        
    def _write_footer(self):
        """Write log file footer with summary."""
        if not self.file:
            return
        
        self.file.write("\n" + "=" * 80 + "\n")
        self.file.write("SIMULATION SUMMARY\n")
        self.file.write("=" * 80 + "\n\n")
        
        self.file.write(f"Total Turns: {self.turn_count}\n")
        self.file.write(f"Conversation Messages: {len(self.conversation_log)}\n\n")
        
        # Final goal status
        if self.goal_snapshots:
            last_snapshot = self.goal_snapshots[-1]
            self.file.write("Final Goal Status:\n")
            for goal in last_snapshot:
                self.file.write(f"  {goal}\n")
        
        self.file.write("\n" + "=" * 80 + "\n")
        self.file.write("END OF LOG\n")
        self.file.write("=" * 80 + "\n")
        
    def log(self, message: str, also_print: bool = True):
        """Log a message to file and optionally print."""
        if also_print:
            print(message)
        if self.file:
            self.file.write(message + "\n")
            self.file.flush()
            
    def log_section(self, title: str, char: str = "=", also_print: bool = True):
        """Log a section header."""
        line = char * 70
        text = f"\n{line}\n  {title}\n{line}"
        self.log(text, also_print)
        
    def log_ai_message(self, persona_name: str, message: str, also_print: bool = True):
        """Log an AI persona message."""
        self.conversation_log.append({
            "role": "assistant",
            "persona": persona_name,
            "content": message,
            "turn": self.turn_count,
            "timestamp": datetime.now().isoformat()
        })
        
        text = f"\n🤖 {persona_name.upper()}:\n{message}"
        self.log(text, also_print)
        
    def log_user_message(self, message: str, also_print: bool = True):
        """Log a user message."""
        self.conversation_log.append({
            "role": "user",
            "content": message,
            "turn": self.turn_count,
            "timestamp": datetime.now().isoformat()
        })
        
        text = f"\n🧑 YOU:\n{message}"
        self.log(text, also_print)
        
    def log_goals(self, goals_data: dict, also_print: bool = True) -> tuple[int, int]:
        """Log goal progress and return (achieved, total)."""
        achieved = 0
        total = 0
        goal_lines = []
        
        if not goals_data or 'data' not in goals_data:
            self.log("  No goals data available", also_print)
            return 0, 0
        
        for goal in goals_data['data']:
            if isinstance(goal, (list, tuple)) and len(goal) >= 3:
                total += 1
                num, title, status = goal[0], goal[1], goal[2]
                conf = goal[3] if len(goal) > 3 else "N/A"
                evidence = goal[4] if len(goal) > 4 else 0
                
                status_icon = "✅" if status == "achieved" else "🔄" if status == "in_progress" else "⬜"
                
                if status == "achieved":
                    achieved += 1
                
                clean_title = title.split(" ", 1)[-1] if title.startswith(("⬜", "🔄", "✅")) else title
                
                line1 = f"  {status_icon} Goal {num}: {clean_title}"
                line2 = f"       Status: {status} | Confidence: {conf} | Evidence: {evidence}"
                
                self.log(line1, also_print)
                self.log(line2, also_print)
                
                goal_lines.append(f"Goal {num} ({clean_title}): {status} - conf={conf}, evidence={evidence}")
        
        self.goal_snapshots.append(goal_lines)
        return achieved, total
        
    def log_analysis(self, analysis: str, also_print: bool = True):
        """Log analysis/debug information."""
        if analysis:
            self.log_section("ANALYSIS", "-", also_print)
            self.log(analysis, also_print)
            
    def log_turn_start(self, turn_num: int, also_print: bool = True):
        """Log the start of a new turn."""
        self.turn_count = turn_num
        self.log_section(f"TURN {turn_num}", "=", also_print)
        
    def get_log_path(self) -> str:
        """Get the path to the log file."""
        return str(self.log_file)
    
    def export_conversation_json(self) -> str:
        """Export conversation log as JSON."""
        json_file = self.log_file.with_suffix('.json')
        with open(json_file, 'w', encoding='utf-8') as f:
            json.dump({
                "conversation": self.conversation_log,
                "goal_snapshots": self.goal_snapshots,
                "total_turns": self.turn_count,
                "generated_at": datetime.now().isoformat()
            }, f, indent=2, ensure_ascii=False)
        return str(json_file)

# Try to import OpenAI for AI-generated responses
try:
    from openai import OpenAI
    openai_client = OpenAI()
    OPENAI_AVAILABLE = True
except ImportError:
    OPENAI_AVAILABLE = False
    openai_client = None


# ============================================================
# SIMULATION PROMPTS - Customize behavior per simulation
# ============================================================
SIMULATION_PROMPTS = {
    "behavioral-interview-brenda": """You are a job candidate in a behavioral interview with Brenda Vance, an HR manager.

Goals:
1. Opening and Rapport Building - Professional greeting, thank them, show genuine interest in the role
2. Behavioral Question Response - Use STAR method (Situation, Task, Action, Result) with specific measurable outcomes
3. Addressing Concerns - Show self-awareness about weaknesses, demonstrate cultural fit understanding
4. Professional Closing - Summarize qualifications, express interest, ask about next steps

Guidelines:
- Keep responses concise but substantial
- Use specific, concrete examples with numbers when possible
- Be professional but warm
- When answering behavioral questions, always use STAR format""",

    "tech-cultural-interview-alex": """You are a job candidate in a technical/cultural fit interview with Alex Chen, an enthusiastic tech lead.

Goals:
1. Casual Opening - Match his enthusiastic energy, show excitement about the opportunity
2. Technical Discussion - Share technical experiences, ask thoughtful questions, show curiosity
3. Team Culture Exploration - Ask about team dynamics, share team-oriented experiences
4. Problem-Solving Demonstration - Discuss creative solutions, show adaptability and growth mindset
5. Professional Closing - Summarize qualifications, express interest, ask about next steps

Guidelines:
- Match Alex's casual, energetic tone
- Go deep on technical details - he loves that
- Share specific examples of problem-solving
- Show genuine curiosity about their tech stack and challenges""",

    "saying-no-to-extra-work-sarah": """You are a colleague being asked for help by Sarah Jenkins, an overwhelmed project manager.

Goals:
1. Empathetic Listening - Show genuine concern, listen actively, acknowledge her stress
2. Honest Assessment - Explain your workload clearly, be transparent about constraints
3. Alternative Solutions - Suggest other resources, offer limited help within your capacity

Guidelines:
- Be empathetic but firm - you need to say no
- Don't immediately refuse - listen first
- Explain your constraints honestly
- Offer alternatives or limited help if possible
- Maintain a positive relationship""",

    "data-analyst-technical-interview-priya": """You are a data analyst candidate in a technical interview with Priya Patel, a Senior Data Analyst.

Goals:
1. Dataset Understanding and Assumptions - Ask clarifying questions about the data, define metrics precisely, validate assumptions
2. SQL Challenge - Write correct SQL with proper joins, filters, and handle edge cases (nulls, duplicates)
3. Metrics and Experiment Reasoning - Define metrics precisely, consider bias and confounders, interpret results carefully
4. Insights Communication - Communicate findings clearly to both technical and non-technical stakeholders
5. Professional Closing - Summarize key takeaways, ask for feedback, express interest

Guidelines:
- Always ask clarifying questions before diving into solutions
- When writing SQL, explain your approach and trade-offs
- Consider edge cases: NULL values, duplicates, data quality issues
- For experiments, discuss sample size, statistical significance, and potential confounders
- Structure your answers clearly: state assumptions, approach, then solution
- Be precise with metric definitions (e.g., "daily active users" vs "monthly active users")
- Show intellectual humility - acknowledge uncertainty when appropriate""",

    "pitching-idea-david": """You are pitching a new initiative to David Miller, a skeptical senior analyst with 15 years at the company.

Goals:
1. Respectful Opening and Context Setting - Acknowledge his experience, show respect for expertise, set collaborative tone
2. Data-Driven Presentation - Present clear data, use logical structure, reference industry standards
3. Addressing Objections - Anticipate concerns, provide evidence-based rebuttals, show flexibility
4. Risk Mitigation Discussion - Acknowledge valid risks, propose safeguards, show contingency planning
5. Collaborative Closing - Seek his input, build on his suggestions, leave door open for further discussion

Guidelines:
- Lead with respect for his 15 years of experience - he's seen many ideas come and go
- Back up every claim with data, numbers, or industry precedent
- Anticipate his objections and address them proactively
- Show you've thought through the risks and have mitigation plans
- Be patient - don't get defensive when challenged
- Frame your idea as building on existing successes, not replacing them
- Ask for his input and be genuinely open to incorporating his feedback""",

    "reengaging-disengaged-employee-michael": """You are a manager having a one-on-one with Michael Reyes, a formerly high-performing developer who has become disengaged.

Goals:
1. Non-Threatening Opening - Avoid accusatory language, express appreciation for his work, set collaborative tone
2. Observation Without Judgment - Focus on behaviors not personality, use specific examples, ask open-ended questions
3. Deep Listening and Probing - Ask about career satisfaction, explore current challenges, listen for unmet needs
4. Collaborative Problem-Solving - Explore growth opportunities, discuss potential changes, create action items together
5. Commitment and Follow-Up - Establish next steps, set check-in schedule, end on positive note

Guidelines:
- Start by acknowledging his valuable contributions - he IS still a high performer
- Don't accuse or assume - use "I've noticed" language, not "You always/never"
- Be comfortable with silence - let him process and respond
- Listen more than you talk - your goal is to understand, not lecture
- Ask about his career goals and what would make work more engaging
- Be prepared to hear uncomfortable feedback about the team or company
- End with concrete next steps you'll both take""",

    "delegating-task-chloe": """You are delegating an important client presentation to Chloe Davis, an eager but anxious junior marketing coordinator.

Goals:
1. Opening and Context Setting (Optional) - Acknowledge her strengths, express confidence in her abilities, set positive tone
2. Task Overview and Importance - Provide clear context, explain task significance, share the bigger picture
3. Detailed Requirements and Expectations - Be specific about deliverables, set clear deadlines, define success criteria
4. Resource Provision and Support - Offer relevant materials, provide access to help, establish check-in points
5. Confidence Building and Questions - Encourage questions, validate her capabilities, create psychological safety

Guidelines:
- Start by explaining WHY you chose her - build her confidence
- Be crystal clear on deliverables, timeline, and quality expectations
- Break down the task into manageable steps - don't overwhelm her
- Proactively offer resources and support before she has to ask
- Create multiple check-in points so she doesn't feel alone
- Explicitly encourage questions - she may not ask otherwise
- End by expressing confidence in her ability to succeed
- Make it clear that asking for help is expected, not a sign of weakness""",

    "recruiter-coldreach-vikram": """You are a passive candidate triaging an unsolicited LinkedIn recruiter DM from Vikram Shah, an external agency recruiter.

Context:
- You are a senior IC at your current company (staff-level engineer at "Acme" with ~8 years experience).
- You are not actively looking, but not closed off to a great opportunity.
- Your current comp is roughly $250k base + RSUs. You will not move for a step back in level or comp.
- You have not met Vikram before. He sent a warm but vague InMail about an "exciting opportunity."

Goals (work through these IN ORDER — do not skip):
1. Acknowledge and Set the Frame - Briefly acknowledge his outreach, signal openness without committing, ask to learn more before scheduling
2. Qualify Level and Scope - Ask specific questions about title, level, team size, scope, AND the hiring manager — do NOT skip this and decline early
3. Anchor on Compensation - State your comp anchor explicitly ("currently $250k base"), ask for the band
4. Decide and Commit (or Decline) - Only AFTER getting clarity on level and comp, make a clear yes/no call
5. Preserve the Relationship - Close warmly with an invitation for future level-appropriate roles

Critical pacing rules:
- This is an asynchronous LinkedIn DM. Replies should be 2-4 short sentences per turn — NOT email-length paragraphs.
- Spend AT LEAST 2-3 turns on Goal 2 (qualifying level/scope/team/manager) before moving on. Ask different angles: title/level, then team/manager, then scope.
- Spend AT LEAST 1-2 turns on Goal 3 (comp) — anchor your own range, then ask his band.
- Do NOT decline before turn 4 even if Vikram deflects. Press at least twice. Real qualification takes back-and-forth.
- When you do decide (turn 4-6), say it explicitly: either "let's do the call" or "I'll have to pass on this one".
- After deciding, close with one warm sentence about future fit (Goal 5), then stop. Do NOT keep replying with "take care!" / "you too!" filler.

Tone: calm, professional, slightly warm. Not adversarial. The relationship has option value.""",

    "informational-chat-marcus": """You are on a 15-minute LinkedIn-arranged call with Marcus Whitfield, a VP of Engineering at a company you would love to work at someday.

Context:
- Last week you sent Marcus a short LinkedIn message anchored on a recent post of his about migrating from in-house CI to GitHub Actions.
- He replied with "15 min next Thursday." That call just started.
- He is direct, dry, time-boxed. He won't structure the conversation for you. He won't fill silences.
- You are a senior engineer with 7 years experience, currently leading a small platform team. You are exploring (not desperate to leave).

CRITICAL OPENING RULES — your first message MUST be SHORT (max 3 sentences total):
1. ONE sentence acknowledging his time ("Thanks for the 15 minutes.")
2. ONE sentence stating why you wanted the call ("I wanted to ask one question about your CI migration post.")
3. ONE specific researched question — NOT a setup, just the question.
DO NOT include your background in the first message.
DO NOT propose a follow-up call in the first message.
DO NOT thank him profusely.

Goals (work through these IN ORDER across the conversation):
1. Respectful, Time-Aware Opening (turn 1) - Use the format above. SHORT.
2. Anchor on a Specific, Researched Question (turn 1-3) - Ask sharp questions about his post on CI migration; ask follow-ups based on his answers
3. Tie Your Background to His World — Briefly (turn 3-5) - ONLY when he asks or it's clearly relevant: ONE story, 2 sentences, then stop
4. Offer Before You Ask (turn 5-7) - Offer something specific: "Happy to send you a write-up I did on [topic]" or "I work with [X] who solved a similar problem — want an intro?"
5. Earn a Second Touchpoint (turn 7-9) - At the time mark: "I want to respect the 15 minutes — would it be useful if I sent over [the specific thing]?"

Critical pacing rules:
- Each message is SHORT. 1-3 sentences. Marcus will tell you if you're being too verbose ("That's a lot for minute one"). LISTEN AND TRIM.
- If Marcus says "Mm-hm" twice or "Still too much" — your next message must be even shorter, just one sentence.
- If Marcus says "Good" or "Better" or "Interesting" — you're on track. Continue with one more concrete contribution, then yield.
- Do NOT dump your background in turns 1-2. He has not asked.
- Do NOT propose a second call as your first move. Earn it by giving something specific first.
- After agreeing on a follow-up, close with one short line and STOP. Don't keep replying.

Tone: calm, confident, no flattery, no nervousness, no eagerness. Treat him as a peer with more experience.""",
}

DEFAULT_PROMPT = """You are participating in a workplace conversation simulation.
Be professional, respond naturally, and work towards achieving the conversation goals.
Pay attention to the goal progress and focus on goals that are not yet achieved."""


def get_simulation_prompt(sim_slug: str, goals: list) -> str:
    """Get the appropriate prompt for a simulation."""
    base_prompt = SIMULATION_PROMPTS.get(sim_slug, DEFAULT_PROMPT)
    
    # Add current goal progress
    if goals:
        progress_text = "\n\nCurrent Goal Progress:\n"
        for goal in goals:
            if isinstance(goal, (list, tuple)) and len(goal) >= 3:
                status_icon = "✅" if goal[2] == "achieved" else "🔄" if goal[2] == "in_progress" else "⬜"
                progress_text += f"  {status_icon} Goal {goal[0]}: {goal[1]} - {goal[2]}\n"
        base_prompt += progress_text
        base_prompt += "\nFocus on achieving goals that are not yet complete."
    
    return base_prompt


def extract_content(msg) -> str:
    """Extract text content from various message formats."""
    if isinstance(msg, dict):
        content = msg.get('content', '')
    else:
        return str(msg)
    
    if isinstance(content, list):
        for item in content:
            if isinstance(item, dict) and item.get('type') == 'text':
                return item.get('text', '')
        return str(content)
    
    return str(content)


def generate_ai_response(conversation: list, goals: list, sim_slug: str) -> str:
    """Generate a response using OpenAI."""
    if not OPENAI_AVAILABLE or not openai_client:
        return None
    
    # Build messages
    system_prompt = get_simulation_prompt(sim_slug, goals)
    messages = [{"role": "system", "content": system_prompt}]
    
    # Add conversation history
    for msg in conversation:
        role = msg.get('role', 'user') if isinstance(msg, dict) else 'user'
        content = extract_content(msg)
        if content:
            messages.append({"role": role, "content": content})
    
    # Generate response
    response = openai_client.chat.completions.create(
        model="gpt-4o-mini",
        messages=messages,
        max_tokens=500,
        temperature=0.7,
    )
    
    return response.choices[0].message.content


def print_header(text: str, char: str = "="):
    """Print a formatted header."""
    print(f"\n{char * 70}")
    print(f"  {text}")
    print(f"{char * 70}")


def print_goals(goals_data: dict) -> tuple[int, int]:
    """Print goal progress and return (achieved, total) counts."""
    achieved = 0
    total = 0
    
    if not goals_data or 'data' not in goals_data:
        print("  No goals data available")
        return 0, 0
    
    for goal in goals_data['data']:
        if isinstance(goal, (list, tuple)) and len(goal) >= 3:
            total += 1
            num, title, status = goal[0], goal[1], goal[2]
            conf = goal[3] if len(goal) > 3 else "N/A"
            evidence = goal[4] if len(goal) > 4 else 0
            
            status_icon = "✅" if status == "achieved" else "🔄" if status == "in_progress" else "⬜"
            
            if status == "achieved":
                achieved += 1
            
            # Clean up title (remove emoji prefix if present)
            clean_title = title.split(" ", 1)[-1] if title.startswith(("⬜", "🔄", "✅")) else title
            
            print(f"  {status_icon} Goal {num}: {clean_title}")
            print(f"       Status: {status} | Confidence: {conf} | Evidence: {evidence}")
    
    return achieved, total


def get_persona_name(sim_slug: str) -> str:
    """Get the persona name from simulation slug."""
    persona_map = {
        "behavioral-interview-brenda": "BRENDA",
        "tech-cultural-interview-alex": "ALEX",
        "data-analyst-technical-interview-priya": "PRIYA",
        "pitching-idea-david": "DAVID",
        "saying-no-to-extra-work-sarah": "SARAH",
        "reengaging-disengaged-employee-michael": "MICHAEL",
        "delegating-task-chloe": "CHLOE",
        "recruiter-coldreach-vikram": "VIKRAM",
        "informational-chat-marcus": "MARCUS",
    }
    return persona_map.get(sim_slug, "AI")


def run_simulation(
    client: Client,
    sim_slug: str,
    auto_mode: bool = False,
    max_turns: int = 15,
    verbose: bool = True,
    logger: Optional[SimulationLogger] = None,
):
    """Run a simulation interactively or automatically."""
    
    persona_name = get_persona_name(sim_slug)
    
    # Helper to log or print
    def log_or_print(msg: str):
        if logger:
            logger.log(msg)
        else:
            print(msg)
    
    def log_section(title: str, char: str = "="):
        if logger:
            logger.log_section(title, char)
        else:
            print_header(title, char)
    
    log_section(f"STARTING SIMULATION: {sim_slug}")
    
    # Start session
    result = client.predict(sim_slug=sim_slug, api_name="/on_start_session")
    conversation, status, goals, analysis, trace, state = result
    
    log_or_print(f"\n✅ {status}")
    
    # Show initial message
    if conversation:
        initial_msg = extract_content(conversation[-1])
        log_section("AI PERSONA", "-")
        if logger:
            logger.log_ai_message(persona_name, initial_msg, also_print=True)
        else:
            print(initial_msg)
    
    # Show initial goals
    log_section("INITIAL GOALS", "-")
    if logger:
        achieved, total = logger.log_goals(goals)
    else:
        achieved, total = print_goals(goals)
    
    # Main conversation loop
    turn = 0
    while turn < max_turns:
        turn += 1
        
        if logger:
            logger.log_turn_start(turn)
        else:
            print_header(f"TURN {turn}", "=")
        
        # Get user input or generate AI response
        if auto_mode and OPENAI_AVAILABLE:
            log_or_print("\n[Generating AI response...]")
            goal_data = goals.get('data', []) if isinstance(goals, dict) else []
            user_message = generate_ai_response(conversation, goal_data, sim_slug)
            if not user_message:
                log_or_print("Failed to generate response. Switching to manual mode.")
                auto_mode = False
                continue
            
            if logger:
                logger.log_user_message(user_message)
            else:
                print(f"\n🧑 YOU:\n{user_message}")
        else:
            log_or_print("\nEnter your response (or 'quit' to exit, 'auto' to switch to auto mode):")
            user_message = input("> ").strip()
            
            if user_message.lower() == 'quit':
                break
            elif user_message.lower() == 'auto':
                if OPENAI_AVAILABLE:
                    auto_mode = True
                    continue
                else:
                    log_or_print("OpenAI not available. Install with: pip install openai")
                    continue
            elif not user_message:
                continue
            
            if logger:
                logger.log_user_message(user_message)
        
        # Send message
        result = client.predict(
            message=user_message,
            history=[],  # Server maintains history
            api_name="/on_send_message"
        )
        
        conversation, _, goals, analysis, trace = result
        
        # Show AI response
        if conversation:
            ai_response = extract_content(conversation[-1])
            log_section("AI PERSONA", "-")
            if logger:
                logger.log_ai_message(persona_name, ai_response, also_print=True)
            else:
                print(ai_response)
        
        # Show goal progress
        log_section("GOAL PROGRESS", "-")
        if logger:
            achieved, total = logger.log_goals(goals)
        else:
            achieved, total = print_goals(goals)
        log_or_print(f"\n  📊 Progress: {achieved}/{total} goals achieved")
        
        # Show analysis if verbose
        if verbose and analysis:
            if logger:
                logger.log_analysis(analysis)
            else:
                print_header("ANALYSIS", "-")
                print(analysis)
        
        # Check for completion
        if achieved >= total and total > 0:
            log_section("🎉 ALL GOALS ACHIEVED!", "=")
            break
        
        # Check for natural ending
        ai_text = extract_content(conversation[-1]) if conversation else ""
        user_text = user_message
        ending_phrases = [
            "thank you for your time", "we'll be in touch", "talk soon", "that concludes",
            "have a great day", "have a good", "take care", "all the best",
            "stay well", "stay in touch", "you too", "you as well",
            "simulation complete",
        ]
        ai_short_signoff = len(ai_text.strip()) < 80 and any(p in ai_text.lower() for p in ending_phrases)
        user_short_signoff = len(user_text.strip()) < 80 and any(p in user_text.lower() for p in ending_phrases)
        if ai_short_signoff and user_short_signoff:
            log_or_print("\n[Both sides exchanged short farewells — ending conversation]")
            break
        if any(phrase in ai_text.lower() for phrase in ["that concludes", "simulation complete", "we'll be in touch"]):
            log_or_print("\n[Conversation concluded naturally]")
            if not auto_mode:
                continue_choice = input("Continue? (y/n): ").strip().lower()
                if continue_choice != 'y':
                    break
    
    # Final summary
    log_section("FINAL SUMMARY", "=")
    log_or_print(f"\n  Total turns: {turn}")
    log_or_print(f"  Goals achieved: {achieved}/{total}")
    
    if achieved >= total and total > 0:
        log_or_print("\n  ✅ SIMULATION COMPLETE - ALL GOALS ACHIEVED!")
    elif achieved > 0:
        log_or_print(f"\n  🔄 PARTIAL COMPLETION - {achieved}/{total} goals achieved")
    else:
        log_or_print("\n  ⬜ NO GOALS ACHIEVED")
    
    return achieved, total


def list_simulations(client: Client):
    """List available simulations.

    Reads the canonical list from agent/data/simulations.json and personas.json
    so the help text never drifts from the data files.
    """
    print_header("AVAILABLE SIMULATIONS")

    data_dir = Path(__file__).parent / "data"
    try:
        sims = json.loads((data_dir / "simulations.json").read_text(encoding="utf-8"))
        personas = {p["slug"]: p for p in json.loads((data_dir / "personas.json").read_text(encoding="utf-8"))}
    except (OSError, json.JSONDecodeError) as exc:
        print(f"  Could not read simulation data: {exc}")
        return

    print(f"\n  {len(sims)} simulations available:\n")
    for index, sim in enumerate(sorted(sims, key=lambda s: s["slug"]), start=1):
        persona = personas.get(sim.get("personaSlug", ""), {})
        persona_label = f"{persona.get('name', 'Unknown')} ({persona.get('role', 'Unknown role')})"
        print(f"  {index:>2}. {sim['slug']}")
        print(f"      {sim.get('title', '')} with {persona_label}")
        print()


def main():
    parser = argparse.ArgumentParser(description="CareerSIM Simulation Tester")
    parser.add_argument("--sim", default="behavioral-interview-brenda",
                        help="Simulation slug to run")
    parser.add_argument("--auto", action="store_true",
                        help="Auto-run with AI-generated responses")
    parser.add_argument("--turns", type=int, default=15,
                        help="Maximum number of turns")
    parser.add_argument("--list", action="store_true",
                        help="List available simulations")
    parser.add_argument("--quiet", action="store_true",
                        help="Reduce output verbosity")
    parser.add_argument("--url", default="http://localhost:7860",
                        help="Gradio server URL")
    parser.add_argument("--log", action="store_true",
                        help="Enable logging to file")
    parser.add_argument("--log-dir", default="logs",
                        help="Directory to store log files (default: logs)")
    parser.add_argument("--json", action="store_true",
                        help="Also export conversation as JSON")
    
    args = parser.parse_args()
    
    # Connect to server
    print(f"Connecting to {args.url}...")
    try:
        client = Client(args.url)
        print("Connected successfully!")
    except Exception as e:
        print(f"Error connecting: {e}")
        print("Make sure the CareerSIM server is running: python -m careersim_agent.main")
        sys.exit(1)
    
    if args.list:
        list_simulations(client)
        return
    
    # Check for auto mode requirements
    if args.auto and not OPENAI_AVAILABLE:
        print("Warning: --auto mode requires OpenAI. Install with: pip install openai")
        print("Falling back to manual mode.")
        args.auto = False
    
    # Create logger if enabled
    logger = None
    if args.log:
        logger = SimulationLogger(log_dir=args.log_dir, sim_slug=args.sim)
        logger.open()
        print(f"📝 Logging to: {logger.get_log_path()}")
    
    try:
        # Run simulation
        run_simulation(
            client=client,
            sim_slug=args.sim,
            auto_mode=args.auto,
            max_turns=args.turns,
            verbose=not args.quiet,
            logger=logger,
        )
    finally:
        # Close logger and export JSON if requested
        if logger:
            if args.json:
                json_path = logger.export_conversation_json()
                print(f"\n📄 Conversation JSON: {json_path}")
            logger.close()
            print(f"\n📝 Full log saved to: {logger.get_log_path()}")


if __name__ == "__main__":
    main()
