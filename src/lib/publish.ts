// Pure publishing rules (no database, no network): target resolution, caption text, the once-only Buffer call and the
// campaign outcome. Unit-tested in publish.test.ts. The DB side lives in publishPlan.ts.
import { z } from "zod";
import type { BufferPlatform, PublishMode } from "@/lib/providers/buffer";
import { addDays, isDay } from "@/lib/boards/agenda";

export const MODES = ["queue", "scheduled", "draft", "now"] as const;

export const PublishTarget = z.object({
  accountId: z.string().min(1),
  mode: z.enum(MODES),
  dueAt: z.iso.datetime().optional(),
  caption: z.string().trim().max(2200).optional(),
  hashtags: z.array(z.string().trim().min(1)).max(30).optional(),
});
export type PublishTarget = z.infer<typeof PublishTarget>;

type Candidate = { id: string; platform: string; active: boolean; status: string; isDefaultForPlatform: boolean };

/** Explicit targets win (an empty list means "do not publish"); undefined falls back to each platform's default enabled channel, queued. */
export function resolveTargets(explicit: PublishTarget[] | undefined, accounts: Candidate[], platforms: string[]): PublishTarget[] {
  if (explicit) return explicit;
  return accounts
    .filter((a) => a.active && a.isDefaultForPlatform && a.status !== "missing" && platforms.includes(a.platform))
    .map((a) => ({ accountId: a.id, mode: "queue" as const }));
}

export const NO_TARGET_NOTE = "Approved, but no publish target: pick channels under Schedule & publishing, or mark a default channel in Connections.";

export const captionFor = (pkg: { captionPerPlatform?: { platform: string; caption: string }[] } | null, platform: string) =>
  pkg?.captionPerPlatform?.find((c) => c.platform === platform)?.caption ?? pkg?.captionPerPlatform?.[0]?.caption ?? "";

export const postText = (caption: string | null, hashtags: string[]) =>
  [caption, hashtags.map((h) => `#${h.replace(/^#/, "")}`).join(" ")].filter(Boolean).join("\n\n");

/** Buffer reads the video when the post goes out. A queued or draft post can wait days, so presign for the S3 maximum. */
export const presignTtl = (mode: PublishMode) => (mode === "queue" || mode === "draft" ? 7 * 86_400 : 6 * 3600);

/** Platforms that can carry a post with no video: X and Threads text posts (everything else needs a final cut). */
export const TEXT_PLATFORMS: readonly string[] = ["twitter", "threads"];

export type PublishJobInput = {
  postId: string | null; mode: PublishMode; dueAt: Date | null; platform: BufferPlatform; channelId: string; text: string; finalCutKey: string | null;
  /** Thread parts after `text`. Empty or absent = a single post. */
  thread?: string[];
};
export type PublishIO = {
  presign: (key: string, ttlSec: number) => Promise<string>;
  create: (p: { channelId: string; service: BufferPlatform; text: string; videoUrl?: string; thread?: string[]; mode: PublishMode; dueAt?: Date }) => Promise<string>;
};
export type PublishOutcome = { kind: "accepted"; postId: string; created: boolean } | { kind: "failed"; error: string };

/** One Buffer post per job: a job that already has a post id is returned as is, so a retry can never post twice. */
export async function publishOnce(job: PublishJobInput, io: PublishIO): Promise<PublishOutcome> {
  if (job.postId) return { kind: "accepted", postId: job.postId, created: false };
  try {
    if (!job.finalCutKey && !TEXT_PLATFORMS.includes(job.platform)) throw new Error("Campaign has no final cut");
    if (job.platform === "tiktok" && !job.text.trim()) throw new Error("TikTok needs a caption");
    if (!job.finalCutKey && !job.text.trim()) throw new Error("A text post needs text");
    const postId = await io.create({
      channelId: job.channelId, service: job.platform, text: job.text, mode: job.mode,
      ...(job.finalCutKey ? { videoUrl: await io.presign(job.finalCutKey, presignTtl(job.mode)) } : {}),
      ...(job.thread?.length ? { thread: job.thread } : {}),
      // A draft keeps its intended time, so step 2 only has to flip saveToDraft.
      ...(job.dueAt && (job.mode === "scheduled" || job.mode === "draft") ? { dueAt: job.dueAt } : {}),
    });
    return { kind: "accepted", postId, created: true };
  } catch (e) {
    return { kind: "failed", error: (e instanceof Error ? e.message : String(e)).slice(0, 500) };
  }
}

export type ConvertIO = { schedule: (p: { id: string; service: BufferPlatform; text: string; thread?: string[]; dueAt: Date }) => Promise<string> };
export type ConvertOutcome = { kind: "scheduled" } | { kind: "skipped"; reason: string } | { kind: "failed"; error: string };

/**
 * Step 2 of the two-step flow: a draft Buffer already holds becomes a scheduled post. The job's own `mode` is the
 * state machine — `draft` means not converted yet — so a repeat is skipped rather than sent twice, and the
 * underlying editPost is idempotent anyway.
 */
export async function convertOnce(
  job: { postId: string | null; mode: PublishMode; dueAt: Date | null; platform: BufferPlatform; text: string; thread?: string[] },
  io: ConvertIO,
): Promise<ConvertOutcome> {
  if (!job.postId) return { kind: "skipped", reason: "Not sent to Buffer yet" };
  if (job.mode !== "draft") return { kind: "skipped", reason: "Already scheduled" };
  if (!job.dueAt) return { kind: "skipped", reason: "No time set" };
  try {
    await io.schedule({ id: job.postId, service: job.platform, text: job.text, thread: job.thread, dueAt: job.dueAt });
    return { kind: "scheduled" };
  } catch (e) {
    return { kind: "failed", error: (e instanceof Error ? e.message : String(e)).slice(0, 500) };
  }
}

