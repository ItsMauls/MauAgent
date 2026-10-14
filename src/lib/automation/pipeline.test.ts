import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_PERSONAS } from "@/lib/agents/persona";
import { AiBudgetError } from "@/lib/ai/generate";
import { contentSetup } from "@/lib/content/config";
import type { ContentDeps } from "@/lib/content/generate";
import { GenerationConfig, Goal, QcConfig, ReviewPolicy } from "./config";
import { runPost, type PipelineDeps, type PostJob } from "./pipeline";
import { qcRules } from "./qc";
import { CampaignBrief } from "./strategy";

const setup = contentSetup();
let word = 0;
/** Fresh words per text so nothing trips similarity or same-opening checks. */
const fresh = () => { word++; return `Santai${word} dulu${word} ini sore${word}.`; };
const reply = (type: string, texts: string[]) => ({ type, variants: texts.map((text) => ({ text, thread: [], sources: [], confidence: null, needsSource: false })) });
const judgeAll = (score: number) => (async (p) => ({
  payload: { verdicts: p.texts.map((_, i) => ({ variant: i + 1, score: score - i, madeUpWords: [], coherent: true, unsupportedClaims: [], samePersona: true, soundsHuman: true, reasons: ["ok"] })) },
  costUsd: 0.001,
})) as ContentDeps["judge"];

const content = (over: Partial<ContentDeps> = {}): ContentDeps & { keys: (string | undefined)[] } => {
  const keys: (string | undefined)[] = [];
  return {
    keys,
    setup: () => setup,
    context: async () => "",
    history: async () => ({ recent: [], threadsThisWeek: 0, angles: [], sources: [] }),
    recentTexts: async () => [],
    persona: async () => DEFAULT_PERSONAS.socmedSpecialist,
    voice: async () => null,
    search: async () => ({ answer: null, results: [] }),
    rand: () => 0.5,
    sleep: async () => {},
    log: () => {},
    write: async (p, c) => (keys.push(c.idemKey), { payload: reply(p.type, Array.from({ length: p.n }, fresh)), costUsd: 0.01 }),
    judge: async (p, c) => (keys.push(c.idemKey), judgeAll(9)(p, c)),
    ...over,
  };
};

const verdict = (v: "pass" | "fail" | "uncertain", score: number) => ({ verdict: v, rules: [{ id: "voice", pass: v === "pass", note: v === "pass" ? "" : "stiff" }], issues: v === "pass" ? [] : ["Sounds stiff"], suggestedFix: "", score });
const pipeline = (c: ContentDeps, qcAnswers: ReturnType<typeof verdict>[] = [verdict("pass", 9)]): PipelineDeps & { qcKeys: string[] } => {
  const qcKeys: string[] = [];
  return {
    qcKeys, content: c, rules: qcRules,
    qcJudge: async (_p, ctx) => (qcKeys.push(ctx.idemKey!), { payload: qcAnswers[Math.min(qcKeys.length - 1, qcAnswers.length - 1)], costUsd: 0.002 }),
  };
};

const job = (o: Partial<PostJob> = {}): PostJob => ({
  campaignId: "c1", slot: 3, type: "spontaneous", angles: [], cta: null, pillar: "kopi sore di kantor", pilot: false, retryCount: 0, platforms: ["twitter"],
  goal: Goal.parse({ targetPosts: 10, accountIds: ["a"], startDate: "2026-11-02", endDate: "2026-11-30", pillars: ["kopi sore di kantor"], audience: "pekerja kantor" }),
  policy: ReviewPolicy.parse({}), qc: QcConfig.parse({}), gen: GenerationConfig.parse({}), recent: [], ...o,
});

