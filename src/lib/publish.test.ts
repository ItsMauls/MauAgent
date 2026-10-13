import assert from "node:assert/strict";
import { test } from "node:test";
import { buildScheduleSlots, campaignOutcome, charCount, convertOnce, publishOnce, resolveTargets, slotCount, targetSummary, textProblem, toZonedInput, zonedToIso, type ConvertIO, type PublishIO, type PublishJobInput } from "./publish";

const job = (over: Partial<PublishJobInput> = {}): PublishJobInput => ({ postId: null, mode: "queue", dueAt: null, platform: "tiktok", channelId: "c1", text: "hi", finalCutKey: "k.mp4", ...over });
const io = (create: PublishIO["create"]): PublishIO & { n: () => number } => {
  let n = 0;
  return { presign: async (k, ttl) => `https://s3/${k}?ttl=${ttl}`, create: async (p) => { n++; return create(p); }, n: () => n };
};

test("a job that already has a post id never calls Buffer again", async () => {
  const x = io(async () => "new");
  const r = await publishOnce(job({ postId: "p1" }), x);
  assert.deepEqual(r, { kind: "accepted", postId: "p1", created: false });
  assert.equal(x.n(), 0);
});

test("an injected Buffer error fails the job without a post id (retry = new attempt, no duplicate)", async () => {
  const bad = io(async () => { throw new Error("Buffer rate limit reached"); });
  const r = await publishOnce(job(), bad);
  assert.deepEqual(r, { kind: "failed", error: "Buffer rate limit reached" });
  const ok = io(async () => "p2");
  assert.equal((await publishOnce(job(), ok)).kind, "accepted");
  assert.equal(ok.n(), 1);
});

test("one failing channel does not affect another", async () => {
  const create: PublishIO["create"] = async (p) => { if (p.channelId === "bad") throw new Error("nope"); return `post-${p.channelId}`; };
  const rs = await Promise.all([publishOnce(job({ channelId: "bad" }), io(create)), publishOnce(job({ channelId: "good" }), io(create))]);
  assert.deepEqual(rs.map((r) => r.kind), ["failed", "accepted"]);
});

test("mode drives the due date and the presign lifetime; guards", async () => {
  let seen: Parameters<PublishIO["create"]>[0] | undefined; let ttl = 0;
  const x: PublishIO = { presign: async (_k, t) => { ttl = t; return "https://u"; }, create: async (p) => { seen = p; return "p"; } };
  const due = new Date("2026-10-13T12:00:00Z");
  await publishOnce(job({ mode: "scheduled", dueAt: due }), x);
  assert.equal(seen?.dueAt, due); assert.equal(ttl, 6 * 3600);
  await publishOnce(job({ mode: "queue", dueAt: due }), x);
  assert.equal(seen?.dueAt, undefined); assert.equal(ttl, 7 * 86400);
  assert.equal((await publishOnce(job({ text: " " }), x)).kind, "failed", "TikTok needs a caption");
  assert.equal((await publishOnce(job({ finalCutKey: null }), x)).kind, "failed");
});

const acc = (id: string, platform: string, over = {}) => ({ id, platform, active: true, status: "connected", isDefaultForPlatform: true, ...over });

test("no targets and no default: nothing to publish, campaign stays approved", () => {
  assert.deepEqual(resolveTargets(undefined, [acc("a", "tiktok", { isDefaultForPlatform: false })], ["tiktok"]), []);
  assert.deepEqual(resolveTargets([], [acc("a", "tiktok")], ["tiktok"]), [], "an explicit empty list means do not publish");
});

test("defaults: enabled default channel per brief platform, queued", () => {
  const r = resolveTargets(undefined, [acc("a", "tiktok"), acc("b", "instagram"), acc("c", "tiktok", { active: false }), acc("d", "instagram", { status: "missing" })], ["tiktok"]);
  assert.deepEqual(r, [{ accountId: "a", mode: "queue" }]);
});

test("campaign outcome", () => {
  const j = (status: string, postId: string | null, mode = "queue") => ({ status, postId, mode });
  assert.equal(campaignOutcome([j("draft", null)]), "PUBLISHING");
  assert.equal(campaignOutcome([j("scheduled", "p"), j("failed", null)]), "PUBLISHED", "one success is enough");
  assert.equal(campaignOutcome([j("failed", null), j("failed", null)]), "APPROVED");
  assert.equal(campaignOutcome([j("draft", "p", "draft")]), "APPROVED", "a draft is not published");
  assert.equal(campaignOutcome([j("scheduled", "p"), j("publishing", null)]), "PUBLISHING");
});

