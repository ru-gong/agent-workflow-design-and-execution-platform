import test from "node:test";
import assert from "node:assert/strict";
import { RunManager } from "../server/runner.js";

function waitFor(run, predicate, timeoutMs = 2000) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = () => {
      if (predicate()) return resolve();
      if (Date.now() - started > timeoutMs) return reject(new Error("Timed out waiting for run state"));
      setTimeout(tick, 20);
    };
    tick();
  });
}

test("RunManager pauses for human-review nodes and resumes after confirmation", async () => {
  const manager = new RunManager({ root: process.cwd() });
  const snapshot = await manager.start({
    goal: "approval-only test",
    plan: {
      version: "1.0",
      name: "Approval Flow",
      summary: "A plan that needs two confirmations.",
      maxConcurrency: 1,
      nodes: [
        {
          id: "first-review",
          title: "First Review",
          agent: "Human",
          task: "Confirm first gate.",
          skills: [],
          dependsOn: [],
          acceptance: ["Approved."],
          mode: "human-review",
          requiresReview: true,
          sandbox: "read-only",
          x: 20,
          y: 20
        },
        {
          id: "final-synthesis",
          title: "Final Review",
          agent: "Human",
          task: "Confirm final gate.",
          skills: [],
          dependsOn: ["first-review"],
          acceptance: ["Approved."],
          mode: "synthesis",
          requiresReview: true,
          sandbox: "read-only",
          x: 320,
          y: 20
        }
      ],
      edges: [{ from: "first-review", to: "final-synthesis" }]
    }
  });

  const run = manager.get(snapshot.id);
  await waitFor(run, () => run.nodes["first-review"].status === "waiting");
  assert.deepEqual(manager.continue(run.id, "first-review", "ok"), { ok: true });
  await waitFor(run, () => run.nodes["final-synthesis"].status === "waiting");
  assert.deepEqual(manager.continue(run.id, "final-synthesis", "done"), { ok: true });
  await waitFor(run, () => run.status === "completed");

  assert.equal(run.nodes["first-review"].output, "ok");
  assert.equal(run.nodes["final-synthesis"].output, "done");
});

test("RunManager emits progressive logs for mock Codex execution", async () => {
  const previousMock = process.env.USE_MOCK_CODEX;
  process.env.USE_MOCK_CODEX = "1";
  try {
    const manager = new RunManager({ root: process.cwd() });
    const snapshot = await manager.start({
      goal: "mock execution test",
      plan: {
        version: "1.0",
        name: "Mock Execution Flow",
        summary: "A single Codex node with progressive activity.",
        maxConcurrency: 1,
        nodes: [
          {
            id: "mock-node",
            title: "Mock Node",
            agent: "Research Reviewer",
            task: "Summarize existing facts.",
            skills: ["test-runner"],
            dependsOn: [],
            acceptance: ["Logs are emitted."],
            mode: "codex",
            requiresReview: false,
            sandbox: "read-only",
            x: 20,
            y: 20
          }
        ],
        edges: []
      }
    });

    const run = manager.get(snapshot.id);
    await waitFor(run, () => run.status === "completed", 3000);

    const logTexts = run.events
      .filter((event) => event.name === "node:log" && event.data.nodeId === "mock-node")
      .map((event) => event.data.text);

    assert.deepEqual(logTexts, [
      "读取节点配置与上游输出",
      "应用 skills：test-runner",
      "整理只读节点结论并交给运行器保存"
    ]);
    assert.equal(run.nodes["mock-node"].status, "completed");
    assert.match(run.nodes["mock-node"].output, /Mock Codex result for node mock-node/);
  } finally {
    if (previousMock === undefined) delete process.env.USE_MOCK_CODEX;
    else process.env.USE_MOCK_CODEX = previousMock;
  }
});

