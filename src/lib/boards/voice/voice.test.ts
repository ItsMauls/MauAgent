import { test } from "node:test";
import assert from "node:assert/strict";
import { PHRASES, signatures, thread, voiced, type Speaker, type Thread } from ".";

/** One value for every field any line reads. */
const D = {
  posts: 10, audience: "pekerja kantor", pillars: "kopi", body: "Tujuan: x", written: 3, review: 3, failed: 0, n: 4, type: "Spontaneous", variants: 3,
  angles: "", attempt: 2, max: 3, avoid: "Engagement bait", last: false, fails: "Engagement bait", nearMiss: false, confidence: 74, threshold: 80,
  core: "Verdict: pass (9 dari 10). Confidence 85%", issues: "Sounds stiff", fix: "Pakai kalimat pendek.", decision: "Disetujui otomatis.",
};
const speakers = Object.keys(PHRASES) as Speaker[];
const kinds = (s: Speaker) => Object.keys(PHRASES[s]) as string[];
const say = (t: Thread, s: Speaker, k: string) => (voiced as unknown as (t: Thread, s: Speaker, k: string, d: unknown) => string)(t, s, k, D);
const all = (key: string, rounds: number) => {
  const t = thread(key);
  return Array.from({ length: rounds }, () => speakers.flatMap((s) => kinds(s).map((k) => [s, say(t, s, k)] as const))).flat();
};

test("the same thread, kind and agent always give the same line (no randomness)", () => {
  assert.deepEqual(all("c1:s3:r0", 3), all("c1:s3:r0", 3));
  // Different threads do not all read alike.
  const lines = new Set(["a", "b", "c", "d", "e", "f"].map((k) => say(thread(k), "postQc", "rulePass")));
  assert.ok(lines.size > 1);
});

test("a catchphrase is said at most once per thread, even across many retries", () => {
  for (const key of ["c1:s0:r0", "c1:s1:r0", "x", "y:brief"]) {
    const seen = new Map<string, string>();
    for (const [s, text] of all(key, 4)) {
      for (const sig of signatures(s, text)) {
        assert.ok(!seen.has(sig), `"${sig}" repeated in ${key}:\n${seen.get(sig)}\n${text}`);
        seen.set(sig, text);
      }
    }
  }
});

test("every variant: at most one catchphrase; every kind has a plain variant; emoji only for Maul, at most one", () => {
  for (const s of speakers) for (const k of kinds(s)) {
    const texts = (PHRASES[s] as unknown as Record<string, ((d: unknown) => string)[]>)[k].map((f) => f(D));
    assert.ok(texts.length >= 2, `${s}.${k} needs variants`);
    for (const text of texts) {
      assert.ok(signatures(s, text).length <= 1, `${s}.${k}: ${text}`);
      const emoji = text.match(/\p{Extended_Pictographic}/gu) ?? [];
      assert.ok(emoji.length <= (s === "socmedSpecialist" ? 1 : 0), `${s}.${k}: ${text}`);
      assert.ok(!/sambil|menyeruput|blazer|Ogilvy|Zalora|GoTo/i.test(text), `${s}.${k} roleplays: ${text}`);
    }
    assert.ok(texts.some((x) => !signatures(s, x).length), `${s}.${k} has no plain variant`);
  }
});

test("the data is printed unchanged: numbers, verdicts and reasons", () => {
  const t = thread("c1:s3:r0");
  const v = say(t, "postQc", "verdict");
  assert.ok(v.includes(D.core) && v.includes(D.issues) && v.includes(D.fix) && v.includes(D.decision), v);
  const f = say(t, "postQc", "ruleFail");
  assert.ok(f.includes(D.fails) && /Maul/.test(f), f);
});
