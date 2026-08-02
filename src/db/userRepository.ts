import { prisma } from "./client.js";
import type { MessageRole, User, UserPreference, Message } from "@prisma/client";

/** Upsert a user by Telegram ID. Creates default preferences on first visit. */
export async function getOrCreateUser(
  telegramId: bigint,
  firstName: string,
  username: string | undefined
): Promise<User & { preference: UserPreference }> {
  const user = await prisma.user.upsert({
    where: { telegramId },
    update: { firstName, username: username ?? null },
    create: {
      telegramId,
      firstName,
      username: username ?? null,
      preference: {
        create: {},
      },
    },
    include: { preference: true },
  });

  // Edge case: user exists but somehow has no preference row
  if (!user.preference) {
    const preference = await prisma.userPreference.create({
      data: { userId: user.id },
    });
    return { ...user, preference };
  }

  return user as User & { preference: UserPreference };
}

/** Partially update a user's preferences. */
export async function updateUserPreferences(
  userId: string,
  data: Partial<Pick<UserPreference, "industries" | "watchlist" | "briefingTime" | "onboardingDone">>
): Promise<UserPreference> {
  return prisma.userPreference.update({
    where: { userId },
    data,
  });
}

/** Persist a chat message (user or assistant) to the history table. */
export async function saveMessage(
  userId: string,
  role: MessageRole,
  content: string
): Promise<Message> {
  return prisma.message.create({
    data: { userId, role, content },
  });
}

/** Fetch the most recent messages for a user, ordered oldest-first for LLM context (Law 10). */
export async function getRecentMessages(
  userId: string,
  limit = 6
): Promise<Pick<Message, "role" | "content">[]> {
  const messages = await prisma.message.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: { role: true, content: true },
  });

  // Reverse so oldest is first (chronological order for LLM context)
  return messages.reverse();
}

/** Fetch all onboarded users whose scheduled briefing time matches the given HH:MM string. */
export async function getUsersForBriefing(
  briefingTime: string
): Promise<(User & { preference: UserPreference })[]> {
  const users = await prisma.user.findMany({
    where: {
      preference: {
        briefingTime,
        onboardingDone: true,
      },
    },
    include: { preference: true },
  });

  return users.filter(
    (u): u is User & { preference: UserPreference } => u.preference !== null
  );
}

/** Fetch a user along with their preferences by user ID. */
export async function getUserWithPreference(
  userId: string
): Promise<(User & { preference: UserPreference }) | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { preference: true },
  });

  if (!user || !user.preference) return null;
  return user as User & { preference: UserPreference };
}


