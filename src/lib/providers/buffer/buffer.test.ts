import assert from "node:assert/strict";
import { test } from "node:test";
import { z } from "zod";
import { bufferRequest, BufferAuthError, BufferRateLimitError, BufferTransientError, BufferValidationError } from "./client";
import { bufferPublish, bufferChannels, bufferSchedule } from "./index";
import { channelStatus, editInput, jobStatus, postInput, scheduleInput } from "./mapper";
import { planSync } from "./sync";

const KEY = "sk-secret-key";
const env = { BUFFER_API_KEY: KEY, BUFFER_ORGANIZATION_ID: "org1" };
const Ok = z.object({ ok: z.boolean() });
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers });
const seq = (...rs: (() => Response)[]) => {
  const calls: { headers: Headers; body: string }[] = [];
  const f = (async (_u: unknown, init: RequestInit) => {
    calls.push({ headers: new Headers(init.headers), body: String(init.body) });
    return rs[Math.min(calls.length - 1, rs.length - 1)]();
  }) as typeof fetch;
  return { f, calls };
};
const deps = (f: typeof fetch, slept: number[] = []) => ({ fetch: f, env, sleep: async (ms: number) => void slept.push(ms) });

test("success sends the key only in the header", async () => {
  const { f, calls } = seq(() => json({ data: { ok: true } }));
  assert.deepEqual(await bufferRequest("q", {}, Ok, deps(f)), { ok: true });
  assert.equal(calls[0].headers.get("authorization"), `Bearer ${KEY}`);
  assert.ok(!calls[0].body.includes(KEY));
});

test("401 and UNAUTHORIZED are auth errors without retry", async () => {
  const a = seq(() => json({}, 401));
  await assert.rejects(bufferRequest("q", {}, Ok, deps(a.f)), BufferAuthError);
  assert.equal(a.calls.length, 1);
  const b = seq(() => json({ errors: [{ message: "x", extensions: { code: "UNAUTHORIZED" } }] }));
  await assert.rejects(bufferRequest("q", {}, Ok, deps(b.f)), BufferAuthError);
});

test("429 waits for Retry-After and retries once the window passes", async () => {
  const slept: number[] = [];
  const { f, calls } = seq(() => json({ errors: [{ message: "x", extensions: { code: "RATE_LIMIT_EXCEEDED" } }] }, 429, { "Retry-After": "7" }), () => json({ data: { ok: true } }));
  await bufferRequest("q", {}, Ok, deps(f, slept));
  assert.equal(calls.length, 2);
  assert.deepEqual(slept, [7000]);
});

test("a long Retry-After surfaces instead of blocking", async () => {
  const { f } = seq(() => json({}, 429, { "Retry-After": "900" }));
  await assert.rejects(bufferRequest("q", {}, Ok, deps(f)), (e) => e instanceof BufferRateLimitError && e.retryAfter === 900);
});

test("transient errors retry up to 3 attempts, GraphQL errors do not", async () => {
  const t = seq(() => json({}, 503));
  await assert.rejects(bufferRequest("q", {}, Ok, deps(t.f)), BufferTransientError);
  assert.equal(t.calls.length, 3);
  const g = seq(() => json({ errors: [{ message: "Bad input" }] }));
  await assert.rejects(bufferRequest("q", {}, Ok, deps(g.f)), BufferValidationError);
  assert.equal(g.calls.length, 1);
});

test("unexpected shapes are rejected", async () => {
  const { f } = seq(() => json({ data: { nope: 1 } }));
  await assert.rejects(bufferRequest("q", {}, Ok, deps(f)), BufferValidationError);
});

test("createPost is never retried", async () => {
  const { f, calls } = seq(() => json({}, 503));
  await assert.rejects(bufferPublish({ channelId: "c", service: "tiktok", text: "t", videoUrl: "https://x/v.mp4", mode: "queue" }, deps(f)), BufferTransientError);
  assert.equal(calls.length, 1);
});

