// A Socmed Specialist batch by content type: pick a type per post and an angle per variant, research facts and
// places, ask for N variants, run the rule checks (layer 1) and the LLM judge (layer 2), keep the best. A post whose
// variants all fail, or whose call times out, is retried (smaller after a timeout) up to maxAttempts, then skipped
// with the reason. Data access is injected (dbDeps below), so the whole flow is unit-tested without a DB or network.
import { db } from "@/lib/db";
import type { CallCtx, PostBrief } from "@/lib/agents";
import { roleMemoryBlock } from "@/lib/agents/memory";
import { getPersona } from "@/lib/agents/persona";
import { AiBudgetError, generateStructured } from "@/lib/ai/generate";
import { thread as newThread, voiced, type Thread } from "@/lib/boards/voice";
import { contentVariants, normalizeType, SocialPosts, type ContentType, type Cta, type Note, type Persona, type PostLength } from "@/lib/agents/schemas";
import { contentSetup, type ContentConfig, type ContentSetup } from "./config";
import { loadContext } from "./context";
import { applyJudge, judgePrompt, JudgeVerdicts, type JudgeInput } from "./judge";
import { assertPersona, buildPrompt, type PromptInput } from "./prompt";
import { cachedSearch, gatherResearch, NO_RESEARCH, sourceNoteFor, tavily, type Search } from "./research";
import { ctaPlan, isThreadType, pickAngles, pickType, topicEntry } from "./select";
import { addToBatch, bannedHits, batchProblems, briefLanguage, fitToLimit, questionHook, validateVariant, type BatchState, type Verdict } from "./validate";

/**
 * `types` = the owner's picks in the brief form; empty means the weighted mix of every type. `siblings` = texts of
 * the other posts of the batch when one post is regenerated, so it does not repeat them. `variants` overrides the
 * config's variants per post (automation campaigns).
 */
export type BatchInput = PostBrief & { count: number; types?: string[]; siblings?: string[]; variants?: number };

/**
 * Config limited to the owner's picks (weights kept). A single pick is an explicit request for that type, so the
 * anti-repeat rule is lifted; with two or more picks it still holds. A short or medium length drops thread types;
 * long lets every other type spill into a thread.
 */
export function onlyTypes(cfg: ContentConfig, types: string[], count: number, length: PostLength = "auto"): ContentConfig {
  const wanted = types.map((t) => normalizeType(t));
  const fixed = length === "short" || length === "medium";
  const usable = Object.entries(cfg.types).filter(([, c]) => c && c.weight > 0 && !(fixed && c.thread));
  const picked = usable.filter(([t]) => wanted.includes(t));
  if (!picked.length && length === "auto") return cfg;
  const chosen = picked.length ? picked : usable;
  const types2 = Object.fromEntries(chosen.map(([t, c]) => [t, length === "long" && !c!.thread ? { ...c!, allowThread: true } : c]));
  return { ...cfg, types: types2, maxConsecutive: picked.length === 1 ? Number.MAX_SAFE_INTEGER : cfg.maxConsecutive };
}

export { ctaPlan };
type Written = { payload: unknown; costUsd: number };

export type History = {
  /** Types of earlier batches in the last 7 days, most recent last, and how many of them were threads. */
  recent: string[];
  threadsThisWeek: number;
  /** Angles of earlier posts, oldest first. */
  angles: string[];
  /** Source URLs earlier posts cited. */
  sources: string[];
};

export type ContentDeps = {
  setup: () => ContentSetup;
  /** The owner's uploaded context files as one prompt block ("" = none). */
  context: () => Promise<string>;
  history: () => Promise<History>;
  /** Texts of posts created in the last `days` days, newest first (similarity corpus). */
  recentTexts: (days: number) => Promise<string[]>;
  /** The Socmed Specialist persona every post is written as. */
  persona: () => Promise<Persona | null>;
  /** The owner's writing style guide, or null when none is saved. */
  voice: () => Promise<string | null>;
  search: Search;
  write: (p: PromptInput, ctx: CallCtx) => Promise<Written>;
  judge: (p: JudgeInput, ctx: CallCtx) => Promise<Written>;
  rand: () => number;
  sleep: (ms: number) => Promise<void>;
  log: (entry: Record<string, unknown>) => void;
  /** Called for each line of the Specialist / QC conversation as it happens (live progress); optional. */
  note?: (n: Note) => Promise<void>;
};

