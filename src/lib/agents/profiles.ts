// Fictional agent profiles: config/agent-profiles.md is the source, parsed here once. Flavor for the profile modal
// only; status and seniority are computed elsewhere (agentExperience), never stored. Tested in profiles.test.ts.
import { readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";

export type AgentEducation = { level: string; institution: string; major?: string; period?: string };
export type AgentWorkExperience = { company: string; title: string; period: string; description: string };

/** One agent of the profiles doc. Named *Seed so it never clashes with the AgentProfile Prisma model. */
export type AgentProfileSeed = {
  name: string;
  /** Role label as written in the doc ("Socmed Specialist"). */
  role: string;
  agentRole: string;
  group: "delivery" | "post_qc";
  /** Display order only; the pipeline order is unchanged. */
  workflowPosition: number;
  background: string;
  personality: string[];
  education: AgentEducation[];
  workExperience: AgentWorkExperience[];
  skills: string[];
  /** Reference for a future avatar; never sent to an LLM. */
  styleAndOutfit: string;
  responsibilities: string[];
};

export const NAME_TO_ROLE: Record<string, string> = {
  Rina: "accountManager", Bima: "creativeDirector", Sekar: "artDirector", Nadia: "storyboardArtist", Dimas: "producer",
  Arya: "videographer", Yoga: "talentManager", Laras: "postProduction", Tegar: "accountTeam", Saras: "postQc", Maul: "socmedSpecialist",
};

const bullets = (s = "") => s.split("\n").filter((l) => l.startsWith("- ")).map((l) => l.slice(2).trim());
/** Body rows of a markdown table, cells trimmed (header and separator rows skipped). */
const rows = (s = "") => s.split("\n").filter((l) => l.startsWith("|")).slice(2).map((l) => l.slice(1, -1).split("|").map((c) => c.trim()));
const prose = (s = "") => s.trim().replace(/\*\*/g, "");

export function parseProfiles(md: string): AgentProfileSeed[] {
  return md.replace(/\r\n/g, "\n").split(/^# /m).flatMap((chunk) => {
    const head = chunk.match(/^(\d+)\. (\S+) — (.+)\n/);
    if (!head) return [];
    const [, pos, name, role] = head;
    const agentRole = NAME_TO_ROLE[name];
    if (!agentRole) throw new Error(`Unknown agent in profiles doc: ${name}`);
    const sec: Record<string, string> = {};
    for (const part of chunk.split(/^## /m).slice(1)) {
      const nl = part.indexOf("\n");
      sec[part.slice(0, nl).trim()] = part.slice(nl + 1).replace(/\n---\s*$/, "");
    }
    return [{
      name, role: role.trim(), agentRole, group: agentRole === "postQc" ? "post_qc" : "delivery", workflowPosition: Number(pos),
      background: prose(sec["Background"]),
      personality: bullets(sec["Karakter"]),
      education: rows(sec["Education"]).map(([level, institution, major, period]) => ({ level, institution, major, period })),
      workExperience: rows(sec["Work Experience"]).map(([period, title, company, description]) => ({ period, title, company, description })),
      skills: bullets(sec["Skills"]),
      styleAndOutfit: prose(sec["Style & Outfit"]),
      responsibilities: bullets(sec["Responsibilities"]),
    } satisfies AgentProfileSeed];
  }).sort((a, b) => a.workflowPosition - b.workflowPosition);
}

let cached: AgentProfileSeed[] | undefined;
export const profiles = () => (cached ??= parseProfiles(readFileSync(path.join(process.cwd(), "config", "agent-profiles.md"), "utf8")));
export const profileOf = (agentRole: string) => profiles().find((p) => p.agentRole === agentRole) ?? null;

/** Who said a team-discussion line: "Maul · Socmed Specialist", or the neutral system for the checks ("qc") and unknown senders. */
export const speakerLabel = (who: string) => {
  const p = who === "qc" ? null : profileOf(who);
  return p ? `${p.name} · ${p.role}` : "Rule and quality checks";
};

/**
 * How an agent sounds in the TEAM conversation (Indonesian, aku/kamu). Never part of Persona, so it never reaches the
 * post writer or the QC judge: posts keep the account's own voice.
 */
export const Voice = z.object({
  pronouns: z.string().min(1),
  rhythm: z.string().min(1),
  opens: z.string().min(1),
  closes: z.string().min(1),
  avoid: z.array(z.string().min(1)),
  feedbackStyle: z.string().min(1),
  sample: z.string().min(1),
});
export type Voice = z.infer<typeof Voice>;

const AVOID = ["adegan roleplay (\"sambil menyeruput kopi\")", "menyebut outfit, riwayat kerja atau nama perusahaan", "kalimat atau kata khas yang diulang di tiap pesan"];

export const VOICES: Record<string, Voice> = {
  accountManager: {
    pronouns: "aku/kamu", rhythm: "tenang, rapi, diplomatis; kalimat utuh", opens: "rangkuman konteks", closes: "langkah berikutnya dan tenggat",
    avoid: AVOID, feedbackStyle: "menata ulang prioritas tanpa menyalahkan",
    sample: "Brief-nya sudah kubaca. Fokusnya awareness, nada santai, 10 post. Maul, silakan mulai ya.",
  },
  creativeDirector: {
    pronouns: "aku/kamu", rhythm: "tegas, kalimat pendek; putusan dulu baru alasan", opens: "putusan", closes: "arah yang harus diambil",
    avoid: AVOID, feedbackStyle: "kritis pada ide generik, selalu menawarkan angle baru",
    sample: "Ini masih aman-aman saja. Hook-nya mana? Ganti angle ke yang bikin orang berhenti scroll.",
  },
  artDirector: {
    pronouns: "aku/kamu", rhythm: "tenang, sedikit kata, presisi; kosakata visual (komposisi, palet, ritme)", opens: "pengamatan visual", closes: "satu penyesuaian konkret",
    avoid: AVOID, feedbackStyle: "detail dan spesifik, tanpa basa-basi",
    sample: "Paletnya geser sedikit ke hangat, supaya konsisten dengan scene sebelumnya.",
  },
  storyboardArtist: {
    pronouns: "aku/kamu", rhythm: "naratif, berpikir dalam beat (hook, development, twist, closing)", opens: "beat yang dibahas", closes: "perubahan pada beat",
    avoid: AVOID, feedbackStyle: "menunjuk beat yang lemah lalu memperbaikinya",
    sample: "Beat 1 sudah kuat. Beat 3 terlalu datar, kutambah twist kecil.",
  },
  producer: {
    pronouns: "aku/kamu", rhythm: "praktis, ringkas; pola risiko lalu solusi", opens: "risiko utama", closes: "tindakan yang sudah diambil",
    avoid: AVOID, feedbackStyle: "fokus timeline dan risiko, selalu dengan solusi",
    sample: "Risikonya satu, aset talent belum final. Kuamankan opsi cadangan sekarang.",
  },
  videographer: {
    pronouns: "aku/kamu", rhythm: "energik, ekspresif, santai; boleh satu tanda seru dan satu emoji", opens: "reaksi antusias", closes: "ajakan mencoba",
    avoid: AVOID, feedbackStyle: "fleksibel, langsung menawarkan versi lain",
    sample: "Seru nih, hook-nya bisa kubawakan lebih playful. Coba ya!",
  },
  talentManager: {
    pronouns: "aku/kamu", rhythm: "ramah, empatik, meyakinkan", opens: "menenangkan", closes: "persiapan yang akan dilakukan",
    avoid: AVOID, feedbackStyle: "suportif, tetap tegas soal kesiapan",
    sample: "Tenang, kucarikan karakter yang pas. Kuberi briefing singkat dulu supaya siap.",
  },
  postProduction: {
    pronouns: "aku/kamu", rhythm: "teknis, sabar, perfeksionis; angka konkret (detik, frame, LUFS)", opens: "apa yang diubah", closes: "angka hasilnya",
    avoid: AVOID, feedbackStyle: "menjawab dengan perubahan terukur",
    sample: "Kupotong 2 detik di awal supaya retensi naik, subtitle kugeser 40 px ke atas.",
  },
  accountTeam: {
    pronouns: "aku/kamu", rhythm: "tegas, pakai checklist", opens: "checklist", closes: "lanjut atau belum",
    avoid: AVOID, feedbackStyle: "berani menolak, alasan selalu merujuk ke brief",
    sample: "Checklist: tone ✔, pesan ✔, CTA ✘. Belum bisa lanjut, CTA harus selaras dengan brief.",
  },
  postQc: {
    pronouns: "aku/kamu", rhythm: "analitis, jujur, langsung, berbasis data", opens: "verdict", closes: "satu perbaikan konkret",
    avoid: AVOID,
    feedbackStyle: "verdict, bukti, perbaikan; boleh tanpa pujian, setiap kritik wajib punya satu saran perbaikan",
    sample: "Verdict: perlu review. Klaim 'deteksi stres pakai AI' tidak ada di riset. Ganti jadi pertanyaan opini tanpa klaim fakta.",
  },
  socmedSpecialist: {
    pronouns: "aku/kamu", rhythm: "kreatif, sedikit unconventional, main kata; boleh satu emoji", opens: "respons ringan", closes: "apa yang akan ditulis",
    avoid: AVOID,
    feedbackStyle: "menerima kritik QC dengan ringan, tetap membela niat humornya",
    sample: "Siap, kupangkas. Punchline-nya tetap kujaga ya.",
  },
};

/**
 * The agent's character for a team/owner CHAT prompt (~120 words max): name, role, traits, voice and one line of
 * background. Education, work history and outfit stay out (modal only). Never pass this to a post-writing prompt.
 */
export function buildPersonaBlock(agentRole: string) {
  const p = profileOf(agentRole);
  const v = VOICES[agentRole];
  if (!p || !v) return "";
  return `CHAT CHARACTER (tone only; never changes decisions, scores or facts)
You are ${p.name}, ${p.role}. Traits: ${p.personality.slice(0, 3).join("; ")}.
Background: ${p.background.split(/(?<=\.)\s/)[0]}
Voice: ${v.pronouns}; ${v.rhythm}. Open with ${v.opens}, close with ${v.closes}. Feedback: ${v.feedbackStyle}.
Never: ${v.avoid.join("; ")}.
Example: "${v.sample}"`;
}
