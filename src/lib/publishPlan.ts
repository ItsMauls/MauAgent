// Database side of publishing: create jobs idempotently, retry a failed one, settle the campaign status.
import { db } from "@/lib/db";
import { campaignOutcome, captionFor, TEXT_PLATFORMS, textProblem, type PublishTarget } from "@/lib/publish";
import { bufferEdit, MAX_THREAD, type BufferPlatform } from "@/lib/providers/buffer";

const keyFor = (campaignId: string, accountId: string, attempt: number) => `${campaignId}:${accountId}:${attempt}`;

/** Throws when a target cannot be published to (disabled, missing from Buffer, past due time). */
export async function checkTargets(targets: PublishTarget[]) {
  const accounts = await db.socialAccount.findMany({ where: { id: { in: targets.map((t) => t.accountId) } } });
  for (const t of targets) {
    const a = accounts.find((x) => x.id === t.accountId);
    if (!a || !a.active || a.publisher !== "buffer" || a.status === "missing") throw new Error(`@${a?.handle ?? t.accountId} is disabled, missing from Buffer or not linked through Buffer`);
    if (t.mode === "scheduled" && !(t.dueAt && new Date(t.dueAt).getTime() > Date.now())) throw new Error("Pick a time in the future");
  }
  return accounts;
}

/** Jobs sent to Buffer for these targets. An existing job for the same attempt is returned, never duplicated. */
export async function createPublishJobs(campaignId: string, targets: PublishTarget[], attempt = 1) {
  const c = await db.campaign.findUniqueOrThrow({ where: { id: campaignId }, select: { finalCutKey: true, status: true, approvalPackage: true } });
  if (!c.finalCutKey || !["APPROVED", "PUBLISHING", "PUBLISHED"].includes(c.status)) throw new Error("Only an approved campaign with a final cut can be published");
  const pkg = c.approvalPackage as { captionPerPlatform?: { platform: string; caption: string }[]; hashtags?: string[] } | null;
  const accounts = await checkTargets(targets);
  const jobs: { id: string; created: boolean }[] = [];
  for (const t of targets) {
    const a = accounts.find((x) => x.id === t.accountId)!;
    const dueAt = t.mode === "scheduled" ? new Date(t.dueAt!) : null;
    const idemKey = keyFor(campaignId, a.id, attempt);
    const existing = await db.publishJob.findFirst({ where: { idemKey: { in: attempt === 1 ? [idemKey, `${campaignId}:${a.id}`] : [idemKey] } }, select: { id: true } });
    if (existing) { jobs.push({ id: existing.id, created: false }); continue; }
    const j = await db.publishJob.create({
      data: {
        campaignId, socialAccountId: a.id, platform: a.platform, idemKey, attempt, mode: t.mode,
        status: t.mode === "scheduled" ? "scheduled" : "draft",
        caption: t.caption ?? captionFor(pkg, a.platform) ?? null, hashtags: t.hashtags ?? pkg?.hashtags ?? [], scheduledAt: dueAt,
      },
    });
    jobs.push({ id: j.id, created: true });
  }
  await db.campaign.updateMany({ where: { id: campaignId, status: "APPROVED" }, data: { status: "PUBLISHING" } });
  return jobs;
}

/** A failed job that never reached Buffer (no post id) gets a new attempt; one with a post id is managed in Buffer. */
export async function createRetryJob(jobId: string) {
  const j = await db.publishJob.findUniqueOrThrow({ where: { id: jobId } });
  if (j.status !== "failed" || j.postId) throw new Error("Only a failed job that never reached Buffer can be retried");
  if (!j.campaignId) throw new Error("Re-send this post from its task page");
  const [newest] = await db.publishJob.findMany({ where: { campaignId: j.campaignId, socialAccountId: j.socialAccountId }, orderBy: { attempt: "desc" }, take: 1 });
  if (newest.id !== j.id) throw new Error("A newer attempt already exists");
  const at = j.mode === "scheduled" && j.scheduledAt && j.scheduledAt.getTime() > Date.now() ? j.scheduledAt : null;
  const mode = j.mode === "scheduled" && !at ? "queue" : j.mode;
  return createPublishJobs(j.campaignId, [{ accountId: j.socialAccountId, mode, dueAt: at?.toISOString(), caption: j.caption ?? undefined, hashtags: j.hashtags }], j.attempt + 1);
}

/** Moves a PUBLISHING campaign to PUBLISHED, or back to APPROVED when nothing was accepted. Jobs of replaced attempts are ignored. */
export async function settleCampaign(campaignId: string) {
  const all = await db.publishJob.findMany({ where: { campaignId }, orderBy: { attempt: "desc" }, select: { status: true, postId: true, mode: true, socialAccountId: true } });
  const seen = new Set<string>();
  const latest = all.filter((j) => !seen.has(j.socialAccountId) && seen.add(j.socialAccountId));
  const to = campaignOutcome(latest);
  if (to === "PUBLISHING") return to;
  await db.campaign.updateMany({ where: { id: campaignId, status: "PUBLISHING" }, data: { status: to } });
  return to;
}

const slotKey = (taskId: string, slot: number, accountId: string) => `task:${taskId}:${slot}:${accountId}`;

export type SchedulePost = { text: string; thread: string[]; dueAtUtc: string; sourceNote?: string | null; sourceConfidence?: string | null };

