import { $ } from "bun";
import fs from "node:fs/promises";
import type { ClipSpec, RenderOutput, VideoId } from "../types.ts";
import { paths } from "../workdir.ts";
import { parseVtt, sliceToSrt } from "../subtitle.ts";

export interface RenderInput {
  videoId: VideoId;
}

const SUBTITLE_STYLE =
  "Fontname=Arial,Fontsize=18,PrimaryColour=&HFFFFFF&,OutlineColour=&H000000&,BorderStyle=1,Outline=2,Shadow=0,MarginV=80,Alignment=2";

export async function run(input: RenderInput): Promise<RenderOutput> {
  const p = paths(input.videoId);
  const clips: ClipSpec[] = JSON.parse(await fs.readFile(p.clips, "utf-8"));
  const vtt = await fs.readFile(p.subtitle, "utf-8");
  const cues = parseVtt(vtt);

  const outPaths: string[] = [];

  for (let i = 0; i < clips.length; i++) {
    const c = clips[i];
    const srtPath = p.clipSrt(i + 1);
    const srt = sliceToSrt(cues, c.start, c.end);
    await fs.writeFile(srtPath, srt);

    const inP = p.reframed(i + 1);
    const outP = p.final(i + 1);
    const vf = `subtitles=${srtPath}:force_style='${SUBTITLE_STYLE}'`;
    await $`ffmpeg -y -i ${inP} -vf ${vf} -c:v libx264 -preset veryfast -c:a copy ${outP}`.quiet();
    outPaths.push(outP);
  }

  return { videoId: input.videoId, finalPaths: outPaths };
}