test("zonedToIso converts wall time in a zone to UTC", () => {
  assert.equal(zonedToIso("2026-10-13T19:00", "Asia/Jakarta"), "2026-10-13T12:00:00.000Z");
  assert.equal(zonedToIso("2026-10-13T19:00", "UTC"), "2026-10-13T19:00:00.000Z");
  assert.equal(zonedToIso("2026-01-15T09:00", "America/New_York"), "2026-01-15T14:00:00.000Z");
  assert.equal(zonedToIso("2026-07-15T09:00", "America/New_York"), "2026-07-15T13:00:00.000Z");
});

test("summary names the accounts and the time", () => {
  assert.equal(targetSummary([], "queue"), "Approve without publishing");
  assert.equal(targetSummary([{ platform: "TikTok", handle: "x" }, { platform: "Instagram", handle: "y" }], "scheduled", "2026-10-13T19:00"), "Schedule for 2 accounts: TikTok @x, Instagram @y at 2026-10-13 19:00");
});

// ---------- text posts (X, Threads) ----------

test("a text post publishes with no video; a video platform still needs a final cut", async () => {
  let seen: Parameters<PublishIO["create"]>[0] | undefined;
  let presigned = 0;
  const x: PublishIO = { presign: async (k, t) => { presigned++; return `https://s3/${k}?ttl=${t}`; }, create: async (p) => { seen = p; return "p1"; } };

  const r = await publishOnce(job({ platform: "twitter", finalCutKey: null, thread: ["part 2", "part 3"] }), x);
  assert.deepEqual(r, { kind: "accepted", postId: "p1", created: true });
  assert.equal(presigned, 0, "a text post never presigns an asset");
  assert.equal(seen?.videoUrl, undefined);
  assert.deepEqual(seen?.thread, ["part 2", "part 3"]);

  assert.equal((await publishOnce(job({ platform: "tiktok", finalCutKey: null }), x)).kind, "failed", "video platforms still need a final cut");
  assert.equal((await publishOnce(job({ platform: "twitter", finalCutKey: null, text: "  " }), x)).kind, "failed", "a text post needs text");
});

test("a draft carries its intended time, so scheduling it only flips saveToDraft", async () => {
  let seen: Parameters<PublishIO["create"]>[0] | undefined;
  const x: PublishIO = { presign: async () => "https://u", create: async (p) => { seen = p; return "p"; } };
  const due = new Date("2026-10-13T02:00:00Z");
  await publishOnce(job({ platform: "twitter", finalCutKey: null, mode: "draft", dueAt: due }), x);
  assert.equal(seen?.dueAt, due);
});

const convIo = (schedule: ConvertIO["schedule"]): ConvertIO & { n: () => number } => {
  let n = 0;
  return { schedule: async (p) => { n++; return schedule(p); }, n: () => n };
};
const draft = (over = {}) => ({ postId: "b1", mode: "draft" as const, dueAt: new Date("2026-10-13T02:00:00Z"), platform: "twitter" as const, text: "hi", ...over });

test("convertOnce skips anything that is not an unconverted draft", async () => {
  const x = convIo(async () => "scheduled");
  assert.equal((await convertOnce(draft({ postId: null }), x)).kind, "skipped", "never sent to Buffer");
  assert.equal((await convertOnce(draft({ mode: "scheduled" }), x)).kind, "skipped", "already scheduled");
  assert.equal((await convertOnce(draft({ dueAt: null }), x)).kind, "skipped", "no time set");
  assert.equal(x.n(), 0, "a skip never calls Buffer");
});

test("a failure mid-batch leaves the others scheduled, and re-running only retries that one", async () => {
  const jobs = [1, 2, 3, 4, 5].map((n) => draft({ postId: `b${n}` }));
  const fail = convIo(async (p) => { if (p.id === "b3") throw new Error("Buffer: post rejected"); return "scheduled"; });
  const first = await Promise.all(jobs.map((j) => convertOnce(j, fail)));
  assert.deepEqual(first.map((r) => r.kind), ["scheduled", "scheduled", "failed", "scheduled", "scheduled"]);
  assert.equal(fail.n(), 5);

  // The four that went through are now mode "scheduled"; only the failed one is still a draft.
  const after = jobs.map((j) => (j.postId === "b3" ? j : draft({ postId: j.postId, mode: "scheduled" })));
  const again = convIo(async () => "scheduled");
  const second = await Promise.all(after.map((j) => convertOnce(j, again)));
  assert.deepEqual(second.map((r) => r.kind), ["skipped", "skipped", "scheduled", "skipped", "skipped"]);
  assert.equal(again.n(), 1, "no duplicate edit for an already scheduled post");
});

