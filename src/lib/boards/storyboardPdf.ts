// Storyboard PDF: one landscape A4 page per panel, the illustration on the left, the shot details on the right.
import { PDFDocument, StandardFonts, rgb, type PDFFont } from "pdf-lib";
import type { storyboard } from "./tasks";

type Board = ReturnType<typeof storyboard>;
const W = 842, H = 595, M = 36; // A4 landscape, margin

// Standard fonts only encode Latin-1; anything else becomes "?" instead of throwing.
const safe = (t: string) => t.replace(/[^\x20-\x7e\xa0-\xff]/g, "?");

function wrap(text: string, font: PDFFont, size: number, max: number) {
  const lines: string[] = [];
  let cur = "";
  for (const w of safe(text).split(/\s+/).filter(Boolean)) {
    const next = cur ? `${cur} ${w}` : w;
    if (cur && font.widthOfTextAtSize(next, size) > max) { lines.push(cur); cur = w; } else cur = next;
  }
  return cur ? [...lines, cur] : lines;
}

/** `images[i]` is the PNG/JPEG bytes for panel i, or null (a labelled placeholder is drawn). */
export async function storyboardPdf(sb: Board, images: (Uint8Array | null)[]) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  for (const [i, p] of sb.panels.entries()) {
    const page = pdf.addPage([W, H]);
    const box = { x: M, y: M, h: H - 2 * M - 24, w: (H - 2 * M - 24) * 9 / 16 }; // 9:16 frame
    page.drawText(`Panel ${p.panel} of ${sb.panels.length}  |  ${p.startSec}s - ${p.startSec + p.durationSec}s  |  ${p.shotId}`, { x: M, y: H - M - 8, size: 12, font: bold });
    const bytes = images[i];
    if (bytes) {
      const png = bytes[0] === 0x89;
      const img = await (png ? pdf.embedPng(bytes) : pdf.embedJpg(bytes));
      const k = Math.min(box.w / img.width, box.h / img.height);
      page.drawImage(img, { x: box.x, y: box.y, width: img.width * k, height: img.height * k });
    } else {
      page.drawRectangle({ x: box.x, y: box.y, width: box.w, height: box.h, borderColor: rgb(0.6, 0.6, 0.6), borderWidth: 1 });
      page.drawText("Illustration not generated", { x: box.x + 12, y: box.y + box.h / 2, size: 10, font, color: rgb(0.4, 0.4, 0.4) });
    }
    const x = box.x + box.w + 28, max = W - M - x;
    let y = H - M - 40;
    for (const [label, value] of [["Framing", p.framing], ["Action", p.action], ["Setting", p.setting], ["Lighting", p.lighting], ["On-screen text", p.onScreenText || "-"], ["Voice-over", p.voLine || "-"], ["Character", sb.character], ["Palette", sb.palette.join(", ")]]) {
      page.drawText(label.toUpperCase(), { x, y, size: 8, font: bold, color: rgb(0.45, 0.45, 0.45) });
      y -= 13;
      for (const line of wrap(value, font, 11, max).slice(0, 5)) { page.drawText(line, { x, y, size: 11, font }); y -= 14; }
      y -= 8;
    }
  }
  return pdf.save();
}
