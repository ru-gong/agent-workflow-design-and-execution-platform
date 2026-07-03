import { createServer } from "node:http";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { detectProgrammingTools, defaultModelForProvider, normalizeReasoningEffortForProvider, normalizeToolProvider } from "./codexRunner.js";
import { createPlan } from "./planner.js";
import { RunManager } from "./runner.js";
import { ROOT, badRequest, ensureDir, json, normalizeError, notFound, readJsonBody, sendSse } from "./utils.js";
import { discoverSkills } from "./skills.js";
import { getWeatherByCity } from "./weather.js";
import { getRuntimeConfig, publicRuntimeConfig, saveConfig } from "./config.js";
import { createSession, getSession, getSessionContext, getSessionManifest, saveCurrentPlan, updateSessionTitle } from "./sessionStore.js";
import { pickFolder } from "./folderPicker.js";
import { openLocalPath } from "./pathActions.js";
import { deleteTemplate, getTemplate, listTemplates, saveTemplate } from "./templateStore.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, "..", "public");
const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || "127.0.0.1";
const manager = new RunManager({ root: ROOT });

await ensureDir(path.join(ROOT, "runs"));
const startupRuntime = await getRuntimeConfig();
const startupTools = await detectProgrammingTools();

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    if (url.pathname.startsWith("/api/")) {
      await handleApi(req, res, url);
      return;
    }
    await serveStatic(req, res, url);
  } catch (error) {
    json(res, 500, { error: "Internal server error", details: normalizeError(error) });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Agent Workflow Design and Execution Platform running at http://${HOST}:${PORT}`);
  const available = Object.values(startupTools).filter((tool) => tool.ok).map((tool) => tool.label).join(", ") || "none";
  console.log(`Detected programming tools: ${available}; selected: ${startupRuntime.toolProvider}`);
});

