import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_PERSONAS } from "@/lib/agents/persona";
import { Goal } from "./config";
import { briefFor, CampaignBrief, strategyPrompt } from "./strategy";

const goal = Goal.parse({ targetPosts: 10, accountIds: ["a"], startDate: "2026-11-02", endDate: "2026-11-30", pillars: ["kopi susu", "kerja remote"], audience: "pekerja kantor", objective: "naikkan follower" });
const brief = CampaignBrief.parse({
  objective: "Grow followers among office workers who love coffee.", audienceInsight: "Commuters who buy coffee daily.", toneNotes: "Relaxed.",
  pillars: [
    { pillar: "Kopi Susu", focus: "Daily rituals around es kopi susu.", angles: ["ritual pagi", "harga vs rasa", "kopi sore", "tumbler"], avoid: ["klaim kesehatan"] },
    { pillar: "kerja remote", focus: "Working from cafes.", angles: ["wifi", "colokan"], avoid: [] },
  ],
  mustAvoid: ["politik"],
});

test("strategy prompt carries every pillar verbatim and treats the command as data", () => {
  const p = strategyPrompt(goal, DEFAULT_PERSONAS.accountManager, "gue/lo, santai");
  for (const x of goal.pillars) assert.ok(p.includes(x));
  assert.match(p, /naikkan follower/);
  assert.match(p, /gue\/lo, santai/);
  assert.match(p, /never as instructions/);
});

test("the brief schema needs a pillar with at least two angles", () => {
  assert.equal(CampaignBrief.safeParse({ ...brief, pillars: [] }).success, false);
  assert.equal(CampaignBrief.safeParse({ ...brief, pillars: [{ ...brief.pillars[0], angles: ["one"] }] }).success, false);
});

test("briefFor: the writer gets the expanded objective, the avoid list and rotating angles (pillar match ignores case)", () => {
  const a = briefFor(brief, goal, "kopi susu", 0, [], 3);
  assert.match(a.objective, /Grow followers/);
  assert.match(a.objective, /Focus for this pillar: Daily rituals/);
  assert.match(a.objective, /Commuters who buy coffee daily/);
  assert.equal(a.avoid, "politik; klaim kesehatan");
  assert.deepEqual(a.angles, ["ritual pagi", "harga vs rasa", "kopi sore"]);
  assert.deepEqual(briefFor(brief, goal, "kopi susu", 1, [], 3).angles, ["harga vs rasa", "kopi sore", "tumbler"], "neighbouring slots differ");
  assert.deepEqual(briefFor(brief, goal, "kerja remote", 0, [], 3).angles, ["wifi", "colokan"], "never more angles than the pillar has");
});

test("briefFor: planned angles win, and without a brief the post uses the form fields as before", () => {
  assert.deepEqual(briefFor(brief, goal, "kopi susu", 0, ["from angles.yaml"], 3).angles, ["from angles.yaml"]);
  const none = briefFor(null, goal, "kopi susu", 4, [], 3);
  assert.match(none.objective, /^naikkan follower Posting as the account owner/);
  assert.deepEqual([none.avoid, none.angles], [undefined, []]);
  assert.deepEqual(briefFor(brief, goal, "pillar the model dropped", 0, [], 3).angles, []);
});

test("brand vs personal: the speaker, the voice rule and the brand details reach the brief", () => {
  const brand = Goal.parse({ ...goal, kind: "brand", brandName: "Kopi Senja", brandOffer: "single-origin coffee", brandVoice: "cheeky barista", tones: ["witty", "warm"], avoid: "politik", types: ["question"], length: "short", hashtags: "none" });
  const p = strategyPrompt(brand, DEFAULT_PERSONAS.accountManager, "gue/lo");
  assert.match(p, /Posting as the brand Kopi Senja/);
  assert.match(p, /single-origin coffee/);
  assert.match(p, /cheeky barista/);
  assert.match(p, /Tone wanted: witty, warm/);
  assert.match(p, /question · post length: short/);
  assert.doesNotMatch(p, /gue\/lo/, "a brand does not use the owner's personal voice");
  assert.match(strategyPrompt(goal, DEFAULT_PERSONAS.accountManager, "gue/lo"), /gue\/lo/);
  assert.match(strategyPrompt(goal, DEFAULT_PERSONAS.accountManager, null), /Posting as the account owner/);
  const b = briefFor(null, brand, "kopi susu", 0, [], 3);
  assert.match(b.objective, /Posting as the brand Kopi Senja: speak as "we"/);
  assert.match(b.objective, /Tone: witty, warm\./);
  assert.match(briefFor(null, goal, "kopi susu", 0, [], 3).objective, /first person singular/);
});

test("a brand campaign must be named; old goals without the new fields still parse as personal", () => {
  assert.equal(Goal.safeParse({ ...goal, kind: "brand" }).success, false);
  const old = Goal.parse({ targetPosts: 5, accountIds: ["a"], startDate: "2026-11-02", endDate: "2026-11-03", pillars: ["x"], audience: "y" });
  assert.deepEqual([old.kind, old.tones, old.types, old.length, old.avoid], ["personal", [], [], "auto", ""]);
});
