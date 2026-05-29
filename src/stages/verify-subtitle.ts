import fs from "node:fs/promises";
import { Glob } from "bun";
import type { VideoId } from "../types.ts";
import { paths, DEFAULT_SUBTITLE_PROMPT_PATH } from "../workdir.ts";
import { callLLM } from "../llm.ts";

export interface VerifyInput {
  videoId: VideoId;
  subtitlePromptPath?: string;
}

export interface VerifyOutput {
  videoId: VideoId;
  wordsPaths: string[];
}

export class VerifyRequired extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "VerifyRequired";
  }
}

interface Word {
  word: string;
  start: number;
  end: number;
}

export async function run(input: VerifyInput): Promise<VerifyOutput> {
  const p = paths(input.videoId);
  const systemPrompt = await fs.readFile(
    input.subtitlePromptPath ?? DEFAULT_SUBTITLE_PROMPT_PATH,
    "utf-8",
  );

  const glob = new Glob("clip_*_words.json");
  const wordsFiles: string[] = [];
  for await (const f of glob.scan(p.data)) wordsFiles.push(f);
  wordsFiles.sort();

  if (wordsFiles.length === 0) {
    throw new Error("Tidak ada file words.json — jalankan stage 'transcribe' dulu.");
  }

  const wordsPaths = wordsFiles.map(f => `${p.data}/${f}`);
  const modelId = process.env.DISINGKAT_MODEL;

  if (modelId) {
    // Kumpulkan semua transcript, kirim sekaligus dalam 1 API call
    const allWords: Word[][] = [];
    for (const wp of wordsPaths) {
      const words: Word[] = JSON.parse(await fs.readFile(wp, "utf-8"));
      allWords.push(words);
    }

    const nonEmpty = allWords.filter(w => w.length > 0);
    if (nonEmpty.length > 0) {
      const userPrompt = allWords
        .map((words, i) => {
          const text = words.map(w => w.word).join(" ");
          return `## Clip ${i + 1}\n${text || "(kosong)"}`;
        })
        .join("\n\n");

      console.log(`  verifying ${allWords.length} clip(s) via LLM (1 call)...`);
      let raw: string;
      try {
        raw = await callLLM(modelId, systemPrompt, userPrompt);
      } catch (e) {
        console.log(`  [warn] LLM gagal, skip verifikasi — ${e}`);
        raw = "";
      }

      // Pecah response per clip
      const sections = splitBySections(raw, allWords.length);

      for (let i = 0; i < wordsPaths.length; i++) {
        const words = allWords[i];
        if (words.length === 0) continue;

        const replacements = parseReplacements(sections[i] ?? "");
        if (replacements.size === 0) {
          console.log(`  clip ${i + 1}: tidak ada koreksi`);
          continue;
        }

        let count = 0;
        for (const w of words) {
          const fix = replacements.get(w.word.toLowerCase());
          if (fix !== undefined) { w.word = fix; count++; }
        }

        await fs.writeFile(wordsPaths[i], JSON.stringify(words, null, 2), "utf-8");
        console.log(`  clip ${i + 1}: ${count} kata dikoreksi (${replacements.size} rule)`);
      }
    }
  } else {
    // Manual mode: buka di editor, stop pipeline
    const { $ } = await import("bun");
    const editor = process.env.EDITOR ?? process.env.VISUAL ?? "open";
    for (const wp of wordsPaths) {
      await $`${editor} ${wp}`.nothrow();
    }

    throw new VerifyRequired(
      `Tidak ada LLM dikonfigurasi — file subtitle dibuka di editor.\n` +
      `Edit kata-kata yang salah (jangan ubah "start"/"end"), lalu:\n` +
      `  bun run disingkat → Lanjutin → burn-subtitle\n\n` +
      `Tip: jalankan \`bun run configure\` untuk setup auto-verify via LLM.\n\n` +
      `File:\n` + wordsPaths.map(p => `  ${p}`).join("\n"),
    );
  }

  return { videoId: input.videoId, wordsPaths };
}

// ── helpers ───────────────────────────────────────────────────────────────────

/**
 * Pecah response LLM berdasarkan header "## Clip N".
 * Return array string per clip, index 0 = clip 1.
 * Kalau tidak ada header, anggap semua untuk clip 1.
 */
function splitBySections(raw: string, clipCount: number): string[] {
  const sections: string[] = new Array(clipCount).fill("");
  const headerRe = /^##\s*Clip\s*(\d+)\s*$/im;
  const parts = raw.split(headerRe);
  // parts: ["preamble", "1", "content1", "2", "content2", ...]
  for (let i = 1; i < parts.length - 1; i += 2) {
    const idx = parseInt(parts[i], 10) - 1;
    if (idx >= 0 && idx < clipCount) {
      sections[idx] = parts[i + 1] ?? "";
    }
  }
  // Fallback: tidak ada header → semua masuk clip 1
  if (parts.length === 1) sections[0] = raw;
  return sections;
}

/**
 * Parse format koreksi dari LLM:
 *   salah -> benar
 *   pak joko -> Pak Joko
 *
 * Return Map<original_lowercase, replacement>
 */
function parseReplacements(raw: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const line of raw.split("\n")) {
    const match = line.match(/^(.+?)\s*->\s*(.+)$/);
    if (!match) continue;
    const from = match[1].trim();
    const to   = match[2].trim();
    if (from && to && from !== to) {
      map.set(from.toLowerCase(), to);
    }
  }
  return map;
}