const DAY = 86_400_000;

export const dbDeps: ContentDeps = {
  setup: contentSetup,
  context: loadContext,
  async history() {
    const rows = await db.artifact.findMany({
      where: { agentRole: "socmedSpecialist" }, orderBy: { createdAt: "desc" }, take: 50, select: { payload: true, createdAt: true },
    });
    const weekAgo = Date.now() - 7 * DAY;
    const posts = rows.reverse().flatMap((r) => (SocialPosts.safeParse(r.payload).data?.posts ?? []).map((p) => ({ ...p, thisWeek: r.createdAt.getTime() >= weekAgo })));
    const types = posts.flatMap((p) => (p.thisWeek && p.type ? [p.type] : []));
    const cfg = contentSetup().config;
    return {
      recent: types.slice(-10),
      threadsThisWeek: types.filter((t) => isThreadType(cfg, t)).length,
      angles: posts.flatMap((p) => (p.angle ? [p.angle] : [])),
      sources: posts.flatMap((p) => p.sourceNote?.match(/https?:\/\/\S+/g) ?? []),
    };
  },
  async recentTexts(days) {
    const rows = await db.publishJob.findMany({
      where: { createdAt: { gte: new Date(Date.now() - days * DAY) }, caption: { not: null } },
      select: { caption: true, thread: true }, distinct: ["caption"], orderBy: { createdAt: "desc" }, take: 500,
    });
    return rows.map((r) => [r.caption, ...r.thread].join("\n"));
  },
  persona: async () => (await getPersona("socmedSpecialist")).persona,
  voice: async () => (await db.setting.findUnique({ where: { id: "default" }, select: { writingVoice: true } }))?.writingVoice ?? null,
  search: cachedSearch(tavily()),
  async write(p, ctx) {
    const { system, prompt } = buildPrompt(p);
    return generateStructured("socmedSpecialist", prompt + (await roleMemoryBlock("socmedSpecialist")), contentVariants(p.n), {
      system, ...ctx, config: { temperature: p.typeCfg.sampling.temperature, topP: p.typeCfg.sampling.top_p },
    });
  },
  judge: (p, ctx) => generateStructured("contentJudge", judgePrompt(p), JudgeVerdicts, { ...ctx, step: "content-judge", config: { temperature: p.temperature } }),
  rand: Math.random,
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  log: (entry) => console.info(JSON.stringify({ event: "content.post", ...entry })),
};

const RANK = { approved: 0, needs_review: 1, rejected: 2 } as const;
const SURE = { high: 0, medium: 1, low: 2 } as const;
const message = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 300);
/**
 * Some models drop the backslash of "\n" before a list line ("work?nA. Yes"); restore it. Em dashes and curly quotes
 * read as AI on X; swap them for plain punctuation (the validator still rejects an em dash that gets through).
 */
const lines = (s: string) =>
  s.replace(/\s*\[\d+\]/g, "").replace(/([?.!:])n(?=(?:[A-Da-d][.)]|\d[.)])\s)/g, "$1\n").replace(/\s*—\s*/g, ", ").replace(/[“”]/g, '"').replace(/[‘’]/g, "'");

/** Layer 2 on top of layer 1: a judge reject wins, a judge review turns approved into needs_review. */
const merge = (v: Verdict, j: { reject: string[]; review: string[] }): Verdict => ({
  status: j.reject.length ? "rejected" : v.status === "needs_review" || j.review.length ? "needs_review" : "approved",
  reasons: [...j.reject, ...v.reasons, ...j.review],
});

/** Everything a batch loads once: config, context, persona, voice, research and the cross-post batch state. */
export type Shared = Awaited<ReturnType<typeof prepareBatch>>;

/** One post of a batch: its type and angles are already picked (by the batch loop or an automation plan). */
export type PostSpec = { slot: number; type: ContentType; angles: string[]; cta: Cta | null; avoid?: string[] };

