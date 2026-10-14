import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { QcConfig, ReviewPolicy } from "./config";
import { borderline, confidence, decide, hardFails, hardRules, nearMisses, parseQcRules, qcRules, shape, type ConfidenceInputs, type QcCtx } from "./qc";
import { allowedFromAuto, approvalProblem, assertApproved, canMove } from "./status";

const rules = qcRules();
const ctx = (o: Partial<QcCtx> = {}): QcCtx => ({ platforms: ["twitter"], recent: [], corpus: [], similarityThreshold: 0.5, ...o });
const failed = (text: string, o: Partial<QcCtx> = {}, sourceNote: string | null = null) =>
  hardFails(hardRules({ text, thread: [], sourceNote }, ctx(o), rules)).map((r) => r.id);

test("qc-rules.yaml parses; a broken file names the field", () => {
  assert.equal(rules.repeatOpening.lookback, 50);
  const text = readFileSync("config/qc-rules.yaml", "utf8");
  assert.throws(() => parseQcRules(text.replace("lookback: 50", "lookback: -1")), /qc-rules\.yaml: repeatOpening\.lookback/);
});

test("hard rules: unsourced numbers, years, percentages and quotes fail; a cited source or plain text passes", () => {
  assert.deepEqual(failed("Ngopi pagi bikin semangat kerja."), []);
  assert.deepEqual(failed("Katanya 73% orang Jakarta ngopi tiap pagi."), ["unsourced_claims"]);
  assert.deepEqual(failed("Survei 2024 bilang begitu."), ["unsourced_claims"]);
  assert.deepEqual(failed("Ada 150 kedai baru bulan ini."), ["unsourced_claims"]);
  assert.deepEqual(failed('Dia bilang "kopi adalah bahan bakar utama hidup" kemarin.'), ["unsourced_claims"]);
  assert.deepEqual(failed("Katanya 73% orang Jakarta ngopi tiap pagi.", {}, "BPS, Survei Konsumsi, 2024"), []);
  // Thread numbering, clock times and "jam 10" are not claims.
  assert.deepEqual(failed("Rapat jam 10, ngopi dulu di 09:30.\n1. Bawa tumbler"), []);
});

test("hard rules: forbidden claims, engagement bait, foreign links and a repeated opening fail", () => {
  assert.deepEqual(failed("Kopi ini dijamin bikin fokus."), ["forbidden_claims"]);
  assert.deepEqual(failed("Follow for follow ya, gas!"), ["engagement_bait"]);
  assert.deepEqual(failed("RT kalau setuju."), ["engagement_bait"]);
  assert.deepEqual(failed("Tag 3 temen yang butuh kopi."), ["engagement_bait"]);
  assert.deepEqual(failed("Baca ini https://spam.example/x"), ["links"]);
  assert.deepEqual(failed("Baca ini https://brief.example/a", { briefLink: "https://brief.example/a" }), []);
  assert.deepEqual(failed("Pagi ini hujan lagi, ngopi aja.", { recent: ["Pagi ini hujan deras banget."] }), ["repeat_opening"]);
  assert.deepEqual(failed("Hujan lagi pagi ini.", { recent: ["Pagi ini hujan deras banget."] }), []);
});

test("hard rules: repeated structure and near misses are warnings that count against confidence", () => {
  assert.equal(shape("Kopi atau teh?"), "line|q|||");
  const r = hardRules({ text: "Kopi atau teh?", thread: [] }, ctx({ recent: ["Pagi atau malam?", "Hujan atau panas?"] }), rules);
  assert.deepEqual(hardFails(r), []);
  assert.equal(nearMisses(r), 1);
  const long = hardRules({ text: "a".repeat(270), thread: [] }, ctx(), rules);
  assert.ok(long.some((x) => x.id === "near_length"));
  // 4 shared words of 9 = 44%: under the 50% threshold, over 80% of it.
  const similar = hardRules({ text: "kopi susu gula aren pagi ini", thread: [] }, ctx({ corpus: ["kopi susu gula aren malam itu enak"] }), rules);
  assert.ok(similar.some((x) => x.id === "near_similarity"), JSON.stringify(similar));
});

const inputs = (o: Partial<ConfidenceInputs> = {}): ConfidenceInputs => ({
  qcScores: [9], qcVerdicts: ["pass"], genBest: 9, genSecond: 7, variants: 3, sourceRule: "none", sourceNote: null, sourceConfidence: null,
  rulesPass: true, nearMisses: 0, ...o,
});

