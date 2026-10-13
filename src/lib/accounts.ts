import { randomBytes, timingSafeEqual } from "node:crypto";
import type { Platform, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { encrypt } from "@/lib/crypto";

/** Everything a page may see. Token columns (*Enc) are never selected for the client. */
export const ACCOUNT_PUBLIC_SELECT = {
  id: true, platform: true, platformUserId: true, handle: true, accountType: true, brandKitId: true, timezone: true,
  tokenExpiresAt: true, refreshExpiresAt: true, scopes: true, tiktokAuditStatus: true, publisher: true, active: true,
  lastError: true, quotaUsage: true, quotaTotal: true, quotaCheckedAt: true, createdAt: true,
  status: true, isDefaultForPlatform: true, lastSyncedAt: true, avatarUrl: true,
} satisfies Prisma.SocialAccountSelect;

/** Tokens and profile returned by a provider after the OAuth code exchange (or a refresh). */
export type TokenSet = { accessToken: string; refreshToken?: string; expiresAt?: Date; refreshExpiresAt?: Date; scopes?: string[] };
export type ConnectedAccount = TokenSet & { platform: Platform; platformUserId: string; handle: string; accountType?: string };

/** Provider said the token is invalid/revoked: the owner must reconnect. */
export class AuthError extends Error {}

/** Error strings never include the request URL (it can carry access_token). */
export async function httpJson<T>(url: string, init?: RequestInit, authStatus = [401]): Promise<T> {
  const res = await fetch(url, init);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = body?.error?.message ?? body?.error_description ?? body?.error?.code ?? body?.error ?? res.statusText;
    const err = `${new URL(url).host} ${res.status}: ${typeof msg === "string" ? msg : JSON.stringify(msg)}`;
    // Meta signals an invalid token with error code 190.
    throw authStatus.includes(res.status) || body?.error?.code === 190 ? new AuthError(err) : new Error(err);
  }
  return body as T;
}

export const redirectUri = (p: Platform) => `${process.env.APP_BASE_URL}/api/oauth/${p}`;

export const newState = () => randomBytes(16).toString("hex");
export function stateMatches(cookie: string | undefined, param: string | null) {
  if (!cookie || !param || cookie.length !== param.length) return false;
  return timingSafeEqual(Buffer.from(cookie), Buffer.from(param));
}

const DAY = 86_400_000;
export const WARN_DAYS = 7;

/**
 * Computed on read, never stored. The renewable deadline is the refresh token's expiry when there is one
 * (TikTok), else the access token's (Instagram long-lived tokens refresh themselves).
 */
export function tokenStatus(a: { tokenExpiresAt: Date | null; refreshExpiresAt: Date | null; lastError: string | null }, now = new Date()) {
  if (a.lastError?.startsWith("reauth")) return "reauth" as const;
  const deadline = a.refreshExpiresAt ?? a.tokenExpiresAt;
  if (!deadline) return "ok" as const;
  const left = deadline.getTime() - now.getTime();
  return left <= 0 ? ("reauth" as const) : left < WARN_DAYS * DAY ? ("expiring" as const) : ("ok" as const);
}

/** The access token should be refreshed by the daily check (always true for TikTok's 24 h tokens). */
export const needsRefresh = (expiresAt: Date | null, now = new Date()) => !!expiresAt && expiresAt.getTime() - now.getTime() < WARN_DAYS * DAY;

export const encryptTokens = (t: TokenSet) => ({
  accessTokenEnc: encrypt(t.accessToken),
  ...(t.refreshToken && { refreshTokenEnc: encrypt(t.refreshToken) }),
  tokenExpiresAt: t.expiresAt ?? null,
  ...(t.refreshExpiresAt && { refreshExpiresAt: t.refreshExpiresAt }),
  ...(t.scopes && { scopes: t.scopes }),
});

/** Reconnecting the same platform account updates its tokens (and reactivates it) instead of duplicating it. */
export function upsertConnectedAccount(c: ConnectedAccount) {
  const tokens = encryptTokens(c);
  const common = { handle: c.handle, ...(c.accountType && { accountType: c.accountType }), ...tokens, lastError: null };
  return db.socialAccount.upsert({
    where: { platform_platformUserId: { platform: c.platform, platformUserId: c.platformUserId } },
    create: {
      platform: c.platform, platformUserId: c.platformUserId, ...common,
      publisher: c.platform === "instagram" ? "instagram_graph" : "tiktok_inbox",
      tiktokAuditStatus: c.platform === "tiktok" ? "not_submitted" : null,
    },
    update: { ...common, active: true },
    select: { id: true },
  });
}
