import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AssetOrigin } from "@prisma/client";
import { db } from "@/lib/db";
import { probe, validateClip } from "@/lib/media";
import { download } from "@/lib/s3";

/** Download the clip from S3, validate it with ffprobe, and save it as a new ShotAsset version. */
export async function recordAsset(shotDbId: string, s3Key: string, origin: AssetOrigin, expectedSec: number) {
  const dir = await mkdtemp(join(tmpdir(), "mauagent-probe-"));
  try {
    const file = join(dir, "clip.mp4");
    await download(s3Key, file);
    let errors: string[];
    let p: Awaited<ReturnType<typeof probe>> | null = null;
    try {
      p = await probe(file);
      errors = validateClip(p, expectedSec);
    } catch {
      errors = ["File is not a valid MP4 video."];
    }
    const ok = errors.length === 0;
    const last = await db.shotAsset.findFirst({ where: { shotId: shotDbId }, orderBy: { version: "desc" } });
    await db.shotAsset.create({
      data: {
        shotId: shotDbId,
        version: (last?.version ?? 0) + 1,
        s3Key,
        origin,
        durationSec: p?.durationSec,
        hasAudio: p?.hasAudio,
        validation: { ok, errors, probe: p },
      },
    });
    // A failed upload does not downgrade a shot that already has a valid version.
    if (ok) await db.shot.update({ where: { id: shotDbId }, data: { status: "ready" } });
    else await db.shot.updateMany({ where: { id: shotDbId, status: { not: "ready" } }, data: { status: "invalid" } });
    return { ok, errors };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
