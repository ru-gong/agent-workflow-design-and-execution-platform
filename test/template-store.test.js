import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveRuntimeConfig } from "../server/config.js";
import { getTemplate, listTemplates, saveTemplate } from "../server/templateStore.js";

test("template store lists built-ins and persists custom templates", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "orchestrator-templates-"));
  const runtime = resolveRuntimeConfig({
    workspaceRoot: tempRoot,
    storageRoot: ".orchestrator",
    artifactRoot: "artifacts"
  });
  const plan = {
    version: "1.0",
    name: "Custom Flow",
    summary: "A custom reusable flow.",
    strategy: "Do work then summarize.",
    maxConcurrency: 1,
    finalDeliverable: "Report",
    nodes: [
      {
        id: "work",
        title: "Work",
        agent: "Worker",
        task: "Create a reusable result.",
        skills: [],
        dependsOn: [],
        acceptance: ["Done."],
        mode: "codex",
        requiresReview: false,
        model: "",
        reasoningEffort: "medium",
        sandbox: "workspace-write",
        networkPolicy: "confirm",
        outputRequirement: { type: "markdown", custom: "" },
        reviewPolicy: { maxIterations: 3, targetNodeIds: [], criteria: "", continueOnLimit: true },
        x: 10,
        y: 10
      },
      {
        id: "final",
        title: "Final",
        agent: "Writer",
        task: "Summarize the reusable result.",
        skills: [],
        dependsOn: ["work"],
        acceptance: ["Done."],
        mode: "synthesis",
        requiresReview: false,
        model: "",
        reasoningEffort: "medium",
        sandbox: "workspace-write",
        networkPolicy: "confirm",
        outputRequirement: { type: "markdown", custom: "" },
        reviewPolicy: { maxIterations: 3, targetNodeIds: [], criteria: "", continueOnLimit: true },
        x: 310,
        y: 10
      }
    ],
    edges: [{ from: "work", to: "final", label: "" }]
  };

  const initial = await listTemplates(runtime);
  assert.equal(initial.some((template) => template.id === "builtin-industry-research"), true);

  const saved = await saveTemplate({
    name: "My Custom Template",
    description: "Saved from test.",
    goalHint: "Use this for testing.",
    plan,
    runOptions: { maxConcurrency: 3, tokenBudget: 2000 }
  }, runtime);

  assert.match(saved.id, /^template-/);
  assert.equal(saved.name, "My Custom Template");
  assert.equal(saved.runOptions.maxConcurrency, 3);

  const loaded = await getTemplate(saved.id, runtime);
  assert.equal(loaded.plan.name, "Custom Flow");
  assert.equal(loaded.plan.nodes.length, 2);

  const all = await listTemplates(runtime);
  assert.equal(all.some((template) => template.id === saved.id), true);
});
