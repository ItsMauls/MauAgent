import assert from "node:assert/strict";
import { test } from "node:test";
import { AiBudgetError } from "@/lib/ai/generate";
import { CONTENT_TYPES, normalizeType, SocialPosts, type ContentType } from "@/lib/agents/schemas";
import { DEFAULT_PERSONAS } from "@/lib/agents/persona";
import { buildSetup, contentSetup, parseExamples, type ContentConfig } from "./config";
import { generatePosts, onlyTypes, type ContentDeps } from "./generate";
import { applyJudge, type JudgeVerdicts } from "./judge";
import { assertPersona, buildPrompt, type PromptInput } from "./prompt";
import { cachedSearch, cleanResults, gatherResearch, sourceNoteFor, tavily, type Raw, type Search } from "./research";
import { pickAngles, pickType, topicEntry } from "./select";
import { classify, contextPrompt, extractText } from "./context";
import { parseTrends } from "./trendTopics";
import { batchProblems, detectLanguage, jaccard, scheduleProblem, sentenceCount, validateVariant, type BatchState, type CheckCtx, type Variant } from "./validate";

const setup = contentSetup();
const cfg = setup.config;
const persona = DEFAULT_PERSONAS.socmedSpecialist;

/** Deterministic PRNG (mulberry32). */
const seeded = (seed = 1) => () => {
  seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const only = (types: ContentType[], over: Partial<ContentConfig> = {}): ContentConfig => ({ ...cfg, ...over, types: Object.fromEntries(types.map((t) => [t, cfg.types[t]])) });
const ctx = (over: Partial<CheckCtx> = {}): CheckCtx => ({ cfg, type: "hot_take", platforms: ["twitter"], topic: "kopi susu di kantor", banned: setup.banned, corpus: [], ...over });
const v = (text: string, over: Partial<Variant> = {}): Variant => ({ text, thread: [], sourceNote: null, confidence: null, needsSource: false, ...over });

// ---------- config: one list of types ----------

test("the shipped config uses exactly the CONTENT_TYPES enum, satire included", () => {
  assert.deepEqual(Object.keys(cfg.types).sort(), [...CONTENT_TYPES].sort());
  assert.ok(cfg.types.satire!.weight > 0, "satire can be picked");
  for (const t of CONTENT_TYPES) assert.ok(cfg.types[t]!.sampling.temperature >= 0, `${t} has sampling`);
  assert.ok(cfg.types.educational!.sampling.temperature <= 0.5 && cfg.types.light_humor!.sampling.temperature >= 0.6);
});

test("old type names map to the enum; unknown old ones are dropped, not a parse error", () => {
  assert.equal(normalizeType("random_receh"), "light_humor");
  assert.equal(normalizeType("spontan"), "spontaneous");
  assert.equal(normalizeType("one_liner_satire"), "satire");
  const old = SocialPosts.parse({ posts: [{ text: "a", type: "random_receh" }, { text: "b", type: "spontan" }, { text: "c", type: "data_gone" }] });
  assert.deepEqual(old.posts.map((p) => p.type), ["light_humor", "spontaneous", undefined]);
});

test("invalid config gives an error naming the file and the field; a type outside the enum is refused", () => {
  const files = { angles: "historySize: 30", banned: "reject: []" };
  assert.throws(() => buildSetup({ ...files, config: "variants: [" }), /config\/content-types\.yaml: not valid YAML/);
  const yaml = (types: string) => `variants: 3\nmaxConsecutive: 2\nweeklyThreadCap: 2\nmaxAttempts: 3\nlaughEvery: 4\njudge: {temperature: 0.1, minScore: 7}
research: {minScore: 0.4, maxItems: 5, newsTimeRange: month}\nsimilarity: {threshold: 0.5, lookbackDays: 30, action: reject}\ntypes:\n${types}`;
  const type = (key: string, weight = "1") => `  ${key}: {label: X, weight: ${weight}, source: none, sampling: {temperature: 0.6, top_p: 0.9}, guide: x}`;
  assert.throws(() => buildSetup({ ...files, config: yaml(type("hot_take", "lots")) }), /content-types\.yaml: types\.hot_take\.weight/);
  assert.throws(() => buildSetup({ ...files, config: yaml(type("random_receh")) }), /content-types\.yaml: types/);
  assert.equal(buildSetup({ ...files, config: yaml(type("hot_take")) }).config.types.hot_take!.research, "none");
});

test("examples files: --- between examples, +++ between thread parts, # comments, max 10", () => {
  assert.deepEqual(parseExamples("# comment\nsatu\n---\ndua\nbaris dua\n---\nhook 🧵\n+++\n1. a\n+++\npenutup\n---\n"), [
    { text: "satu", thread: [] },
    { text: "dua\nbaris dua", thread: [] },
    { text: "hook 🧵", thread: ["1. a", "penutup"] },
  ]);
  assert.deepEqual(parseExamples("# only a comment\n"), []);
  assert.equal(parseExamples(Array.from({ length: 15 }, (_, i) => `t${i}`).join("\n---\n")).length, 10);
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
  const total = Object.values(cfg.types).reduce((n, c) => n + c!.weight, 0);
  for (const [t, c] of Object.entries(cfg.types)) {
    const want = c!.weight / total;
    assert.ok(Math.abs((counts[t] ?? 0) / N - want) < 0.015, `${t}: ${(counts[t] ?? 0) / N} vs ${want}`);
  }
  assert.ok(counts.satire > 0, "satire is picked");
});

test("the same type never runs more than maxConsecutive times", () => {
  const rand = seeded(3);
  const recent: string[] = [];
  const two = only(["hot_take", "educational"]);
  for (let i = 0; i < 500; i++) recent.push(pickType(two, { recent, threadsThisWeek: 0 }, rand)!);
  const run = recent.reduce((best, t, i) => { let n = 1; while (i - n >= 0 && recent[i - n] === t) n++; return Math.max(best, n); }, 0);
  assert.ok(run <= cfg.maxConsecutive, `longest run ${run}`);
  assert.equal(pickType(only(["hot_take"]), { recent: ["hot_take", "hot_take"], threadsThisWeek: 0 }, rand), null);
});

test("the weekly thread cap stops thread types", () => {
  const rand = seeded(5);
  for (let i = 0; i < 300; i++) assert.notEqual(pickType(cfg, { recent: [], threadsThisWeek: cfg.weeklyThreadCap }, rand), "thread");
  assert.equal(pickType(only(["thread"]), { recent: [], threadsThisWeek: 0 }, rand), "thread");
  assert.equal(pickType(only(["thread"]), { recent: [], threadsThisWeek: cfg.weeklyThreadCap }, rand), null);
});

// ---------- angles ----------

test("the first-date-in-Blok-M topic has at least 15 angles per type", () => {
  const entry = topicEntry(setup.angles, "First date di Blok M, Jakarta Selatan")!;
  assert.ok(entry, "topic matched case-insensitively");
  for (const t of CONTENT_TYPES) assert.ok((entry.angles[t]?.length ?? 0) >= 15, `${t}: ${entry.angles[t]?.length}`);
  assert.equal(topicEntry(setup.angles, "kopi di kantor"), null);
});

test("angles: no repeats in a batch, recent ones avoided while others are left, repeats only when the list runs out", () => {
  const list = ["a", "b", "c", "d", "e", "f"];
  const used = new Set<string>();
  const first = pickAngles(list, 3, used, ["a", "b"], seeded(1));
  assert.equal(new Set(first).size, 3, "the variants of one post get different angles");
  assert.ok(!first.includes("a") && !first.includes("b"), "recent angles avoided");
  first.forEach((a) => used.add(a));
  const second = pickAngles(list, 3, used, ["a", "b"], seeded(2));
  assert.ok(second.every((a) => !first.includes(a)), "not reused in the batch");
  assert.deepEqual(second.slice(1).sort(), ["a", "b"], "recent ones come back once the fresh ones are used");
  assert.equal(pickAngles(["x"], 3, new Set(["x"]), [], seeded(3)).length, 3, "a short list still fills every variant");
  assert.deepEqual(pickAngles([], 3, new Set(), []), []);
});

// ---------- prompt ----------

const promptInput = (over: Partial<PromptInput> = {}): PromptInput => ({
  brief: { topic: "first date di Blok M", objective: "engagement", audience: "Gen Z Jakarta", platforms: ["twitter"] },
  type: "light_humor", typeCfg: cfg.types.light_humor!, examples: [{ text: "contoh asli", thread: [] }], angles: ["bingung bayar", "mati gaya", "nyasar"], n: 3,
  persona, voice: null, language: "id", context: "", places: "", facts: [], researchMissing: false, openers: setup.banned.openers, recent: [], laughAllowed: true, avoid: [], ...over,
});

test("prompt: system rules, the type block, angles per variant, and no places without research", () => {
  const { system, prompt } = buildPrompt(promptInput());
  assert.match(system, /Jangan campur "gue\/lo" dengan "aku\/kamu"/);
  assert.match(system, /Emoji maksimal 1 per post dan boleh nol/);
  assert.match(system, /antara 40 dan 250 karakter/);
  assert.match(system, /"akibatnya\.\.\."/);
  assert.match(system, /kabel putus/);
  assert.match(system, new RegExp(persona.nickname));
  assert.match(prompt, /TIPE KONTEN: light_humor/);
  assert.doesNotMatch(prompt, /TIPE KONTEN: educational/);
  assert.match(prompt, /contoh asli/);
  assert.match(prompt, /1\. bingung bayar\n2\. mati gaya\n3\. nyasar/);
  assert.match(prompt, /TEMPAT: tidak ada\. Jangan menyebut nama tempat spesifik/);
  assert.match(buildPrompt(promptInput({ laughAllowed: false })).prompt, /jangan dipakai di post ini/);
});

test("prompt: numbered facts for educational, a no-facts fallback when research failed, places as material for light types", () => {
  const facts = [{ title: "MRT Blok M", summary: "Stasiun Blok M BCA melayani MRT.", date: null, url: "https://jakartamrt.co.id/x" }];
  const edu = buildPrompt(promptInput({ type: "educational", typeCfg: cfg.types.educational!, facts })).prompt;
  assert.match(edu, /FAKTA \(satu-satunya sumber[^\n]*\n\[1\] MRT Blok M: Stasiun Blok M BCA/);
  const failed = buildPrompt(promptInput({ type: "educational", typeCfg: cfg.types.educational!, researchMissing: true })).prompt;
  assert.match(failed, /FAKTA: tidak tersedia\. Jangan menulis angka, harga/);
  assert.match(buildPrompt(promptInput({ places: "- Kafe A: kopi" })).prompt, /TEMPAT \(bahan suasana saja/);
});

test("prompt: the owner's writing voice replaces the persona style", () => {
  const withVoice = buildPrompt(promptInput({ voice: "- pakai aku/kamu, sinis ringan" })).system;
  assert.match(withVoice, /SUARA PEMILIK AKUN[\s\S]*sinis ringan/);
  assert.doesNotMatch(withVoice, /Gaya: /);
  assert.match(buildPrompt(promptInput()).system, /Gaya: /);
});

test("prompt: an empty persona stops with persona_missing", () => {
  assert.throws(() => buildPrompt(promptInput({ persona: null })), /persona_missing/);
  assert.throws(() => assertPersona({ ...persona, communicationStyle: " " }), /persona_missing/);
});

// ---------- context files ----------

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

// ---------- layer 1: rule checks ----------

test("length and format per type", () => {
  assert.equal(validateVariant(v("x".repeat(281)), ctx()).status, "rejected");
  assert.equal(validateVariant(v("x".repeat(400)), ctx({ platforms: ["threads"] })).status, "approved");
  assert.equal(sentenceCount("Arus balik. Dompet pulang lebih ringan, perut lebih berat."), 1, "a 2-word setup is not a sentence");
  assert.equal(validateVariant(v("Kopi itu enak. Teh juga enak sekali buat pagi. Susu juga boleh kok."), ctx({ type: "light_humor" })).status, "rejected");
  assert.equal(validateVariant(v("Kopi itu bahan bakar. Gaji itu bahan bakar kopi. Hidup ini rantai pasok."), ctx({ type: "satire" })).status, "rejected");
  assert.match(validateVariant(v("Kantor itu lucu. #kerja"), ctx({ type: "satire" })).reasons.join(), /hashtag/);
  assert.equal(validateVariant(v("Kopi pagi itu wajib."), ctx({ type: "question" })).status, "rejected");
  assert.equal(validateVariant(v("Pilih mana?\nA. Kopi"), ctx({ type: "question" })).status, "rejected", "one option");
  assert.equal(validateVariant(v("Pilih mana?\nA. Kopi\nB. Teh"), ctx({ type: "question" })).status, "approved");
  assert.match(validateVariant(v("Satu post", { thread: ["dua"] }), ctx()).reasons.join(), /single post/);

  const body = ["1. Satu", "2. Dua", "3. Tiga", "4. Empat", "5. Lima"];
  const thread = (text: string, parts: string[]) => validateVariant(v(text, { thread: parts }), ctx({ type: "thread" }));
  assert.equal(thread("Cara bikin kopi enak di rumah 🧵", [...body, "Kamu tim apa?"]).status, "approved", "the thread marker is not counted as an emoji");
  assert.match(thread("Cara bikin kopi enak di rumah", [...body, "Kamu tim apa?"]).reasons.join(), /end with 🧵/);
  assert.match(thread("Cara bikin kopi 🧵", [...body.slice(0, 4), "Kamu tim apa?"]).reasons.join(), /5-10 numbered/);
  assert.match(thread("Cara bikin kopi 🧵", ["1. Satu", "3. Dua", ...body.slice(2), "Penutup"]).reasons.join(), /part 3 must start with "2\."/);
});

test("style rules: more than one emoji, em dash, template openers and mixed registers are rejected", () => {
  assert.equal(validateVariant(v("kopi pagi ini enak banget ☕"), ctx()).status, "approved");
  assert.match(validateVariant(v("kopi pagi ini enak banget ☕🙌🏻"), ctx()).reasons.join(), /2 emoji \(max 1\)/);
  assert.match(validateVariant(v("kopi pagi ini — enak banget"), ctx()).reasons.join(), /em dash/);
  assert.match(validateVariant(v("Akibatnya gue sering mikirin first date"), ctx()).reasons.join(), /Template opener: "akibatnya"/);
  assert.match(validateVariant(v("Keinget gue pernah nyasar di Blok M"), ctx()).reasons.join(), /Template opener: "keinget"/);
  assert.match(validateVariant(v("gue sih suka kopi, kamu gimana?"), ctx()).reasons.join(), /Mixes "gue\/lo" with "aku\/kamu"/);
  assert.equal(validateVariant(v("gue sih suka kopi, lo gimana?"), ctx()).status, "approved");
  assert.match(validateVariant(v("Plot twist: kopinya dingin"), ctx()).reasons.join(), /Banned: plot twist/);
});

test("batch rules: wkwk quota, the same opening, the same closing emoji", () => {
  const b: BatchState = { texts: ["kopi pagi ini enak"], laughs: 1, laughQuota: 1, closingEmojis: ["🙌"] };
  assert.match(batchProblems(v("teh sore enak wkwk"), b).join(), /already used 1 time/);
  assert.deepEqual(batchProblems(v("teh sore enak wkwk"), { ...b, laughs: 0 }), []);
  assert.match(batchProblems(v("Kopi pagi ini pahit"), b).join(), /Opens like another post/);
  assert.match(batchProblems(v("teh sore enak 🙌"), b).join(), /same emoji/);
  assert.deepEqual(batchProblems(v("teh sore enak ☕"), b), []);
});

test("language follows the topic", () => {
  assert.equal(detectLanguage("Aku nggak bisa kerja kalau belum ngopi, jujur aja"), "id");
  assert.equal(detectLanguage("I can't work before my coffee, and that is fine"), "en");
  const en = ctx({ topic: "the best coffee spots in Jakarta" });
  assert.match(validateVariant(v("Aku nggak bisa kerja kalau belum ngopi, jujur aja sih."), en).reasons.join(), /Indonesian, the topic is in English/);
  assert.equal(validateVariant(v("Good coffee is the only meeting that is never boring."), en).status, "approved");
  assert.equal(validateVariant(v("Deploy hari Jumat itu bukan berani, tapi nekat."), ctx({ topic: "deploy" })).status, "approved", "unknown topic language → no check");
});

test("banned words: reject list rejects, review list asks for review, no partial-word hits", () => {
  assert.equal(validateVariant(v("Produk ini pasti untung buat kamu."), ctx()).status, "rejected");
  assert.equal(validateVariant(v("Tahukah kamu, kopi itu enak?"), ctx()).status, "rejected", "also a template opener");
  assert.equal(validateVariant(v("Kopi itu enak, di era sekarang semua ngopi."), ctx()).status, "needs_review");
  assert.equal(validateVariant(v("Agamawan itu juga suka kopi sih."), ctx()).status, "approved", "agama inside a longer word is not a hit");
});

test("posts too similar to recent ones are caught", () => {
  const old = "Rapat satu jam yang bisa diganti satu pesan itu bukan kolaborasi, itu kebiasaan.";
  assert.ok(jaccard(old, "Rapat satu jam yang bisa diganti satu pesan itu bukan kolaborasi, cuma kebiasaan.") > 0.8);
  assert.match(validateVariant(v("Rapat satu jam yang bisa diganti satu pesan itu bukan kolaborasi, cuma kebiasaan."), ctx({ corpus: [old] })).reasons.join(), /Too similar/);
  assert.equal(validateVariant(v("Kopi sachet di pantry kantor itu tanda cinta yang paling jujur."), ctx({ corpus: [old] })).status, "approved");
});

test("educational: a number or claim without a research source waits for review; a cited one can pass layer 1", () => {
  const edu = (text: string, over: Partial<Variant>) => validateVariant(v(text, over), ctx({ type: "educational" }));
  assert.match(edu("Datang jam 3 sore biar dapat tempat.", {}).reasons.join(), /without a research source/);
  assert.equal(edu("Datang sebelum jam makan malam biar dapat tempat.", {}).status, "approved", "a general tip needs no source");
  assert.equal(edu("Datang jam 3 sore biar dapat tempat.", { sourceNote: "Kompas https://kompas.com/a", confidence: "high" }).status, "approved");
  assert.match(edu("Datang jam 3 sore.", { sourceNote: "Kompas https://kompas.com/a", confidence: "low" }).reasons.join(), /not sure/);
});

test("story posts are always reviewed and never claim to be a real experience", () => {
  const r = validateVariant(v("Bayangin pertama kali bikin kopi susu, gulanya kelupaan. Ternyata enak juga."), ctx({ type: "story" }));
  assert.equal(r.status, "needs_review");
  assert.match(r.reasons.join(), /not a real experience/);
});

test("names outside the topic, context and research are flagged for review", () => {
  assert.match(validateVariant(v("Kemarin Budi Santoso bilang kopi itu wajib."), ctx()).reasons.join(), /Budi Santoso/);
  assert.match(validateVariant(v("Coba tanya @someone soal kopi."), ctx()).reasons.join(), /@someone/);
  assert.match(validateVariant(v("Ngopi di Kopi Senja Raya enak."), ctx()).reasons.join(), /outside the research/);
  assert.equal(validateVariant(v("Ngopi di Kopi Senja Raya enak."), ctx({ context: "- Kopi Senja Raya: kafe di Blok M" })).status, "approved");
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

// ---------- layer 2: judge ----------

const verdict = (variant: number, over: Partial<JudgeVerdicts["verdicts"][number]> = {}) =>
  ({ variant, score: 9, madeUpWords: [], coherent: true, unsupportedClaims: [], samePersona: true, soundsHuman: true, reasons: [], ...over });

test("judge: made-up words or broken sentences reject; unsupported claims, low score or a missing verdict ask for review", () => {
  const [made, broken, claim, low, ok, missing] = applyJudge({ verdicts: [
    verdict(1, { madeUpWords: ["stoplistriknya"] }), verdict(2, { coherent: false }), verdict(3, { unsupportedClaims: ["kolam ikan hias"] }),
    verdict(4, { score: 4, reasons: ["kaku"] }), verdict(5),
  ] }, 6, 7);
  assert.match(made.reject.join(), /Made-up or broken words: stoplistriknya/);
  assert.match(broken.reject.join(), /do not connect/);
  assert.match(claim.review.join(), /kolam ikan hias/);
  assert.match(low.review.join(), /Judge score 4\/10: kaku/);
  assert.deepEqual(ok, { reject: [], review: [] });
  assert.match(missing.review.join(), /no verdict/);
});

// ---------- research (Tavily mocked) ----------

const raw = (results: Raw["results"], answer: string | null = null): Raw => ({ answer, results });

test("research results are cleaned: low score, duplicates, used URLs and sensitive items dropped; summary cut to 2 sentences", () => {
  const out = cleanResults(raw([
    { title: "Kafe di Blok M", url: "https://a.com/1", content: "Satu kalimat. Dua kalimat. Tiga kalimat panjang sekali.", score: 0.9, published_date: "2026-10-01T00:00:00Z" },
    { title: "Kafe di Blok M", url: "https://a.com/2", content: "duplikat judul", score: 0.9 },
    { title: "Rendah", url: "https://a.com/3", content: "x", score: 0.1 },
    { title: "Sudah dipakai", url: "https://a.com/4", content: "x", score: 0.9 },
    { title: "Banjir di Blok M", url: "https://a.com/5", content: "x", score: 0.9 },
  ]), { minScore: 0.4, maxItems: 5, sensitive: setup.banned.sensitiveTopics, used: new Set(["https://a.com/4"]) });
  assert.deepEqual(out, [{ title: "Kafe di Blok M", summary: "Satu kalimat. Dua kalimat.", date: "2026-10-01", url: "https://a.com/1" }]);
  assert.equal(sourceNoteFor([1, 1, 9], out), "Kafe di Blok M (2026-10-01) https://a.com/1", "cited numbers become the note; an unknown number is ignored");
  assert.equal(sourceNoteFor([], out), null);
});

test("research: only the needed modes are searched; a failing Tavily gives empty research and the error, never a throw", async () => {
  const queries: string[] = [];
  const ok: Search = async (q) => { queries.push(`${q.topic}:${q.query}`); return raw([{ title: "T", url: `https://x.com/${q.topic}`, content: "Isi.", score: 0.8 }], "Kafe A dan Kafe B di Blok M."); };
  const entry = topicEntry(setup.angles, "first date di Blok M")!;
  const r = await gatherResearch({ topic: "first date di Blok M", entry, modes: new Set(["facts"]), cfg: cfg.research, sensitive: [], used: new Set(), search: ok });
  assert.equal(r.facts.length, 1);
  assert.equal(r.news.length, 0);
  assert.match(r.places, /Kafe A dan Kafe B/);
  assert.ok(queries.every((q) => q.startsWith("general:")) && queries.length === 2, queries.join());
  const down: Search = async () => { throw new Error("Tavily HTTP 503"); };
  const f = await gatherResearch({ topic: "x", entry, modes: new Set(["facts", "news"]), cfg: cfg.research, sensitive: [], used: new Set(), search: down });
  assert.deepEqual([f.facts, f.news, f.places], [[], [], ""]);
  assert.equal(f.errors.length, 3);
});

test("research: the same query is searched once a day; failures are not cached; the key goes in the header only", async () => {
  let n = 0;
  const s = cachedSearch(async () => { n++; return raw([]); }, () => "2026-10-13");
  await s({ query: "cache-test", topic: "general", max_results: 5 });
  await s({ query: "cache-test", topic: "general", max_results: 5 });
  assert.equal(n, 1);
  let fails = 0;
  const bad = cachedSearch(async () => { fails++; throw new Error("down"); }, () => "2026-10-13");
  await assert.rejects(bad({ query: "fail-test", topic: "general", max_results: 5 }));
  await assert.rejects(bad({ query: "fail-test", topic: "general", max_results: 5 }));
  assert.equal(fails, 2);

  await assert.rejects(tavily("")({ query: "x", topic: "general", max_results: 1 }), /TAVILY_API_KEY is not set/);
  let sent: RequestInit | undefined;
  const fake = (async (_url: string, init: RequestInit) => { sent = init; return new Response(JSON.stringify(raw([])), { status: 200 }); }) as typeof fetch;
  await tavily("secret-key", fake)({ query: "x", topic: "general", max_results: 1 });
  assert.equal((sent!.headers as Record<string, string>).Authorization, "Bearer secret-key");
  assert.doesNotMatch(String(sent!.body), /secret-key/);
});

// ---------- the whole batch ----------

let word = 0;
/** Texts with their own words, so posts in one batch do not trip the similarity or same-opening rules. */
const fresh = (end = "?") => { word++; return `Opsi${word} pagi${word} ini apa${end}`; };
const reply = (type: string, texts: string[], over: Record<string, unknown> = {}) => ({ type, variants: texts.map((text) => ({ text, thread: [], sources: [], confidence: null, needsSource: false, ...over })) });
const goodJudge: ContentDeps["judge"] = async (p) => ({ payload: { verdicts: p.texts.map((_, i) => verdict(i + 1)) }, costUsd: 0.001 });

const deps = (over: Partial<ContentDeps> = {}): ContentDeps & { calls: PromptInput[]; idems: (string | undefined)[]; slept: number[]; logs: Record<string, unknown>[] } => {
  const calls: PromptInput[] = [];
  const idems: (string | undefined)[] = [];
  const slept: number[] = [];
  const logs: Record<string, unknown>[] = [];
  return {
    calls, idems, slept, logs,
    setup: () => ({ ...setup, config: only(["question"]) }),
    context: async () => "",
    history: async () => ({ recent: [], threadsThisWeek: 0, angles: [], sources: [] }),
    recentTexts: async () => [],
    persona: async () => persona,
    voice: async () => null,
    search: async () => raw([]),
    rand: seeded(11),
    sleep: async (ms) => void slept.push(ms),
    log: (e) => void logs.push(e),
    write: async (p, c) => {
      calls.push(p);
      idems.push(c.idemKey);
      return { payload: reply(p.type, Array.from({ length: p.n }, () => fresh())), costUsd: 0.01 };
    },
    judge: goodJudge,
    ...over,
  };
};
const brief = { topic: "kopi di kantor", objective: "engagement", audience: "pekerja", platforms: ["twitter" as const], count: 4 };

test("a batch makes one write + one judge call per post, each with its own idemKey, and keeps the alternatives", async () => {
  // maxConsecutive 2 with a single type: posts 3 and 4 have no allowed type.
  const d = deps();
  const { payload, costUsd } = await generatePosts(brief, { idemKey: "task:x:1" }, d);
  assert.equal(payload.posts.length, 2);
  assert.equal(payload.skipped.length, 2);
  assert.deepEqual(d.idems, ["task:x:1:p0:a1", "task:x:1:p1:a1"]);
  assert.equal(payload.posts[0].alternatives.length, 2, "best + 2 alternatives = 3 variants");
  assert.equal(payload.posts[0].type, "question");
  assert.equal(payload.posts[0].status, "approved");
  assert.equal(Math.round(costUsd * 1000) / 1000, 0.022);
  assert.ok(d.logs.some((l) => l.slot === 0 && l.attempts === 1), "one log line per post");
});

test("a picked satire batch writes satire", async () => {
  const d = deps({ setup: () => setup, write: async (p) => ({ payload: reply(p.type, Array.from({ length: p.n }, () => fresh("."))), costUsd: 0 }) });
  const { payload } = await generatePosts({ ...brief, count: 2, types: ["satire"] }, {}, d);
  assert.deepEqual(payload.posts.map((p) => p.type), ["satire", "satire"]);
});

test("old type names in the brief still work", async () => {
  const d = deps({ setup: () => setup, write: async (p) => ({ payload: reply(p.type, Array.from({ length: p.n }, () => fresh("."))), costUsd: 0 }) });
  const { payload } = await generatePosts({ ...brief, count: 1, types: ["one_liner_satire"] }, {}, d);
  assert.equal(payload.posts[0].type, "satire");
});

test("each variant gets its own angle from config, stored on the post and its alternatives; recent angles are avoided", async () => {
  const topic = "first date di Blok M";
  const list = topicEntry(setup.angles, topic)!.angles.question!;
  const d = deps({ history: async () => ({ recent: [], threadsThisWeek: 0, angles: list.slice(0, 5), sources: [] }) });
  const { payload } = await generatePosts({ ...brief, topic, count: 2 }, {}, d);
  const angles = d.calls.flatMap((c) => c.angles);
  assert.equal(angles.length, 6);
  assert.equal(new Set(angles).size, 6, "no angle twice in the batch");
  assert.ok(angles.every((a) => !list.slice(0, 5).includes(a)), "recent angles avoided");
  const p = payload.posts[0];
  assert.deepEqual([p.angle, ...p.alternatives.map((a) => a.angle)].sort(), d.calls[0].angles.slice().sort());
});

test("a gibberish verdict from the judge is never approved: the post is regenerated, then skipped with the reason", async () => {
  const gibberish: ContentDeps["judge"] = async (p) => ({ payload: { verdicts: p.texts.map((_, i) => verdict(i + 1, { madeUpWords: ["blangsingin"] })) }, costUsd: 0 });
  const d = deps({ judge: gibberish });
  await assert.rejects(generatePosts({ ...brief, count: 1 }, {}, d), /All 3 variants were rejected: Made-up or broken words: blangsingin.*after 3 attempts/);
  assert.equal(d.calls.length, cfg.maxAttempts);
  assert.match(d.calls[1].avoid.join(), /blangsingin/, "the retry is told what failed");

  let n = 0;
  const thenOk: ContentDeps["judge"] = async (p) => (++n === 1 ? gibberish(p, {}) : goodJudge(p, {}));
  const { payload } = await generatePosts({ ...brief, count: 1 }, {}, deps({ judge: thenOk }));
  assert.equal(payload.posts[0].status, "approved");
});

test("when the judge cannot run, nothing is approved", async () => {
  const d = deps({ judge: async () => { throw new Error("HTTP 502"); } });
  const { payload } = await generatePosts({ ...brief, count: 1 }, {}, d);
  assert.equal(payload.posts[0].status, "needs_review");
  assert.match(payload.posts[0].reasons.join(), /Quality judge unavailable: HTTP 502/);
});

test("a timeout is retried with backoff and a single variant; it is skipped with the reason only after every attempt", async () => {
  let n = 0;
  const d = deps({ write: async (p) => { if (++n === 1) throw new Error("The operation was aborted due to timeout"); return { payload: reply(p.type, Array.from({ length: p.n }, () => fresh())), costUsd: 0 }; } });
  const { payload } = await generatePosts({ ...brief, count: 1 }, {}, d);
  assert.equal(payload.posts.length, 1);
  assert.deepEqual(d.slept, [2000]);
  assert.equal(n, 2);
  assert.equal(payload.posts[0].alternatives.length, 0, "the retry asked for one variant");

  const down = deps({ write: async () => { throw new Error("The operation was aborted due to timeout"); } });
  await assert.rejects(generatePosts({ ...brief, count: 1 }, {}, down), /Generation failed: The operation was aborted due to timeout \(after 3 attempts\)/);
  assert.deepEqual(down.slept, [2000, 4000]);
});

test("a budget error stops the batch, a DB error fails clearly, a missing persona stops before any call", async () => {
  await assert.rejects(generatePosts(brief, {}, deps({ write: async () => { throw new AiBudgetError("Monthly LLM budget reached"); } })), AiBudgetError);
  await assert.rejects(generatePosts(brief, {}, deps({ context: async () => { throw new Error("connect ECONNREFUSED"); } })), /Could not load your context files.*ECONNREFUSED/);
  const d = deps({ persona: async () => null });
  await assert.rejects(generatePosts(brief, {}, d), /persona_missing/);
  assert.equal(d.calls.length, 0);
});

test("a sensitive topic is refused before research or generation", async () => {
  let searched = false;
  const d = deps({ search: async () => { searched = true; return raw([]); } });
  await assert.rejects(generatePosts({ ...brief, topic: "korban banjir Jakarta" }, {}, d), /Topic refused as sensitive \(banjir\)/);
  assert.equal(d.calls.length + Number(searched), 0);
});

test("educational: sourceNote comes from the cited research URL, never the model; without research the prompt forbids facts", async () => {
  const eduSetup = () => ({ ...setup, config: only(["educational"], { maxConsecutive: 5 }) });
  const search: Search = async () => raw([{ title: "Akses MRT Blok M", url: "https://jakartamrt.co.id/blokm", content: "Stasiun Blok M BCA dekat area kuliner.", score: 0.9 }]);
  const seen: PromptInput[] = [];
  const write: ContentDeps["write"] = async (p) => (seen.push(p), { payload: reply(p.type, Array.from({ length: p.n }, () => `Naik MRT ${++word} sampai Stasiun Blok M BCA, tinggal jalan kaki.`), { sources: [1], confidence: "high" }), costUsd: 0 });
  const d = deps({ setup: eduSetup, search, write });
  const { payload } = await generatePosts({ ...brief, topic: "first date di Blok M", count: 1 }, {}, d);
  assert.match(payload.posts[0].sourceNote!, /^Akses MRT Blok M https:\/\/jakartamrt\.co\.id\/blokm$/);
  assert.equal(seen[0].facts.length, 1);

  const down = deps({ setup: eduSetup, search: async () => { throw new Error("Tavily HTTP 500"); } });
  seen.length = 0;
  const out = await generatePosts({ ...brief, topic: "first date di Blok M", count: 1 }, {}, down);
  assert.equal(down.calls[0].researchMissing, true);
  assert.equal(down.calls[0].places, "");
  assert.equal(out.payload.posts[0].sourceNote, null);
  assert.ok(down.logs.some((l) => l.event === "content.research_failed"));
});

test("a reply with the wrong number of variants is retried; posts in one batch are checked against each other", async () => {
  let m = 0;
  const d = deps({ write: async (p) => ({ payload: reply(p.type, ++m === 1 ? ["Satu?"] : Array.from({ length: p.n }, () => fresh())), costUsd: 0 }) });
  const { payload } = await generatePosts({ ...brief, count: 1 }, {}, d);
  assert.equal(payload.posts.length, 1);
  assert.equal(m, 2);

  const same = deps({ setup: () => ({ ...setup, config: only(["question"], { maxConsecutive: 5, maxAttempts: 1 }) }), write: async (p) => ({ payload: reply(p.type, Array(p.n).fill("Kopi atau teh pagi ini?")), costUsd: 0 }) });
  const r = await generatePosts({ ...brief, count: 2 }, {}, same);
  assert.equal(r.payload.posts.length, 1);
  assert.match(r.payload.skipped[0].reason, /Too similar|Opens like another post/);
});

test("em dashes and curly quotes become plain punctuation", async () => {
  const d = deps({ write: async (p) => ({ payload: reply(p.type, ["Kopi — atau “teh”?", fresh(), fresh()]), costUsd: 0 }) });
  const { payload } = await generatePosts({ ...brief, count: 1 }, {}, d);
  assert.ok([payload.posts[0].text, ...payload.posts[0].alternatives.map((a) => a.text)].includes('Kopi, atau "teh"?'));
});

test("the owner's type picks limit the mix; a single pick lifts the anti-repeat rule", async () => {
  assert.deepEqual(Object.keys(onlyTypes(cfg, ["hot_take", "spontaneous"], 6).types).sort(), ["hot_take", "spontaneous"]);
  assert.equal(onlyTypes(cfg, ["hot_take", "spontaneous"], 6).maxConsecutive, cfg.maxConsecutive);
  assert.equal(onlyTypes(cfg, [], 6), cfg, "no pick = the full weighted mix");
  assert.equal(onlyTypes(cfg, ["nope"], 6), cfg, "an unknown type cannot be forced");
  const d = deps({ setup: () => setup });
  const { payload } = await generatePosts({ ...brief, count: 4, types: ["question"] }, {}, d);
  assert.deepEqual(payload.posts.map((p) => p.type), ["question", "question", "question", "question"]);
});

// ---------- trending topic suggestions ----------

test("trend suggestions: parsed from the feed, sensitive ones dropped, highest volume first, entities unescaped", () => {
  const item = (title: string, traffic: string, headline: string) =>
    `<item><title>${title}</title><ht:approx_traffic>${traffic}</ht:approx_traffic><ht:news_item><ht:news_item_title>${headline}</ht:news_item_title></ht:news_item></item>`;
  const xml = `<rss><channel><title>Daily Search Trends</title>${item("al ittihad", "100+", "Prediksi Al-Ittihad")}${item("gempa garut", "5000+", "Gempa di Garut")}${item("timnas", "2000+", "Timnas menang")}${item("artis x", "1000+", "Artis X meninggal dunia")}${item("kopi &amp; teh", "500+", "Harga kopi naik")}</channel></rss>`;
  const out = parseTrends(xml, setup.banned.sensitiveTopics);
  assert.deepEqual(out.map((t) => t.term), ["timnas", "kopi & teh", "al ittihad"]);
  assert.equal(out[0].headline, "Timnas menang");
  assert.equal(parseTrends(xml, [], 2).length, 2);
  assert.deepEqual(parseTrends("not xml", []), []);
});
