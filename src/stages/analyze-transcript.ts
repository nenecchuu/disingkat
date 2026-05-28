import fs from "node:fs/promises";
import { parse as parseYaml } from "yaml";
import type { AnalyzeOutput, ClipConfig, ClipSpec, VideoId } from "../types.ts";
import { DEFAULT_CONFIG_PATH, DEFAULT_PROMPT_PATH, paths } from "../workdir.ts";

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

  const subtitle = await fs.readFile(p.transcript, "utf-8");
  const config = parseYaml(
    await fs.readFile(input.configPath ?? DEFAULT_CONFIG_PATH, "utf-8"),
  ) as ClipConfig;
  const template = await fs.readFile(
    input.promptTemplatePath ?? DEFAULT_PROMPT_PATH,
    "utf-8",
  );

  const prompt = renderPrompt(template, config, subtitle);
  await fs.writeFile(p.prompt, prompt);

  throw new ManualStepRequired(
    `Prompt written to: ${p.prompt}\n` +
      `1. Paste it to Claude/ChatGPT\n` +
      `2. Save the JSON response to: ${p.clips}\n` +
      `3. Re-run \`disingkat analyze ${input.videoId}\` (or continue with cut)`,
  );
}

export class ManualStepRequired extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "ManualStepRequired";
  }
}

function renderPrompt(
  template: string,
  config: ClipConfig,
  subtitle: string,
): string {
  const ctx: Record<string, string> = {
    audience: config.audience,
    tone: config.tone ?? "natural, engaging",
    topics_of_interest: bulletList(config.topics_of_interest),
    keywords: bulletList(config.keywords),
    exclude: bulletList(config.exclude),
    duration_min: String(config.duration.min),
    duration_max: String(config.duration.max),
    subtitle,
  };
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => ctx[key] ?? "");
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
