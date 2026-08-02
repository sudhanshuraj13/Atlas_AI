import { z } from "zod";

/**
 * Schema to classify the user's intent from their message.
 * Used as the first LLM call to route between stock queries and general chat.
 */
export const IntentSchema = z.object({
  intent: z
    .enum(["stock_query", "general_chat"])
    .describe("The classified intent of the user's message."),
  tickerSymbol: z
    .string()
    .nullable()
    .describe(
      "The stock ticker symbol extracted from the user's message (e.g., 'AAPL', 'NVDA'). Null if intent is 'general_chat'."
    ),
});

export type IntentResult = z.infer<typeof IntentSchema>;

/**
 * Schema for the structured financial summary returned by the LLM.
 * The LLM outputs raw JSON data — formatting for Telegram happens in the formatter layer (Law 8).
 */
export const FinancialSummarySchema = z.object({
  headline: z
    .string()
    .describe("A concise, punchy headline summarizing the stock's current state."),
  currentPrice: z
    .number()
    .describe("The current trading price of the stock."),
  percentageChange: z
    .number()
    .describe("The percentage change from previous close. Positive = up, negative = down."),
  keyFacts: z
    .array(z.string())
    .max(2)
    .describe("1-2 key facts or developments driving the stock's movement today."),
  whyItMatters: z
    .string()
    .describe("A single sentence explaining the broader market impact or why this matters to investors."),
  sentiment: z
    .enum(["Bullish", "Bearish", "Neutral"])
    .describe("Overall market sentiment for this stock based on current data and news."),
});

export type FinancialSummary = z.infer<typeof FinancialSummarySchema>;

/**
 * Schema for the conversational (general chat) response.
 * Even general chat goes through structured output (Law 5).
 */
export const ChatResponseSchema = z.object({
  reply: z
    .string()
    .describe("A helpful, conversational reply to the user's general question. Keep it concise and friendly."),
});

export type ChatResponse = z.infer<typeof ChatResponseSchema>;

/**
 * Schema for multi-ticker proactive daily briefing digest (Day 3 & 4).
 */
export const BriefingDigestSchema = z.object({
  greeting: z
    .string()
    .describe("A warm, professional greeting suited for the briefing (e.g. 'Good morning!', 'Here is your market kickoff')."),
  marketOverview: z
    .string()
    .describe("A 1-sentence macro overview summarizing the general tone of the market today."),
  tickerUpdates: z
    .array(
      z.object({
        symbol: z.string().describe("Stock ticker symbol (e.g. 'AAPL')"),
        price: z.number().describe("Current trading price"),
        changePercent: z.number().describe("Percentage change from previous close"),
        takeaway: z
          .string()
          .describe("A punchy 1-sentence takeaway explaining the primary driver or news for this stock today."),
      })
    )
    .describe("Updates for each ticker in the user's watchlist."),
  meetingPrep: z
    .array(
      z.object({
        meetingTitle: z.string().describe("Title and time of the scheduled meeting"),
        ticker: z.string().describe("Associated stock ticker symbol, e.g. 'NVDA'"),
        prepTakeaway: z.string().describe("1-sentence preparation point highlighting relevant market performance/news for this company before the meeting"),
      })
    )
    .optional()
    .describe("Meeting prep highlights for upcoming calendar events that mention stocks or companies."),
  actionableInsight: z
    .string()
    .describe("A 1-sentence actionable insight or highlight on what matters most for the user today."),
});

export type BriefingDigest = z.infer<typeof BriefingDigestSchema>;

/**
 * Schema for dedicated /agenda meeting briefing.
 */
export const AgendaBriefingSchema = z.object({
  overview: z.string().describe("1-sentence summary of today's meeting schedule and focus areas."),
  items: z.array(
    z.object({
      time: z.string().describe("Time of the meeting, e.g. '14:00'"),
      title: z.string().describe("Meeting title"),
      ticker: z.string().nullable().describe("Associated stock ticker or null"),
      marketContext: z.string().describe("Concise market context or talking point for this meeting"),
    })
  ),
  executiveAdvice: z.string().describe("1 strategic takeaway for the meetings today."),
});

export type AgendaBriefing = z.infer<typeof AgendaBriefingSchema>;
