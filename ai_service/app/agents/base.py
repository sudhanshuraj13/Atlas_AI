"""
Shared LLM infrastructure for all agents.

Implements the 3-tier provider fallback chain using LangChain's `with_fallbacks()`:
  1. Groq (llama-3.3-70b-versatile) — ultra-fast inference, primary
  2. Google Gemini (gemini-2.0-flash) — fast, high context window
  3. OpenAI (gpt-4o-mini) — maximum reliability safety net

Each agent imports `get_llm()` to get a pre-configured chain that automatically
falls through providers on failure, mirroring the Node.js `generateStructuredAI()`.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path
from typing import Any

from dotenv import load_dotenv
from langchain_core.language_models import BaseChatModel

# Load environment variables from local ai_service/.env or root .env
_agent_dir = Path(__file__).resolve().parent.parent.parent
_root_dir = _agent_dir.parent

load_dotenv(_agent_dir / ".env")
load_dotenv(_root_dir / ".env")
load_dotenv()


@dataclass
class AgentResult:
    """Standardized output from any sub-agent."""

    content: str
    agent_name: str
    metadata: dict[str, Any] = field(default_factory=dict)


@lru_cache(maxsize=1)
def get_llm() -> BaseChatModel:
    """
    Build the 3-tier LLM chain with automatic fallback.

    Provider priority (matches Node.js providers.ts):
      1. Groq   → llama-3.3-70b-versatile
      2. Gemini → gemini-2.0-flash
      3. OpenAI → gpt-4o-mini

    Returns a single LangChain chat model that transparently retries
    across providers on rate limits, outages, or errors.
    """
    providers: list[BaseChatModel] = []
    fallbacks: list[BaseChatModel] = []

    # --- Tier 1: Groq (Primary) ---
    groq_key = os.getenv("GROQ_API_KEY", "").strip()
    if groq_key:
        from langchain_groq import ChatGroq

        providers.append(
            ChatGroq(
                model="llama-3.3-70b-versatile",
                temperature=0,
                api_key=groq_key,
            )
        )

    # --- Tier 2: Google Gemini (Fallback) ---
    google_key = (
        os.getenv("GOOGLE_API_KEY", "").strip()
        or os.getenv("GOOGLE_GENERATIVE_AI_API_KEY", "").strip()
    )
    if google_key:
        from langchain_google_genai import ChatGoogleGenerativeAI

        providers.append(
            ChatGoogleGenerativeAI(
                model="gemini-2.0-flash",
                temperature=0,
                google_api_key=google_key,
            )
        )

    # --- Tier 3: OpenAI (Safety Net) ---
    openai_key = os.getenv("OPENAI_API_KEY", "").strip()
    if openai_key:
        from langchain_openai import ChatOpenAI

        providers.append(
            ChatOpenAI(
                model="gpt-4o-mini",
                temperature=0,
                api_key=openai_key,
            )
        )

    if not providers:
        raise RuntimeError(
            "No LLM provider configured. Set at least one of: "
            "GROQ_API_KEY, GOOGLE_API_KEY, OPENAI_API_KEY"
        )

    # Primary is the first available provider; rest are fallbacks
    primary = providers[0]
    fallbacks = providers[1:]

    if fallbacks:
        return primary.with_fallbacks(fallbacks)

    return primary
