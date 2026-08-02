import { z } from "zod";
import "dotenv/config";

const envSchema = z.object({
  TELEGRAM_BOT_TOKEN: z
    .string({ required_error: "TELEGRAM_BOT_TOKEN is required" })
    .min(1, "TELEGRAM_BOT_TOKEN must not be empty"),
  DATABASE_URL: z
    .string({ required_error: "DATABASE_URL is required" })
    .url("DATABASE_URL must be a valid URL"),
  OPENAI_API_KEY: z.string().optional(),
  GOOGLE_GENERATIVE_AI_API_KEY: z.string().optional(),
  GROQ_API_KEY: z.string().optional(),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error(
    "❌ Invalid environment variables:\n",
    parsed.error.flatten().fieldErrors
  );
  process.exit(1);
}

export const config = parsed.data;
