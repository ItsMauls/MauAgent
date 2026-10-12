import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { reasoningParams } from "./effort";
import { withFailover } from "./failover";
import { AiHttpError } from "./client";
import { capCheck, extractJson, generateStructured, type Deps, type LedgerEntry } from "./generate";
import { mergeAiConfig, type AiSettingsRow, type ModelMeta } from "./settings";
import { aiEnv, keyStatus } from "./env";

// nvidia/nemotron-3-super-120b-a12b:free metadata from OpenRouter /models (12 Oct 2026).
const NEMOTRON = { mandatory: false, supported_efforts: ["medium", "low"] };

// ---------- effort ----------

test("effort: maps each setting to the reasoning field", () => {
  assert.deepEqual(reasoningParams("off", NEMOTRON), { reasoning: { enabled: false } });
  assert.deepEqual(reasoningParams("low", NEMOTRON), { reasoning: { effort: "low" } });
  assert.deepEqual(reasoningParams("medium", NEMOTRON), { reasoning: { effort: "medium" } });
  // high is not supported by this model: clamp to the closest lower level.
  assert.deepEqual(reasoningParams("high", NEMOTRON), { reasoning: { effort: "medium" } });
});

test("effort: non-reasoning, mandatory and budget-only models", () => {
  assert.deepEqual(reasoningParams("high", undefined), {});
  assert.deepEqual(reasoningParams("off", { mandatory: true, supported_efforts: ["low", "medium"] }), { reasoning: { effort: "low" } });
  assert.deepEqual(reasoningParams("high", { supported_efforts: [] }), { reasoning: { effort: "high" } });
});

// ---------- failover ----------

const noSleep = async () => {};

test("failover: 429/5xx/401 on the primary key → fallback key, labelled", async () => {
  for (const status of [429, 500, 503, 401, 402]) {
    const used: string[] = [];
    const r = await withFailover({ primary: "P", fallback: "F" }, async (k) => {
      used.push(k);
      if (k === "P") throw new AiHttpError(status, "nope");
      return "ok";
    }, { sleep: noSleep });
    assert.equal(r.keyLabel, "fallback");
    assert.equal(used.at(-1), "F");
  }
});

test("failover: a validation 4xx never fails over and is not retried", async () => {
  let calls = 0;
  await assert.rejects(
    withFailover({ primary: "P", fallback: "F" }, async () => {
      calls++;
      throw new AiHttpError(400, "bad request");
    }, { sleep: noSleep }),
    /HTTP 400/,
  );
  assert.equal(calls, 1);
});

test("failover: limited retries, no fallback configured → error", async () => {
  let calls = 0;
  await assert.rejects(withFailover({ primary: "P" }, async () => {
    calls++;
    throw new AiHttpError(429, "slow down");
  }, { sleep: noSleep, retries: 2 }));
  assert.equal(calls, 3); // 1 + 2 retries, then stop
});

// ---------- settings merge ----------

const SETTINGS = {
  id: "default", brandKitId: null, defaultModel: null, reasoningEffort: "low", maxOutputTokens: 4096, temperature: 0.7,
  perAgentOverrides: { creativeDirector: { reasoningEffort: "high", model: "big/model" }, router: { reasoningEffort: "off", maxOutputTokens: 300 } },
  monthlyBudgetUsd: 40, maxCostPerCallUsd: 0.5, monthlyTokenCap: 1_000_000, enableFallbackKey: true,
} as unknown as AiSettingsRow;

test("settings: per-agent override beats global, global beats env", () => {
  const cd = mergeAiConfig("creativeDirector", "env/model", SETTINGS);
  assert.equal(cd.model, "big/model");
  assert.equal(cd.reasoningEffort, "high");
  const router = mergeAiConfig("router", "env/model", SETTINGS);
  assert.equal(router.model, "env/model");
  assert.equal(router.reasoningEffort, "off");
  assert.equal(router.maxOutputTokens, 300);
  const am = mergeAiConfig("accountManager", "env/model", { ...SETTINGS, defaultModel: "db/model" });
  assert.equal(am.model, "db/model");
  assert.equal(am.reasoningEffort, "low");
});

// ---------- generateStructured (mock fetch + in-memory ledger) ----------

