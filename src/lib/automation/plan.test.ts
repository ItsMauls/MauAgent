import { test } from "node:test";
import assert from "node:assert/strict";
import { contentSetup } from "@/lib/content/config";
import { onlyTypes } from "@/lib/content/generate";
import { isThreadType } from "@/lib/content/select";
import { Goal, PlanConfig } from "./config";
import { buildPlan, capacity, planDays, PlanInfeasible, rng, spread, targetFrom, type PlannedPost } from "./plan";

const setup = contentSetup();
const accounts = [{ id: "x1", platform: "twitter" as const }, { id: "t1", platform: "threads" as const }];
const goal = (o: Partial<Goal> = {}) =>
  Goal.parse({ targetPosts: 30, accountIds: ["x1", "t1"], startDate: "2026-11-02", endDate: "2026-11-30", pillars: ["kopi", "kerja remote", "jakarta"], audience: "anak muda Jakarta", ...o });
const cfg = (o: Partial<PlanConfig> = {}) => PlanConfig.parse(o);
const plan = (g = goal(), c = cfg(), seed = 7, tz = "Asia/Jakarta") =>
  buildPlan({ goal: g, cfg: c, accounts, tz, seed, content: setup.config, angles: setup.angles, variants: 3 });
const bySlot = (p: PlannedPost[]) => [...new Set(p.map((x) => x.slot))];
const minutesOf = (local: string) => +local.slice(11, 13) * 60 + +local.slice(14, 16);

test("rng: seeded, deterministic, in [0,1)", () => {
  const a = rng(42), b = rng(42);
  const xs = Array.from({ length: 1000 }, () => a());
  assert.deepEqual(xs.slice(0, 5), Array.from({ length: 5 }, () => b()));
  assert.ok(xs.every((x) => x >= 0 && x < 1));
  assert.notEqual(rng(1)(), rng(2)());
});

test("buildPlan: the same seed gives the same plan, another seed a different one", () => {
  assert.deepEqual(plan(), plan());
  assert.notDeepEqual(plan().map((p) => p.localTime), plan(goal(), cfg(), 8).map((p) => p.localTime));
});

test("buildPlan: slots = target, rows = slots × accounts, for 1, 7, 300 and 2000", () => {
  for (const [n, end, perDay] of [[1, "2026-11-02", 4], [7, "2026-11-08", 4], [300, "2027-01-31", 6], [2000, "2027-10-31", 8]] as const) {
    const p = plan(goal({ targetPosts: n, endDate: end }), cfg({ maxPostsPerDay: perDay }));
    assert.equal(bySlot(p).length, n, `slots for ${n}`);
    assert.equal(p.length, n * accounts.length, `rows for ${n}`);
    assert.deepEqual(bySlot(p), Array.from({ length: n }, (_, i) => i));
  }
});

test("buildPlan: no account posts twice within the gap or in the same minute; times stay in active hours", () => {
  const c = cfg({ maxPostsPerDay: 6, minGapMinutes: 90, jitterMinutes: 30, activeHours: [8, 22] });
  const p = plan(goal({ targetPosts: 150 }), c);
  for (const a of accounts) {
    const times = p.filter((x) => x.socialAccountId === a.id).map((x) => x.scheduledAt.getTime()).sort((x, y) => x - y);
    for (let i = 1; i < times.length; i++) assert.ok(times[i] - times[i - 1] >= 90 * 60_000, `gap ${a.id} #${i}`);
  }
  for (const x of p) {
    const m = minutesOf(x.localTime);
    assert.ok(m >= 8 * 60 && m < 22 * 60, x.localTime);
  }
});

test("buildPlan: local time maps to the right UTC instant, including a day crossing UTC midnight", () => {
  // 05:00-09:00 Jakarta (UTC+7) is 22:00-02:00 UTC, so posts land on the previous UTC day.
  const p = plan(goal({ targetPosts: 2, startDate: "2026-11-02", endDate: "2026-11-02" }), cfg({ activeHours: [5, 9], maxPostsPerDay: 2, minGapMinutes: 60 }));
  for (const x of p) {
    const local = new Date(Date.parse(`${x.localTime.replace(" ", "T")}:00Z`) - 7 * 3_600_000);
    assert.equal(x.scheduledAt.toISOString(), local.toISOString());
  }
  assert.ok(p.some((x) => x.scheduledAt.toISOString().startsWith("2026-11-01")));
});

