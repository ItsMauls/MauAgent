import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import ffmpegPath from "ffmpeg-static";
import { producer } from "./agents";
import type { VisualDirection } from "./agents/schemas";
import { finalCut, probe, validateClip } from "./media";

const run = promisify(execFile);

const shot = (id: string, durationSec: number) => ({
  shotId: id, durationSec, cameraMove: "", subject: "", setting: "", lighting: "", onScreenText: "", voLine: `hello ${id}`,
});
const visual: VisualDirection = {
  moodboardPrompts: [], palette: [], typography: "", characterDescription: "", styleRefImageUrls: [],
  shotList: [shot("shot01", 8), shot("shot02", 5)],
};

test("producer: deterministic cost from PriceBook, manual = 0", () => {
  const api = producer(visual, { defaultSource: "seedance_api", draftModel: "m", resolution: "720p", price: () => 0.05 });
  assert.equal(api.estCostUsd, 0.65);
  assert.deepEqual(api.shots.map((s) => s.estCostUsd), [0.4, 0.25]);
  const manual = producer(visual, { defaultSource: "manual_upload", draftModel: "m", resolution: "720p", price: () => 0.05 });
  assert.equal(manual.estCostUsd, 0);
});

async function clip(dir: string, name: string, w: number, h: number, audio: boolean, sec = 3) {
  const out = join(dir, name);
  const args = ["-y", "-f", "lavfi", "-i", `testsrc=size=${w}x${h}:rate=24:duration=${sec}`];
  if (audio) args.push("-f", "lavfi", "-i", `sine=frequency=440:duration=${sec}`);
  await run(ffmpegPath!, [...args, "-c:v", "libx264", "-pix_fmt", "yuv420p", ...(audio ? ["-c:a", "aac", "-shortest"] : []), out]);
  return out;
}

test("ffprobe validation + final cut 1080x1920", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mauagent-test-"));
  try {
    const good = await clip(dir, "good.mp4", 720, 1280, true);
    const wide = await clip(dir, "wide.mp4", 1280, 720, true);
    const mute = await clip(dir, "mute.mp4", 720, 1280, false);

    assert.deepEqual(validateClip(await probe(good), 3), []);
    assert.match(validateClip(await probe(wide), 3).join(), /not vertical 9:16/);
    assert.match(validateClip(await probe(mute), 3).join(), /no audio/);

    const out = await finalCut(dir, [
      { file: good, durationSec: 3, voLine: "Hello {world}" },
      { file: good, durationSec: 3, voLine: "" },
    ]);
    const p = await probe(out);
    assert.equal(p.width, 1080);
    assert.equal(p.height, 1920);
    assert.equal(p.vcodec, "h264");
    assert.ok(p.hasAudio);
    assert.ok(Math.abs(p.durationSec - 6) < 0.5);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
