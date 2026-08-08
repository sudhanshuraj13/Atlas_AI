"""
Calendar Agent — specialized in schedule analysis and meeting intelligence.

Receives the user prompt and calendar events (pre-fetched by Node.js via Google Calendar OAuth).
Analyzes schedules, detects conflicts, suggests open time slots, and provides meeting prep.
"""

from __future__ import annotations

import logging

from ..schemas.orchestrate import UserContext
from .base import AgentResult, get_llm

logger = logging.getLogger(__name__)

CALENDAR_SYSTEM_PROMPT = """You are the Calendar Intelligence Agent at Atlas AI — an executive-grade schedule analyst and chief of staff.

You receive the user's actual calendar events for today (pre-fetched from Google Calendar).
Your job is to analyze their schedule and provide actionable insights.

Today's Calendar Events:
{events_text}

Guidelines:
1. When asked about the day's schedule:
   - Provide a clear overview: number of meetings, busy vs. free windows.
   - Highlight any back-to-back meetings or scheduling conflicts.
   - Suggest the best open time slots for focused work.

2. When a meeting mentions a company or stock ticker:
   - Note the association (e.g., "Your 2PM meeting mentions NVDA").
   - The Financial Agent will handle detailed market analysis separately.

3. When asked about conflicts or rescheduling:
   - Identify overlapping events clearly.
   - Suggest practical alternatives.

4. When no events exist:
   - Acknowledge the clear calendar positively.
   - Suggest using the free time productively.

5. Be professional, concise, and actionable — like an executive assistant briefing.

6. Output ONLY plain text analysis — no HTML or Markdown formatting.
   The Synthesis Agent will handle formatting.
"""


def _format_events_for_prompt(context: UserContext) -> str:
    """Format calendar events into a readable text block for the LLM prompt."""
    if not context.calendar_events:
        return "No upcoming meetings scheduled for today."

    lines = []
    for event in context.calendar_events:
        ticker_tag = f" (Stock: ${event.ticker})" if event.ticker else ""
        desc_tag = f" — {event.description}" if event.description else ""
        lines.append(f"• [{event.time}] {event.title}{ticker_tag}{desc_tag}")

    return "\n".join(lines)


def run_calendar_agent(prompt: str, context: UserContext) -> AgentResult:
    """
    Execute the Calendar Agent.

    Args:
        prompt: The user's raw message.
        context: User context including pre-fetched calendar events.

    Returns:
        AgentResult with the calendar/schedule analysis.
    """
    llm = get_llm()

    events_text = _format_events_for_prompt(context)
    system_prompt = CALENDAR_SYSTEM_PROMPT.format(events_text=events_text)

    try:
        response = llm.invoke(
            [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": prompt},
            ]
        )

        content = response.content if hasattr(response, "content") else str(response)
        logger.info(
            "📅 Calendar Agent completed analysis (%d events)",
            len(context.calendar_events),
        )

        return AgentResult(
            content=content,
            agent_name="calendar",
            metadata={
                "events_count": len(context.calendar_events),
                "tickers_in_meetings": [
                    e.ticker for e in context.calendar_events if e.ticker
                ],
            },
        )

    except Exception as e:
        logger.error("❌ Calendar Agent error: %s", e)

        # Graceful fallback: summarize events without LLM
        if context.calendar_events:
            fallback_lines = [
                f"You have {len(context.calendar_events)} meetings today:",
            ]
            for event in context.calendar_events:
                fallback_lines.append(f"• {event.time} — {event.title}")
            fallback_content = "\n".join(fallback_lines)
        else:
            fallback_content = "Your calendar is clear for today. No upcoming meetings found."

        return AgentResult(
            content=fallback_content,
            agent_name="calendar",
            metadata={"error": str(e), "used_fallback": True},
        )
