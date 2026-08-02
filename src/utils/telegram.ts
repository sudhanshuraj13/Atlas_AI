import type { Context } from "grammy";
import { GrammyError } from "grammy";

const MAX_MESSAGE_LENGTH = 4000;

/**
 * Options for ctx.reply(), excluding the text and chat_id which are
 * provided separately. Derived from grammY's Context.reply signature.
 */
type ReplyOptions = Omit<
  NonNullable<Parameters<Context["reply"]>[1]>,
  "chat_id" | "text"
>;

/** Escape characters that break Telegram HTML parsing. */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Split text into chunks that respect Telegram's message length limit.
 * Splits at the last newline before the limit to avoid breaking mid-sentence.
 */
function splitMessage(text: string): string[] {
  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > MAX_MESSAGE_LENGTH) {
    let splitIndex = remaining.lastIndexOf("\n", MAX_MESSAGE_LENGTH);

    if (splitIndex === -1 || splitIndex < MAX_MESSAGE_LENGTH * 0.5) {
      // No good newline break — split at a space instead
      splitIndex = remaining.lastIndexOf(" ", MAX_MESSAGE_LENGTH);
    }

    if (splitIndex === -1 || splitIndex < MAX_MESSAGE_LENGTH * 0.3) {
      // Last resort: hard split
      splitIndex = MAX_MESSAGE_LENGTH;
    }

    chunks.push(remaining.slice(0, splitIndex));
    remaining = remaining.slice(splitIndex).trimStart();
  }

  if (remaining.length > 0) {
    chunks.push(remaining);
  }

  return chunks;
}

/**
 * Delay helper for rate-limit back-off.
 */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Send a Telegram message safely:
 * 1. Splits messages exceeding 4000 characters.
 * 2. Retries on 429 (rate-limit) errors with the server-specified delay.
 * 3. Falls back to plain text if HTML parsing fails.
 */
export async function sendSafeTelegramMessage(
  ctx: Context,
  text: string,
  options?: ReplyOptions
): Promise<void> {
  const chunks = splitMessage(text);

  for (const chunk of chunks) {
    await sendSingleChunk(ctx, chunk, options);
  }
}

async function sendSingleChunk(
  ctx: Context,
  text: string,
  options?: ReplyOptions,
  retryCount = 0
): Promise<void> {
  const MAX_RETRIES = 3;

  try {
    await ctx.reply(text, {
      parse_mode: "HTML",
      ...options,
    });
  } catch (error: unknown) {
    if (error instanceof GrammyError) {
      // Handle rate limiting (HTTP 429)
      if (error.error_code === 429 && retryCount < MAX_RETRIES) {
        const retryAfter =
          (error.parameters as { retry_after?: number } | undefined)
            ?.retry_after ?? 5;
        console.warn(
          `⚠️ Rate limited. Retrying after ${retryAfter}s (attempt ${retryCount + 1}/${MAX_RETRIES})`
        );
        await delay(retryAfter * 1000);
        return sendSingleChunk(ctx, text, options, retryCount + 1);
      }

      // Handle HTML parse errors — fall back to plain text
      if (
        error.error_code === 400 &&
        error.description.includes("parse")
      ) {
        console.warn("⚠️ HTML parse failed — falling back to plain text.");
        await ctx.reply(text, {
          ...options,
          parse_mode: undefined,
        });
        return;
      }
    }

    // Log and swallow unexpected errors to prevent bot crash
    console.error("❌ Failed to send message:", error);
  }
}

/**
 * Send a Telegram message safely using bot.api (for background cron jobs without Context).
 */
export async function sendSafeBotMessage(
  api: import("grammy").Api,
  chatId: number | bigint | string,
  text: string,
  options?: Record<string, unknown>
): Promise<void> {
  const chunks = splitMessage(text);
  const targetId = typeof chatId === "bigint" ? Number(chatId) : chatId;

  for (const chunk of chunks) {
    await sendSingleApiChunk(api, targetId, chunk, options);
  }
}

async function sendSingleApiChunk(
  api: import("grammy").Api,
  chatId: number | string,
  text: string,
  options?: Record<string, unknown>,
  retryCount = 0
): Promise<void> {
  const MAX_RETRIES = 3;

  try {
    await api.sendMessage(chatId, text, {
      parse_mode: "HTML",
      ...options,
    });
  } catch (error: unknown) {
    if (error instanceof GrammyError) {
      if (error.error_code === 429 && retryCount < MAX_RETRIES) {
        const retryAfter =
          (error.parameters as { retry_after?: number } | undefined)
            ?.retry_after ?? 5;
        console.warn(
          `⚠️ Rate limited in cron delivery. Retrying after ${retryAfter}s (attempt ${retryCount + 1}/${MAX_RETRIES})`
        );
        await delay(retryAfter * 1000);
        return sendSingleApiChunk(api, chatId, text, options, retryCount + 1);
      }

      if (error.error_code === 400 && error.description.includes("parse")) {
        console.warn("⚠️ Cron HTML parse failed — falling back to plain text.");
        await api.sendMessage(chatId, text, {
          ...options,
          parse_mode: undefined,
        });
        return;
      }
    }

    console.error(`❌ Failed to send scheduled briefing to ${chatId}:`, error);
  }
}

