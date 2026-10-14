import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildPersonaBlock, NAME_TO_ROLE, parseProfiles, profiles, Voice, VOICES } from "./profiles";

const md = readFileSync("config/agent-profiles.md", "utf8");

test("parseProfiles: 11 agents in workflow order, mapped to existing role keys", () => {
  const ps = parseProfiles(md);
  assert.deepEqual(ps.map((p) => p.name), ["Rina", "Bima", "Sekar", "Nadia", "Dimas", "Arya", "Yoga", "Laras", "Tegar", "Saras", "Maul"]);
  assert.deepEqual(ps.map((p) => p.workflowPosition), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  for (const p of ps) {
    assert.equal(p.agentRole, NAME_TO_ROLE[p.name]);
    assert.ok(p.background && p.styleAndOutfit, p.name);
    assert.ok(p.personality.length >= 3 && p.skills.length && p.responsibilities.length, p.name);
    assert.ok(p.education.length && p.workExperience.length, p.name);
  }
  const maul = ps.at(-1)!;
  assert.equal(maul.role, "Socmed Specialist");
  assert.deepEqual(maul.workExperience[0], { period: "2023–Present", title: "Social Media Specialist", company: "Zalora Indonesia", description: "Builds content strategy, campaign calendars and social media distribution optimization." });
  assert.equal(ps.find((p) => p.name === "Saras")!.group, "post_qc");
});

test("parseProfiles is idempotent: parsing twice gives the same data", () => {
  assert.deepEqual(parseProfiles(md), parseProfiles(md));
});

test("every agent has a voice card that passes the schema", () => {
  assert.deepEqual(Object.keys(VOICES).sort(), Object.values(NAME_TO_ROLE).sort());
  for (const [role, v] of Object.entries(VOICES)) assert.ok(Voice.safeParse(v).success, role);
  assert.ok(!("signature" in VOICES.postQc), "no catchphrases");
});

test("buildPersonaBlock: short, names the agent, never education, work history or outfit", () => {
  for (const p of profiles()) {
    const b = buildPersonaBlock(p.agentRole);
    assert.ok(b.split(/\s+/).length <= 120, `${p.name}: ${b.split(/\s+/).length} words`);
    assert.ok(b.includes(`You are ${p.name}, ${p.role}.`), p.name);
    for (const e of p.education) assert.ok(!b.includes(e.institution), `${p.name} leaks ${e.institution}`);
    for (const w of p.workExperience) assert.ok(!b.includes(w.company), `${p.name} leaks ${w.company}`);
    assert.ok(!b.includes(p.styleAndOutfit.slice(0, 30)), p.name);
  }
  assert.equal(buildPersonaBlock("router"), "");
});

test("buildPersonaBlock snapshot (Maul)", () => {
  assert.equal(buildPersonaBlock("socmedSpecialist"), `CHAT CHARACTER (tone only; never changes decisions, scores or facts)
You are Maul, Socmed Specialist. Traits: Creative and expressive; Trend-aware and quick to respond to culture shifts; Slightly unconventional.
Background: Maul has an art and digital culture background.
Voice: gue/lo; creative, slightly unconventional, plays with words; may use one emoji. Open with a light response, close with what will be written. Feedback: takes QC criticism lightly, still defends the intent of the humor.
Never: roleplay scenes ("sipping coffee"); mentioning outfit, work history or company names; a signature phrase repeated in every message.
Example: "Siap, gue pangkas. Punchline-nya tetap gue jaga ya."`);
});
