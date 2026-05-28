#!/usr/bin/env bun
import { select, input } from "@inquirer/prompts";
import fs from "node:fs/promises";
import * as downloadTranscript from "./stages/download-transcript.ts";
import * as analyzeTranscript from "./stages/analyze-transcript.ts";
import * as downloadVideo from "./stages/download-video.ts";
import * as processEditing from "./stages/process-editing.ts";
import * as processRendering from "./stages/process-rendering.ts";
import * as pipeline from "./pipeline.ts";
import { ManualStepRequired } from "./stages/analyze-transcript.ts";
import type { Stage } from "./types.ts";
import { WORKDIR_ROOT } from "./workdir.ts";

const STAGES: Stage[] = [
  "download-transcript",
  "analyze-transcript",
  "download-video",
  "process-editing",
  "process-rendering",
];

async function main() {
  const action = await select({
    message: "Mau ngapain?",
    choices: [
      { name: "Proses video baru (dari URL YouTube)", value: "new" },
      { name: "Lanjutin video yang udah ada", value: "continue" },
      { name: "Jalanin 1 stage doang", value: "single" },
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

  const to = (await select({
    message: "Berhenti di stage mana?",
    choices: STAGES.map((s) => ({ name: s, value: s })),
    default: "process-rendering",
  })) as Stage;

  await pipeline.run({ urlOrId: url.trim(), from: "download-transcript", to });
}

async function runContinue() {
  const videoId = await pickVideoId();
  if (!videoId) return;

  const from = (await select({
    message: "Mulai dari stage mana?",
    choices: STAGES.filter((s) => s !== "download-transcript").map((s) => ({ name: s, value: s })),
    default: "analyze-transcript",
  })) as Stage;

  const to = (await select({
    message: "Berhenti di stage mana?",
    choices: STAGES.filter((s) => STAGES.indexOf(s) >= STAGES.indexOf(from)).map((s) => ({
      name: s,
      value: s,
    })),
    default: "process-rendering",
  })) as Stage;

  await pipeline.run({ urlOrId: videoId, from, to });
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
      const mode = (await select({
        message: "Mode reframe:",
        choices: [
          { name: "split-vertical (2 orang stack vertikal)", value: "split-vertical" },
          { name: "center-crop (potong tengah ke 9:16)", value: "center-crop" },
          { name: "letterbox (full + black bars)", value: "letterbox" },
        ],
        default: "split-vertical",
      })) as "split-vertical" | "center-crop" | "letterbox";
      const out = await processEditing.run({ videoId, mode });
      console.log(`\n[done] ${out.clipPaths.length} clip(s) edited`);
      return;
    }
    case "process-rendering": {
      const out = await processRendering.run({ videoId });
      console.log(`\n[done] ${out.finalPaths.length} clip(s) final:`);
      for (const f of out.finalPaths) console.log(`  - ${f}`);
      return;
    }
  }
}

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
  if (err?.name === "ExitPromptError") return;
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
