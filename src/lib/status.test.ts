import { test } from "node:test";
import assert from "node:assert/strict";
import type { CampaignStatus } from "@prisma/client";
import { allowedFrom, canTransition, laneView } from "./status";

const walk = (path: CampaignStatus[]) => path.every((s, i) => i === 0 || canTransition(path[i - 1], s));

test("state machine: PRD §3.1 paths are allowed", () => {
  assert.ok(walk(["DRAFTING", "AWAITING_VIDEO_UPLOAD", "POST_PRODUCTION", "AWAITING_APPROVAL", "APPROVED", "PUBLISHING", "PUBLISHED"]));
  assert.ok(walk(["DRAFTING", "POST_PRODUCTION", "AWAITING_APPROVAL", "REVISING", "POST_PRODUCTION", "AWAITING_APPROVAL"]));
  assert.ok(walk(["AWAITING_APPROVAL", "REGENERATING", "AWAITING_VIDEO_UPLOAD", "POST_PRODUCTION", "AWAITING_APPROVAL"]));
  assert.ok(walk(["AWAITING_APPROVAL", "EXPIRED"]));
  assert.ok(walk(["AWAITING_APPROVAL", "REJECTED"]));
  assert.ok(walk(["DRAFTING", "AWAITING_BUDGET", "DRAFTING", "POST_PRODUCTION"]));
  assert.ok(walk(["REVISING", "AWAITING_BUDGET", "REJECTED"]));
  assert.ok(canTransition("POST_PRODUCTION", "POST_PRODUCTION"), "retries may re-set the same status");
});

test("state machine: invalid jumps and leaving terminal states are refused", () => {
  assert.equal(canTransition("DRAFTING", "APPROVED"), false);
  assert.equal(canTransition("REVISING", "APPROVED"), false);
  assert.equal(canTransition("REJECTED", "AWAITING_APPROVAL"), false);
  assert.equal(canTransition("EXPIRED", "FAILED"), false);
  assert.equal(canTransition("REGENERATING", "FAILED"), true);
  assert.deepEqual(allowedFrom("AWAITING_APPROVAL").sort(), ["AWAITING_APPROVAL", "POST_PRODUCTION"]);
});

const at = (min: number) => new Date(Date.UTC(2026, 9, 12, 9, min));
const row = (agentRole: string, status: string, start: number, end: number | null, error: string | null = null) => ({
  agentRole, status, attempt: 1, startedAt: at(start), endedAt: end == null ? null : at(end), error,
});
const none = { hasArtifact: false, shots: [], runFailed: false };

test("laneView: failed step shows retries and error; reused and queued lanes", () => {
  const steps = [row("creativeDirector", "failed", 0, 1, "Error: 429 quota"), row("creativeDirector", "failed", 2, 3, "Error: 429 quota")];
  const v = laneView("creativeDirector", steps, none);
  assert.deepEqual(v, { state: "failed", attempts: 2, durationMs: 60_000, error: "Error: 429 quota" });
  assert.equal(laneView("artDirector", steps, none).state, "queued");
  assert.equal(laneView("artDirector", steps, { ...none, hasArtifact: true }).state, "reused");
  assert.equal(laneView("producer", [row("producer", "running", 0, null)], { ...none, runFailed: true }).state, "failed");
  const ok = laneView("producer", [row("producer", "failed", 0, 1, "boom"), row("producer", "done", 2, 4)], none);
  assert.equal(ok.state, "done");
  assert.equal(ok.attempts, 2);
});

test("laneView: videographer from shot slots", () => {
  const v = (statuses: string[]) => laneView("videographer", [], { ...none, shots: statuses.map((status) => ({ status })) }).state;
  assert.equal(v([]), "queued");
  assert.equal(v(["ready", "ready"]), "done");
  assert.equal(v(["ready", "pending"]), "running");
  assert.equal(v(["ready", "invalid"]), "failed");
});
