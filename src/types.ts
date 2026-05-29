export type VideoId = string;

export interface ClipSpec {
  start: number;
  end: number;
  title?: string;
  reason?: string;
}

export interface DownloadTranscriptOutput {
  videoId: VideoId;
  subtitlePath: string;
}

export interface AnalyzeOutput {
  videoId: VideoId;
  clips: ClipSpec[];
}

export interface CutOutput {
  videoId: VideoId;
  clipPaths: string[];
}

export interface ReframeOutput {
  videoId: VideoId;
  clipPaths: string[];
}

export interface TranscribeOutput {
  videoId: VideoId;
  wordsPaths: string[];
}

export interface BurnOutput {
  videoId: VideoId;
  finalPaths: string[];
}

export interface ClipConfig {
  audience: string;
  topics_of_interest: string[];
  keywords: string[];
  exclude: string[];
  tone?: string;
  duration: { min: number; max: number };
  /** Detik ekstra yang ditambah ke akhir setiap clip saat download. Default: 1.5 */
  end_buffer?: number;
}

export type Stage =
  | "download-transcript"
  | "analyze-transcript"
  | "download-video"
  | "process-editing"
  | "transcribe"
  | "verify-subtitle"
  | "burn-subtitle";
