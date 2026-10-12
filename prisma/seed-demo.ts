// Two demo campaigns for the dashboard (idempotent: fixed ids, wiped and recreated on every run).
//  - demo_kopi:   AWAITING_APPROVAL after one post-production revision (2 runs, 2 final-cut versions, a rejected upload)
//  - demo_bakery: FAILED at the Creative Director after retries (429 quota error)
// Run: npm run db:seed:demo. Videos are generated with ffmpeg and uploaded to S3 when it is reachable.
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import ffmpegPath from "ffmpeg-static";
import { db } from "@/lib/db";
import { promptPackage } from "@/lib/agents";
import type { ClientBrief, VisualDirection } from "@/lib/agents/schemas";
import { finalCut, probe, validateClip } from "@/lib/media";
import { uploadFile } from "@/lib/s3";

const run = promisify(execFile);
const IDS = ["demo_kopi", "demo_bakery"];
const ago = (min: number) => new Date(Date.now() - min * 60_000);

async function wipe() {
  const where = { campaignId: { in: IDS } };
  await db.step.deleteMany({ where: { run: where } });
  await db.run.deleteMany({ where });
  await db.shotAsset.deleteMany({ where: { shot: where } });
  await db.shot.deleteMany({ where });
  await db.artifact.deleteMany({ where });
  await db.decision.deleteMany({ where });
  await db.costEntry.deleteMany({ where });
  await db.campaign.deleteMany({ where: { id: { in: IDS } } });
}

async function clip(dir: string, name: string, w: number, h: number, sec: number, color: string) {
  const out = join(dir, name);
  await run(ffmpegPath!, [
    "-y", "-f", "lavfi", "-i", `color=c=${color}:size=${w}x${h}:rate=24:duration=${sec}`,
    "-f", "lavfi", "-i", `sine=frequency=440:duration=${sec}`,
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", out,
  ]);
  return out;
}

let s3ok = true;
async function put(key: string, file: string) {
  if (!s3ok) return;
  try {
    await uploadFile(key, file);
  } catch (e) {
    const err = e as Error & { code?: string };
    if (s3ok) console.warn(`S3 not reachable (${err.code ?? err.name}); demo videos will not play until S3 is up and the seed is rerun.`);
    s3ok = false;
  }
}

const brief = (product: string, objective: string, audience: string): ClientBrief => ({
  objective, product, audience, kpi: "1,000 profile visits in 2 weeks", platforms: ["instagram", "tiktok"],
  budgetCapUsd: 10, deadline: "2026-10-31", brandKitId: null, references: [], defaultSource: "manual_upload",
});

const shot = (shotId: string, subject: string, voLine: string) => ({
  shotId, durationSec: 4, cameraMove: "slow push-in", subject, setting: "small café counter, morning",
  lighting: "warm window light", onScreenText: "", voLine,
});

