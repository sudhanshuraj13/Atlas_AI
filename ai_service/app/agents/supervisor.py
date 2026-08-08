"""
Supervisor Agent — the orchestration brain.

Uses LangGraph to implement a state machine that:
  1. Classifies user intent (financial / calendar / general / mixed)
  2. Routes to the appropriate sub-agents
  3. Consolidates via the Synthesis agent
  4. Returns the final OrchestrateResponse

State Machine Flow:
  ┌─────────────┐
  │  Classify    │
  │  Intent      │
  └──────┬───────┘
         │
    ┌────┴─────┐
    ▼          ▼
 financial  calendar   (can invoke both for "mixed")
    │          │
    └────┬─────┘
         ▼
  ┌─────────────┐
  │  Synthesize  │
  └─────────────┘
"""

from __future__ import annotations

import json
import logging
from typing import Any, TypedDict

from langgraph.graph import END, StateGraph

from ..schemas.orchestrate import OrchestrateRequest, OrchestrateResponse
from .base import AgentResult, get_llm
from .calendar_agent import run_calendar_agent
from .financial import run_financial_agent
from .synthesis import run_synthesis_agent

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# LangGraph State Schema
# ---------------------------------------------------------------------------

class OrchestratorState(TypedDict):
    """Typed state passed through the LangGraph state machine."""

    request: dict               # Serialized OrchestrateRequest
    intent: str                 # "financial" | "calendar" | "general" | "mixed"
    agent_results: list[dict]   # List of serialized AgentResult dicts
    final_response: dict        # Serialized OrchestrateResponse


# ---------------------------------------------------------------------------
# Node Functions
# ---------------------------------------------------------------------------

CLASSIFICATION_PROMPT = """You are the Supervisor Agent for Atlas AI, an intelligent financial and productivity assistant.

Analyze the user's message and determine which specialist agents should handle it.

Classify the intent as EXACTLY one of:
- "financial": Stock queries, market analysis, portfolio questions, investment advice, price checks, company analysis
- "calendar": Schedule questions, meeting conflicts, free time slots, agenda planning, meeting prep
- "mixed": The message involves BOTH financial AND calendar topics (e.g., "What's happening with NVDA before my meeting?")
- "general": Casual conversation, greetings, general knowledge, or anything not financial/calendar

You MUST respond with ONLY a raw JSON object:
{{"intent": "financial" | "calendar" | "mixed" | "general"}}

User's calendar has {num_events} events today.
User's watchlist: {watchlist}
"""


def classify_intent(state: OrchestratorState) -> OrchestratorState:
    """Node: Classify user intent using the LLM."""
    request = OrchestrateRequest(**state["request"])
    llm = get_llm()

    watchlist = request.context.user_preferences.get("watchlist", [])
    num_events = len(request.context.calendar_events)

    system_prompt = CLASSIFICATION_PROMPT.format(
        num_events=num_events,
        watchlist=", ".join(watchlist) if watchlist else "None set",
    )

    try:
        response = llm.invoke(
            [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": request.prompt},
            ]
        )

        raw_text = response.content if hasattr(response, "content") else str(response)

        # Parse intent from JSON response
        cleaned = raw_text.strip()
        # Extract JSON if wrapped in markdown
        if "```" in cleaned:
            cleaned = cleaned.split("```json")[-1].split("```")[0].strip()

        first_brace = cleaned.find("{")
        last_brace = cleaned.rfind("}")
        if first_brace != -1 and last_brace != -1:
            cleaned = cleaned[first_brace : last_brace + 1]

        parsed = json.loads(cleaned)
        intent = parsed.get("intent", "general")

        if intent not in ("financial", "calendar", "mixed", "general"):
            intent = "general"

    except Exception as e:
        logger.warning("⚠️ Intent classification failed, defaulting to 'general': %s", e)
        intent = "general"

    state["intent"] = intent
    state["agent_results"] = []
    logger.info("🧠 Supervisor classified intent: %s", intent)
    return state


