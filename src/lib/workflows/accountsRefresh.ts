import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { inngest } from "@/lib/inngest";
import { db } from "@/lib/db";
import { decrypt } from "@/lib/crypto";
import { AuthError, encryptTokens, needsRefresh } from "@/lib/accounts";
import * as instagram from "@/lib/providers/instagram";
import * as tiktok from "@/lib/providers/tiktok";

/** Refresh tokens close to expiry and read the Instagram publishing quota. Free calls; errors land in lastError. */
async function checkAccount(id: string) {
  const a = await db.socialAccount.findUniqueOrThrow({ where: { id } });
  try {
    let token = decrypt(a.accessTokenEnc);
    const data: Prisma.SocialAccountUpdateInput = { lastError: null };
    if (needsRefresh(a.tokenExpiresAt)) {
      const t = a.platform === "instagram"
        ? await instagram.refresh(token)
        : await tiktok.refresh(decrypt(a.refreshTokenEnc ?? ""));
      token = t.accessToken;
      Object.assign(data, encryptTokens(t));
    }
    if (a.platform === "instagram") {
      const q = await instagram.publishingLimit(a.platformUserId, token);
      Object.assign(data, { quotaUsage: q.usage, quotaTotal: q.total, quotaCheckedAt: new Date() });
    }
    await db.socialAccount.update({ where: { id }, data });
    return { id, ok: true };
  } catch (e) {
    // "reauth" prefix drives tokenStatus(); not rethrown, the next daily check tries again.
    const msg = `${e instanceof AuthError ? "reauth: " : ""}${e instanceof Error ? e.message : String(e)}`.slice(0, 500);
    await db.socialAccount.update({ where: { id }, data: { lastError: msg } });
    return { id, ok: false };
  }
}

export const accountsRefresh = inngest.createFunction(
  { id: "accounts-refresh", retries: 2 },
  [{ cron: "TZ=Asia/Jakarta 0 3 * * *" }, { event: "accounts/refresh" }],
  async ({ event, step }) => {
    const { accountId } = z.object({ accountId: z.string().optional() }).parse(event.name === "accounts/refresh" ? event.data : {});
    const ids = await step.run("list-accounts", async () =>
      (await db.socialAccount.findMany({ where: { active: true, ...(accountId && { id: accountId }) }, select: { id: true } })).map((a) => a.id),
    );
    const results = [];
    for (const id of ids) results.push(await step.run(`check-${id}`, () => checkAccount(id)));
    return results;
  },
);
