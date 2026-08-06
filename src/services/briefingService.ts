import { generateStructuredAI } from "../ai/providers.js";
import { InlineKeyboard } from "grammy";
import { getUserWithPreference } from "../db/userRepository.js";
import { getLiveTickerData, type TickerData } from "./finance.js";
import { CalendarService, type CalendarEvent } from "./calendarService.js";
import {
  BriefingDigestSchema,
  AgendaBriefingSchema,
  type BriefingDigest,
  type AgendaBriefing,
} from "../ai/schemas.js";
import { formatDailyBriefing, formatAgendaBriefing } from "../utils/formatters.js";

/** Result shape returned by briefing methods. */
export interface DailyBriefingResult {
  html: string;
  keyboard: InlineKeyboard;
}

const SYSTEM_PROMPT_BRIEFING = `You are the Lead Macro Strategist at Atlas AI.
Your job is to synthesize multi-stock portfolio market data, news headlines, and upcoming calendar events into a crisp, elite morning intelligence briefing:
1. Greeting: A warm, energetic greeting tailored to the morning market session.
2. Market Overview: A single punchy sentence summarizing overall market sentiment (e.g. tech rally, defensive rotation, rate jitters).
3. Ticker Updates: For EACH ticker in the watchlist, write a concise 1-sentence takeaway explaining today's primary catalyst/movement.
4. Meeting Prep (Optional): If any calendar event mentions a company or stock ticker, explicitly create a meeting prep entry showing how that ticker is performing today and what the investor should know heading into the meeting.
5. Actionable Insight: Exactly ONE sentence delivering the most important strategic takeaway for an active investor today.

Be data-driven, objective, and professional (like a Bloomberg Terminal executive briefing).
Do NOT output any HTML or Markdown formatting — output only clean text.`;

const SYSTEM_PROMPT_AGENDA = `You are an Executive AI Chief of Staff and Financial Analyst at Atlas AI.
Synthesize the user's daily meeting schedule with live market intelligence for any mentioned companies:
1. Overview: 1 sentence summarizing the schedule focus.
2. Items: For each meeting, provide the time, title, stock ticker (if applicable), and 1 sentence of sharp market context/talking points before stepping into the room.
3. Executive Advice: 1 tactical sentence to maximize effectiveness across today's agenda.

CRITICAL: Only use the meetings provided in the prompt. NEVER invent, fabricate, or hallucinate meetings that are not explicitly listed. If no meetings are provided, say the calendar is clear.
Do NOT output any HTML or Markdown formatting — output only clean text.`;

/**
 * Fallback digest generator when LLM is rate-limited or unavailable.
 * Generates a clean BriefingDigest directly from live Yahoo Finance data and Calendar events.
 */
function createFallbackDigest(
  firstName: string,
  tickerDataList: TickerData[],
  events: CalendarEvent[] = []
): BriefingDigest {
  const avgChange =
    tickerDataList.reduce((acc, t) => acc + t.percentageChange, 0) /
    (tickerDataList.length || 1);

  const marketTone =
    avgChange > 0.5
      ? "Markets are showing positive momentum across your watchlist today."
      : avgChange < -0.5
        ? "Markets are seeing cautious risk-off pressure across key sectors."
        : "Markets are trading in a mixed, consolidation range today.";

  const tickerUpdates = tickerDataList.map((t) => {
    const isUp = t.percentageChange >= 0;
    const headline = t.newsHeadlines[0] ? ` Catalyzed by: "${t.newsHeadlines[0]}"` : "";
    return {
      symbol: t.symbol,
      price: t.currentPrice,
      changePercent: t.percentageChange,
      takeaway: `${t.shortName} is ${isUp ? "up" : "down"} ${Math.abs(t.percentageChange).toFixed(2)}% trading at $${t.currentPrice.toFixed(2)}.${headline}`,
    };
  });

  const meetingPrep = events
    .filter((e) => e.ticker)
    .map((e) => {
      const match = tickerDataList.find((t) => t.symbol === e.ticker);
      const stockInfo = match
        ? `trading at $${match.currentPrice.toFixed(2)} (${match.percentageChange > 0 ? "+" : ""}${match.percentageChange.toFixed(2)}%)`
        : "in focus today";
      return {
        meetingTitle: `${e.title} (${e.time})`,
        ticker: e.ticker!,
        prepTakeaway: `${e.ticker} is ${stockInfo}. Review recent catalyst developments before this discussion.`,
      };
    });

  return {
    greeting: `Good day, ${firstName}! Here is your market digest.`,
    marketOverview: marketTone,
    tickerUpdates,
    meetingPrep: meetingPrep.length > 0 ? meetingPrep : undefined,
    actionableInsight: `Monitor volume leaders as volatility index remains active during today's session.`,
  };
}

