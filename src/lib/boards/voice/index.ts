// The voiced lines of the team discussion (casual agency Indonesian, gue/lo): 2-4 variants per agent and message kind, so Rina,
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
    (d) => `Perintah udah masuk nih: ${d.posts} ide konten buat ${d.audience}, pilar: ${d.pillars}. Gue susun brief detailnya buat tim dulu ya.`,
    (d) => `Oke, perintahnya gue terima. ${d.posts} ide konten buat ${d.audience}, pilar: ${d.pillars}. Brief-nya gue siapin sekarang.`,
    (d) => `Udah gue terima ya: ${d.posts} ide konten buat ${d.audience}, pilar: ${d.pillars}. Bentar, gue bikinin brief buat tim.`,
  ] as Line<{ posts: number; audience: string; pillars: string }>,
  brief: [
    (d) => `Brief-nya udah siap.\n${d.body}\nMaul, lo boleh mulai ya.`,
    (d) => `Ini ringkasan brief-nya.\n${d.body}\nSelanjutnya Maul nulis konten pilotnya.`,
    (d) => `Brief udah gue susun.\n${d.body}\nGue serahin ke Maul buat mulai nulis ya.`,
  ] as Line<{ body: string }>,
  wrapUp: [
    (d) => `Pilot kelar nih: ${d.written} konten ditulis, ${d.review} nunggu review lo${d.failed ? `, ${d.failed} gagal ditulis` : ""}. Lo cek dulu yang nunggu, kalau udah oke tekan Scale up.`,
    (d) => `Pilot beres, ${d.written} konten ditulis dan ${d.review} nunggu review lo${d.failed ? `, ${d.failed} gagal ditulis` : ""}. Abis lo cek, tekan Scale up buat lanjut.`,
    (d) => `Pilot udah selesai. ${d.written} konten ditulis, ${d.review} nunggu review lo${d.failed ? `, ${d.failed} gagal ditulis` : ""}. Review dulu, baru Scale up ya.`,
  ] as Line<{ written: number; review: number; failed: number }>,
};

const MAUL = {
  ack: [
    () => "Brief-nya gue terima. Konten pilot gue tulis pake suara akunnya, terus satu-satu gue oper ke Saras.",
    () => "Oke, mulai dari sini. Gue tulis konten pilotnya dari brief ini pake suara akunnya, nanti Saras yang cek.",
    () => "Siap, brief-nya jelas. Gue tulis pilotnya, tiap konten langsung gue lempar ke Post QC.",
  ] as Line<void>,
  plan: [
    (d) => `Ide konten ke-${d.n}: tipe "${d.type}". Gue bikinin ${d.variants} draf${d.angles ? ` dengan angle: ${d.angles}` : ""}.`,
    (d) => `Oke, ide konten ke-${d.n} tipe "${d.type}", ${d.variants} opsi${d.angles ? `, angle: ${d.angles}` : ""}.`,
    (d) => `Giliran ide konten ke-${d.n}: "${d.type}", gue siapin ${d.variants} alternatif${d.angles ? ` (angle: ${d.angles})` : ""}.`,
  ] as Line<{ n: number; type: string; variants: number; angles: string }>,
  // Instead of `plan` when Post QC sent the post back: Maul's one-line answer, then he rewrites.
  rewrite: [
    (d) => `Siap. Ide konten ke-${d.n} gue tulis ulang, ${d.avoid}.`,
    (d) => `Gue benerin ide konten ke-${d.n} ya, ${d.avoid}.`,
    (d) => `Oke, ide konten ke-${d.n} gue revisi, ${d.avoid}.`,
  ] as Line<{ n: number; avoid: string }>,
  // A rewrite inside one write (every variant failed the checks or the call failed).
  retry: [
    (d) => `Gue tulis ulang ya, percobaan ${d.attempt}/${d.max}${d.avoid ? `, ${d.avoid}` : ""}.`,
    (d) => `Revisi dikit dulu. Percobaan ${d.attempt}/${d.max}${d.avoid ? `, ${d.avoid}` : ""}.`,
    (d) => `Percobaan ${d.attempt}/${d.max}, gue tulis ulang${d.avoid ? `. ${d.avoid}` : ""}.`,
  ] as Line<{ attempt: number; max: number; avoid: string }>,
  modelError: [
    () => "Panggilan ke model gagal kali ini, detail teknisnya ada di log.",
    () => "Modelnya belum nyaut nih. Detailnya gue catet di log.",
  ] as Line<void>,
  noPost: [
    (d) => `Ide konten ke-${d.n} belum ada draf yang layak. ${retryOrYou(d.last, "Gue coba lagi ya.", "Kesempatan gue abis, gue serahin ke lo.")}`,
    (d) => `Belum dapet draf yang pas buat ide konten ke-${d.n}. ${retryOrYou(d.last, "Gue tulis ulang.", "Retry-nya abis, ini gue oper ke lo ya.")}`,
  ] as Line<{ n: number; last: boolean }>,
  handoff: [
    (d) => `Ide konten ke-${d.n} udah siap, gue oper ke Saras.`,
    (d) => `Ide konten ke-${d.n} beres. Saras, giliran lo ya.`,
    (d) => `Ide konten ke-${d.n} kelar ✨ Tolong dicek, Saras.`,
  ] as Line<{ n: number }>,
};

