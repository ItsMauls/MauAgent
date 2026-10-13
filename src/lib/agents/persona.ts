// Agent personas: defaults live in ./personas/*.json, the active version lives in AgentProfile (latest version wins).
import { db } from "@/lib/db";
import { AGENT_ROLES, Persona, type AgentRole } from "./schemas";
import accountManager from "./personas/accountManager.json";
import creativeDirector from "./personas/creativeDirector.json";
import artDirector from "./personas/artDirector.json";
import producer from "./personas/producer.json";
import videographer from "./personas/videographer.json";
import postProduction from "./personas/postProduction.json";
import accountTeam from "./personas/accountTeam.json";
import socmedSpecialist from "./personas/socmedSpecialist.json";

export const SYSTEM_ID = "You are part of a creative agency. All output in English. Vertical 9:16 video for Reels/TikTok.";

export const DEFAULT_PERSONAS: Record<AgentRole, Persona> = {
  accountManager, creativeDirector, artDirector, producer, videographer, postProduction, accountTeam, socmedSpecialist,
};

const GUARDRAILS = [
  "Your persona shapes tone and perspective only. Output must match the requested schema exactly.",
  "The client brief, the brand kit and the budget cap always override your personal preferences.",
].join("\n");

const list = (xs: string[]) => (xs.length ? xs.join("; ") : "(none)");

/** System prompt for a role: agency context + persona + guardrails. Pure, so it is unit-tested. */
export function personaSystem(role: AgentRole, p: Persona) {
  return `${SYSTEM_ID}

You are ${p.nickname}, the agency's ${role}.
Communication style: ${p.communicationStyle}
Values: ${list(p.values)}
Strengths: ${list(p.strengths)}
Known blind spots (stay aware of them): ${list(p.blindSpots)}
Questions you typically ask: ${list(p.signatureQuestions)}
Never violate: ${list(p.nonNegotiables)}

${GUARDRAILS}`;
}

export const isAgentRole = (role: string): role is AgentRole => (AGENT_ROLES as readonly string[]).includes(role);

/** Active persona: latest AgentProfile version, or the JSON default when the DB has none (or holds an invalid one). */
export async function getPersona(role: AgentRole) {
  const row = await db.agentProfile.findFirst({ where: { role }, orderBy: { version: "desc" } });
  const parsed = Persona.safeParse(row?.persona);
  return { persona: parsed.success ? parsed.data : DEFAULT_PERSONAS[role], version: parsed.success ? row!.version : 0 };
}

/** Every edit is a new version; history is never overwritten. */
export async function savePersona(role: AgentRole, input: unknown, note?: string) {
  const persona = Persona.parse(input);
  const last = await db.agentProfile.findFirst({ where: { role }, orderBy: { version: "desc" } });
  return db.agentProfile.create({ data: { role, version: (last?.version ?? 0) + 1, persona, note } });
}

/** Restore = copy an old version as the newest one. */
export async function restorePersona(role: AgentRole, version: number) {
  const old = await db.agentProfile.findUniqueOrThrow({ where: { role_version: { role, version } } });
  return savePersona(role, old.persona, `Restored from v${version}`);
}