/**
 * Generate a personalized daily intelligence briefing for a user (Day 3 & 4 Engine).
 * 1. Loads user preferences & watchlist.
 * 2. Fetches upcoming calendar events & cross-references tickers (Law 12).
 * 3. Fetches live quote + news data in parallel.
 * 4. Synthesizes intelligence via AI with structured schema.
 * 5. Formats into Telegram HTML with interactive buttons.
 */
export async function generateDailyBriefing(
  userId: string
): Promise<DailyBriefingResult> {
  const user = await getUserWithPreference(userId);
  const firstName = user?.firstName ?? "Investor";
  const userWatchlist =
    user?.preference?.watchlist && user.preference.watchlist.length > 0
      ? user.preference.watchlist
      : ["AAPL", "NVDA", "TSLA"];

  // 1. Fetch Calendar Events (Law 12)
  const events = await CalendarService.getUpcomingEvents(userId);

  // Combine watchlist with any tickers mentioned in calendar events
  const combinedTickersSet = new Set<string>(
    userWatchlist.map((s: string) => s.trim().toUpperCase())
  );
  for (const e of events) {
    if (e.ticker) {
      combinedTickersSet.add(e.ticker.toUpperCase());
    }
  }
  const allTickersToFetch = Array.from(combinedTickersSet);

  // 2. Parallel live data fetching via Yahoo Finance (Law 6)
  const settled = await Promise.allSettled(
    allTickersToFetch.map((symbol) => getLiveTickerData(symbol))
  );

  const validTickers: TickerData[] = [];
  for (const item of settled) {
    if (item.status === "fulfilled") {
      validTickers.push(item.value);
    }
  }

  // Filter watchlist items to preserve user's primary watchlist order
  const watchlistData = validTickers.filter((t) =>
    userWatchlist.includes(t.symbol)
  );
  const finalWatchlistData = watchlistData.length > 0 ? watchlistData : validTickers;

  // If all ticker fetches failed, provide a graceful fallback
  if (validTickers.length === 0) {
    const errorHtml = [
      `<b>⚠️ Daily Briefing Unavailable</b>`,
      "",
      `We could not reach the market data provider for symbols: <code>${userWatchlist.join(", ")}</code>.`,
      "Please check your watchlist in <code>/settings</code> or try again in a few moments.",
    ].join("\n");

    const fallbackKeyboard = new InlineKeyboard()
      .text("📊 Refresh Feed", "action:briefing:refresh")
      .text("📅 View Agenda", "action:agenda:view")
      .text("⚙️ Edit Watchlist", "action:settings:watchlist");

    return { html: errorHtml, keyboard: fallbackKeyboard };
  }

  // 3. Synthesize with AI (Law 5, Law 7, Law 12)
  const rawPromptLines = [
    `User: ${firstName}`,
    `Industries: ${(user?.preference?.industries ?? ["Finance"]).join(", ")}`,
    "",
    "Upcoming Calendar Schedule:",
    CalendarService.formatAgendaForPrompt(events),
    "",
    "Raw Market Data:",
    ...validTickers.map((t) =>
      [
        `Ticker: ${t.symbol} (${t.shortName})`,
        `Price: $${t.currentPrice.toFixed(2)}`,
        `Change: ${t.percentageChange > 0 ? "+" : ""}${t.percentageChange.toFixed(2)}%`,
        `Volume: ${t.volume.toLocaleString()}`,
        `Market Cap: $${(t.marketCap / 1e9).toFixed(2)}B`,
        `News: ${t.newsHeadlines.join(" | ") || "None"}`,
      ].join(" | ")
    ),
  ].join("\n");

  let digest: BriefingDigest;
  try {
    digest = await generateStructuredAI({
      schema: BriefingDigestSchema,
      system: SYSTEM_PROMPT_BRIEFING,
      prompt: rawPromptLines,
    });
  } catch (err) {
    console.warn("⚠️ Briefing AI synthesis rate-limited or failed, using live fallback:", err);
    digest = createFallbackDigest(firstName, finalWatchlistData, events);
  }

  // 4. Format via UI layer (Law 8)
  const html = formatDailyBriefing(digest);

  // 5. Attach action buttons
  const keyboard = new InlineKeyboard()
    .text("📊 Refresh Feed", "action:briefing:refresh")
    .text("📅 View Agenda", "action:agenda:view")
    .row()
    .text("⚙️ Edit Watchlist", "action:settings:watchlist");

  return { html, keyboard };
}

