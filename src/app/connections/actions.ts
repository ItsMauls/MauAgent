"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { bufferChannels, channelStatus } from "@/lib/providers/buffer";

const id = z.string().min(1);
const done = () => revalidatePath("/connections");

/** Enabling needs a channel Buffer still knows; disabling also drops the default flag. */
export async function setChannelEnabled(accountId: string, enabled: boolean) {
  const a = await db.socialAccount.findUniqueOrThrow({ where: { id: id.parse(accountId) }, select: { status: true } });
  if (enabled && a.status === "missing") throw new Error("This channel is no longer in Buffer");
  await db.socialAccount.update({ where: { id: accountId }, data: { active: z.boolean().parse(enabled), ...(enabled ? {} : { isDefaultForPlatform: false }) } });
  done();
}

/** At most one default per platform: clear the others in the same transaction. */
export async function setChannelDefault(accountId: string, isDefault: boolean) {
  const a = await db.socialAccount.findUniqueOrThrow({ where: { id: id.parse(accountId) }, select: { platform: true, active: true, status: true } });
  if (isDefault && (!a.active || a.status === "missing")) throw new Error("Enable the channel for publishing first");
  await db.$transaction([
    ...(isDefault ? [db.socialAccount.updateMany({ where: { platform: a.platform, id: { not: accountId } }, data: { isDefaultForPlatform: false } })] : []),
    db.socialAccount.update({ where: { id: accountId }, data: { isDefaultForPlatform: isDefault } }),
  ]);
  done();
}

export async function setChannelBrandKit(accountId: string, brandKitId: string | null) {
  await db.socialAccount.update({ where: { id: id.parse(accountId) }, data: { brandKitId: id.nullable().parse(brandKitId) } });
  done();
}

/** Read-only query (never creates a post): is the channel still linked, and what does Buffer say about it? */
export async function testChannel(accountId: string) {
  const a = await db.socialAccount.findUniqueOrThrow({ where: { id: id.parse(accountId) }, select: { platformUserId: true } });
  const c = (await bufferChannels()).find((x) => x.id === a.platformUserId);
  if (!c) throw new Error("Channel not found in Buffer");
  const { status, note } = channelStatus(c);
  return status === "connected" ? note ?? "Channel is connected in Buffer" : note!;
}