export type PostResult = {
  post: SocialPosts["posts"][number] | null;
  /** Why no post survived (empty when one did). */
  problem: string;
  attempts: number;
  costUsd: number;
  /** Judge scores (0-10) of the chosen variant and the best other usable one, last attempt; null when not judged. */
  scores: { best: number | null; second: number | null };
  /** Review reasons the rule checks (layer 1, no LLM) gave the chosen variant. */
  ruleReview: string[];
};

/** `thread`: the discussion thread the lines belong to (an automation post passes its own, shared across retries). */
export async function prepareBatch(input: BatchInput, deps: ContentDeps = dbDeps, thread: Thread = newThread(input.topic)) {
  const setup = deps.setup();
  const typed = onlyTypes(setup.config, input.types ?? [], input.count, input.length);
  const cfg = input.variants ? { ...typed, variants: input.variants } : typed;
  const topic = [input.topic, input.brand].filter(Boolean).join(" ");
  const sensitive = bannedHits(topic, setup.banned.sensitiveTopics);
  if (sensitive.length) throw new Error(`Topic refused as sensitive (${sensitive.join(", ")}): pick another topic`);

  let uploaded: string, history: History, corpus: string[], persona: Persona | null, voice: string | null;
  try {
    [uploaded, history, corpus, persona, voice] = await Promise.all([deps.context(), deps.history(), deps.recentTexts(cfg.similarity.lookbackDays), deps.persona(), deps.voice()]);
  } catch (e) {
    throw new Error(`Could not load your context files or recent posts: ${message(e)}`);
  }
  assertPersona(persona);

  // Research once per batch, only for what its types use. Failure = write without factual claims.
  const entry = topicEntry(setup.angles, topic);
  const modes = new Set(Object.values(cfg.types).flatMap((c) => (c && c.weight > 0 ? [c.research] : [])));
  const research = modes.has("facts") || modes.has("news") || entry?.placesQuery
    ? await gatherResearch({ topic, entry, modes, cfg: cfg.research, sensitive: setup.banned.sensitiveTopics, used: new Set(history.sources), search: deps.search })
    : NO_RESEARCH;
  if (research.errors.length) deps.log({ event: "content.research_failed", errors: research.errors });

  const siblings = input.siblings ?? [];
  // At most 2 question hooks per batch, unless the owner picked only the question type.
  const onlyQuestions = Object.keys(cfg.types).length === 1 && "question" in cfg.types;
  const batch: BatchState = {
    texts: [...siblings], laughs: 0, laughQuota: Math.ceil(input.count / cfg.laughEvery), closingEmojis: [],
    questions: siblings.filter(questionHook).length, questionQuota: onlyQuestions ? Infinity : 2,
  };
  const transcript: Note[] = [];
  const say = async (who: Note["who"], text: string, post: number) => {
    const n = { who, text, post };
    transcript.push(n);
    await deps.note?.(n);
  };
  return {
    input, setup, cfg, topic, entry, research, uploaded, history, persona, voice,
    language: briefLanguage(input.topic, input.audience),
    corpus: [...siblings, ...corpus],
    batch,
    usedUrls: new Set<string>(),
    /** Posts accepted so far in this batch. */
    posts: [] as SocialPosts["posts"],
    transcript,
    say,
    thread,
  };
}

/**
 * Steps 3-5 for one post: n variants from the model, rule checks (layer 1), the judge (layer 2), keep the best. Retried
 * up to maxAttempts when every variant fails or the call errors. An accepted post is added to `shared` (batch state,
 * similarity corpus). AiBudgetError is rethrown.
 */
