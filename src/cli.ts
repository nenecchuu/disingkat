#!/usr/bin/env bun
import { select, input, confirm } from "@inquirer/prompts";
import fs from "node:fs/promises";
import * as downloadTranscript from "./stages/download-transcript.ts";
import * as analyzeTranscript from "./stages/analyze-transcript.ts";
import * as downloadVideo from "./stages/download-video.ts";
import * as processEditing from "./stages/process-editing.ts";
import * as transcribe from "./stages/transcribe.ts";
import * as verifySubtitle from "./stages/verify-subtitle.ts";
import * as burnSubtitle from "./stages/burn-subtitle.ts";
import * as pipeline from "./pipeline.ts";
import { ManualStepRequired } from "./stages/analyze-transcript.ts";
import { VerifyRequired } from "./stages/verify-subtitle.ts";
import type { Stage } from "./types.ts";
import { WORKDIR_ROOT } from "./workdir.ts";

const STAGES: Stage[] = [
  "download-transcript",
  "analyze-transcript",
  "download-video",
  "process-editing",
  "transcribe",
  "verify-subtitle",
  "burn-subtitle",
];

type EditingMode = "center-crop" | "speaker-crop" | "split-vertical" | "letterbox";
type WhisperModel = "tiny" | "base" | "small" | "medium" | "large";

// ── shared prompts ────────────────────────────────────────────────────────────

async function askEditingMode(): Promise<EditingMode> {
  return select({
    message: "Mode reframe:",
    choices: [
      { name: "center-crop    — potong tengah ke 9:16 (default)", value: "center-crop" },
      { name: "speaker-crop   — auto-crop ke speaker yang lagi ngomong", value: "speaker-crop" },
      { name: "split-vertical — 2 orang stack vertikal", value: "split-vertical" },
      { name: "letterbox      — full frame + black bars", value: "letterbox" },
    ],
    default: "center-crop",
  }) as Promise<EditingMode>;
}

async function askWhisperModel(): Promise<WhisperModel> {
  return select({
    message: "Whisper model untuk subtitle:",
    choices: [
      { name: "base   — cepat, akurasi cukup (default)", value: "base" },
      { name: "small  — lebih akurat, ~2x lebih lambat", value: "small" },
      { name: "medium — paling akurat, ~5x lebih lambat", value: "medium" },
      { name: "tiny   — paling cepat, akurasi minimal", value: "tiny" },
    ],
    default: "base",
  }) as Promise<WhisperModel>;
}

async function askWithSubtitle(): Promise<boolean> {
  return confirm({ message: "Tambahkan subtitle?", default: false });
}

function willRun(from: Stage, to: Stage, stage: Stage): boolean {
  return STAGES.indexOf(from) <= STAGES.indexOf(stage) &&
         STAGES.indexOf(to)   >= STAGES.indexOf(stage);
}

// ── flows ─────────────────────────────────────────────────────────────────────

async function main() {
  const action = await select({
    message: "Mau ngapain?",
    choices: [
      { name: "Full  — proses video baru dari URL YouTube", value: "new" },
      { name: "Existing — lanjutin video yang udah ada", value: "continue" },
      { name: "Run   — jalanin 1 stage doang", value: "single" },
      { name: "Keluar", value: "quit" },
    ],
  });

  if (action === "quit") return;
  if (action === "new") return runNew();
  if (action === "continue") return runContinue();
  if (action === "single") return runSingle();
}

async function runNew() {
  const url = await input({
    message: "YouTube URL:",
    validate: (v) =>
      /^https?:\/\/(www\.)?(youtube\.com|youtu\.be)/.test(v.trim()) ||
      "URL YouTube ga valid",
  });

  const editingMode  = await askEditingMode();
  const withSubtitle = await askWithSubtitle();
  const whisperModel = withSubtitle ? await askWhisperModel() : undefined;
  const to: Stage    = withSubtitle ? "burn-subtitle" : "process-editing";

  await pipeline.run({
    urlOrId: url.trim(),
    from: "download-transcript",
    to,
    editingMode,
    whisperModel,
  });
}

