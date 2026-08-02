import cron, { type ScheduledTask } from "node-cron";
import type { Bot } from "grammy";
import { getUsersForBriefing, saveMessage } from "../db/userRepository.js";
import { generateDailyBriefing } from "../services/briefingService.js";
import { sendSafeBotMessage } from "../utils/telegram.js";

/**
 * Initialize background cron scheduler for proactive daily briefings (Law 9).
 * Checks every minute for users whose preferred briefingTime (UTC) matches the current time.
 */
export function initBriefingCron(bot: Bot): ScheduledTask {
  console.log("⏰ Initializing Proactive Briefing Cron Scheduler (every minute)...");

  const task = cron.schedule("* * * * *", async () => {
    try {
      const now = new Date();
      const hours = String(now.getUTCHours()).padStart(2, "0");
      const minutes = String(now.getUTCMinutes()).padStart(2, "0");
      const currentHHMM = `${hours}:${minutes}`;

      // Query onboarded users whose scheduled briefing matches this UTC minute
      const usersToBrief = await getUsersForBriefing(currentHHMM);

      if (usersToBrief.length === 0) {
        return;
      }

      console.log(
        `📢 Delivering scheduled morning briefings to ${usersToBrief.length} user(s) at ${currentHHMM} UTC`
      );

      for (const user of usersToBrief) {
        // Individual try/catch per user to ensure one failure doesn't block others (Law 9)
        try {
          const briefing = await generateDailyBriefing(user.id);

          await sendSafeBotMessage(bot.api, user.telegramId, briefing.html, {
            reply_markup: briefing.keyboard,
          });

          // Record briefing in message history
          await saveMessage(user.id, "assistant", briefing.html);

          console.log(`✅ Briefing delivered to @${user.username ?? user.firstName} (${user.telegramId})`);
        } catch (userError) {
          console.error(
            `❌ Failed to deliver scheduled briefing to user ${user.id} (${user.telegramId}):`,
            userError
          );
        }
      }
    } catch (cronError) {
      // Catch outer cron errors to prevent crashing the Node process
      console.error("❌ Briefing cron job execution error:", cronError);
    }
  });

  return task;
}
