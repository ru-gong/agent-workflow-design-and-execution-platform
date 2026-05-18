import { promises as fs } from "node:fs";
import path from "node:path";
import { defaultModelForProvider, normalizeReasoningEffortForProvider, normalizeToolProvider } from "./codexRunner.js";
import { ROOT, ensureDir } from "./utils.js";

export const CONFIG_PATH = path.join(ROOT, "orchestrator.config.json");

export const DEFAULT_CONFIG = {
  workspaceRoot: ".",
  storageRoot: ".orchestrator",
  artifactRoot: "artifacts",
  toolProvider: "codex",
  toolProviderConfirmed: false,
  models: {
    planner: "gpt-5.3-codex",
    executor: "gpt-5.3-codex",
    reasoningEffort: "medium"
  },
  codex: {
    adapter: "cli"
  }
};

export async function loadConfig({ createIfMissing = true } = {}) {
  let raw = "";
  try {
    raw = await fs.readFile(CONFIG_PATH, "utf8");
  } catch (error) {
    if (error.code !== "ENOENT" || !createIfMissing) throw error;
    const config = normalizeConfig(DEFAULT_CONFIG);
    await fs.writeFile(CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`);
    return config;
  }
  return normalizeConfig(JSON.parse(raw));
}

export async function saveConfig(input) {
  const config = normalizeConfig(input);
  const runtime = resolveRuntimeConfig(config);
  await ensureDir(runtime.paths.workspaceRootPath);
  await ensureDir(runtime.paths.storageRootPath);
  await ensureDir(runtime.paths.artifactRootPath);
  await fs.writeFile(CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`);
  return runtime;
}

export async function getRuntimeConfig() {
  const config = await loadConfig();
  const runtime = resolveRuntimeConfig(config);
  await ensureDir(runtime.paths.storageRootPath);
  await ensureDir(path.join(runtime.paths.storageRootPath, "sessions"));
  await ensureDir(runtime.paths.planningDirPath);
  await ensureDir(runtime.paths.artifactRootPath);
  return runtime;
}

export function normalizeConfig(input = {}) {
  const source = input && typeof input === "object" ? input : {};
  const toolProvider = normalizeToolProvider(source.toolProvider || source.programmingTool || DEFAULT_CONFIG.toolProvider);
  const models = source.models && typeof source.models === "object" ? source.models : {};
  const codex = source.codex && typeof source.codex === "object" ? source.codex : {};
  const claude = source.claude && typeof source.claude === "object" ? source.claude : {};
  const planner = cleanText(models.planner, defaultModelForProvider(toolProvider, "planner"));
  const executor = cleanText(models.executor, defaultModelForProvider(toolProvider, "executor"));
  return {
    workspaceRoot: cleanPathValue(source.workspaceRoot, DEFAULT_CONFIG.workspaceRoot),
    storageRoot: cleanPathValue(source.storageRoot, DEFAULT_CONFIG.storageRoot),
    artifactRoot: cleanPathValue(source.artifactRoot, DEFAULT_CONFIG.artifactRoot),
    toolProvider,
    toolProviderConfirmed: Boolean(source.toolProviderConfirmed),
    models: {
      planner,
      executor,
      reasoningEffort: normalizeReasoningEffortForProvider(toolProvider, executor, models.reasoningEffort, DEFAULT_CONFIG.models.reasoningEffort)
    },
    codex: {
      adapter: codex.adapter === "cli" ? "cli" : DEFAULT_CONFIG.codex.adapter
    },
    claude: {
      adapter: claude.adapter === "cli" ? "cli" : "cli"
    }
  };
}

export function resolveRuntimeConfig(config, appRoot = ROOT) {
  const normalized = normalizeConfig(config);
  const workspaceRootPath = resolveConfigPath(appRoot, normalized.workspaceRoot);
  const storageRootPath = resolveConfigPath(workspaceRootPath, normalized.storageRoot);
  const artifactRootPath = resolveConfigPath(workspaceRootPath, normalized.artifactRoot);
  return {
    ...normalized,
    paths: {
      appRoot,
      configPath: path.join(appRoot, "orchestrator.config.json"),
      workspaceRootPath,
      storageRootPath,
      sessionsRootPath: path.join(storageRootPath, "sessions"),
      planningDirPath: path.join(storageRootPath, ".planning"),
      artifactRootPath
    }
  };
}

export function publicRuntimeConfig(runtime) {
  return {
    workspaceRoot: runtime.workspaceRoot,
    storageRoot: runtime.storageRoot,
    artifactRoot: runtime.artifactRoot,
    toolProvider: runtime.toolProvider,
    toolProviderConfirmed: runtime.toolProviderConfirmed,
    models: runtime.models,
    codex: runtime.codex,
    claude: runtime.claude,
    paths: runtime.paths
  };
}

function resolveConfigPath(base, value) {
  return path.isAbsolute(value) ? path.normalize(value) : path.resolve(base, value);
}

function cleanPathValue(value, fallback) {
  const text = cleanText(value, fallback);
  return text.replace(/\0/g, "").trim() || fallback;
}

function cleanText(value, fallback) {
  const text = String(value || "").trim();
  return text ? text.slice(0, 240) : fallback;
}
