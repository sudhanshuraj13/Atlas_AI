import { generateStructuredAI } from "./providers.js";
import {
  IntentSchema,
  FinancialSummarySchema,
  ChatResponseSchema,
  type FinancialSummary,
  type ChatResponse,
} from "./schemas.js";
import { getLiveTickerData, FinanceAPIError, type TickerData } from "../services/finance.js";

/** Shape of chat history entries passed to the orchestrator (Law 10). */
export interface ChatHistoryEntry {
  role: "user" | "assistant";
  content: string;
}

/** Union type for the orchestrator's return value. */
export type OrchestratorResult =
  | { type: "financial_summary"; data: FinancialSummary; ticker: string }
  | { type: "chat_response"; data: ChatResponse }
  | { type: "error"; message: string };

// --- 1. In-Memory Cache (TTL: 3 minutes) ---
interface CachedSummary {
  data: FinancialSummary;
  ticker: string;
  timestamp: number;
}
const summaryCache = new Map<string, CachedSummary>();
const CACHE_TTL_MS = 3 * 60 * 1000; // 3 minutes

// --- 2. Common Company Name to Ticker Dictionary ---
const KNOWN_COMPANIES: Record<string, string> = {
  apple: "AAPL",
  tesla: "TSLA",
  nvidia: "NVDA",
  microsoft: "MSFT",
  google: "GOOGL",
  alphabet: "GOOGL",
  amazon: "AMZN",
  meta: "META",
  facebook: "META",
  netflix: "NFLX",
  amd: "AMD",
  intel: "INTC",
  coinbase: "COIN",
  spy: "SPY",
  qqq: "QQQ",
  palantir: "PLTR",
  uber: "UBER",
  hcl: "HCLTECH.NS",
  hcltech: "HCLTECH.NS",
  tcs: "TCS.NS",
  infosys: "INFY",
  infy: "INFY",
  wipro: "WIPRO.NS",
  reliance: "RELIANCE.NS",
  tata: "TATAMOTORS.NS",
  tatamotors: "TATAMOTORS.NS",
};

// --- 3. Chat Stopwords (Never treat these standalone words as stock tickers) ---
const STOP_WORDS = new Set([
  "OK", "HI", "HEY", "HELLO", "YES", "NO", "YEP", "NOPE", "COOL",
  "THANKS", "THANK", "TY", "THX", "BYE", "GOOD", "NICE", "SURE",
  "FINE", "WHY", "WHAT", "HOW", "WHO", "WHEN", "WHERE", "HELP",
  "START", "STOP", "TEST", "BOT", "YOU", "ME", "GM", "GN", "IDK",
  "LOL", "LMAO", "NOW", "SO", "WELL", "CAN", "MAY", "DO", "DOES",
  "DID", "ARE", "IS", "AM", "WAS", "BE", "AI", "HIYA", "SUP", "YO",
  "TODAY", "DAILY", "NEWS", "STOCK", "STOCKS", "MARKET", "MARKETS",
  "PRICE", "PRICES", "QUOTE", "QUOTES", "BUY", "SELL", "HOLD",
  "THIS", "THAT", "THEM", "THEY", "EXPLAIN", "TELL", "SHOULD", "NOT",
]);

/**
 * Fast-path rule-based intent and ticker extraction.
 * Strictly checks for standalone tickers / stock requests so conversational sentences go to LLM intent classifier.
 */
function fastExtractTicker(text: string): string | null {
  const trimmed = text.trim();
  const upper = trimmed.toUpperCase();

  // If text contains spaces and conversational words (like explain, should, why, tell), do NOT fast-extract
  if (/\b(explain|tell|should|why|how|what|think|good|buy|sell|about|discuss)\b/i.test(trimmed)) {
    return null;
  }

  // Ignore common greetings and conversational single words
  if (STOP_WORDS.has(upper)) {
    return null;
  }

  // Pattern A: Explicit ticker with dollar sign e.g. "$AAPL", "$TSLA", "$nke", "$dis"
  const dollarMatch = trimmed.match(/^\$([A-Za-z0-9.\-=]{1,12})$/);
  if (dollarMatch && dollarMatch[1]) {
    const sym = dollarMatch[1].toUpperCase();
    if (!STOP_WORDS.has(sym)) return sym;
  }

  // Pattern B: Standalone known company name (case-insensitive single word)
  const lower = trimmed.toLowerCase();
  if (KNOWN_COMPANIES[lower] && !trimmed.includes(" ")) {
    return KNOWN_COMPANIES[lower];
  }

  // Pattern C: Standalone stock/crypto/ETF ticker (1-12 chars, e.g. AAPL, dis, nke, BABA, BTC-USD, TATAMOTORS.NS)
  // Only matches single word queries that are not in stopwords
  if (/^[A-Za-z0-9.\-=^]{1,12}$/.test(trimmed) && !STOP_WORDS.has(upper) && !trimmed.includes(" ")) {
    return upper;
  }

  return null;
}

