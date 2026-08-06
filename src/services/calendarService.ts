/**
 * Calendar Service for Atlas AI.
 * Handles Google Calendar event fetching, webhook registration for push
 * notifications, and incremental sync via sync tokens.
 * Falls back to mock events when Google credentials are not configured.
 */

import { google } from "googleapis";
import type { OAuth2Client } from "google-auth-library";
import { randomUUID } from "node:crypto";
import { prisma } from "../db/client.js";
import { AuthService } from "./authService.js";

export interface CalendarEvent {
  title: string;
  time: string;
  ticker?: string;
  description?: string;
}

/** Describes a change detected via incremental sync. */
export interface CalendarChange {
  type: "added" | "modified" | "cancelled";
  title: string;
  time: string;
  description?: string;
}

/** Known mapping of keywords in meeting titles to stock ticker symbols. */
const KEYWORD_TICKER_MAP: Record<string, string> = {
  nvidia: "NVDA",
  nvda: "NVDA",
  apple: "AAPL",
  aapl: "AAPL",
  tesla: "TSLA",
  tsla: "TSLA",
  microsoft: "MSFT",
  msft: "MSFT",
  google: "GOOGL",
  alphabet: "GOOGL",
  amazon: "AMZN",
  amzn: "AMZN",
  meta: "META",
  facebook: "META",
  alibaba: "BABA",
  baba: "BABA",
  coinbase: "COIN",
  palantir: "PLTR",
};

/**
 * Extracts a relevant stock ticker from an event title if mentioned.
 */
export function extractTickerFromTitle(title: string): string | undefined {
  const words = title.toLowerCase().split(/[\s,.:;()\-]+/);
  for (const word of words) {
    if (KEYWORD_TICKER_MAP[word]) {
      return KEYWORD_TICKER_MAP[word];
    }
  }
  return undefined;
}

export class CalendarService {
  /**
   * Fetches upcoming calendar events for a user for today.
   * Accepts either a Prisma User ID (string) or a Telegram ID (bigint).
   * If the user has authenticated with Google OAuth, uses their credentials.
   * Otherwise falls back to API key or mock events.
   */
  public static async getUpcomingEvents(
    userIdentifier?: string | bigint
  ): Promise<CalendarEvent[]> {
    // Resolve to telegramId for OAuth lookup
    let telegramId: bigint | undefined;
    if (typeof userIdentifier === "bigint") {
      telegramId = userIdentifier;
    } else if (typeof userIdentifier === "string" && userIdentifier) {
      try {
        const user = await prisma.user.findUnique({
          where: { id: userIdentifier },
          select: { telegramId: true },
        });
        telegramId = user?.telegramId ?? undefined;
      } catch {
        // Lookup failed — fall through to API key / mock
      }
    }

    // Attempt OAuth-based fetch if we have a telegramId
    if (telegramId) {
      try {
        const authClient = await AuthService.getAuthedClient(telegramId);
        if (authClient) {
          return await CalendarService.fetchEventsWithOAuth(authClient);
        }
      } catch (err) {
        console.warn("⚠️ OAuth calendar fetch failed, trying API key fallback:", err);
      }
    }

    // Fallback: API key based fetch
    const apiKey = process.env["GOOGLE_CALENDAR_API_KEY"]?.trim();
    if (apiKey) {
      try {
        return await CalendarService.fetchEventsWithApiKey(apiKey);
      } catch (err) {
        console.warn("⚠️ API key calendar fetch failed, falling back to mock schedule:", err);
      }
    }

    // No credentials configured — return empty (no fake data)
    return [];
  }

