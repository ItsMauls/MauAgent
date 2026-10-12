import { execFile } from "node:child_process";
import { stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import ffmpegPath from "ffmpeg-static";
import ffprobe from "ffprobe-static";

const run = promisify(execFile);

export type Probe = { width: number; height: number; durationSec: number; hasAudio: boolean; sizeBytes: number; vcodec: string };

export async function probe(file: string): Promise<Probe> {
  const { stdout } = await run(ffprobe.path, ["-v", "error", "-print_format", "json", "-show_streams", "-show_format", file]);
  const j = JSON.parse(stdout);
  const v = j.streams.find((s: { codec_type: string }) => s.codec_type === "video");
  if (!v) throw new Error("No video stream");
  // Phone videos can store rotation in metadata; swap dimensions when rotated 90°.
  const rot = Math.abs(Number(v.tags?.rotate ?? v.side_data_list?.[0]?.rotation ?? 0)) % 180 === 90;
  return {
    width: rot ? v.height : v.width,
    height: rot ? v.width : v.height,
    durationSec: Number(j.format.duration),
    hasAudio: j.streams.some((s: { codec_type: string }) => s.codec_type === "audio"),
    sizeBytes: (await stat(file)).size,
    vcodec: v.codec_name,
  };
}

export const LIMITS = { minSec: 2, maxSec: 15, maxBytes: 200 * 1024 * 1024, minHeight: 720 };

/** Return a list of error messages in English; empty = passed. */
export function validateClip(p: Probe, expectedSec: number): string[] {
  const errs: string[] = [];
  const ratio = p.width / p.height;
  if (Math.abs(ratio - 9 / 16) > 0.01) errs.push(`Ratio ${p.width}×${p.height} is not vertical 9:16.`);
  if (p.height < LIMITS.minHeight) errs.push(`Resolution too low (${p.height}p); minimum ${LIMITS.minHeight}p.`);
  if (!p.hasAudio) errs.push("Video has no audio. Regenerate with audio enabled.");
  if (p.durationSec < LIMITS.minSec || p.durationSec > LIMITS.maxSec)
    errs.push(`Duration ${p.durationSec.toFixed(1)} seconds is outside the ${LIMITS.minSec}–${LIMITS.maxSec} second range.`);
  else if (Math.abs(p.durationSec - expectedSec) > 3)
    errs.push(`Duration ${p.durationSec.toFixed(1)} seconds is far from the planned ${expectedSec} seconds.`);
  if (p.sizeBytes > LIMITS.maxBytes) errs.push(`File size ${(p.sizeBytes / 1e6).toFixed(0)} MB exceeds 200 MB.`);
  return errs;
}

const ts = (s: number) => {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = (s % 60).toFixed(2).padStart(5, "0");
  return `${h}:${String(m).padStart(2, "0")}:${sec}`;
};

export function buildAss(lines: { text: string; start: number; end: number }[], color = "&H00FFFFFF") {
  const head = `[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, OutlineColour, BackColour, Bold, Italic, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV
Style: Default,Arial,64,${color},&H00000000,&H64000000,-1,0,1,4,0,2,80,80,320

[Events]
Format: Layer, Start, End, Style, Text
`;
  const ev = lines
    .filter((l) => l.text.trim())
    .map((l) => `Dialogue: 0,${ts(l.start)},${ts(l.end)},Default,${l.text.replace(/[{}]/g, "").replace(/\n/g, "\\N")}`);
  return head + ev.join("\n") + "\n";
}

/** Concatenate clips → 1080×1920 H.264/AAC, burned-in subtitles, moov atom up front. */
export async function finalCut(workDir: string, clips: { file: string; durationSec: number; voLine: string }[]) {
  let t = 0;
  const subs = clips.map((c) => ({ text: c.voLine, start: t, end: (t += c.durationSec) }));
  await writeFile(join(workDir, "subs.ass"), buildAss(subs));

  const n = clips.length;
  const per = clips
    .map(
      (_, i) =>
        `[${i}:v]scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30[v${i}];` +
        `[${i}:a]aresample=48000,aformat=channel_layouts=stereo[a${i}];`,
    )
    .join("");
  const cat = clips.map((_, i) => `[v${i}][a${i}]`).join("") + `concat=n=${n}:v=1:a=1[vc][ac];[vc]subtitles=subs.ass[vout]`;
  const out = join(workDir, "finalCut.mp4");
  // cwd = workDir so the subtitles path is relative (avoids Windows path escaping in the filter).
  await run(
    ffmpegPath!,
    [
      "-y",
      ...clips.flatMap((c) => ["-i", c.file]),
      "-filter_complex", per + cat,
      "-map", "[vout]", "-map", "[ac]",
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "medium", "-crf", "20",
      "-c:a", "aac", "-b:a", "192k",
      "-movflags", "+faststart",
      out,
    ],
    { cwd: workDir, maxBuffer: 1 << 26 },
  );
  return out;
}
