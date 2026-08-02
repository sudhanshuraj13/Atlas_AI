import YahooFinance from "yahoo-finance2";

/** Custom error for finance API failures (Law 6). */
export class FinanceAPIError extends Error {
  constructor(
    message: string,
    public readonly symbol: string,
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = "FinanceAPIError";
  }
}

/** Shape of the data returned by getLiveTickerData. */
export interface TickerData {
  symbol: string;
  shortName: string;
  currentPrice: number;
  previousClose: number;
  percentageChange: number;
  volume: number;
  marketCap: number;
  newsHeadlines: string[];
}

/** Singleton yahoo-finance2 client with survey notice suppressed. */
const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] });

/**
 * Search Yahoo Finance for a company name, asset, or query and return the top stock/asset ticker symbol.
 */
export async function searchTicker(query: string): Promise<string | null> {
  try {
    const searchResult = await yf.search(query.trim(), {
      quotesCount: 6,
      newsCount: 0,
    });

    if (searchResult && searchResult.quotes && searchResult.quotes.length > 0) {
      const best =
        searchResult.quotes.find(
          (q: any) =>
            q.isYahooFinance !== false &&
            (q.quoteType === "EQUITY" ||
              q.quoteType === "ETF" ||
              q.quoteType === "CRYPTOCURRENCY" ||
              q.quoteType === "INDEX")
        ) ?? searchResult.quotes[0];

      const symbol = (best as any)?.symbol;
      return typeof symbol === "string" ? symbol : null;
    }
  } catch (err) {
    console.warn(`⚠️ Yahoo search failed for "${query}":`, err);
  }
  return null;
}

/**
 * Fetch live quote and recent news for a stock symbol or company name using yahoo-finance2.
 * Automatically resolves company names to tickers if direct quote fails.
 * Wrapped in try/catch per Law 6 — throws FinanceAPIError on failure.
 */
export async function getLiveTickerData(symbolOrQuery: string): Promise<TickerData> {
  const cleanQuery = symbolOrQuery.trim();
  let targetSymbol = cleanQuery.toUpperCase();

  try {
    // 1. Try direct quote
    let quote: any;
    try {
      quote = await yf.quote(targetSymbol);
    } catch {
      quote = null;
    }

    // 2. If direct quote not found or missing price, search Yahoo Finance dynamically
    if (!quote || !quote.regularMarketPrice) {
      const resolved = await searchTicker(cleanQuery);
      if (resolved && resolved.toUpperCase() !== targetSymbol) {
        targetSymbol = resolved.toUpperCase();
        try {
          quote = await yf.quote(targetSymbol);
        } catch {
          quote = null;
        }
      }
    }

    if (!quote || !quote.regularMarketPrice) {
      throw new FinanceAPIError(
        `No market data available for ${cleanQuery}`,
        cleanQuery
      );
    }

    const currentPrice = quote.regularMarketPrice;
    const previousClose = quote.regularMarketPreviousClose ?? currentPrice;
    const percentageChange =
      previousClose !== 0
        ? ((currentPrice - previousClose) / previousClose) * 100
        : 0;

    // Fetch recent news headlines
    let newsHeadlines: string[] = [];
    try {
      const searchResult = await yf.search(targetSymbol, {
        newsCount: 3,
        quotesCount: 0,
      });

      newsHeadlines = (searchResult.news ?? [])
        .slice(0, 3)
        .map((article: { title: string }) => article.title);
    } catch {
      console.warn(`⚠️ Could not fetch news for ${targetSymbol}, continuing without news.`);
    }

    return {
      symbol: quote.symbol ?? targetSymbol,
      shortName: quote.shortName ?? quote.longName ?? targetSymbol,
      currentPrice,
      previousClose,
      percentageChange: Math.round(percentageChange * 100) / 100,
      volume: quote.regularMarketVolume ?? 0,
      marketCap: quote.marketCap ?? 0,
      newsHeadlines,
    };
  } catch (error: unknown) {
    if (error instanceof FinanceAPIError) {
      throw error;
    }

    throw new FinanceAPIError(
      `Failed to fetch market data for ${cleanQuery}`,
      cleanQuery,
      error
    );
  }
}
