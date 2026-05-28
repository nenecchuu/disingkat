import { $ } from "bun";
import { Glob } from "bun";
import type { ReframeOutput, VideoId } from "../types.ts";
import { paths } from "../workdir.ts";

export interface ReframeInput {
  videoId: VideoId;
  mode?: "split-vertical" | "center-crop" | "letterbox";
}

export async function run(input: ReframeInput): Promise<ReframeOutput> {
  const p = paths(input.videoId);
  const mode = input.mode ?? "split-vertical";

  const glob = new Glob("clip_*_raw.mp4");
  const rawFiles: string[] = [];
  for await (const f of glob.scan(p.base)) rawFiles.push(f);
  rawFiles.sort();

  const filter = filterFor(mode);
  const outPaths: string[] = [];

  for (let i = 0; i < rawFiles.length; i++) {
    const inP = `${p.base}/${rawFiles[i]}`;
    const outP = p.reframed(i + 1);
    await $`ffmpeg -y -i ${inP} -filter_complex ${filter} -c:v libx264 -preset veryfast -c:a copy ${outP}`.quiet();
    outPaths.push(outP);
  }

  return { videoId: input.videoId, clipPaths: outPaths };
}

function filterFor(mode: NonNullable<ReframeInput["mode"]>): string {
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
