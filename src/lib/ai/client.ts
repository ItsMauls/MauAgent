// The only place an OpenRouter (OpenAI-compatible) request is built. Plain fetch: no SDK needed for one endpoint,
// and it gives direct access to `reasoning`, `usage.cost` and the HTTP status that drives failover.

export type ChatBody = {
  model: string;
  messages: { role: "system" | "user" | "assistant"; content: string }[];
  max_tokens: number;
  temperature?: number;
  reasoning?: Record<string, unknown>;
  response_format?: Record<string, unknown>;
};

export type ChatUsage = {
  prompt_tokens?: number;
  completion_tokens?: number;
  completion_tokens_details?: { reasoning_tokens?: number };
  cost?: number;
};

export type ChatResponse = { model?: string; choices?: { message?: { content?: string | null } }[]; usage?: ChatUsage };

export type Fetch = typeof fetch;

/** HTTP error with status and a short provider message. Never carries headers or the key. */
export class AiHttpError extends Error {
  constructor(public status: number, message: string, public retryAfterSec?: number) {
    super(`AI provider HTTP ${status}: ${message}`);
  }
}

export async function chatCompletion(baseUrl: string, key: string, body: ChatBody, opts: { fetch?: Fetch; timeoutMs?: number } = {}) {
  const res = await (opts.fetch ?? fetch)(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "X-Title": "MauAgent" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(opts.timeoutMs ?? 90_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    let msg = text;
    try {
      msg = JSON.parse(text)?.error?.message ?? text;
    } catch {}
    const ra = Number(res.headers.get("retry-after"));
    throw new AiHttpError(res.status, String(msg).slice(0, 200) || res.statusText, Number.isFinite(ra) && ra > 0 ? ra : undefined);
  }
  return (await res.json()) as ChatResponse;
}
