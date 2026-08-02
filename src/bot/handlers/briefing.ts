import type { Bot } from "grammy";
import { getOrCreateUser, saveMessage } from "../../db/userRepository.js";
import {
  generateDailyBriefing,
  generateAgendaBriefing,
} from "../../services/briefingService.js";
import { sendSafeTelegramMessage } from "../../utils/telegram.js";

/** Register the /briefing, /agenda commands and callback query handlers (Law 4, Law 11, Law 12). */
export function registerBriefingHandlers(bot: Bot): void {
  // 1. Manual /briefing command (Instant On-Demand Briefing)
  bot.command("briefing", async (ctx) => {
    const from = ctx.from;
    if (!from) return;

    // Send typing action immediately (Law 3)
    await ctx.replyWithChatAction("typing");

    try {
      const user = await getOrCreateUser(
        BigInt(from.id),
        from.first_name,
        from.username
      );

      await saveMessage(user.id, "user", "/briefing");

      const briefing = await generateDailyBriefing(user.id);

      await sendSafeTelegramMessage(ctx, briefing.html, {
        reply_markup: briefing.keyboard,
      });

      await saveMessage(user.id, "assistant", briefing.html);
    } catch (error) {
      console.error("❌ Briefing command error:", error);
      await sendSafeTelegramMessage(
        ctx,
        "⚠️ I couldn't generate your briefing right now. Please try again in a moment."
      );
    }
  });

  // 2. Refresh Briefing Feed Callback Query
  bot.callbackQuery("action:briefing:refresh", async (ctx) => {
    const from = ctx.from;
    if (!from) return;

    await ctx.answerCallbackQuery({ text: "🔄 Fetching fresh market data..." });
    await ctx.replyWithChatAction("typing");

    try {
      const user = await getOrCreateUser(
        BigInt(from.id),
        from.first_name,
        from.username
      );

      const briefing = await generateDailyBriefing(user.id);

      await sendSafeTelegramMessage(ctx, briefing.html, {
        reply_markup: briefing.keyboard,
      });

      await saveMessage(user.id, "assistant", briefing.html);
    } catch (error) {
      console.error("❌ Refresh briefing callback error:", error);
      await sendSafeTelegramMessage(
        ctx,
        "⚠️ Failed to refresh market feed. Please try again."
      );
    }
  });

  // 3. /agenda command — Today's meetings & stock intelligence prep (Day 4)
  bot.command("agenda", async (ctx) => {
    const from = ctx.from;
    if (!from) return;

    await ctx.replyWithChatAction("typing");

    try {
      const user = await getOrCreateUser(
        BigInt(from.id),
        from.first_name,
        from.username
      );

      await saveMessage(user.id, "user", "/agenda");

      const agendaResult = await generateAgendaBriefing(user.id);

      await sendSafeTelegramMessage(ctx, agendaResult.html, {
        reply_markup: agendaResult.keyboard,
      });

      await saveMessage(user.id, "assistant", agendaResult.html);
    } catch (error) {
      console.error("❌ Agenda command error:", error);
      await sendSafeTelegramMessage(
        ctx,
        "⚠️ I couldn't fetch your meeting agenda right now. Please try again in a moment."
      );
    }
  });

  // 4. Agenda View & Refresh Callback Query
  bot.callbackQuery(["action:agenda:view", "action:agenda:refresh"], async (ctx) => {
    const from = ctx.from;
    if (!from) return;

    await ctx.answerCallbackQuery({ text: "📅 Loading executive agenda..." });
    await ctx.replyWithChatAction("typing");

    try {
      const user = await getOrCreateUser(
        BigInt(from.id),
        from.first_name,
        from.username
      );

      const agendaResult = await generateAgendaBriefing(user.id);

      await sendSafeTelegramMessage(ctx, agendaResult.html, {
        reply_markup: agendaResult.keyboard,
      });

      await saveMessage(user.id, "assistant", agendaResult.html);
    } catch (error) {
      console.error("❌ Agenda callback error:", error);
      await sendSafeTelegramMessage(
        ctx,
        "⚠️ Failed to load agenda briefing. Please try again."
      );
    }
  });
}
