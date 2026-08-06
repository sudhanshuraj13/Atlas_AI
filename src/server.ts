import express from "express";
import http from "node:http";
import type { Bot } from "grammy";
import { AuthService, isOAuthConfigured } from "./services/authService.js";
import { CalendarService } from "./services/calendarService.js";
import { getOrCreateUser } from "./db/userRepository.js";

/**
 * Express-based HTTP server for Atlas AI.
 * Handles health checks, Google OAuth2 callbacks, and Calendar webhook notifications.
 * Replaces the previous raw http.createServer while preserving the /health endpoint.
 */
export function startServer(
  bot: Bot,
  port: number = Number(process.env["PORT"]) || 3000
): http.Server {
  const app = express();

  // Parse JSON bodies for webhook payloads
  app.use(express.json());

  // ─── Health Check (preserved from original) ───────────────────────
  app.get(["/health", "/"], (_req, res) => {
    res.setHeader("Cache-Control", "no-cache");
    res.json({
      status: "ok",
      service: "Atlas AI Telegram Bot",
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.floor(process.uptime()),
    });
  });

  // ─── OAuth2: Redirect to Google Consent ───────────────────────────
  app.get("/auth/google", (req, res) => {
    const state = req.query["state"] as string | undefined;

    if (!state) {
      res.status(400).json({ error: "Missing state parameter (Telegram userId)" });
      return;
    }

    if (!isOAuthConfigured()) {
      res.status(503).json({ error: "OAuth2 not configured" });
      return;
    }

    const authUrl = AuthService.generateAuthUrl(state);
    res.redirect(authUrl);
  });

  // ─── OAuth2: Callback from Google ─────────────────────────────────
  app.get("/auth/google/callback", async (req, res) => {
    const code = req.query["code"] as string | undefined;
    const state = req.query["state"] as string | undefined;

    if (!code || !state) {
      res.status(400).json({ error: "Missing code or state parameter" });
      return;
    }

    try {
      // Exchange authorization code for tokens
      const tokens = await AuthService.exchangeCodeForTokens(code);

      if (!tokens.access_token) {
        res.status(500).json({ error: "No access token received from Google" });
        return;
      }

      const telegramId = BigInt(state);

      // Ensure user exists in the database
      const user = await getOrCreateUser(
        telegramId,
        "User", // Placeholder — will be updated on next bot interaction
        undefined
      );

      // Extract Google user ID from the id_token if available
      let googleId: string | null = null;
      if (tokens.id_token) {
        try {
          const payload = JSON.parse(
            Buffer.from(tokens.id_token.split(".")[1]!, "base64").toString()
          );
          googleId = payload.sub ?? null;
        } catch {
          // id_token parsing is best-effort
        }
      }

      // Persist tokens to Neon database
      await AuthService.saveUserTokens(
        telegramId,
        googleId,
        tokens.access_token,
        tokens.refresh_token,
        tokens.expiry_date
      );

      // Register Calendar webhook for push notifications
      await CalendarService.registerWebhook(telegramId);

      // Notify user via Telegram
      try {
        await bot.api.sendMessage(
          Number(telegramId),
          [
            "✅ <b>Google Calendar Connected!</b>",
            "",
            "Your calendar is now synced with Atlas AI.",
            "You'll receive real-time notifications when meetings are added or changed.",
            "",
            "Try <code>/agenda</code> to see today's meetings.",
          ].join("\n"),
          { parse_mode: "HTML" }
        );
      } catch (telegramErr) {
        console.warn("⚠️ [Auth] Could not send Telegram confirmation:", telegramErr);
      }

      // Redirect to a success page
      res.send(
        `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Atlas AI — Connected</title></head>
<body style="font-family: system-ui, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; background: #0f172a; color: #e2e8f0;">
  <div style="text-align: center; padding: 2rem;">
    <h1 style="font-size: 3rem; margin-bottom: 0.5rem;">✅</h1>
    <h2>Google Calendar Connected!</h2>
    <p style="color: #94a3b8;">You can close this window and return to Telegram.</p>
  </div>
</body>
</html>`
      );

      console.log(`✅ [Auth] User ${user.id} (Telegram: ${state}) authenticated successfully`);
    } catch (err) {
      console.error("❌ [Auth] OAuth callback error:", err);
      res.status(500).json({ error: "Authentication failed. Please try again." });
    }
  });

  // ─── Google Calendar Webhook ──────────────────────────────────────
  app.post("/webhooks/calendar", (req, res) => {
    // Respond immediately with 200 OK to prevent Google from retrying
    res.sendStatus(200);

    // Process the notification asynchronously
    const channelId = req.headers["x-goog-channel-id"] as string | undefined;
    const resourceId = req.headers["x-goog-resource-id"] as string | undefined;
    const resourceState = req.headers["x-goog-resource-state"] as string | undefined;

    if (!channelId || !resourceId) {
      console.warn("⚠️ [Webhook] Missing channel/resource ID headers");
      return;
    }

    // Ignore sync messages (initial verification from Google)
    if (resourceState === "sync") {
      console.log(`🔔 [Webhook] Sync verification received for channel ${channelId}`);
      return;
    }

    // Asynchronous processing — fire and forget
    (async () => {
      try {
        const result = await CalendarService.handleWebhookNotification(
          channelId,
          resourceId
        );

        if (result && result.changes.length > 0) {
          const message = CalendarService.formatChangesForTelegram(result.changes);
          if (message) {
            await bot.api.sendMessage(Number(result.telegramId), message, {
              parse_mode: "HTML",
            });
            console.log(
              `📅 [Webhook] Sent ${result.changes.length} change(s) to user ${result.telegramId}`
            );
          }
        }
      } catch (err) {
        console.error("❌ [Webhook] Async processing error:", err);
      }
    })();
  });

  // ─── 404 fallback ─────────────────────────────────────────────────
  app.use((_req, res) => {
    res.status(404).json({ error: "Not Found" });
  });

  // ─── Start listening ──────────────────────────────────────────────
  const server = app.listen(port, () => {
    console.log(
      `🌐 Express server active on port ${port} ` +
        `(Endpoints: GET /health, GET /auth/google, POST /webhooks/calendar)`
    );

    // Automatic keep-alive self-ping if running on Render/Cloud
    const appUrl = process.env["RENDER_EXTERNAL_URL"] || process.env["APP_URL"];
    if (appUrl) {
      console.log(`📡 Keep-alive self-ping configured for: ${appUrl}/health (every 10m)`);
      setInterval(async () => {
        try {
          const pingRes = await fetch(`${appUrl}/health`);
          if (pingRes.ok) {
            console.log(`💚 Keep-alive self-ping successful: [${pingRes.status}]`);
          }
        } catch (err: any) {
          console.warn(`⚠️ Keep-alive self-ping failed:`, err?.message || String(err));
        }
      }, 10 * 60 * 1000); // Every 10 minutes
    }
  });

  return server;
}