test("character budget: UTF-16 units, emoji count 2, X weights a URL as 23", () => {
  assert.equal(textProblem("twitter", "hello"), null);
  assert.equal(charCount("twitter", "🎉".repeat(140)), 280, "an emoji is 2 UTF-16 units");
  assert.equal(textProblem("twitter", "🎉".repeat(141)), "282 characters, 280 allowed on twitter");
  assert.equal(textProblem("threads", "a".repeat(500)), null);
  assert.equal(textProblem("threads", "a".repeat(501)), "501 characters, 500 allowed on threads");
  assert.equal(charCount("twitter", `see https://example.com/${"p".repeat(300)}`), "see ".length + 23);
  assert.equal(textProblem("twitter", `see https://example.com/${"p".repeat(300)}`), null, "a long URL still fits");
  assert.equal(textProblem("twitter", "  "), "Empty post");
  assert.equal(textProblem("instagram", "a".repeat(5000)), null, "no limit known for this service");
});

test("buildScheduleSlots fills day by day, then time by time", () => {
  const drafts = Array.from({ length: 18 }, (_, i) => ({ id: `d${i + 1}` }));
  const grid = { startDate: "2026-10-12", endDate: "2026-10-20", timeSlots: ["09:00", "19:00"], timezone: "Asia/Bangkok" };
  const slots = buildScheduleSlots({ ...grid, drafts });

  assert.equal(slots.length, 18, "9 days inclusive x 2 times");
  assert.equal(slotCount(grid), 18);
  assert.deepEqual(slots[0], { draftId: "d1", dueAtUtc: "2026-10-12T02:00:00.000Z" }, "09:00 Bangkok is 02:00Z the same day");
  assert.deepEqual(slots[1], { draftId: "d2", dueAtUtc: "2026-10-12T12:00:00.000Z" });
  assert.deepEqual(slots[2], { draftId: "d3", dueAtUtc: "2026-10-13T02:00:00.000Z" }, "next day, first time");
  assert.equal(slots.at(-1)?.dueAtUtc, "2026-10-20T12:00:00.000Z", "the end date is included");
  assert.deepEqual(slots.map((s) => s.draftId), drafts.map((d) => d.id), "drafts land in order");
});

test("buildScheduleSlots: timezone rollover, fewer and more drafts than slots, bad input", () => {
  // 01:00 Asia/Jakarta is the previous day in UTC.
  assert.equal(buildScheduleSlots({ startDate: "2026-10-12", endDate: "2026-10-12", timeSlots: ["01:00"], timezone: "Asia/Jakarta", drafts: [{ id: "d1" }] })[0].dueAtUtc, "2026-10-11T18:00:00.000Z");
  // A DST jump resolves through zonedToIso without drift.
  assert.equal(buildScheduleSlots({ startDate: "2026-03-08", endDate: "2026-03-08", timeSlots: ["09:00"], timezone: "America/New_York", drafts: [{ id: "d1" }] })[0].dueAtUtc, "2026-03-08T13:00:00.000Z");

  const grid = { startDate: "2026-10-12", endDate: "2026-10-13", timeSlots: ["09:00", "19:00"], timezone: "UTC" };
  assert.equal(buildScheduleSlots({ ...grid, drafts: [{ id: "a" }] }).length, 1, "fewer drafts leave the rest of the grid empty");
  assert.equal(buildScheduleSlots({ ...grid, drafts: Array.from({ length: 40 }, (_, i) => ({ id: `d${i}` })) }).length, 4, "more drafts than slots: only what fits");
  assert.equal(slotCount(grid), 4);

  assert.throws(() => buildScheduleSlots({ ...grid, startDate: "nope", drafts: [{ id: "a" }] }), /start and end date/);
  assert.throws(() => buildScheduleSlots({ ...grid, endDate: "2026-10-11", drafts: [{ id: "a" }] }), /on or after/);
  assert.throws(() => buildScheduleSlots({ ...grid, timeSlots: [], drafts: [{ id: "a" }] }), /at least one publish time/);
  assert.throws(() => buildScheduleSlots({ ...grid, timeSlots: ["9am"], drafts: [{ id: "a" }] }), /not a time of day/);
  assert.throws(() => buildScheduleSlots({ ...grid, timeSlots: ["24:00"], drafts: [{ id: "a" }] }), /not a time of day/);
  assert.equal(slotCount({ startDate: "2026-10-13", endDate: "2026-10-12", timeSlots: ["09:00"] }), 0, "an impossible range holds no slots");
});

test("toZonedInput is the inverse of zonedToIso", () => {
  assert.equal(toZonedInput(new Date(zonedToIso("2026-10-13T19:00", "Asia/Jakarta")), "Asia/Jakarta"), "2026-10-13T19:00");
});
