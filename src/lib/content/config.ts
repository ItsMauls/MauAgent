// Content-type config for text posts: config/content-types.yaml, few_shot_examples.yaml and banned.yaml, parsed with
// `yaml` and validated with Zod. The prompt and the validator both read this, so a rule lives in one place.
import { readFileSync } from "node:fs";
import path from "node:path";
import { parse } from "yaml";
import { z } from "zod";

const SourceRule = z.enum(["none", "flag", "required", "strict", "story"]);

const TypeConfig = z.object({
  /** How the type appears in the brief form. */
  label: z.string().trim().min(1),
  icon: z.string().trim().min(1).default("article"),
  blurb: z.string().trim().default(""),
  weight: z.number().min(0),
  /** One of seedThemes is offered to the model as an optional angle. */
  seedTheme: z.boolean().default(false),
  source: SourceRule,
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
  seedThemes: z.array(z.string().trim().min(1)).min(1),
  realPersonAllowlist: z.array(z.string()).default([]),
  types: z.record(z.string().regex(/^[a-z_]+$/), TypeConfig).refine((t) => Object.values(t).some((x) => x.weight > 0), "at least one type needs a weight above 0"),
});
export type ContentConfig = z.infer<typeof ContentConfig>;

export const Example = z.object({ text: z.string().trim().min(1), thread: z.array(z.string().trim().min(1)).default([]), sourceNote: z.string().optional(), confidence: z.enum(["high", "medium", "low"]).optional() });
export const Examples = z.record(z.string(), z.array(Example).min(1));
export type Example = z.infer<typeof Example>;

export const Banned = z.object({ reject: z.array(z.string().trim().min(1)).default([]), review: z.array(z.string().trim().min(1)).default([]) });
export type Banned = z.infer<typeof Banned>;

export type ContentSetup = { config: ContentConfig; examples: Record<string, Example[]>; banned: Banned };

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

/** Cross-file checks: every example belongs to a configured type. */
export function buildSetup(texts: { config: string; examples: string; banned: string }): ContentSetup {
  const config = parseYaml("config/content-types.yaml", texts.config, ContentConfig);
  const examples = parseYaml("config/few_shot_examples.yaml", texts.examples, Examples);
  const unknown = Object.keys(examples).filter((t) => !config.types[t]);
  if (unknown.length) throw new Error(`config/few_shot_examples.yaml: unknown type ${unknown.join(", ")}`);
  return { config, examples, banned: parseYaml("config/banned.yaml", texts.banned, Banned) };
}

/** Types that can be picked (weight above 0), in config order. */
export const activeTypes = () => Object.keys(contentSetup().config.types).filter((t) => contentSetup().config.types[t].weight > 0) as [string, ...string[]];

// ponytail: read once per process; edit the YAML and restart the server (or the Inngest worker) to apply.
let cached: ContentSetup | undefined;
export function contentSetup(): ContentSetup {
  if (cached) return cached;
  const read = (f: string) => readFileSync(path.join(process.cwd(), "config", f), "utf8");
  return (cached = buildSetup({ config: read("content-types.yaml"), examples: read("few_shot_examples.yaml"), banned: read("banned.yaml") }));
}