const SARAS = {
  ruleFail: [
    (d) => `Ada yang nyangkut di aturan dasar: ${d.fails}. ${retryOrYou(d.last, "Maul, tolong tulis ulang ya.", "Retry-nya abis, gue kirim ke lo.")}`,
    (d) => `Belum lolos filter awal (${d.fails}). ${retryOrYou(d.last, "Balik ke Maul buat direvisi.", "Retry-nya abis, ini gue oper ke lo.")}`,
    (d) => `Secara rules masih ada yang kurang: ${d.fails}. ${retryOrYou(d.last, "Maul, revisi tanpa itu ya.", "Retry-nya abis, gue kirim ke lo.")}`,
  ] as Line<{ fails: string; last: boolean }>,
  rulePass: [
    (d) => `Aturan dasar aman${d.nearMiss ? " (tapi mepet batas)" : ""}, gue lanjut cek kualitas bahasanya ya.`,
    (d) => `Filter awal lolos${d.nearMiss ? ", cuma mepet batas" : ""}. Bentar, gue baca dari sudut pandang audiens.`,
    (d) => `Secara rules udah oke${d.nearMiss ? " (mepet batas)" : ""}, lanjut ke pengecekan konteks.`,
  ] as Line<{ nearMiss: boolean }>,
  borderline: [
    (d) => `Skornya cuma ${d.confidence}% nih, lumayan mepet ambang ${d.threshold}%. Gue minta second opinion dulu ya.`,
    (d) => `Confidence ${d.confidence}%, mepet ambang ${d.threshold}%. Gue ambil sampel kedua dulu.`,
  ] as Line<{ confidence: number; threshold: number }>,
  // Verdict first, then evidence, then the fix (the judge's own suggestion).
  verdict: [
    (d) => `${d.core}.${d.issues ? ` ${d.issues}` : ""}${d.fix ? ` Saran gue: ${d.fix}` : ""} ${d.decision}`,
    (d) => `${d.core}.${d.issues ? ` ${d.issues}` : ""}${d.fix ? ` Perbaikannya: ${d.fix}` : ""} ${d.decision}`,
    (d) => `${d.core}.${d.issues ? ` Masalahnya: ${d.issues}` : ""}${d.fix ? ` Saran gue: ${d.fix}` : ""} ${d.decision}`,
  ] as Line<{ core: string; issues: string; fix: string; decision: string }>,
};

export const PHRASES = { accountManager: RINA, socmedSpecialist: MAUL, postQc: SARAS };
type Phrases = typeof PHRASES;
export type Speaker = keyof Phrases;

// System rule messages are terse English; in the discussion they are said the way a colleague would.
const CASUAL: [RegExp, string][] = [
  [/^Contains an em dash$/, "jangan pake em dash"],
  [/^Trimmed to fit (.+): check the meaning$/, "teksnya kepanjangan buat $1, gue pangkas, tolong cek maknanya masih nyambung"],
  [/^Mixes "gue\/lo" with "aku\/kamu"$/, "jangan campur gue/lo sama aku/kamu"],
  [/^Banned: (.+)$/, "ada kata yang dilarang ($1)"],
  [/^Template opener: (.+)$/, "pembukanya kayak template ($1)"],
  [/^Numbers, years or quotes without a research source.*?: (.+)$/, "ada angka/tahun/kutipan tanpa sumber riset ($1), hapus atau bikin lebih umum"],
  [/^Forbidden claim: (.+)$/, "ada klaim terlarang ($1)"],
  [/^Engagement bait: (.+)$/, "ada engagement bait ($1)"],
  [/^Link that is not the brief's link: (.+)$/, "ada link di luar link brief ($1)"],
  [/^Opens like a recent post of this campaign: (.+)$/, "pembukanya mirip konten sebelumnya ($1)"],
  [/^Same structure as the last posts: .+$/, "strukturnya sama kayak konten-konten sebelumnya"],
  [/^(\d+) emoji \(max 1\)$/, "emojinya $1, maksimal 1"],
  [/^No hashtags in this type$/, "tipe ini nggak pake hashtag"],
  [/^A question post needs a question mark$/, "post pertanyaan butuh tanda tanya"],
];

/** "a; b; c" of raw system messages in colleague wording; a message with no entry passes through unchanged. */
export const casual = (list: string) =>
  list.split("; ").map((m) => CASUAL.reduce((s, [re, to]) => (re.test(s) ? s.replace(re, to) : s), m)).join("; ");

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
  // fails/avoid are raw rule messages: said like a colleague, not printed as system text.
  const x = d as { fails?: string; avoid?: string } | undefined;
  const say = x && { ...x, ...(x.fails && { fails: casual(x.fails) }), ...(x.avoid && { avoid: casual(x.avoid) }) };
  return variants[start % variants.length](say ?? d);
}
