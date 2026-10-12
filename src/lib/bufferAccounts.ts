import { db } from "@/lib/db";
import { bufferChannels } from "@/lib/providers/buffer";

const SERVICES = ["instagram", "tiktok", "threads"] as const;

/**
 * Mirror the channels linked in Buffer as SocialAccount rows (platformUserId = Buffer channel id, no token stored:
 * the one BUFFER_API_KEY does the posting). Channels that disappeared from Buffer are deactivated, never deleted.
 * A channel the owner deactivated here stays inactive.
 */
export async function syncBufferAccounts() {
  const channels = (await bufferChannels()).filter((c): c is typeof c & { service: (typeof SERVICES)[number] } => (SERVICES as readonly string[]).includes(c.service));
  for (const c of channels) {
    const handle = c.displayName || c.name;
    // Buffer has no channel mutations in its API: connecting, reconnecting, pausing and schedules are done in Buffer.
    // Its state is mirrored read-only here (shown as the account warning); the time zone is Buffer's.
    const lastError = c.isDisconnected ? "Disconnected in Buffer: reconnect it there" : c.isLocked ? "Locked in Buffer (plan limit)" : c.isQueuePaused ? "Queue paused in Buffer: scheduled posts are held" : null;
    await db.socialAccount.upsert({
      where: { platform_platformUserId: { platform: c.service, platformUserId: c.id } },
      create: { platform: c.service, platformUserId: c.id, handle, accessTokenEnc: "", publisher: "buffer", lastError, timezone: c.timezone },
      update: { handle, publisher: "buffer", lastError, timezone: c.timezone },
    });
  }
  const { count } = await db.socialAccount.updateMany({
    where: { publisher: "buffer", active: true, platformUserId: { notIn: channels.map((c) => c.id) } },
    data: { active: false, lastError: "Channel no longer linked in Buffer" },
  });
  return { linked: channels.length, deactivated: count };
}
