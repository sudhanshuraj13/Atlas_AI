/**
 * Production Axios client for the Python AI Microservice.
 *
 * Singleton instance with:
 * - Configurable base URL via AI_SERVICE_URL env var
 * - 15-second timeout
 * - 2 retries with exponential backoff on network errors / 5xx
 * - Response interceptor normalizing errors into typed AiServiceError
 */

import axios, { type AxiosInstance, type AxiosError } from "axios";
import axiosRetry, { exponentialDelay, isNetworkOrIdempotentRequestError } from "axios-retry";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Calendar event shape matching the Python CalendarEventSchema. */
export interface CalendarEventPayload {
  title: string;
  time: string;
  ticker?: string | null;
  description?: string | null;
}

/** User context assembled by Node.js before calling the Python service. */
export interface OrchestrateContext {
  calendar_events: CalendarEventPayload[];
  user_preferences: Record<string, unknown>;
}

/** Response from POST /api/v1/orchestrate. */
export interface OrchestrateResponse {
  reply_text: string;
  intent_detected: string;
  agents_executed: string[];
}

/** Normalized error shape for AI service failures. */
export interface AiServiceError {
  message: string;
  status: number | null;
  code: string;
  isAiServiceError: true;
}

// ---------------------------------------------------------------------------
// Singleton Axios Instance
// ---------------------------------------------------------------------------

const aiClient: AxiosInstance = axios.create({
  baseURL: process.env["AI_SERVICE_URL"] || "http://localhost:8000",
  timeout: 15_000,
  headers: { "Content-Type": "application/json" },
});

// Configure retry: 2 retries, exponential backoff, on network errors or 5xx
axiosRetry(aiClient, {
  retries: 2,
  retryDelay: exponentialDelay,
  retryCondition: (error: AxiosError) => {
    return (
      isNetworkOrIdempotentRequestError(error) ||
      (error.response != null && error.response.status >= 500)
    );
  },
  onRetry: (retryCount, error) => {
    console.warn(
      `⚠️ [AiService] Retry ${retryCount}/2 — ${error.message}`
    );
  },
});

// Response interceptor: normalize HTTP errors into typed AiServiceError
aiClient.interceptors.response.use(
  (response) => response,
  (error: AxiosError) => {
    const normalized: AiServiceError = {
      message: "AI service unavailable",
      status: null,
      code: "AI_SERVICE_ERROR",
      isAiServiceError: true,
    };

    if (error.response) {
      // Server responded with an error status
      normalized.status = error.response.status;
      const data = error.response.data as Record<string, unknown> | undefined;
      normalized.message =
        (data?.["message"] as string) ??
        (data?.["detail"] as string) ??
        `AI service returned ${error.response.status}`;
      normalized.code = `HTTP_${error.response.status}`;
    } else if (error.request) {
      // Request was made but no response received
      normalized.message = "AI service did not respond (timeout or unreachable)";
      normalized.code = "AI_SERVICE_TIMEOUT";
    } else {
      // Something else happened
      normalized.message = error.message || "Unknown AI service error";
      normalized.code = "AI_SERVICE_UNKNOWN";
    }

    return Promise.reject(normalized);
  }
);

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Check the health of the Python AI microservice. */
export async function healthCheck(): Promise<{ status: string; service: string }> {
  const { data } = await aiClient.get<{ status: string; service: string }>("/health");
  return data;
}

/**
 * Send a user prompt + context to the Python multi-agent engine.
 *
 * @param userId  Internal user ID from Neon PostgreSQL
 * @param prompt  Raw user message text
 * @param context Pre-fetched calendar events + user preferences
 * @returns Structured response with reply_text, intent, and agent trail
 */
export async function orchestrate(
  userId: string,
  prompt: string,
  context: OrchestrateContext
): Promise<OrchestrateResponse> {
  const { data } = await aiClient.post<OrchestrateResponse>(
    "/api/v1/orchestrate",
    {
      user_id: userId,
      prompt,
      context,
    }
  );
  return data;
}

/** Type guard: check if an error is a normalized AiServiceError. */
export function isAiServiceError(err: unknown): err is AiServiceError {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as AiServiceError).isAiServiceError === true
  );
}
