import { test } from "node:test";
import assert from "node:assert/strict";
import { decrypt, encrypt } from "./crypto";

const K1 = "a".repeat(64);
const K2 = "b".repeat(64);
const TOKEN = "IGQWRPZA-secret-access-token_123";

test("crypto: round-trip, random IV, no plaintext in the stored value", () => {
  const a = encrypt(TOKEN, K1);
  const b = encrypt(TOKEN, K1);
  assert.equal(decrypt(a, K1), TOKEN);
  assert.notEqual(a, b, "fresh IV per encryption");
  assert.ok(a.startsWith("v1:"));
  assert.ok(!a.includes(TOKEN) && !a.includes(Buffer.from(TOKEN).toString("base64url")));
});

test("crypto: wrong key, tampering and bad keys are refused", () => {
  const blob = encrypt(TOKEN, K1);
  assert.throws(() => decrypt(blob, K2));
  const [v, iv, tag, ct] = blob.split(":");
  const flipped = (ct[0] === "A" ? "B" : "A") + ct.slice(1);
  assert.throws(() => decrypt([v, iv, tag, flipped].join(":"), K1));
  assert.throws(() => decrypt("plaintext-token", K1), /format/);
  assert.throws(() => encrypt(TOKEN, "short"), /TOKEN_ENC_KEY/);
});
