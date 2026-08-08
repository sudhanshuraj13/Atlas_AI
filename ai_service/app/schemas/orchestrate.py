"""
Pydantic v2 request/response schemas for the /api/v1/orchestrate endpoint.
Mirrors the REST contract between the Node.js gateway and the Python AI engine.
"""

from __future__ import annotations

from pydantic import BaseModel, Field


class CalendarEventSchema(BaseModel):
    """A single calendar event passed from Node.js (pre-fetched via Google Calendar API)."""

    title: str = Field(..., description="Meeting title")
    time: str = Field(..., description="Meeting time, e.g. '14:00'")
    ticker: str | None = Field(
        None, description="Associated stock ticker extracted from the title, e.g. 'NVDA'"
    )
    description: str | None = Field(None, description="Optional event description")


class UserContext(BaseModel):
    """User context assembled by the Node.js gateway before calling the Python service."""

    calendar_events: list[CalendarEventSchema] = Field(
        default_factory=list,
        description="Today's calendar events fetched via Google Calendar OAuth",
    )
    user_preferences: dict = Field(
        default_factory=dict,
        description="User preferences (watchlist, industries, briefingTime, etc.)",
    )


class OrchestrateRequest(BaseModel):
    """Inbound payload from the Node.js gateway."""

    user_id: str = Field(..., description="Internal user ID from Neon PostgreSQL")
    prompt: str = Field(..., description="Raw user message text")
    context: UserContext = Field(
        default_factory=UserContext,
        description="Pre-fetched user context from Node.js",
    )


class OrchestrateResponse(BaseModel):
    """Outbound payload returned to the Node.js gateway."""

    reply_text: str = Field(
        ..., description="Formatted HTML response for Telegram (uses <b>, <i>, <code> tags)"
    )
    intent_detected: str = Field(
        ..., description="Classified intent: 'financial', 'calendar', 'general', or 'mixed'"
    )
    agents_executed: list[str] = Field(
        default_factory=list,
        description="List of agent names that participated in generating this response",
    )
