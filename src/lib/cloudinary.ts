import { createHash } from "node:crypto";

/** Signed upload of one image (File, https URL or data URL) to Cloudinary (REST, no SDK); returns its permanent https URL. */
export async function uploadImage(file: File | string, folder = "mauagent/library") {
  const { CLOUDINARY_CLOUD_NAME: cloud, CLOUDINARY_API_KEY: api_key, CLOUDINARY_API_SECRET: secret } = process.env;
  if (!cloud || !api_key || !secret) throw new Error("Cloudinary is not configured (CLOUDINARY_* in .env)");
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = createHash("sha1").update(`folder=${folder}&timestamp=${timestamp}${secret}`).digest("hex");
  const body = new FormData();
  Object.entries({ file, api_key, timestamp, folder, signature }).forEach(([k, v]) => body.set(k, v));
  const res = await fetch(`https://api.cloudinary.com/v1_1/${cloud}/image/upload`, { method: "POST", body });
  const json = (await res.json()) as { secure_url?: string; error?: { message: string } };
  if (!res.ok || !json.secure_url) throw new Error(`Cloudinary upload failed: ${json.error?.message ?? res.status}`);
  return json.secure_url;
}