test("confidence: bounded, a perfect judge alone cannot pass, and each signal moves it the right way", () => {
  const good = confidence(inputs()).value;
  assert.ok(good >= 0.8 && good <= 1, String(good));
  assert.ok(confidence(inputs({ qcScores: [10], genBest: null, genSecond: null, variants: 1, qcVerdicts: ["uncertain"], sourceRule: "required" })).value <= 0.55);
  assert.ok(confidence(inputs({ qcScores: [6] })).value < good);
  assert.ok(confidence(inputs({ nearMisses: 2 })).value < good);
  assert.ok(confidence(inputs({ qcVerdicts: ["uncertain"] })).value < good);
  assert.ok(confidence(inputs({ qcScores: [9, 9], qcVerdicts: ["pass", "uncertain"] })).value < good, "two samples that disagree");
  assert.ok(confidence(inputs({ qcScores: [9, 5] })).value < good, "the lower sample counts");
  // Sourced types: no source = 0, a low-confidence source counts less than a high one.
  const req = (o: Partial<ConfidenceInputs>) => confidence(inputs({ sourceRule: "required", ...o })).value;
  assert.ok(req({}) < req({ sourceNote: "BPS 2024", sourceConfidence: "low" }));
  assert.ok(req({ sourceNote: "BPS 2024", sourceConfidence: "low" }) < req({ sourceNote: "BPS 2024", sourceConfidence: "high" }));
  assert.equal(confidence(inputs({ qcScores: [0], qcVerdicts: ["fail"], genBest: 0, rulesPass: false, nearMisses: 9 })).value, 0);
  assert.ok(confidence(inputs({ qcScores: [10], genBest: 10, genSecond: 0 })).value <= 1);
});

const qc = QcConfig.parse({});
const policy = ReviewPolicy.parse({});
const base = { hardFails: [], forceReview: [], verdict: "pass" as const, confidence: 0.9, type: "spontaneous", policy, cfg: qc, retry: 0, pilot: false };

test("decide: every row of the decision table", () => {
  assert.deepEqual(decide({ ...base, hardFails: ["Engagement bait"] }), { action: "regenerate", reasons: ["Engagement bait"] });
  const exhausted = decide({ ...base, hardFails: ["Engagement bait"], retry: 2 });
  assert.equal(exhausted.action, "needs_review");
  assert.match(exhausted.reasons.join(" "), /Engagement bait/);
  assert.deepEqual(decide(base), { action: "auto_approve", reasons: [] });
  assert.equal(decide({ ...base, confidence: 0.79 }).action, "needs_review");
  assert.equal(decide({ ...base, verdict: "uncertain" }).action, "needs_review");
  assert.equal(decide({ ...base, verdict: "fail" }).action, "needs_review");
  assert.equal(decide({ ...base, verdict: null }).action, "needs_review");
  assert.equal(decide({ ...base, type: "educational" }).action, "needs_review", "educational is forced by default");
  assert.equal(decide({ ...base, type: "educational", policy: { ...policy, forceReviewTypes: [] } }).action, "auto_approve", "the owner may empty the list");
  assert.equal(decide({ ...base, forceReview: ["Mentions what may be a real person"] }).action, "needs_review");
  assert.equal(decide({ ...base, pilot: true }).action, "needs_review");
  assert.equal(decide({ ...base, policy: { ...policy, mode: "manual_all" } }).action, "needs_review");
});

test("borderline: only a pass near the threshold gets a second sample", () => {
  assert.equal(borderline("pass", 0.85, qc), true);
  assert.equal(borderline("pass", 0.75, qc), true);
  assert.equal(borderline("pass", 0.95, qc), false);
  assert.equal(borderline("uncertain", 0.82, qc), false);
});

test("lifecycle transitions and the approval guard", () => {
  assert.ok(canMove("draft", "piloting"));
  assert.ok(!canMove("draft", "running"), "no scale-up without a pilot");
  assert.ok(canMove("awaiting_scale", "running"));
  assert.ok(canMove("paused", "piloting") && canMove("paused", "running"));
  assert.ok(!canMove("cancelled", "running") && !canMove("completed", "running"));
  assert.deepEqual(allowedFromAuto("paused").sort(), ["paused", "piloting", "running"]);
  const ok = { status: "approved", approvalSource: "qc_auto", approvalPolicySnapshot: { mode: "qc_auto" }, text: "Halo" };
  assert.equal(approvalProblem(ok), null);
  assert.match(approvalProblem({ ...ok, status: "needs_review" })!, /not approved/);
  assert.match(approvalProblem({ ...ok, approvalSource: null })!, /no approval record/);
  assert.match(approvalProblem({ ...ok, approvalPolicySnapshot: null })!, /policy snapshot/);
  assert.throws(() => assertApproved({ ...ok, text: " " }), /no text/);
});

test("pay as you go: no campaign cap, the monthly cap still stops it", async () => {
  const { budgetGate } = await import("@/lib/cost");
  const { isPayAsYouGo, PAY_AS_YOU_GO } = await import("./config");
  assert.ok(isPayAsYouGo(PAY_AS_YOU_GO) && !isPayAsYouGo(0.01));
  const o = { estUsd: 1, spentUsd: 9999, capUsd: Infinity, monthSpentUsd: 10, monthCapUsd: 300 };
  assert.equal(budgetGate(o).blocked, false);
  assert.equal(budgetGate({ ...o, monthSpentUsd: 299.5 }).blocked, true);
});
