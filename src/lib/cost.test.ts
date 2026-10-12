import { test } from "node:test";
import assert from "node:assert/strict";
import { budgetGate, estimateRegenerate, latestPrice } from "./cost";
import { DecisionInput } from "./agents/schemas";

test("latestPrice: newest effective row wins, future rows ignored, missing = 0", () => {
  const row = (unitPrice: number, d: string) => ({ provider: "byteplus", model: "m", unit: "second", unitPrice, effectiveFrom: new Date(d) });
  const rows = [row(0.1, "2026-01-01"), row(0.2, "2026-06-01"), row(0.9, "2099-01-01")];
  assert.equal(latestPrice(rows, "byteplus", "m", "second", new Date("2026-10-12")), 0.2);
  assert.equal(latestPrice(rows, "byteplus", "m", "second", new Date("2026-03-01")), 0.1);
  assert.equal(latestPrice(rows, "byteplus", "other", "second"), 0);
});

test("estimateRegenerate: API shots priced per second, manual shots free, over-cap flagged", () => {
  const shots = [{ source: "seedance_api", durationSec: 8 }, { source: "manual_upload", durationSec: 6 }, { source: "seedance_api", durationSec: 4 }];
  const e = estimateRegenerate({ shots, pricePerSec: 0.25, model: "m", spentUsd: 5, capUsd: 8 });
  assert.deepEqual(e, { n: 3, model: "m", seconds: 12, addUsd: 3, totalUsd: 8, capUsd: 8, overCap: false });
  assert.equal(estimateRegenerate({ shots, pricePerSec: 0.25, model: "m", spentUsd: 5.01, capUsd: 8 }).overCap, true);
  assert.equal(estimateRegenerate({ shots: [shots[1]], pricePerSec: 0.25, model: "m", spentUsd: 0, capUsd: 1 }).addUsd, 0);
});

test("budgetGate: blocks on campaign cap and on monthly cap", () => {
  const base = { estUsd: 4, spentUsd: 1, capUsd: 10, monthSpentUsd: 50, monthCapUsd: 100 };
  assert.equal(budgetGate(base).blocked, false);
  const c = budgetGate({ ...base, capUsd: 4 });
  assert.equal(c.blocked, true);
  assert.match(c.reasons[0], /campaign cap/);
  const m = budgetGate({ ...base, monthSpentUsd: 97 });
  assert.equal(m.blocked, true);
  assert.match(m.reasons.join(), /monthly cap/);
});

test("DecisionInput: validates each action", () => {
  assert.equal(DecisionInput.safeParse({ type: "approve" }).success, true);
  assert.equal(DecisionInput.safeParse({ type: "regenerate", shotIds: [] }).success, false);
  assert.equal(DecisionInput.safeParse({ type: "revise", notes: "  " }).success, false);
  assert.equal(DecisionInput.safeParse({ type: "revise", notes: "faster cut", targetAgent: "producer" }).success, false);
  const r = DecisionInput.parse({ type: "regenerate", shotIds: ["shot01"] });
  assert.equal(r.type === "regenerate" && r.confirmOverCap, false);
});
