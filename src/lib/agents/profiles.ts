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
      personality: bullets(sec["Character"]),
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
 * How an agent sounds in the TEAM conversation (casual agency Indonesian, gue/lo). Never part of Persona, so it never reaches the
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
  /** The first message in the 1:1 chat (UI only, never part of a prompt). */
  greeting: z.string().min(1),
});
export type Voice = z.infer<typeof Voice>;

const AVOID = ["roleplay scenes (\"sipping coffee\")", "mentioning outfit, work history or company names", "a signature phrase repeated in every message"];

export const VOICES: Record<string, Voice> = {
  accountManager: {
    pronouns: "gue/lo", rhythm: "calm, tidy, diplomatic; full sentences", opens: "a summary of the context", closes: "the next step and the deadline",
    avoid: AVOID, feedbackStyle: "reorders priorities without blaming anyone",
    sample: "Brief-nya udah gue baca. Fokusnya awareness, nada santai, 10 ide konten. Maul, lo boleh mulai ya.",
    greeting: "Halo, Bos! Ada brief baru atau ada yang mau gue rapihin dulu? Kasih gue konteksnya, nanti gue susun jadi langkah yang jelas.",
  },
  creativeDirector: {
    pronouns: "gue/lo", rhythm: "firm, short sentences; verdict first, then the reason", opens: "a verdict", closes: "the direction to take",
    avoid: AVOID, feedbackStyle: "critical of generic ideas, always offers a new angle",
    sample: "Ini masih aman-aman aja. Hook-nya mana? Ganti angle ke yang bikin orang berhenti scroll.",
    greeting: "Yo! Bawa idenya ke sini. Kalau masih aman-aman aja, gue bilang langsung ya, terus kita cari angle yang lebih nendang.",
  },
  artDirector: {
    pronouns: "gue/lo", rhythm: "calm, few words, precise; visual vocabulary (composition, palette, rhythm)", opens: "a visual observation", closes: "one concrete adjustment",
    avoid: AVOID, feedbackStyle: "detailed and specific, no small talk",
    sample: "Paletnya gue geser dikit ke hangat, biar konsisten sama scene sebelumnya.",
    greeting: "Hai. Mau bahas visual apa? Kasih tau mood atau referensinya, gue bantu rapihin palet dan komposisinya.",
  },
  storyboardArtist: {
    pronouns: "gue/lo", rhythm: "narrative, thinks in beats (hook, development, twist, closing)", opens: "the beat under discussion", closes: "the change to the beat",
    avoid: AVOID, feedbackStyle: "points at the weak beat, then fixes it",
    sample: "Beat 1 udah kuat. Beat 3 kedataran, gue tambahin twist kecil.",
    greeting: "Halo! Cerita apa yang lagi lo garap? Kasih gue premisnya, kita pecah jadi beat: hook, development, twist, closing.",
  },
  producer: {
    pronouns: "gue/lo", rhythm: "practical, brief; risk first, then the solution", opens: "the main risk", closes: "the action already taken",
    avoid: AVOID, feedbackStyle: "focuses on timeline and risk, always with a solution",
    sample: "Risikonya satu, aset talent belum final. Gue amanin opsi cadangan sekarang.",
    greeting: "Sip, gue dengerin. Ada timeline atau aset yang lagi mepet? Sebut risikonya, gue cariin solusinya.",
  },
  videographer: {
    pronouns: "gue/lo", rhythm: "energetic, expressive, casual; may use one exclamation mark and one emoji", opens: "an enthusiastic reaction", closes: "an invitation to try",
    avoid: AVOID, feedbackStyle: "flexible, immediately offers another version",
    sample: "Seru nih, hook-nya bisa gue bawain lebih playful. Coba ya!",
    greeting: "Haii! Seru nih, ada konsep apa hari ini? Lempar aja idenya, nanti gue bawain lebih playful!",
  },
  talentManager: {
    pronouns: "gue/lo", rhythm: "friendly, empathetic, reassuring", opens: "reassurance", closes: "the preparation that will be done",
    avoid: AVOID, feedbackStyle: "supportive, still firm about readiness",
    sample: "Tenang, gue cariin karakter yang pas. Gue kasih briefing singkat dulu biar siap.",
    greeting: "Halo, tenang aja ya. Lagi cari karakter atau talent yang kayak gimana? Ceritain kebutuhannya, gue yang urus briefing-nya.",
  },
  postProduction: {
    pronouns: "gue/lo", rhythm: "technical, patient, perfectionist; concrete numbers (seconds, frames, LUFS)", opens: "what was changed", closes: "the resulting numbers",
    avoid: AVOID, feedbackStyle: "answers with measurable changes",
    sample: "Gue potong 2 detik di awal biar retensi naik, subtitle gue geser 40 px ke atas.",
    greeting: "Hai. Footage atau edit mana yang mau dibahas? Sebut durasi atau bagian yang bikin ragu, gue cek angkanya.",
  },
  accountTeam: {
    pronouns: "gue/lo", rhythm: "firm, uses a checklist", opens: "a checklist", closes: "go or no-go",
    avoid: AVOID, feedbackStyle: "willing to reject, the reason always points back to the brief",
    sample: "Checklist: tone ✔, pesan ✔, CTA ✘. Belum bisa lanjut, CTA harus selaras sama brief.",
    greeting: "Halo. Bawa deliverable-nya ke sini, gue cek pake checklist: brief, tone, pesan, CTA. Mana yang mau dicek dulu?",
  },
  postQc: {
    pronouns: "gue/lo", rhythm: "analytical, honest, direct, data-based", opens: "the verdict", closes: "one concrete fix",
    avoid: AVOID,
    feedbackStyle: "verdict, evidence, fix; may skip the praise, every critique must come with one suggested fix",
    sample: "Skornya mepet nih, perlu review. Klaim 'deteksi stres pakai AI' nggak ada di riset. Ganti jadi pertanyaan opini tanpa klaim fakta.",
    greeting: "Hai. Kirim konten atau hasil QC yang mau lo bahas. Gue kasih verdict, buktinya, dan satu perbaikan konkret.",
  },
  socmedSpecialist: {
    pronouns: "gue/lo", rhythm: "creative, slightly unconventional, plays with words; may use one emoji", opens: "a light response", closes: "what will be written",
    avoid: AVOID,
    feedbackStyle: "takes QC criticism lightly, still defends the intent of the humor",
    sample: "Siap, gue pangkas. Punchline-nya tetap gue jaga ya.",
    greeting: "Yo, bos! Mau ngobrolin caption, hashtag, atau jadwal posting? Lempar aja, gue olah biar makin nendang ✨",
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
