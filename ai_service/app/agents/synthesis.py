"""
Synthesis Agent — the final consolidation layer.

Receives outputs from all sub-agents (Financial, Calendar, or both) plus the
original user prompt. Consolidates everything into a single, highly formatted
Telegram HTML response using allowed tags: <b>, <i>, <code>.
"""

from __future__ import annotations

import logging

from .base import AgentResult, get_llm

logger = logging.getLogger(__name__)

SYNTHESIS_SYSTEM_PROMPT = """You are the Synthesis Agent at Atlas AI — the final layer that crafts beautiful, unified responses.

You receive analysis from specialist agents (Financial Agent, Calendar Agent, or both).
Your job is to consolidate their outputs into a single, polished response for Telegram.

CRITICAL FORMATTING RULES — You MUST follow these exactly:
1. Use ONLY these Telegram HTML tags for formatting:
   - <b>text</b> for bold (section headers, important labels)
   - <i>text</i> for italic (insights, advice, disclaimers)
   - <code>text</code> for inline code (ticker symbols like $AAPL, prices, numbers)

2. Use emoji strategically for visual hierarchy:
   - 📊 for market/financial sections
   - 📅 for calendar/schedule sections
   - 💡 for insights and takeaways
   - ⚡ for action items
   - 🟢/🔴 for positive/negative indicators

3. Use "━━━━━━━━━━━━━━━━━━" as section dividers.

4. Keep responses concise but comprehensive — 3 to 8 lines typically.

5. Do NOT use Markdown formatting (no **, ##, ```, etc.) — ONLY Telegram HTML tags.

6. Do NOT wrap the entire response in any outer tag.

7. End with a subtle Atlas AI signature: ⏱️ <i>Powered by Atlas AI</i>

The user's original question was: "{original_prompt}"
The detected intent was: {intent}
"""

SYNTHESIS_GENERAL_PROMPT = """You are Atlas AI — an elite, knowledgeable, and friendly assistant on Telegram.

The user sent a general message that doesn't require specialized financial or calendar analysis.
Respond directly, conversationally, and helpfully.

CRITICAL FORMATTING RULES — You MUST follow these exactly:
1. Use ONLY these Telegram HTML tags: <b>text</b>, <i>text</i>, <code>text</code>
2. Do NOT use Markdown formatting (no **, ##, ```, etc.)
3. Keep responses concise and friendly — 2 to 5 lines typically.
4. End with: ⏱️ <i>Powered by Atlas AI</i>
"""


def run_synthesis_agent(
    original_prompt: str,
    agent_results: list[AgentResult],
    intent: str,
) -> AgentResult:
    """
    Consolidate sub-agent outputs into a single Telegram HTML response.

    Args:
        original_prompt: The user's original message.
        agent_results: Outputs from sub-agents (may be empty for general chat).
        intent: The classified intent from the Supervisor.

    Returns:
        AgentResult with the final Telegram HTML formatted response.
    """
    llm = get_llm()

    # General chat — no sub-agent outputs, respond directly
    if not agent_results:
        try:
            response = llm.invoke(
                [
                    {"role": "system", "content": SYNTHESIS_GENERAL_PROMPT},
                    {"role": "user", "content": original_prompt},
                ]
            )
            content = response.content if hasattr(response, "content") else str(response)
            logger.info("✨ Synthesis Agent completed (general chat)")

            return AgentResult(
                content=content,
                agent_name="synthesis",
                metadata={"mode": "general_direct"},
            )
        except Exception as e:
            logger.error("❌ Synthesis Agent error (general): %s", e)
            return AgentResult(
                content=(
                    "I'm Atlas AI, your financial and productivity assistant. "
                    "You can ask me about any stock, your calendar, or general questions!\n\n"
                    "⏱️ <i>Powered by Atlas AI</i>"
                ),
                agent_name="synthesis",
                metadata={"error": str(e)},
            )

    # Build context from sub-agent results
    agent_context_lines = []
    for result in agent_results:
        agent_context_lines.append(
            f"--- {result.agent_name.upper()} AGENT OUTPUT ---\n{result.content}"
        )

    agent_context = "\n\n".join(agent_context_lines)

    system_prompt = SYNTHESIS_SYSTEM_PROMPT.format(
        original_prompt=original_prompt,
        intent=intent,
    )

    user_message = (
        f"Consolidate the following agent analyses into a single, "
        f"beautifully formatted Telegram HTML response:\n\n{agent_context}"
    )

    try:
        response = llm.invoke(
            [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_message},
            ]
        )

        content = response.content if hasattr(response, "content") else str(response)
        logger.info(
            "✨ Synthesis Agent consolidated %d agent output(s)", len(agent_results)
        )

        return AgentResult(
            content=content,
            agent_name="synthesis",
            metadata={
                "mode": "consolidation",
                "source_agents": [r.agent_name for r in agent_results],
            },
        )

    except Exception as e:
        logger.error("❌ Synthesis Agent error: %s", e)

        # Fallback: concatenate raw agent outputs with basic formatting
        fallback_parts = []
        for result in agent_results:
            emoji = "📊" if result.agent_name == "financial" else "📅"
            fallback_parts.append(
                f"{emoji} <b>{result.agent_name.title()} Analysis</b>\n{result.content}"
            )

        fallback_content = (
            "\n\n━━━━━━━━━━━━━━━━━━\n\n".join(fallback_parts)
            + "\n\n⏱️ <i>Powered by Atlas AI</i>"
        )

        return AgentResult(
            content=fallback_content,
            agent_name="synthesis",
            metadata={"error": str(e), "used_fallback": True},
        )
