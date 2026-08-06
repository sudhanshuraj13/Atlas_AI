import { google } from "googleapis";
import type { OAuth2Client } from "google-auth-library";
import { prisma } from "../db/client.js";

/**
 * AuthService — Handles Google OAuth2 flow for Atlas AI.
 * Generates consent URLs, exchanges authorization codes for tokens,
 * and provides authenticated OAuth2 clients for downstream API calls.
 */

const SCOPES = [
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/calendar.events.readonly",
];

/** Returns true if all required OAuth env vars are configured. */
export function isOAuthConfigured(): boolean {
  const clientId = process.env["GOOGLE_CLIENT_ID"]?.trim();
  const clientSecret = process.env["GOOGLE_CLIENT_SECRET"]?.trim();
  const redirectUri = process.env["GOOGLE_REDIRECT_URI"]?.trim();
  return !!(clientId && clientSecret && redirectUri);
}

/** Creates a fresh OAuth2Client from env vars. */
function createOAuth2Client(): OAuth2Client {
  const clientId = process.env["GOOGLE_CLIENT_ID"]!;
  const clientSecret = process.env["GOOGLE_CLIENT_SECRET"]!;
  const redirectUri = process.env["GOOGLE_REDIRECT_URI"]!;
  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

export class AuthService {
  /**
   * Generates the Google OAuth2 consent URL.
   * Encodes the Telegram userId in the `state` parameter so we can
   * link the Google account back to the correct user after consent.
   */
  static generateAuthUrl(telegramUserId: string): string {
    const client = createOAuth2Client();
    return client.generateAuthUrl({
      access_type: "offline",
      scope: SCOPES,
      state: telegramUserId,
      prompt: "consent", // Forces refresh token issuance every time
    });
  }

  /**
   * Exchanges an authorization code for tokens.
   * Returns the access_token, refresh_token, and expiry_date.
   */
  static async exchangeCodeForTokens(code: string) {
    const client = createOAuth2Client();
    const { tokens } = await client.getToken(code);
    return tokens;
  }

  /**
   * Upserts the Google tokens into the Neon database for a user
   * identified by their Telegram ID.
   */
  static async saveUserTokens(
    telegramId: bigint,
    googleId: string | null,
    accessToken: string,
    refreshToken: string | null | undefined,
    expiryDate: number | null | undefined
  ) {
    try {
      await prisma.user.update({
        where: { telegramId },
        data: {
          googleId: googleId ?? undefined,
          accessToken,
          refreshToken: refreshToken ?? undefined,
          tokenExpiry: expiryDate ? new Date(expiryDate) : undefined,
        },
      });
      console.log(`✅ [Auth] Saved Google tokens for Telegram user ${telegramId}`);
    } catch (err) {
      console.error(`❌ [Auth] Failed to save tokens for Telegram user ${telegramId}:`, err);
      throw err;
    }
  }

  /**
   * Returns an authenticated OAuth2Client for a user, with automatic
   * token refresh wired up. Loads tokens from the Neon database.
   */
  static async getAuthedClient(telegramId: bigint): Promise<OAuth2Client | null> {
    try {
      const user = await prisma.user.findUnique({
        where: { telegramId },
        select: {
          accessToken: true,
          refreshToken: true,
          tokenExpiry: true,
        },
      });

      if (!user?.accessToken) {
        return null;
      }

      const client = createOAuth2Client();
      client.setCredentials({
        access_token: user.accessToken,
        refresh_token: user.refreshToken ?? undefined,
        expiry_date: user.tokenExpiry?.getTime() ?? undefined,
      });

      // Wire up automatic token refresh — persist new tokens to DB
      client.on("tokens", async (tokens) => {
        try {
          await prisma.user.update({
            where: { telegramId },
            data: {
              accessToken: tokens.access_token ?? undefined,
              refreshToken: tokens.refresh_token ?? undefined,
              tokenExpiry: tokens.expiry_date
                ? new Date(tokens.expiry_date)
                : undefined,
            },
          });
          console.log(`🔄 [Auth] Refreshed tokens for Telegram user ${telegramId}`);
        } catch (refreshErr) {
          console.error(`❌ [Auth] Failed to persist refreshed tokens:`, refreshErr);
        }
      });

      return client;
    } catch (err) {
      console.error(`❌ [Auth] Failed to load authed client for ${telegramId}:`, err);
      return null;
    }
  }
}
