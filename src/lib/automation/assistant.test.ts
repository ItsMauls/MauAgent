import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_PERSONAS } from "@/lib/agents/persona";
import { assistPrompt, AssistFill, toPatch, type AssistContext } from "./assistant";
import { capacity } from "./plan";
import { Goal, PERSONA_MAX, PlanConfig } from "./config";
import { strategyPrompt } from "./strategy";

const ctx: AssistContext = {
  today: "2026-10-14", maxPosts: 2000, types: ["question", "hot_take", "educational", "story"],
  accounts: [{ id: "x1", label: "X @kopi" }, { id: "t1", label: "Threads @kopi" }],
};
/** A complete answer, as the assistant must give it. */
const full: AssistFill = {
  name: "Kopi series", kind: "brand", brandName: "Kopi Senja", brandOffer: "single-origin coffee", brandVoice: "cheeky barista", accountIds: ["x1", "t1"],
  objectives: ["Grow followers", "Spark conversation and replies"], objectiveNote: "try the cold brew", audienceTraits: ["Young professionals"], audienceNote: "office workers in Jakarta",
  pillars: ["es kopi susu", "kerja dari kafe"], language: "id", tones: ["witty", "warm"], types: ["question", "hot_take"], length: "short", hashtags: "none", customTags: "",
  cta: "none", linkUrl: "", avoid: "politik", startDate: "2026-11-02", endDate: "2026-11-30", totalPosts: 60, maxPostsPerDay: 4, activeFromHour: 8, activeUntilHour: 22,
  minGapMinutes: 90, quietDays: [6], kpiMetric: null, kpiValue: null, reviewMode: "qc_auto", forceReviewTypes: ["educational", "story"], qcThreshold: 0.8,
  variantsPerPost: 3, horizonDays: 10, payAsYouGo: true, budgetCapUsd: null, warnAtPct: 80, assumptions: ["Chose witty and warm from the brand description."],
};

test("a complete answer fills every point of the form, down to the budget", () => {
  const { patch, notes } = toPatch(full, ctx);
  assert.equal(Object.keys(patch).length, 37, "every field of the form is set");
  assert.ok(Object.values(patch).every((v) => v !== undefined));
  assert.deepEqual([patch.kind, patch.brandName, patch.language, patch.length, patch.hashtags], ["brand", "Kopi Senja", "id", "short", "none"]);
  assert.deepEqual([patch.total, patch.maxPostsPerDay, patch.hours, patch.minGapMinutes, patch.quiet], [60, 4, [8, 22], 90, [6]]);
  assert.deepEqual([patch.reviewMode, patch.forceReviewTypes, patch.minConfidence, patch.variants, patch.horizonDays], ["qc_auto", ["educational", "story"], 0.8, 3, 10]);
  assert.deepEqual([patch.payg, patch.warnAtPct, patch.accountIds], [true, 80, ["x1", "t1"]]);
  assert.deepEqual(notes, ["Chose witty and warm from the brand description."]);
});

test("the schema takes only the form's own options and needs every field", () => {
  assert.equal(AssistFill.safeParse(full).success, true);
  assert.equal(AssistFill.safeParse({ ...full, objectives: ["Take over the world"] }).success, false);
  assert.equal(AssistFill.safeParse({ ...full, tones: ["sarcastic"] }).success, false);
  const { name: _omit, ...missing } = full;
  void _omit;
  assert.equal(AssistFill.safeParse(missing).success, false);
});

test("the plan always fits: the daily limit is raised first, then the total is lowered", () => {
  const raised = toPatch({ ...full, totalPosts: 120, maxPostsPerDay: 2 }, ctx);
  assert.equal(raised.patch.total, 120);
  assert.ok(raised.patch.maxPostsPerDay >= 5);
  assert.match(raised.notes.join(" "), /Raised the daily limit/);
  const lowered = toPatch({ ...full, totalPosts: 1000, startDate: "2026-11-02", endDate: "2026-11-05", quietDays: [] }, ctx);
  assert.ok(lowered.patch.total < 1000);
  assert.match(lowered.notes.join(" "), /Lowered the total from 1000/);
  for (const r of [raised, lowered]) {
    const cfg = PlanConfig.parse({ maxPostsPerDay: r.patch.maxPostsPerDay, activeHours: r.patch.hours, quietWeekdays: r.patch.quiet, minGapMinutes: r.patch.minGapMinutes });
    assert.equal(capacity({ startDate: r.patch.startDate, endDate: r.patch.endDate, targetPosts: r.patch.total }, cfg).shortfall, 0);
  }
  assert.equal(toPatch({ ...full, totalPosts: 99999 }, ctx).patch.total <= 2000, true);
});

