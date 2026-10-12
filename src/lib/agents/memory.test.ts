import { test } from "node:test";
import assert from "node:assert/strict";
import { briefTags, buildEpisodes, estTokens, experience, memoryLine, redact, sanitizeMemory, selectMemories, seniority } from "./memory";
import type { ClientBrief } from "./schemas";

test("redact: secrets and personal data never survive", () => {
  const secrets = [
    "sk-proj-abcdEFGH1234567890abcdEFGH",
    "sk_live_51HxYzABCDEFGHIJKLMNOP",
    "AKIAIOSFODNN7EXAMPLE",
    "AIzaSyA1234567890abcdefghijklmnopqrstu",
    "ghp_abcdefghijklmnopqrstuvwxyz0123456789",
    "xoxb-123456-abcdef",
    "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abc123def",
    "budi.santoso@example.co.id",
    "+62 812-3456-7890",
    "081234567890",
    "4111 1111 1111 1111",
    "3201234567890001", // Indonesian NIK
    "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8", // opaque token
  ];
  for (const s of secrets) {
    const out = redact(`Client said ${s} in the notes.`);
    assert.ok(!out.includes(s), `leaked: ${s} → ${out}`);
    assert.match(out, /\[redacted\]/);
  }
  assert.equal(redact("password: hunter2 and api_key=abc"), "password=[redacted] and api_key=[redacted]");
  assert.equal(redact("Bearer abc.def-ghi"), "Bearer [redacted]");
  assert.equal(redact("postgres://user:pass@host/db"), "postgres://[redacted]@host/db");
  assert.equal(
    redact("-----BEGIN RSA PRIVATE KEY-----\nMIIE\n-----END RSA PRIVATE KEY-----"),
    "[redacted]",
  );
});

test("redact: ordinary campaign text is untouched", () => {
  const ok = 'Kopi Susu Aren for students on instagram/tiktok. 4 shots, 28s total; estimate US$12.50; deadline 2026-10-12. Hook: "Still sleepy at 7am?"';
  assert.equal(redact(ok), ok);
});

const brief: ClientBrief = {
  objective: "Increase awareness of the new iced coffee",
  product: "Kopi Susu Aren",
  audience: "University students in Jakarta",
  kpi: "",
  platforms: ["instagram", "tiktok"],
  budgetCapUsd: 20,
  startDate: "",
  deadline: "",
  brandKitId: null,
  references: [],
  defaultSource: "manual_upload",
};

test("briefTags: platforms + content words, no stopwords or short words", () => {
  const t = briefTags(brief);
  assert.deepEqual(t.slice(0, 2), ["platform:instagram", "platform:tiktok"]);
  assert.ok(t.includes("kopi") && t.includes("students") && t.includes("jakarta"));
  assert.ok(!t.includes("the") && !t.includes("of") && !t.includes("new"));
});

const day = 864e5;
const now = new Date("2026-10-12");
const mem = (id: string, o: Partial<Parameters<typeof selectMemories>[0][number]> = {}) => ({
  id,
  layer: "episodic" as const,
  content: `memory ${id}`,
  tags: [] as string[],
  confidence: 0,
  pinned: false,
  archivedAt: null as Date | null,
  updatedAt: now,
  ...o,
});

test("selectMemories: procedural first, archived never, relevance and pins rank the rest", () => {
  const picked = selectMemories(
    [
      mem("old", { updatedAt: new Date(now.getTime() - 400 * day) }),
      mem("relevant", { tags: ["kopi", "platform:tiktok"] }),
      mem("archived", { tags: ["kopi"], archivedAt: now }),
      mem("pinned", { pinned: true }),
      mem("rule", { layer: "procedural", confidence: 0.9 }),
    ],
    ["kopi", "platform:tiktok"],
    1000,
    now,
  ).map((m) => m.id);
  assert.deepEqual(picked, ["rule", "pinned", "relevant", "old"]);
});

test("selectMemories: total stays within the token budget", () => {
  const mems = Array.from({ length: 50 }, (_, i) => mem(`m${i}`, { content: "x".repeat(200) }));
  for (const budget of [0, 60, 200, 777]) {
    const picked = selectMemories(mems, [], budget, now);
    const used = picked.reduce((s, m) => s + estTokens(memoryLine(m)), 0);
    assert.ok(used <= budget, `budget ${budget}, used ${used}`);
    assert.ok(budget < 60 || picked.length > 0);
  }
});

test("buildEpisodes: one per role with an artifact, linked to it, with the client outcome", () => {
  const creative = {
    bigIdea: "Morning rescue",
    conceptOptions: [
      { title: "Alarm Clash", logline: "l", whyItWorks: "w", hook: "Still sleepy at 7am?" },
      { title: "Campus Run", logline: "l", whyItWorks: "w", hook: "h2" },
      { title: "Study Buddy", logline: "l", whyItWorks: "w", hook: "h3" },
    ],
    chosenConcept: "Alarm Clash, because it is relatable",
    keyMessage: "Wake up with aren",
    cta: "Order now",
  };
  const eps = buildEpisodes({
    brief,
    artifacts: { creativeDirector: { id: "art_cd", payload: creative }, producer: { id: "art_p", payload: { broken: true } } },
    decisions: [
      { type: "revise", targetAgent: "creativeDirector", notes: "Make the hook funnier, call me at 081234567890" },
      { type: "regenerate", targetAgent: null, notes: null },
      { type: "approve", targetAgent: null, notes: null },
    ],
    shots: [{ source: "manual_upload", versions: 2 }, { source: "manual_upload", versions: 1 }],
  });
  assert.deepEqual(eps.map((e) => e.role), ["creativeDirector", "videographer"]); // invalid producer payload is skipped
  const cd = eps[0];
  assert.deepEqual(cd.sourceArtifactIds, ["art_cd"]);
  assert.match(cd.content, /Chose "Alarm Clash" over "Campus Run", "Study Buddy"/);
  assert.match(cd.content, /Approved after 1 client revision/);
  assert.match(eps[1].content, /3 takes in total.*Approved after 1 client revision/);
  assert.ok(cd.tags.includes("platform:instagram"));
  // What writeMemory stores: the phone number in the client note is gone, the size is capped.
  const stored = sanitizeMemory({ ...cd, layer: "episodic", tags: [...cd.tags, "me@x.com"], content: cd.content + "y".repeat(2000) });
  assert.ok(!stored.content.includes("081234567890") && !stored.tags.includes("me@x.com"));
  assert.ok(stored.content.length <= 600);
});

test("seniority + experience: deterministic from counts", () => {
  assert.equal(seniority(0, 0), "Junior");
  assert.equal(seniority(10, 0.5), "Mid");
  assert.equal(seniority(50, 0.6), "Mid"); // volume without quality stays Mid
  assert.equal(seniority(30, 0.7), "Senior");
  assert.equal(seniority(80, 0.85), "Lead");
  const rows = [
    { status: "APPROVED", roles: ["creativeDirector"], revisedRoles: [] },
    { status: "APPROVED", roles: ["creativeDirector"], revisedRoles: ["creativeDirector"] },
    { status: "PUBLISHED", roles: ["creativeDirector"], revisedRoles: ["artDirector"] },
    { status: "REJECTED", roles: ["creativeDirector"], revisedRoles: [] },
    { status: "APPROVED", roles: ["artDirector"], revisedRoles: [] },
  ];
  assert.deepEqual(experience("creativeDirector", rows), {
    campaigns: 4, delivered: 3, published: 1, firstPassRate: 2 / 3, level: "Junior",
  });
});
