import assert from "node:assert/strict";
import { test } from "node:test";
import { AiBudgetError } from "@/lib/ai/generate";
import { buildSetup, contentSetup } from "./config";
import { generatePosts, onlyTypes, type ContentDeps } from "./generate";
import { angleFor, pickType } from "./select";
import { classify, contextPrompt, extractText } from "./context";
import { detectLanguage, jaccard, scheduleProblem, sentenceCount, validateVariant, type CheckCtx, type Variant } from "./validate";

const setup = contentSetup();
const cfg = setup.config;

/** Deterministic PRNG (mulberry32). */
const seeded = (seed = 1) => () => {
  seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const ctx = (over: Partial<CheckCtx> = {}): CheckCtx => ({ cfg, type: "hot_take", platforms: ["twitter"], topic: "kopi susu di kantor", banned: setup.banned, corpus: [], ...over });
const v = (text: string, over: Partial<Variant> = {}): Variant => ({ text, thread: [], sourceNote: null, confidence: null, needsSource: false, ...over });

// ---------- config ----------

test("the shipped YAML parses and every few-shot example passes its own type's format rules", () => {
  for (const [type, list] of Object.entries(setup.examples)) {
    assert.ok(list.length >= 3 && list.length <= 5, `${type} has ${list.length} examples`);
    for (const e of list) {
      // Only the format: sources are the owner's to check, people depend on the batch.
      const r = validateVariant({ ...e, confidence: e.confidence ?? null, needsSource: false }, ctx({ type, topic: e.text }));
      const format = r.reasons.filter((x) => !/source|person|review|story|Sensitive|experience|sure/i.test(x));
      assert.equal(r.status === "rejected" ? format.join("; ") || r.reasons.join("; ") : "", "", `${type}: ${e.text.slice(0, 40)}`);
    }
  }
});

test("invalid YAML gives an error naming the file and the field", () => {
  const ok = { examples: "hot_take:\n  - text: a", banned: "reject: []" };
  assert.throws(() => buildSetup({ ...ok, config: "variants: [" }), /config\/content-types\.yaml: not valid YAML/);
  const bad = "variants: 3\nmaxConsecutive: 2\nweeklyThreadCap: 2\nsimilarity: {threshold: 0.5, lookbackDays: 30, action: reject}\nseedThemes: [a]\ntypes:\n  hot_take: {label: Hot take, weight: lots, material: creative, source: none, guide: x}";
  assert.throws(() => buildSetup({ ...ok, config: bad }), /content-types\.yaml: types\.hot_take\.weight/);
  const good = bad.replace("lots", "1");
  assert.throws(() => buildSetup({ ...ok, config: good, examples: "nope:\n  - text: a" }), /few_shot_examples\.yaml: unknown type nope/);
});

// ---------- step 1: type selection ----------

test("weighted selection follows the configured weights", () => {
  const rand = seeded(7);
  const counts: Record<string, number> = {};
  const N = 20000;
  for (let i = 0; i < N; i++) {
    const t = pickType(cfg, { recent: [], threadsThisWeek: 0 }, rand)!;
    counts[t] = (counts[t] ?? 0) + 1;
  }
  const total = Object.values(cfg.types).reduce((n, c) => n + c.weight, 0);
  for (const [t, c] of Object.entries(cfg.types)) {
    const want = c.weight / total;
    assert.ok(Math.abs((counts[t] ?? 0) / N - want) < 0.015, `${t}: ${(counts[t] ?? 0) / N} vs ${want}`);
  }
  assert.equal(counts.humor_dakwah_atau_nilai ?? 0, 0, "weight 0 is never picked");
});

test("the same type never runs more than maxConsecutive times", () => {
  const rand = seeded(3);
  const recent: string[] = [];
  const two = { ...cfg, types: { hot_take: cfg.types.hot_take, educational: cfg.types.educational } };
  for (let i = 0; i < 500; i++) recent.push(pickType(two, { recent, threadsThisWeek: 0 }, rand)!);
  const run = recent.reduce((best, t, i) => { let n = 1; while (i - n >= 0 && recent[i - n] === t) n++; return Math.max(best, n); }, 0);
  assert.ok(run <= cfg.maxConsecutive, `longest run ${run}`);
  const one = { ...cfg, types: { hot_take: cfg.types.hot_take } };
  assert.equal(pickType(one, { recent: ["hot_take", "hot_take"], threadsThisWeek: 0 }, rand), null);
});

test("the weekly thread cap stops thread types", () => {
  const rand = seeded(5);
  for (let i = 0; i < 300; i++)
    assert.notEqual(pickType(cfg, { recent: [], threadsThisWeek: cfg.weeklyThreadCap }, rand), "educational_thread");
  const only = { ...cfg, types: { educational_thread: cfg.types.educational_thread } };
  assert.equal(pickType(only, { recent: [], threadsThisWeek: 0 }, rand), "educational_thread");
  assert.equal(pickType(only, { recent: [], threadsThisWeek: cfg.weeklyThreadCap }, rand), null);
});

// ---------- angles and context ----------

test("only the light types get a seed theme, and themes are not repeated inside a batch", () => {
  assert.equal(angleFor(cfg, "educational", new Set()), null);
  assert.equal(angleFor(cfg, "data_stat", new Set()), null);
  const used = new Set<string>();
  for (let i = 0; i < cfg.seedThemes.length; i++) used.add(angleFor(cfg, "random_receh", used, seeded(i + 1))!);
  assert.equal(used.size, cfg.seedThemes.length, "every theme once before any repeats");
});

test("context files: what can be read, and the prompt block stays within its budget", () => {
  assert.equal(classify("brand.md", 100).kind, "text");
  assert.equal(classify("logo.PNG", 100).kind, "image");
  assert.equal(classify("deck.pdf", 100).kind, "unsupported");
  assert.match((classify("big.txt", 9_000_000) as { reason: string }).reason, /larger than/);
  assert.equal(extractText("a.txt", new Uint8Array([0, 1, 2, 0])), null, "binary is refused");
  assert.equal(extractText("a.html", new TextEncoder().encode("<style>x{}</style><p>Halo &amp; dunia</p>")), "Halo & dunia");
  const files = Array.from({ length: 10 }, (_, i) => ({ name: `f${i}.md`, kind: "text" as const, content: "x".repeat(5000) }));
  const block = contextPrompt(files, 8000);
  assert.ok(block.length <= 8000 + 200, `block is ${block.length} chars`);
  assert.match(block, /\[…cut\]/);
  assert.equal(contextPrompt([]), "");
});

// ---------- step 4: validation ----------

test("length and format per type", () => {
  assert.equal(validateVariant(v("x".repeat(281)), ctx()).status, "rejected");
  assert.equal(validateVariant(v("x".repeat(400)), ctx({ platforms: ["threads"] })).status, "approved");
  assert.equal(sentenceCount("Arus balik. Dompet pulang lebih ringan, perut lebih berat."), 1, "a 2-word setup is not a sentence");
  assert.equal(validateVariant(v("Kopi itu enak. Teh juga enak sekali buat pagi."), ctx({ type: "random_receh" })).status, "rejected");
  assert.equal(validateVariant(v("Kopi itu bahan bakar. Gaji itu bahan bakar kopi. Hidup ini rantai pasok."), ctx({ type: "one_liner_satire" })).status, "rejected");
  assert.match(validateVariant(v("Kantor itu lucu. #kerja"), ctx({ type: "one_liner_satire" })).reasons.join(), /hashtag/);
  assert.equal(validateVariant(v("Kopi pagi itu wajib."), ctx({ type: "question_poll" })).status, "rejected");
  assert.equal(validateVariant(v("Pilih mana?\nA. Kopi"), ctx({ type: "question_poll" })).status, "rejected", "one option");
  assert.equal(validateVariant(v("Pilih mana?\nA. Kopi\nB. Teh"), ctx({ type: "question_poll" })).status, "approved");
  assert.match(validateVariant(v("Satu post", { thread: ["dua"] }), ctx()).reasons.join(), /single post/);

  const body = ["1. Satu", "2. Dua", "3. Tiga", "4. Empat", "5. Lima"];
  const thread = (text: string, parts: string[]) => validateVariant(v(text, { thread: parts }), ctx({ type: "educational_thread" }));
  assert.equal(thread("Cara bikin kopi enak di rumah 🧵", [...body, "Kamu tim apa?"]).status, "approved");
  assert.match(thread("Cara bikin kopi enak di rumah", [...body, "Kamu tim apa?"]).reasons.join(), /end with 🧵/);
  assert.match(thread("Cara bikin kopi 🧵", [...body.slice(0, 4), "Kamu tim apa?"]).reasons.join(), /5-10 numbered/);
  assert.match(thread("Cara bikin kopi 🧵", ["1. Satu", "3. Dua", ...body.slice(2), "Penutup"]).reasons.join(), /part 3 must start with "2\."/);
});

test("language follows the topic", () => {
  assert.equal(detectLanguage("Aku nggak bisa kerja kalau belum ngopi, jujur aja"), "id");
  assert.equal(detectLanguage("I can't work before my coffee, and that is fine"), "en");
  const en = ctx({ topic: "the best coffee spots in Jakarta" });
  assert.match(validateVariant(v("Aku nggak bisa kerja kalau belum ngopi, jujur aja sih."), en).reasons.join(), /Indonesian, the topic is in English/);
  assert.equal(validateVariant(v("Good coffee is the only meeting that is never boring."), en).status, "approved");
  assert.equal(validateVariant(v("Rapat paling produktif itu yang bisa diganti satu pesan."), ctx()).status, "approved");
  assert.equal(validateVariant(v("Deploy hari Jumat itu bukan berani, tapi nekat."), ctx({ topic: "deploy" })).status, "approved", "unknown topic language → no check; English tech words are fine");
});

test("banned words: reject list rejects, review list asks for review, no partial-word hits", () => {
  assert.equal(validateVariant(v("Produk ini pasti untung buat kamu."), ctx()).status, "rejected");
  assert.equal(validateVariant(v("Tahukah kamu, kopi itu enak?"), ctx()).status, "needs_review");
  assert.equal(validateVariant(v("Agamawan itu juga suka kopi sih."), ctx()).status, "approved", "agama inside a longer word is not a hit");
});

test("posts too similar to recent ones are caught", () => {
  const old = "Rapat satu jam yang bisa diganti satu pesan itu bukan kolaborasi, itu kebiasaan.";
  assert.ok(jaccard(old, "Rapat satu jam yang bisa diganti satu pesan itu bukan kolaborasi, cuma kebiasaan.") > 0.8);
  assert.match(validateVariant(v("Rapat satu jam yang bisa diganti satu pesan itu bukan kolaborasi, cuma kebiasaan."), ctx({ corpus: [old] })).reasons.join(), /Too similar/);
  assert.equal(validateVariant(v("Kopi sachet di pantry kantor itu tanda cinta yang paling jujur."), ctx({ corpus: [old] })).status, "approved");
});

test("educational and statistic posts carry the AI's source + confidence and always wait for the owner", () => {
  const edu = (over: Partial<Variant>) => validateVariant(v("Kopi susu gula aren mulai populer di Jakarta.", over), ctx({ type: "educational" }));
  const named = edu({ sourceNote: "Survei kopi 2023", confidence: "high" });
  assert.equal(named.status, "needs_review", "never approved on the AI's word alone");
  assert.match(named.reasons.join(), /AI-provided source \(confidence high\): Survei kopi 2023/);
  assert.match(edu({ sourceNote: null }).reasons.join(), /No source named/);
  assert.match(edu({ sourceNote: "x", confidence: "low" }).reasons.join(), /not sure/);
  assert.match(edu({ sourceNote: "x", confidence: "high", needsSource: true }).reasons.join(), /still unsourced/);

  const stat = (text: string, over: Partial<Variant>) => validateVariant(v(text, over), ctx({ type: "data_stat" }));
  assert.equal(stat("Penjualan kopi susu naik 30% di 2023.", { sourceNote: "Survei kopi 2023", confidence: "medium" }).status, "needs_review");
  assert.equal(stat("Penjualan kopi susu naik 30%.", { sourceNote: null }).status, "rejected", "no source");
  assert.match(stat("Penjualan kopi susu naik 30%.", { sourceNote: "Survei kopi", confidence: "high" }).reasons.join(), /year/);
  assert.match(stat("Penjualan kopi susu naik banyak sekali.", { sourceNote: "Survei kopi 2023", confidence: "high" }).reasons.join(), /needs the number/);
});

test("story posts are always reviewed and never claim to be a real experience", () => {
  const r = validateVariant(v("Bayangin pertama kali bikin kopi susu, gulanya kelupaan. Ternyata enak juga."), ctx({ type: "storytelling" }));
  assert.equal(r.status, "needs_review");
  assert.match(r.reasons.join(), /not a real experience/);
});

test("possible real people are flagged for review, known words are not", () => {
  assert.match(validateVariant(v("Kemarin Budi Santoso bilang kopi itu wajib."), ctx()).reasons.join(), /real person: (Kemarin )?Budi Santoso/);
  assert.match(validateVariant(v("Coba tanya @someone soal kopi."), ctx()).reasons.join(), /@someone/);
  assert.equal(validateVariant(v("Ngopi di Blok M, Jakarta Selatan itu wajib."), ctx({ topic: "ngopi di Jakarta Selatan" })).status, "approved");
});

test("the schedule gate refuses unreviewed and rejected posts", () => {
  const posts = [
    { status: "approved" as const, alternatives: [{ status: "needs_review" as const }] },
    { status: "needs_review" as const, alternatives: [] },
    { alternatives: [] },
  ];
  const item = (slot: number, over = {}) => ({ slot, variant: 0, reviewed: false, text: "Kopi enak", thread: [], ...over });
  assert.equal(scheduleProblem(posts, item(0), setup.banned), null);
  assert.match(scheduleProblem(posts, item(0, { variant: 1 }), setup.banned)!, /needs review/);
  assert.match(scheduleProblem(posts, item(1), setup.banned)!, /needs review/);
  assert.equal(scheduleProblem(posts, item(1, { reviewed: true }), setup.banned), null);
  assert.equal(scheduleProblem(posts, item(2), setup.banned), null, "batches from before content types pass");
  assert.match(scheduleProblem(posts, item(0, { text: "Dijamin sembuh!" }), setup.banned)!, /banned/);
  assert.match(scheduleProblem(posts, item(5), setup.banned)!, /not in this batch/);
});

// ---------- the whole batch ----------

const reply = (type: string, texts: string[], over: Partial<Variant> = {}) => ({ type, variants: texts.map((text) => ({ text, thread: [], sourceNote: null, confidence: null, needsSource: false, ...over })) });

const deps = (over: Partial<ContentDeps> = {}): ContentDeps & { calls: { type: string; idem?: string; context: string; angle: string | null }[] } => {
  const calls: { type: string; idem?: string; context: string; angle: string | null }[] = [];
  return {
    calls,
    setup: () => setup,
    context: async () => "",
    history: async () => ({ recent: [], threadsThisWeek: 0 }),
    recentTexts: async () => [],
    voice: async () => null,
    rand: seeded(11),
    write: async (p, c) => {
      calls.push({ type: p.type, idem: c.idemKey, context: p.context, angle: p.angle });
      return { payload: reply(p.type, [`Varian satu soal kopi ${calls.length}?`, `Varian dua tentang kopi ${calls.length}?`, `Varian tiga ngopi ${calls.length}?`]), costUsd: 0.01 };
    },
    ...over,
  };
};
const brief = { topic: "kopi di kantor", objective: "engagement", audience: "pekerja", platforms: ["twitter" as const], count: 4 };
const onlyPolls = { ...setup, config: { ...cfg, types: { question_poll: cfg.types.question_poll } } };

test("a batch makes one call per post, each with exactly 3 variants and its own idemKey", async () => {
  const d = deps({ setup: () => onlyPolls, history: async () => ({ recent: [], threadsThisWeek: 0 }) });
  // maxConsecutive 2 with a single type: posts 3 and 4 have no allowed type.
  const { payload, costUsd } = await generatePosts(brief, { idemKey: "task:x:1" }, d);
  assert.equal(payload.posts.length, 2);
  assert.equal(payload.skipped.length, 2);
  assert.deepEqual(d.calls.map((c) => c.idem), ["task:x:1:p0", "task:x:1:p1"]);
  assert.equal(payload.posts[0].alternatives.length, 2, "best + 2 alternatives = 3 variants");
  assert.equal(payload.posts[0].type, "question_poll");
  assert.equal(costUsd, 0.02);
});

test("a reply with the wrong number of variants or invalid JSON skips that post, not the batch", async () => {
  let n = 0;
  const d = deps({
    setup: () => onlyPolls,
    write: async (p) => (++n === 1 ? { payload: reply(p.type, ["Satu?", "Dua?"]), costUsd: 0 } : { payload: { nope: true }, costUsd: 0 }),
  });
  await assert.rejects(generatePosts({ ...brief, count: 2 }, {}, d), /No usable post.*variant schema/);
  let m = 0;
  const d2 = deps({ setup: () => onlyPolls, write: async (p) => (++m === 1 ? { payload: reply(p.type, ["Satu?"]), costUsd: 0 } : { payload: reply(p.type, ["Kopi atau teh?", "Teh atau kopi?", "Susu?"]), costUsd: 0 }) });
  const { payload } = await generatePosts({ ...brief, count: 2 }, {}, d2);
  assert.equal(payload.posts.length, 1);
  assert.match(payload.skipped[0].reason, /Generation failed/);
});

test("an LLM error skips the post, a budget error stops the batch, a DB error fails clearly", async () => {
  const flaky = deps({ setup: () => onlyPolls, write: async () => { throw new Error("HTTP 502"); } });
  await assert.rejects(generatePosts(brief, {}, flaky), /No usable post.*HTTP 502/);
  const broke = deps({ write: async () => { throw new AiBudgetError("Monthly LLM budget reached"); } });
  await assert.rejects(generatePosts(brief, {}, broke), AiBudgetError);
  const down = deps({ context: async () => { throw new Error("connect ECONNREFUSED"); } });
  await assert.rejects(generatePosts(brief, {}, down), /Could not load your context files.*ECONNREFUSED/);
});

test("uploaded context reaches every call, and story posts need no stored story", async () => {
  const onlyStories = { ...setup, config: { ...cfg, maxConsecutive: 5, types: { storytelling: cfg.types.storytelling } } };
  const d = deps({ setup: () => onlyStories, context: async () => "## File: brand.md\nKopi kami disangrai di Bandung" });
  const { payload } = await generatePosts({ ...brief, count: 2 }, {}, d);
  assert.equal(payload.posts.length, 2);
  assert.ok(d.calls.every((c) => c.context.includes("brand.md")));
  assert.ok(payload.posts.every((p) => p.status === "needs_review"));
});

test("the AI's source and confidence are kept on the post and its alternatives; a sure source is offered first", async () => {
  const onlyEdu = { ...setup, config: { ...cfg, maxConsecutive: 5, types: { educational: cfg.types.educational } } };
  const mk = (text: string, confidence: "high" | "medium" | "low") => ({ text, thread: [], sourceNote: "Smithsonian Magazine (2013)", confidence, needsSource: false });
  const d = deps({
    setup: () => onlyEdu,
    write: async (p) => ({ payload: { type: p.type, variants: [mk("Madu hampir tidak pernah basi karena kadar airnya rendah.", "low"), mk("Madu tahan lama karena asam dan kadar airnya rendah.", "high"), mk("Bakteri susah hidup di madu yang asam.", "medium")] }, costUsd: 0 }),
  });
  const { payload } = await generatePosts({ ...brief, count: 1 }, {}, d);
  assert.equal(payload.posts[0].confidence, "high");
  assert.equal(payload.posts[0].sourceNote, "Smithsonian Magazine (2013)");
  assert.deepEqual(payload.posts[0].alternatives.map((a) => a.confidence), ["medium", "low"]);
});

test("a rejected best variant falls back to a usable one; all rejected skips the post", async () => {
  const d = deps({ setup: () => onlyPolls, write: async (p) => ({ payload: reply(p.type, ["x".repeat(300) + "?", "Kopi atau teh?", "Dijamin sembuh?"]), costUsd: 0 }) });
  const { payload } = await generatePosts({ ...brief, count: 1 }, {}, d);
  assert.equal(payload.posts[0].text, "Kopi atau teh?");
  assert.equal(payload.posts[0].alternatives.length, 0, "rejected variants are not offered");
  const bad = deps({ setup: () => onlyPolls, write: async (p) => ({ payload: reply(p.type, ["no question", "still none", "nope"]), costUsd: 0 }) });
  await assert.rejects(generatePosts({ ...brief, count: 1 }, {}, bad), /All 3 variants were rejected/);
});

test("a dropped backslash before poll options is turned back into a line break", async () => {
  const d = deps({ setup: () => onlyPolls, write: async (p) => ({ payload: reply(p.type, ["Kopi kapan?nA. Pagi", "Teh kapan?nA. Pagi", "Susu kapan?nA. Pagi"]), costUsd: 0 }) });
  // One option is not a poll: once the line break is back, the checks see it and reject every variant.
  await assert.rejects(generatePosts({ ...brief, count: 1 }, {}, d), /Poll options must be 2-4/);
});

test("posts in one batch are checked against each other for similarity", async () => {
  const d = deps({ setup: () => ({ ...onlyPolls, config: { ...onlyPolls.config, maxConsecutive: 5 } }), write: async (p) => ({ payload: reply(p.type, ["Kopi atau teh pagi ini?", "Kopi atau teh pagi ini?", "Kopi atau teh pagi ini?"]), costUsd: 0 }) });
  const { payload } = await generatePosts({ ...brief, count: 2 }, {}, d);
  assert.equal(payload.posts.length, 1);
  assert.match(payload.skipped[0].reason, /Too similar/);
});

test("the owner's type picks limit the mix; a single pick lifts the anti-repeat rule", async () => {
  assert.deepEqual(Object.keys(onlyTypes(cfg, ["hot_take", "spontan"], 6).types), ["spontan", "hot_take"]);
  assert.equal(onlyTypes(cfg, ["hot_take", "spontan"], 6).maxConsecutive, cfg.maxConsecutive);
  assert.equal(onlyTypes(cfg, [], 6), cfg, "no pick = the full weighted mix");
  assert.equal(onlyTypes(cfg, ["humor_dakwah_atau_nilai"], 6), cfg, "a switched-off type cannot be forced");
  const d = deps({ write: async (p) => ({ payload: reply(p.type, [`Kamu tim kopi atau teh ${Math.random()}?`, "Teh atau kopi pagi ini?", "Susu atau kopi?"]), costUsd: 0 }) });
  const { payload } = await generatePosts({ ...brief, count: 4, types: ["question_poll"] }, {}, d);
  assert.deepEqual(payload.posts.map((p) => p.type), ["question_poll", "question_poll", "question_poll", "question_poll"].slice(0, payload.posts.length));
  assert.equal(payload.posts.length + payload.skipped.filter((s) => /similar/i.test(s.reason)).length, 4, "no post is lost to the anti-repeat rule");
});