/**
 * Detects any mentioned company or ticker in the user text or conversation history
 * so that general chat can incorporate live context.
 */
function findMentionedTicker(
  text: string,
  history: Array<{ role: string; content: string }> = []
): string | null {
  // Check for $TICKER
  const dollarMatch = text.match(/\$([A-Za-z0-9.\-=]{1,12})/);
  if (dollarMatch && dollarMatch[1]) {
    return dollarMatch[1].toUpperCase();
  }

  // Check for known company names in text
  const lower = text.toLowerCase();
  const words = lower.split(/[\s,.:;?!()\-]+/);
  for (const word of words) {
    if (KNOWN_COMPANIES[word]) {
      return KNOWN_COMPANIES[word];
    }
  }

  // Check for prominent stock symbols mentioned in words
  for (const word of words) {
    const upper = word.toUpperCase();
    if (
      upper.length >= 2 &&
      upper.length <= 6 &&
      !STOP_WORDS.has(upper) &&
      /^[A-Z]+$/.test(upper) &&
      ["AAPL", "NVDA", "TSLA", "MSFT", "GOOGL", "GOOG", "AMZN", "META", "NFLX", "AMD", "INTC", "BABA", "PLTR", "COIN", "UBER", "DIS", "NKE", "HCL"].includes(upper)
    ) {
      return upper === "HCL" ? "HCLTECH.NS" : upper;
    }
  }

  // If not found in current message, look back at recent user messages in history
  for (let i = history.length - 1; i >= 0; i--) {
    const h = history[i];
    if (h.role === "user") {
      const hLower = h.content.toLowerCase();
      const hWords = hLower.split(/[\s,.:;?!()\-]+/);
      for (const w of hWords) {
        if (KNOWN_COMPANIES[w]) {
          return KNOWN_COMPANIES[w];
        }
      }
    }
  }

  return null;
}

/**
 * Fallback summary generator: constructs a high-quality financial summary directly
 * from live market data when the LLM quota is exhausted or unavailable.
 */
function createFallbackSummary(tickerData: TickerData): FinancialSummary {
  const isUp = tickerData.percentageChange > 0;
  const sentiment =
    tickerData.percentageChange > 1.5
      ? "Bullish"
      : tickerData.percentageChange < -1.5
        ? "Bearish"
        : "Neutral";

  const keyFacts: string[] = [];
  if (tickerData.newsHeadlines.length > 0) {
    keyFacts.push(tickerData.newsHeadlines[0]);
    if (tickerData.newsHeadlines.length > 1) {
      keyFacts.push(tickerData.newsHeadlines[1]);
    }
  } else {
    keyFacts.push(`Trading volume at ${tickerData.volume.toLocaleString()} shares today.`);
    keyFacts.push(`Previous close was $${tickerData.previousClose.toFixed(2)}.`);
  }

  return {
    headline: `${tickerData.shortName} (${tickerData.symbol}) trades at $${tickerData.currentPrice.toFixed(2)} (${isUp ? "+" : ""}${tickerData.percentageChange.toFixed(2)}%)`,
    currentPrice: tickerData.currentPrice,
    percentageChange: tickerData.percentageChange,
    keyFacts,
    whyItMatters: `${tickerData.shortName} is showing ${sentiment.toLowerCase()} momentum today with a market cap of $${(tickerData.marketCap / 1e9).toFixed(2)}B.`,
    sentiment,
  };
}