test("createPost surfaces a MutationError message", async () => {
  const { f } = seq(() => json({ data: { createPost: { message: "Limit reached" } } }));
  await assert.rejects(bufferPublish({ channelId: "c", service: "tiktok", text: "t", videoUrl: "https://x/v.mp4", mode: "now" }, deps(f)), /Limit reached/);
});

test("channels use the configured organization and parse strictly", async () => {
  const ch = { id: "c1", name: "n", displayName: null, service: "tiktok", isDisconnected: false, isLocked: false, isQueuePaused: false, timezone: "UTC" };
  const { f, calls } = seq(() => json({ data: { channels: [ch] } }));
  assert.equal((await bufferChannels(deps(f)))[0].id, "c1");
  assert.ok(calls[0].body.includes("org1"));
});

test("post input per mode, AI-flagged", () => {
  const base = { channelId: "c", text: "t", videoUrl: "https://x/v.mp4" } as const;
  const d = new Date("2026-10-13T12:00:00Z");
  assert.equal(postInput({ ...base, service: "instagram", mode: "queue" }).mode, "addToQueue");
  const s = postInput({ ...base, service: "tiktok", mode: "scheduled", dueAt: d });
  assert.equal(s.mode, "customScheduled");
  assert.equal(s.dueAt, d.toISOString());
  const dr = postInput({ ...base, service: "threads", mode: "draft" });
  assert.equal(dr.saveToDraft, true);
  assert.equal(postInput({ ...base, service: "threads", mode: "now" }).mode, "shareNow");
  for (const m of ["queue", "now", "draft"] as const) assert.equal(postInput({ ...base, service: "instagram", mode: m }).aiAssisted, true);
  assert.deepEqual(postInput({ ...base, service: "tiktok", mode: "queue" }).metadata, { tiktok: { isAiGenerated: true } });
  assert.deepEqual(postInput({ ...base, service: "instagram", mode: "queue" }).metadata, { instagram: { type: "reel", shouldShareToFeed: true } });
  assert.throws(() => postInput({ ...base, service: "tiktok", mode: "scheduled" }));
  assert.deepEqual(postInput({ ...base, service: "instagram", mode: "queue" }).assets, [{ video: { url: base.videoUrl } }]);
});

test("a text post carries no assets; a thread repeats its first part and never sends needsApproval", () => {
  const base = { channelId: "c", text: "part 1" } as const;
  const single = postInput({ ...base, service: "twitter", mode: "draft" });
  assert.equal("assets" in single, false, "no video, no assets key");
  assert.equal("metadata" in single, false, "a single post needs no thread metadata");
  assert.equal("needsApproval" in single, false, "verified live: it must not be sent");

  const th = postInput({ ...base, service: "twitter", mode: "draft", thread: ["part 2", "part 3"] });
  assert.deepEqual(th.metadata, { twitter: { thread: [{ text: "part 1" }, { text: "part 2" }, { text: "part 3" }] } });
  assert.equal((th.metadata as { twitter: { thread: { text: string }[] } }).twitter.thread[0].text, th.text, "the top-level text must equal part 1");
  assert.deepEqual(postInput({ ...base, service: "threads", mode: "draft", thread: ["part 2"] }).metadata, { threads: { thread: [{ text: "part 1" }, { text: "part 2" }] } });

  // A draft keeps its intended time (createPost accepts customScheduled + dueAt + saveToDraft together).
  const d = new Date("2026-10-13T02:00:00Z");
  const timed = postInput({ ...base, service: "twitter", mode: "draft", dueAt: d });
  assert.equal(timed.saveToDraft, true);
  assert.equal(timed.mode, "customScheduled");
  assert.equal(timed.dueAt, d.toISOString());
  assert.equal(postInput({ ...base, service: "twitter", mode: "draft" }).mode, "addToQueue", "a draft with no time just queues");
});