test("RunManager gives sandbox-aware artifact instructions", () => {
  const manager = new RunManager({ root: process.cwd() });
  const run = {
    goal: "produce a result",
    plan: {
      name: "Sandbox Flow",
      nodes: [
        { id: "analysis", title: "Analysis" },
        { id: "writer", title: "Writer" }
      ]
    },
    nodes: {
      analysis: { status: "completed", output: "facts" }
    },
    workspaceRoot: process.cwd(),
    sessionDir: "/tmp/session",
    runDir: "/tmp/run",
    artifactDir: "/tmp/artifacts"
  };
  const baseNode = {
    id: "writer",
    title: "Writer",
    agent: "Codex Worker",
    task: "Summarize the facts.",
    skills: [],
    dependsOn: ["analysis"],
    acceptance: ["Result is clear."],
    mode: "codex",
    requiresReview: false,
    reasoningEffort: "medium"
  };

  const readOnlyPrompt = manager.nodePrompt(run, { ...baseNode, sandbox: "read-only" });
  assert.match(readOnlyPrompt, /read-only sandbox/i);
  assert.match(readOnlyPrompt, /Do not attempt to create, edit, or write files/);
  assert.doesNotMatch(readOnlyPrompt, /update manifest\.json/i);

  const writablePrompt = manager.nodePrompt(run, { ...baseNode, sandbox: "workspace-write" });
  assert.match(writablePrompt, /update manifest\.json/i);
  assert.doesNotMatch(writablePrompt, /Do not attempt to create, edit, or write files/);
});

test("RunManager includes synthesis output requirements in node prompts", () => {
  const manager = new RunManager({ root: process.cwd() });
  const prompt = manager.nodePrompt(
    {
      goal: "prepare board materials",
      plan: { name: "Output Requirement Flow", nodes: [] },
      nodes: {},
      workspaceRoot: process.cwd(),
      sessionDir: "/tmp/session",
      runDir: "/tmp/run",
      artifactDir: "/tmp/artifacts"
    },
    {
      id: "final-synthesis",
      title: "Final Synthesis",
      agent: "Synthesis Lead",
      task: "Create the final result.",
      skills: [],
      dependsOn: [],
      acceptance: ["Output matches the selected format."],
      mode: "synthesis",
      requiresReview: false,
      sandbox: "workspace-write",
      networkPolicy: "confirm",
      reasoningEffort: "medium",
      outputRequirement: { type: "html", custom: "做成单页看板，突出风险和下一步。" }
    }
  );

  assert.match(prompt, /Synthesis output requirement/);
  assert.match(prompt, /HTML \/ web page/);
  assert.match(prompt, /做成单页看板/);
  assert.match(prompt, /artifact directory/);
});

test("RunManager treats selected output type as authoritative over stale custom text", () => {
  const manager = new RunManager({ root: process.cwd() });
  const prompt = manager.nodePrompt(
    {
      goal: "prepare DJI opportunity materials",
      plan: { name: "PPT Output Flow", nodes: [] },
      nodes: {},
      workspaceRoot: process.cwd(),
      sessionDir: "/tmp/session",
      runDir: "/tmp/run",
      artifactDir: "/tmp/artifacts"
    },
    {
      id: "final-synthesis",
      title: "Final Synthesis",
      agent: "Synthesis Lead",
      task: "Create the final result.",
      skills: [],
      dependsOn: [],
      acceptance: ["Output matches the selected format."],
      mode: "synthesis",
      requiresReview: false,
      sandbox: "workspace-write",
      networkPolicy: "confirm",
      reasoningEffort: "medium",
      outputRequirement: {
        type: "ppt",
        custom: "输出中文Markdown深度研究报告，适合直接给研发、战略或供应链团队评审。"
      }
    }
  );

  assert.match(prompt, /Required final output type: PPT \/ presentation deck \(ppt\)/);
  assert.match(prompt, /selected output type above is authoritative/);
  assert.match(prompt, /Do not deliver only a Markdown report when PPT is selected/);
  assert.match(prompt, /输出中文PPT 汇报材料/);
  assert.doesNotMatch(prompt, /User-supplied output requirement: 输出中文Markdown深度研究报告/);
});

test("RunManager includes auto-review policy and JSON contract in prompts", () => {
  const manager = new RunManager({ root: process.cwd() });
  const prompt = manager.nodePrompt(
    {
      goal: "review a deliverable",
      plan: { name: "Auto Review Prompt Flow", nodes: [{ id: "work", title: "Work" }, { id: "review", title: "Review" }] },
      nodes: { work: { status: "completed", output: "draft" }, review: { status: "running", iterationCount: 1 } },
      workspaceRoot: process.cwd(),
      sessionDir: "/tmp/session",
      runDir: "/tmp/run",
      artifactDir: "/tmp/artifacts",
      iterationBriefs: {}
    },
    {
      id: "review",
      title: "Auto Review",
      agent: "Reviewer",
      task: "Review the work.",
      skills: [],
      dependsOn: ["work"],
      acceptance: ["Reviewed."],
      mode: "auto-review",
      requiresReview: false,
      sandbox: "read-only",
      networkPolicy: "confirm",
      reasoningEffort: "medium",
      reviewPolicy: {
        maxIterations: 3,
        targetNodeIds: ["work"],
        criteria: "Evidence must be present.",
        continueOnLimit: true
      }
    }
  );

  assert.match(prompt, /Auto-review policy/);
  assert.match(prompt, /Current iteration count: 1\/3/);
  assert.match(prompt, /targetNodeIds/);
  assert.match(prompt, /pass\|iterate\|capped/);
});

