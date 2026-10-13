import { channelStatus, isSupported, type AccountStatus, type BufferPlatform } from "./mapper";
import type { BufferChannel } from "./schemas";

export type ChannelUpsert = {
  platform: BufferPlatform; platformUserId: string; handle: string; avatarUrl: string | null; timezone: string;
  status: AccountStatus; lastError: string | null; isNew: boolean;
};

/**
 * Pure part of the channel sync. Only Buffer-owned fields are produced: the owner's local settings (active,
 * isDefaultForPlatform, brandKitId) are never part of an update, and a channel that left Buffer is marked missing, not deleted.
 */
export function planSync(channels: BufferChannel[], known: { platformUserId: string; status: AccountStatus }[]) {
  const have = new Set(known.map((k) => k.platformUserId));
  const supported = channels.filter((c) => isSupported(c.service));
  const upserts: ChannelUpsert[] = supported.map((c) => {
    const { status, note } = channelStatus(c);
    return {
      platform: c.service as BufferPlatform, platformUserId: c.id, handle: c.displayName || c.name, avatarUrl: c.avatar ?? null,
      timezone: c.timezone, status, lastError: note, isNew: !have.has(c.id),
    };
  });
  const present = new Set(supported.map((c) => c.id));
  const missing = known.filter((k) => !present.has(k.platformUserId) && k.status !== "missing").map((k) => k.platformUserId);
  return { upserts, missing };
}
