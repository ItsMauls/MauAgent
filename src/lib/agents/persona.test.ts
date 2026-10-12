import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_PERSONAS, isAgentRole, personaSystem, SYSTEM_ID } from "./persona";
import { AGENT_ROLES, Persona } from "./schemas";

test("every role has a default persona that passes the schema", () => {
  assert.deepEqual(Object.keys(DEFAULT_PERSONAS).sort(), [...AGENT_ROLES].sort());
  for (const role of AGENT_ROLES) assert.ok(Persona.safeParse(DEFAULT_PERSONAS[role]).success, role);
});

test("personaSystem: agency context, persona fields and override guardrails", () => {
  const p = DEFAULT_PERSONAS.creativeDirector;
  const s = personaSystem("creativeDirector", p);
  assert.ok(s.startsWith(SYSTEM_ID));
  assert.ok(s.includes(p.nickname) && s.includes(p.communicationStyle) && s.includes(p.nonNegotiables[0]));
  assert.match(s, /match the requested schema exactly/);
  assert.match(s, /client brief, the brand kit and the budget cap always override/);
  // Empty lists render as "(none)", never as a dangling label.
  assert.match(personaSystem("producer", { ...p, blindSpots: [] }), /blind spots \(stay aware of them\): \(none\)/);
});

test("Persona rejects invalid edits", () => {
  const p = DEFAULT_PERSONAS.accountManager;
  assert.equal(Persona.safeParse({ ...p, nickname: "  " }).success, false);
  assert.equal(Persona.safeParse({ ...p, values: [] }).success, false);
  assert.equal(Persona.safeParse({ nickname: "x" }).success, false);
});

test("isAgentRole: router has no persona", () => {
  assert.ok(isAgentRole("accountTeam"));
  assert.equal(isAgentRole("router"), false);
});
