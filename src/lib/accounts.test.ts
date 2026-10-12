import { test } from "node:test";
import assert from "node:assert/strict";
import { ACCOUNT_PUBLIC_SELECT, needsRefresh, stateMatches, tokenStatus } from "./accounts";

const now = new Date(Date.UTC(2026, 9, 12));
const inDays = (d: number) => new Date(now.getTime() + d * 86_400_000);
const acct = (o: Partial<Parameters<typeof tokenStatus>[0]>) => ({ tokenExpiresAt: null, refreshExpiresAt: null, lastError: null, ...o });

test("tokenStatus: boundaries", () => {
  assert.equal(tokenStatus(acct({}), now), "ok");
  assert.equal(tokenStatus(acct({ tokenExpiresAt: inDays(30) }), now), "ok");
  assert.equal(tokenStatus(acct({ tokenExpiresAt: inDays(7) }), now), "ok");
  assert.equal(tokenStatus(acct({ tokenExpiresAt: inDays(6.9) }), now), "expiring");
  assert.equal(tokenStatus(acct({ tokenExpiresAt: inDays(0) }), now), "reauth");
  // TikTok: a 24 h access token is fine while the refresh token is valid.
  assert.equal(tokenStatus(acct({ tokenExpiresAt: inDays(-1), refreshExpiresAt: inDays(300) }), now), "ok");
  assert.equal(tokenStatus(acct({ tokenExpiresAt: inDays(30), lastError: "reauth: graph.instagram.com 401" }), now), "reauth");
  assert.equal(tokenStatus(acct({ tokenExpiresAt: inDays(30), lastError: "graph.instagram.com 500: oops" }), now), "ok");
});

test("needsRefresh: within the warning window only", () => {
  assert.equal(needsRefresh(null, now), false);
  assert.equal(needsRefresh(inDays(30), now), false);
  assert.equal(needsRefresh(inDays(1), now), true);
});

test("public select never includes token columns", () => {
  const keys = Object.keys(ACCOUNT_PUBLIC_SELECT);
  assert.ok(keys.length > 5);
  assert.deepEqual(keys.filter((k) => /enc|token$|secret/i.test(k)), []);
});

test("OAuth state: only an exact match passes", () => {
  assert.equal(stateMatches("abc123", "abc123"), true);
  assert.equal(stateMatches("abc123", "abc124"), false);
  assert.equal(stateMatches("abc123", "abc"), false);
  assert.equal(stateMatches(undefined, "abc123"), false);
  assert.equal(stateMatches("abc123", null), false);
});
