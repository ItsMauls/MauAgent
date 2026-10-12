// Integration registry for the Boards card. Status is computed from stored data and the cached health check
// (IntegrationStatus), never by calling a provider during render. Add an integration = add an entry. Pure: tested.
import { tokenStatus } from "@/lib/accounts";

export type IntegrationState = "connected" | "configured" | "attention" | "inactive" | "soon";

export const STATE_LABEL: Record<IntegrationState, string> = {
  connected: "Connected",
  configured: "Key set, not verified",
  attention: "Needs attention",
  inactive: "Not active",
  soon: "Coming soon",
};

type Account = {
  platform: string; handle: string; active: boolean; tokenExpiresAt: Date | null; refreshExpiresAt: Date | null;
  lastError: string | null; quotaUsage: number | null; quotaTotal: number | null;
};
type Cache = { ok: boolean; summary: string | null; checkedAt: Date };
export type IntegrationCtx = { accounts: Account[]; cache: Record<string, Cache | undefined>; env: Record<string, string | undefined> };
export type IntegrationView = { id: string; name: string; icon: string; href: string; state: IntegrationState; summary: string; details: string[] };

type Entry = { id: string; name: string; icon: string; href: string; status: (c: IntegrationCtx) => Omit<IntegrationView, "id" | "name" | "icon" | "href"> };

const social = (platform: string) => (c: IntegrationCtx) => {
  const list = c.accounts.filter((a) => a.platform === platform && a.active);
  if (!list.length) return { state: "inactive" as const, summary: "No account connected", details: [] };
  const st = list.map((a) => tokenStatus(a));
  const details = list.map((a, i) =>
    `@${a.handle}: ${st[i] === "ok" ? "token OK" : st[i] === "expiring" ? "token expiring" : "reconnect needed"}${a.quotaUsage != null ? ` · quota ${a.quotaUsage}/${a.quotaTotal ?? "?"}` : ""}`,
  );
  if (st.includes("reauth")) return { state: "attention" as const, summary: "Reconnect needed", details };
  if (st.includes("expiring")) return { state: "attention" as const, summary: "Token expiring soon", details };
  return { state: "connected" as const, summary: `${list.length} account${list.length > 1 ? "s" : ""}`, details };
};

/** Verified by the health-check job; `envKey` missing means not set up at all. */
const checked = (id: string, envKey?: string) => (c: IntegrationCtx) => {
  if (envKey && !c.env[envKey]) return { state: "inactive" as const, summary: `Set ${envKey}`, details: [] };
  const r = c.cache[id];
  if (!r) return { state: "configured" as const, summary: "Not checked yet", details: [] };
  const at = `checked ${r.checkedAt.toISOString().slice(0, 16).replace("T", " ")} UTC`;
  return r.ok
    ? { state: "connected" as const, summary: r.summary ?? "OK", details: [at] }
    : { state: "attention" as const, summary: r.summary ?? "Check failed", details: [at] };
};

/** Key present but no free endpoint to verify it: never shown as connected. */
const keyOnly = (envKey: string) => (c: IntegrationCtx) =>
  c.env[envKey]
    ? { state: "configured" as const, summary: `${envKey} set`, details: [] }
    : { state: "inactive" as const, summary: `Set ${envKey}`, details: [] };

const notBuilt = (summary: string) => () => ({ state: "inactive" as const, summary, details: [] });
const soon = () => ({ state: "soon" as const, summary: "Outside v1 scope", details: [] });

export const INTEGRATIONS: Entry[] = [
  { id: "instagram", name: "Instagram", icon: "photo_camera", href: "/accounts", status: social("instagram") },
  { id: "tiktok", name: "TikTok", icon: "music_note", href: "/accounts", status: social("tiktok") },
  { id: "gemini", name: "Gemini", icon: "auto_awesome", href: "/settings", status: checked("gemini", "GOOGLE_GENERATIVE_AI_API_KEY") },
  { id: "seedance", name: "Seedance (video)", icon: "movie", href: "/settings", status: keyOnly("ARK_API_KEY") },
  { id: "s3", name: "S3 storage", icon: "cloud", href: "/settings", status: checked("s3") },
  { id: "orshot", name: "Orshot", icon: "send", href: "/accounts", status: notBuilt("Publisher not built yet") },
  { id: "elevenlabs", name: "ElevenLabs", icon: "graphic_eq", href: "/settings", status: notBuilt("Not built yet") },
  { id: "vidiq", name: "vidIQ", icon: "trending_up", href: "/settings", status: notBuilt("Trend Scout not built yet") },
  { id: "threads", name: "Threads", icon: "alternate_email", href: "/settings", status: soon },
  { id: "notion", name: "Notion", icon: "description", href: "/settings", status: soon },
];

export function integrationViews(c: IntegrationCtx): IntegrationView[] {
  return INTEGRATIONS.map(({ status, ...e }) => ({ ...e, ...status(c) }));
}
