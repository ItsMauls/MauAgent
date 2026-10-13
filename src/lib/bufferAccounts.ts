import { db } from "@/lib/db";
import { bufferOrgChannels } from "@/lib/providers/buffer";
import { planSync } from "@/lib/providers/buffer/sync";

/**
 * Mirror the channels linked in Buffer as SocialAccount rows (platformUserId = Buffer channel id, no token stored:
 * the one BUFFER_API_KEY does the posting). Channels that left Buffer are marked missing, never deleted. New channels
 * start disabled for publishing; an owner's settings survive every sync.
 */
export async function syncBufferAccounts() {
  const { organizationId, channels } = await bufferOrgChannels();
  const known = await db.socialAccount.findMany({ where: { publisher: "buffer" }, select: { platformUserId: true, status: true } });
  const { upserts, missing } = planSync(channels, known);
  const now = new Date();
  for (const u of upserts) {
        await db.socialAccount.upsert({
      where: { platform_platformUserId: { platform: u.platform, platformUserId: u.platformUserId } },
      create: { platform: u.platform, platformUserId: u.platformUserId, handle: u.handle, avatarUrl: u.avatarUrl, timezone: u.timezone, status: u.status, lastError: u.lastError, accessTokenEnc: "", publisher: "buffer", active: false, lastSyncedAt: now },
      update: { handle: u.handle, avatarUrl: u.avatarUrl, timezone: u.timezone, status: u.status, lastError: u.lastError, publisher: "buffer", lastSyncedAt: now },
    });
  }
  if (missing.length)
    await db.socialAccount.updateMany({
      where: { publisher: "buffer", platformUserId: { in: missing } },
      data: { status: "missing", active: false, isDefaultForPlatform: false, lastError: "Channel no longer linked in Buffer", lastSyncedAt: now },
    });
  return { organizationId, linked: upserts.length, added: upserts.filter((u) => u.isNew).length, missing: missing.length };
}