const ENV = { AI_API_KEY: "sk-or-v1-PRIMARYSECRET", AI_API_KEY_FALLBACK: "sk-or-v1-FALLBACKSECRET", AI_BASE_URL: "https://openrouter.ai/api/v1", AI_MODEL: "nvidia/nemotron-3-super-120b-a12b:free" };
const META: ModelMeta = { promptUsdPerToken: 0, completionUsdPerToken: 0, reasoning: NEMOTRON, supportsJsonSchema: true };

function harness(replies: (body: Record<string, unknown>, auth: string) => Response, o: { settings?: Partial<AiSettingsRow>; month?: { usd: number; tokens: number }; meta?: ModelMeta } = {}) {
  const rows: LedgerEntry[] = [];
  const bodies: Record<string, unknown>[] = [];
  const auths: string[] = [];
  const deps: Deps = {
    env: ENV,
    settings: async () => ({ ...SETTINGS, ...o.settings }) as AiSettingsRow,
    meta: async () => o.meta ?? META,
    sleep: noSleep,
    fetch: (async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      const auth = (init.headers as Record<string, string>).Authorization;
      bodies.push(body);
      auths.push(auth);
      return replies(body, auth);
    }) as unknown as typeof fetch,
    ledger: {
      prior: async (k) => {
        const mine = rows.filter((r) => r.idemKey.startsWith(`${k}:c`));
        return { output: mine.find((r) => r.output !== null)?.output ?? null, calls: mine.length, usd: mine.reduce((a, r) => a + r.usd, 0) };
      },
      month: async () => o.month ?? { usd: 0, tokens: 0 },
      record: async (e) => void rows.push(e),
    },
  };
  return { deps, rows, bodies, auths };
}

const ok = (content: string, usage = { prompt_tokens: 100, completion_tokens: 20, completion_tokens_details: { reasoning_tokens: 5 }, cost: 0 }) =>
  new Response(JSON.stringify({ model: ENV.AI_MODEL, choices: [{ message: { content } }], usage }), { status: 200 });
const Out = z.object({ target: z.enum(["creativeDirector", "artDirector"]) });

test("generate: effort setting changes the request; per-agent override wins", async () => {
  const h = harness(() => ok('{"target":"artDirector"}'));
  await generateStructured("router", "note", Out, { deps: h.deps });
  await generateStructured("accountManager", "note", Out, { deps: h.deps });
  await generateStructured("creativeDirector", "note", Out, { deps: h.deps });
  assert.deepEqual(h.bodies[0].reasoning, { enabled: false }); // router override: off
  assert.deepEqual(h.bodies[1].reasoning, { effort: "low" }); // global
  assert.deepEqual(h.bodies[2].reasoning, { effort: "medium" }); // CD override high, clamped for Nemotron
  assert.equal(h.bodies[0].max_tokens, 300);
  assert.equal(h.bodies[2].model, "big/model");
  assert.equal((h.bodies[1].response_format as { type: string }).type, "json_schema");
});

test("generate: every call is written to the ledger with tokens; free model = US$0", async () => {
  const h = harness(() => ok('{"target":"artDirector"}'));
  const r = await generateStructured("accountManager", "x", Out, { deps: h.deps, idemKey: "run1:accountManager", campaignId: "c1" });
  assert.equal(r.payload.target, "artDirector");
  assert.equal(h.rows.length, 1);
  assert.deepEqual(
    { k: h.rows[0].idemKey, usd: h.rows[0].usd, tin: h.rows[0].tokensIn, tout: h.rows[0].tokensOut, tr: h.rows[0].tokensReasoning, key: h.rows[0].keyLabel, c: h.rows[0].campaignId },
    { k: "run1:accountManager:c1", usd: 0, tin: 100, tout: 20, tr: 5, key: "primary", c: "c1" },
  );
});

test("generate: retry of the same step reuses the validated result (no second paid call)", async () => {
  const h = harness(() => ok('{"target":"artDirector"}', { prompt_tokens: 10, completion_tokens: 10, completion_tokens_details: { reasoning_tokens: 0 }, cost: 0.002 }));
  await generateStructured("accountManager", "x", Out, { deps: h.deps, idemKey: "run1:am" });
  const again = await generateStructured("accountManager", "x", Out, { deps: h.deps, idemKey: "run1:am" });
  assert.equal(h.bodies.length, 1);
  assert.equal(again.cached, true);
  assert.equal(again.costUsd, 0.002);
});

