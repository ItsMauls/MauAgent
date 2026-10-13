import assert from "node:assert/strict";
import { test } from "node:test";
import { connectionProblem } from "./connections";

const a = (over: object) => ({ publisher: "buffer", active: true, status: "connected" as const, ...over });

test("sidebar indicator", () => {
  assert.equal(connectionProblem([a({})], { ok: true }), false);
  assert.equal(connectionProblem([a({ status: "needs_reauth" })]), true);
  assert.equal(connectionProblem([a({ status: "needs_reauth", active: false })]), false);
  assert.equal(connectionProblem([a({ status: "missing", active: false })]), false);
  assert.equal(connectionProblem([], { ok: false }), true);
  assert.equal(connectionProblem([a({ publisher: "orshot", status: "disabled" })]), false);
});

import { readFileSync } from "node:fs";
import { ACCOUNT_PUBLIC_SELECT } from "./accounts";

test("opening Connections never reaches Buffer or leaks secrets", () => {
  // Render-path files read the database only; Buffer is called by the sync button, the test button and cron.
  for (const f of ["page.tsx", "channels.tsx"]) {
    const src = readFileSync(new URL(`../app/connections/${f}`, import.meta.url), "utf8");
    assert.ok(!/providers\/buffer|bufferAccounts|fetch\(/.test(src), `${f} must not call Buffer`);
    assert.ok(!/process\.env\.BUFFER_API_KEY(?!\s*\))/.test(src.replace(/!!process\.env\.BUFFER_API_KEY/g, "")), `${f} must not read the key value`);
  }
  assert.ok(!Object.keys(ACCOUNT_PUBLIC_SELECT).some((k) => /Enc$/.test(k)), "token columns are never selected");
});
