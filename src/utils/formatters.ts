import type {
  FinancialSummary,
  ChatResponse,
  BriefingDigest,
  AgendaBriefing,
} from "../ai/schemas.js";
import { escapeHtml } from "./telegram.js";

/**
 * Format a structured financial summary into Telegram HTML.
 * Takes raw JSON from the LLM and wraps it in safe HTML tags (Law 8).
 */
export function formatFinancialSummary(data: FinancialSummary, ticker: string): string {
  const sentimentEmoji =
    data.sentiment === "Bullish"
      ? "🟢"
    : data.sentiment === "Bearish"
      ? "🔴"
      : "⚪";

  const changeSign = data.percentageChange >= 0 ? "+" : "";
  const changeEmoji = data.percentageChange >= 0 ? "📈" : "📉";

  const keyFactsFormatted = data.keyFacts
    .map((fact) => `• ${escapeHtml(fact)}`)
    .join("\n");

  return [
    `${changeEmoji} <b>${escapeHtml(data.headline)}</b>`,
    "",
    `<b>Ticker:</b> <code>$${escapeHtml(ticker)}</code>`,
    `<b>Price:</b> <code>$${data.currentPrice.toFixed(2)}</code> (${changeSign}${data.percentageChange.toFixed(2)}%)`,
    `<b>Sentiment:</b> ${sentimentEmoji} ${data.sentiment}`,
    "",
    "━━━━━━━━━━━━━━━━━━",
    "",
    "<b>📰 Key Facts</b>",
    "",
    keyFactsFormatted || "• No notable developments right now.",
    "",
    "━━━━━━━━━━━━━━━━━━",
    "",
    "<b>💡 Why It Matters</b>",
    "",
    `<i>${escapeHtml(data.whyItMatters)}</i>`,
    "",
    `⏱️ <i>Powered by Atlas AI</i>`,
  ].join("\n");
}

/**
 * Format a general chat response into Telegram HTML.
 */
export function formatChatResponse(data: ChatResponse): string {
  return escapeHtml(data.reply);
}

/**
 * Format a multi-ticker daily briefing digest into Telegram HTML (Law 8 & Law 12).
 */
export function formatDailyBriefing(digest: BriefingDigest): string {
  const tickerCards = digest.tickerUpdates
    .map((t) => {
      const sign = t.changePercent >= 0 ? "+" : "";
      const badge = t.changePercent >= 0 ? "🟢" : "🔴";
      return [
        `${badge} <b>$${escapeHtml(t.symbol)}</b> <code>$${t.price.toFixed(2)}</code> (<code>${sign}${t.changePercent.toFixed(2)}%</code>)`,
        `<i>${escapeHtml(t.takeaway)}</i>`,
      ].join("\n");
    })
    .join("\n\n");

  const todayStr = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
  });

  const lines = [
    `☀️ <b>${escapeHtml(digest.greeting)}</b> — <i>${todayStr}</i>`,
    "",
    "🌐 <b>Market Overview</b>",
    `<i>${escapeHtml(digest.marketOverview)}</i>`,
    "",
    "━━━━━━━━━━━━━━━━━━",
    "",
    "📊 <b>Your Watchlist Briefing</b>",
    "",
    tickerCards || "<i>No watchlist data available.</i>",
  ];

  // Calendar & Meeting Prep Section (Law 12)
  if (digest.meetingPrep && digest.meetingPrep.length > 0) {
    const prepCards = digest.meetingPrep
      .map((prep) => {
        return [
          `• <b>${escapeHtml(prep.meetingTitle)}</b> (<code>$${escapeHtml(prep.ticker)}</code>)`,
          `  <i>${escapeHtml(prep.prepTakeaway)}</i>`,
        ].join("\n");
      })
      .join("\n\n");

    lines.push(
      "",
      "━━━━━━━━━━━━━━━━━━",
      "",
      "📅 <b>Today's Agenda & Meeting Prep</b>",
      "",
      prepCards
    );
  }

  lines.push(
    "",
    "━━━━━━━━━━━━━━━━━━",
    "",
    "💡 <b>Actionable Insight</b>",
    `<i>${escapeHtml(digest.actionableInsight)}</i>`,
    "",
    "⏱️ <i>Atlas AI Proactive Intelligence</i>"
  );

  return lines.join("\n");
}

/**
 * Format a dedicated agenda and meeting market briefing into Telegram HTML.
 */
export function formatAgendaBriefing(agenda: AgendaBriefing): string {
  const todayStr = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
  });

  const itemCards = agenda.items
    .map((item) => {
      const tickerTag = item.ticker ? ` (<code>$${escapeHtml(item.ticker)}</code>)` : "";
      return [
        `🕒 <b>${escapeHtml(item.time)}</b> — <b>${escapeHtml(item.title)}</b>${tickerTag}`,
        `<i>${escapeHtml(item.marketContext)}</i>`,
      ].join("\n");
    })
    .join("\n\n");

  return [
    `📅 <b>Today's Executive Agenda</b> — <i>${todayStr}</i>`,
    "",
    `<i>${escapeHtml(agenda.overview)}</i>`,
    "",
    "━━━━━━━━━━━━━━━━━━",
    "",
    itemCards || "<i>No meetings scheduled for today.</i>",
    "",
    "━━━━━━━━━━━━━━━━━━",
    "",
    "🎯 <b>Executive Strategy</b>",
    `<i>${escapeHtml(agenda.executiveAdvice)}</i>`,
    "",
    "⏱️ <i>Powered by Atlas AI Meeting Intelligence</i>",
  ].join("\n");
}
