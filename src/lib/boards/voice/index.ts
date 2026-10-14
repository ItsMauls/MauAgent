// The voiced lines of the team discussion (Indonesian, aku/kamu): 2-4 variants per agent and message kind, so Rina,
// Maul and Saras sound like themselves. Every number, verdict and reason comes in as data and is printed unchanged;
// only the wording around it varies. The pick is deterministic (hash of thread + kind + agent + occurrence), so a
// retried step writes the same text. There are no catchphrases: a stock phrase repeated across posts reads as a tic. The
// neutral "Rule and quality checks" lines are not here: they have no voice. Tested in voice.test.ts.

/** One conversation thread (a post, or a campaign-level exchange). Create one per thread and pass it to every line. */
export type Thread = { key: string; count: Map<string, number> };
export const thread = (key: string): Thread => ({ key, count: new Map() });

type Line<D> = ((d: D) => string)[];
const retryOrYou = (last: boolean, retry: string, you: string) => (last ? you : retry);

const RINA = {
  received: [
    (d) => `Perintah masuk: ${d.posts} post untuk ${d.audience}, pilar: ${d.pillars}. Brief detail untuk tim kususun sekarang.`,
    (d) => `Perintahnya sudah masuk: ${d.posts} post untuk ${d.audience}, pilar: ${d.pillars}. Aku susun brief detailnya dulu.`,
    (d) => `Perintah sudah kuterima. ${d.posts} post untuk ${d.audience}, pilar: ${d.pillars}. Brief untuk tim kusiapkan sekarang.`,
  ] as Line<{ posts: number; audience: string; pillars: string }>,
  brief: [
    (d) => `Brief-nya siap.\n${d.body}\nMaul, silakan mulai ya.`,
    (d) => `Ini ringkasan brief-nya.\n${d.body}\nLangkah berikutnya: Maul menulis post pilot.`,
    (d) => `Brief sudah kususun.\n${d.body}\nAku serahkan ke Maul untuk mulai menulis.`,
  ] as Line<{ body: string }>,
  wrapUp: [
    (d) => `Pilot selesai: ${d.written} post ditulis, ${d.review} menunggu review kamu${d.failed ? `, ${d.failed} gagal ditulis` : ""}. Langkah berikutnya: cek yang menunggu, lalu tekan Scale up kalau sudah oke.`,
    (d) => `Pilot beres, ${d.written} post ditulis dan ${d.review} menunggu review kamu${d.failed ? `, ${d.failed} gagal ditulis` : ""}. Setelah kamu cek, tekan Scale up untuk lanjut.`,
    (d) => `Pilot selesai. ${d.written} post ditulis, ${d.review} menunggu review kamu${d.failed ? `, ${d.failed} gagal ditulis` : ""}. Berikutnya: review dulu, lalu Scale up.`,
  ] as Line<{ written: number; review: number; failed: number }>,
};

const MAUL = {
  ack: [
    () => "Brief diterima. Post pilot kutulis pakai suara akunnya, lalu satu per satu kuoper ke Saras.",
    () => "Mulai dari sini. Post pilot kutulis dari brief ini dengan suara akunnya, nanti Saras yang cek.",
    () => "Siap, brief-nya jelas. Kutulis post pilotnya, tiap post langsung ke Post QC.",
  ] as Line<void>,
  plan: [
    (d) => `Post ${d.n}: tipe "${d.type}". Kubikin ${d.variants} variant${d.angles ? ` dengan angle: ${d.angles}` : ""}.`,
    (d) => `Oke, post ${d.n} tipe "${d.type}", ${d.variants} variant${d.angles ? `, angle: ${d.angles}` : ""}.`,
    (d) => `Giliran post ${d.n}: "${d.type}", ${d.variants} variant${d.angles ? ` (angle: ${d.angles})` : ""}.`,
  ] as Line<{ n: number; type: string; variants: number; angles: string }>,
  // Instead of `plan` when Post QC sent the post back: Maul's one-line answer, then he rewrites.
  rewrite: [
    (d) => `Siap. Post ${d.n} kutulis ulang tanpa: ${d.avoid}.`,
    (d) => `Kubenerin post ${d.n}, kuhindari: ${d.avoid}.`,
    (d) => `Post ${d.n} kutulis ulang, ${d.avoid} kubuang.`,
    (d) => `Oke, post ${d.n} kutulis ulang, kuhindari: ${d.avoid}.`,
  ] as Line<{ n: number; avoid: string }>,
  // A rewrite inside one write (every variant failed the checks or the call failed).
  retry: [
    (d) => `Percobaan ${d.attempt}/${d.max}${d.avoid ? `, kuhindari: ${d.avoid}` : ""}.`,
    (d) => `Kutulis ulang. Percobaan ${d.attempt}/${d.max}${d.avoid ? `, kuhindari: ${d.avoid}` : ""}.`,
    (d) => `Kutulis ulang (percobaan ${d.attempt}/${d.max})${d.avoid ? `, tanpa: ${d.avoid}` : ""}.`,
    (d) => `Percobaan ${d.attempt}/${d.max}, kutulis ulang${d.avoid ? ` dan kuhindari: ${d.avoid}` : ""}.`,
  ] as Line<{ attempt: number; max: number; avoid: string }>,
  modelError: [
    () => "Panggilan ke model gagal kali ini, detail teknisnya ada di log.",
    () => "Model belum merespons. Detailnya kucatat di log.",
  ] as Line<void>,
  noPost: [
    (d) => `Post ${d.n} belum ada versi yang layak. ${retryOrYou(d.last, "Kucoba lagi.", "Kesempatan habis, kuserahkan ke kamu.")}`,
    (d) => `Belum dapat versi yang pas untuk post ${d.n}. ${retryOrYou(d.last, "Kutulis ulang.", "Retry habis, ini ke kamu ya.")}`,
  ] as Line<{ n: number; last: boolean }>,
  handoff: [
    (d) => `Post ${d.n} siap, kuoper ke Saras.`,
    (d) => `Post ${d.n} beres. Saras, giliranmu ya.`,
    (d) => `Post ${d.n} selesai ✨ Silakan dicek, Saras.`,
  ] as Line<{ n: number }>,
};

