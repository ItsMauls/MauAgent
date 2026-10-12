import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/** AES-256-GCM for OAuth tokens at rest. Format: v1:iv:tag:ciphertext (base64url). Key: env TOKEN_ENC_KEY (32-byte hex). */
function key(hex = process.env.TOKEN_ENC_KEY) {
  if (!hex || !/^[0-9a-f]{64}$/i.test(hex)) throw new Error("TOKEN_ENC_KEY must be 64 hex chars (openssl rand -hex 32)");
  return Buffer.from(hex, "hex");
}

export function encrypt(plain: string, hexKey?: string) {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(hexKey), iv);
  const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return ["v1", iv, c.getAuthTag(), ct].map((p) => (typeof p === "string" ? p : p.toString("base64url"))).join(":");
}

export function decrypt(blob: string, hexKey?: string) {
  const [v, iv, tag, ct] = blob.split(":");
  if (v !== "v1" || !iv || !tag || ct === undefined) throw new Error("Unknown token format");
  const d = createDecipheriv("aes-256-gcm", key(hexKey), Buffer.from(iv, "base64url"));
  d.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([d.update(Buffer.from(ct, "base64url")), d.final()]).toString("utf8");
}
