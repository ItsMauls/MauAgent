// Fictional agent profiles: config/agent-profiles.md is the source, parsed here once. Flavor for the profile modal
// only; status and seniority are computed elsewhere (agentExperience), never stored. Tested in profiles.test.ts.
import { readFileSync } from "node:fs";
import path from "node:path";

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
