import fs from "node:fs/promises";
import { parse as parseYaml } from "yaml";
import type { AnalyzeOutput, ClipConfig, ClipSpec, VideoId } from "../types.ts";
import { DEFAULT_CONFIG_PATH, DEFAULT_PROMPT_PATH, paths } from "../workdir.ts";
import { analyzeWithLLM } from "../llm.ts";

export interface AnalyzeInput {
  videoId: VideoId;
  promptTemplatePath?: string;
  configPath?: string;
}

export async function run(input: AnalyzeInput): Promise<AnalyzeOutput> {
  const p = paths(input.videoId);

  if (await fileExists(p.clips)) {
    const clips: ClipSpec[] = JSON.parse(await fs.readFile(p.clips, "utf-8"));
    return { videoId: input.videoId, clips };
  }

  const transcript = await fs.readFile(p.transcript, "utf-8");
  const config = parseYaml(
    await fs.readFile(input.configPath ?? DEFAULT_CONFIG_PATH, "utf-8"),
  ) as ClipConfig;
  const template = await fs.readFile(
    input.promptTemplatePath ?? DEFAULT_PROMPT_PATH,
    "utf-8",
  );

  const { systemPrompt, userPrompt } = splitPrompt(template, config, transcript);

  // Auto mode: kalau DISINGKAT_MODEL di-set via `bun run configure`, langsung call LLM
  const modelId = process.env.DISINGKAT_MODEL;
  if (modelId) {
    const clips = await analyzeWithLLM(modelId, systemPrompt, userPrompt);
    await fs.writeFile(p.clips, JSON.stringify(clips, null, 2));
    return { videoId: input.videoId, clips };
  }

  // Manual mode: tulis prompt ke file, stop
  const fullPrompt = systemPrompt + "\n\n---\n\n" + userPrompt;
  await fs.writeFile(p.prompt, fullPrompt);

  throw new ManualStepRequired(
    `Prompt written to: ${p.prompt}\n` +
      `1. Paste ke Claude/ChatGPT\n` +
      `2. Simpan JSON response ke: ${p.clips}\n` +
      `3. Re-run \`bun run disingkat\` → 'Lanjutin video yang udah ada'\n\n` +
      `Tip: jalanin \`bun run configure\` untuk setup auto-analyze.`,
  );
}

export class ManualStepRequired extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "ManualStepRequired";
  }
}

/**
 * Split template jadi system (instructions + config, cacheable) dan
 * user message (transcript, per-request). Split point: placeholder {{subtitle}}.
 */
function splitPrompt(
  template: string,
  config: ClipConfig,
  transcript: string,
): { systemPrompt: string; userPrompt: string } {
  const ctx: Record<string, string> = {
    audience: config.audience,
    tone: config.tone ?? "natural, engaging",
    topics_of_interest: bulletList(config.topics_of_interest),
    keywords: bulletList(config.keywords),
    exclude: bulletList(config.exclude),
    duration_min: String(config.duration.min),
    duration_max: String(config.duration.max),
    subtitle: "{{TRANSCRIPT_PLACEHOLDER}}",
  };

  const rendered = template.replace(/\{\{(\w+)\}\}/g, (_, key) => ctx[key] ?? "");

  const splitIdx = rendered.indexOf("{{TRANSCRIPT_PLACEHOLDER}}");
  if (splitIdx !== -1) {
    const systemPrompt = rendered.slice(0, splitIdx).trimEnd();
    const tail = rendered.slice(splitIdx + "{{TRANSCRIPT_PLACEHOLDER}}".length).trimStart();
    const userPrompt = transcript + (tail ? "\n\n" + tail : "");
    return { systemPrompt, userPrompt };
  }

  // Fallback: whole template jadi system, transcript jadi user
  return { systemPrompt: rendered, userPrompt: transcript };
}

function bulletList(items: string[]): string {
  if (!items || items.length === 0) return "(none)";
  return items.map((x) => `- ${x}`).join("\n");
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}
