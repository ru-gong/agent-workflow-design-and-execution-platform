import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { normalizeConfig, resolveRuntimeConfig } from "../server/config.js";
import { createSession, getSessionManifest, saveCurrentPlan, summarizeSessionTitle, updateSessionTitle } from "../server/sessionStore.js";

test("resolveRuntimeConfig anchors storage and artifacts under workspace root", () => {
  const runtime = resolveRuntimeConfig(
    {
      workspaceRoot: "demo-project",
      storageRoot: ".agent-runs",
      artifactRoot: "deliverables",
      toolProvider: "claude",
      toolProviderConfirmed: true,
      models: { planner: "gpt-5.5", executor: "gpt-5.4", reasoningEffort: "high" },
      codex: { adapter: "cli" },
      claude: { adapter: "cli" }
    },
    "/tmp/orchestrator-app"
  );

  assert.equal(runtime.toolProvider, "claude");
  assert.equal(runtime.toolProviderConfirmed, true);
  assert.equal(runtime.models.planner, "gpt-5.5");
  assert.equal(runtime.paths.workspaceRootPath, "/tmp/orchestrator-app/demo-project");
  assert.equal(runtime.paths.sessionsRootPath, "/tmp/orchestrator-app/demo-project/.agent-runs/sessions");
  assert.equal(runtime.paths.artifactRootPath, "/tmp/orchestrator-app/demo-project/deliverables");
});

test("normalizeConfig falls back to safe model and reasoning defaults", () => {
  const config = normalizeConfig({ models: { planner: "", executor: "", reasoningEffort: "huge" }, codex: { adapter: "remote" } });

  assert.equal(config.toolProvider, "codex");
  assert.equal(config.models.planner, "gpt-5.3-codex");
  assert.equal(config.models.executor, "gpt-5.3-codex");
  assert.equal(config.models.reasoningEffort, "medium");
  assert.equal(config.codex.adapter, "cli");
});

test("normalizeConfig preserves Windows drive paths", () => {
  const config = normalizeConfig({
    workspaceRoot: "C:\\Users\\demo\\project",
    storageRoot: "D:\\agent-runs",
    artifactRoot: "E:\\deliverables"
  });

  assert.equal(config.workspaceRoot, "C:\\Users\\demo\\project");
  assert.equal(config.storageRoot, "D:\\agent-runs");
  assert.equal(config.artifactRoot, "E:\\deliverables");
});

test("normalizeConfig uses Claude defaults when Claude Code is selected", () => {
  const config = normalizeConfig({ toolProvider: "claude", models: { planner: "", executor: "" } });

  assert.equal(config.toolProvider, "claude");
  assert.equal(config.models.planner, "sonnet");
  assert.equal(config.models.executor, "sonnet");
});

test("normalizeConfig preserves only model-supported Claude effort levels", () => {
  const opusConfig = normalizeConfig({ toolProvider: "claude", models: { executor: "opus", reasoningEffort: "max" } });
  const sonnetConfig = normalizeConfig({ toolProvider: "claude", models: { executor: "sonnet", reasoningEffort: "xhigh" } });
  const haikuConfig = normalizeConfig({ toolProvider: "claude", models: { executor: "haiku", reasoningEffort: "high" } });

  assert.equal(opusConfig.models.reasoningEffort, "max");
  assert.equal(sonnetConfig.models.reasoningEffort, "high");
  assert.equal(haikuConfig.models.reasoningEffort, "");
});

test("createSession persists conversation, plans, and artifact manifest", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "orchestrator-session-"));
  const runtime = resolveRuntimeConfig({
    workspaceRoot: tempRoot,
    storageRoot: ".orchestrator",
    artifactRoot: "artifacts"
  });
  const plan = {
    name: "Demo",
    summary: "Demo",
    nodes: [{ id: "n1", title: "N1", agent: "A", task: "T", skills: [], dependsOn: [], acceptance: ["ok"], mode: "codex" }],
    edges: []
  };

  const session = await createSession({ goal: "build demo", plan, source: "test", runtime });
  assert.match(session.id, /^session-/);
  assert.equal(session.title, "build demo");
  assert.equal(JSON.parse(await fs.readFile(path.join(session.paths.artifactDir, "manifest.json"), "utf8")).sessionId, session.id);
  assert.equal(JSON.parse(await fs.readFile(path.join(session.paths.sessionDir, "plan.json"), "utf8")).name, "Demo");

  plan.nodes[0].title = "N1 edited";
  await saveCurrentPlan(session.id, plan, { reason: "test:edit", runtime });
  assert.equal(JSON.parse(await fs.readFile(path.join(session.paths.sessionDir, "plan.current.json"), "utf8")).nodes[0].title, "N1 edited");

  const conversation = await fs.readFile(path.join(session.paths.sessionDir, "conversation.jsonl"), "utf8");
  assert.match(conversation, /user:goal/);
  assert.match(conversation, /test:edit/);

  const manifestPath = path.join(session.paths.artifactDir, "manifest.json");
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  manifest.artifacts.push({
    path: path.join(session.paths.artifactDir, "report.md"),
    sourceNodeId: "n1",
    title: "Demo Report",
    description: "A user-facing report."
  });
  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  const loadedManifest = await getSessionManifest(session.id, runtime);
  assert.equal(loadedManifest.manifest.artifacts[0].title, "Demo Report");
  assert.equal(loadedManifest.paths.manifestPath, manifestPath);

  const renamed = await updateSessionTitle(session.id, "自定义对话名称", { runtime });
  assert.equal(renamed.title, "自定义对话名称");
  const renamedMetadata = JSON.parse(await fs.readFile(path.join(session.paths.sessionDir, "metadata.json"), "utf8"));
  assert.equal(renamedMetadata.title, "自定义对话名称");
});

test("summarizeSessionTitle derives concise names from user goals", () => {
  assert.equal(summarizeSessionTitle("请对当前行业中铝和钛粉末冶金的应用情况做深度调研，然后输出报告"), "对当前行业中铝和钛粉末冶金的应用情况做深度调研");
  assert.equal(summarizeSessionTitle("", "Fallback Plan"), "Fallback Plan");
});