const SYSTEM_PROMPT_INTENT = `You are Atlas AI, an intelligent financial assistant on Telegram.
Classify the intent of the user's LATEST message based on context:

1. "stock_query": ONLY when the user is explicitly requesting a direct, standalone stock quote, price check, live market data, or stock card (e.g. "AAPL", "$NVDA", "price of Tesla", "check MSFT", "quote for TSLA", "show me NVDA card"). In this case, extract the ticker symbol (e.g. AAPL, TSLA, NVDA).

2. "general_chat": for ALL other queries, including:
- Explanations, opinions, investment reasoning, pros/cons, or "should I buy / sell" questions (e.g. "now explain me this aapl stock is it good to buy or not?", "should I buy nvidia?", "why is tesla going down?", "tell me about hcl", "is apple a good investment?").
- Conversational questions about past messages or memory (e.g. "What was the company I just mentioned?", "What did I just say?", "Which stock did we discuss?").
- General market recaps, macroeconomic trends, educational finance concepts (e.g. "tell me about today's market", "what is P/E ratio?", "how does inflation affect stocks?").
- Casual conversation, greetings, follow-ups.

For ALL "general_chat" queries, tickerSymbol MUST be null.`;

const SYSTEM_PROMPT_ANALYST = `You are an elite financial analyst at Atlas AI.
You receive raw market data and news headlines for a stock.
Synthesize this into a concise, insightful briefing:
- Write a punchy, informative headline.
- Identify at most 2 key facts driving the stock today.
- Explain in ONE sentence why this matters to investors (broader market impact).
- Determine overall sentiment: Bullish, Bearish, or Neutral.

Be concise, data-driven, and avoid hype. Do NOT output any HTML or Markdown formatting.`;

const SYSTEM_PROMPT_CHAT = `You are Atlas AI, an elite, knowledgeable, and friendly financial assistant on Telegram.
You explain financial concepts, stocks, companies, business models, market movements, and investment considerations in natural, clear, conversational everyday words (plain English).

Guidelines:
1. When asked to explain a stock or if it is good to buy (e.g. "explain me this aapl stock is it good to buy or not?", "tell me about HCL", "should I buy NVDA?"):
   - Answer directly and conversationally in 2-4 easy-to-read sentences.
   - Mention the current price/trend and latest catalysts if live market data is provided.
   - Provide a balanced view: highlight key growth strengths (e.g., strong ecosystem, solid margins, AI adoption) alongside key risks/headwinds (e.g., high valuation, market pullbacks, supply chain hurdles).
   - Offer a sensible perspective for investors (e.g., dollar-cost averaging for long-term vs monitoring short-term volatility).
   - Add a brief, natural disclaimer that this is educational analysis, not personalized financial advice.
2. When asked about a company (e.g. "tell me about HCL", "what does Palantir do?"):
   - Explain the company's business model, core revenue drivers, and market position in simple, engaging words.
3. When answering questions about previous conversation history (e.g. "What was the company I just mentioned?"):
   - Answer directly, accurately, and concisely based on the conversation history (e.g. "The company you mentioned earlier was Apple ($AAPL).").
4. When asked about today's market or macro conditions:
   - Provide a clear, engaging overview of overall market sentiment, major index movements, and key themes to watch.
5. Tone:
   - Professional, friendly, insightful, and accessible.
   - Do NOT output HTML or Markdown code tags — output clean text only.`;

/**
 * Main orchestrator: classifies intent, fetches data if needed, and returns structured output.
 * Features conversation history memory windowing, fast-path regex extraction, caching, and rate-limit fallbacks.
 */