async function kopi(dir: string) {
  const id = "demo_kopi";
  const b = brief("Kopi Senja (demo)", "Grow walk-in sales of the new palm-sugar iced latte", "Office workers 22-35 in South Jakarta");
  const internal = {
    problemStatement: "People do not know the café opens at 7am.", insight: "The first coffee of the day is a small ritual.",
    mandatories: ["Show the logo cup", "Mention opening hours"], tone: "warm, playful",
    deliverables: [{ platform: "instagram", format: "reel", durationSec: 8 }, { platform: "tiktok", format: "video", durationSec: 8 }], trendRefs: [],
  };
  const creative = {
    bigIdea: "Your 7am ritual, sweetened.",
    conceptOptions: [
      { title: "Morning Ritual", logline: "A calm pour at sunrise.", whyItWorks: "Relatable routine", hook: "It's 6:59…" },
      { title: "Sugar Rush", logline: "Fast cuts of palm sugar drizzle.", whyItWorks: "Satisfying visuals", hook: "Watch this pour" },
      { title: "Desk Swap", logline: "Office coffee vs Kopi Senja.", whyItWorks: "Contrast", hook: "Stop drinking this" },
    ],
    chosenConcept: "Morning Ritual: calm, ownable, fits the brand tone", keyMessage: "Open from 7am", cta: "Drop by before work",
  };
  const visual: VisualDirection = {
    moodboardPrompts: ["warm sunrise café, film grain"], palette: ["#6B3E26", "#F2C14E"], typography: "rounded sans",
    characterDescription: "barista in her 20s, short hair, brown apron",
    shotList: [shot("shot01", "barista pours palm-sugar syrup", "Jam tujuh pagi, ritual kecilmu dimulai."), shot("shot02", "customer takes the first sip", "Kopi Senja. Buka dari jam tujuh.")],
    styleRefImageUrls: [],
  };
  const plan = {
    shots: visual.shotList.map((s) => ({ shotId: s.shotId, source: "manual_upload", resolution: "720p", maxAttempts: 3, estCostUsd: 0 })),
    estCostUsd: 0, timeline: "2 shot; draft, then client approval", approvalsNeeded: ["client-approval"],
  };
  const qc = (score: number) => ({
    captionPerPlatform: [
      { platform: "instagram", caption: "Your 7am ritual, sweetened ☀️ Palm-sugar iced latte, now at Kopi Senja." },
      { platform: "tiktok", caption: "POV: it's 6:59 and the café just opened ☕" },
    ],
    hashtags: ["kopisenja", "kopijakarta", "palmsugarlatte", "morningritual"],
    brandSafetyChecklist: [
      { item: "No health claims", ok: true, note: "" },
      { item: "AI-content label", ok: true, note: "Add the platform AI label when publishing" },
      { item: "Licensed music", ok: score > 7, note: score > 7 ? "" : "Background track not yet confirmed" },
    ],
    selfScore: score,
  });

  const [good1, good2, wide] = await Promise.all([
    clip(dir, "k1.mp4", 720, 1280, 4, "0x6B3E26"),
    clip(dir, "k2.mp4", 720, 1280, 4, "0xF2C14E"),
    clip(dir, "kw.mp4", 1280, 720, 4, "0x333333"),
  ]);
  const cut = await finalCut(dir, [
    { file: good1, durationSec: 4, voLine: visual.shotList[0].voLine },
    { file: good2, durationSec: 4, voLine: visual.shotList[1].voLine },
  ]);
  const k = (n: string) => `campaigns/${id}/${n}`;
  await Promise.all([put(k("shot01/upload-1.mp4"), wide), put(k("shot01/upload-2.mp4"), good1), put(k("shot02/upload-1.mp4"), good2), put(k("finalCut-1.mp4"), cut), put(k("finalCut-2.mp4"), cut)]);

  await db.campaign.create({
    data: {
      id, clientBrief: b, status: "AWAITING_APPROVAL", budgetCapUsd: 10, defaultSource: "manual_upload",
      finalCutKey: k("finalCut-2.mp4"), approvalPackage: { ...qc(8.5), costSoFar: 0.0465 }, createdAt: ago(180),
    },
  });

  const run1 = await db.run.create({ data: { campaignId: id, status: "superseded", startedAt: ago(175), endedAt: ago(60) } });
  const run2 = await db.run.create({ data: { campaignId: id, status: "running", startedAt: ago(30) } });
  const steps: [string, string, number, number, string | null][] = [
    [run1.id, "accountManager", 175, 174, null], [run1.id, "creativeDirector", 174, 173, null], [run1.id, "artDirector", 173, 172, null],
    [run1.id, "producer", 172, 172, null], [run1.id, "postProduction", 95, 94, null], [run1.id, "accountTeam", 94, 93, null],
    [run2.id, "postProduction", 30, 29, null], [run2.id, "accountTeam", 29, 28, null],
  ];
  for (const [runId, agentRole, s, e] of steps)
    await db.step.create({ data: { runId, agentRole, status: "done", startedAt: ago(s), endedAt: new Date(ago(e).getTime() + 7_000) } });

  const art = (agentRole: string, version: number, payload: object, costUsd: number, runId: string, min: number) =>
    db.artifact.create({ data: { campaignId: id, agentRole, version, payload, costUsd, runId, createdAt: ago(min) } });
  await art("accountManager", 1, internal, 0.0021, run1.id, 174);
  await art("creativeDirector", 1, creative, 0.0164, run1.id, 173);
  await art("artDirector", 1, visual, 0.0118, run1.id, 172);
  await art("producer", 1, plan, 0, run1.id, 172);
  await art("postProduction", 1, { finalCut: k("finalCut-1.mp4"), clips: [{ file: "shot01.mp4", assetVersion: 2 }, { file: "shot02.mp4", assetVersion: 1 }], notes: null }, 0, run1.id, 94);
  await art("accountTeam", 1, qc(7), 0.0071, run1.id, 93);
  await art("router", 1, { target: "postProduction" }, 0.0002, run1.id, 61);
  await art("postProduction", 2, { finalCut: k("finalCut-2.mp4"), clips: [{ file: "shot01.mp4", assetVersion: 2 }, { file: "shot02.mp4", assetVersion: 1 }], notes: "Cut the intro faster" }, 0, run2.id, 29);
  await art("accountTeam", 2, qc(8.5), 0.0089, run2.id, 28);

  await db.decision.create({ data: { campaignId: id, type: "revise", notes: "Cut the intro faster", targetAgent: "postProduction", createdAt: ago(61) } });

  const assets: [string, string, string][] = [["shot01", "upload-1.mp4", wide], ["shot01", "upload-2.mp4", good1], ["shot02", "upload-1.mp4", good2]];
  for (const spec of visual.shotList) {
    const s = await db.shot.create({
      data: { campaignId: id, shotId: spec.shotId, source: "manual_upload", maxAttempts: 3, status: "ready", promptPackage: promptPackage(id, spec, visual) },
    });
    let version = 0;
    for (const [shotId, name, file] of assets.filter((a) => a[0] === spec.shotId)) {
      const p = await probe(file);
      const errors = validateClip(p, spec.durationSec);
      await db.shotAsset.create({
        data: {
          shotId: s.id, version: ++version, s3Key: k(`${shotId}/${name}`), origin: "upload",
          durationSec: p.durationSec, hasAudio: p.hasAudio, validation: { ok: !errors.length, errors, probe: p }, createdAt: ago(120 - version),
        },
      });
    }
  }
}

