// Step 4 of a text-post batch: automatic checks on one generated variant. Pure; the prompt asks for the same rules,
// but only what passes here can be scheduled.
import { textProblem } from "@/lib/publish";
import type { ContentType } from "@/lib/agents/schemas";
import type { Banned, ContentConfig } from "./config";

export type ReviewStatus = "approved" | "needs_review" | "rejected";
export type Confidence = "high" | "medium" | "low";
export type Variant = { text: string; thread: string[]; sourceNote?: string | null; confidence?: Confidence | null; needsSource?: boolean };
export type Verdict = { status: ReviewStatus; reasons: string[] };

export type CheckCtx = {
  cfg: ContentConfig;
  type: ContentType;
  platforms: string[];
  /** The brief topic (plus brand), which sets the expected language and the names that are not "real people". */
  topic: string;
  /** Uploaded context plus research (places, facts): names that appear there are not flagged. */
  context?: string;
  banned: Banned;
  /** Texts of recent posts and of earlier posts in this batch, for the similarity check. */
  corpus: string[];
};

// ---------- text helpers ----------

/**
 * Sentence count. A fragment of 1-2 words ("Arus balik.") is a setup, not a sentence, so it joins the next one.
 * ponytail: punctuation heuristic; abbreviations like "dll." can over-count. Swap for Intl.Segmenter if that bites.
 */
