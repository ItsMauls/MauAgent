import assert from "node:assert/strict";
import { test } from "node:test";
import { WINDOWS, snapshotFrom } from "./metrics";

test("only what Buffer reports; impressions and plays are never stored", () => {
  const s = snapshotFrom({
    metrics: [
      { type: "reactions", name: "Likes", value: 12, unit: "count" },
      { type: "impressions", name: "Impressions", value: 999, unit: "count" },
      { type: "plays", name: "Plays", value: 500, unit: "count" },
    ],
    metricsUpdatedAt: "2026-10-13T00:00:00Z",
  });
  assert.deepEqual(s.items.map((m) => m.type), ["reactions"]);
  assert.equal(s.source, "buffer");
  assert.ok(!("reason" in s));
});

test("no metrics yields an empty snapshot with a reason, not an error", () => {
  for (const post of [{ metrics: null }, { metrics: [] }, {}]) {
    const s = snapshotFrom(post);
    assert.deepEqual(s.items, []);
    assert.match(s.reason!, /not reported/);
  }
});

test("three pulls: T+1h, T+24h, T+7d", () => {
  assert.deepEqual(WINDOWS.map((w) => w[0]), ["1h", "24h", "7d"]);
});
