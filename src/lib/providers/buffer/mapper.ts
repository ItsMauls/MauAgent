import type { BufferChannel } from "./schemas";

export const PLATFORMS = ["instagram", "tiktok", "threads", "twitter"] as const;
export type BufferPlatform = (typeof PLATFORMS)[number];
export type PublishMode = "queue" | "scheduled" | "draft" | "now";
export type AccountStatus = "connected" | "needs_reauth" | "disabled" | "missing";

export const isSupported = (service: string): service is BufferPlatform => (PLATFORMS as readonly string[]).includes(service);

/** Channel state mirrored from Buffer. Buffer has no mutations for these, so the owner fixes them in Buffer. */
export function channelStatus(c: Pick<BufferChannel, "isDisconnected" | "isLocked" | "isQueuePaused">): { status: AccountStatus; note: string | null } {
  if (c.isDisconnected) return { status: "needs_reauth", note: "Disconnected in Buffer: reconnect it there" };
  if (c.isLocked) return { status: "disabled", note: "Locked in Buffer (plan limit)" };
  if (c.isQueuePaused) return { status: "connected", note: "Queue paused in Buffer: scheduled posts are held" };
  return { status: "connected", note: null };
}

/** Our PublishJob status for a Buffer post status. `needs_approval` and `error` are failures we can show. */
export function jobStatus(s: "draft" | "error" | "needs_approval" | "scheduled" | "sending" | "sent"): "draft" | "scheduled" | "publishing" | "published" | "failed" {
  return s === "sent" ? "published" : s === "error" || s === "needs_approval" ? "failed" : s === "sending" ? "publishing" : s;
}

/** Buffer rejects a longer thread: "Threads cannot have more than 25 items" (verified live, 12 Oct 2026). */
export const MAX_THREAD = 25;

export type PostBody = { channelId: string; service: BufferPlatform; text: string; videoUrl?: string; thread?: string[]; mode: PublishMode; dueAt?: Date };

/**
 * Thread metadata for X and Threads. Every part travels in the array, the first one included, and the top-level
 * `text` must equal part 1 (Buffer does not enforce it, but that is what the docs describe for rendering).
 */
const threadMeta = (service: BufferPlatform, text: string, thread?: string[]) =>
  thread?.length ? { [service]: { thread: [text, ...thread].map((t) => ({ text: t })) } } : null;

/**
 * createPost input for a mode. Every post is flagged AI-assisted (PRD §6); TikTok also gets its own AI label.
 * A text post carries no `assets`, and a draft may keep its intended time: createPost accepts
 * customScheduled + dueAt + saveToDraft together, so step 2 only has to flip saveToDraft.
 * `needsApproval` is deliberately never sent (verified: it is not required).
 */
export function postInput(p: PostBody) {
  if (p.mode === "scheduled" && !p.dueAt) throw new Error("A scheduled post needs a due date");
  const timed = p.mode === "scheduled" || (p.mode === "draft" && !!p.dueAt);
  const metadata =
    p.service === "instagram"
      ? { instagram: { type: "reel", shouldShareToFeed: true } }
      : p.service === "tiktok"
        ? { tiktok: { isAiGenerated: true } }
        : threadMeta(p.service, p.text, p.thread);
  return {
    channelId: p.channelId,
    text: p.text,
    schedulingType: "automatic",
    mode: timed ? "customScheduled" : p.mode === "now" ? "shareNow" : "addToQueue",
    ...(timed ? { dueAt: p.dueAt!.toISOString() } : {}),
    ...(p.mode === "draft" ? { saveToDraft: true } : {}),
    aiAssisted: true,
    ...(p.videoUrl ? { assets: [{ video: { url: p.videoUrl } }] } : {}),
    ...(metadata ? { metadata } : {}),
  };
}

/**
 * editPost input that turns one of our drafts into a scheduled post. editPost replaces rather than merges, so the
 * text and a thread's metadata have to be resent or Buffer answers "Post must have either text or media".
 */
export function scheduleInput(p: { id: string; service: BufferPlatform; text: string; thread?: string[]; dueAt: Date }) {
  const metadata = threadMeta(p.service, p.text, p.thread);
  return { id: p.id, text: p.text, saveToDraft: false, mode: "customScheduled", dueAt: p.dueAt.toISOString(), ...(metadata ? { metadata } : {}) };
}

/**
 * editPost input for changing a post Buffer already holds (text, thread, time, or its state). Like scheduleInput it
 * resends the text and thread metadata because editPost replaces. UNVERIFIED live: shareNow / addToQueue on an
 * existing post; only draft → customScheduled has been confirmed (see scheduleInput).
 */
export function editInput(p: { id: string; service: BufferPlatform; text: string; thread?: string[]; mode: PublishMode; dueAt?: Date }) {
  const timed = (p.mode === "scheduled" || p.mode === "draft") && !!p.dueAt;
  const metadata = threadMeta(p.service, p.text, p.thread);
  return {
    id: p.id, text: p.text, saveToDraft: p.mode === "draft",
    mode: timed ? "customScheduled" : p.mode === "now" ? "shareNow" : "addToQueue",
    ...(timed ? { dueAt: p.dueAt!.toISOString() } : {}),
    ...(metadata ? { metadata } : {}),
  };
}