async function handleApi(req, res, url) {
  if (req.method === "GET" && url.pathname === "/api/health") {
    const runtime = await getRuntimeConfig();
    const tools = await detectProgrammingTools();
    json(res, 200, {
      ok: true,
      cwd: ROOT,
      workspaceRoot: runtime.paths.workspaceRootPath,
      selectedTool: runtime.toolProvider,
      toolProviderConfirmed: runtime.toolProviderConfirmed,
      tools,
      codex: tools.codex,
      claude: tools.claude,
      node: process.version,
      mockMode: process.env.USE_MOCK_CODEX === "1"
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/config") {
    json(res, 200, { config: publicRuntimeConfig(await getRuntimeConfig()) });
    return;
  }

  if (req.method === "PUT" && url.pathname === "/api/config") {
    const body = await readJsonBody(req);
    const runtime = await saveConfig(body.config || body);
    json(res, 200, { config: publicRuntimeConfig(runtime) });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/select-folder") {
    const body = await readJsonBody(req);
    const result = await pickFolder({
      title: String(body.title || "选择文件夹"),
      currentPath: String(body.currentPath || ""),
      fallbackPath: String(body.fallbackPath || "")
    });
    if (!result.supported) {
      json(res, 501, { error: result.error || "当前系统不支持原生文件夹选择。" });
      return;
    }
    json(res, 200, result);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/open-path") {
    const body = await readJsonBody(req);
    try {
      const result = await openLocalPath({
        targetPath: body.path,
        mode: body.mode,
        runtime: await getRuntimeConfig()
      });
      json(res, 200, result);
    } catch (error) {
      json(res, error.statusCode || 500, { error: error.message || "打开路径失败。" });
    }
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/skills") {
    const runtime = await getRuntimeConfig();
    const toolProvider = normalizeToolProvider(url.searchParams.get("toolProvider") || runtime.toolProvider);
    json(res, 200, {
      provider: toolProvider,
      skills: await discoverSkills({ provider: toolProvider, workspaceRoot: runtime.paths.workspaceRootPath })
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/weather") {
    try {
      const result = await getWeatherByCity(url.searchParams.get("city"));
      json(res, 200, result);
    } catch (error) {
      json(res, error.statusCode || 500, { error: error.message || "天气查询失败。" });
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/plan") {
    const body = await readJsonBody(req);
    const goal = String(body.goal || "").trim();
    if (goal.length < 4) {
      badRequest(res, "请输入更具体的任务目标。");
      return;
    }
    const runtime = await getRuntimeConfig();
    const toolProvider = normalizeToolProvider(body.toolProvider || process.env.AGENT_TOOL_PROVIDER || runtime.toolProvider);
    const skills = await discoverSkills({ provider: toolProvider, workspaceRoot: runtime.paths.workspaceRootPath });
    const plannerModel = String(body.model || plannerModelFromEnv(toolProvider) || runtime.models.planner || defaultModelForProvider(toolProvider, "planner"));
    const requestedReasoningEffort = ["low", "medium", "high", "xhigh", "max"].includes(body.reasoningEffort)
      ? body.reasoningEffort
      : process.env.AGENT_PLANNER_REASONING || process.env.CODEX_PLANNER_REASONING || runtime.models.reasoningEffort;
    const reasoningEffort = normalizeReasoningEffortForProvider(toolProvider, plannerModel, requestedReasoningEffort, runtime.models.reasoningEffort);
    const requestRuntime = runtimeForProvider(runtime, toolProvider, {
      plannerModel,
      reasoningEffort,
      confirmed: Boolean(body.toolProvider)
    });
    let result;
    try {
      result = await createPlan({
        goal,
        skills,
        provider: toolProvider,
        model: plannerModel,
        reasoningEffort,
        networkPolicy: ["confirm", "full-access"].includes(body.networkPolicy)
          ? body.networkPolicy
          : "confirm",
        workspace: runtime.paths.workspaceRootPath,
        planningDir: runtime.paths.planningDirPath
      });
    } catch (error) {
      json(res, error.statusCode || 502, {
        error: error.message || "大模型规划调用失败。",
        details: normalizeError(error)
      });
      return;
    }
    const session = await createSession({
      goal,
      plan: result.plan,
      source: result.source,
      warning: result.warning || "",
      raw: result.raw || "",
      runtime: requestRuntime
    });
    json(res, 200, { ...result, sessionId: session.id, session });
    return;
  }

  const sessionMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)$/);
  if (req.method === "GET" && sessionMatch) {
    json(res, 200, { session: await getSession(sessionMatch[1]) });
    return;
  }

  const sessionTitleMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)\/title$/);
  if ((req.method === "PUT" || req.method === "PATCH") && sessionTitleMatch) {
    const body = await readJsonBody(req);
    const session = await updateSessionTitle(sessionTitleMatch[1], body.title, { runtime: await getRuntimeConfig() });
    json(res, 200, { ok: true, session });
    return;
  }

  const sessionArtifactsMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)\/artifacts$/);
  if (req.method === "GET" && sessionArtifactsMatch) {
    json(res, 200, await getSessionManifest(sessionArtifactsMatch[1], await getRuntimeConfig()));
    return;
  }

  const sessionPlanMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)\/plan$/);
  if (req.method === "PUT" && sessionPlanMatch) {
    const body = await readJsonBody(req, 2_000_000);
    if (!body.plan || !Array.isArray(body.plan.nodes)) {
      badRequest(res, "Missing orchestration plan");
      return;
    }
    const session = await saveCurrentPlan(sessionPlanMatch[1], body.plan, {
      reason: String(body.reason || "plan:edited")
    });
    json(res, 200, { ok: true, session });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/templates") {
    json(res, 200, { templates: await listTemplates(await getRuntimeConfig()) });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/templates") {
    const body = await readJsonBody(req, 2_000_000);
    if (!body.plan || !Array.isArray(body.plan.nodes)) {
      badRequest(res, "Missing template plan");
      return;
    }
    const template = await saveTemplate(body, await getRuntimeConfig());
    json(res, 201, { template });
    return;
  }

  const templateMatch = url.pathname.match(/^\/api\/templates\/([^/]+)$/);
  if (req.method === "GET" && templateMatch) {
    json(res, 200, { template: await getTemplate(templateMatch[1], await getRuntimeConfig()) });
    return;
  }

  if (req.method === "DELETE" && templateMatch) {
    try {
      json(res, 200, await deleteTemplate(templateMatch[1], await getRuntimeConfig()));
    } catch (error) {
      json(res, error.statusCode || 500, { error: error.message || "删除模板失败。" });
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/runs") {
    const body = await readJsonBody(req, 2_000_000);
    if (!body.plan || !Array.isArray(body.plan.nodes)) {
      badRequest(res, "Missing orchestration plan");
      return;
    }
    const goal = String(body.goal || body.plan.summary || "");
    const runtime = await getRuntimeConfig();
    const toolProvider = normalizeToolProvider(body.toolProvider || runtime.toolProvider);
    const requestRuntime = runtimeForProvider(runtime, toolProvider, { confirmed: Boolean(body.toolProvider) });
    const session = body.sessionId
      ? await saveCurrentPlan(body.sessionId, body.plan, { reason: "run:plan-snapshot", runtime: requestRuntime })
      : await createSession({ goal, plan: body.plan, source: "manual-run", runtime: requestRuntime });
    const context = await getSessionContext(session.id, requestRuntime);
    const snapshot = await manager.start({
      goal,
      plan: body.plan,
      session: { ...session, paths: context.paths },
      runOptions: body.runOptions || {}
    });
    json(res, 201, { ...snapshot, session });
    return;
  }

  const runMatch = url.pathname.match(/^\/api\/runs\/([^/]+)$/);
  if (req.method === "GET" && runMatch) {
    const run = manager.get(runMatch[1]);
    if (!run) return notFound(res);
    json(res, 200, manager.snapshot(run));
    return;
  }

  const eventsMatch = url.pathname.match(/^\/api\/runs\/([^/]+)\/events$/);
  if (req.method === "GET" && eventsMatch) {
    const run = manager.get(eventsMatch[1]);
    if (!run) return notFound(res);
    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no"
    });
    sendSse(res, "snapshot", manager.snapshot(run));
    manager.subscribe(eventsMatch[1], res);
    return;
  }

  const continueMatch = url.pathname.match(/^\/api\/runs\/([^/]+)\/nodes\/([^/]+)\/continue$/);
  if (req.method === "POST" && continueMatch) {
    const body = await readJsonBody(req);
    const result = manager.continue(continueMatch[1], continueMatch[2], String(body.note || "Approved in visual orchestrator."));
    json(res, result.ok ? 200 : 409, result);
    return;
  }

  const resumeMatch = url.pathname.match(/^\/api\/runs\/([^/]+)\/resume$/);
  if (req.method === "POST" && resumeMatch) {
    const body = await readJsonBody(req);
    const result = manager.resume(resumeMatch[1], body.runOptions || body);
    json(res, result.ok ? 200 : 409, result);
    return;
  }

  const rerunMatch = url.pathname.match(/^\/api\/runs\/([^/]+)\/nodes\/([^/]+)\/rerun$/);
  if (req.method === "POST" && rerunMatch) {
    const body = await readJsonBody(req);
    const result = manager.rerunNode(rerunMatch[1], rerunMatch[2], { downstream: Boolean(body.downstream) });
    json(res, result.ok ? 200 : 409, result);
    return;
  }

  const stopMatch = url.pathname.match(/^\/api\/runs\/([^/]+)\/stop$/);
  if (req.method === "POST" && stopMatch) {
    const result = manager.stop(stopMatch[1]);
    json(res, result.ok ? 200 : 404, result);
    return;
  }

  notFound(res);
}

