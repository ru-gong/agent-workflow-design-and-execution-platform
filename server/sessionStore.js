import { promises as fs } from "node:fs";
import path from "node:path";
import { clampText, ensureDir, safeId } from "./utils.js";
import { getRuntimeConfig, publicRuntimeConfig } from "./config.js";

const SESSION_ID_PATTERN = /^[a-z0-9-]+$/i;
export const SESSION_TITLE_DOCUMENT_NAME = "对话命名.md";

export async function createSession({ goal, plan, source = "manual", warning = "", raw = "", runtime } = {}) {
  const context = await buildSessionContext(safeId("session"), runtime);
  const now = new Date().toISOString();
  const metadata = {
    id: context.id,
    title: summarizeSessionTitle(goal, plan?.name),
    goal: clampText(goal, 4000),
    source,
    warning: clampText(warning, 1000),
    createdAt: now,
    updatedAt: now,
    paths: context.paths,
    config: publicRuntimeConfig(context.runtime)
  };
  await ensureDir(context.paths.sessionDir);
  await ensureDir(context.paths.runsDir);
  await ensureDir(context.paths.artifactDir);
  await ensureManifest(context.paths.manifestPath, context.id);
  await fs.writeFile(context.paths.metadataPath, `${JSON.stringify(metadata, null, 2)}\n`);
  await writeSessionTitleDocument(context, metadata);
  if (plan) {
    await fs.writeFile(context.paths.planPath, `${JSON.stringify(plan, null, 2)}\n`);
    await fs.writeFile(context.paths.currentPlanPath, `${JSON.stringify(plan, null, 2)}\n`);
  }
  await appendSessionEvent(context.id, { type: "user:goal", goal: metadata.goal }, context.runtime);
  await appendSessionEvent(context.id, {
    type: "plan:created",
    source,
    warning,
    raw: clampText(raw, 6000),
    nodeCount: Array.isArray(plan?.nodes) ? plan.nodes.length : 0
  }, context.runtime);
  return publicSession(context, metadata);
}

export async function getSessionContext(sessionId, runtime) {
  return buildSessionContext(validateSessionId(sessionId), runtime);
}

export async function getSession(sessionId, runtime) {
  const context = await getSessionContext(sessionId, runtime);
  let metadata = {};
  try {
    metadata = JSON.parse(await fs.readFile(context.paths.metadataPath, "utf8"));
  } catch {
    metadata = { id: context.id, paths: context.paths, config: publicRuntimeConfig(context.runtime) };
  }
  return publicSession(context, metadata);
}

export async function saveCurrentPlan(sessionId, plan, { reason = "plan:edited", runtime } = {}) {
  const context = await getSessionContext(sessionId, runtime);
  await ensureDir(context.paths.sessionDir);
  await fs.writeFile(context.paths.currentPlanPath, `${JSON.stringify(plan, null, 2)}\n`);
  await touchMetadata(context);
  await appendSessionEvent(context.id, {
    type: reason,
    nodeCount: Array.isArray(plan?.nodes) ? plan.nodes.length : 0
  }, context.runtime);
  return getSession(context.id, context.runtime);
}

export async function updateSessionTitle(sessionId, title, { runtime } = {}) {
  const context = await getSessionContext(sessionId, runtime);
  await ensureDir(context.paths.sessionDir);
  let metadata = {};
  try {
    metadata = JSON.parse(await fs.readFile(context.paths.metadataPath, "utf8"));
  } catch {
    metadata = { id: context.id, createdAt: new Date().toISOString() };
  }
  metadata.title = sanitizeSessionTitle(title || metadata.goal || context.id);
  metadata.updatedAt = new Date().toISOString();
  metadata.paths = context.paths;
  metadata.config = publicRuntimeConfig(context.runtime);
  await fs.writeFile(context.paths.metadataPath, `${JSON.stringify(metadata, null, 2)}\n`);
  await writeSessionTitleDocument(context, metadata);
  await appendSessionEvent(context.id, {
    type: "session:title-updated",
    title: metadata.title
  }, context.runtime);
  return getSession(context.id, context.runtime);
}

export async function appendSessionEvent(sessionId, event, runtime) {
  const context = await getSessionContext(sessionId, runtime);
  await ensureDir(context.paths.sessionDir);
  const line = JSON.stringify({
    at: new Date().toISOString(),
    ...event
  });
  await fs.appendFile(context.paths.conversationPath, `${line}\n`);
}

export async function ensureSessionManifest(sessionId, runtime) {
  const context = await getSessionContext(sessionId, runtime);
  await ensureDir(context.paths.artifactDir);
  await ensureManifest(context.paths.manifestPath, context.id);
  return context;
}

export async function getSessionManifest(sessionId, runtime) {
  const context = await ensureSessionManifest(sessionId, runtime);
  let manifest;
  try {
    manifest = JSON.parse(await fs.readFile(context.paths.manifestPath, "utf8"));
  } catch {
    manifest = {
      sessionId: context.id,
      updatedAt: new Date().toISOString(),
      artifacts: []
    };
  }
  if (!Array.isArray(manifest.artifacts)) manifest.artifacts = [];
  return {
    manifest,
    paths: context.paths
  };
}

