import { $ } from "bun";
import { Glob } from "bun";
import type { TranscribeOutput, VideoId } from "../types.ts";
import { paths } from "../workdir.ts";

export interface TranscribeInput {
  videoId: VideoId;
  model?: "tiny" | "base" | "small" | "medium" | "large";
}

export async function run(input: TranscribeInput): Promise<TranscribeOutput> {
  const p = paths(input.videoId);
  const model = input.model ?? "base";

  const glob = new Glob("clip_*_reframed.mp4");
  const reframedFiles: string[] = [];
  for await (const f of glob.scan(p.reframed)) reframedFiles.push(f);
  reframedFiles.sort();

  const wordsPaths: string[] = [];

  for (let i = 0; i < reframedFiles.length; i++) {
    const inP    = `${p.reframed}/${reframedFiles[i]}`;
    const wordsP   = p.words(i + 1);

    console.log(`  clip ${i + 1}: transcribing with whisper '${model}'...`);
    const result = await $`uv run scripts/transcribe_clip.py ${inP} ${wordsP} --model ${model}`.nothrow();

    if (result.exitCode !== 0) {
      console.log(`  clip ${i + 1}: [warn] whisper gagal — ${result.stderr.toString().trim().split("\n").pop()}`);
    }

    wordsPaths.push(wordsP);
  }

  return { videoId: input.videoId, wordsPaths };
}
