#!/usr/bin/env bun
import { select, input, confirm } from "@inquirer/prompts";
import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";

const ENV_PATH = path.resolve(process.cwd(), ".env");

type Platform = "anthropic" | "openai" | "codex";

async function main() {
  const current = await readEnv();
  const currentModel = current.DISINGKAT_MODEL;
  const currentPlatform = current.DISINGKAT_PLATFORM as Platform | undefined;

  const isActive = !!(currentModel && currentPlatform);

  // Show current state
  console.log("\nKonfigurasi saat ini:");
  if (isActive) {
    console.log(`  Platform     : ${platformLabel(currentPlatform!)}`);
    console.log(`  Model        : ${currentModel}`);
    if (currentPlatform === "codex") {
      const authed = await codexIsAuthenticated();
      console.log(`  Auth         : ${authed ? "✓ logged in (~/.codex/auth.json)" : "✗ belum login"}`);
    } else {
      const keyVar = apiKeyVar(currentPlatform!);
      console.log(`  API key      : ${current[keyVar] ? `✓ set (${mask(current[keyVar])})` : "✗ belum diset"}`);
    }
  } else {
    console.log(`  Auto-analyze : OFF (manual)`);
  }
  console.log();

  if (isActive) {
    // Already configured — show edit menu
    const action = await select({
      message: "Mau ngapain?",
      choices: [
        { name: "Ganti model",       value: "model" },
        { name: "Ganti platform",    value: "platform" },
        { name: "Switch ke manual",  value: "manual" },
        { name: "Batal",             value: "cancel" },
      ],
    });

    if (action === "cancel") return;

    if (action === "manual") {
      await writeEnvKeys({ DISINGKAT_MODEL: null, DISINGKAT_PLATFORM: null });
      console.log("\n[ok] Switched ke manual. Pipeline akan minta copy-paste.");
      return;
    }

    if (action === "platform") {
      await setupPlatform(current, undefined, undefined);
      return;
    }

    if (action === "model") {
      if (currentPlatform === "codex") {
        await configureCodex(current);
      } else {
        await changeModel(current, currentPlatform!, currentModel);
      }
      return;
    }
  } else {
    // Not configured yet — ask to enable
    const enable = await confirm({
      message: "Aktifkan auto-analyze dengan LLM?",
      default: true,
    });
    if (!enable) {
      console.log("\n[ok] Tetap manual.");
      return;
    }
    await setupPlatform(current, undefined, undefined);
  }
}

/** Full platform → API key → model setup flow */
async function setupPlatform(
  current: Record<string, string>,
  defaultPlatform: Platform | undefined,
  defaultModel: string | undefined,
): Promise<void> {
  const platform = (await select({
    message: "Pilih platform:",
    choices: [
      { name: "Anthropic (Claude)", value: "anthropic" },
      { name: "OpenAI",             value: "openai" },
      { name: "Codex",              value: "codex" },
    ],
    default: defaultPlatform ?? "anthropic",
  })) as Platform;

  if (platform === "codex") {
    await configureCodex(current);
    return;
  }

  const keyVar = apiKeyVar(platform);
  const existingKey = current[keyVar];
  let apiKey: string;

  if (existingKey) {
    const reuse = await confirm({
      message: `${keyVar} sudah ada (${mask(existingKey)}). Pakai yang ini?`,
      default: true,
    });
    apiKey = reuse ? existingKey : await promptKey(keyVar);
  } else {
    apiKey = await promptKey(keyVar);
  }

  process.stdout.write("\nFetching model list...");
  let models: { id: string; label: string }[];
  try {
    models = await fetchModels(platform, apiKey);
    process.stdout.write(` ${models.length} model(s) ditemukan.\n`);
  } catch (err) {
    process.stdout.write(" gagal.\n");
    throw new Error(`Gagal fetch model list: ${err instanceof Error ? err.message : err}`);
  }

  if (models.length === 0) throw new Error("Ga ada model yang tersedia.");

  const modelId = await select({
    message: "Pilih model:",
    choices: models.map((m) => ({ name: m.label, value: m.id })),
    default: defaultModel && models.find((m) => m.id === defaultModel) ? defaultModel : models[0].id,
  });

  await writeEnvKeys({ DISINGKAT_PLATFORM: platform, DISINGKAT_MODEL: modelId, [keyVar]: apiKey });
  console.log(`\n[ok] Auto-analyze aktif pakai ${modelId} (${platformLabel(platform)}).`);
}

/** Ganti model di platform yang sama, tanpa tanya API key lagi */
async function changeModel(
  current: Record<string, string>,
  platform: Exclude<Platform, "codex">,
  currentModel: string | undefined,
): Promise<void> {
  const keyVar = apiKeyVar(platform);
  const apiKey = current[keyVar];
  if (!apiKey) throw new Error(`${keyVar} belum diset, jalanin 'ganti platform' dulu.`);

  process.stdout.write("\nFetching model list...");
  let models: { id: string; label: string }[];
  try {
    models = await fetchModels(platform, apiKey);
    process.stdout.write(` ${models.length} model(s) ditemukan.\n`);
  } catch (err) {
    process.stdout.write(" gagal.\n");
    throw new Error(`Gagal fetch model list: ${err instanceof Error ? err.message : err}`);
  }

  if (models.length === 0) throw new Error("Ga ada model yang tersedia.");

  const modelId = await select({
    message: "Pilih model:",
    choices: models.map((m) => ({ name: m.label, value: m.id })),
    default: currentModel && models.find((m) => m.id === currentModel) ? currentModel : models[0].id,
  });

  await writeEnvKeys({ DISINGKAT_MODEL: modelId });
  console.log(`\n[ok] Model diganti ke ${modelId}.`);
}