/**
 * Generate a dedicated Agenda & Meeting Prep Briefing for /agenda command (Day 4).
 */
export async function generateAgendaBriefing(
  userId?: string
): Promise<DailyBriefingResult> {
  const events = await CalendarService.getUpcomingEvents(userId);

  // If no events, return a clean "no meetings" response immediately
  // instead of sending empty data to the LLM (which may hallucinate)
  if (events.length === 0) {
    const today = new Date().toLocaleDateString("en-US", {
      weekday: "long",
      month: "short",
      day: "numeric",
    });

    const html = [
      `<b>📅 Today's Agenda — ${today}</b>`,
      "",
      "Your calendar is clear for today. No upcoming meetings found.",
      "",
      "💡 <i>Connect your Google Calendar with /login to see real events.</i>",
    ].join("\n");

    const keyboard = new InlineKeyboard()
      .text("🔄 Refresh Agenda", "action:agenda:refresh");

    return { html, keyboard };
  }

  // Fetch live market data for any meeting-related tickers
  const meetingTickers = Array.from(
    new Set(events.map((e) => e.ticker).filter((t): t is string => Boolean(t)))
  );

  const settled = await Promise.allSettled(
    meetingTickers.map((sym) => getLiveTickerData(sym))
  );

  const marketDataMap = new Map<string, TickerData>();
  for (const item of settled) {
    if (item.status === "fulfilled") {
      marketDataMap.set(item.value.symbol, item.value);
    }
  }

  const promptLines = [
    "Today's Scheduled Meetings:",
    ...events.map((e) => {
      const tData = e.ticker ? marketDataMap.get(e.ticker) : undefined;
      const stockContext = tData
        ? ` [Stock: $${tData.symbol} at $${tData.currentPrice.toFixed(2)} (${tData.percentageChange > 0 ? "+" : ""}${tData.percentageChange.toFixed(2)}%), News: ${tData.newsHeadlines[0] || "None"}]`
        : "";
      return `• [${e.time}] ${e.title}${e.description ? ` (${e.description})` : ""}${stockContext}`;
    }),
  ].join("\n");

  let agendaBriefing: AgendaBriefing;
  try {
    agendaBriefing = await generateStructuredAI({
      schema: AgendaBriefingSchema,
      system: SYSTEM_PROMPT_AGENDA,
      prompt: promptLines,
    });
  } catch (err) {
    console.warn("⚠️ Agenda AI synthesis failed, using rule-based fallback:", err);
    agendaBriefing = {
      overview: `You have ${events.length} strategic meetings scheduled for today across key portfolio companies.`,
      items: events.map((e) => {
        const tData = e.ticker ? marketDataMap.get(e.ticker) : undefined;
        const context = tData
          ? `$${tData.symbol} is trading at $${tData.currentPrice.toFixed(2)} (${tData.percentageChange > 0 ? "+" : ""}${tData.percentageChange.toFixed(2)}%). ${tData.newsHeadlines[0] || "Review latest market updates before attending."}`
          : "Prepare agenda points and align on next quarterly deliverables.";
        return {
          time: e.time,
          title: e.title,
          ticker: e.ticker || null,
          marketContext: context,
        };
      }),
      executiveAdvice: "Focus discussions on high-impact strategic deliverables and capital allocation efficiency.",
    };
  }

  const html = formatAgendaBriefing(agendaBriefing);

  const keyboard = new InlineKeyboard();
  for (const sym of meetingTickers) {
    keyboard.text(`📊 Check $${sym}`, `action:query:${sym}`);
  }
  keyboard.row().text("🔄 Refresh Agenda", "action:agenda:refresh");

  return { html, keyboard };
}
