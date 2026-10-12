import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { db } from "@/lib/db";
import { download, uploadFile } from "@/lib/s3";
import type { VisualDirection } from "@/lib/agents/schemas";
import { finalCut } from "./index";

/**
 * Final cut of a campaign's latest valid clip per shot (shot-list order), uploaded to `key`.
 * Used by the pipeline's post-production step and by the Post-production direct task.
 */
export async function renderCut(campaignId: string, visual: VisualDirection, key: string) {
  const dir = await mkdtemp(join(tmpdir(), "mauagent-"));
  try {
    const clips = [];
    for (const spec of visual.shotList) {
      const shot = await db.shot.findUniqueOrThrow({
        where: { campaignId_shotId: { campaignId, shotId: spec.shotId } },
        include: { assets: { where: { validation: { path: ["ok"], equals: true } }, orderBy: { version: "desc" }, take: 1 } },
      });
      const a = shot.assets[0];
      if (!a) throw new Error(`${spec.shotId} has no valid clip`);
      const file = join(dir, `${spec.shotId}.mp4`);
      await download(a.s3Key, file);
      clips.push({ file, durationSec: a.durationSec ?? spec.durationSec, voLine: spec.voLine, assetVersion: a.version });
    }
    await uploadFile(key, await finalCut(dir, clips));
    return { finalCut: key, clips: clips.map((c) => ({ file: c.file.split(/[\\/]/).pop(), assetVersion: c.assetVersion })) };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
