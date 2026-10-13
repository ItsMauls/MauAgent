import assert from "node:assert/strict";
import { test } from "node:test";
import { ownMessages } from "./voiceSamples";

test("whatsapp: only my messages, multi-line kept, media and others dropped", () => {
  const wa = [
    "12/10/2026, 14:30 - You: eh jujur sih capek banget",
    "lanjut besok ya",
    "12/10/2026, 14:31 - Budi: oke bro",
    "12/10/2026, 14:32 - You: <Media omitted>",
    "[12/10/26, 14.33.05] You: gas deh",
  ].join("\n");
  assert.equal(ownMessages([{ name: "chat.txt", text: wa }]), "eh jujur sih capek banget\nlanjut besok ya\n\ngas deh");
});

test("telegram export and plain text", () => {
  const tg = JSON.stringify({ messages: [{ type: "message", from: "You", text: ["halo ", { text: "dunia" }] }, { type: "message", from: "Budi", text: "x" }] });
  assert.equal(ownMessages([{ name: "result.json", text: tg }, { name: "a.txt", text: "satu\n\ndua" }]), "halo dunia\n\nsatu\n\ndua");
});