test("RunManager iterates auto-review target nodes before continuing", async () => {
  class AutoReviewManager extends RunManager {
    constructor(options) {
      super(options);
      this.calls = [];
      this.workAttempts = 0;
      this.reviewAttempts = 0;
    }

    async runCodexNode(run, node) {
      this.calls.push(node.id);
      if (node.id === "work") {
        this.workAttempts += 1;
        return { finalMessage: `work attempt ${this.workAttempts}`, stdout: "", durationMs: 5 };
      }
      if (node.id === "review") {
        this.reviewAttempts += 1;
        if (this.reviewAttempts === 1) {
          return {
            finalMessage: JSON.stringify({
              decision: "iterate",
              summary: "Draft is missing evidence.",
              issues: ["Missing evidence"],
              targetNodeIds: ["work"],
              iterationBrief: "Add evidence and rerun the draft."
            }),
            stdout: "",
            durationMs: 5
          };
        }
        return {
          finalMessage: JSON.stringify({
            decision: "pass",
            summary: "Draft now satisfies the review criteria.",
            issues: [],
            targetNodeIds: [],
            iterationBrief: ""
          }),
          stdout: "",
          durationMs: 5
        };
      }
      return { finalMessage: `${node.id} done`, stdout: "", durationMs: 5 };
    }
  }

  const manager = new AutoReviewManager({ root: process.cwd() });
  const snapshot = await manager.start({
    goal: "auto review iteration test",
    plan: {
      version: "1.0",
      name: "Auto Review Flow",
      summary: "Auto review should rerun work once.",
      maxConcurrency: 1,
      nodes: [
        {
          id: "work",
          title: "Work",
          agent: "Worker",
          task: "Create the result.",
          skills: [],
          dependsOn: [],
          acceptance: ["Done."],
          mode: "codex",
          requiresReview: false,
          sandbox: "workspace-write",
          networkPolicy: "confirm",
          x: 20,
          y: 20
        },
        {
          id: "review",
          title: "Auto Review",
          agent: "Reviewer",
          task: "Review and request bounded iteration.",
          skills: [],
          dependsOn: ["work"],
          acceptance: ["Reviewed."],
          mode: "auto-review",
          requiresReview: false,
          sandbox: "read-only",
          networkPolicy: "confirm",
          reviewPolicy: {
            maxIterations: 3,
            targetNodeIds: ["work"],
            criteria: "Require evidence.",
            continueOnLimit: true
          },
          x: 320,
          y: 20
        },
        {
          id: "final",
          title: "Final",
          agent: "Synthesizer",
          task: "Summarize the accepted result.",
          skills: [],
          dependsOn: ["review"],
          acceptance: ["Finalized."],
          mode: "synthesis",
          requiresReview: false,
          sandbox: "workspace-write",
          networkPolicy: "confirm",
          outputRequirement: { type: "markdown", custom: "" },
          x: 620,
          y: 20
        }
      ],
      edges: []
    }
  });

  const run = manager.get(snapshot.id);
  await waitFor(run, () => run.status === "completed", 3000);

  assert.deepEqual(manager.calls, ["work", "review", "work", "review", "final"]);
  assert.equal(run.nodes.work.output, "work attempt 2");
  assert.equal(run.nodes.review.iterationCount, 1);
  assert.equal(run.events.filter((event) => event.name === "node:iteration").length, 1);
  assert.match(run.nodes.review.output, /pass/);
});

