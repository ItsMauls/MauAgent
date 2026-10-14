import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { NAME_TO_ROLE, parseProfiles, Voice, VOICES } from "./profiles";

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
  assert.deepEqual(maul.workExperience[0], { period: "2023–Sekarang", title: "Social Media Specialist", company: "Zalora Indonesia", description: "Menyusun strategi konten, campaign calendar, dan optimasi distribusi sosial media." });
  assert.equal(ps.find((p) => p.name === "Saras")!.group, "post_qc");
});

test("parseProfiles is idempotent: parsing twice gives the same data", () => {
  assert.deepEqual(parseProfiles(md), parseProfiles(md));
});

test("every agent has a voice card that passes the schema", () => {
  assert.deepEqual(Object.keys(VOICES).sort(), Object.values(NAME_TO_ROLE).sort());
  for (const [role, v] of Object.entries(VOICES)) assert.ok(Voice.safeParse(v).success, role);
  assert.equal(Voice.safeParse({ ...VOICES.postQc, signature: ["a", "b", "c", "d", "e"] }).success, false);
});