test("scheduleInput resends the text (editPost replaces, it does not merge)", () => {
  const d = new Date("2026-10-13T02:00:00Z");
  const i = scheduleInput({ id: "b1", service: "twitter", text: "part 1", thread: ["part 2"], dueAt: d });
  assert.deepEqual(i, {
    id: "b1", text: "part 1", saveToDraft: false, mode: "customScheduled", dueAt: d.toISOString(),
    metadata: { twitter: { thread: [{ text: "part 1" }, { text: "part 2" }] } },
  });
  assert.equal("metadata" in scheduleInput({ id: "b1", service: "twitter", text: "only", dueAt: d }), false);
});

test("bufferSchedule returns the new status, surfaces a MutationError, and is never retried", async () => {
  const ok = seq(() => json({ data: { editPost: { post: { id: "b1", status: "scheduled", dueAt: "2026-10-13T02:00:00.000Z" } } } }));
  assert.equal(await bufferSchedule({ id: "b1", service: "twitter", text: "t", dueAt: new Date("2026-10-13T02:00:00Z") }, deps(ok.f)), "scheduled");
  assert.ok(ok.calls[0].body.includes("saveToDraft"));

  const bad = seq(() => json({ data: { editPost: { message: "Post must have either text or media." } } }));
  await assert.rejects(bufferSchedule({ id: "b1", service: "twitter", text: "t", dueAt: new Date() }, deps(bad.f)), /must have either text or media/);

  const boom = seq(() => json({}, 503));
  await assert.rejects(bufferSchedule({ id: "b1", service: "twitter", text: "t", dueAt: new Date() }, deps(boom.f)), BufferTransientError);
  assert.equal(boom.calls.length, 1, "a mutation is never auto-retried");
});

test("channel and post status mapping", () => {
  assert.equal(channelStatus({ isDisconnected: true, isLocked: false, isQueuePaused: false }).status, "needs_reauth");
  assert.equal(channelStatus({ isDisconnected: false, isLocked: true, isQueuePaused: false }).status, "disabled");
  assert.equal(channelStatus({ isDisconnected: false, isLocked: false, isQueuePaused: true }).status, "connected");
  assert.equal(jobStatus("sent"), "published");
  assert.equal(jobStatus("error"), "failed");
  assert.equal(jobStatus("sending"), "publishing");
  assert.equal(jobStatus("scheduled"), "scheduled");
});

test("sync: new channel, missing channel, local settings are not in updates", () => {
  const c = (id: string, service: string) => ({ id, name: id, displayName: null, service, isDisconnected: false, isLocked: false, isQueuePaused: false, timezone: "UTC" });
  const r = planSync([c("a", "tiktok"), c("b", "instagram"), c("x", "youtube")], [{ platformUserId: "a", status: "connected" }, { platformUserId: "gone", status: "connected" }, { platformUserId: "old", status: "missing" }]);
  assert.deepEqual(r.upserts.map((u) => [u.platformUserId, u.isNew]), [["a", false], ["b", true]]);
  assert.deepEqual(r.missing, ["gone"]);
  for (const u of r.upserts) for (const k of ["active", "isDefaultForPlatform", "brandKitId"]) assert.ok(!(k in u));
});

test("editInput: a timed draft keeps saveToDraft, queue and now drop the time", () => {
  const d = new Date("2026-10-14T12:00:00Z");
  const draft = editInput({ id: "b1", service: "twitter", text: "t", mode: "draft", dueAt: d });
  assert.deepEqual([draft.saveToDraft, draft.mode, draft.dueAt], [true, "customScheduled", d.toISOString()]);
  const now = editInput({ id: "b1", service: "threads", text: "t", thread: ["2"], mode: "now", dueAt: d });
  assert.deepEqual([now.saveToDraft, now.mode, "dueAt" in now, "metadata" in now], [false, "shareNow", false, true]);
  assert.equal(editInput({ id: "b1", service: "twitter", text: "t", mode: "queue" }).mode, "addToQueue");
});