export function sentenceCount(text: string) {
  const parts = text.trim().split(/(?<=[.!?…])["”']?\s+/).filter((p) => /[\p{L}\p{N}]/u.test(p));
  return parts.filter((p, i) => i === parts.length - 1 || (p.match(/[\p{L}\p{N}]+/gu)?.length ?? 0) > 2).length;
}

const ID_WORDS = ["yang", "dan", "di", "ini", "itu", "nggak", "gak", "tidak", "aku", "kamu", "ke", "dari", "untuk", "ada", "juga", "sih", "aja", "kalau", "jadi", "tapi", "bisa", "lagi", "udah", "sudah", "banget", "dengan", "apa", "mana", "buat", "karena", "atau", "kita", "tiap", "biar"];
const EN_WORDS = ["the", "and", "is", "are", "you", "your", "to", "of", "in", "it", "for", "that", "with", "on", "this", "how", "what", "why", "best", "my", "be", "was", "can", "not", "but", "if", "so", "do", "at", "near", "about"];

/** "id", "en" or null when the text is too short or mixed to tell. `min` = hits needed on the winning side. */
export function detectLanguage(text: string, min = 2): "id" | "en" | null {
  const ws = text.toLowerCase().match(/\p{L}+/gu) ?? [];
  const id = ws.filter((w) => ID_WORDS.includes(w)).length;
  const en = ws.filter((w) => EN_WORDS.includes(w)).length;
  if (id >= min && id > en * 1.5) return "id";
  if (en >= min && en > id * 1.5) return "en";
  return null;
}

/** Language of the brief topic; a topic is short, so one function word is enough. */
export const topicLanguage = (topic: string) => detectLanguage(topic, 1);

const tokens = (s: string) => new Set(s.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? []);
/** Jaccard similarity of the normalised word sets (0-1). */
export function jaccard(a: string, b: string) {
  const x = tokens(a);
  const y = tokens(b);
  if (!x.size || !y.size) return 0;
  const inter = [...x].filter((w) => y.has(w)).length;
  return inter / (x.size + y.size - inter);
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** Whole-word, case-insensitive phrase hits. */
export const bannedHits = (text: string, list: string[]) =>
  list.filter((w) => new RegExp(`(?<![\\p{L}\\p{N}])${escape(w)}(?![\\p{L}\\p{N}])`, "iu").test(text));

/**
 * Possible real people: runs of 2+ capitalised words, and @handles, that do not come from the topic, the material or
 * the allowlist. ponytail: heuristic, so a hit only asks for review; a name dictionary or NER would cut false hits.
 */
export function possiblePeople(text: string, context: string, allowlist: string[]) {
  const known = new Set([...(context.toLowerCase().match(/\p{L}+/gu) ?? []), ...allowlist.map((w) => w.toLowerCase())]);
  const names = text.match(/\p{Lu}\p{Ll}+(?:[ \t]+\p{Lu}\p{Ll}+)+/gu) ?? [];
  const handles = text.match(/(?<![\p{L}\p{N}])@\w{2,}/gu) ?? [];
  return [
    ...names.filter((n) => n.split(/\s+/).some((w) => !known.has(w.toLowerCase()))),
    ...handles.filter((h) => !known.has(h.slice(1).toLowerCase())),
  ];
}

const OPTION = /^\s*(?:[A-Da-d][.)]|[-•]|\d[.)])\s+\S/;

const EMOJI = /\p{Extended_Pictographic}/gu;
export const emojis = (s: string) => s.match(EMOJI) ?? [];
const LAUGH = /(?<![\p{L}])(?:w+k+(?:w+k+)+|wkwk\w*|(?:ha){2,}|(?:he){2,})(?![\p{L}])/iu;
export const laughs = (s: string) => LAUGH.test(s);
const words = (s: string) => s.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
/** The first three words, normalised: two posts in a batch may not open the same way. */
export const opening = (s: string) => words(s).slice(0, 3).join(" ");
/** The emoji a post ends on (ignoring trailing punctuation), or null. */
const closingEmoji = (s: string) => s.trim().match(/(\p{Extended_Pictographic})[\p{M}️‍\p{Extended_Pictographic}\s.!?]*$/u)?.[1] ?? null;
const GUE = /(?<![\p{L}])(?:gue|gw|gua|lo|lu|elo|elu)(?![\p{L}])/iu;
const AKU = /(?<![\p{L}])(?:aku|kamu)(?![\p{L}])/iu;

/** What the batch has used so far, for the checks that look across posts. */
export type BatchState = { texts: string[]; laughs: number; laughQuota: number; closingEmojis: string[] };

/** Reject reasons that depend on the other posts in the batch (empty = fine). */
export function batchProblems(v: Variant, b: BatchState): string[] {
  const out: string[] = [];
  if (laughs([v.text, ...v.thread].join("\n")) && b.laughs >= b.laughQuota) out.push(`"wkwk"/"haha" already used ${b.laughs} time(s) in this batch (max ${b.laughQuota})`);
  const open = opening(v.text);
  if (open && b.texts.some((t) => opening(t) === open)) out.push(`Opens like another post in this batch ("${open}")`);
  const end = closingEmoji(v.text);
  if (end && b.closingEmojis.includes(end)) out.push(`Ends on the same emoji as another post in this batch (${end})`);
  return out;
}

/** Adds an accepted post to the batch state. */
export function addToBatch(b: BatchState, v: Variant) {
  b.texts.push(v.text);
  if (laughs([v.text, ...v.thread].join("\n"))) b.laughs++;
  const end = closingEmoji(v.text);
  if (end) b.closingEmojis.push(end);
}

/**
 * Review gate before anything goes to Buffer. `variant` 0 is the post itself, k is alternatives[k-1]. A rejected
 * variant never goes; a needs_review one goes only when the owner ticked Reviewed. Edited text is re-checked against
 * the reject list. Posts from batches made before content types have no status and pass.
 */
export function scheduleProblem(
  posts: { status?: ReviewStatus; alternatives: { status: ReviewStatus }[] }[],
  item: { slot: number; variant: number; reviewed: boolean; text: string; thread: string[] },
  banned: Banned,
): string | null {
  const post = posts[item.slot];
  if (!post) return `Post ${item.slot + 1} is not in this batch`;
  const v = item.variant === 0 ? post : post.alternatives[item.variant - 1];
  if (!v) return `Post ${item.slot + 1} has no variant ${item.variant + 1}`;
  if (v.status === "rejected") return `Post ${item.slot + 1} was rejected by the checks`;
  if (v.status === "needs_review" && !item.reviewed) return `Post ${item.slot + 1} needs review: tick "Reviewed" first`;
  const hits = bannedHits([item.text, ...item.thread].join("\n"), banned.reject);
  return hits.length ? `Post ${item.slot + 1} contains banned words: ${hits.join(", ")}` : null;
}

// ---------- the check ----------

export function validateVariant(v: Variant, ctx: CheckCtx): Verdict {
  const c = ctx.cfg.types[ctx.type];
  if (!c) return { status: "rejected", reasons: [`Unknown content type "${ctx.type}"`] };
  const reject: string[] = [];
  const review: string[] = [];
  const parts = [v.text, ...v.thread];
  const all = parts.join("\n");

  // Length per picked platform (the same budget the scheduler enforces).
  for (const p of ctx.platforms)
    for (const [i, t] of parts.entries()) {
      const problem = textProblem(p, t);
      if (problem) reject.push(`${parts.length > 1 ? `Part ${i + 1}: ` : ""}${problem}`);
    }

  // Format per type.
  if (c.thread) {
    const body = v.thread.slice(0, -1);
    if (!v.text.trim().endsWith(c.thread.marker)) reject.push(`The first post must end with ${c.thread.marker}`);
    if (body.length < c.thread.min || body.length > c.thread.max)
      reject.push(`A thread needs ${c.thread.min}-${c.thread.max} numbered parts plus a closing part (got ${v.thread.length} parts)`);
    const unnumbered = body.findIndex((t, i) => !new RegExp(`^${i + 1}\\s*[./)]`).test(t.trim()));
    if (unnumbered >= 0) reject.push(`Thread part ${unnumbered + 2} must start with "${unnumbered + 1}."`);
  } else if (v.thread.length && !c.allowThread) reject.push("This type is a single post, not a thread");
  if (c.maxSentences && sentenceCount(v.text) > c.maxSentences)
    reject.push(`At most ${c.maxSentences} sentence${c.maxSentences === 1 ? "" : "s"} (got ${sentenceCount(v.text)})`);
  if (c.noHashtags && /#[\p{L}\p{N}_]/u.test(all)) reject.push("No hashtags in this type");
  if (c.question) {
    if (!v.text.includes("?")) reject.push("A question post needs a question mark");
    const options = v.text.split("\n").filter((l) => OPTION.test(l)).length;
    if (options && (options < 2 || options > 4)) reject.push(`Poll options must be 2-4 (got ${options})`);
  }

  // Language follows the topic.
  const want = topicLanguage(ctx.topic);
  const got = detectLanguage(all);
  if (want && got && want !== got) review.push(`Written in ${got === "id" ? "Indonesian" : "English"}, the topic is in ${want === "id" ? "Indonesian" : "English"}`);

  // Style rules that read as AI when broken.
  for (const [i, t] of parts.entries()) {
    const n = emojis(c.thread && i === 0 ? t.replace(c.thread.marker, "") : t).length;
    if (n > 1) reject.push(`${parts.length > 1 ? `Part ${i + 1}: ` : ""}${n} emoji (max 1)`);
  }
  if (/[—–]/.test(all)) reject.push("Contains an em dash");
  const opener = ctx.banned.openers.find((o) => v.text.trim().toLowerCase().startsWith(o.toLowerCase()));
  if (opener) reject.push(`Template opener: "${opener}"`);
  if (GUE.test(all) && AKU.test(all)) reject.push('Mixes "gue/lo" with "aku/kamu"');

  // Banned words.
  const hardHits = bannedHits(all, ctx.banned.reject);
  if (hardHits.length) reject.push(`Banned: ${hardHits.join(", ")}`);
  const softHits = bannedHits(all, ctx.banned.review);
  if (softHits.length) review.push(`Sensitive or flagged words: ${softHits.join(", ")}`);

  // Similarity with recent posts and earlier posts in this batch.
  const top = Math.max(0, ...ctx.corpus.map((t) => jaccard(all, t)));
  if (top >= ctx.cfg.similarity.threshold)
    (ctx.cfg.similarity.action === "reject" ? reject : review).push(`Too similar to a recent post (${Math.round(top * 100)}% word overlap)`);

  // Sources. sourceNote is set by code from the research items the post cites, never written by the model. A claim
  // without a cited item, or one the model is unsure of, waits for the owner. The judge checks it matches the items.
  const note = v.sourceNote?.trim() ?? "";
  if (c.source === "flag" && v.needsSource) review.push("Needs a source for its factual claims");
  if (c.source === "required" || c.source === "strict") {
    if (!note && (v.needsSource || /\d/.test(all))) review.push("States a fact or number without a research source");
    if (note && v.confidence === "low") review.push("The AI is not sure the claim matches its source: verify it before publishing");
    if (note && v.needsSource) review.push("The AI marked a claim as still unsourced");
  }
  if (c.source === "strict") {
    if (!/\d/.test(v.text)) reject.push("A statistic post needs the number");
    if (!note) reject.push("A statistic post needs its source");
    if (!/\b(19|20)\d{2}\b/.test(`${v.text} ${note}`)) reject.push("A statistic post needs the year of the data");
  }
  if (c.source === "story") review.push("Written from the topic and your context, not a real experience: check it before posting");

  // Possible real people.
  const people = possiblePeople(all, `${ctx.topic} ${ctx.context ?? ""} ${note}`, ctx.cfg.realPersonAllowlist);
  if (people.length) review.push(`Mentions what may be a real person, brand or place outside the research: ${[...new Set(people)].slice(0, 3).join(", ")}`);

  if (reject.length) return { status: "rejected", reasons: [...reject, ...review] };
  return review.length ? { status: "needs_review", reasons: review } : { status: "approved", reasons: [] };
}