export async function processUserMessage(
  userText: string,
  history: Array<{ role: string; content: string }> = []
): Promise<OrchestratorResult> {
  try {
    let tickerSymbol = fastExtractTicker(userText);
    let intent: "stock_query" | "general_chat" = tickerSymbol ? "stock_query" : "general_chat";

    // Format conversation history for AI messages payload (Law 10)
    const formattedMessages = [
      ...history.map((entry) => ({
        role: (entry.role === "assistant" ? "assistant" : "user") as "user" | "assistant",
        content: entry.content,
      })),
      { role: "user" as const, content: userText },
    ];

    // Step A: If fast-path didn't find a direct standalone ticker, run LLM intent classification
    if (!tickerSymbol) {
      try {
        const intentResult = await generateStructuredAI({
          schema: IntentSchema,
          system: SYSTEM_PROMPT_INTENT,
          messages: formattedMessages,
        });

        intent = intentResult.intent;
        tickerSymbol = intentResult.tickerSymbol ?? null;
      } catch (err) {
        console.warn("⚠️ Intent classification AI call skipped or rate-limited:", err);
      }
    }

    // Step B: General chat — conversational reply with context memory & optional live data
    if (intent === "general_chat" || !tickerSymbol) {
      try {
        let liveContext = "";
        const mentionedTicker = findMentionedTicker(userText, history);
        if (mentionedTicker) {
          try {
            const liveData = await getLiveTickerData(mentionedTicker);
            liveContext = `\n\n[Live Market Reference for ${liveData.shortName} (${liveData.symbol})]\nCurrent Price: $${liveData.currentPrice.toFixed(2)} (${liveData.percentageChange > 0 ? "+" : ""}${liveData.percentageChange.toFixed(2)}%)\nRecent News/Catalysts: ${liveData.newsHeadlines.slice(0, 2).join(" | ") || "None"}\nUse this live information to inform your conversational answer naturally.`;
          } catch {
            // Non-blocking: If ticker lookup fails, proceed with general knowledge
          }
        }

        const chatSystemPrompt = liveContext
          ? `${SYSTEM_PROMPT_CHAT}${liveContext}`
          : SYSTEM_PROMPT_CHAT;

        const chatResult = await generateStructuredAI({
          schema: ChatResponseSchema,
          system: chatSystemPrompt,
          messages: formattedMessages,
        });

        return { type: "chat_response", data: chatResult };
      } catch (err) {
        console.error("❌ Chat response AI error:", err);
        return {
          type: "chat_response",
          data: {
            reply:
              "I'm Atlas AI, your financial assistant. You can ask me about any stock (e.g. AAPL, TSLA, NVDA) or general market questions!",
          },
        };
      }
    }

    // Step C: Check In-Memory Cache for recent ticker summary
    const normalizedTicker = tickerSymbol.toUpperCase();
    const cached = summaryCache.get(normalizedTicker);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
      return {
        type: "financial_summary",
        data: cached.data,
        ticker: cached.ticker,
      };
    }

    // Step D: Stock query — fetch live market data from Yahoo Finance
    let tickerData: TickerData;
    try {
      tickerData = await getLiveTickerData(normalizedTicker);
    } catch (error: unknown) {
      if (error instanceof FinanceAPIError) {
        return {
          type: "error",
          message: `⚠️ I couldn't fetch data for <b>${normalizedTicker}</b>. Please check the ticker symbol and try again.`,
        };
      }
      throw error;
    }

    // Step E: Synthesize financial data into structured summary
    const dataPrompt = [
      `Stock: ${tickerData.shortName} (${tickerData.symbol})`,
      `Current Price: $${tickerData.currentPrice.toFixed(2)}`,
      `Previous Close: $${tickerData.previousClose.toFixed(2)}`,
      `Change: ${tickerData.percentageChange > 0 ? "+" : ""}${tickerData.percentageChange.toFixed(2)}%`,
      `Volume: ${tickerData.volume.toLocaleString()}`,
      `Market Cap: $${(tickerData.marketCap / 1e9).toFixed(2)}B`,
      "",
      "Recent News Headlines:",
      ...(tickerData.newsHeadlines.length > 0
        ? tickerData.newsHeadlines.map((h, i) => `${i + 1}. ${h}`)
        : ["No recent news available."]),
    ].join("\n");

    let summaryData: FinancialSummary;
    try {
      summaryData = await generateStructuredAI({
        schema: FinancialSummarySchema,
        system: SYSTEM_PROMPT_ANALYST,
        prompt: dataPrompt,
      });
    } catch (llmError) {
      console.warn("⚠️ AI synthesis rate-limited or failed, using live data fallback:", llmError);
      // Construct summary directly from live Yahoo Finance data without crashing!
      summaryData = createFallbackSummary(tickerData);
    }

    // Save to Cache
    summaryCache.set(normalizedTicker, {
      data: summaryData,
      ticker: tickerData.symbol,
      timestamp: Date.now(),
    });

    return {
      type: "financial_summary",
      data: summaryData,
      ticker: tickerData.symbol,
    };
  } catch (error: unknown) {
    console.error("❌ Orchestrator error:", error);
    return {
      type: "error",
      message: "⚠️ I'm having trouble analyzing the market right now. Please try again in a moment.",
    };
  }
}
