import { createBot, setBotCommands } from "./bot/index.js";
import { initBriefingCron } from "./jobs/briefingCron.js";
import { startHealthServer } from "./server.js";

// Global Unhandled Error Boundary Shields (Law 14)
process.on("uncaughtException", (err: Error) => {
  console.error("💥 [Process Shield] Uncaught Exception caught:", err.stack || err.message);
});

process.on("unhandledRejection", (reason: unknown, promise: Promise<unknown>) => {
  console.error("💥 [Process Shield] Unhandled Rejection at:", promise, "reason:", reason);
});

async function main(): Promise<void> {
  // 1. Start HTTP Health Check Server for 24/7 Cloud Hosting (Law 13)
  const healthServer = startHealthServer();

  // 2. Initialize Telegram Bot Instance
  const bot = createBot();

  // 3. Initialize background cron scheduler for proactive briefings (Law 9)
  const cronTask = initBriefingCron(bot);

  // 4. Graceful shutdown handler
  const shutdown = () => {
    console.log("🛑 Shutting down Atlas AI services...");
    healthServer.close();
    cronTask.stop();
    bot.stop();
    process.exit(0);
  };

  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);

  console.log("🚀 Atlas AI is starting...");
  await bot.start({
    onStart: async (botInfo) => {
      console.log(`✅ Atlas AI is live as @${botInfo.username}`);
      await setBotCommands(bot);
    },
  });
}

main().catch((err) => {
  console.error("❌ Fatal startup error:", err);
  process.exit(1);
});