/**
 * One draft job per slot x channel for a Socmed Specialist task. The slot is part of the idemKey, so many posts can
 * share a channel and pressing the button twice returns the existing rows instead of creating more.
 * Every text is checked against the channel's character budget first, so nothing is written when one post is too long.
 */
export async function createScheduleJobs(taskId: string, accountIds: string[], items: SchedulePost[]) {
  if (!items.length) throw new Error("Nothing to send: the schedule has no filled slots");
  const accounts = await checkTargets(accountIds.map((accountId) => ({ accountId, mode: "draft" as const })));
  if (!accounts.length) throw new Error("Pick at least one channel");

  for (const [slot, item] of items.entries())
    for (const a of accounts) {
      if (1 + item.thread.length > MAX_THREAD) throw new Error(`Post ${slot + 1} has ${1 + item.thread.length} thread parts; Buffer allows ${MAX_THREAD}`);
      for (const [part, text] of [item.text, ...item.thread].entries()) {
        const problem = textProblem(a.platform, text);
        if (problem) throw new Error(`Post ${slot + 1}${item.thread.length ? ` part ${part + 1}` : ""} for @${a.handle}: ${problem}`);
      }
    }

  const jobs: { id: string; created: boolean; postId: string | null }[] = [];
  for (const [slot, item] of items.entries())
    for (const a of accounts) {
      const idemKey = slotKey(taskId, slot, a.id);
      const existing = await db.publishJob.findUnique({ where: { idemKey }, select: { id: true, postId: true } });
      if (existing) { jobs.push({ ...existing, created: false }); continue; }
      const j = await db.publishJob.create({
        data: {
          agentTaskId: taskId, socialAccountId: a.id, platform: a.platform, idemKey, mode: "draft", status: "draft",
          caption: item.text, thread: item.thread, hashtags: [], scheduledAt: new Date(item.dueAtUtc),
          sourceNote: item.sourceNote ?? null, sourceConfidence: item.sourceConfidence ?? null,
        },
      });
      jobs.push({ id: j.id, created: true, postId: null });
    }
  return jobs;
}

/** Channels that can be picked as a target: enabled, still in Buffer. */
export const targetAccounts = () =>
  db.socialAccount.findMany({
    where: { publisher: "buffer", active: true, status: { not: "missing" } },
    orderBy: [{ platform: "asc" }, { handle: "asc" }],
    select: { id: true, platform: true, handle: true, isDefaultForPlatform: true },
  });

/** Picker options for a campaign: captions and hashtags come from its approval package. */
export function targetOptions(accounts: Awaited<ReturnType<typeof targetAccounts>>, pkg: unknown, platforms: string[]) {
  const p = pkg as { captionPerPlatform?: { platform: string; caption: string }[]; hashtags?: string[] } | null;
  return { accounts, captions: Object.fromEntries((p?.captionPerPlatform ?? []).map((c) => [c.platform, c.caption])), hashtags: p?.hashtags ?? [], platforms };
}

// ---------- Text posts (X / Threads), edited on the Publishing page ----------

export type PostDraft = { text: string; thread: string[]; mode: PublishTarget["mode"]; dueAt?: string };

/** Throws when a text or one of its thread parts cannot go to this platform. */
function checkPostText(platform: string, handle: string, p: PostDraft) {
  if (!TEXT_PLATFORMS.includes(platform)) throw new Error(`@${handle}: only X and Threads can post text on its own`);
  if (1 + p.thread.length > MAX_THREAD) throw new Error(`A thread holds at most ${MAX_THREAD} parts`);
  for (const [part, text] of [p.text, ...p.thread].entries()) {
    const problem = textProblem(platform, text);
    if (problem) throw new Error(`@${handle}${p.thread.length ? ` part ${part + 1}` : ""}: ${problem}`);
  }
}

/**
 * Edit a text post that has not gone out. A post Buffer already holds is changed there (editPost) first, so our row
 * never claims a state Buffer refused; one that never reached Buffer is just rewritten and (re)sent by the caller.
 */
export async function updatePostJob(jobId: string, p: PostDraft) {
  const j = await db.publishJob.findUniqueOrThrow({ where: { id: jobId }, include: { socialAccount: { select: { handle: true } } } });
  if (j.campaignId) throw new Error("Edit a campaign post on its campaign page");
  const editable = j.status === "draft" || j.status === "scheduled" || (j.status === "failed" && !j.postId && j.error !== "Cancelled");
  if (!editable) throw new Error("This post is already out or being sent; manage it in Buffer");
  checkPostText(j.platform, j.socialAccount.handle, p);
  if (p.mode === "scheduled" && !(p.dueAt && new Date(p.dueAt).getTime() > Date.now())) throw new Error("Pick a time in the future");
  const dueAt = p.dueAt && (p.mode === "scheduled" || p.mode === "draft") ? new Date(p.dueAt) : null;
  if (j.postId) await bufferEdit({ id: j.postId, service: j.platform as BufferPlatform, text: p.text, thread: p.thread, mode: p.mode, dueAt: dueAt ?? undefined });
  await db.publishJob.update({
    where: { id: j.id },
    data: {
      caption: p.text, thread: p.thread, mode: p.mode, scheduledAt: dueAt, error: null,
      status: p.mode === "scheduled" || p.mode === "queue" ? "scheduled" : j.postId && p.mode === "now" ? "publishing" : "draft",
    },
  });
  return { hasPostId: !!j.postId };
}
