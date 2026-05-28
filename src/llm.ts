import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { Codex } from "@openai/codex-sdk";
import type { ClipSpec } from "./types.ts";

export type Platform = "anthropic" | "openai" | "codex";

/**
 * Call an LLM and return parsed ClipSpec[].
 * Platform + model dibaca dari env: DISINGKAT_PLATFORM + DISINGKAT_MODEL.
 * systemPrompt = instructions + config (cacheable di Anthropic)
 * userPrompt   = transcript (per-request)
 */
export async function analyzeWithLLM(
  modelId: string,
  systemPrompt: string,
  userPrompt: string,
): Promise<ClipSpec[]> {
  const platform = resolvePlatform(modelId);
  process.stdout.write(`[llm] ${platform}/${modelId}...\n`);

  let text: string;
  if (platform === "anthropic") {
    text = await callAnthropic(modelId, systemPrompt, userPrompt);
  } else if (platform === "codex") {
    text = await callCodex(systemPrompt, userPrompt);
  } else {
    text = await callOpenAI(modelId, systemPrompt, userPrompt);
  }

  return parseClips(text);
}

/** Resolve platform dari DISINGKAT_PLATFORM env, fallback inferensi dari model ID */
function resolvePlatform(modelId: string): Platform {
  const env = process.env.DISINGKAT_PLATFORM as Platform | undefined;
  if (env === "anthropic" || env === "openai" || env === "codex") return env;
  // Inferensi dari model ID
  if (modelId.startsWith("claude-")) return "anthropic";
  if (modelId.startsWith("codex")) return "codex";
  return "openai";
}

// ─── Anthropic ─────────────────────────────────────────────────────────────

async function callAnthropic(
  modelId: string,
  systemPrompt: string,
  userPrompt: string,
): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set");

  const client = new Anthropic({ apiKey });

  // Adaptive thinking — Opus 4.6+ only
  const useThinking = /opus-4/.test(modelId);

  const stream = client.messages.stream({
    model: modelId,
    max_tokens: 4096,
    ...(useThinking ? { thinking: { type: "adaptive" } } : {}),
    system: [
      {
        type: "text",
        text: systemPrompt,
        // Cache instructions — transcript (user msg) tetap variable
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [{ role: "user", content: userPrompt }],
  });

  const dotInterval = startDots();
  try {
    const msg = await stream.finalMessage();
    process.stdout.write("\n");
    return msg.content
      .filter((b) => b.type === "text")
      .map((b) => (b as { type: "text"; text: string }).text)
      .join("");
  } finally {
    stopDots(dotInterval);
  }
}

// ─── OpenAI chat completions ───────────────────────────────────────────────

async function callOpenAI(
  modelId: string,
  systemPrompt: string,
  userPrompt: string,
): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY not set");

  const client = new OpenAI({ apiKey });

  const stream = await client.chat.completions.create({
    model: modelId,
    stream: true,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user",   content: userPrompt },
    ],
  });

  let text = "";
  const dotInterval = startDots();
  try {
    for await (const chunk of stream) {
      text += chunk.choices[0]?.delta?.content ?? "";
    }
    process.stdout.write("\n");
    return text;
  } finally {
    stopDots(dotInterval);
  }
}

// ─── Codex SDK (OAuth session, ~/.codex/auth.json) ─────────────────────────

async function callCodex(
  systemPrompt: string,
  userPrompt: string,
): Promise<string> {
  const codex = new Codex();

  const thread = codex.startThread({
    approvalPolicy: "never",      // non-interactive, no approval prompts
    sandboxMode: "read-only",     // ga perlu tulis file apapun
    networkAccessEnabled: false,  // ga perlu internet
    skipGitRepoCheck: true,       // kita bukan di git context yang relevan
  });

  const dotInterval = startDots();
  try {
    // Gabungkan system + user prompt jadi satu input karena SDK ga punya
    // parameter system terpisah
    const fullPrompt = `${systemPrompt}\n\n---\n\n${userPrompt}`;
    const turn = await thread.run(fullPrompt);
    process.stdout.write("\n");
    return turn.finalResponse;
  } finally {
    stopDots(dotInterval);
  }
}

// ─── JSON extraction ───────────────────────────────────────────────────────

function parseClips(raw: string): ClipSpec[] {
  const stripped = raw
    .replace(/^```(?:json)?\s*/im, "")
    .replace(/\s*```\s*$/im, "")
    .trim();

  const match = stripped.match(/\[[\s\S]*\]/);
  if (!match) throw new Error(`LLM response has no JSON array:\n${raw.slice(0, 500)}`);

  let parsed: unknown;
  try {
    parsed = JSON.parse(match[0]);
  } catch (e) {
    throw new Error(`Failed to parse LLM JSON: ${e}\n\nRaw:\n${match[0].slice(0, 500)}`);
  }

  if (!Array.isArray(parsed)) throw new Error("LLM response is not a JSON array");

  return parsed.map((item, i) => {
    if (typeof item !== "object" || item === null) throw new Error(`clips[${i}] is not an object`);
    const c = item as Record<string, unknown>;
    if (typeof c.start !== "number" || typeof c.end !== "number") {
      throw new Error(`clips[${i}] missing numeric start/end`);
    }
    return {
      start: c.start as number,
      end: c.end as number,
      title: typeof c.title === "string" ? c.title : undefined,
      reason: typeof c.reason === "string" ? c.reason : undefined,
    } satisfies ClipSpec;
  });
}

// ─── Progress dots ─────────────────────────────────────────────────────────

function startDots(): ReturnType<typeof setInterval> {
  return setInterval(() => process.stdout.write("."), 1000);
}

function stopDots(id: ReturnType<typeof setInterval>): void {
  clearInterval(id);
}
