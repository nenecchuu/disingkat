import * as downloadTranscript from "./stages/download-transcript.ts";
import * as analyzeTranscript from "./stages/analyze-transcript.ts";
import * as downloadVideo from "./stages/download-video.ts";
import * as processEditing from "./stages/process-editing.ts";
import * as transcribe from "./stages/transcribe.ts";
import * as verifySubtitle from "./stages/verify-subtitle.ts";
import * as burnSubtitle from "./stages/burn-subtitle.ts";
import type { Stage, VideoId } from "./types.ts";
import { extractVideoId } from "./workdir.ts";

const ORDER: Stage[] = [
  "download-transcript",
  "analyze-transcript",
  "download-video",
  "process-editing",
  "transcribe",
  "verify-subtitle",
  "burn-subtitle",
];

export interface PipelineOptions {
  urlOrId: string;
  from?: Stage;
  to?: Stage;
  editingMode?: "center-crop" | "speaker-crop" | "split-vertical" | "letterbox";
  speakerMethod?: "largest-face" | "lip-movement";
  whisperModel?: "tiny" | "base" | "small" | "medium" | "large";
}

export async function run(opts: PipelineOptions): Promise<void> {
  const isUrl = /^https?:\/\//.test(opts.urlOrId);
  const from = opts.from ?? (isUrl ? "download-transcript" : "analyze-transcript");
  const to = opts.to ?? "burn-subtitle";

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
        const out = await processEditing.run({ videoId, mode: opts.editingMode, speakerMethod: opts.speakerMethod });
        console.log(`reframed: ${out.clipPaths.length}`);
        break;
      }
      case "transcribe": {
        const out = await transcribe.run({ videoId, model: opts.whisperModel });
        console.log(`transcribed: ${out.wordsPaths.length} clip(s)`);
        break;
      }
      case "verify-subtitle": {
        await verifySubtitle.run({ videoId });
        break;
      }
      case "burn-subtitle": {
        const out = await burnSubtitle.run({ videoId });
        console.log(`final: ${out.finalPaths.length}`);
        for (const f of out.finalPaths) console.log(`  - ${f}`);
        break;
      }
    }
  }
}
