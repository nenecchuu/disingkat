import fs from "node:fs/promises";
import path from "node:path";
import type { ClipSpec, RenderOutput, VideoId } from "../types.ts";
import { paths } from "../workdir.ts";
import { parseVtt, sliceToSrt, type Cue } from "../subtitle.ts";

export interface RenderInput {
  videoId: VideoId;
}

const SUBTITLE_STYLE =
  "Fontname=Arial,Fontsize=18,PrimaryColour=&HFFFFFF&,OutlineColour=&H000000&,BorderStyle=1,Outline=2,Shadow=0,MarginV=80,Alignment=2";

const FONT_CANDIDATES = [
  // macOS
  "/System/Library/Fonts/Helvetica.ttc",
  "/System/Library/Fonts/Geneva.ttf",
  // Linux (Debian/Ubuntu)
  "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
  "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
  // Linux (Fedora/RHEL)
  "/usr/share/fonts/dejavu-sans-fonts/DejaVuSans.ttf",
  "/usr/share/fonts/liberation-sans/LiberationSans-Regular.ttf",
  // WSL
  "/mnt/c/Windows/Fonts/arial.ttf",
];

export async function run(input: RenderInput): Promise<RenderOutput> {
  const p = paths(input.videoId);
  const clips: ClipSpec[] = JSON.parse(await fs.readFile(p.clips, "utf-8"));
  const vtt = await fs.readFile(p.subtitle, "utf-8");
  const allCues = parseVtt(vtt);
  const outPaths: string[] = [];

  for (let i = 0; i < clips.length; i++) {
    const c = clips[i];
    const inP = p.reframed(i + 1);
    const outP = p.final(i + 1);

    // Slice cues ke range clip ini (waktu di-offset ke 0)
    const cues = sliceCues(allCues, c.start, c.end);

    if (cues.length === 0) {
      console.log(`  clip ${i + 1}: no subtitles, copying as-is`);
      await ffmpeg(["-y", "-i", inP, "-c", "copy", outP]);
    } else {
      // Tulis SRT untuk debugging / manual review
      await fs.writeFile(p.clipSrt(i + 1), sliceToSrt(allCues, c.start, c.end));
      await renderWithSubtitles(inP, outP, cues, path.resolve(p.clipSrt(i + 1)));
    }

    outPaths.push(outP);
  }

  return { videoId: input.videoId, finalPaths: outPaths };
}

async function renderWithSubtitles(
  inP: string,
  outP: string,
  cues: Cue[],
  srtPath: string,
): Promise<void> {
  // Coba subtitles filter dulu (butuh libass), fallback ke drawtext
  try {
    const escapedSrt = escapeFfmpegPath(srtPath);
    const escapedStyle = SUBTITLE_STYLE.replace(/,/g, "\\,");
    const vf = `subtitles=filename=${escapedSrt}:force_style=${escapedStyle}`;
    await ffmpeg(["-y", "-i", inP, "-vf", vf, "-c:v", "libx264", "-preset", "veryfast", "-c:a", "copy", outP]);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!msg.includes("No such filter")) throw err;

    // libass tidak ada → drawtext fallback
    console.log("  [warn] libass tidak tersedia → drawtext fallback (brew reinstall ffmpeg untuk kualitas lebih baik)");
    const fontPath = await findFont();
    const vf = buildDrawtextVf(cues, fontPath);
    await ffmpeg(["-y", "-i", inP, "-vf", vf, "-c:v", "libx264", "-preset", "veryfast", "-c:a", "copy", outP]);
  }
}

// ─── subtitle helpers ──────────────────────────────────────────────────────

function sliceCues(cues: Cue[], clipStart: number, clipEnd: number): Cue[] {
  return cues
    .filter((c) => c.end > clipStart && c.start < clipEnd)
    .map((c) => ({
      start: Math.max(0, c.start - clipStart),
      end: Math.min(clipEnd - clipStart, c.end - clipStart),
      text: c.text,
    }));
}

function buildDrawtextVf(cues: Cue[], fontPath: string | null): string {
  const fontPart = fontPath ? `fontfile=${escapeFfmpegPath(fontPath)}:` : "";
  return cues
    .map((c) => {
      const text = escapeDrawtextText(c.text);
      const start = c.start.toFixed(3);
      const end = c.end.toFixed(3);
      return (
        `drawtext=${fontPart}` +
        `text=${text}:` +
        `x=(w-tw)/2:y=h-120:` +
        `fontcolor=white:fontsize=18:` +
        `borderw=2:bordercolor=black:` +
        `enable=between(t\\,${start}\\,${end})`
      );
    })
    .join(",");
}

function escapeDrawtextText(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'")
    .replace(/:/g, "\\:")
    .replace(/,/g, "\\,")
    .replace(/\[/g, "\\[")
    .replace(/\]/g, "\\]")
    .replace(/\n/g, " ");
}

async function findFont(): Promise<string | null> {
  for (const f of FONT_CANDIDATES) {
    try { await fs.access(f); return f; } catch {}
  }
  return null;
}

// ─── ffmpeg ────────────────────────────────────────────────────────────────

function escapeFfmpegPath(p: string): string {
  return p.replace(/\\/g, "\\\\").replace(/:/g, "\\:");
}

async function ffmpeg(args: string[]): Promise<void> {
  const proc = Bun.spawn(["ffmpeg", ...args], { stdout: "ignore", stderr: "pipe" });
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text();
    throw new Error(`ffmpeg exited with code ${exitCode}\n\n${stderr.slice(-2000)}`);
  }
}
