import fs from "node:fs/promises";
import path from "node:path";
import { Glob } from "bun";
import type { BurnOutput, VideoId } from "../types.ts";
import { paths } from "../workdir.ts";

export interface BurnInput {
  videoId: VideoId;
}

interface Word {
  word: string;
  start: number;
  end: number;
}

interface Phrase {
  text: string;
  start: number;
  end: number;
}

// Gap antar kata (detik) yang dianggap batas phrase/kalimat
const PHRASE_GAP     = 0.4;
// Maksimal durasi satu phrase (detik) — hindari phrase terlalu panjang
const PHRASE_MAX_DUR = 4.0;
// Maksimal kata per phrase — fallback kalau tidak ada gap
const PHRASE_MAX_WORDS = 8;

// PlayResY = 1920
// MarginV = jarak dari bawah (alignment=2) atau dari atas (alignment=8)
// Wajah di atas → subtitle di bawah: alignment=2, MarginV=120 (dekat bawah)
// Wajah di bawah → subtitle di atas: alignment=8, MarginV=120 (dekat atas)
// Default/unknown → wajah di atas, subtitle di bawah

function makeAssStyle(zone: "top" | "bottom" | "middle" | "unknown"): string {
  const atTop    = zone === "bottom"; // wajah di bawah → subtitle di atas
  const alignment = atTop ? "8" : "2"; // 8=top-center, 2=bottom-center
  const marginV   = "120";
  return [
    "Style: Default",
    "Arial",
    "38",
    "&H00FFFFFF",
    "&H000000FF",
    "&H00000000",
    "&H80000000",
    "1",           // bold
    "0", "0", "0",
    "100", "100", "0", "0",
    "1",           // border style
    "4",           // outline width
    "0",           // no shadow
    alignment,
    "10", "10", marginV,
    "0",
  ].join(",");
}

export async function run(input: BurnInput): Promise<BurnOutput> {
  const p = paths(input.videoId);

  const glob = new Glob("clip_*_reframed.mp4");
  const reframedFiles: string[] = [];
  for await (const f of glob.scan(p.reframed)) reframedFiles.push(f);
  reframedFiles.sort();

  const finalPaths: string[] = [];

  for (let i = 0; i < reframedFiles.length; i++) {
    const inP    = `${p.reframed}/${reframedFiles[i]}`;
    const outP   = p.final(i + 1);
    const wordsP = p.words(i + 1);
    const assP   = path.join(p.data, `clip_${String(i + 1).padStart(2, "0")}.ass`);

    // Kalau tidak ada words.json, copy as-is
    if (!(await fileExists(wordsP))) {
      console.log(`  clip ${i + 1}: tidak ada subtitle, copy as-is`);
      await ffmpeg(["-y", "-i", inP, "-c", "copy", outP]);
      finalPaths.push(outP);
      continue;
    }

    const words: Word[] = JSON.parse(await fs.readFile(wordsP, "utf-8"));

    if (words.length === 0) {
      console.log(`  clip ${i + 1}: subtitle kosong, copy as-is`);
      await ffmpeg(["-y", "-i", inP, "-c", "copy", outP]);
      finalPaths.push(outP);
      continue;
    }

    const phrases = groupPhrases(words);

    // Detect zona wajah untuk posisi subtitle yang aman
    const zone = await detectFaceZone(inP);
    console.log(`  clip ${i + 1}: face zone = ${zone}`);

    await writeAss(assP, phrases, zone);

    console.log(`  clip ${i + 1}: burning ${phrases.length} phrase(s)...`);
    try {
      const escapedAss = escapeFfmpegPath(path.resolve(assP));
      await ffmpeg(["-y", "-i", inP, "-vf", `ass=${escapedAss}`, "-c:v", "libx264", "-preset", "veryfast", "-c:a", "copy", outP]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.includes("No such filter") && !msg.includes("ass=")) throw err;
      console.log(`  clip ${i + 1}: [warn] libass tidak tersedia → drawtext fallback`);
      await renderDrawtext(inP, outP, phrases, zone);
    }

    finalPaths.push(outP);
  }

  return { videoId: input.videoId, finalPaths };
}

// ── phrase grouping ───────────────────────────────────────────────────────────

