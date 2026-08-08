"""
Financial Agent — specialized in stock, crypto, and market analysis.

Receives the user prompt and user preferences (watchlist, industries).
Generates an analytical financial response using the 3-tier LLM chain.
"""

from __future__ import annotations

import logging

from ..schemas.orchestrate import UserContext
from .base import AgentResult, get_llm

logger = logging.getLogger(__name__)

FINANCIAL_SYSTEM_PROMPT = """You are the Financial Analyst Agent at Atlas AI — an elite, data-driven market intelligence engine.

Your role is to analyze stock queries, market trends, portfolio questions, and investment considerations.

Guidelines:
1. When the user asks about a specific stock or company:
   - Provide a balanced analysis: key strengths alongside key risks/headwinds.
   - Mention any relevant catalysts, earnings, or macro factors.
   - Offer a sensible perspective (e.g., dollar-cost averaging for long-term, monitoring short-term volatility).

2. When the user asks about market conditions:
   - Summarize overall sentiment, major index movements, and key themes.
   - Be concise and data-driven — like a Bloomberg Terminal briefing.

3. When the user asks about crypto or alternative assets:
   - Apply the same analytical rigor as equities.

4. Always include a brief, natural disclaimer that this is educational analysis, not personalized financial advice.

5. Be professional, insightful, and accessible. Avoid jargon overload.

6. Output ONLY plain text analysis — no HTML or Markdown formatting.
   The Synthesis Agent will handle formatting.

User's watchlist: {watchlist}
User's industries of interest: {industries}
"""


def run_financial_agent(prompt: str, context: UserContext) -> AgentResult:
    """
    Execute the Financial Agent.

    Args:
        prompt: The user's raw message.
        context: User context including preferences and calendar events.

    Returns:
        AgentResult with the financial analysis content.
    """
    llm = get_llm()

    watchlist = context.user_preferences.get("watchlist", [])
    industries = context.user_preferences.get("industries", ["Finance"])

    system_prompt = FINANCIAL_SYSTEM_PROMPT.format(
        watchlist=", ".join(watchlist) if watchlist else "None set",
        industries=", ".join(industries) if industries else "General",
    )

    try:
        response = llm.invoke(
            [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": prompt},
            ]
        )

        content = response.content if hasattr(response, "content") else str(response)
        logger.info("💰 Financial Agent completed analysis")

        return AgentResult(
            content=content,
            agent_name="financial",
            metadata={
                "watchlist": watchlist,
                "industries": industries,
            },
        )

    except Exception as e:
        logger.error("❌ Financial Agent error: %s", e)
        return AgentResult(
            content=(
                "I'm currently unable to fetch detailed market analysis. "
                "Please try asking about a specific stock ticker (e.g., AAPL, NVDA, TSLA) "
                "or a general market question."
            ),
            agent_name="financial",
            metadata={"error": str(e)},
        )