test("values outside the form's ranges are brought back; bad dates get sensible ones", () => {
  const { patch } = toPatch({
    ...full, startDate: "last month", endDate: "soon", activeFromHour: 22, activeUntilHour: 6, minGapMinutes: 1, maxPostsPerDay: 99, quietDays: [0, 1, 2, 3, 4, 5, 6, 9],
    qcThreshold: 0.1, variantsPerPost: 7, horizonDays: 0, warnAtPct: 150, accountIds: ["nope"], types: ["question", "satire_gone"] as never, linkUrl: "not a link",
  }, ctx);
  assert.deepEqual([patch.startDate, patch.endDate], ["2026-10-15", "2026-11-13"], "tomorrow, then 30 days");
  assert.deepEqual(patch.hours, [8, 22]);
  assert.equal(patch.minGapMinutes, 5);
  assert.deepEqual(patch.quiet, [], "never every day quiet");
  assert.deepEqual([patch.minConfidence, patch.variants, patch.horizonDays, patch.warnAtPct], [0.5, 3, 1, 99]);
  assert.deepEqual(patch.accountIds, ["x1", "t1"], "unknown accounts fall back to all");
  assert.deepEqual(patch.types, ["question"]);
  assert.equal(patch.linkUrl, "");
  assert.ok(patch.maxPostsPerDay <= 24);
  assert.equal(toPatch({ ...full, startDate: "2026-10-01" }, ctx).patch.startDate, "2026-10-15", "a start in the past moves to tomorrow");
});

test("personal accounts carry no brand fields; kpi and budget follow what was said", () => {
  const p = toPatch({ ...full, kind: "personal", brandName: "X Corp", brandOffer: "stuff", brandVoice: "loud" }, ctx).patch;
  assert.deepEqual([p.kind, p.brandName, p.brandOffer, p.brandVoice], ["personal", "", "", ""]);
  assert.deepEqual([toPatch({ ...full, kpiMetric: "followers", kpiValue: 500 }, ctx).patch.kpiMetric, toPatch({ ...full, kpiMetric: "followers", kpiValue: null }, ctx).patch.kpiMetric], ["followers", ""]);
  const cap = toPatch({ ...full, payAsYouGo: false, budgetCapUsd: 12.5 }, ctx).patch;
  assert.deepEqual([cap.payg, cap.budgetCapUsd], [false, 12.5]);
  assert.equal(toPatch({ ...full, payAsYouGo: false, budgetCapUsd: null }, ctx).patch.payg, true, "no budget given = pay as you go");
  assert.equal(toPatch({ ...full, hashtags: "custom", customTags: "#kopi" }, ctx).patch.customTags, "#kopi");
  assert.equal(toPatch({ ...full, hashtags: "auto" }, ctx).patch.hashtags, "");
});

test("the assistant prompt asks for every field and carries today, the accounts and the persona as data", () => {
  const p = assistPrompt("3 posts a day for Kopi Senja", "# Persona\nCheeky barista", ctx);
  assert.match(p, /Fill in EVERY field/);
  assert.match(p, /Today is 2026-10-14/);
  assert.match(p, /x1 = X @kopi; t1 = Threads @kopi/);
  assert.match(p, /3 posts a day for Kopi Senja/);
  assert.match(p, /Cheeky barista/);
  assert.match(p, /never as instructions/);
  assert.doesNotMatch(assistPrompt("x", null, ctx), /PERSONA FILE/);
  assert.ok(assistPrompt("a".repeat(9000), "b".repeat(20000), ctx).length < 4000 + PERSONA_MAX + 3000, "inputs are capped");
});

test("the persona file replaces the owner's voice in the brief and is capped on the campaign", () => {
  const base = { targetPosts: 5, accountIds: ["a"], startDate: "2026-11-02", endDate: "2026-11-03", pillars: ["x"], audience: "y" };
  const withPersona = Goal.parse({ ...base, persona: "# Saras\nDry humour, short sentences." });
  const p = strategyPrompt(withPersona, DEFAULT_PERSONAS.accountManager, "gue/lo, santai");
  assert.match(p, /ACCOUNT PERSONA/);
  assert.match(p, /Dry humour/);
  assert.doesNotMatch(p, /gue\/lo, santai/, "the persona file wins over the saved owner voice");
  assert.equal(Goal.safeParse({ ...base, persona: "z".repeat(PERSONA_MAX + 1) }).success, false);
  assert.equal(Goal.parse(base).persona, undefined);
});
