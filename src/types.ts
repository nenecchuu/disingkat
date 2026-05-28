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

export interface RenderOutput {
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
}

export type Stage = "download-transcript" | "analyze-transcript" | "download-video" | "process-editing" | "process-rendering";