// ─── Codex OAuth device-code flow ──────────────────────────────────────────

const CODEX_BIN = path.resolve(process.cwd(), "node_modules/.bin/codex");

async function configureCodex(current: Record<string, string>): Promise<void> {
  const alreadyAuthed = await codexIsAuthenticated();

  if (alreadyAuthed) {
    const reauth = await confirm({
      message: "Codex sudah login (~/.codex/auth.json ada). Login ulang?",
      default: false,
    });
    if (!reauth) {
      await writeEnvKeys({ DISINGKAT_PLATFORM: "codex", DISINGKAT_MODEL: "codex" });
      console.log("\n[ok] Auto-analyze aktif pakai Codex (existing session).");
      return;
    }
  }

  console.log("\nBuka link di bawah di browser kamu, lalu selesaikan login ChatGPT:\n");

  await runCodexLogin();

  await writeEnvKeys({ DISINGKAT_PLATFORM: "codex", DISINGKAT_MODEL: "codex" });
  console.log("\n[ok] Auto-analyze aktif pakai Codex.");
}

async function codexIsAuthenticated(): Promise<boolean> {
  const authFile = path.join(process.env.HOME ?? "~", ".codex", "auth.json");
  try {
    await fs.access(authFile);
    return true;
  } catch {
    return false;
  }
}

function runCodexLogin(): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(CODEX_BIN, ["login", "--device-auth"], {
      stdio: "inherit", // URL/code prints directly ke terminal
    });
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`codex login keluar dengan kode ${code}`));
    });
    child.on("error", reject);
  });
}

// ─── Model fetchers ────────────────────────────────────────────────────────

async function fetchModels(
  platform: Platform,
  apiKey: string,
): Promise<{ id: string; label: string }[]> {
  if (platform === "anthropic") return fetchAnthropicModels(apiKey);
  return fetchOpenAIModels(apiKey);
}

async function fetchAnthropicModels(apiKey: string): Promise<{ id: string; label: string }[]> {
  const client = new Anthropic({ apiKey });
  const page = await client.models.list({ limit: 100 });
  return page.data
    .filter((m) => m.type === "model")
    .sort((a, b) => (b.created_at > a.created_at ? 1 : -1))
    .map((m) => ({ id: m.id, label: m.display_name ?? m.id }));
}

async function fetchOpenAIModels(apiKey: string): Promise<{ id: string; label: string }[]> {
  const client = new OpenAI({ apiKey });
  const page = await client.models.list();
  return page.data
    .filter((m) => {
      if (m.owned_by !== "openai" && m.owned_by !== "openai-internal") return false;
      const id = m.id.toLowerCase();
      // Hanya chat/reasoning models
      if (!id.match(/^(gpt-|o[1-9]|chatgpt)/)) return false;
      // Exclude non-text models
      if (id.match(/whisper|tts|dall-e|embed|realtime|transcribe|audio|search/)) return false;
      return true;
    })
    .sort((a, b) => b.created - a.created)
    .map((m) => ({ id: m.id, label: m.id }));
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function platformLabel(p: Platform): string {
  return { anthropic: "Anthropic (Claude)", openai: "OpenAI", codex: "Codex" }[p];
}

function apiKeyVar(p: Exclude<Platform, "codex">): string {
  return p === "anthropic" ? "ANTHROPIC_API_KEY" : "OPENAI_API_KEY";
}

async function promptKey(keyVar: string): Promise<string> {
  return input({
    message: `${keyVar}:`,
    validate: (v) => v.trim().length > 0 || "ga boleh kosong",
  });
}

function mask(s: string): string {
  if (s.length <= 8) return "***";
  return s.slice(0, 6) + "..." + s.slice(-4);
}

// ─── .env helpers ──────────────────────────────────────────────────────────

async function readEnv(): Promise<Record<string, string>> {
  try {
    return parseEnv(await fs.readFile(ENV_PATH, "utf-8"));
  } catch {
    return {};
  }
}

function parseEnv(raw: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    const val = trimmed.slice(idx + 1).trim().replace(/^["']|["']$/g, "");
    result[key] = val;
  }
  return result;
}

async function writeEnvKeys(updates: Record<string, string | null>): Promise<void> {
  let raw = "";
  try {
    raw = await fs.readFile(ENV_PATH, "utf-8");
  } catch {}

  let lines = raw ? raw.split("\n") : [];

  for (const [key, value] of Object.entries(updates)) {
    const pattern = new RegExp(`^\\s*${key}\\s*=`);
    lines = lines.filter((l) => !pattern.test(l));
    if (value !== null) {
      // Insert after leading comments
      let insertAt = 0;
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].trim().startsWith("#")) insertAt = i + 1;
        else break;
      }
      lines.splice(insertAt, 0, `${key}=${value}`);
    }
  }

  const cleaned = lines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd();
  await fs.writeFile(ENV_PATH, cleaned + (cleaned ? "\n" : ""), "utf-8");
}

main().catch((err) => {
  if (err?.name === "ExitPromptError") return;
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
