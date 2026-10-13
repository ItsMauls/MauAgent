// Image generation with provider fallback: Magic Hour, BytePlus Seedream, OpenRouter (see generate()).
// ponytail: no per-image cost tracking or budget gate; add via usage.cost if library generation gets expensive.
import { db } from "@/lib/db";
import { uploadImage } from "@/lib/cloudinary";
import { aiEnv } from "./env";
import { ImageModels, getAiSettings, parseImageProviders, type ImageProvider } from "./settings";

const VIEWS = { Front: "front view", Right: "right side view", Back: "back view", Left: "left side view" } as const;

/** `model` is the /settings/ai choice for this provider ("" = env/default). */
type Provider = (prompt: string, ref: string | undefined, model: string) => Promise<string>;

const json = async (res: Response, name: string) => {
  if (!res.ok) throw new Error(`${name} HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
};

const openrouter: Provider = async (prompt, ref, model) => {
  const { AI_API_KEY, AI_BASE_URL } = aiEnv();
  const content: unknown[] = [{ type: "text", text: prompt }];
  if (ref) content.push({ type: "image_url", image_url: { url: ref } });
  const j = await json(
    await fetch(`${AI_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${AI_API_KEY}`, "Content-Type": "application/json", "X-Title": "MauAgent" },
      body: JSON.stringify({ model: model || process.env.IMAGE_MODEL || "google/gemini-2.5-flash-image", modalities: ["image", "text"], messages: [{ role: "user", content }] }),
      signal: AbortSignal.timeout(120_000),
    }),
    "OpenRouter image",
  );
  const url = j.choices?.[0]?.message?.images?.[0]?.image_url?.url;
  if (!url) throw new Error("OpenRouter returned no image");
  return url as string;
};

// BytePlus ModelArk Seedream (synchronous). Uses the same ARK_API_KEY / ARK_BASE_URL as Seedance video.
const modelark: Provider = async (prompt, ref, model) => {
  if (!process.env.ARK_API_KEY) throw new Error("ARK_API_KEY is not set");
  const base = (process.env.ARK_BASE_URL ?? "https://ark.ap-southeast.bytepluses.com/api/v3").replace(/\/+$/, "");
  const j = await json(
    await fetch(`${base}/images/generations`, {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.ARK_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: model || process.env.SEEDREAM_MODEL || "seedream-5-0-260128",
        prompt,
        ...(ref && { image: ref }),
        sequential_image_generation: "disabled",
        response_format: "url",
        size: "2K",
        stream: false,
        watermark: false,
      }),
      signal: AbortSignal.timeout(120_000),
    }),
    "ModelArk image",
  );
  const url = j.data?.[0]?.url;
  if (!url) throw new Error("ModelArk returned no image");
  return url as string;
};

// Magic Hour (async: create → poll). No reference-image input, so `ref` is ignored.
const magichour: Provider = async (prompt, _ref, model) => {
  const key = process.env.MAGIC_HOUR_API_KEY;
  if (!key) throw new Error("MAGIC_HOUR_API_KEY is not set");
  const headers = { Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
  model ||= process.env.MAGIC_HOUR_IMAGE_MODEL ?? "";
  const { id } = await json(
    await fetch("https://api.magichour.ai/v1/ai-image-generator", {
      method: "POST",
      headers,
      body: JSON.stringify({ image_count: 1, aspect_ratio: "9:16", style: { prompt }, ...(model && { model }) }),
      signal: AbortSignal.timeout(30_000),
    }),
    "Magic Hour image",
  );
  for (const deadline = Date.now() + 120_000; Date.now() < deadline; ) {
    await new Promise((r) => setTimeout(r, 3_000));
    const p = await json(await fetch(`https://api.magichour.ai/v1/image-projects/${id}`, { headers, signal: AbortSignal.timeout(30_000) }), "Magic Hour image");
    if (p.status === "complete" && p.downloads?.[0]?.url) return p.downloads[0].url as string;
    if (p.status === "error" || p.status === "canceled") throw new Error(`Magic Hour image failed: ${p.error?.message ?? p.status}`);
  }
  throw new Error("Magic Hour image timed out");
};

const PROVIDERS: Record<ImageProvider, Provider> = { magichour, modelark, openrouter };

/**
 * Returns an image URL or data URL. Tries the providers chosen in /settings/ai in order (first = preferred, rest = fallback)
 * and falls through on any error (trial exhausted, 402/429, missing key), so one dead provider does not stop generation.
 * `ref` (optional image URL) keeps the character identical across views; Magic Hour ignores it.
 */
export async function generate(prompt: string, ref?: string) {
  const s = await getAiSettings();
  const models = ImageModels.catch({}).parse(s.imageModels);
  const errors: string[] = [];
  for (const name of parseImageProviders(s.imageProviders)) {
    try {
      return await PROVIDERS[name](prompt, ref, models[name] ?? "");
    } catch (e) {
      errors.push(`${name}: ${e instanceof Error ? e.message : e}`);
    }
  }
  throw new Error(`All image providers failed. ${errors.join(" | ") || "No image provider is enabled in /settings/ai."}`);
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
