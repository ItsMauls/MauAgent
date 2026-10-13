// Turns the owner's uploaded writing (X archive, WhatsApp export, Telegram export, plain text) into the messages
// they wrote themselves, so the voice analysis never sees other people's words.

const MAX_MESSAGES = 300;
const MAX_CHARS = 40_000;

// "12/10/2026, 14:30 - Name: text", "[12/10/26, 14.30.05] Name: text", "10/12/26, 2:30 PM - Name: text"
const WA_LINE = /^‎?\[?\d{1,4}[/.-]\d{1,2}[/.-]\d{1,4},?\s+\d{1,2}[.:]\d{2}(?:[.:]\d{2})?(?:\s?[AaPp]\.?[Mm]\.?)?\]?\s*-?\s*([^:]+?): (.*)$/;
const WA_NOISE = /^(<.*(media|omitted|disertakan).*>|.*(this message was deleted|pesan ini dihapus).*|null)$/i;

export type VoiceFile = { name: string; text: string };

function whatsapp(raw: string, me: string) {
  const out: string[] = [];
  let mine = false;
  for (const line of raw.split(/\r?\n/)) {
    const m = WA_LINE.exec(line);
    if (m) {
      mine = m[1].trim().toLowerCase() === me;
      if (mine) out.push(m[2].trim());
    } else if (mine && out.length) out[out.length - 1] += `\n${line}`; // multi-line message
  }
  return out.filter((t) => t && !WA_NOISE.test(t));
}

function telegram(data: { messages: { from?: string; type?: string; text?: unknown }[] }, me: string) {
  return data.messages
    .filter((m) => m.type === "message" && m.from?.trim().toLowerCase() === me)
    .map((m) => (Array.isArray(m.text) ? m.text.map((p) => (typeof p === "string" ? p : (p as { text: string }).text)).join("") : String(m.text ?? "")).trim())
    .filter(Boolean);
}

function xArchive(raw: string) {
  const items: { tweet: { full_text: string; created_at: string } }[] = JSON.parse(raw.slice(raw.indexOf("[")));
  return items
    .map((i) => i.tweet)
    .filter((t) => !t.full_text.startsWith("RT @"))
    .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at))
    .map((t) => t.full_text);
}

/** Chat exports label the owner's own messages "You". */
export function ownMessages(files: VoiceFile[]) {
  const who = "you";
  const all: string[] = [];
  for (const { name, text } of files) {
    const raw = text.replace(/^﻿/, "").trim();
    if (raw.startsWith("window.YTD")) all.push(...xArchive(raw));
    else if (raw.startsWith("{") && raw.includes('"messages"')) {
      all.push(...telegram(JSON.parse(raw), who));
    } else if (raw.split(/\r?\n/).some((l) => WA_LINE.test(l))) {
      const mine = whatsapp(raw, who);
      if (!mine.length) throw new Error(`No messages from "You" found in ${name}`);
      all.push(...mine);
    } else all.push(...raw.split(/\n\s*\n|\r?\n/).map((t) => t.trim()).filter(Boolean));
  }
  // Every source is oldest first, so the tail of the combined list is the latest writing.
  const picked: string[] = [];
  let chars = 0;
  for (const t of all.slice(-MAX_MESSAGES).reverse()) {
    if (chars + t.length > MAX_CHARS) break;
    picked.push(t);
    chars += t.length + 2;
  }
  return picked.reverse().join("\n\n");
}