function groupPhrases(words: Word[]): Phrase[] {
  const phrases: Phrase[] = [];
  let chunk: Word[] = [];

  const flush = () => {
    if (chunk.length === 0) return;
    phrases.push({
      text:  chunk.map(w => w.word).join(" "),
      start: chunk[0].start,
      end:   chunk[chunk.length - 1].end,
    });
    chunk = [];
  };

  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const next = words[i + 1];

    chunk.push(w);

    const gap      = next ? next.start - w.end : Infinity;
    const dur      = w.end - chunk[0].start;
    const tooLong  = dur >= PHRASE_MAX_DUR;
    const tooMany  = chunk.length >= PHRASE_MAX_WORDS;
    const hasGap   = gap >= PHRASE_GAP;

    if (hasGap || tooLong || tooMany || !next) {
      flush();
    }
  }

  return phrases;
}

// ── ASS writer ────────────────────────────────────────────────────────────────

type FaceZone = "top" | "bottom" | "middle" | "unknown";

async function detectFaceZone(videoPath: string): Promise<FaceZone> {
  const { $ } = await import("bun");
  const result = await $`uv run scripts/detect_face_zone.py ${videoPath}`.nothrow();
  const out = result.stdout.toString().trim();
  if (out === "top" || out === "bottom" || out === "middle") return out;
  return "unknown";
}

async function writeAss(outPath: string, phrases: Phrase[], zone: FaceZone): Promise<void> {
  const style = makeAssStyle(zone);
  const lines = [
    "[Script Info]",
    "ScriptType: v4.00+",
    "PlayResX: 1080",
    "PlayResY: 1920",
    "ScaledBorderAndShadow: yes",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    style,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    ...phrases.map(p =>
      `Dialogue: 0,${toAssTs(p.start)},${toAssTs(p.end)},Default,,0,0,0,,${escapeAss(p.text)}`
    ),
  ];
  await fs.writeFile(outPath, lines.join("\n") + "\n", "utf-8");
}

function toAssTs(sec: number): string {
  const h  = Math.floor(sec / 3600);
  const m  = Math.floor((sec % 3600) / 60);
  const s  = sec % 60;
  const cs = Math.round((s % 1) * 100);
  return `${h}:${pad2(m)}:${pad2(Math.floor(s))}.${pad2(cs)}`;
}

function escapeAss(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/\{/g, "\\{").replace(/\n/g, "\\N");
}

// ── drawtext fallback ─────────────────────────────────────────────────────────

async function renderDrawtext(inP: string, outP: string, phrases: Phrase[], zone: FaceZone): Promise<void> {
  const fontPath = await findFont();
  const fontPart = fontPath ? `fontfile=${escapeFfmpegPath(fontPath)}:` : "";
  const yPos = zone === "bottom" ? "h*0.10" : "h*0.72"; // wajah bawah → subtitle atas
  const filters = phrases.map(p => {
    const text  = escapeDrawtext(p.text);
    const start = p.start.toFixed(3);
    const end   = p.end.toFixed(3);
    return (
      `drawtext=${fontPart}text=${text}:` +
      `x=(w-tw)/2:y=${yPos}:` +
      `fontcolor=white:fontsize=38:bold=1:` +
      `borderw=4:bordercolor=black:` +
      `enable=between(t\\,${start}\\,${end})`
    );
  });
  await ffmpeg(["-y", "-i", inP, "-vf", filters.join(","), "-c:v", "libx264", "-preset", "veryfast", "-c:a", "copy", outP]);
}

function escapeDrawtext(text: string): string {
  return text
    .replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/:/g, "\\:")
    .replace(/,/g, "\\,").replace(/\[/g, "\\[").replace(/\]/g, "\\]")
    .replace(/\n/g, " ");
}

const FONT_CANDIDATES = [
  "/System/Library/Fonts/Helvetica.ttc",
  "/System/Library/Fonts/Geneva.ttf",
  "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
  "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
  "/usr/share/fonts/dejavu-sans-fonts/DejaVuSans.ttf",
  "/mnt/c/Windows/Fonts/arial.ttf",
];

async function findFont(): Promise<string | null> {
  for (const f of FONT_CANDIDATES) {
    try { await fs.access(f); return f; } catch {}
  }
  return null;
}

// ── utils ─────────────────────────────────────────────────────────────────────

function escapeFfmpegPath(p: string): string {
  return p.replace(/\\/g, "\\\\").replace(/:/g, "\\:");
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

async function fileExists(p: string): Promise<boolean> {
  try { await fs.access(p); return true; } catch { return false; }
}

async function ffmpeg(args: string[]): Promise<void> {
  const proc = Bun.spawn(["ffmpeg", ...args], { stdout: "ignore", stderr: "pipe" });
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text();
    throw new Error(`ffmpeg exited with code ${exitCode}\n\n${stderr.slice(-2000)}`);
  }
}
