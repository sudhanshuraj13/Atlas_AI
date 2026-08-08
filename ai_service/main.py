"""
Atlas AI — Python Multi-Agent Microservice

FastAPI server providing the AI orchestration engine for Atlas AI.
Node.js (Gateway) → POST /api/v1/orchestrate → LangGraph Pipeline → Response

Endpoints:
  GET  /health            — Microservice health status
  POST /api/v1/orchestrate — Multi-agent AI orchestration
"""

from __future__ import annotations

import logging
import os
import time
from contextlib import asynccontextmanager
from datetime import datetime, timezone

from pathlib import Path
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

# Search for .env in local ai_service directory as well as parent root directory
_current_dir = Path(__file__).resolve().parent
_root_dir = _current_dir.parent

load_dotenv(_current_dir / ".env")
load_dotenv(_root_dir / ".env")
load_dotenv()  # Fallback standard search

from app.agents import run_orchestration  # noqa: E402
from app.schemas import OrchestrateRequest, OrchestrateResponse  # noqa: E402

# ---------------------------------------------------------------------------
# Logging Configuration
# ---------------------------------------------------------------------------

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)-7s | %(name)s | %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("atlas_ai_service")


# ---------------------------------------------------------------------------
# Lifespan (startup / shutdown events)
# ---------------------------------------------------------------------------

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan handler for startup and shutdown events."""
    # Startup
    logger.info("🚀 Atlas AI Python Microservice starting...")
    logger.info("📦 LangGraph multi-agent engine initialized")

    # Log configured providers (without exposing keys)
    providers = []
    if os.getenv("GROQ_API_KEY", "").strip():
        providers.append("Groq (llama-3.3-70b-versatile)")
    if os.getenv("GOOGLE_API_KEY", "").strip() or os.getenv("GOOGLE_GENERATIVE_AI_API_KEY", "").strip():
        providers.append("Gemini (gemini-2.0-flash)")
    if os.getenv("OPENAI_API_KEY", "").strip():
        providers.append("OpenAI (gpt-4o-mini)")

    if providers:
        logger.info("🤖 LLM Provider Chain: %s", " → ".join(providers))
    else:
        logger.warning("⚠️ No LLM providers configured! Set GROQ_API_KEY, GOOGLE_API_KEY, or OPENAI_API_KEY")

    yield

    # Shutdown
    logger.info("🛑 Atlas AI Python Microservice shutting down...")


# ---------------------------------------------------------------------------
# FastAPI Application
# ---------------------------------------------------------------------------

app = FastAPI(
    title="Atlas AI — Multi-Agent Engine",
    description="Python microservice powering the LangGraph multi-agent orchestration for Atlas AI.",
    version="2.0.0",
    lifespan=lifespan,
)

# CORS middleware for development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@app.get("/health")
async def health_check():
    """Returns microservice health status."""
    return {
        "status": "ok",
        "service": "Atlas AI Agent Engine",
        "version": "2.0.0",
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


@app.post("/api/v1/orchestrate", response_model=OrchestrateResponse)
async def orchestrate(request: OrchestrateRequest):
    """
    Multi-agent AI orchestration endpoint.

    Flow:
      1. Supervisor Agent classifies intent
      2. Routes to Financial / Calendar / both sub-agents
      3. Synthesis Agent consolidates into Telegram HTML
      4. Returns structured response to Node.js gateway
    """
    start_time = time.perf_counter()

    logger.info(
        "📥 Orchestrate request — user_id=%s, prompt='%s' (%d chars)",
        request.user_id,
        request.prompt[:80],
        len(request.prompt),
    )

    try:
        response = await run_orchestration(request)

        elapsed_ms = (time.perf_counter() - start_time) * 1000
        logger.info(
            "📤 Orchestrate response — intent=%s, agents=%s, elapsed=%.0fms",
            response.intent_detected,
            response.agents_executed,
            elapsed_ms,
        )

        return response

    except Exception as e:
        elapsed_ms = (time.perf_counter() - start_time) * 1000
        logger.error("❌ Orchestration failed after %.0fms: %s", elapsed_ms, e)

        raise HTTPException(
            status_code=500,
            detail={
                "error": "Orchestration pipeline failed",
                "message": str(e),
            },
        )


# ---------------------------------------------------------------------------
# Standalone runner (python main.py)
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import uvicorn

    port = int(os.getenv("PORT", "8000"))
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=port,
        reload=True,
        log_level="info",
    )