export async function writePost(shared: Shared, spec: PostSpec, ctx: CallCtx = {}, deps: ContentDeps = dbDeps): Promise<PostResult> {
  const { input, setup, cfg, topic, research, uploaded, persona, voice, language, corpus, batch, usedUrls, posts, say, thread } = shared;
  const { slot, type, angles, cta } = spec;
  const typeCfg = cfg.types[type];
  if (!typeCfg) throw new Error(`Content type "${type}" is not allowed in this batch`);
  const pool = typeCfg.research === "facts" ? research.facts : typeCfg.research === "news" ? research.news : [];
  const facts = pool.filter((f) => !usedUrls.has(f.url));
  const known = [uploaded, research.places, ...facts.map((f) => `${f.title}: ${f.summary}`)].filter(Boolean).join("\n");
  const check = {
    cfg, type, platforms: input.platforms, topic, context: known, banned: setup.banned, corpus: [...corpus, ...posts.map((p) => [p.text, ...p.thread].join("\n"))],
    audience: input.audience, length: input.length, hashtags: input.hashtags, customTags: input.customTags, avoid: input.avoid,
  };
  // The link travels after the text, added by code so the model never writes (or mangles) a URL.
  const link = input.linkUrl && (input.mediaType === "link" || cta === "visit_link") ? `\n${input.linkUrl}` : "";
  /** Fits a part into every picked platform; a trim that removed over 20% is flagged for review. */
  const fit = (t: string, suffix = "") => {
    let body = t;
    for (const p of input.platforms) body = fitToLimit(p, body, suffix).text.slice(0, -suffix.length || undefined);
    return { text: body + suffix, trimmed: t.length ? 1 - body.length / t.length > 0.2 : false };
  };
  const clip = (t: string, n = 140) => (t.length > n ? `${t.slice(0, n).trimEnd()}…` : t);

  await say("socmedSpecialist", spec.avoid?.length
    ? voiced(thread, "socmedSpecialist", "rewrite", { n: slot + 1, avoid: spec.avoid.slice(0, 3).join("; ") })
    : voiced(thread, "socmedSpecialist", "plan", { n: slot + 1, type: typeCfg.label, variants: cfg.variants, angles: angles.join("; ") }), slot);
  let avoid: string[] = spec.avoid ?? [];
  let problem = "";
  let timedOut = false;
  let attempts = 0;
  let costUsd = 0;
  const log: Record<string, unknown>[] = [];
  for (let attempt = 1; attempt <= cfg.maxAttempts; attempt++) {
    attempts = attempt;
    const key = (s: string) => (ctx.idemKey ? `${ctx.idemKey}:p${slot}:a${attempt}${s}` : undefined);
    // After a timeout or HTTP error, ask for a single variant: a smaller reply is faster.
    const n = timedOut ? 1 : cfg.variants;
    if (attempt > 1) await say("socmedSpecialist", voiced(thread, "socmedSpecialist", "retry", { attempt, max: cfg.maxAttempts, avoid: avoid.slice(0, 3).join("; ") }), slot);
    const prompt: PromptInput = {
      brief: input, type, typeCfg, examples: setup.examples[type] ?? [], angles: angles.slice(0, n), n, persona: persona!, voice, language,
      context: uploaded, places: research.places, facts, researchMissing: typeCfg.research !== "none" && !facts.length,
      openers: setup.banned.openers, recent: [...posts.map((p) => p.text).reverse(), ...corpus].slice(0, 10),
      laughAllowed: batch.laughs < batch.laughQuota, avoid,
      cta, questionAllowed: (batch.questions ?? 0) < (batch.questionQuota ?? Infinity),
    };

    // Step 3: n variants from the model.
    let variants;
    try {
      const out = await deps.write(prompt, { ...ctx, idemKey: key("") });
      costUsd += out.costUsd;
      const parsed = contentVariants(n).safeParse(out.payload);
      if (!parsed.success) throw new Error(`the model reply did not match the variant schema (${parsed.error.issues[0]?.message})`);
      variants = parsed.data.variants.map((x, i) => {
        // Over the limit: trim to fit (the link stays whole) instead of throwing the variant away. A thread carries
        // the link in its last part, so the hook keeps its marker at the end.
        const head = fit(lines(x.text), x.thread.length ? "" : link);
        const parts = x.thread.map((t, k) => fit(lines(t), k === x.thread.length - 1 ? link : ""));
        return {
          text: head.text, thread: parts.map((t) => t.text), confidence: x.confidence, needsSource: x.needsSource,
          sourceNote: sourceNoteFor(x.sources, facts), urls: [...new Set(x.sources)].map((k) => facts[k - 1]?.url).filter(Boolean) as string[],
          angle: angles[i] ?? null, trimmed: head.trimmed || parts.some((t) => t.trimmed),
        };
      });
      timedOut = false;
      await say("socmedSpecialist", variants.map((v, i) => `Variant ${i + 1}${v.angle ? ` (${v.angle})` : ""}: "${clip(v.text)}"${v.needsSource ? " [ada klaim tanpa sumber]" : ""}`).join("\n"), slot);
    } catch (e) {
      if (e instanceof AiBudgetError) throw e;
      problem = `Generation failed: ${message(e)}`;
      await say("socmedSpecialist", voiced(thread, "socmedSpecialist", "modelError"), slot);
      timedOut = true;
      log.push({ attempt, error: problem });
      if (attempt < cfg.maxAttempts) await deps.sleep(2000 * 2 ** (attempt - 1));
      continue;
    }

    // Step 4, layer 1: rule checks per variant and across the batch.
    const verdicts: Verdict[] = variants.map((v) => {
      const r = validateVariant(v, check);
      const b = batchProblems(v, batch);
      if (b.length) return { status: "rejected", reasons: [...b, ...r.reasons] };
      const note = `Trimmed to fit ${input.platforms.map((p) => (p === "twitter" ? "X" : "Threads")).join(" and ")}: check the meaning`;
      return v.trimmed && r.status === "approved" ? { status: "needs_review", reasons: [note] } : v.trimmed ? { ...r, reasons: [...r.reasons, note] } : r;
    });
    const rules = [...verdicts];
    const scores: (number | null)[] = variants.map(() => null);
    await say("qc", verdicts.map((v, i) => `Variant ${i + 1} ${v.status === "rejected" ? `ditolak: ${v.reasons.slice(0, 2).join("; ")}` : v.status === "needs_review" ? `perlu dicek: ${v.reasons.slice(0, 2).join("; ")}` : "lolos aturan dasar."}`).join("\n"), slot);
    // Layer 2: the judge reads what survived. If it cannot run, nothing is approved.
    const live = verdicts.flatMap((v, i) => (v.status === "rejected" ? [] : [i]));
    if (live.length) {
      let judged: { reject: string[]; review: string[] }[];
      try {
        const out = await deps.judge(
          { texts: live.map((i) => [variants[i].text, ...variants[i].thread].join("\n")), persona: persona!, voice, topic, context: known, temperature: cfg.judge.temperature },
          { ...ctx, idemKey: key(":judge") },
        );
        costUsd += out.costUsd;
        const scored = JudgeVerdicts.parse(out.payload);
        judged = applyJudge(scored, live.length, cfg.judge.minScore);
        live.forEach((vi, k) => (scores[vi] = scored.verdicts.find((x) => x.variant === k + 1)?.score ?? null));
        await say("qc", live.map((vi, k) => { const j = scored.verdicts.find((x) => x.variant === k + 1); return j ? `Variant ${vi + 1} (${j.score}/10): ${j.reasons.slice(0, 2).join(" ")}` : `Variant ${vi + 1}: belum bisa dinilai.`; }).join("\n"), slot);
      } catch (e) {
        if (e instanceof AiBudgetError) throw e;
        judged = live.map(() => ({ reject: [], review: [`Quality judge unavailable: ${message(e)}`] }));
        await say("qc", "Penilai kualitas tidak bisa berjalan, jadi tidak ada yang disetujui otomatis. Detailnya ada di log.", slot);
      }
      live.forEach((i, k) => (verdicts[i] = merge(verdicts[i], judged[k])));
    }
    log.push({ attempt, n, verdicts: verdicts.map((v) => ({ status: v.status, reasons: v.reasons })) });

    // Step 5: keep the best, offer the other usable ones as alternatives.
    const checked = variants
      .map((v, i) => ({ v, verdict: verdicts[i], i }))
      .filter((x) => x.verdict.status !== "rejected")
      .sort((a, b) => RANK[a.verdict.status] - RANK[b.verdict.status] || SURE[a.v.confidence ?? "high"] - SURE[b.v.confidence ?? "high"]);
    if (!checked.length) {
      const reasons = [...new Set(verdicts.flatMap((v) => v.reasons))];
      problem = `All ${variants.length} variants were rejected: ${reasons.join("; ")}`;
      avoid = reasons.slice(0, 6);
      await say("qc", `Semua ${variants.length} variant ditolak. Kembali ke Socmed Specialist dengan catatan: ${avoid.slice(0, 3).join("; ")}`, slot);
      continue;
    }
    const [best, ...rest] = checked;
    const post = {
      text: best.v.text, thread: best.v.thread, type, angle: best.v.angle, status: best.verdict.status, reasons: best.verdict.reasons,
      sourceNote: best.v.sourceNote, confidence: best.v.confidence, cta,
      alternatives: rest.map(({ v, verdict }) => ({ text: v.text, thread: v.thread, angle: v.angle, sourceNote: v.sourceNote, confidence: v.confidence, status: verdict.status, reasons: verdict.reasons })),
    };
    posts.push(post);
    await say("qc", `Variant ${best.i + 1} dipilih (${best.verdict.status === "approved" ? "approved" : "perlu review"})${best.verdict.reasons.length ? `: ${best.verdict.reasons.slice(0, 2).join("; ")}` : ""}.${rest.length ? ` ${rest.length} variant lain disimpan sebagai alternatif.` : ""}`, slot);
    addToBatch(batch, best.v);
    best.v.urls.forEach((u) => usedUrls.add(u));
    const others = rest.map((x) => scores[x.i]).filter((s): s is number => s !== null);
    deps.log({ slot, type, angles, attempts, status: post.status, layers: log });
    return {
      post, problem: "", attempts, costUsd, scores: { best: scores[best.i], second: others.length ? Math.max(...others) : null },
      ruleReview: rules[best.i].status === "needs_review" ? rules[best.i].reasons : [],
    };
  }
  deps.log({ slot, type, angles, attempts, status: "skipped", layers: log });
  return { post: null, problem: `${problem} (after ${attempts} attempt${attempts === 1 ? "" : "s"})`, attempts, costUsd, scores: { best: null, second: null }, ruleReview: [] };
}