function plannerModelFromEnv(provider) {
  if (provider === "claude") return process.env.CLAUDE_PLANNER_MODEL || process.env.AGENT_PLANNER_MODEL || "";
  return process.env.CODEX_PLANNER_MODEL || process.env.AGENT_PLANNER_MODEL || "";
}

function runtimeForProvider(runtime, provider, { plannerModel = "", reasoningEffort = "", confirmed = false } = {}) {
  const toolProvider = normalizeToolProvider(provider);
  const executor = runtime.toolProvider === toolProvider
    ? runtime.models.executor
    : defaultModelForProvider(toolProvider, "executor");
  return {
    ...runtime,
    toolProvider,
    toolProviderConfirmed: runtime.toolProviderConfirmed || confirmed,
    models: {
      ...runtime.models,
      planner: plannerModel || (runtime.toolProvider === toolProvider ? runtime.models.planner : defaultModelForProvider(toolProvider, "planner")),
      executor,
      reasoningEffort: reasoningEffort || runtime.models.reasoningEffort
    }
  };
}

async function serveStatic(req, res, url) {
  const requested = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
  const target = path.normalize(path.join(PUBLIC_DIR, requested));
  const relative = path.relative(PUBLIC_DIR, target);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    notFound(res);
    return;
  }
  let stat;
  try {
    stat = await fs.stat(target);
  } catch {
    notFound(res);
    return;
  }
  if (!stat.isFile()) {
    notFound(res);
    return;
  }
  const ext = path.extname(target).toLowerCase();
  const contentType = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".svg": "image/svg+xml; charset=utf-8",
    ".json": "application/json; charset=utf-8"
  }[ext] || "application/octet-stream";
  res.writeHead(200, {
    "Content-Type": contentType,
    "Cache-Control": "no-store, max-age=0"
  });
  res.end(await fs.readFile(target));
}
