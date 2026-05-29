import { $ } from "bun";
import { Glob } from "bun";
import fs from "node:fs/promises";
import path from "node:path";
import type { ReframeOutput, VideoId } from "../types.ts";
import { paths } from "../workdir.ts";

export interface ReframeInput {
  videoId: VideoId;
  mode?: "split-vertical" | "center-crop" | "letterbox" | "speaker-crop";
  speakerMethod?: "largest-face" | "lip-movement";
}

interface SpeakerEvent {
  time: number;
  crop_x: number;
}

export async function run(input: ReframeInput): Promise<ReframeOutput> {
  const p = paths(input.videoId);
  const mode = input.mode ?? "center-crop";

  const glob = new Glob("clip_*_raw.mp4");
  const rawFiles: string[] = [];
  for await (const f of glob.scan(p.raw)) rawFiles.push(f);
  rawFiles.sort();

  const outPaths: string[] = [];

  for (let i = 0; i < rawFiles.length; i++) {
    const inP = `${p.raw}/${rawFiles[i]}`;
    const outP = p.reframedClip(i + 1);

    if (mode === "speaker-crop") {
      await reframeSpeakerCrop(inP, outP, p, i + 1, input.speakerMethod ?? "largest-face");
    } else {
      const filter = filterFor(mode);
      await $`ffmpeg -y -i ${inP} -filter_complex ${filter} -c:v libx264 -preset veryfast -c:a copy ${outP}`.quiet();
    }

    outPaths.push(outP);
  }

  return { videoId: input.videoId, clipPaths: outPaths };
}

// ── speaker-crop mode ────────────────────────────────────────────────────────

async function reframeSpeakerCrop(
  inP: string,
  outP: string,
  p: ReturnType<typeof paths>,
  clipIdx: number,
  speakerMethod: "largest-face" | "lip-movement",
): Promise<void> {
  const tag = String(clipIdx).padStart(2, "0");
  const segmentsPath = p.scenes(clipIdx);
  const eventsPath   = p.speakers(clipIdx);

  // Step 1: detect scene cuts
  console.log(`  clip ${clipIdx}: detecting scenes...`);
  const scenesResult = await $`uv run scripts/detect_scenes.py ${inP} ${segmentsPath}`.nothrow();
  if (scenesResult.exitCode !== 0 || !(await fileExists(segmentsPath))) {
    console.log(`  clip ${clipIdx}: scene detection gagal, fallback ke center-crop`);
    return fallbackCenterCrop(inP, outP);
  }

  // Step 2: detect speaker per segment
  console.log(`  clip ${clipIdx}: detecting speakers...`);
  const speakersResult = await $`uv run scripts/detect_speakers.py ${inP} ${segmentsPath} ${eventsPath} --method ${speakerMethod}`.nothrow();
  if (speakersResult.exitCode !== 0 || !(await fileExists(eventsPath))) {
    console.log(`  clip ${clipIdx}: speaker detection gagal, fallback ke center-crop`);
    return fallbackCenterCrop(inP, outP);
  }

  const events: SpeakerEvent[] = JSON.parse(await fs.readFile(eventsPath, "utf-8"));
  const segments: Array<{ start: number; end: number; start_frame: number; end_frame: number }> =
    JSON.parse(await fs.readFile(segmentsPath, "utf-8"));

  if (events.length === 0) {
    console.log(`  clip ${clipIdx}: tidak ada wajah terdeteksi, fallback ke center-crop`);
    return fallbackCenterCrop(inP, outP);
  }

  // Probe resolusi video
  const probeResult = await $`ffprobe -v quiet -print_format json -show_streams ${inP}`.quiet();
  const probeJson = JSON.parse(probeResult.stdout.toString());
  const videoStream = probeJson.streams.find((s: { codec_type: string }) => s.codec_type === "video");
  const frameH: number = videoStream?.height ?? 1080;
  const frameW: number = videoStream?.width ?? 1920;
  const cropW = Math.round(frameH * 9 / 16);

  // Setiap segment di-trim + di-crop ke posisi yang benar, lalu di-concat.
  // Ini lebih bersih dari sendcmd karena tidak ada state antar segment.
  const segmentFiles: string[] = [];

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const evt = events[i];
    const segOut = path.join(p.data, `clip_${tag}_seg${String(i).padStart(3, "0")}.mp4`);

    const cropX = Math.max(0, Math.min(evt.crop_x, frameW - cropW));

    // Pakai select berbasis frame number — frame-accurate, tidak ada sisa frame
    const vf = [
      `select='between(n\\,${seg.start_frame}\\,${seg.end_frame - 1})'`,
      `setpts=PTS-STARTPTS`,
      `crop=${cropW}:${frameH}:${cropX}:0`,
      `scale=1080:1920:flags=lanczos`,
    ].join(",");
    const r = await $`ffmpeg -y -i ${inP} -vf ${vf} -vsync vfr -c:v libx264 -preset veryfast -an ${segOut}`.nothrow();
    if (r.exitCode !== 0) {
      console.log(`  clip ${clipIdx}: segment ${i} gagal, fallback ke center-crop`);
      for (const f of segmentFiles) await fs.unlink(f).catch(() => {});
      return fallbackCenterCrop(inP, outP);
    }
    segmentFiles.push(segOut);
  }

  // Concat semua segment + audio dari original
  const concatListPath = path.join(p.data, `clip_${tag}_concat.txt`);
  await fs.writeFile(concatListPath, segmentFiles.map(f => `file '${path.resolve(f)}'`).join("\n") + "\n");

  const concatResult = await $`ffmpeg -y -f concat -safe 0 -i ${concatListPath} -i ${inP} -map 0:v -map 1:a -c:v copy -c:a copy -shortest ${outP}`.nothrow();

  // Cleanup temp files
  for (const f of segmentFiles) await fs.unlink(f).catch(() => {});
  await fs.unlink(concatListPath).catch(() => {});

  if (concatResult.exitCode !== 0) {
    console.log(`  clip ${clipIdx}: concat gagal, fallback ke center-crop`);
    return fallbackCenterCrop(inP, outP);
  }
}

async function fallbackCenterCrop(inP: string, outP: string): Promise<void> {
  const filter = filterFor("center-crop");
  await $`ffmpeg -y -i ${inP} -filter_complex ${filter} -c:v libx264 -preset veryfast -c:a copy ${outP}`.quiet();
}

// ── static filter modes ──────────────────────────────────────────────────────

function filterFor(mode: "split-vertical" | "center-crop" | "letterbox"): string {
  switch (mode) {
    case "split-vertical":
      return [
        "[0:v]split=2[a][b]",
        "[a]crop=iw/2:ih:0:0,scale=1080:960:flags=lanczos[top]",
        "[b]crop=iw/2:ih:iw/2:0,scale=1080:960:flags=lanczos[bot]",
        "[top][bot]vstack=inputs=2",
      ].join(";");
    case "center-crop":
      return "[0:v]crop=ih*9/16:ih,scale=1080:1920:flags=lanczos";
    case "letterbox":
      return "[0:v]scale=1080:-2:flags=lanczos,pad=1080:1920:0:(oh-ih)/2:color=black";
  }
}

// ── utils ────────────────────────────────────────────────────────────────────

async function fileExists(p: string): Promise<boolean> {
  try { await fs.access(p); return true; } catch { return false; }
}
