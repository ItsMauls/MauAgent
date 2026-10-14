import { test } from "node:test";
import assert from "node:assert/strict";
import { CHAINS, FEATURE_OF, FLOWS, flowInputs, taskHref, type FlowSlug } from "./flows";
import { roleBySlug } from "./roles";
import { TASKS } from "./tasks";

const s = { defaultVideoSource: "manual_upload" as const };

test("every flow step builds an input its role's task accepts", () => {
  for (const slug of Object.keys(FLOWS) as FlowSlug[]) {
    for (const st of flowInputs(slug, "pick1", s)) {
      assert.equal(roleBySlug(st.slug)?.agentRole, st.agentRole, `${slug}: ${st.slug} maps to its agent`);
      assert.ok(TASKS[st.agentRole].input.parse(st.input), `${slug}: ${st.agentRole} input`);
    }
  }
});

test("each chain hands the previous output to its roles through their first input field", () => {
  for (const [key, chain] of Object.entries(CHAINS)) {
    const steps = chain("art1", s);
    assert.ok(steps.length > 0, key);
    for (const st of steps) {
      assert.ok(TASKS[st.agentRole].input.parse(st.input), `${key}: ${st.agentRole}`);
      // chainNext guards on this field, so a replay never starts a role twice.
      assert.equal(Object.values(st.input)[0], "art1", `${key}: ${st.agentRole} first field`);
    }
  }
  assert.deepEqual(CHAINS["production-pack"]("vd1", s).map((st) => st.agentRole), ["storyboardArtist", "producer", "videographer"]);
});

test("every role with a direct task has a feature to start it from", () => {
  for (const role of Object.keys(TASKS)) assert.ok(FEATURE_OF[role], role);
  assert.equal(taskHref("socmedSpecialist", "t1"), "/boards/feature/text-posts?task=t1");
});