async function buildSessionContext(sessionId, runtime) {
  const resolvedRuntime = runtime || await getRuntimeConfig();
  const id = validateSessionId(sessionId);
  const sessionDir = path.join(resolvedRuntime.paths.sessionsRootPath, id);
  const artifactDir = path.join(resolvedRuntime.paths.artifactRootPath, id);
  return {
    id,
    runtime: resolvedRuntime,
    paths: {
      workspaceRoot: resolvedRuntime.paths.workspaceRootPath,
      sessionDir,
      runsDir: path.join(sessionDir, "runs"),
      artifactDir,
      manifestPath: path.join(artifactDir, "manifest.json"),
      metadataPath: path.join(sessionDir, "metadata.json"),
      conversationPath: path.join(sessionDir, "conversation.jsonl"),
      planPath: path.join(sessionDir, "plan.json"),
      currentPlanPath: path.join(sessionDir, "plan.current.json")
    }
  };
}

async function ensureManifest(manifestPath, sessionId) {
  try {
    await fs.access(manifestPath);
  } catch {
    const manifest = {
      sessionId,
      updatedAt: new Date().toISOString(),
      artifacts: []
    };
    await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  }
}

async function touchMetadata(context) {
  let metadata = {};
  try {
    metadata = JSON.parse(await fs.readFile(context.paths.metadataPath, "utf8"));
  } catch {
    metadata = { id: context.id, createdAt: new Date().toISOString() };
  }
  metadata.updatedAt = new Date().toISOString();
  metadata.paths = context.paths;
  metadata.config = publicRuntimeConfig(context.runtime);
  await fs.writeFile(context.paths.metadataPath, `${JSON.stringify(metadata, null, 2)}\n`);
  await writeSessionTitleDocument(context, metadata);
}

function publicSession(context, metadata = {}) {
  return {
    id: context.id,
    title: metadata.title || summarizeSessionTitle(metadata.goal || "", ""),
    goal: metadata.goal || "",
    source: metadata.source || "",
    warning: metadata.warning || "",
    createdAt: metadata.createdAt || "",
    updatedAt: metadata.updatedAt || "",
    paths: context.paths,
    config: publicRuntimeConfig(context.runtime)
  };
}

export function summarizeSessionTitle(goal = "", fallback = "") {
  const cleanGoal = String(goal || "")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^[\s:：,，。.!！?？、-]*(请|帮我|我想|我希望|希望|需要|给我|麻烦|请你|能不能|可以)?\s*/i, "")
    .trim();
  const source = cleanGoal || fallback || "新对话";
  const firstClause = source.split(/[。.!！?？；;，,]/).find(Boolean) || source;
  return sanitizeSessionTitle(firstClause);
}

function sanitizeSessionTitle(value = "") {
  const text = String(value || "")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return "新对话";
  return text.length > 36 ? `${text.slice(0, 35)}...` : text;
}

async function writeSessionTitleDocument(context, metadata = {}) {
  await ensureDir(context.paths.artifactDir);
  await ensureManifest(context.paths.manifestPath, context.id);
  const title = metadata.title || summarizeSessionTitle(metadata.goal || "", "");
  const titlePath = path.join(context.paths.artifactDir, SESSION_TITLE_DOCUMENT_NAME);
  const content = [
    "# 对话命名",
    "",
    `- 当前名称：${markdownInline(title)}`,
    `- Session ID：\`${context.id}\``,
    `- 原始需求：${markdownInline(metadata.goal || "")}`,
    `- 创建时间：${markdownInline(metadata.createdAt || "")}`,
    `- 最近更新：${markdownInline(metadata.updatedAt || new Date().toISOString())}`,
    `- 会话记录目录：\`${context.paths.sessionDir}\``,
    `- 产物目录：\`${context.paths.artifactDir}\``,
    "",
    "> 本文件由系统自动生成。用户在界面修改对话名称后，会同步更新这里记录的当前名称。",
    ""
  ].join("\n");
  await fs.writeFile(titlePath, content);
  await upsertTitleDocumentManifest(context, titlePath);
}

async function upsertTitleDocumentManifest(context, titlePath) {
  let manifest;
  try {
    manifest = JSON.parse(await fs.readFile(context.paths.manifestPath, "utf8"));
  } catch {
    manifest = { sessionId: context.id, artifacts: [] };
  }
  if (!Array.isArray(manifest.artifacts)) manifest.artifacts = [];
  const artifact = {
    path: titlePath,
    sourceNodeId: "__session__",
    title: "对话命名",
    description: "记录当前对话名称、原始需求与会话产物路径。"
  };
  const existingIndex = manifest.artifacts.findIndex((item) => path.normalize(String(item.path || "")) === path.normalize(titlePath));
  if (existingIndex >= 0) manifest.artifacts[existingIndex] = { ...manifest.artifacts[existingIndex], ...artifact };
  else manifest.artifacts.unshift(artifact);
  manifest.sessionId = manifest.sessionId || context.id;
  manifest.updatedAt = new Date().toISOString();
  await fs.writeFile(context.paths.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

function markdownInline(value = "") {
  const text = String(value || "").replace(/[\r\n]+/g, " ").trim();
  return text ? text.replace(/[\\`*_{}[\]()#+.!|-]/g, "\\$&") : "未记录";
}

function validateSessionId(sessionId) {
  const id = String(sessionId || "").trim();
  if (!SESSION_ID_PATTERN.test(id)) throw new Error("Invalid session id");
  return id;
}