test("RunManager caps auto-review iteration loops and continues", async () => {
  class CappedReviewManager extends RunManager {
    constructor(options) {
      super(options);
      this.calls = [];
    }

    async runCodexNode(run, node) {
      this.calls.push(node.id);
      if (node.id === "review") {
        return {
          finalMessage: JSON.stringify({
            decision: "iterate",
            summary: "Still has issues.",
            issues: ["Issue remains"],
            targetNodeIds: ["work"],
            iterationBrief: "Try to fix the remaining issue."
          }),
          stdout: "",
          durationMs: 5
        };
      }
      return { finalMessage: `${node.id} done`, stdout: "", durationMs: 5 };
    }
  }

  const manager = new CappedReviewManager({ root: process.cwd() });
  const snapshot = await manager.start({
    goal: "auto review cap test",
    plan: {
      version: "1.0",
      name: "Capped Review Flow",
      summary: "Auto review should stop at the limit.",
      maxConcurrency: 1,
      nodes: [
        {
          id: "work",
          title: "Work",
          agent: "Worker",
          task: "Create the result.",
          skills: [],
          dependsOn: [],
          acceptance: ["Done."],
          mode: "codex",
          requiresReview: false,
          sandbox: "workspace-write",
          networkPolicy: "confirm",
          x: 20,
          y: 20
        },
        {
          id: "review",
          title: "Auto Review",
          agent: "Reviewer",
          task: "Review and request bounded iteration.",
          skills: [],
          dependsOn: ["work"],
          acceptance: ["Reviewed."],
          mode: "auto-review",
          requiresReview: false,
          sandbox: "read-only",
          networkPolicy: "confirm",
          reviewPolicy: {
            maxIterations: 1,
            targetNodeIds: ["work"],
            criteria: "Require evidence.",
            continueOnLimit: true
          },
          x: 320,
          y: 20
        },
        {
          id: "final",
          title: "Final",
          agent: "Synthesizer",
          task: "Continue with remaining recommendations.",
          skills: [],
          dependsOn: ["review"],
          acceptance: ["Finalized."],
          mode: "synthesis",
          requiresReview: false,
          sandbox: "workspace-write",
          networkPolicy: "confirm",
          outputRequirement: { type: "markdown", custom: "" },
          x: 620,
          y: 20
        }
      ],
      edges: []
    }
  });

  const run = manager.get(snapshot.id);
  await waitFor(run, () => run.status === "completed", 3000);

  assert.deepEqual(manager.calls, ["work", "review", "work", "review", "final"]);
  assert.equal(run.nodes.review.iterationCount, 1);
  assert.match(run.nodes.review.output, /capped/);
  assert.equal(run.events.filter((event) => event.name === "node:iteration").length, 1);
});

test("RunManager pauses confirm-policy nodes for network approval and resumes with full access", async () => {
  class NetworkRequestManager extends RunManager {
    constructor(options) {
      super(options);
      this.calls = [];
    }

    async runCodexNode(run, node, state, outputPath, options = {}) {
      this.calls.push({ nodeId: node.id, options, runtimeSandbox: this.runtimeSandbox(node, options), networkEnabled: this.networkEnabled(node, options) });
      if (node.id !== "source-check") {
        return { finalMessage: `${node.id} done.`, stdout: "", durationMs: 5 };
      }
      if (!options.networkApproved) {
        return {
          finalMessage: [
            "NETWORK_ACCESS_REQUEST",
            "urls:",
            "- https://example.com/report.pdf",
            "reason:",
            "Need a public source.",
            "intended_outputs:",
            "- Save source markdown.",
            "risk_notes:",
            "- Public web request only."
          ].join("\n"),
          stdout: "",
          durationMs: 10
        };
      }
      return { finalMessage: "Completed with approved network access.", stdout: "", durationMs: 20 };
    }
  }

  const manager = new NetworkRequestManager({ root: process.cwd() });
  const snapshot = await manager.start({
    goal: "network approval test",
    plan: {
      version: "1.0",
      name: "Network Approval Flow",
      summary: "A plan that requests network approval.",
      maxConcurrency: 1,
      nodes: [
        {
          id: "source-check",
          title: "Source Check",
          agent: "Researcher",
          task: "Fetch public sources if approved.",
          skills: [],
          dependsOn: [],
          acceptance: ["Source is checked."],
          mode: "codex",
          requiresReview: false,
          sandbox: "workspace-write",
          networkPolicy: "confirm",
          x: 20,
          y: 20
        }
      ],
      edges: []
    }
  });

  const run = manager.get(snapshot.id);
  await waitFor(run, () => run.nodes["source-check"].status === "waiting");
  assert.equal(run.nodes["source-check"].waitingReason, "network");
  assert.match(run.nodes["source-check"].output, /NETWORK_ACCESS_REQUEST/);
  assert.equal(manager.calls[0].runtimeSandbox, "workspace-write");
  assert.equal(manager.calls[0].networkEnabled, false);

  assert.deepEqual(manager.continue(run.id, "source-check", "allowed"), { ok: true });
  await waitFor(run, () => run.status === "completed");

  assert.equal(manager.calls[1].options.networkApproved, true);
  assert.equal(manager.calls[1].runtimeSandbox, "danger-full-access");
  assert.equal(manager.calls[1].networkEnabled, true);
  assert.equal(run.nodes["source-check"].output, "Completed with approved network access.");
});