test("a clean post with a confident QC pass is auto-approved, with stable idemKeys per call", async () => {
  const c = content();
  const d = pipeline(c);
  const out = await runPost(job(), { idemKey: "auto:c1:s3", automationCampaignId: "c1" }, d);
  assert.equal(out.status, "approved", JSON.stringify(out.qcReport.decision));
  assert.ok(out.confidence! >= 0.8);
  assert.equal(out.retryCount, 0);
  assert.deepEqual(c.keys, ["auto:c1:s3:r0:p3:a1", "auto:c1:s3:r0:p3:a1:judge"]);
  assert.equal(d.qcKeys[0], "auto:c1:s3:r0:qc");
  assert.ok(out.alternatives.length >= 1);
  // The same job again asks for exactly the same keys: a retried step reuses the ledger's stored outputs.
  const again = content();
  const d2 = pipeline(again);
  await runPost(job(), { idemKey: "auto:c1:s3", automationCampaignId: "c1" }, d2);
  assert.deepEqual(again.keys, c.keys);
  assert.deepEqual(d2.qcKeys, d.qcKeys);
});

test("a borderline pass gets a second QC sample; disagreement sends it to review", async () => {
  const d = pipeline(content({ judge: judgeAll(8) }), [verdict("pass", 8), verdict("uncertain", 6)]);
  const out = await runPost(job(), {}, d);
  assert.deepEqual(d.qcKeys.map((k) => k.split(":").at(-1)), ["qc", "qc2"]);
  assert.equal(out.status, "needs_review");
  assert.equal((out.qcReport.samples as unknown[]).length, 2);
});

test("pilot posts, manual_all and forced types always go to review", async () => {
  for (const o of [{ pilot: true }, { policy: ReviewPolicy.parse({ mode: "manual_all" }) }, { policy: ReviewPolicy.parse({ forceReviewTypes: ["spontaneous"] }) }]) {
    const out = await runPost(job(o), {}, pipeline(content()));
    assert.equal(out.status, "needs_review", JSON.stringify(o));
    assert.ok(out.text, "the post is still written and QC'd");
  }
});

test("QC uncertain or fail → review; a QC error → review, never approved", async () => {
  assert.equal((await runPost(job(), {}, pipeline(content(), [verdict("uncertain", 7)]))).status, "needs_review");
  assert.equal((await runPost(job(), {}, pipeline(content(), [verdict("fail", 3)]))).status, "needs_review");
  const broken: PipelineDeps = { ...pipeline(content()), qcJudge: async () => { throw new Error("HTTP 502"); } };
  const out = await runPost(job(), {}, broken);
  assert.equal(out.status, "needs_review");
  assert.match(JSON.stringify(out.qcReport.decision), /QC did not run/);
});

test("a hard rule failure regenerates with the issue as feedback, without paying for QC", async () => {
  let n = 0;
  const c = content({ write: async (p) => ({ payload: reply(p.type, Array.from({ length: p.n }, () => (++n <= 3 ? `Follow for follow ya ${fresh()}` : fresh()))), costUsd: 0.01 }) });
  const d = pipeline(c);
  const seen: string[][] = [];
  const spy = { ...c, write: async (p: Parameters<ContentDeps["write"]>[0], ctx: Parameters<ContentDeps["write"]>[1]) => (seen.push(p.avoid), c.write(p, ctx)) };
  const out = await runPost(job(), { idemKey: "k" }, { ...d, content: spy });
  assert.equal(out.status, "approved");
  assert.equal(out.retryCount, 1);
  assert.match(seen[1].join(" "), /Engagement bait/);
  assert.ok(d.qcKeys.length && d.qcKeys.every((k) => k.startsWith("k:r1:")), "QC runs only on the clean retry");
});

test("still failing after maxRetries → review with the failure notes; no QC call", async () => {
  const c = content({ write: async (p) => ({ payload: reply(p.type, Array.from({ length: p.n }, () => `RT kalau setuju ${fresh()}`)), costUsd: 0.01 }) });
  const d = pipeline(c);
  const out = await runPost(job(), {}, d);
  assert.equal(out.status, "needs_review");
  assert.equal(out.retryCount, 2);
  assert.match(JSON.stringify(out.qcReport.decision), /Engagement bait/);
  assert.equal(d.qcKeys.length, 0);
});

