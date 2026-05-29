import path from "node:path";
import fs from "node:fs/promises";
import type { VideoId } from "./types.ts";

export const WORKDIR_ROOT = process.env.DISINGKAT_WORKDIR ?? "./workdir";
export const DEFAULT_PROMPT_PATH = "./configs/prompt.md";
export const DEFAULT_CONFIG_PATH = "./configs/clip_config.yaml";
export const DEFAULT_SUBTITLE_PROMPT_PATH = "./configs/subtitle_prompt.md";
export const MODELS_DIR = "./scripts/models";

export function workdirFor(videoId: VideoId): string {
  return path.join(WORKDIR_ROOT, videoId);
}

export function pad(n: number): string {
  return String(n).padStart(2, "0");
}

export function paths(videoId: VideoId) {
  const base    = workdirFor(videoId);
  const raw     = path.join(base, "raw");
  const reframed = path.join(base, "reframed");
  const data    = path.join(base, "data");
  return {
    base,
    raw,
    reframed,
    data,
    // data/
    subtitle:   path.join(data, "subtitle.vtt"),
    transcript: path.join(data, "transcript.txt"),
    prompt:     path.join(data, "prompt.txt"),
    clips:      path.join(data, "clips.json"),
    clipSrt:    (i: number) => path.join(data, `clip_${pad(i)}.srt`),
    scenes:     (i: number) => path.join(data, `clip_${pad(i)}_scenes.json`),
    speakers:   (i: number) => path.join(data, `clip_${pad(i)}_speaker_events.json`),
    words:      (i: number) => path.join(data, `clip_${pad(i)}_words.json`),
    // reframed/
    reframedClip: (i: number) => path.join(reframed, `clip_${pad(i)}_reframed.mp4`),
    // raw/
    rawClip:    (i: number) => path.join(raw,  `clip_${pad(i)}_raw.mp4`),
    // base/ — hasil akhir
    final:      (i: number) => path.join(base, `clip_${pad(i)}_final.mp4`),
  };
}

export async function ensureWorkdir(videoId: VideoId): Promise<void> {
  const p = paths(videoId);
  await fs.mkdir(p.raw,      { recursive: true });
  await fs.mkdir(p.reframed, { recursive: true });
  await fs.mkdir(p.data,     { recursive: true });
}

export async function ensureDir(p: string): Promise<void> {
  await fs.mkdir(p, { recursive: true });
}

export function extractVideoId(url: string): VideoId {
  const m = url.match(/(?:v=|youtu\.be\/|shorts\/)([A-Za-z0-9_-]{11})/);
  if (!m) throw new Error(`Cannot extract video id from URL: ${url}`);
  return m[1];
}