async function runContinue() {
  const videoId = await pickVideoId();
  if (!videoId) return;

  const from = (await select({
    message: "Mulai dari stage mana?",
    choices: STAGES.filter((s) => s !== "download-transcript").map((s) => ({ name: s, value: s })),
    default: "analyze-transcript",
  })) as Stage;

  const editingMode  = willRun(from, "process-editing", "process-editing") ? await askEditingMode()  : undefined;
  const withSubtitle = await askWithSubtitle();
  const whisperModel = withSubtitle ? await askWhisperModel() : undefined;
  const to: Stage    = withSubtitle ? "burn-subtitle" : "process-editing";

  // Kalau from sudah melewati process-editing, to harus minimal from
  const effectiveTo = STAGES.indexOf(to) >= STAGES.indexOf(from) ? to : "burn-subtitle";

  await pipeline.run({ urlOrId: videoId, from, to: effectiveTo, editingMode, whisperModel });
}

async function runSingle() {
  const stage = (await select({
    message: "Stage yang mau dijalanin:",
    choices: STAGES.map((s) => ({ name: s, value: s })),
  })) as Stage;

  if (stage === "download-transcript") {
    const url = await input({
      message: "YouTube URL:",
      validate: (v) =>
        /^https?:\/\/(www\.)?(youtube\.com|youtu\.be)/.test(v.trim()) ||
        "URL YouTube ga valid",
    });
    const out = await downloadTranscript.run({ url: url.trim() });
    console.log(`\n[done] videoId: ${out.videoId}`);
    console.log(`  subtitle: ${out.subtitlePath}`);
    return;
  }

  const videoId = await pickVideoId();
  if (!videoId) return;

  switch (stage) {
    case "analyze-transcript": {
      const out = await analyzeTranscript.run({ videoId });
      console.log(`\n[done] ${out.clips.length} clip(s)`);
      return;
    }
    case "download-video": {
      const out = await downloadVideo.run({ videoId });
      console.log(`\n[done] ${out.clipPaths.length} clip(s) downloaded`);
      return;
    }
    case "process-editing": {
      const mode = await askEditingMode();
      const out = await processEditing.run({ videoId, mode });
      console.log(`\n[done] ${out.clipPaths.length} clip(s) edited`);
      return;
    }
    case "transcribe": {
      const whisperModel = await askWhisperModel();
      const out = await transcribe.run({ videoId, model: whisperModel });
      console.log(`\n[done] ${out.wordsPaths.length} clip(s) transcribed`);
      return;
    }
    case "verify-subtitle": {
      await verifySubtitle.run({ videoId });
      return;
    }
    case "burn-subtitle": {
      const out = await burnSubtitle.run({ videoId });
      console.log(`\n[done] ${out.finalPaths.length} clip(s) final:`);
      for (const f of out.finalPaths) console.log(`  - ${f}`);
      return;
    }
  }
}

// ── helpers ───────────────────────────────────────────────────────────────────

async function pickVideoId(): Promise<string | null> {
  const existing = await listWorkdirVideos();
  if (existing.length === 0) {
    const v = await input({
      message: "Video ID (workdir kosong, ketik manual):",
      validate: (v) => v.trim().length > 0 || "video ID ga boleh kosong",
    });
    return v.trim();
  }

  const choice = await select({
    message: "Pilih video:",
    choices: [
      ...existing.map((v) => ({ name: v, value: v })),
      { name: "[ketik manual]", value: "__manual__" },
      { name: "[batal]", value: "__cancel__" },
    ],
  });

  if (choice === "__cancel__") return null;
  if (choice === "__manual__") {
    const v = await input({
      message: "Video ID:",
      validate: (v) => v.trim().length > 0 || "video ID ga boleh kosong",
    });
    return v.trim();
  }
  return choice;
}

async function listWorkdirVideos(): Promise<string[]> {
  try {
    const entries = await fs.readdir(WORKDIR_ROOT, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => e.name).sort();
  } catch {
    return [];
  }
}

main().catch((err) => {
  if (err instanceof ManualStepRequired) {
    console.log(`\n[manual step]\n${err.message}`);
    return;
  }
  if (err instanceof VerifyRequired) {
    console.log(`\n[verify subtitle]\n${err.message}`);
    return;
  }
  if (err?.name === "ExitPromptError") return;
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