const SARAS = {
  ruleFail: [
    (d) => `Rule check gagal: ${d.fails}. ${retryOrYou(d.last, "Maul, tolong tulis ulang.", "Retry habis, kukirim ke kamu.")}`,
    (d) => `Rule check gagal (${d.fails}). ${retryOrYou(d.last, "Balik ke Maul untuk ditulis ulang.", "Retry habis, ini ke kamu.")}`,
    (d) => `Gagal di rule check: ${d.fails}. ${retryOrYou(d.last, "Maul, tulis ulang tanpa itu.", "Retry habis, kukirim ke kamu.")}`,
  ] as Line<{ fails: string; last: boolean }>,
  rulePass: [
    (d) => `Rule check lolos${d.nearMiss ? " (mepet batas)" : ""}. Sekarang kubaca sebagai orang asing.`,
    (d) => `Rule check aman${d.nearMiss ? ", tapi mepet batas" : ""}. Lanjut ke penilaian kualitas.`,
    (d) => `Lolos rule check${d.nearMiss ? " (mepet batas)" : ""}. Kubaca dari sudut pandang pembaca baru.`,
  ] as Line<{ nearMiss: boolean }>,
  borderline: [
    (d) => `Confidence ${d.confidence}%, dekat ambang ${d.threshold}%. Aku minta pendapat kedua.`,
    (d) => `Confidence ${d.confidence}%, mepet ambang ${d.threshold}%. Kuambil sampel kedua.`,
  ] as Line<{ confidence: number; threshold: number }>,
  // Verdict first, then evidence, then the fix (the judge's own suggestion).
  verdict: [
    (d) => `${d.core}.${d.issues ? ` ${d.issues}` : ""}${d.fix ? ` Saran: ${d.fix}` : ""} ${d.decision}`,
    (d) => `${d.core}.${d.issues ? ` ${d.issues}` : ""}${d.fix ? ` Perbaikan: ${d.fix}` : ""} ${d.decision}`,
    (d) => `${d.core}.${d.issues ? ` Masalahnya: ${d.issues}` : ""}${d.fix ? ` Saran: ${d.fix}` : ""} ${d.decision}`,
  ] as Line<{ core: string; issues: string; fix: string; decision: string }>,
};

export const PHRASES = { accountManager: RINA, socmedSpecialist: MAUL, postQc: SARAS };
type Phrases = typeof PHRASES;
export type Speaker = keyof Phrases;

/** FNV-1a: a stable 32-bit hash, the same on every run (never Math.random). */
const fnv = (s: string) => {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0;
  return h;
};

/**
 * The line `speaker` says for `kind` in this thread: a hashed pick among the variants, the same on every run.
 */
export function voiced<S extends Speaker, K extends keyof Phrases[S]>(t: Thread, s: S, kind: K, ...[d]: Phrases[S][K] extends Line<infer D> ? (D extends void ? [] : [D]) : never): string {
  const variants = PHRASES[s][kind] as unknown as Line<unknown>;
  const id = `${s}|${String(kind)}`;
  const nth = t.count.get(id) ?? 0;
  t.count.set(id, nth + 1);
  const start = fnv(`${t.key}|${id}|${nth}`);
  return variants[start % variants.length](d);
}
