// Server-only Buffer GraphQL client. The key only travels in the Authorization header, so it never reaches an error
// string or a log line. Mutations are never retried here: createPost is not idempotent (the workflow owns idempotency).
import type { z } from "zod";
import { bufferEnv } from "@/lib/ai/env";

export class BufferError extends Error {}
export class BufferAuthError extends BufferError {}
export class BufferRateLimitError extends BufferError {
  constructor(message: string, readonly retryAfter: number) { super(message); }
}
export class BufferValidationError extends BufferError {}
export class BufferTransientError extends BufferError {}

export type BufferDeps = {
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  env?: Record<string, string | undefined>;
};

const MAX_ATTEMPTS = 3;
const MAX_WAIT_S = 60; // a longer Retry-After surfaces as BufferRateLimitError instead of blocking a step
const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// Module-level concurrency cap (BUFFER_MAX_CONCURRENCY, read on first use).
let active = 0;
const waiting: (() => void)[] = [];
async function slot<T>(max: number, fn: () => Promise<T>): Promise<T> {
  while (active >= max) await new Promise<void>((r) => waiting.push(r));
  active++;
  try { return await fn(); } finally { active--; waiting.shift()?.(); }
}

type GqlBody = { data?: unknown; errors?: { message: string; extensions?: { code?: string } }[] };

function classify(status: number, retryAfter: string | null, body: GqlBody | null): BufferError | null {
  const err = body?.errors?.[0];
  const code = err?.extensions?.code;
  if (status === 429 || code === "RATE_LIMIT_EXCEEDED") return new BufferRateLimitError("Buffer rate limit reached", Number(retryAfter) || 30);
  if (status === 401 || status === 403 || code === "UNAUTHORIZED" || code === "FORBIDDEN") return new BufferAuthError("Buffer rejected the API key");
  if (status >= 500 || code === "UNEXPECTED") return new BufferTransientError(`Buffer server error${status >= 500 ? ` (HTTP ${status})` : ""}`);
  if (status >= 400 || err) return new BufferValidationError(`Buffer: ${err?.message ?? `HTTP ${status}`}`.slice(0, 300));
  return null;
}

export async function bufferRequest<T>(
  query: string, variables: Record<string, unknown>, schema: z.ZodType<T>,
  opts: { mutation?: boolean } & BufferDeps = {},
): Promise<T> {
  const env = bufferEnv(opts.env);
  const doFetch = opts.fetch ?? fetch;
  const sleep = opts.sleep ?? realSleep;
  const attempts = opts.mutation ? 1 : MAX_ATTEMPTS;
  for (let n = 1; ; n++) {
    let failure: BufferError;
    try {
      const res = await slot(env.BUFFER_MAX_CONCURRENCY, () =>
        doFetch(env.BUFFER_API_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.BUFFER_API_KEY}` },
          body: JSON.stringify({ query, variables }),
        }),
      );
      const body = (await res.json().catch(() => null)) as GqlBody | null;
      const bad = classify(res.status, res.headers.get("Retry-After"), body);
      if (!bad) {
        const parsed = schema.safeParse(body?.data);
        if (!parsed.success) throw new BufferValidationError(`Buffer returned an unexpected shape: ${parsed.error.issues[0]?.path.join(".") || "root"}`);
        return parsed.data;
      }
      failure = bad;
    } catch (e) {
      if (e instanceof BufferError) throw e;
      failure = new BufferTransientError("Could not reach Buffer"); // network error
    }
    const retryable = failure instanceof BufferTransientError || (failure instanceof BufferRateLimitError && failure.retryAfter <= MAX_WAIT_S);
    if (!retryable || n >= attempts) throw failure;
    const wait = failure instanceof BufferRateLimitError ? failure.retryAfter * 1000 : 500 * 2 ** (n - 1) + Math.random() * 250;
    await sleep(wait);
  }
}
