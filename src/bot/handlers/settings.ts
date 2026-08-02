import type { Bot } from "grammy";
import { InlineKeyboard } from "grammy";
import { getOrCreateUser, updateUserPreferences } from "../../db/userRepository.js";
import { sendSafeTelegramMessage } from "../../utils/telegram.js";

const AVAILABLE_TICKERS = ["AAPL", "NVDA", "TSLA", "MSFT", "AMZN", "GOOGL", "META", "BABA"];
const AVAILABLE_TIMES = [
  { label: "🌅 08:00 UTC", value: "08:00" },
  { label: "☀️ 13:00 UTC", value: "13:00" },
  { label: "🌆 18:00 UTC", value: "18:00" },
];

function buildSettingsKeyboard(
  watchlist: string[],
  currentTime: string
): InlineKeyboard {
  const keyboard = new InlineKeyboard();

  // Watchlist toggle buttons (2 per row)
  for (let i = 0; i < AVAILABLE_TICKERS.length; i += 2) {
    const sym1 = AVAILABLE_TICKERS[i];
    const isSelected1 = watchlist.includes(sym1);
    keyboard.text(
      `${isSelected1 ? "✅" : "➕"} ${sym1}`,
      `action:settings:toggle:${sym1}`
    );

    if (i + 1 < AVAILABLE_TICKERS.length) {
      const sym2 = AVAILABLE_TICKERS[i + 1];
      const isSelected2 = watchlist.includes(sym2);
      keyboard.text(
        `${isSelected2 ? "✅" : "➕"} ${sym2}`,
        `action:settings:toggle:${sym2}`
      );
    }
    keyboard.row();
  }

  // Time toggle buttons
  for (const time of AVAILABLE_TIMES) {
    const isSelected = currentTime === time.value;
    keyboard.text(
      `${isSelected ? "🔘" : "⚪"} ${time.label}`,
      `action:settings:time:${time.value}`
    );
  }
  keyboard.row();

  keyboard.text("📊 Get Briefing Now", "action:briefing:refresh");
  return keyboard;
}

function renderSettingsHtml(
  firstName: string,
  watchlist: string[],
  briefingTime: string,
  industries: string[]
): string {
  return [
    `⚙️ <b>Atlas AI Settings — ${firstName}</b>`,
    "",
    `📋 <b>Current Watchlist:</b> <code>${watchlist.join(", ") || "None"}</code>`,
    `⏰ <b>Scheduled Briefing:</b> <code>${briefingTime} UTC</code>`,
    `🏢 <b>Focus Industries:</b> <i>${industries.join(", ") || "Finance"}</i>`,
    "",
    "━━━━━━━━━━━━━━━━━━",
    "👇 <b>Tap stocks to toggle your watchlist, or select your briefing delivery time:</b>",
  ].join("\n");
}

/** Register the /settings command and interactive configuration callback queries. */
export function registerSettingsHandlers(bot: Bot): void {
  // 1. /settings command handler
  bot.command("settings", async (ctx) => {
    const from = ctx.from;
    if (!from) return;

    const user = await getOrCreateUser(
      BigInt(from.id),
      from.first_name,
      from.username
    );

    const watchlist = user.preference.watchlist ?? ["AAPL", "NVDA", "TSLA"];
    const briefingTime = user.preference.briefingTime ?? "08:00";
    const industries = user.preference.industries ?? ["Finance"];

    const html = renderSettingsHtml(user.firstName, watchlist, briefingTime, industries);
    const keyboard = buildSettingsKeyboard(watchlist, briefingTime);

    await sendSafeTelegramMessage(ctx, html, {
      reply_markup: keyboard,
    });
  });

  // 2. Open watchlist settings from briefing action button
  bot.callbackQuery("action:settings:watchlist", async (ctx) => {
    const from = ctx.from;
    if (!from) return;

    await ctx.answerCallbackQuery();

    const user = await getOrCreateUser(
      BigInt(from.id),
      from.first_name,
      from.username
    );

    const watchlist = user.preference.watchlist ?? ["AAPL", "NVDA", "TSLA"];
    const briefingTime = user.preference.briefingTime ?? "08:00";
    const industries = user.preference.industries ?? ["Finance"];

    const html = renderSettingsHtml(user.firstName, watchlist, briefingTime, industries);
    const keyboard = buildSettingsKeyboard(watchlist, briefingTime);

    await ctx.editMessageText(html, {
      parse_mode: "HTML",
      reply_markup: keyboard,
    });
  });

  // 3. Toggle Ticker in Watchlist
  bot.callbackQuery(/^action:settings:toggle:/, async (ctx) => {
    const from = ctx.from;
    if (!from) return;

    const ticker = ctx.callbackQuery.data.split(":")[3];
    if (!ticker) return;

    const user = await getOrCreateUser(
      BigInt(from.id),
      from.first_name,
      from.username
    );

    let currentWatchlist = [...(user.preference.watchlist ?? ["AAPL", "NVDA", "TSLA"])];

    if (currentWatchlist.includes(ticker)) {
      // Don't allow removing if only 1 item left
      if (currentWatchlist.length <= 1) {
        await ctx.answerCallbackQuery({
          text: "⚠️ You must keep at least 1 stock in your watchlist.",
          show_alert: true,
        });
        return;
      }
      currentWatchlist = currentWatchlist.filter((t) => t !== ticker);
      await ctx.answerCallbackQuery({ text: `Removed ${ticker}` });
    } else {
      // Max 6 stocks in watchlist
      if (currentWatchlist.length >= 6) {
        await ctx.answerCallbackQuery({
          text: "⚠️ Watchlist limit reached (max 6 stocks).",
          show_alert: true,
        });
        return;
      }
      currentWatchlist.push(ticker);
      await ctx.answerCallbackQuery({ text: `Added ${ticker}` });
    }

    const updatedPref = await updateUserPreferences(user.id, {
      watchlist: currentWatchlist,
    });

    const html = renderSettingsHtml(
      user.firstName,
      updatedPref.watchlist,
      updatedPref.briefingTime,
      updatedPref.industries
    );
    const keyboard = buildSettingsKeyboard(
      updatedPref.watchlist,
      updatedPref.briefingTime
    );

    await ctx.editMessageText(html, {
      parse_mode: "HTML",
      reply_markup: keyboard,
    });
  });

  // 4. Change Briefing Time
  bot.callbackQuery(/^action:settings:time:/, async (ctx) => {
    const from = ctx.from;
    if (!from) return;

    const newTime = ctx.callbackQuery.data.split(":")[3];
    if (!newTime) return;

    const user = await getOrCreateUser(
      BigInt(from.id),
      from.first_name,
      from.username
    );

    const updatedPref = await updateUserPreferences(user.id, {
      briefingTime: newTime,
    });

    await ctx.answerCallbackQuery({
      text: `⏰ Briefing time updated to ${newTime} UTC`,
    });

    const html = renderSettingsHtml(
      user.firstName,
      updatedPref.watchlist,
      updatedPref.briefingTime,
      updatedPref.industries
    );
    const keyboard = buildSettingsKeyboard(
      updatedPref.watchlist,
      updatedPref.briefingTime
    );

    await ctx.editMessageText(html, {
      parse_mode: "HTML",
      reply_markup: keyboard,
    });
  });
}
