import type { Bot } from "grammy";
import { InlineKeyboard } from "grammy";
import { isOAuthConfigured } from "../../services/authService.js";

/**
 * /login command handler — sends the user an inline keyboard button
 * linking to the Google OAuth2 consent screen.
 */
export function registerAuthHandlers(bot: Bot): void {
  bot.command("login", async (ctx) => {
    const from = ctx.from;
    if (!from) return;

    // Guard: OAuth must be configured
    if (!isOAuthConfigured()) {
      await ctx.reply(
        "⚠️ Google Calendar integration is not configured yet.\n" +
          "The admin needs to set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REDIRECT_URI.",
        { parse_mode: "HTML" }
      );
      return;
    }

    const appUrl = process.env["APP_URL"]?.trim();
    if (!appUrl) {
      await ctx.reply(
        "⚠️ APP_URL is not configured. Cannot generate login link.",
        { parse_mode: "HTML" }
      );
      return;
    }

    // Build the auth URL — pass the Telegram user ID as the state parameter
    const authUrl = `${appUrl}/auth/google?state=${from.id}`;

    const keyboard = new InlineKeyboard().url(
      "🔐 Connect Google Calendar",
      authUrl
    );

    await ctx.reply(
      [
        "<b>🔐 Google Calendar Login</b>",
        "",
        "Connect your Google Calendar to get:",
        "• Real-time meeting notifications",
        "• Automatic agenda sync",
        "• Smart meeting prep with stock data",
        "",
        "Tap the button below to authenticate securely with Google.",
      ].join("\n"),
      {
        parse_mode: "HTML",
        reply_markup: keyboard,
      }
    );
  });
}