test("RunManager describes node network policy in prompts", () => {
  const manager = new RunManager({ root: process.cwd() });
  const run = {
    goal: "research",
    plan: { name: "Network Prompt Flow", nodes: [{ id: "n1", title: "Research" }] },
    nodes: {},
    workspaceRoot: process.cwd(),
    sessionDir: "/tmp/session",
    runDir: "/tmp/run",
    artifactDir: "/tmp/artifacts"
  };
  const node = {
    id: "n1",
    title: "Research",
    agent: "Researcher",
    task: "Research online if allowed.",
    skills: [],
    dependsOn: [],
    acceptance: ["Done."],
    mode: "codex",
    requiresReview: false,
    sandbox: "workspace-write",
    networkPolicy: "confirm",
    reasoningEffort: "medium"
  };

  const confirmPrompt = manager.nodePrompt(run, node);
  assert.match(confirmPrompt, /Network policy: confirm before networking/);
  assert.match(confirmPrompt, /NETWORK_ACCESS_REQUEST/);

  const fullPrompt = manager.nodePrompt(run, { ...node, networkPolicy: "full-access" });
  assert.match(fullPrompt, /Network policy: full access is enabled/);
  assert.doesNotMatch(fullPrompt, /confirm before networking/i);
});

test("RunManager treats configured node skills as mandatory while allowing autonomous tools", () => {
  const manager = new RunManager({ root: process.cwd() });
  const run = {
    goal: "strategy review",
    plan: { name: "Skill Rule Flow", nodes: [{ id: "n1", title: "Review" }] },
    nodes: {},
    workspaceRoot: process.cwd(),
    sessionDir: "/tmp/session",
    runDir: "/tmp/run",
    artifactDir: "/tmp/artifacts"
  };
  const prompt = manager.nodePrompt(run, {
    id: "n1",
    title: "Review",
    agent: "Strategist",
    task: "Review the opportunity.",
    skills: ["frank-wang-tao-perspective"],
    dependsOn: [],
    acceptance: ["Done."],
    mode: "codex",
    requiresReview: false,
    sandbox: "workspace-write",
    networkPolicy: "confirm",
    reasoningEffort: "medium"
  });

  assert.match(prompt, /configured node\.skills are mandatory/i);
  assert.match(prompt, /Apply every listed skill/i);
  assert.match(prompt, /autonomously use other available generic skills\/tools/i);
});

test("RunManager carries selected programming tool into runs and prompts", async () => {
  const manager = new RunManager({ root: process.cwd() });
  const snapshot = await manager.start({
    goal: "provider test",
    session: {
      id: "session-provider",
      config: {
        toolProvider: "claude",
        models: { executor: "opus", reasoningEffort: "high" }
      },
      paths: {
        workspaceRoot: process.cwd(),
        runsDir: "/tmp",
        sessionDir: "",
        artifactDir: "/tmp/artifacts",
        manifestPath: "/tmp/artifacts/manifest.json"
      }
    },
    plan: {
      version: "1.0",
      name: "Provider Flow",
      summary: "Provider test.",
      maxConcurrency: 1,
      nodes: [
        {
          id: "approval",
          title: "Approval",
          agent: "Human",
          task: "Confirm.",
          skills: [],
          dependsOn: [],
          acceptance: ["Approved."],
          mode: "human-review",
          requiresReview: true,
          sandbox: "read-only",
          x: 20,
          y: 20
        }
      ],
      edges: []
    }
  });

  const run = manager.get(snapshot.id);
  assert.equal(run.toolProvider, "claude");
  assert.equal(run.defaultExecutorModel, "opus");
  const prompt = manager.nodePrompt(run, {
    id: "n1",
    title: "Write",
    agent: "Worker",
    task: "Write output.",
    skills: [],
    dependsOn: [],
    acceptance: ["Done."],
    mode: "codex",
    requiresReview: false,
    sandbox: "workspace-write",
    networkPolicy: "confirm",
    reasoningEffort: "high"
  });
  assert.match(prompt, /visual Claude Code agent orchestration workflow/);
  manager.stop(run.id);
});
