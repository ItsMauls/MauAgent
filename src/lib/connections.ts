// Pure helpers for the Connections page and the sidebar indicator.
export const STATUS_LABEL = { connected: "Connected", needs_reauth: "Needs reauthorization", disabled: "Disabled", missing: "Missing from Buffer" } as const;

/**
 * Sidebar dot: an enabled Buffer channel that Buffer reports as broken, or a failed Buffer health check.
 * Channels that left Buffer are deactivated by the sync and show their own chip on /connections instead.
 */
export function connectionProblem(
  accounts: { publisher: string; active: boolean; status: keyof typeof STATUS_LABEL }[],
  bufferHealth?: { ok: boolean } | null,
) {
  if (bufferHealth && !bufferHealth.ok) return true;
  return accounts.some((a) => a.publisher === "buffer" && a.active && a.status !== "connected");
}
