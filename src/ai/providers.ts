import { createOpenAI, openai } from "@ai-sdk/openai";
import { google } from "@ai-sdk/google";
import { generateObject, generateText, type Schema } from "ai";
import { type ZodType } from "zod";
import {
  IntentSchema,
  FinancialSummarySchema,
  ChatResponseSchema,
  BriefingDigestSchema,
  AgendaBriefingSchema,
} from "./schemas.js";

interface GenerateStructuredOptions<T> {
  schema: ZodType<T> | Schema<T>;
  system?: string;
  messages?: Array<{ role: "user" | "assistant"; content: string }>;
  prompt?: string;
}

/**
 * Provides an exact JSON format description for schemas when calling LLMs in text-completion mode.
 */
function getSchemaFormatDescription(schema: any): string {
  if (schema === IntentSchema) {
    return '{"intent": "stock_query" | "general_chat", "tickerSymbol": "AAPL" | null}';
  }
  if (schema === ChatResponseSchema) {
    return '{"reply": "your helpful and professional financial response here"}';
  }
  if (schema === FinancialSummarySchema) {
    return '{"headline": "concise headline", "currentPrice": 150.0, "percentageChange": 2.5, "keyFacts": ["fact 1", "fact 2"], "whyItMatters": "one sentence on broader impact", "sentiment": "Bullish" | "Bearish" | "Neutral"}';
  }
  if (schema === BriefingDigestSchema) {
    return '{"greeting": "warm greeting", "marketOverview": "1-sentence market tone", "tickerUpdates": [{"symbol": "AAPL", "price": 150.0, "changePercent": 1.5, "takeaway": "1-sentence catalyst"}], "meetingPrep": [{"meetingTitle": "Q3 Portfolio Review with Nvidia", "ticker": "NVDA", "prepTakeaway": "1-sentence meeting prep context"}], "actionableInsight": "1-sentence takeaway"}';
  }
  if (schema === AgendaBriefingSchema) {
    return '{"overview": "1-sentence schedule overview", "items": [{"time": "14:00", "title": "Meeting Title", "ticker": "NVDA" | null, "marketContext": "1-sentence context"}], "executiveAdvice": "1-sentence executive takeaway"}';
  }
  return "{}";
}

/**
 * Extracts and cleans JSON from LLM text responses.
 */
function extractAndParseJSON<T>(text: string, schema: ZodType<T> | Schema<T>): T {
  const cleaned = text
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .trim();

  // Find first { and last } or first [ and last ]
  const firstBrace = cleaned.indexOf("{");
  const lastBrace = cleaned.lastIndexOf("}");
  const jsonString =
    firstBrace !== -1 && lastBrace !== -1
      ? cleaned.slice(firstBrace, lastBrace + 1)
      : cleaned;

  const parsed = JSON.parse(jsonString);
  if ("parse" in schema && typeof (schema as any).parse === "function") {
    return (schema as any).parse(parsed);
  }
  return parsed as T;
}

/**
 * Executes structured object generation with multi-provider fallback.
 * Provider priority:
 * 1. Groq (configured model via GROQ_MODEL or default llama-3.3-70b-versatile)
 * 2. Google Gemini (gemini-2.0-flash)
 * 3. OpenAI (gpt-4o-mini)
 */
export async function generateStructuredAI<T>(
  options: GenerateStructuredOptions<T>
): Promise<T> {
  const errors: string[] = [];

  // --- Provider 1: Groq ---
  const groqKey = process.env.GROQ_API_KEY?.trim();
  if (groqKey && !groqKey.includes("your_groq_key")) {
    const groqModel = process.env.GROQ_MODEL?.trim() || "llama-3.3-70b-versatile";
    try {
      const groq = createOpenAI({
        baseURL: "https://api.groq.com/openai/v1",
        apiKey: groqKey,
      });

      const schemaFormat = getSchemaFormatDescription(options.schema);
      const jsonInstruction = `IMPORTANT: You MUST respond ONLY with a raw, valid JSON object strictly matching this schema:\n${schemaFormat}\nDo NOT wrap in markdown code blocks or backticks and do NOT add any conversational text outside the JSON.`;

      const systemPrompt = options.system
        ? `${options.system}\n\n${jsonInstruction}`
        : jsonInstruction;

      let promptText = options.prompt ?? "";
      if (options.messages && options.messages.length > 0) {
        promptText = options.messages
          .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
          .join("\n");
      }

      const result = await generateText({
        model: groq(groqModel),
        system: systemPrompt,
        prompt: promptText,
      });

      return extractAndParseJSON<T>(result.text, options.schema);
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      console.warn(`⚠️ [Groq:${groqModel}] failed, falling back to next provider:`, msg);
      errors.push(`Groq: ${msg}`);
    }
  }

  // --- Provider 2: Google Gemini ---
  const geminiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY?.trim();
  if (geminiKey) {
    try {
      const callParams: any = {
        model: google("gemini-2.0-flash"),
        schema: options.schema,
      };
      if (options.system) callParams.system = options.system;
      if (options.messages) callParams.messages = options.messages;
      if (options.prompt) callParams.prompt = options.prompt;

      const result = await generateObject(callParams);
      return result.object as T;
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      console.warn("⚠️ [Google Gemini] failed, falling back to next provider:", msg);
      errors.push(`Gemini: ${msg}`);
    }
  }

  // --- Provider 3: OpenAI ---
  const openaiKey = process.env.OPENAI_API_KEY?.trim();
  if (openaiKey) {
    try {
      const callParams: any = {
        model: openai("gpt-4o-mini"),
        schema: options.schema,
      };
      if (options.system) callParams.system = options.system;
      if (options.messages) callParams.messages = options.messages;
      if (options.prompt) callParams.prompt = options.prompt;

      const result = await generateObject(callParams);
      return result.object as T;
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      console.warn("⚠️ [OpenAI] failed:", msg);
      errors.push(`OpenAI: ${msg}`);
    }
  }

  throw new Error(`All AI providers failed:\n${errors.join("\n")}`);
}
