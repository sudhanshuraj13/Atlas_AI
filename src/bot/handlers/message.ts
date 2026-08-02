import type { Bot } from "grammy";
import { getOrCreateUser, saveMessage, getRecentMessages } from "../../db/userRepository.js";
import { sendSafeTelegramMessage } from "../../utils/telegram.js";
import { processUserMessage } from "../../ai/orchestrator.js";
import { formatFinancialSummary, formatChatResponse } from "../../utils/formatters.js";

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

      // Fetch conversation memory window before saving new message (Law 10)
      const recentHistory = await getRecentMessages(user.id, 6);

      // Persist the incoming user message
      const userText = ctx.message.text;
      await saveMessage(user.id, "user", userText);

      // Process through AI orchestrator with history context (Law 4 & Law 10)
      const result = await processUserMessage(userText, recentHistory);

      // Format and send response based on result type (Law 8: separate formatter)
      let responseHtml: string;

      if (result.type === "financial_summary") {
        responseHtml = formatFinancialSummary(result.data, result.ticker);
        await sendSafeTelegramMessage(ctx, responseHtml);
      } else if (result.type === "chat_response") {
        responseHtml = formatChatResponse(result.data);
        await sendSafeTelegramMessage(ctx, responseHtml);
      } else {
        // Error result — send the error message directly
        responseHtml = result.message;
        await sendSafeTelegramMessage(ctx, responseHtml);
      }

      // Persist the assistant response
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

      const recentHistory = await getRecentMessages(user.id, 6);
      await saveMessage(user.id, "user", ticker);
      const result = await processUserMessage(ticker, recentHistory);

      let responseHtml: string;
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