def run_financial_node(state: OrchestratorState) -> OrchestratorState:
    """Node: Execute the Financial Agent."""
    request = OrchestrateRequest(**state["request"])
    result = run_financial_agent(request.prompt, request.context)
    state["agent_results"].append(
        {"content": result.content, "agent_name": result.agent_name, "metadata": result.metadata}
    )
    return state


def run_calendar_node(state: OrchestratorState) -> OrchestratorState:
    """Node: Execute the Calendar Agent."""
    request = OrchestrateRequest(**state["request"])
    result = run_calendar_agent(request.prompt, request.context)
    state["agent_results"].append(
        {"content": result.content, "agent_name": result.agent_name, "metadata": result.metadata}
    )
    return state


def run_synthesis_node(state: OrchestratorState) -> OrchestratorState:
    """Node: Consolidate all agent outputs into a final Telegram HTML response."""
    request = OrchestrateRequest(**state["request"])

    agent_results = [
        AgentResult(
            content=r["content"],
            agent_name=r["agent_name"],
            metadata=r.get("metadata", {}),
        )
        for r in state["agent_results"]
    ]

    synthesis_result = run_synthesis_agent(
        original_prompt=request.prompt,
        agent_results=agent_results,
        intent=state["intent"],
    )

    agents_executed = [r["agent_name"] for r in state["agent_results"]]
    agents_executed.append("synthesis")

    state["final_response"] = OrchestrateResponse(
        reply_text=synthesis_result.content,
        intent_detected=state["intent"],
        agents_executed=agents_executed,
    ).model_dump()

    return state


# ---------------------------------------------------------------------------
# Routing Logic
# ---------------------------------------------------------------------------

def route_after_classification(state: OrchestratorState) -> str:
    """Conditional edge: decide which agent(s) to invoke based on classified intent."""
    intent = state["intent"]

    if intent == "financial":
        return "financial"
    elif intent == "calendar":
        return "calendar"
    elif intent == "mixed":
        return "mixed_financial"
    else:
        # General chat — go straight to synthesis (no sub-agents)
        return "synthesize"


# ---------------------------------------------------------------------------
# LangGraph Builder
# ---------------------------------------------------------------------------

def _build_graph() -> StateGraph:
    """Construct the LangGraph state machine."""
    graph = StateGraph(OrchestratorState)

    # Register nodes
    graph.add_node("classify", classify_intent)
    graph.add_node("financial", run_financial_node)
    graph.add_node("calendar", run_calendar_node)
    graph.add_node("mixed_financial", run_financial_node)
    graph.add_node("mixed_calendar", run_calendar_node)
    graph.add_node("synthesize", run_synthesis_node)

    # Entry point
    graph.set_entry_point("classify")

    # Conditional routing after classification
    graph.add_conditional_edges(
        "classify",
        route_after_classification,
        {
            "financial": "financial",
            "calendar": "calendar",
            "mixed_financial": "mixed_financial",
            "synthesize": "synthesize",
        },
    )

    # Single-agent paths → synthesis
    graph.add_edge("financial", "synthesize")
    graph.add_edge("calendar", "synthesize")

    # Mixed path: financial → calendar → synthesis
    graph.add_edge("mixed_financial", "mixed_calendar")
    graph.add_edge("mixed_calendar", "synthesize")

    # Synthesis → END
    graph.add_edge("synthesize", END)

    return graph


# Compile the graph once at module level
_compiled_graph = _build_graph().compile()


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

async def run_orchestration(request: OrchestrateRequest) -> OrchestrateResponse:
    """
    Execute the full multi-agent orchestration pipeline.

    Flow:
      1. Supervisor classifies intent
      2. Routes to Financial / Calendar / both / none
      3. Synthesis consolidates into Telegram HTML
      4. Returns structured OrchestrateResponse
    """
    initial_state: OrchestratorState = {
        "request": request.model_dump(),
        "intent": "",
        "agent_results": [],
        "final_response": {},
    }

    # LangGraph invoke is synchronous; run in executor for async compatibility
    import asyncio

    loop = asyncio.get_event_loop()
    final_state = await loop.run_in_executor(None, _compiled_graph.invoke, initial_state)

    return OrchestrateResponse(**final_state["final_response"])