/**
 * Per-post character budget. Buffer counts UTF-16 units, which is what String.length gives, so an emoji already
 * costs 2. X also weights every URL as 23 regardless of length.
 * X paid tiers allow 25,000 — raise `twitter` here if the owner's plan changes.
 */
export const CHAR_LIMIT: Record<string, number> = { twitter: 280, threads: 500 };
const URL_WEIGHT = 23;

export const charCount = (service: string, text: string) =>
  (service === "twitter" ? text.replace(/https?:\/\/\S+/g, "x".repeat(URL_WEIGHT)) : text).length;

/** The reason this text cannot be posted to this service, or null when it fits. */
export function textProblem(service: string, text: string): string | null {
  if (!text.trim()) return "Empty post";
  const limit = CHAR_LIMIT[service];
  if (!limit) return null;
  const n = charCount(service, text);
  return n > limit ? `${n} characters, ${limit} allowed on ${service}` : null;
}

export type Slot = { draftId: string; dueAtUtc: string };

/**
 * Lays the drafts into the day × time slots in order: all of day 1's times, then day 2's, and so on. Pure and
 * deterministic, never an LLM. Fewer drafts than slots simply leaves the tail of the grid unused; more drafts than
 * slots returns only what fits, and the caller warns about the remainder.
 */
export function buildScheduleSlots(p: { startDate: string; endDate: string; timeSlots: string[]; timezone: string; drafts: { id: string }[] }): Slot[] {
  if (!isDay(p.startDate) || !isDay(p.endDate)) throw new Error("Pick a start and end date");
  if (p.endDate < p.startDate) throw new Error("The end date must be on or after the start date");
  const times = p.timeSlots.map((t) => t.trim()).filter(Boolean);
  if (!times.length) throw new Error("Add at least one publish time");
  for (const t of times) if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(t)) throw new Error(`"${t}" is not a time of day (use HH:mm)`);

  const slots: Slot[] = [];
  for (let day = p.startDate; day <= p.endDate; day = addDays(day, 1))
    for (const t of times) {
      if (slots.length >= p.drafts.length) return slots;
      slots.push({ draftId: p.drafts[slots.length].id, dueAtUtc: zonedToIso(`${day}T${t}`, p.timezone) });
    }
  return slots;
}

/** How many day × time slots the grid holds, drafts aside (the panel compares it with the draft count). */
export const slotCount = (p: { startDate: string; endDate: string; timeSlots: string[] }) =>
  !isDay(p.startDate) || !isDay(p.endDate) || p.endDate < p.startDate
    ? 0
    : (Math.round((Date.parse(p.endDate) - Date.parse(p.startDate)) / 86_400_000) + 1) * p.timeSlots.filter((t) => t.trim()).length;

type JobState = { status: string; postId: string | null; mode: string };

/**
 * Campaign status once its jobs settle. A job is open until it failed or Buffer accepted it (has a post id).
 * PUBLISHED needs at least one accepted post that is not a draft; one failed channel never fails the others.
 */
export function campaignOutcome(jobs: JobState[]): "PUBLISHING" | "PUBLISHED" | "APPROVED" {
  if (jobs.some((j) => !j.postId && ["draft", "scheduled", "publishing"].includes(j.status))) return "PUBLISHING";
  return jobs.some((j) => j.postId && j.mode !== "draft" && j.status !== "failed") ? "PUBLISHED" : "APPROVED";
}

/** A wall-clock time ("2026-10-13T19:00", as typed in a datetime-local input) in an IANA time zone → UTC ISO string. */
export function zonedToIso(local: string, timeZone: string) {
  const wall = Date.parse(`${local}:00Z`);
  const offsetAt = (t: number) => {
    const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(new Date(t)).map((x) => [x.type, x.value]));
    return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - Math.floor(t / 1000) * 1000;
  };
  let t = wall - offsetAt(wall);
  t = wall - offsetAt(t); // second pass settles a DST boundary
  return new Date(t).toISOString();
}

export const MODE_LABEL: Record<(typeof MODES)[number], string> = { queue: "Add to Buffer queue", scheduled: "Schedule", draft: "Save as draft", now: "Publish now" };

/** "Publish to 2 accounts: TikTok @x, Instagram @y · scheduled 13 Oct 19:00". */
export function targetSummary(items: { platform: string; handle: string }[], mode: (typeof MODES)[number], dueLocal?: string) {
  if (!items.length) return "Approve without publishing";
  const names = items.map((i) => `${i.platform} @${i.handle}`).join(", ");
  const verb = mode === "draft" ? "Save a draft for" : mode === "now" ? "Publish now to" : mode === "scheduled" ? "Schedule for" : "Add to the Buffer queue for";
  const when = mode === "scheduled" && dueLocal ? ` at ${dueLocal.replace("T", " ")}` : "";
  return `${verb} ${items.length} account${items.length === 1 ? "" : "s"}: ${names}${when}`;
}

/** Date shown in the owner's time zone (Setting.timezone), never the server's. */
export const fmtZoned = (d: Date, timeZone: string) => d.toLocaleString("en-GB", { timeZone, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

/** The inverse of zonedToIso: a UTC date → "2026-10-13T19:00" for a datetime-local input, in the owner's time zone. */
export const toZonedInput = (d: Date, timeZone: string) => d.toLocaleString("sv-SE", { timeZone }).slice(0, 16).replace(" ", "T");
