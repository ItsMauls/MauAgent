// Limited retry with backoff on the primary key, then one switch to the fallback key. Only rate limits, payment,
// auth and server errors fail over; any other 4xx (bad request, validation) is thrown at once.
import { AiHttpError } from "./client";

export type KeyLabel = "primary" | "fallback";

const retryable = (s: number) => s === 429 || s >= 500;
const failoverable = (s: number) => s === 401 || s === 402 || retryable(s);
/** Timeouts and network errors count as 5xx. */
const statusOf = (e: unknown) => (e instanceof AiHttpError ? e.status : 503);

export async function withFailover<T>(
  keys: { primary: string; fallback?: string },
  call: (key: string, label: KeyLabel) => Promise<T>,
  opts: { retries?: number; baseDelayMs?: number; sleep?: (ms: number) => Promise<void> } = {},
): Promise<{ result: T; keyLabel: KeyLabel }> {
  const retries = opts.retries ?? 2;
  const base = opts.baseDelayMs ?? 1000;
  const sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));

  const attempt = async (key: string, label: KeyLabel) => {
    for (let i = 0; ; i++) {
      try {
        return await call(key, label);
      } catch (e) {
        if (i >= retries || !retryable(statusOf(e))) throw e;
        const ra = e instanceof AiHttpError ? e.retryAfterSec : undefined;
        await sleep(Math.min(ra ? ra * 1000 : base * 2 ** i, 30_000));
      }
    }
  };

  try {
    return { result: await attempt(keys.primary, "primary"), keyLabel: "primary" };
  } catch (e) {
    if (!keys.fallback || !failoverable(statusOf(e))) throw e;
    console.warn(`[ai] primary key failed (HTTP ${statusOf(e)}), using fallback key`);
    return { result: await attempt(keys.fallback, "fallback"), keyLabel: "fallback" };
  }
}
