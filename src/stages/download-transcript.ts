import { $ } from "bun";
import path from "node:path";
import type { DownloadTranscriptOutput } from "../types.ts";
import { ensureWorkdir, extractVideoId, paths } from "../workdir.ts";

export interface DownloadTranscriptInput {
  url: string;
}

const SCRIPT = path.join(import.meta.dir, "../../scripts/get_transcript.py");

export async function run(input: DownloadTranscriptInput): Promise<DownloadTranscriptOutput> {
  const videoId = extractVideoId(input.url);
  const p = paths(videoId);
  await ensureWorkdir(videoId);

  const result = await $`uv run ${SCRIPT} ${input.url} ${p.data}`.text();
  const lang = result.trim().replace("lang:", "");
  console.log(`  lang: ${lang}`);

  return { videoId, subtitlePath: p.subtitle };
}
