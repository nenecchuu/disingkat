import * as downloadTranscript from "./stages/download-transcript.ts";
import * as analyzeTranscript from "./stages/analyze-transcript.ts";
import * as downloadVideo from "./stages/download-video.ts";
import * as processEditing from "./stages/process-editing.ts";
import * as processRendering from "./stages/process-rendering.ts";
import type { Stage, VideoId } from "./types.ts";
import { extractVideoId } from "./workdir.ts";

const ORDER: Stage[] = [
  "download-transcript",
  "analyze-transcript",
  "download-video",
  "process-editing",
  "process-rendering",
];

export interface PipelineOptions {
  urlOrId: string;
  from?: Stage;
  to?: Stage;
}

export async function run(opts: PipelineOptions): Promise<void> {
  const isUrl = /^https?:\/\//.test(opts.urlOrId);
  const from = opts.from ?? (isUrl ? "download-transcript" : "analyze-transcript");
  const to = opts.to ?? "process-rendering";

  if (from === "download-transcript" && !isUrl) {
    throw new Error(`Stage 'download-transcript' butuh YouTube URL, bukan: ${opts.urlOrId}`);
  }
  if (from !== "download-transcript" && isUrl) {
    throw new Error(`Stage '${from}' butuh videoId, bukan URL`);
  }

  const fromIdx = ORDER.indexOf(from);
  const toIdx = ORDER.indexOf(to);
  if (fromIdx === -1 || toIdx === -1 || fromIdx > toIdx) {
    throw new Error(`Range tidak valid: ${from} -> ${to}`);
  }

  let videoId: VideoId = isUrl ? extractVideoId(opts.urlOrId) : opts.urlOrId;

  for (let i = fromIdx; i <= toIdx; i++) {
    const stage = ORDER[i];
    console.log(`\n=== ${stage} (${videoId}) ===`);
    switch (stage) {
      case "download-transcript": {
        const out = await downloadTranscript.run({ url: opts.urlOrId });
        videoId = out.videoId;
        console.log(`subtitle: ${out.subtitlePath}`);
        break;
      }
      case "analyze-transcript": {
        const out = await analyzeTranscript.run({ videoId });
        console.log(`clips: ${out.clips.length}`);
        break;
      }
      case "download-video": {
        const out = await downloadVideo.run({ videoId });
        console.log(`raw clips: ${out.clipPaths.length}`);
        break;
      }
      case "process-editing": {
        const out = await processEditing.run({ videoId });
        console.log(`reframed: ${out.clipPaths.length}`);
        break;
      }
      case "process-rendering": {
        const out = await processRendering.run({ videoId });
        console.log(`final: ${out.finalPaths.length}`);
        for (const f of out.finalPaths) console.log(`  - ${f}`);
        break;
      }
    }
  }
}
