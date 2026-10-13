// Server-only secrets for the AI (OpenRouter) and Apify integrations. Read lazily, so the app still boots without
// them; the first call that needs a key fails with a clear message. Values never leave this module except as
// request headers, and the UI only sees the booleans from keyStatus().
import { z } from "zod";

const required = (name: string) => z.string({ error: `Set ${name} in .env` }).min(1, `Set ${name} in .env`);

const AiEnv = z.object({
  AI_API_KEY: required("AI_API_KEY"),
  AI_API_KEY_FALLBACK: z.string().optional().transform((v) => v || undefined),
  AI_BASE_URL: z.url({ error: "Set AI_BASE_URL in .env (e.g. https://openrouter.ai/api/v1)" }).transform((v) => v.replace(/\/+$/, "")),
  AI_MODEL: required("AI_MODEL"),
  // Model that reads uploaded pictures (must accept images). Only used when an image is uploaded as context.
  AI_VISION_MODEL: z.string().optional().transform((v) => v || "google/gemma-4-31b-it:free"),
});

const ApifyEnv = z.object({
  APIFY_API_TOKEN: required("APIFY_API_TOKEN"),
  APIFY_TIKTOK_TRENDS_ACTOR_ID: z.string().optional().transform((v) => v || "GULLsEZsAD69QFACQ"),
});

const BufferEnv = z.object({
  BUFFER_API_KEY: required("BUFFER_API_KEY"),
  BUFFER_ORGANIZATION_ID: z.string().optional().transform((v) => v || undefined),
  BUFFER_API_URL: z.string().optional().transform((v) => (v || "https://api.buffer.com").replace(/\/+$/, "")),
  BUFFER_MAX_CONCURRENCY: z.coerce.number().int().min(1).max(10).catch(2),
});

/** Zod error → one line naming the missing variables, never their values. */
function parse<T extends z.ZodTypeAny>(schema: T, env: Record<string, string | undefined>): z.infer<T> {
  const r = schema.safeParse(env);
  if (!r.success) throw new Error(r.error.issues.map((i) => i.message).join("; "));
  return r.data;
}

export const aiEnv = (env: Record<string, string | undefined> = process.env) => parse(AiEnv, env);
export const apifyEnv = (env: Record<string, string | undefined> = process.env) => parse(ApifyEnv, env);
export const bufferEnv = (env: Record<string, string | undefined> = process.env) => parse(BufferEnv, env);

/** Booleans and non-secret values only: safe to render. */
export const keyStatus = (env: Record<string, string | undefined> = process.env) => ({
  aiPrimary: !!env.AI_API_KEY,
  aiFallback: !!env.AI_API_KEY_FALLBACK,
  aiModel: env.AI_MODEL ?? null,
  apify: !!env.APIFY_API_TOKEN,
});
