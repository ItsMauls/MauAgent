// Effort setting → OpenRouter `reasoning` request field. Pure; tested in effort.test.ts.
// Docs: https://openrouter.ai/docs/use-cases/reasoning-tokens. Model support comes from /models metadata
// (`reasoning.supported_efforts`, `reasoning.mandatory`); see DECISIONS.md for nemotron-3-super findings.

export type Effort = "off" | "low" | "medium" | "high";
export const EFFORTS: Effort[] = ["off", "low", "medium", "high"];

/** The subset of /models `reasoning` metadata we use. Undefined = the model does not reason. */
export type ReasoningMeta = { mandatory?: boolean; supported_efforts?: string[] } | undefined;

const ORDER = ["minimal", "low", "medium", "high", "xhigh", "max"];

export function reasoningParams(effort: Effort, meta: ReasoningMeta): { reasoning?: Record<string, unknown> } {
  // Non-reasoning model: send nothing rather than relying on the parameter being ignored.
  if (!meta) return {};
  if (effort === "off") return meta.mandatory ? { reasoning: { effort: lowest(meta) } } : { reasoning: { enabled: false } };
  const supported = meta.supported_efforts ?? [];
  // No effort list (budget-only models): OpenRouter maps effort to a share of max_tokens itself.
  if (!supported.length || supported.includes(effort)) return { reasoning: { effort } };
  // Clamp to the closest supported level at or below the request, else the lowest supported.
  const want = ORDER.indexOf(effort);
  const below = supported.filter((e) => ORDER.indexOf(e) <= want).sort((a, b) => ORDER.indexOf(b) - ORDER.indexOf(a));
  return { reasoning: { effort: below[0] ?? lowest(meta) } };
}

const lowest = (meta: NonNullable<ReasoningMeta>) =>
  [...(meta.supported_efforts ?? ["low"])].sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b))[0];