async function bakery() {
  const id = "demo_bakery";
  await db.campaign.create({
    data: {
      id, clientBrief: brief("Roti Bakar 88 (demo)", "Launch the new cheese-chocolate toast", "Students around campus, 18-24"),
      status: "FAILED", budgetCapUsd: 10, defaultSource: "manual_upload", createdAt: ago(90),
    },
  });
  const r = await db.run.create({ data: { campaignId: id, inngestRunId: "01DEMO0000000000000000FAIL", status: "failed", startedAt: ago(88), endedAt: ago(80) } });
  await db.step.create({ data: { runId: r.id, agentRole: "accountManager", status: "done", startedAt: ago(88), endedAt: new Date(ago(88).getTime() + 6_000) } });
  const err = "AI_APICallError: [429 RESOURCE_EXHAUSTED] You exceeded your current quota for gemini-2.5-pro. Please retry in 41s.";
  for (let attempt = 1; attempt <= 4; attempt++)
    await db.step.create({
      data: { runId: r.id, agentRole: "creativeDirector", status: "failed", attempt, error: err, startedAt: ago(88 - attempt * 2), endedAt: new Date(ago(88 - attempt * 2).getTime() + 3_000) },
    });
  await db.artifact.create({
    data: {
      campaignId: id, agentRole: "accountManager", version: 1, costUsd: 0.0019, runId: r.id, createdAt: ago(88),
      payload: { problemStatement: "New menu item is unknown.", insight: "Late-night study hunger.", mandatories: ["Show the cheese pull"], tone: "energetic", deliverables: [], trendRefs: [] },
    },
  });
}

async function main() {
  const dir = await mkdtemp(join(tmpdir(), "mauagent-demo-"));
  try {
    await wipe();
    await kopi(dir);
    await bakery();
    console.log(`Seeded demo campaigns: ${IDS.join(", ")}${s3ok ? " (videos uploaded)" : ""}`);
  } finally {
    await rm(dir, { recursive: true, force: true });
    await db.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
