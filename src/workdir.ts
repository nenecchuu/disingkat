import path from "node:path";
import fs from "node:fs/promises";
import type { VideoId } from "./types.ts";

export const WORKDIR_ROOT = process.env.DISINGKAT_WORKDIR ?? "./workdir";
export const DEFAULT_PROMPT_PATH = "./configs/prompt.md";
export const DEFAULT_CONFIG_PATH = "./configs/clip_config.yaml";

export function workdirFor(videoId: VideoId): string {
  return path.join(WORKDIR_ROOT, videoId);
}

export function pad(n: number): string {
  return String(n).padStart(2, "0");
}

export function paths(videoId: VideoId) {
  const base = workdirFor(videoId);
  return {
    base,
    source: path.join(base, "source.mp4"),
    subtitle: path.join(base, "subtitle.vtt"),
    transcript: path.join(base, "transcript.txt"),
    prompt: path.join(base, "prompt.txt"),
    clips: path.join(base, "clips.json"),
    raw: (i: number) => path.join(base, `clip_${pad(i)}_raw.mp4`),
    reframed: (i: number) => path.join(base, `clip_${pad(i)}_reframed.mp4`),
    final: (i: number) => path.join(base, `clip_${pad(i)}_final.mp4`),
    clipSrt: (i: number) => path.join(base, `clip_${pad(i)}.srt`),
  };
}

export async function ensureDir(p: string): Promise<void> {
  await fs.mkdir(p, { recursive: true });
}

export function extractVideoId(url: string): VideoId {
  const m = url.match(/(?:v=|youtu\.be\/|shorts\/)([A-Za-z0-9_-]{11})/);
  if (!m) throw new Error(`Cannot extract video id from URL: ${url}`);
  return m[1];
}
