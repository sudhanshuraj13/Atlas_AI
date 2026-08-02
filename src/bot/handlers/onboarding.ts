import type { Bot, CallbackQueryContext, Context } from "grammy";
import { InlineKeyboard } from "grammy";
import { getOrCreateUser, updateUserPreferences } from "../../db/userRepository.js";
import { sendSafeTelegramMessage } from "../../utils/telegram.js";

/** Callback data constants to avoid magic strings. */
const CALLBACK = {
  INDUSTRY_FINANCE: "onboard:industry:finance",
  INDUSTRY_TECH: "onboard:industry:tech",
  SKIP: "onboard:skip",
} as const;

/** Register the /start command and onboarding callback handlers. */
export function registerOnboardingHandlers(bot: Bot): void {
  bot.command("start", async (ctx) => {
    const from = ctx.from;
    if (!from) return;

    // Upsert user in database (thin handler — delegates to repository)
    const user = await getOrCreateUser(
      BigInt(from.id),
      from.first_name,
      from.username
    );

    // Build greeting with inline keyboard
    const greeting = [
      `<b>👋 Welcome to Atlas AI, ${user.firstName}!</b>`,
      "",
      "I'm your personal market intelligence assistant.",
      "Let's set up your preferences so I can deliver briefings tailored to you.",
      "",
      "<i>Which industry do you follow?</i>",
    ].join("\n");

    const keyboard = new InlineKeyboard()
      .text("📈 Finance & Markets", CALLBACK.INDUSTRY_FINANCE)
      .row()
      .text("🚀 Tech & Startups", CALLBACK.INDUSTRY_TECH)
      .row()
      .text("⏩ Skip Onboarding", CALLBACK.SKIP);

    await sendSafeTelegramMessage(ctx, greeting, {
      reply_markup: keyboard,
    });
  });

  // --- Callback query handlers ---

  bot.callbackQuery(CALLBACK.INDUSTRY_FINANCE, async (ctx) => {
    await handleIndustrySelection(ctx, ["Finance"], "📈 Finance & Markets");
  });

  bot.callbackQuery(CALLBACK.INDUSTRY_TECH, async (ctx) => {
    await handleIndustrySelection(ctx, ["Tech", "Startups"], "🚀 Tech & Startups");
  });

  bot.callbackQuery(CALLBACK.SKIP, async (ctx) => {
    const from = ctx.from;
    if (!from) return;

    const user = await getOrCreateUser(
      BigInt(from.id),
      from.first_name,
      from.username
    );

    await updateUserPreferences(user.id, { onboardingDone: true });

    const stockKeyboard = new InlineKeyboard()
      .text("🍎 AAPL", "action:query:AAPL")
      .text("🟢 NVDA", "action:query:NVDA")
      .row()
      .text("⚡ TSLA", "action:query:TSLA")
      .text("🛍️ BABA", "action:query:BABA");

    await ctx.editMessageText(
      [
        "<b>⏩ Onboarding skipped!</b>",
        "",
        "No worries — you can update your preferences anytime with <code>/settings</code>.",
        "",
        "I've set you up with defaults:",
        "• <b>Industries:</b> Finance",
        "• <b>Watchlist:</b> AAPL, NVDA, TSLA",
        "• <b>Briefing Time:</b> 08:00 UTC",
        "",
        "👇 <b>Tap a stock below for an instant briefing, or type any ticker:</b>",
      ].join("\n"),
      {
        parse_mode: "HTML",
        reply_markup: stockKeyboard,
      }
    );

    await ctx.answerCallbackQuery({ text: "Onboarding skipped" });
  });
}

/** Shared handler for industry selection callbacks. */
async function handleIndustrySelection(
  ctx: CallbackQueryContext<Context>,
  industries: string[],
  label: string
): Promise<void> {
  const from = ctx.from;
  if (!from) return;

  const user = await getOrCreateUser(
    BigInt(from.id),
    from.first_name,
    from.username
  );

  await updateUserPreferences(user.id, {
    industries,
    onboardingDone: true,
  });

  const stockKeyboard = new InlineKeyboard()
    .text("🍎 AAPL", "action:query:AAPL")
    .text("🟢 NVDA", "action:query:NVDA")
    .row()
    .text("⚡ TSLA", "action:query:TSLA")
    .text("🛍️ BABA", "action:query:BABA");

  await ctx.editMessageText(
    [
      `<b>✅ Preferences updated!</b>`,
      "",
      `You selected: <b>${label}</b>`,
      "",
      "Your default watchlist is set to: <b>AAPL, NVDA, TSLA</b>",
      "Briefing time: <b>08:00 UTC</b>",
      "",
      "👇 <b>Tap a stock below for an instant briefing, or type any ticker:</b>",
    ].join("\n"),
    {
      parse_mode: "HTML",
      reply_markup: stockKeyboard,
    }
  );

  await ctx.answerCallbackQuery({ text: `Selected: ${label}` });
}