export async function generatePosts(input: BatchInput, ctx: CallCtx = {}, deps: ContentDeps = dbDeps) {
  const shared = await prepareBatch(input, deps);
  const { cfg, setup, entry, history, posts, say } = shared;
  const recent = [...history.recent];
  const recentAngles = setup.angles.historySize ? history.angles.slice(-setup.angles.historySize) : [];
  let threads = history.threadsThisWeek;
  const usedAngles = new Set<string>();
  const ctas = ctaPlan(input.count, input.cta);
  const skipped: SocialPosts["skipped"] = [];
  let costUsd = 0;

  for (let slot = 0; slot < input.count; slot++) {
    // Step 1: the type for this post, and one angle per variant.
    const type = pickType(cfg, { recent, threadsThisWeek: threads }, deps.rand);
    if (!type) { skipped.push({ type: "-", reason: "No content type is allowed right now (weekly thread cap or repeat rule)" }); continue; }
    recent.push(type);
    if (isThreadType(cfg, type)) threads++;
    const angles = pickAngles(entry?.angles[type] ?? [], cfg.variants, usedAngles, recentAngles, deps.rand);
    angles.forEach((a) => usedAngles.add(a));
    const r = await writePost(shared, { slot, type, angles, cta: ctas[slot] }, ctx, deps);
    costUsd += r.costUsd;
    if (!r.post) {
      skipped.push({ type, reason: r.problem });
      await say("qc", `Post ${slot + 1} dilewati setelah ${r.attempts} kali percobaan.`, slot);
    }
  }

  if (!posts.length) throw new Error(`No usable post: ${skipped.map((s) => `${s.type}: ${s.reason}`).join(" | ").slice(0, 900)}`);
  return { payload: SocialPosts.parse({ posts, skipped, transcript: shared.transcript }), costUsd };
}
