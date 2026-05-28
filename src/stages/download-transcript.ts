import { $ } from "bun";
import path from "node:path";
import type { DownloadTranscriptOutput } from "../types.ts";
import { ensureDir, extractVideoId, paths } from "../workdir.ts";

export interface DownloadTranscriptInput {
  url: string;
}

const SCRIPT = path.join(import.meta.dir, "../../scripts/get_transcript.py");

export async function run(input: DownloadTranscriptInput): Promise<DownloadTranscriptOutput> {
  const videoId = extractVideoId(input.url);
  const p = paths(videoId);
  await ensureDir(p.base);

  const result = await $`python3 ${SCRIPT} ${input.url} ${p.base}`.text();
  const lang = result.trim().replace("lang:", "");
  console.log(`  lang: ${lang}`);

  return { videoId, subtitlePath: p.subtitle };
}