test("no usable variant at all → review with an empty text and the reason; a budget error stops everything", async () => {
  const c = content({ write: async () => { throw new Error("The operation was aborted due to timeout"); } });
  const out = await runPost(job({ qc: QcConfig.parse({ maxRetries: 0 }) }), {}, pipeline(c));
  assert.equal(out.status, "needs_review");
  assert.equal(out.text, null);
  assert.match(out.failureReason!, /No usable post/);
  await assert.rejects(runPost(job(), {}, { ...pipeline(content()), qcJudge: async () => { throw new AiBudgetError("LLM monthly budget reached"); } }), AiBudgetError);
});

test("a manual regenerate (retryCount + 1) gets fresh idemKeys and its own retry budget", async () => {
  const c = content();
  const out = await runPost(job({ retryCount: 3 }), { idemKey: "k" }, pipeline(c));
  assert.equal(c.keys[0], "k:r3:p3:a1");
  assert.equal(out.retryCount, 3);
  const failing = content({ write: async (p) => ({ payload: reply(p.type, Array.from({ length: p.n }, () => `RT kalau setuju ${fresh()}`)), costUsd: 0.01 }) });
  assert.equal((await runPost(job({ retryCount: 3 }), {}, pipeline(failing))).retryCount, 5);
});

test("the Account Manager's brief reaches the writer: expanded objective, avoid list and per-pillar angles", async () => {
  const seen: { objective: string; avoid?: string; angles: string[] }[] = [];
  const c = content({ write: async (p) => (seen.push({ objective: p.brief.objective, avoid: p.brief.avoid, angles: p.angles }), { payload: reply(p.type, Array.from({ length: p.n }, fresh)), costUsd: 0.01 }) });
  const brief = CampaignBrief.parse({
    objective: "Grow followers.", audienceInsight: "Office workers.", toneNotes: "Relaxed.", mustAvoid: ["politik"],
    pillars: [{ pillar: "kopi sore di kantor", focus: "Afternoon coffee breaks.", angles: ["ritual", "harga", "tumbler"], avoid: ["klaim kesehatan"] }],
  });
  await runPost(job({ brief }), {}, pipeline(c));
  assert.match(seen[0].objective, /^Grow followers\. Posting as the account owner/);
  assert.match(seen[0].objective, /Focus for this pillar: Afternoon coffee breaks/);
  assert.equal(seen[0].avoid, "politik; klaim kesehatan");
  assert.equal(seen[0].angles.length, 3);
  assert.ok(seen[0].angles.every((a) => ["ritual", "harga", "tumbler"].includes(a)));
  // Without a brief nothing changes.
  seen.length = 0;
  await runPost(job(), {}, pipeline(c));
  assert.match(seen[0].objective, /^Posting as the account owner/);
  assert.equal(seen[0].avoid, undefined);
});

test("the team discussion: the Specialist hands over, Post QC checks and gives a verdict, a failed rule goes back", async () => {
  const lines: string[] = [];
  const say = async (who: string, text: string, slot?: number) => void lines.push(`${who}@${slot}: ${text}`);
  await runPost(job(), {}, { ...pipeline(content()), say });
  assert.match(lines[0], /^socmedSpecialist@3: Post 4 is ready, handing it to Post QC/);
  assert.match(lines[1], /^postQc@3: Rule check passed/);
  assert.ok(lines.some((l) => /^postQc@3: Verdict: pass \(9( \/ 9)? of 10\)\. Confidence \d+%\. Approved automatically\./.test(l)), lines.join("\n"));

  lines.length = 0;
  const bait = content({ write: async (p) => ({ payload: reply(p.type, Array.from({ length: p.n }, () => `RT kalau setuju ${fresh()}`)), costUsd: 0.01 }) });
  await runPost(job(), {}, { ...pipeline(bait), say });
  assert.ok(lines.some((l) => /postQc@3: Rule check failed: .*Engagement bait.*Sending it back to the Socmed Specialist/.test(l)));
  assert.ok(lines.some((l) => /No retries left, it goes to you/.test(l)));

  lines.length = 0;
  await runPost(job({ pilot: true }), {}, { ...pipeline(content()), say });
  assert.ok(lines.some((l) => /Sent to you: Pilot post/.test(l)), lines.join("\n"));
});
