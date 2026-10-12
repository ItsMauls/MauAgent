// Image generation through the same OpenRouter-compatible endpoint (chat completions with modalities).
// ponytail: no per-image cost tracking or budget gate; add via usage.cost if library generation gets expensive.
import { db } from "@/lib/db";
import { uploadImage } from "@/lib/cloudinary";
import { aiEnv } from "./env";

const MODEL = () => process.env.IMAGE_MODEL || "google/gemini-2.5-flash-image";
const VIEWS = { Front: "front view", Right: "right side view", Back: "back view", Left: "left side view" } as const;

/** Returns a data URL. `ref` (optional image URL) keeps the character identical across views. */
export async function generate(prompt: string, ref?: string) {
  const { AI_API_KEY, AI_BASE_URL } = aiEnv();
  const content: unknown[] = [{ type: "text", text: prompt }];
  if (ref) content.push({ type: "image_url", image_url: { url: ref } });
  const res = await fetch(`${AI_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${AI_API_KEY}`, "Content-Type": "application/json", "X-Title": "MauAgent" },
    body: JSON.stringify({ model: MODEL(), modalities: ["image", "text"], messages: [{ role: "user", content }] }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) throw new Error(`Image provider HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const url = ((await res.json()) as { choices?: { message?: { images?: { image_url?: { url?: string } }[] } }[] }).choices?.[0]?.message?.images?.[0]?.image_url?.url;
  if (!url) throw new Error("Image provider returned no image");
  return url;
}

/** Fills the missing Front/Right/Back/Left views of a character (the turnaround), appending them to imageUrls. */
export async function generateCharacterViews(id: string) {
  const asset = await db.creativeAsset.findUniqueOrThrow({ where: { id } });
  const have = new Set(asset.imageUrls.map((u) => new URL(u).searchParams.get("v")));
  const base = `Character design sheet of "${asset.name}". Plain light background, full body, consistent design, no text.\n${asset.description}`;
  const add = async (view: keyof typeof VIEWS, ref?: string) => {
    const url = `${await uploadImage(await generate(`${base}\nShow the ${VIEWS[view]}.`, ref))}?v=${encodeURIComponent(view)}`;
    // Append atomically so parallel views do not overwrite each other.
    await db.creativeAsset.update({ where: { id }, data: { imageUrls: { push: url } } });
    return url;
  };
  const missing = (Object.keys(VIEWS) as (keyof typeof VIEWS)[]).filter((v) => !have.has(v));
  let ref = asset.imageUrls[0]?.split("?")[0];
  if (!ref && missing[0]) ref = (await add(missing.shift()!)).split("?")[0];
  await Promise.allSettled(missing.map((v) => add(v, ref)));
}
