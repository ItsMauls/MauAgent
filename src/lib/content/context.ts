// Context files for text posts: notes and documents the owner uploads so the AI has a picture of the account or
// topic. Text files are read as they are; a picture is described once by a vision model and the description is kept.
// The posts read all of it as background data (never as instructions), within a character budget.
import { z } from "zod";
import { db } from "@/lib/db";
import { aiEnv } from "@/lib/ai/env";
import { generateStructured, type CallCtx } from "@/lib/ai/generate";

export const MAX_FILE_BYTES = 5_000_000;
export const MAX_FILES = 40;
/** Stored per text file. */
const MAX_STORED_CHARS = 20_000;
/** What one batch prompt takes in total, and at most per file, newest first. */
export const CONTEXT_BUDGET_CHARS = 8_000;
const PER_FILE_CHARS = 3_000;

const TEXT_EXT = ["md", "markdown", "txt", "csv", "tsv", "json", "yaml", "yml", "html", "htm", "log"];
const IMAGE_MIME: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif" };
export const ACCEPT = [...TEXT_EXT, ...Object.keys(IMAGE_MIME)].map((e) => `.${e}`).join(",");

const ext = (name: string) => name.toLowerCase().split(".").pop() ?? "";

export type Classified = { kind: "text"; mime: string } | { kind: "image"; mime: string } | { kind: "unsupported"; reason: string };

/** What a file is, from its name (browsers report unreliable MIME types for .md and friends). */
export function classify(name: string, size: number): Classified {
  const e = ext(name);
  if (size > MAX_FILE_BYTES) return { kind: "unsupported", reason: `${name}: larger than ${MAX_FILE_BYTES / 1_000_000} MB` };
  if (IMAGE_MIME[e]) return { kind: "image", mime: IMAGE_MIME[e] };
  if (TEXT_EXT.includes(e)) return { kind: "text", mime: e === "md" || e === "markdown" ? "text/markdown" : "text/plain" };
  return { kind: "unsupported", reason: `${name}: only notes (.md, .txt, .csv, .json, .html…) and pictures (.png, .jpg, .webp, .gif) can be read` };
}

/** Plain text of a text file, or null when it is binary. HTML loses its tags and scripts. */
export function extractText(name: string, bytes: Uint8Array): string | null {
  const raw = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  if (raw.includes("\u0000") || (raw.match(/�/g)?.length ?? 0) > raw.length / 50) return null;
  const e = ext(name);
  const text = e === "html" || e === "htm"
    ? raw.replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
    : raw;
  return text.replace(/\r\n?/g, "\n").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim().slice(0, MAX_STORED_CHARS);
}

const Described = z.object({ description: z.string().trim().min(1).max(1500) });

/** One vision call: what is in the picture, for someone writing posts about this account or topic. Costed like any call. */
export async function describeImage(name: string, mime: string, bytes: Uint8Array, ctx: CallCtx = {}) {
  const url = `data:${mime};base64,${Buffer.from(bytes).toString("base64")}`;
  const { payload } = await generateStructured(
    "contextReader",
    `Describe this picture so a social media writer understands it without seeing it: what it shows, any text in it (quote it), the setting, the mood, and anything that tells who or what the account or topic is about. Plain text, max 1200 characters, no markdown. Do not guess names of real people.
File name: ${name}`,
    Described,
    { ...ctx, step: "context-image", images: [url], config: { model: aiEnv().AI_VISION_MODEL, maxOutputTokens: 1200 } },
  );
  return payload.description;
}

export type ContextRow = { name: string; kind: "text" | "image"; content: string };

/** The context block for the prompt: newest files first, each trimmed, the whole kept within the budget. */
export function contextPrompt(files: ContextRow[], budget = CONTEXT_BUDGET_CHARS): string {
  const out: string[] = [];
  let left = budget;
  for (const f of files) {
    if (left < 200) break;
    const body = f.content.slice(0, Math.min(PER_FILE_CHARS, left));
    out.push(`## ${f.kind === "image" ? "Picture" : "File"}: ${f.name}\n${body}${body.length < f.content.length ? "\n[…cut]" : ""}`);
    left -= body.length + f.name.length + 20;
  }
  return out.join("\n\n");
}

export const loadContext = async () =>
  contextPrompt(await db.contentFile.findMany({ orderBy: { createdAt: "desc" }, take: MAX_FILES, select: { name: true, kind: true, content: true } }));