test("buildPlan: quiet weekdays stay empty and weights skew the spread", () => {
  const p = plan(goal({ targetPosts: 40 }), cfg({ quietWeekdays: [5, 6], maxPostsPerDay: 4 }));
  const weekday = (d: string) => (new Date(Date.parse(d)).getUTCDay() + 6) % 7;
  assert.ok(p.every((x) => weekday(x.localTime.slice(0, 10)) < 5));
  const heavy = plan(goal({ targetPosts: 30 }), cfg({ weekdayWeights: [3, 1, 1, 1, 1, 1, 1], maxPostsPerDay: 6 }));
  const mondays = bySlot(heavy.filter((x) => weekday(x.localTime.slice(0, 10)) === 0)).length;
  const tuesdays = bySlot(heavy.filter((x) => weekday(x.localTime.slice(0, 10)) === 1)).length;
  assert.ok(mondays > tuesdays, `${mondays} vs ${tuesdays}`);
});

test("capacity: shortfall when the target does not fit; buildPlan refuses it", () => {
  const g = goal({ targetPosts: 200, startDate: "2026-11-02", endDate: "2026-11-11" });
  const c = cfg({ maxPostsPerDay: 4 });
  assert.deepEqual(capacity(g, c), { days: 10, perDay: 4, total: 40, shortfall: 160 });
  assert.throws(() => plan(g, c), (e) => e instanceof PlanInfeasible && e.shortfall === 160);
  // The window also caps a day: 2 hours with a 90-minute gap fits one text.
  assert.equal(capacity(g, cfg({ activeHours: [8, 10], minGapMinutes: 90, maxPostsPerDay: 10 })).perDay, 1);
  assert.equal(planDays({ startDate: "2026-11-02", endDate: "2026-11-08" }, cfg({ quietWeekdays: [6] })).length, 6);
});

test("buildPlan: weekly thread cap and maxConsecutive hold across the whole plan", () => {
  const p = plan(goal({ targetPosts: 300, endDate: "2027-01-31" }), cfg({ maxPostsPerDay: 6 }));
  const slots = bySlot(p).map((s) => p.find((x) => x.slot === s)!);
  const { maxConsecutive, weeklyThreadCap } = setup.config;
  for (let i = maxConsecutive; i < slots.length; i++) {
    const run = slots.slice(i - maxConsecutive, i + 1).map((x) => x.contentType);
    assert.ok(!run.every((t) => t === run[0]), `repeat at ${i}`);
  }
  const threadDays = slots.filter((x) => isThreadType(setup.config, x.contentType)).map((x) => Date.parse(x.localTime.slice(0, 10)));
  for (const d of threadDays) assert.ok(threadDays.filter((t) => t > d - 7 * 86_400_000 && t <= d).length <= weeklyThreadCap);
  // Rows of a slot share the spec; only time differs per account.
  const s0 = p.filter((x) => x.slot === 0);
  assert.equal(new Set(s0.map((x) => JSON.stringify([x.contentType, x.angles, x.pillar, x.cta]))).size, 1);
});

test("spread and targetFrom", () => {
  assert.deepEqual(spread([1, 1, 1], 4, 2), [2, 1, 1]);
  assert.deepEqual(spread([1, 0, 1], 4, 2), [2, 0, 2]);
  assert.deepEqual(spread([1, 1], 5, 2), [2, 2]); // capped: the caller's feasibility check catches the shortfall
  assert.equal(targetFrom({ mode: "total", total: 300, perDay: 3, days: 30 }), 300);
  assert.equal(targetFrom({ mode: "rate", total: 0, perDay: 3, days: 30 }), 90);
});

test("buildPlan: the owner's content-type picks and post length shape the whole plan", () => {
  const only = (types: string[], length: "auto" | "short" | "long" = "auto") => {
    const content = onlyTypes(setup.config, types, 40, length);
    return buildPlan({ goal: goal({ targetPosts: 40 }), cfg: cfg({ maxPostsPerDay: 4 }), accounts, tz: "Asia/Jakarta", seed: 3, content, angles: setup.angles, variants: 3 });
  };
  assert.deepEqual([...new Set(only(["question"]).map((p) => p.contentType))], ["question"]);
  assert.deepEqual([...new Set(only(["question", "hot_take"]).map((p) => p.contentType))].sort(), ["hot_take", "question"]);
  // A short length drops thread types from the mix.
  assert.ok(!only([], "short").some((p) => isThreadType(setup.config, p.contentType)));
});
