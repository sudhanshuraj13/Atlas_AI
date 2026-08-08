import type { Bot } from "grammy";
import { getOrCreateUser, saveMessage, getRecentMessages } from "../../db/userRepository.js";
import { sendSafeTelegramMessage } from "../../utils/telegram.js";
import { processUserMessage } from "../../ai/orchestrator.js";
import { formatFinancialSummary, formatChatResponse } from "../../utils/formatters.js";
import {
  orchestrate as aiServiceOrchestrate,
  isAiServiceError,
  type OrchestrateContext,
} from "../../services/aiService.js";
import { CalendarService } from "../../services/calendarService.js";

/** Whether the Python AI microservice gateway is enabled. */
const AI_SERVICE_ENABLED = Boolean(process.env["AI_SERVICE_URL"]?.trim());

/**
 * Route a user message through the Python multi-agent microservice.
 * Returns the HTML response, or null if the service is unavailable (triggers fallback).
 */
async function routeViaPythonService(
  userId: string,
  telegramId: bigint,
  prompt: string,
  userPreferences: Record<string, unknown>
): Promise<string | null> {
  try {
    // 1. Fetch calendar events from Google Calendar via Node.js OAuth layer
    const calendarEvents = await CalendarService.getUpcomingEvents(telegramId);

    // 2. Assemble context payload
    const context: OrchestrateContext = {
      calendar_events: calendarEvents.map((e) => ({
        title: e.title,
        time: e.time,
        ticker: e.ticker ?? null,
        description: e.description ?? null,
      })),
      user_preferences: userPreferences,
    };

    // 3. Call Python FastAPI multi-agent engine
    const result = await aiServiceOrchestrate(userId, prompt, context);

    console.log(
      `🐍 [AI Service] intent=${result.intent_detected}, agents=[${result.agents_executed.join(", ")}]`
    );

    return result.reply_text;
  } catch (err) {
    if (isAiServiceError(err)) {
      console.warn(`⚠️ [AI Service] ${err.code}: ${err.message} — falling back to local orchestrator`);
    } else {
      console.warn("⚠️ [AI Service] Unreachable — falling back to local orchestrator:", err);
    }
    return null;
  }
}

/** Register the plain-text message handler. */
export function registerMessageHandlers(bot: Bot): void {
  bot.on("message:text", async (ctx) => {
    const from = ctx.from;
    if (!from) return;

    // Typing indicator immediately before async work (Law 3)
    await ctx.replyWithChatAction("typing");

    try {
      // Upsert user and get their DB record (thin handler — delegates to repo)
      const user = await getOrCreateUser(
        BigInt(from.id),
        from.first_name,
        from.username
      );

      // Persist the incoming user message
      const userText = ctx.message.text;
      await saveMessage(user.id, "user", userText);

      let responseHtml: string;

      // ── Gateway Path: Python AI Microservice ──────────────────────
      if (AI_SERVICE_ENABLED) {
        const preferences: Record<string, unknown> = {};
        if (user.preference) {
          preferences["watchlist"] = user.preference.watchlist;
          preferences["industries"] = user.preference.industries;
          preferences["briefingTime"] = user.preference.briefingTime;
        }

        const pythonResult = await routeViaPythonService(
          user.id,
          BigInt(from.id),
          userText,
          preferences
        );

        if (pythonResult) {
          responseHtml = pythonResult;
          await sendSafeTelegramMessage(ctx, responseHtml);
          await saveMessage(user.id, "assistant", responseHtml);
          return;
        }
        // If Python service failed, fall through to local orchestrator
      }

      // ── Fallback Path: Local In-Process Orchestrator ──────────────
      const recentHistory = await getRecentMessages(user.id, 6);
      const result = await processUserMessage(userText, recentHistory);

      if (result.type === "financial_summary") {
        responseHtml = formatFinancialSummary(result.data, result.ticker);
        await sendSafeTelegramMessage(ctx, responseHtml);
      } else if (result.type === "chat_response") {
        responseHtml = formatChatResponse(result.data);
        await sendSafeTelegramMessage(ctx, responseHtml);
      } else {
        responseHtml = result.message;
        await sendSafeTelegramMessage(ctx, responseHtml);
      }

      await saveMessage(user.id, "assistant", responseHtml);
    } catch {
      // Global error boundary — ensures user always gets a response
      console.error("❌ Message handler error");
      await sendSafeTelegramMessage(
        ctx,
        "⚠️ I'm having trouble analyzing the market right now. Please try again in a moment."
      );
    }
  });

  // --- Quick-query button handler (tapping stock buttons like AAPL, NVDA, TSLA, BABA) ---

  bot.callbackQuery(/^action:query:/, async (ctx) => {
    const ticker = ctx.callbackQuery.data.split(":")[2] ?? "AAPL";
    await ctx.answerCallbackQuery({ text: `Analyzing ${ticker}...` });

    const from = ctx.from;
    if (!from) return;

    await ctx.replyWithChatAction("typing");

    try {
      const user = await getOrCreateUser(
        BigInt(from.id),
        from.first_name,
        from.username
      );

      await saveMessage(user.id, "user", ticker);

      let responseHtml: string;

      // ── Gateway Path: Python AI Microservice ──────────────────────
      if (AI_SERVICE_ENABLED) {
        const preferences: Record<string, unknown> = {};
        if (user.preference) {
          preferences["watchlist"] = user.preference.watchlist;
          preferences["industries"] = user.preference.industries;
        }

        const pythonResult = await routeViaPythonService(
          user.id,
          BigInt(from.id),
          ticker,
          preferences
        );

        if (pythonResult) {
          responseHtml = pythonResult;
          await sendSafeTelegramMessage(ctx, responseHtml);
          await saveMessage(user.id, "assistant", responseHtml);
          return;
        }
      }

      // ── Fallback Path: Local In-Process Orchestrator ──────────────
      const recentHistory = await getRecentMessages(user.id, 6);
      const result = await processUserMessage(ticker, recentHistory);

      if (result.type === "financial_summary") {
        responseHtml = formatFinancialSummary(result.data, result.ticker);
        await sendSafeTelegramMessage(ctx, responseHtml);
      } else if (result.type === "chat_response") {
        responseHtml = formatChatResponse(result.data);
        await sendSafeTelegramMessage(ctx, responseHtml);
      } else {
        responseHtml = result.message;
        await sendSafeTelegramMessage(ctx, responseHtml);
      }

      await saveMessage(user.id, "assistant", responseHtml);
    } catch {
      console.error("❌ Stock query button error");
      await sendSafeTelegramMessage(
        ctx,
        "⚠️ I'm having trouble analyzing the market right now. Please try again in a moment."
      );
    }
  });
}
