// Content-type config for text posts: config/content-types.yaml, angles.yaml and banned.yaml (parsed with `yaml`,
// validated with Zod) plus the few-shot files in examples/. The prompt and the validator both read this, so a rule
// lives in one place. Type keys come from CONTENT_TYPES (src/lib/agents/schemas.ts), the single list of types.
import { readFileSync } from "node:fs";
import path from "node:path";
import { parse } from "yaml";
import { z } from "zod";
import { CONTENT_TYPES, ContentType } from "@/lib/agents/schemas";

const SourceRule = z.enum(["none", "flag", "required", "strict", "story"]);

const TypeConfig = z.object({
  /** How the type appears in the brief form. */
  label: z.string().trim().min(1),
  icon: z.string().trim().min(1).default("article"),
  blurb: z.string().trim().default(""),
  weight: z.number().min(0),
  source: SourceRule,
  /** Web research before writing: facts (credible domains), news (recent, for satire on a trend) or none. */
  research: z.enum(["none", "facts", "news"]).default("none"),
  /** Sampling sent to the model for this type. */
  sampling: z.object({ temperature: z.number().min(0).max(2), top_p: z.number().gt(0).max(1) }),
  guide: z.string().trim().min(1),
  maxSentences: z.number().int().positive().optional(),
  /** A thread type: text ends with `marker`, then `min`-`max` numbered parts and one closing part. */
  thread: z.object({ min: z.number().int().positive(), max: z.number().int().positive(), marker: z.string().min(1) }).optional(),
  /** A non-thread type that may still use thread[] when the post needs room. */
  allowThread: z.boolean().default(false),
  noHashtags: z.boolean().default(false),
  question: z.boolean().default(false),
});
export type TypeConfig = z.infer<typeof TypeConfig>;

export const ContentConfig = z.object({
  variants: z.number().int().min(1).max(5),
  maxConsecutive: z.number().int().min(1),
  weeklyThreadCap: z.number().int().min(0),
  similarity: z.object({ threshold: z.number().gt(0).max(1), lookbackDays: z.number().int().positive(), action: z.enum(["reject", "review"]) }),
  maxAttempts: z.number().int().min(1).max(5),
  laughEvery: z.number().int().min(1),
  judge: z.object({ temperature: z.number().min(0).max(2), minScore: z.number().min(0).max(10) }),
  research: z.object({
    minScore: z.number().min(0).max(1),
    maxItems: z.number().int().min(1).max(10),
    newsTimeRange: z.enum(["day", "week", "month", "year"]),
    credibleDomains: z.array(z.string().trim().min(1)).default([]),
  }),
  realPersonAllowlist: z.array(z.string()).default([]),
  types: z.partialRecord(ContentType, TypeConfig).refine((t) => Object.values(t).some((x) => x && x.weight > 0), "at least one type needs a weight above 0"),
});
export type ContentConfig = z.infer<typeof ContentConfig>;

export const Angles = z.object({
  historySize: z.number().int().min(0),
  topics: z.array(z.object({
    match: z.array(z.string().trim().min(1)).min(1),
    placesQuery: z.string().trim().min(1).optional(),
    factsQuery: z.string().trim().min(1).optional(),
    angles: z.partialRecord(ContentType, z.array(z.string().trim().min(1)).min(1)),
  })).default([]),
});
export type Angles = z.infer<typeof Angles>;
export type TopicAngles = Angles["topics"][number];

export type Example = { text: string; thread: string[] };

export const Banned = z.object({
  reject: z.array(z.string().trim().min(1)).default([]),
  review: z.array(z.string().trim().min(1)).default([]),
  /** A post may not start with one of these. */
  openers: z.array(z.string().trim().min(1)).default([]),
  /** A batch topic with one of these is refused; research results with one are dropped. */
  sensitiveTopics: z.array(z.string().trim().min(1)).default([]),
});
export type Banned = z.infer<typeof Banned>;

export type ContentSetup = { config: ContentConfig; angles: Angles; examples: Partial<Record<ContentType, Example[]>>; banned: Banned };

/** Parses one YAML text against a schema; the error names the file and the failing path. */
export function parseYaml<T extends z.ZodTypeAny>(file: string, text: string, schema: T): z.infer<T> {
  let raw: unknown;
  try {
    raw = parse(text);
  } catch (e) {
    throw new Error(`${file}: not valid YAML (${e instanceof Error ? e.message.split("\n")[0] : String(e)})`);
  }
  const r = schema.safeParse(raw);
  if (!r.success) throw new Error(`${file}: ${r.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ")}`);
  return r.data;
}

const MAX_EXAMPLES = 10;

/**
 * One examples/<type>.txt file: examples separated by a line "---"; in a thread example the parts are separated by a
 * line "+++". Lines starting with "#" are comments. At most 10 are used.
 */
export function parseExamples(text: string): Example[] {
  const body = text.replace(/\r\n?/g, "\n").split("\n").filter((l) => !l.startsWith("#")).join("\n");
  return body
    .split(/^---$/m)
    .map((block) => block.split(/^\+\+\+$/m).map((p) => p.trim()).filter(Boolean))
    .filter((parts) => parts.length)
    .slice(0, MAX_EXAMPLES)
    .map(([text, ...thread]) => ({ text, thread }));
}

export function buildSetup(texts: { config: string; angles: string; banned: string; examples?: Partial<Record<ContentType, string>> }): ContentSetup {
  return {
    config: parseYaml("config/content-types.yaml", texts.config, ContentConfig),
    angles: parseYaml("config/angles.yaml", texts.angles, Angles),
    banned: parseYaml("config/banned.yaml", texts.banned, Banned),
    examples: Object.fromEntries(Object.entries(texts.examples ?? {}).map(([t, s]) => [t, parseExamples(s ?? "")])),
  };
}

/** Types that can be picked (weight above 0), in config order. */
export const activeTypes = () => {
  const { types } = contentSetup().config;
  return CONTENT_TYPES.filter((t) => (types[t]?.weight ?? 0) > 0) as [ContentType, ...ContentType[]];
};

// ponytail: read once per process; edit the files and restart the server (or the Inngest worker) to apply.
let cached: ContentSetup | undefined;
export function contentSetup(): ContentSetup {
  if (cached) return cached;
  const read = (...p: string[]) => readFileSync(path.join(process.cwd(), ...p), "utf8");
  const optional = (...p: string[]) => { try { return read(...p); } catch { return ""; } };
  return (cached = buildSetup({
    config: read("config", "content-types.yaml"),
    angles: read("config", "angles.yaml"),
    banned: read("config", "banned.yaml"),
    examples: Object.fromEntries(CONTENT_TYPES.map((t) => [t, optional("examples", `${t}.txt`)])),
  }));
}
