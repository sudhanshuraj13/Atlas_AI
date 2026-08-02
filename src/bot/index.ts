import { Bot } from "grammy";
import { config } from "../config/index.js";
import { registerOnboardingHandlers } from "./handlers/onboarding.js";
import { registerBriefingHandlers } from "./handlers/briefing.js";
import { registerSettingsHandlers } from "./handlers/settings.js";
import { registerMessageHandlers } from "./handlers/message.js";

/**
 * Registers the Telegram slash commands menu with Telegram servers.
 * Makes `/briefing`, `/agenda`, `/settings`, `/start` popup automatically when user types `/`.
 */
export async function setBotCommands(bot: Bot): Promise<void> {
  try {
    await bot.api.setMyCommands([
      { command: "briefing", description: "📊 Daily market intelligence digest" },
      { command: "agenda", description: "📅 Today's meetings & company prep" },
      { command: "settings", description: "⚙️ Watchlist, industry & briefing time" },
      { command: "start", description: "👋 Welcome & onboarding setup" },
    ]);
    console.log("✅ Telegram command menu registered (/briefing, /agenda, /settings, /start)");
  } catch (err) {
    console.warn("⚠️ Failed to set Telegram bot commands menu:", err);
  }
}

/** Create and configure the grammY bot instance. */
export function createBot(): Bot {
  const bot = new Bot(config.TELEGRAM_BOT_TOKEN);

  // Global error handler
  bot.catch((err) => {
    console.error("❌ Bot error:", err.error);
  });

  // Register handlers in order (commands first, then generic message handler)
  registerOnboardingHandlers(bot);
  registerBriefingHandlers(bot);
  registerSettingsHandlers(bot);
  registerMessageHandlers(bot);

  return bot;
}
