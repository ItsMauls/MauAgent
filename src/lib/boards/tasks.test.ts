import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { budgetGate } from "../cost";
import { refIds, storyboard, taskFlow, TASKS, type FlowDeps, type StepLike } from "./tasks";

/** Inngest-like step: a finished step is memoized across re-executions; a failing step is retried up to 3 times. */
function fakeStep(memo = new Map<string, unknown>()): StepLike & { memo: Map<string, unknown> } {
  return {
    memo,
    run: async <T,>(id: string, fn: () => Promise<T>) => {
      if (memo.has(id)) return memo.get(id) as T;
      let last: unknown;
      for (let i = 0; i < 3; i++) {
        try {
          const v = await fn();
          memo.set(id, v);
          return v;
        } catch (e) {
          last = e;
        }
      }
      throw last;
    },
  };
}

function deps(o: { saveFailures?: number; blocked?: string | null; confirmed?: boolean } = {}) {
  const calls = { execute: 0, artifacts: 0, failed: [] as string[] };
  let saveFailures = o.saveFailures ?? 0;
  let saved = false;
  const d: FlowDeps = {
    start: async () => ({ role: "creativeDirector", input: { idea: "x" }, confirmedOverCap: o.confirmed ?? false, estUsd: 0.01 }),
    gate: async () => o.blocked ?? null,
    execute: async () => {
      calls.execute++;
      return { payload: { bigIdea: "y" }, costUsd: 0.01 };
    },
    save: async () => {
      if (saveFailures-- > 0) throw new Error("injected: DB down");
      if (saved) return; // the artifactId guard
      saved = true;
      calls.artifacts++;
    },
    fail: async (m) => void calls.failed.push(m),
  };
  return { d, calls };
}

test("taskFlow: a failure after the LLM call never calls (or bills) it again", async () => {
  const { d, calls } = deps({ saveFailures: 2 });
  await taskFlow(fakeStep(), d);
  assert.equal(calls.execute, 1);
  assert.equal(calls.artifacts, 1);
  assert.deepEqual(calls.failed, []);
});

test("taskFlow: replaying the whole function reuses memoized steps", async () => {
  const step = fakeStep();
  const first = deps();
  await taskFlow(step, first.d);
  const second = deps();
  await taskFlow(step, second.d); // e.g. a duplicate delivery of the same event run
  assert.equal(first.calls.execute + second.calls.execute, 1);
});

test("taskFlow: permanent failure marks the task failed and rethrows", async () => {
  const { d, calls } = deps({ saveFailures: 99 });
  await assert.rejects(taskFlow(fakeStep(), d), /injected/);
  assert.equal(calls.execute, 1);
  assert.equal(calls.failed.length, 1);
});

test("taskFlow: monthly cap stops the task before the LLM unless confirmed", async () => {
  const blocked = deps({ blocked: "Monthly total exceeds the cap." });
  await taskFlow(fakeStep(), blocked.d);
  assert.equal(blocked.calls.execute, 0);
  assert.deepEqual(blocked.calls.failed, ["Monthly total exceeds the cap."]);
  const confirmed = deps({ blocked: "Monthly total exceeds the cap.", confirmed: true });
  await taskFlow(fakeStep(), confirmed.d);
  assert.equal(confirmed.calls.execute, 1);
});

test("budget gate for a direct task: only the monthly cap applies", () => {
  const g = budgetGate({ estUsd: 2, spentUsd: 0, capUsd: Number.POSITIVE_INFINITY, monthSpentUsd: 299, monthCapUsd: 300 });
  assert.equal(g.blocked, true);
  assert.equal(g.reasons.length, 1);
  assert.match(g.reasons[0], /Monthly/);
  assert.equal(budgetGate({ estUsd: 0.5, spentUsd: 0, capUsd: Number.POSITIVE_INFINITY, monthSpentUsd: 299, monthCapUsd: 300 }).blocked, false);
});

test("send to flow: each task continues at the next pipeline stage", () => {
  assert.equal(TASKS.accountManager.next, "creativeDirector");
  assert.equal(TASKS.creativeDirector.next, "artDirector");
  assert.equal(TASKS.artDirector.next, "producer");
  assert.equal(TASKS.producer.next, undefined);
  assert.deepEqual(refIds({ creativeBriefId: "a1", characterIds: ["c1"], product: "x" }), ["a1"]);
});

test("task inputs are validated and the form schema exposes artifact pickers", () => {
  assert.throws(() => TASKS.creativeDirector.input.parse({}), /internal brief or write an idea/);
  assert.ok(TASKS.creativeDirector.input.parse({ idea: "Weekend promo" }));
  const js = z.toJSONSchema(TASKS.artDirector.input, { io: "input" }) as { properties: Record<string, { ref?: string; library?: string }>; required: string[] };
  assert.equal(js.properties.creativeBriefId.ref, "creativeDirector");
  assert.equal(js.properties.characterIds.library, "character");
  assert.ok(js.required.includes("creativeBriefId"));
});

test("every role workspace with a task maps to the table's output; QC and post-production pick a campaign", () => {
  assert.deepEqual(Object.keys(TASKS).sort(), ["accountManager", "accountTeam", "artDirector", "creativeDirector", "postProduction", "producer", "storyboardArtist", "videographer"]);
  for (const r of ["accountTeam", "postProduction"]) {
    const js = z.toJSONSchema(TASKS[r].input, { io: "input" }) as { properties: Record<string, { ref?: string }> };
    assert.equal(js.properties.campaignId.ref, "campaign");
    assert.equal(TASKS[r].next, undefined); // their output does not seed a new campaign
  }
  assert.equal(TASKS.accountTeam.llm, true);
  assert.equal(TASKS.postProduction.llm, false);
});

test("storyboard: one panel per shot with running timecodes", () => {
  const shot = (shotId: string, durationSec: number) => ({ shotId, durationSec, cameraMove: "pan", subject: "s", setting: "r", lighting: "l", onScreenText: "", voLine: "" });
  const sb = storyboard({ moodboardPrompts: [], palette: ["#fff"], typography: "", characterDescription: "Ana", shotList: [shot("shot01", 8), shot("shot02", 5)], styleRefImageUrls: [] });
  assert.deepEqual(sb.panels.map((p) => [p.panel, p.startSec]), [[1, 0], [2, 8]]);
  assert.equal(sb.totalSec, 13);
});

test("storyboard PDF: one page per panel, placeholder when an image is missing", async () => {
  const shot = (shotId: string) => ({ shotId, durationSec: 5, cameraMove: "pan", subject: "s", setting: "r", lighting: "l", onScreenText: "Halo ✓", voLine: "" });
  const { storyboardPdf } = await import("./storyboardPdf");
  const bytes = await storyboardPdf(storyboard({ moodboardPrompts: [], palette: ["#fff"], typography: "", characterDescription: "Ana", shotList: [shot("shot01"), shot("shot02")], styleRefImageUrls: [] }), [null, null]);
  assert.equal(Buffer.from(bytes.slice(0, 4)).toString(), "%PDF");
  assert.equal((await (await import("pdf-lib")).PDFDocument.load(bytes)).getPageCount(), 2);
});
