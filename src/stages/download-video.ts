import { $ } from "bun";
import fs from "node:fs/promises";
import { parse as parseYaml } from "yaml";
import type { ClipConfig, ClipSpec, CutOutput, VideoId } from "../types.ts";
import { DEFAULT_CONFIG_PATH, paths } from "../workdir.ts";

export interface CutInput {
  videoId: VideoId;
  configPath?: string;
}

function toYtTimestamp(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = (sec % 60).toFixed(3);
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(6, "0")}`;
}

export async function run(input: CutInput): Promise<CutOutput> {
  const p = paths(input.videoId);
  const clips: ClipSpec[] = JSON.parse(await fs.readFile(p.clips, "utf-8"));
  const config = parseYaml(
    await fs.readFile(input.configPath ?? DEFAULT_CONFIG_PATH, "utf-8"),
  ) as ClipConfig;

  const endBuffer = config.end_buffer ?? 1.5;
  const url = `https://www.youtube.com/watch?v=${input.videoId}`;
  const outPaths: string[] = [];

  for (let i = 0; i < clips.length; i++) {
    const c = clips[i];
    const out = p.raw(i + 1);
    const section = `*${toYtTimestamp(c.start)}-${toYtTimestamp(c.end + endBuffer)}`;

    await $`yt-dlp \
      --download-sections ${section} \
      -f "bv*[height<=1080]+ba/b[height<=1080]" \
      --merge-output-format mp4 \
      -o ${out} \
      ${url}`;

    outPaths.push(out);
  }

  return { videoId: input.videoId, clipPaths: outPaths };
}
