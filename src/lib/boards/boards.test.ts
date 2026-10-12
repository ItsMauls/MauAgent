import { test } from "node:test";
import assert from "node:assert/strict";
import { integrationViews, type IntegrationCtx } from "../integrations";
import { addDays, agendaItems, countdown, dayKey, monthGrid } from "./agenda";
import { roleWork, type Snapshot } from "./status";

const at = (iso: string) => new Date(iso);

// ---------- integrations ----------

const acct = (o: Partial<IntegrationCtx["accounts"][number]> = {}) => ({
  platform: "instagram", handle: "kopi", active: true, tokenExpiresAt: null, refreshExpiresAt: null, lastError: null, quotaUsage: 3, quotaTotal: 50, ...o,
});
const ctx = (o: Partial<IntegrationCtx> = {}): IntegrationCtx => ({ accounts: [], cache: {}, env: {}, ...o });
const byId = (c: IntegrationCtx) => Object.fromEntries(integrationViews(c).map((v) => [v.id, v]));

test("integrations: Threads and Notion are never shown as connected", () => {
  const everything = ctx({
    accounts: [acct(), acct({ platform: "tiktok" })],
    cache: Object.fromEntries(["threads", "notion", "s3", "gemini"].map((id) => [id, { ok: true, summary: "OK", checkedAt: new Date() }])),
    env: { GOOGLE_GENERATIVE_AI_API_KEY: "x", ARK_API_KEY: "y", THREADS: "z", NOTION: "z" },
  });
  const v = byId(everything);
  assert.equal(v.threads.state, "soon");
  assert.equal(v.notion.state, "soon");
});

test("integrations: status comes from data, not assumptions", () => {
  let v = byId(ctx());
  assert.equal(v.instagram.state, "inactive");
  assert.equal(v.gemini.state, "inactive"); // no key
  assert.equal(v.s3.state, "configured"); // never checked yet → not "connected"
  assert.equal(v.seedance.state, "inactive");
  v = byId(ctx({ env: { ARK_API_KEY: "k" } }));
  assert.equal(v.seedance.state, "configured"); // key set but unverifiable for free
  v = byId(ctx({ accounts: [acct({ lastError: "reauth: 401" })], cache: { s3: { ok: false, summary: "NoSuchBucket", checkedAt: new Date() } } }));
  assert.equal(v.instagram.state, "attention");
  assert.equal(v.s3.state, "attention");
  v = byId(ctx({ accounts: [acct(), acct({ active: false, platform: "tiktok" })] }));
  assert.equal(v.instagram.state, "connected");
  assert.equal(v.tiktok.state, "inactive"); // deactivated accounts do not count
});

test("integrations: client payload never carries tokens or env values", () => {
  const secret = "sk-SECRET-VALUE-123";
  const views = integrationViews(ctx({
    accounts: [{ ...acct(), accessTokenEnc: secret, refreshTokenEnc: secret } as IntegrationCtx["accounts"][number]],
    env: { GOOGLE_GENERATIVE_AI_API_KEY: secret, ARK_API_KEY: secret },
  }));
  const json = JSON.stringify(views);
  assert.ok(!json.includes(secret));
  assert.ok(!/enc"|token"/i.test(json));
});

// ---------- agenda ----------

test("dayKey uses the owner's time zone", () => {
  const late = at("2026-10-12T20:00:00Z"); // 03:00 next day in Jakarta
  assert.equal(dayKey(late, "UTC"), "2026-10-12");
  assert.equal(dayKey(late, "Asia/Jakarta"), "2026-10-13");
});

test("monthGrid: Monday-first padding and length", () => {
  const g = monthGrid("2026-10-12"); // 1 Oct 2026 is a Thursday
  assert.equal(g.cells.slice(0, 3).every((c) => c === null), true);
  assert.equal(g.cells[3], "2026-10-01");
  assert.equal(g.cells.filter(Boolean).length, 31);
  assert.equal(addDays("2026-10-31", 1), "2026-11-01");
});

test("agendaItems: publish, deadline and the 7-day decision timeout", () => {
  const items = agendaItems(
    {
      jobs: [{ campaignId: "c1", platform: "instagram", scheduledAt: at("2026-10-12T02:00:00Z"), handle: "kopi" }, { campaignId: "c1", platform: "tiktok", scheduledAt: null, handle: "kopi" }],
      campaigns: [
        { id: "c1", status: "AWAITING_APPROVAL", product: "Kopi", deadline: "2026-10-20", gateStartedAt: at("2026-10-10T00:00:00Z") },
        { id: "c2", status: "DRAFTING", product: "Roti", deadline: "", gateStartedAt: at("2026-10-10T00:00:00Z") },
      ],
    },
    "Asia/Jakarta",
  );
  assert.deepEqual(items.map((i) => [i.kind, i.day]).sort(), [["approval", "2026-10-17"], ["deadline", "2026-10-20"], ["publish", "2026-10-12"]]);
  assert.equal(countdown(-1), "overdue");
  assert.equal(countdown(2 * 86_400_000 + 3 * 3_600_000), "2d 3h left");
});

// ---------- agent status ----------

const snap = (o: Partial<Snapshot> = {}): Snapshot => ({ running: [], waiting: [], tasks: [], ...o });

test("roleWork: busy > waiting > idle, derived from data", () => {
  assert.equal(roleWork("creativeDirector", snap()).state, "idle");
  const s = snap({
    running: [{ agentRole: "creativeDirector", campaignId: "c1", product: "Kopi", startedAt: at("2026-10-12T01:00:00Z") }],
    waiting: [
      { campaignId: "c2", product: "Roti", status: "AWAITING_VIDEO_UPLOAD", since: at("2026-10-11T00:00:00Z") },
      { campaignId: "c3", product: "Teh", status: "AWAITING_APPROVAL", since: at("2026-10-11T00:00:00Z") },
    ],
    tasks: [{ id: "t1", agentRole: "creativeDirector", status: "QUEUED", title: "3 concepts", createdAt: at("2026-10-12T02:00:00Z"), roleSlug: "creative-director" }],
  });
  const cd = roleWork("creativeDirector", s);
  assert.equal(cd.state, "busy");
  assert.deepEqual(cd.items.map((i) => i.state), ["busy", "waiting"]);
  assert.equal(roleWork("videographer", s).state, "waiting");
  assert.equal(roleWork("accountTeam", s).state, "waiting");
  assert.equal(roleWork("producer", s).state, "idle");
});

test("roleWork: one entry per campaign, busy wins", () => {
  const s = snap({
    running: [{ agentRole: "videographer", campaignId: "c1", product: "Kopi", startedAt: at("2026-10-12T01:00:00Z") }],
    waiting: [{ campaignId: "c1", product: "Kopi", status: "AWAITING_VIDEO_UPLOAD", since: at("2026-10-12T00:00:00Z") }],
  });
  const v = roleWork("videographer", s);
  assert.equal(v.state, "busy");
  assert.deepEqual(v.items.map((i) => [i.title, i.state]), [["Kopi", "busy"]]);
});