test("generate: invalid JSON gets one repair round, then fails clearly", async () => {
  let n = 0;
  const h = harness(() => ok(n++ === 0 ? '```json\n{"target":"nope"}\n```' : '{"target":"creativeDirector"}'));
  const r = await generateStructured("accountManager", "x", Out, { deps: h.deps });
  assert.equal(r.payload.target, "creativeDirector");
  assert.equal(h.rows.length, 2); // both calls recorded
  assert.match(String((h.bodies[1].messages as { content: string }[]).at(-1)?.content), /failed validation/);

  const bad = harness(() => ok("not json"));
  await assert.rejects(generateStructured("accountManager", "x", Out, { deps: bad.deps }), /failed validation after one repair/);
  assert.equal(bad.bodies.length, 2);
});

test("generate: primary 429 → fallback key used and recorded; 400 → no fallback", async () => {
  const h = harness((_b, auth) => (auth.includes("PRIMARY") ? new Response('{"error":{"message":"rate limited"}}', { status: 429 }) : ok('{"target":"artDirector"}')));
  const r = await generateStructured("accountManager", "x", Out, { deps: h.deps });
  assert.equal(r.keyLabel, "fallback");
  assert.equal(h.rows[0].keyLabel, "fallback");

  const off = harness((_b, auth) => (auth.includes("PRIMARY") ? new Response("{}", { status: 429 }) : ok('{"target":"artDirector"}')), { settings: { enableFallbackKey: false } });
  await assert.rejects(generateStructured("accountManager", "x", Out, { deps: off.deps }), /HTTP 429/);

  const v = harness(() => new Response('{"error":{"message":"invalid schema"}}', { status: 400 }));
  await assert.rejects(generateStructured("accountManager", "x", Out, { deps: v.deps }), /HTTP 400/);
  assert.ok(v.auths.every((a) => a.includes("PRIMARY")));
});

test("generate: caps reject the call before any request", async () => {
  const budget = harness(() => ok("{}"), { month: { usd: 40, tokens: 0 }, meta: { ...META, completionUsdPerToken: 0.000001 } });
  await assert.rejects(generateStructured("accountManager", "x", Out, { deps: budget.deps }), /monthly budget/);
  const tokens = harness(() => ok("{}"), { month: { usd: 0, tokens: 1_000_000 } });
  await assert.rejects(generateStructured("accountManager", "x", Out, { deps: tokens.deps }), /token cap/);
  const perCall = harness(() => ok("{}"), { meta: { ...META, completionUsdPerToken: 0.001 } }); // 4096 × 0.001 = US$4.10 > 0.50
  await assert.rejects(generateStructured("accountManager", "x", Out, { deps: perCall.deps }), /per-call cap/);
  assert.equal(budget.bodies.length + tokens.bodies.length + perCall.bodies.length, 0);
});

test("generate: keys never appear in errors or ledger rows", async () => {
  const h = harness(() => new Response('{"error":{"message":"invalid"}}', { status: 401 }));
  const err = await generateStructured("accountManager", "x", Out, { deps: h.deps }).catch((e) => e as Error);
  assert.ok(err instanceof Error);
  assert.ok(!err.message.includes("SECRET"));
  assert.ok(!JSON.stringify(h.rows).includes("SECRET"));
});

test("capCheck and extractJson", () => {
  const s = { monthlyBudgetUsd: 10, maxCostPerCallUsd: 1, monthlyTokenCap: 100 } as unknown as Pick<AiSettingsRow, "monthlyBudgetUsd" | "maxCostPerCallUsd" | "monthlyTokenCap">;
  assert.equal(capCheck({ monthUsd: 1, monthTokens: 1, estUsd: 0.1, settings: s }), null);
  assert.match(String(capCheck({ monthUsd: 9.95, monthTokens: 1, estUsd: 0.1, settings: s })), /monthly budget/);
  assert.deepEqual(extractJson('Sure! {"a":1} done'), { a: 1 });
});

test("env: clear errors without values, booleans only for the UI", () => {
  assert.throws(() => aiEnv({}), /Set AI_API_KEY/);
  assert.equal(aiEnv({ ...ENV, AI_BASE_URL: "https://x.test/api/v1/" }).AI_BASE_URL, "https://x.test/api/v1");
  const s = keyStatus(ENV);
  assert.deepEqual(s, { aiPrimary: true, aiFallback: true, aiModel: ENV.AI_MODEL, apify: false });
  assert.ok(!JSON.stringify(s).includes("SECRET"));
});