  /** Fetch events using an authenticated OAuth2 client. */
  private static async fetchEventsWithOAuth(
    authClient: OAuth2Client
  ): Promise<CalendarEvent[]> {
    const calendar = google.calendar({ version: "v3", auth: authClient });

    const now = new Date();
    const endOfDay = new Date();
    endOfDay.setHours(23, 59, 59, 999);

    const response = await calendar.events.list({
      calendarId: "primary",
      timeMin: now.toISOString(),
      timeMax: endOfDay.toISOString(),
      singleEvents: true,
      orderBy: "startTime",
    });

    if (!response.data.items || response.data.items.length === 0) {
      return [];
    }

    return response.data.items.map((item) => {
      const summary = item.summary || "Untitled Meeting";
      const start = item.start?.dateTime
        ? new Date(item.start.dateTime).toLocaleTimeString("en-US", {
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
          })
        : "All Day";

      return {
        title: summary,
        time: start,
        ticker: extractTickerFromTitle(summary),
        description: item.description ?? undefined,
      };
    });
  }

  /** Fetch events using a simple API key (public calendars only). */
  private static async fetchEventsWithApiKey(
    apiKey: string
  ): Promise<CalendarEvent[]> {
    const calendarId = process.env["GOOGLE_CALENDAR_ID"]?.trim() || "primary";
    const now = new Date();
    const endOfDay = new Date();
    endOfDay.setHours(23, 59, 59, 999);

    const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(
      calendarId
    )}/events?timeMin=${now.toISOString()}&timeMax=${endOfDay.toISOString()}&singleEvents=true&orderBy=startTime&key=${apiKey}`;

    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`Calendar API returned ${res.status}`);
    }

    const data: any = await res.json();
    if (!Array.isArray(data.items) || data.items.length === 0) {
      return [];
    }

    return data.items.map((item: any) => {
      const summary = item.summary || "Untitled Meeting";
      const start = item.start?.dateTime
        ? new Date(item.start.dateTime).toLocaleTimeString("en-US", {
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
          })
        : "All Day";

      return {
        title: summary,
        time: start,
        ticker: extractTickerFromTitle(summary),
        description: item.description,
      };
    });
  }

  /**
   * Registers a Google Calendar push notification webhook for a user.
   * Subscribes to changes on the user's primary calendar.
   */
  public static async registerWebhook(telegramId: bigint): Promise<void> {
    try {
      const authClient = await AuthService.getAuthedClient(telegramId);
      if (!authClient) {
        console.warn(`⚠️ [Calendar] No auth client for user ${telegramId}, skipping webhook`);
        return;
      }

      const appUrl = process.env["APP_URL"]?.trim();
      if (!appUrl) {
        console.warn("⚠️ [Calendar] APP_URL not set, cannot register webhook");
        return;
      }

      const calendar = google.calendar({ version: "v3", auth: authClient });
      const channelId = randomUUID();

      const response = await calendar.events.watch({
        calendarId: "primary",
        requestBody: {
          id: channelId,
          type: "web_hook",
          address: `${appUrl}/webhooks/calendar`,
        },
      });

      // Save the channel ID to the user record
      await prisma.user.update({
        where: { telegramId },
        data: { webhookChannelId: channelId },
      });

      console.log(
        `✅ [Calendar] Webhook registered for user ${telegramId} ` +
          `(channelId: ${channelId}, resourceId: ${response.data.resourceId})`
      );
    } catch (err) {
      console.error(`❌ [Calendar] Failed to register webhook for user ${telegramId}:`, err);
    }
  }

  /**
   * Handles an incoming Google Calendar push notification.
   * Looks up the user by channelId, performs incremental sync,
   * and returns detected changes for Telegram notification.
   */
  public static async handleWebhookNotification(
    channelId: string,
    _resourceId: string
  ): Promise<{ telegramId: bigint; changes: CalendarChange[] } | null> {
    try {
      // Find the user who owns this webhook channel
      const user = await prisma.user.findFirst({
        where: { webhookChannelId: channelId },
        select: {
          telegramId: true,
          calendarSyncToken: true,
          accessToken: true,
        },
      });

      if (!user || !user.accessToken) {
        console.warn(`⚠️ [Calendar] Webhook received for unknown channel: ${channelId}`);
        return null;
      }

      // Perform incremental sync
      const changes = await CalendarService.processIncrementalSync(
        user.telegramId,
        user.calendarSyncToken
      );

      return { telegramId: user.telegramId, changes };
    } catch (err) {
      console.error(`❌ [Calendar] Webhook processing failed for channel ${channelId}:`, err);
      return null;
    }
  }

  /**
   * Performs incremental sync using Google Calendar sync tokens.
   * First call (no syncToken) gets a full sync and stores the token.
   * Subsequent calls use the token for incremental change detection.
   */
  public static async processIncrementalSync(
    telegramId: bigint,
    existingSyncToken: string | null
  ): Promise<CalendarChange[]> {
    const authClient = await AuthService.getAuthedClient(telegramId);
    if (!authClient) return [];

    const calendar = google.calendar({ version: "v3", auth: authClient });
    const changes: CalendarChange[] = [];
    let pageToken: string | undefined;
    let newSyncToken: string | undefined;

    try {
      do {
        const params: any = {
          calendarId: "primary",
          singleEvents: true,
        };

        if (existingSyncToken && !pageToken) {
          // Incremental sync
          params.syncToken = existingSyncToken;
        } else if (!existingSyncToken && !pageToken) {
          // Full sync — only get today's events to keep payload small
          const now = new Date();
          const endOfDay = new Date();
          endOfDay.setHours(23, 59, 59, 999);
          params.timeMin = now.toISOString();
          params.timeMax = endOfDay.toISOString();
          params.orderBy = "startTime";
        }

        if (pageToken) {
          params.pageToken = pageToken;
        }

        const response = await calendar.events.list(params);

        if (response.data.items) {
          for (const event of response.data.items) {
            const summary = event.summary || "Untitled Meeting";
            const start = event.start?.dateTime
              ? new Date(event.start.dateTime).toLocaleTimeString("en-US", {
                  hour: "2-digit",
                  minute: "2-digit",
                  hour12: false,
                })
              : "All Day";

            if (event.status === "cancelled") {
              changes.push({
                type: "cancelled",
                title: summary,
                time: start,
              });
            } else if (existingSyncToken) {
              // During incremental sync, any non-cancelled event is
              // either new or modified
              changes.push({
                type: event.created === event.updated ? "added" : "modified",
                title: summary,
                time: start,
                description: event.description ?? undefined,
              });
            }
          }
        }

        pageToken = response.data.nextPageToken ?? undefined;
        if (response.data.nextSyncToken) {
          newSyncToken = response.data.nextSyncToken;
        }
      } while (pageToken);

      // Persist the new sync token
      if (newSyncToken) {
        await prisma.user.update({
          where: { telegramId },
          data: { calendarSyncToken: newSyncToken },
        });
      }
    } catch (err: any) {
      // If sync token is invalid (410 Gone), reset and do full sync
      if (err?.code === 410 || err?.status === 410) {
        console.warn(`⚠️ [Calendar] Sync token expired for user ${telegramId}, resetting`);
        await prisma.user.update({
          where: { telegramId },
          data: { calendarSyncToken: null },
        });
        return CalendarService.processIncrementalSync(telegramId, null);
      }
      throw err;
    }

    return changes;
  }

  /**
   * Formats a list of calendar events into a clean text block for the LLM prompt.
   */
  public static formatAgendaForPrompt(events: CalendarEvent[]): string {
    if (!events || events.length === 0) {
      return "No upcoming meetings scheduled for today.";
    }

    return events
      .map((e) => {
        const tickerTag = e.ticker ? ` (Associated Stock Ticker: $${e.ticker})` : "";
        return `• [${e.time}] ${e.title}${tickerTag}`;
      })
      .join("\n");
  }

  /**
   * Formats webhook changes into a Telegram notification message.
   */
  public static formatChangesForTelegram(changes: CalendarChange[]): string {
    if (changes.length === 0) return "";

    const lines = changes.map((c) => {
      const emoji =
        c.type === "added" ? "🆕" : c.type === "modified" ? "✏️" : "❌";
      const label =
        c.type === "added"
          ? "New meeting"
          : c.type === "modified"
            ? "Updated"
            : "Cancelled";
      return `${emoji} <b>${label}:</b> ${c.title} at ${c.time}`;
    });

    return [
      "<b>📅 Calendar Update</b>",
      "",
      ...lines,
    ].join("\n");
  }
}
