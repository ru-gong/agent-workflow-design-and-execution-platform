import { EventEmitter } from "node:events";
import { promises as fs } from "node:fs";
import path from "node:path";
import { ROOT, RUNS_DIR, clampText, ensureDir, parseMaybeJson, safeId } from "./utils.js";
import { defaultReviewPolicy, normalizeOutputRequirement, normalizePlan, normalizeReviewPolicy } from "./planner.js";
import { defaultModelForProvider, normalizeToolProvider, providerLabel, runAgentExec } from "./codexRunner.js";

export class RunManager {
  constructor({ root = ROOT } = {}) {
    this.root = root;
    this.runs = new Map();
  }

  async start({ goal, plan, session }) {
    const runId = safeId("run");
    const normalized = normalizePlan(plan, goal);
    const runBaseDir = session?.paths?.runsDir || RUNS_DIR;
    const runDir = path.join(runBaseDir, runId);
    await ensureDir(runDir);
    await fs.writeFile(path.join(runDir, "plan.json"), JSON.stringify(normalized, null, 2));

    const run = {
      id: runId,
      goal: clampText(goal, 4000),
      plan: normalized,
      runDir,
      sessionId: session?.id || "",
      sessionDir: session?.paths?.sessionDir || "",
      artifactDir: session?.paths?.artifactDir || "",
      manifestPath: session?.paths?.manifestPath || "",
      workspaceRoot: session?.paths?.workspaceRoot || this.root,
      toolProvider: normalizeToolProvider(session?.config?.toolProvider || process.env.AGENT_TOOL_PROVIDER || "codex"),
      defaultExecutorModel: "",
      defaultReasoningEffort: session?.config?.models?.reasoningEffort || process.env.AGENT_EXEC_REASONING || process.env.CODEX_EXEC_REASONING || "medium",
      status: "running",
      startedAt: new Date().toISOString(),
      finishedAt: null,
      events: [],
      nodes: Object.fromEntries(
        normalized.nodes.map((node) => [
          node.id,
          {
            id: node.id,
            status: "pending",
            startedAt: null,
            finishedAt: null,
            output: "",
            error: "",
            durationMs: 0,
            waitingReason: "",
            iterationCount: 0,
            latestDecision: null
          }
        ])
      ),
      iterationBriefs: {},
      emitter: new EventEmitter(),
      waiters: [],
      reviewResolvers: new Map(),
      controllers: new Map(),
      cancelled: false
    };
    run.defaultExecutorModel = session?.config?.models?.executor
      || executorModelFromEnv(run.toolProvider)
      || defaultModelForProvider(run.toolProvider, "executor");

    this.runs.set(runId, run);
    this.emit(run, "run:started", this.snapshot(run));
    this.drive(run).catch((error) => {
      run.status = run.cancelled ? "cancelled" : "failed";
      run.finishedAt = new Date().toISOString();
      this.emit(run, "run:error", { error: error.message });
      this.emit(run, "run:finished", this.snapshot(run));
    });
    return this.snapshot(run);
  }

  get(runId) {
    return this.runs.get(runId);
  }

  snapshot(run) {
    return {
      id: run.id,
      sessionId: run.sessionId,
      goal: run.goal,
      status: run.status,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      plan: run.plan,
      nodes: run.nodes,
      paths: {
        workspaceRoot: run.workspaceRoot,
        sessionDir: run.sessionDir,
        runDir: run.runDir,
        artifactDir: run.artifactDir,
        manifestPath: run.manifestPath
      },
      toolProvider: run.toolProvider,
      events: run.events.slice(-300)
    };
  }

  subscribe(runId, res) {
    const run = this.get(runId);
    if (!run) return false;
    const listener = (event) => {
      res.write(`event: ${event.name}\n`);
      res.write(`data: ${JSON.stringify(event.data)}\n\n`);
    };
    run.emitter.on("event", listener);
    res.on("close", () => run.emitter.off("event", listener));
    return true;
  }

  continue(runId, nodeId, note = "") {
    const run = this.get(runId);
    if (!run) return { ok: false, error: "Run not found" };
    const resolver = run.reviewResolvers.get(nodeId);
    if (!resolver) return { ok: false, error: "Node is not waiting for review" };
    run.reviewResolvers.delete(nodeId);
    resolver({ note: clampText(note, 1000), at: new Date().toISOString() });
    this.wake(run);
    return { ok: true };
  }

  stop(runId) {
    const run = this.get(runId);
    if (!run) return { ok: false, error: "Run not found" };
    run.cancelled = true;
    run.status = "cancelled";
    for (const controller of run.controllers.values()) controller.abort();
    for (const [nodeId, resolver] of run.reviewResolvers.entries()) {
      resolver({ note: "Run cancelled", at: new Date().toISOString(), cancelled: true });
      run.reviewResolvers.delete(nodeId);
    }
    this.emit(run, "run:cancelled", this.snapshot(run));
    this.wake(run);
    return { ok: true };
  }

  async drive(run) {
    const active = new Map();
    const maxConcurrency = Math.max(1, Math.min(run.plan.maxConcurrency || 2, 4));

    while (!run.cancelled) {
      const runnable = this.runnableNodes(run, active);
      while (active.size < maxConcurrency && runnable.length) {
        const node = runnable.shift();
        const promise = this.executeNode(run, node)
          .catch((error) => {
            const state = run.nodes[node.id];
            state.status = run.cancelled ? "cancelled" : "failed";
            state.error = error.message;
            state.finishedAt = new Date().toISOString();
            this.emit(run, "node:failed", { nodeId: node.id, error: error.message });
            throw error;
          })
          .finally(() => {
            active.delete(node.id);
            this.wake(run);
          });
        active.set(node.id, promise);
      }

      if (this.isComplete(run)) {
        run.status = "completed";
        run.finishedAt = new Date().toISOString();
        await this.writeSummary(run);
        this.emit(run, "run:finished", this.snapshot(run));
        return;
      }

      const failed = Object.values(run.nodes).find((node) => node.status === "failed");
      if (failed) {
        run.status = "failed";
        run.finishedAt = new Date().toISOString();
        this.emit(run, "run:finished", this.snapshot(run));
        return;
      }

      if (active.size > 0) {
        await Promise.race([...active.values(), this.waitForWake(run)]);
        continue;
      }

      const waiting = Object.values(run.nodes).some((node) => node.status === "waiting");
      if (waiting) {
        await this.waitForWake(run);
        continue;
      }

      const pending = Object.values(run.nodes).filter((node) => node.status === "pending");
      if (pending.length) {
        throw new Error(`Workflow is blocked. Check dependencies for: ${pending.map((node) => node.id).join(", ")}`);
      }
    }

    run.status = "cancelled";
    run.finishedAt = new Date().toISOString();
    this.emit(run, "run:finished", this.snapshot(run));
  }

  runnableNodes(run, active) {
    return run.plan.nodes.filter((node) => {
      const state = run.nodes[node.id];
      if (!state || state.status !== "pending" || active.has(node.id)) return false;
      return (node.dependsOn || []).every((depId) => run.nodes[depId]?.status === "completed");
    });
  }

  async executeNode(run, node) {
    const state = run.nodes[node.id];
    state.status = node.mode === "human-review" || node.requiresReview ? "waiting" : "running";
    state.waitingReason = state.status === "waiting" ? "human-review" : "";
    state.startedAt = new Date().toISOString();

    if (state.status === "waiting") {
      const approvalPromise = new Promise((resolve) => run.reviewResolvers.set(node.id, resolve));
      this.emit(run, "node:waiting", { nodeId: node.id, node, reason: state.waitingReason });
      const result = await approvalPromise;
      if (result.cancelled) {
        state.status = "cancelled";
        state.finishedAt = new Date().toISOString();
        this.emit(run, "node:cancelled", { nodeId: node.id });
        return;
      }
      state.status = "completed";
      state.waitingReason = "";
      state.output = result.note || "Human review approved.";
      state.finishedAt = new Date().toISOString();
      state.durationMs = Date.parse(state.finishedAt) - Date.parse(state.startedAt);
      await fs.writeFile(path.join(run.runDir, `${node.id}.md`), state.output);
      this.emit(run, "node:completed", { nodeId: node.id, output: state.output });
      return;
    }

    this.emit(run, "node:started", { nodeId: node.id, node, reason: "" });

    const outputPath = path.join(run.runDir, `${node.id}.last-message.md`);
    let result = await this.runCodexNode(run, node, state, outputPath);
    let output = result.finalMessage || result.stdout;

    if (this.effectiveNetworkPolicy(node) === "confirm" && isNetworkAccessRequest(output)) {
      const approvalPromise = new Promise((resolve) => run.reviewResolvers.set(node.id, resolve));
      state.status = "waiting";
      state.waitingReason = "network";
      state.output = output;
      await fs.writeFile(path.join(run.runDir, `${node.id}.network-request.md`), output || "");
      this.emit(run, "node:waiting", { nodeId: node.id, node, reason: "network", output });
      const approval = await approvalPromise;
      if (approval.cancelled) {
        state.status = "cancelled";
        state.waitingReason = "";
        state.finishedAt = new Date().toISOString();
        this.emit(run, "node:cancelled", { nodeId: node.id });
        return;
      }
      state.status = "running";
      state.waitingReason = "";
      this.emit(run, "node:started", { nodeId: node.id, node, reason: "network-approved" });
      result = await this.runCodexNode(run, node, state, outputPath, {
        networkApproved: true,
        previousNetworkRequest: output,
        approvalNote: approval.note || "用户已允许该节点完全联网。"
      });
      output = result.finalMessage || result.stdout;
    }

    if (node.mode === "auto-review") {
      await this.completeAutoReviewNode(run, node, state, result, output);
      return;
    }

    state.status = "completed";
    state.waitingReason = "";
    state.output = output;
    state.finishedAt = new Date().toISOString();
    state.durationMs = result.durationMs;
    await fs.writeFile(path.join(run.runDir, `${node.id}.md`), state.output || "");
    this.emit(run, "node:completed", { nodeId: node.id, output: state.output, durationMs: state.durationMs });
  }

  async runCodexNode(run, node, state, outputPath, options = {}) {
    const prompt = this.nodePrompt(run, node, options);
    const promptSuffix = options.networkApproved ? ".network-approved" : "";
    await fs.writeFile(path.join(run.runDir, `${node.id}${promptSuffix}.prompt.md`), prompt);

    if (process.env.USE_MOCK_CODEX === "1") {
      return this.executeMockNode(run, node, state, outputPath);
    }

    const controller = new AbortController();
    run.controllers.set(node.id, controller);
    let collapsedCodexNoise = false;
    const label = providerLabel(run.toolProvider);
    const heartbeat = setInterval(() => {
      const elapsedSeconds = Math.round((Date.now() - Date.parse(state.startedAt)) / 1000);
      this.emit(run, "node:log", {
        nodeId: node.id,
        stream: "status",
        text: `${label} 仍在执行 ${node.title}，已运行 ${elapsedSeconds}s。`
      });
    }, 15000);

    try {
      const sandbox = this.runtimeSandbox(node, options);
      return await runAgentExec({
        provider: run.toolProvider,
        prompt,
        cwd: run.workspaceRoot || this.root,
        sandbox,
        model: node.model || run.defaultExecutorModel,
        reasoningEffort: node.reasoningEffort || run.defaultReasoningEffort,
        outputPath,
        signal: controller.signal,
        resolveOnOutputFile: "text",
        ephemeral: true,
        ignoreUserConfig: true,
        ignoreRules: true,
        onEvent: (event) => {
          const cleaned = cleanCodexLog(event.text, () => {
            if (collapsedCodexNoise) return false;
            collapsedCodexNoise = true;
            return true;
          });
          if (cleaned) this.emit(run, "node:log", { nodeId: node.id, stream: event.type, text: cleaned });
        }
      });
    } finally {
      clearInterval(heartbeat);
      run.controllers.delete(node.id);
    }
  }

  async executeMockNode(run, node, state, outputPath) {
    const label = providerLabel(run.toolProvider);
    if (node.mode === "auto-review") {
      const output = JSON.stringify({
        decision: "pass",
        summary: `Mock ${label} auto review passed for node ${node.id}.`,
        issues: [],
        targetNodeIds: [],
        iterationBrief: ""
      }, null, 2);
      this.emit(run, "node:log", { nodeId: node.id, stream: "mock", text: "自动评审通过，继续推进" });
      await fs.writeFile(outputPath, output);
      return {
        finalMessage: output,
        stdout: output,
        durationMs: Date.now() - Date.parse(state.startedAt)
      };
    }
    const skillText = (node.skills || []).length ? `应用 skills：${node.skills.join(", ")}` : `未配置专用 skill，使用通用 ${label} 执行策略`;
    const finalStep = this.effectiveSandbox(node) === "read-only"
      ? "整理只读节点结论并交给运行器保存"
      : "整理执行结果并写入产物记录";
    const messages = [
      "读取节点配置与上游输出",
      skillText,
      finalStep
    ];
    for (const message of messages) {
      if (run.cancelled) throw new Error("Run cancelled");
      this.emit(run, "node:log", { nodeId: node.id, stream: "mock", text: message });
      await sleep(360);
    }

    const output = [
      `# ${node.title}`,
      "",
      `Mock ${label} result for node ${node.id}.`,
      "",
      `Task: ${node.task}`,
      "",
      "This mock output is generated because USE_MOCK_CODEX=1."
    ].join("\n");
    await fs.writeFile(outputPath, output);
    return {
      finalMessage: output,
      stdout: output,
      durationMs: Date.now() - Date.parse(state.startedAt)
    };
  }

  nodePrompt(run, node, options = {}) {
    const sandbox = this.effectiveSandbox(node);
    const networkPolicy = options.networkApproved ? "full-access" : this.effectiveNetworkPolicy(node);
    const label = providerLabel(run.toolProvider);
    const configuredSkills = node.skills || [];
    const skillRules = configuredSkills.length
      ? [
          "- The configured node.skills are mandatory specialty skills. Apply every listed skill and make its influence visible in your work or final summary.",
          run.toolProvider === "claude"
            ? "- The listed skills come from Claude Code's active skill registry. Invoke the matching /skill-name slash skill when Claude Code exposes it."
            : "- The listed skills come from Codex's active skill registry. Use the matching Codex skill when it is available.",
          "- You may also autonomously use other available generic skills/tools when they help complete the node. Absence from node.skills is not a prohibition."
        ]
      : [
          "- No mandatory specialty skills are configured for this node. Autonomously choose any available generic skills/tools that help complete the node."
        ];
    const networkRules = networkPolicy === "full-access"
      ? [
          "- Network policy: full access is enabled for this node. You may use networked CLI tools such as curl, wget, defuddle, package downloads, or browser navigation when relevant.",
          "- Keep network use scoped to this node. Prefer authoritative sources, save fetched source files under the artifact directory when they support user-facing deliverables, and mention source paths in the final summary.",
          "- Do not access private services or transmit sensitive data unless the user explicitly asked for that data flow."
        ]
      : [
          "- Network policy: confirm before networking. Do not use external network access in this attempt, including curl, wget, defuddle parse for remote URLs, npm/pip downloads, or browser navigation.",
          "- If this node needs external network access, stop and finish with a NETWORK_ACCESS_REQUEST block instead of trying the network command.",
          "- The block format must be exactly: NETWORK_ACCESS_REQUEST, then urls:, reason:, intended_outputs:, and risk_notes:. Include concrete URLs/domains when known."
        ];
    const artifactRules = sandbox === "read-only"
      ? [
          "- This node is running in a read-only sandbox. Do not attempt to create, edit, or write files.",
          "- The runner automatically captures and persists your final message as this node's output.",
          "- If the task appears to need a file artifact, describe the recommended filename, content outline, and why a downstream workspace-write node should create it.",
          "- Do not report read-only filesystem access as a blocker when the node can complete with a textual result."
        ]
      : [
          "- Put user-facing deliverables under the artifact directory when file output is needed.",
          "- If you create or update deliverables, update manifest.json in the artifact directory with path, source node id, title, and a short description."
        ];
    const outputRequirement = node.mode === "synthesis" ? this.outputRequirementText(node) : "(Only applies to synthesis nodes.)";
    const autoReviewRules = node.mode === "auto-review" ? this.autoReviewPromptText(run, node) : "(Only applies to auto-review nodes.)";
    const iterationGuidance = this.iterationGuidanceText(run, node);
    const upstream = (node.dependsOn || [])
      .map((depId) => {
        const dep = run.nodes[depId];
        const planNode = run.plan.nodes.find((candidate) => candidate.id === depId);
        return `## Upstream: ${planNode?.title || depId}\nStatus: ${dep?.status}\nOutput:\n${clampText(dep?.output || dep?.error || "", 5000)}`;
      })
      .join("\n\n");

    return `You are executing one node in a visual ${label} agent orchestration workflow.

Global user goal:
${run.goal}

Plan name:
${run.plan.name}

Workspace root:
${run.workspaceRoot || this.root}

Session records directory:
${run.sessionDir || run.runDir}

Artifact directory for user-facing deliverables:
${run.artifactDir || "(not configured)"}

Current node:
- id: ${node.id}
- title: ${node.title}
- agent role: ${node.agent}
- mode: ${node.mode}
- skills to apply: ${(node.skills || []).join(", ") || "(none specified)"}
- sandbox: ${sandbox}
- network policy: ${networkPolicy}
- reasoning effort: ${node.reasoningEffort || "default"}
${options.networkApproved ? `- approved network request: ${clampText(options.previousNetworkRequest || "", 1800)}
- user approval note: ${clampText(options.approvalNote || "", 800)}` : ""}

Synthesis output requirement:
${outputRequirement}

Auto-review policy:
${autoReviewRules}

Iteration guidance for this node:
${iterationGuidance}

Task:
${node.task}

Acceptance criteria:
${(node.acceptance || []).map((item) => `- ${item}`).join("\n")}

Upstream context:
${upstream || "(This node has no dependencies.)"}

Execution rules:
- Use ${label} capabilities fully and autonomously within the node scope.
${skillRules.join("\n")}
- Produce concrete work products whenever the task requires it.
${artifactRules.join("\n")}
${networkRules.join("\n")}
- Run or describe verification that is appropriate for the node.
- Do not ask for interactive input. If blocked, state the blocker, evidence, and best next action.
- Finish with a concise node result summary and any paths changed or produced.
`;
  }

  outputRequirementText(node) {
    const requirement = normalizeOutputRequirement(node.outputRequirement);
    const labels = {
      ppt: "PPT / presentation deck",
      html: "HTML / web page",
      markdown: "MD document / Markdown",
      spreadsheet: "spreadsheet / table",
      image: "image",
      pdf: "PDF document",
      docx: "Word document / DOCX",
      other: "custom deliverable"
    };
    const custom = requirement.custom.trim();
    return [
      `- Required final output type: ${labels[requirement.type] || labels.markdown} (${requirement.type}).`,
      custom ? `- User-supplied output requirement: ${custom}` : "- User-supplied output requirement: (none).",
      "- Shape the final answer and any user-facing artifacts around this requirement.",
      "- If the requested type needs a file artifact and the sandbox allows writing, create it under the artifact directory and register it in manifest.json."
    ].join("\n");
  }

  autoReviewPromptText(run, node) {
    const policy = this.effectiveReviewPolicy(run, node);
    const state = run.nodes[node.id] || {};
    const currentIteration = state.iterationCount || 0;
    return [
      `- Current iteration count: ${currentIteration}/${policy.maxIterations}.`,
      `- Target nodes eligible for rerun: ${policy.targetNodeIds.join(", ") || "(none configured)"}.`,
      `- Review criteria: ${policy.criteria || "Check whether upstream work satisfies the original user goal and acceptance criteria."}`,
      "- Act as an autonomous quality reviewer. Inspect upstream outputs and artifact references against the global goal, current node task, acceptance criteria, and review criteria.",
      "- If the work is good enough, return decision \"pass\".",
      "- If you find concrete, fixable gaps and the iteration count has not reached the limit, return decision \"iterate\" and include targetNodeIds plus a precise iterationBrief for the rerun.",
      "- If issues remain but the iteration limit is already reached, return decision \"capped\" with the remaining issues and recommendations.",
      "- Return only one JSON object, with this shape: {\"decision\":\"pass|iterate|capped\",\"summary\":\"...\",\"issues\":[\"...\"],\"targetNodeIds\":[\"...\"],\"iterationBrief\":\"...\"}."
    ].join("\n");
  }

  iterationGuidanceText(run, node) {
    const entries = run.iterationBriefs?.[node.id] || [];
    if (!entries.length) return "(No iteration guidance for this node.)";
    return entries
      .slice(-3)
      .map((entry) => `- Round ${entry.iteration} from ${entry.reviewNodeId}: ${entry.brief}`)
      .join("\n");
  }

  async completeAutoReviewNode(run, node, state, result, output) {
    const policy = this.effectiveReviewPolicy(run, node);
    const parsed = parseAutoReviewDecision(output);
    const targetNodeIds = this.validReviewTargets(run, node, parsed.targetNodeIds?.length ? parsed.targetNodeIds : policy.targetNodeIds);
    const wantsIteration = parsed.decision === "iterate";
    const currentIteration = state.iterationCount || 0;
    const canIterate = wantsIteration && currentIteration < policy.maxIterations && targetNodeIds.length > 0;
    const nextIteration = canIterate ? currentIteration + 1 : currentIteration;
    const capped = wantsIteration && !canIterate;
    const finalDecision = capped ? "capped" : parsed.decision;
    const finalOutput = formatAutoReviewOutput({
      ...parsed,
      decision: finalDecision,
      targetNodeIds,
      iteration: nextIteration,
      maxIterations: policy.maxIterations
    });

    state.waitingReason = "";
    state.output = finalOutput;
    state.latestDecision = {
      decision: finalDecision,
      summary: parsed.summary,
      issues: parsed.issues,
      targetNodeIds,
      iteration: nextIteration,
      maxIterations: policy.maxIterations
    };
    state.durationMs = result.durationMs;

    await fs.writeFile(path.join(run.runDir, `${node.id}.md`), finalOutput);
    await this.writeIterationRecord(run, node, {
      decision: finalDecision,
      rawDecision: parsed,
      iteration: nextIteration,
      maxIterations: policy.maxIterations,
      targetNodeIds,
      output: finalOutput
    });

    if (canIterate) {
      state.iterationCount = nextIteration;
      const brief = parsed.iterationBrief || parsed.summary || "请根据自动评审发现的问题修正该节点输出。";
      for (const targetNodeId of targetNodeIds) this.addIterationBrief(run, targetNodeId, node.id, nextIteration, brief, parsed.issues);
      const affectedNodeIds = this.resetNodesForIteration(run, node, targetNodeIds);
      const reviewState = run.nodes[node.id];
      reviewState.status = "pending";
      reviewState.waitingReason = "";
      reviewState.output = finalOutput;
      reviewState.error = "";
      reviewState.startedAt = null;
      reviewState.finishedAt = null;
      reviewState.durationMs = 0;
      reviewState.iterationCount = nextIteration;
      reviewState.latestDecision = state.latestDecision;
      this.emit(run, "node:iteration", {
        nodeId: node.id,
        iteration: nextIteration,
        maxIterations: policy.maxIterations,
        targetNodeIds,
        affectedNodeIds,
        summary: parsed.summary || "自动评审要求返工。",
        issues: parsed.issues,
        iterationBrief: brief
      });
      return;
    }

    if (capped && !policy.continueOnLimit) {
      const approvalPromise = new Promise((resolve) => run.reviewResolvers.set(node.id, resolve));
      state.status = "waiting";
      state.waitingReason = "auto-review-limit";
      this.emit(run, "node:waiting", { nodeId: node.id, node, reason: "auto-review-limit", output: state.output });
      const approval = await approvalPromise;
      if (approval.cancelled) {
        state.status = "cancelled";
        state.waitingReason = "";
        state.finishedAt = new Date().toISOString();
        this.emit(run, "node:cancelled", { nodeId: node.id });
        return;
      }
      state.output = [state.output, "", `人工确认：${approval.note || "继续推进。"}`].join("\n");
    }

    state.status = "completed";
    state.finishedAt = new Date().toISOString();
    state.iterationCount = currentIteration;
    this.emit(run, "node:completed", { nodeId: node.id, output: state.output, durationMs: state.durationMs });
    if (capped && policy.continueOnLimit) {
      this.emit(run, "node:log", {
        nodeId: node.id,
        stream: "auto-review",
        text: "自动评审达到迭代上限，已保留问题建议并继续推进。"
      });
    }
  }

  effectiveReviewPolicy(run, node) {
    const normalized = normalizeReviewPolicy(node.reviewPolicy || defaultReviewPolicy());
    const targets = this.validReviewTargets(run, node, normalized.targetNodeIds);
    if (targets.length) return { ...normalized, targetNodeIds: targets };
    const directTarget = [...(node.dependsOn || [])]
      .reverse()
      .find((id) => {
        const candidate = run.plan.nodes.find((item) => item.id === id);
        return candidate && !["human-review", "auto-review"].includes(candidate.mode);
      });
    return {
      ...normalized,
      targetNodeIds: directTarget ? [directTarget] : this.validReviewTargets(run, node, node.dependsOn || []).slice(-1)
    };
  }

  validReviewTargets(run, node, requestedIds = []) {
    const ancestors = collectRunAncestorIds(run.plan, node.id);
    const seen = new Set();
    return requestedIds
      .filter((id) => ancestors.has(id) && id !== node.id)
      .filter((id) => {
        if (seen.has(id)) return false;
        seen.add(id);
        return true;
      })
      .slice(0, 6);
  }

  addIterationBrief(run, targetNodeId, reviewNodeId, iteration, brief, issues = []) {
    run.iterationBriefs[targetNodeId] = run.iterationBriefs[targetNodeId] || [];
    run.iterationBriefs[targetNodeId].push({
      reviewNodeId,
      iteration,
      brief: clampText(brief, 1200),
      issues: issues.map((issue) => clampText(issue, 400)).slice(0, 10),
      at: new Date().toISOString()
    });
  }

  resetNodesForIteration(run, reviewNode, targetNodeIds) {
    const ancestors = collectRunAncestorIds(run.plan, reviewNode.id);
    const descendants = collectRunDescendantIds(run.plan, targetNodeIds);
    const affected = new Set([
      ...targetNodeIds,
      ...[...descendants].filter((id) => ancestors.has(id)),
      reviewNode.id
    ]);
    for (const nodeId of affected) {
      const state = run.nodes[nodeId];
      if (!state) continue;
      const previousIterationCount = state.iterationCount || 0;
      const previousDecision = state.latestDecision || null;
      state.status = "pending";
      state.startedAt = null;
      state.finishedAt = null;
      state.output = "";
      state.error = "";
      state.durationMs = 0;
      state.waitingReason = "";
      state.iterationCount = nodeId === reviewNode.id ? previousIterationCount : 0;
      state.latestDecision = nodeId === reviewNode.id ? previousDecision : null;
    }
    return [...affected];
  }

  async writeIterationRecord(run, node, record) {
    const iterationDir = path.join(run.runDir, "iterations");
    await ensureDir(iterationDir);
    const iteration = record.iteration || (run.nodes[node.id]?.iterationCount || 0);
    await fs.writeFile(
      path.join(iterationDir, `${node.id}-round-${iteration || 0}-${record.decision || "decision"}.json`),
      JSON.stringify({ at: new Date().toISOString(), nodeId: node.id, ...record }, null, 2)
    );
  }

  effectiveSandbox(node) {
    if (node.mode === "auto-review") return "read-only";
    if (["read-only", "workspace-write"].includes(node.sandbox)) return node.sandbox;
    return ["synthesis", "auto-review"].includes(node.mode) ? "read-only" : "workspace-write";
  }

  effectiveNetworkPolicy(node) {
    return ["confirm", "full-access"].includes(node.networkPolicy) ? node.networkPolicy : "confirm";
  }

  networkEnabled(node, options = {}) {
    return options.networkApproved || this.effectiveNetworkPolicy(node) === "full-access";
  }

  runtimeSandbox(node, options = {}) {
    if (this.networkEnabled(node, options)) return "danger-full-access";
    return this.effectiveSandbox(node);
  }

  isComplete(run) {
    return Object.values(run.nodes).every((node) => ["completed", "skipped"].includes(node.status));
  }

  waitForWake(run) {
    return new Promise((resolve) => run.waiters.push(resolve));
  }

  wake(run) {
    const waiters = run.waiters.splice(0);
    for (const resolve of waiters) resolve();
  }

  emit(run, name, data) {
    const event = { name, data, at: new Date().toISOString() };
    run.events.push(event);
    if (run.events.length > 1000) run.events.splice(0, run.events.length - 1000);
    run.emitter.emit("event", event);
    if (run.sessionDir) {
      const line = JSON.stringify({
        at: event.at,
        type: name,
        runId: run.id,
        data: clampEventData(data)
      });
      fs.appendFile(path.join(run.sessionDir, "conversation.jsonl"), `${line}\n`).catch(() => {});
    }
  }

  async writeSummary(run) {
    const lines = [
      `# ${run.plan.name}`,
      "",
      `Status: ${run.status}`,
      `Goal: ${run.goal}`,
      "",
      "## Node Results",
      ...run.plan.nodes.map((node) => {
        const state = run.nodes[node.id];
        return `\n### ${node.title}\nStatus: ${state.status}\n${clampText(state.output || state.error || "", 4000)}`;
      })
    ];
    await fs.writeFile(path.join(run.runDir, "summary.md"), lines.join("\n"));
  }
}

function clampEventData(value) {
  if (typeof value === "string") return clampText(value, 4000);
  if (!value || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.slice(0, 20).map(clampEventData);
  const copy = {};
  for (const [key, item] of Object.entries(value)) {
    if (key === "output" || key === "error" || key === "text" || key === "raw") copy[key] = clampText(item, 4000);
    else if (key === "nodes") copy[key] = "[nodes omitted from conversation log]";
    else copy[key] = clampEventData(item);
  }
  return copy;
}

function cleanCodexLog(text, shouldAnnounceCollapse) {
  const lines = String(text || "").replace(/\r/g, "").split("\n");
  const kept = [];
  for (const line of lines) {
    if (isNoisyCodexLine(line)) {
      if (shouldAnnounceCollapse()) {
        kept.push("[codex] 已折叠插件同步/manifest 噪声日志，不影响本次执行。");
      }
      continue;
    }
    kept.push(line);
  }
  return clampText(kept.join("\n"), 3000);
}

function isNoisyCodexLine(line) {
  const text = String(line || "");
  return /codex_core::plugins|codex_core_plugins::manifest|chatgpt\.com\/backend-api\/plugins|__cf_chl|cf_chl|challenge-platform|Enable JavaScript and cookies|interface\.defaultPrompt|window\._cf_chl_opt|scale-appear|managed challenge|cdn-cgi/i.test(text)
    || /^\s*<\/?(html|head|body|div|svg|path|meta|script|style|noscript)\b/i.test(text)
    || (text.length > 1000 && /<[^>]+>/.test(text));
}

function isNetworkAccessRequest(text) {
  return /^\s*NETWORK_ACCESS_REQUEST\b/im.test(String(text || ""));
}

function parseAutoReviewDecision(output) {
  try {
    const parsed = parseMaybeJson(output);
    const decision = ["pass", "iterate", "capped"].includes(parsed.decision) ? parsed.decision : "pass";
    return {
      decision,
      summary: clampText(parsed.summary || "", 1200),
      issues: Array.isArray(parsed.issues) ? parsed.issues.map((item) => clampText(item, 500)).slice(0, 12) : [],
      targetNodeIds: Array.isArray(parsed.targetNodeIds) ? parsed.targetNodeIds.map(String).slice(0, 6) : [],
      iterationBrief: clampText(parsed.iterationBrief || "", 1600)
    };
  } catch {
    return {
      decision: "pass",
      summary: clampText(output || "自动评审未返回结构化 JSON，按通过处理。", 1200),
      issues: [],
      targetNodeIds: [],
      iterationBrief: ""
    };
  }
}

function formatAutoReviewOutput(decision) {
  const lines = [
    `# 自动评审结果：${decision.decision}`,
    "",
    `迭代轮次：${decision.iteration}/${decision.maxIterations}`,
    "",
    "## 摘要",
    decision.summary || (decision.decision === "pass" ? "上游结果通过自动评审。" : "自动评审发现需要关注的问题。"),
    "",
    "## 问题",
    ...(decision.issues?.length ? decision.issues.map((issue) => `- ${issue}`) : ["- 未发现阻断性问题。"]),
    "",
    "## 返工目标",
    decision.targetNodeIds?.length ? decision.targetNodeIds.map((id) => `- ${id}`).join("\n") : "- 无",
    "",
    "## 返工说明",
    decision.iterationBrief || (decision.decision === "iterate" ? "请按上述问题修正后重新评审。" : "无需返工。")
  ];
  return lines.join("\n");
}

function collectRunAncestorIds(plan, nodeId) {
  const byId = new Map((plan.nodes || []).map((node) => [node.id, node]));
  const visited = new Set();
  const visit = (id) => {
    const node = byId.get(id);
    if (!node) return;
    for (const depId of node.dependsOn || []) {
      if (visited.has(depId)) continue;
      visited.add(depId);
      visit(depId);
    }
  };
  visit(nodeId);
  return visited;
}

function collectRunDescendantIds(plan, startIds = []) {
  const children = new Map();
  for (const node of plan.nodes || []) {
    for (const depId of node.dependsOn || []) {
      const list = children.get(depId) || [];
      list.push(node.id);
      children.set(depId, list);
    }
  }
  const visited = new Set();
  const queue = [...startIds];
  while (queue.length) {
    const id = queue.shift();
    for (const childId of children.get(id) || []) {
      if (visited.has(childId)) continue;
      visited.add(childId);
      queue.push(childId);
    }
  }
  return visited;
}

function executorModelFromEnv(provider) {
  if (provider === "claude") return process.env.CLAUDE_EXEC_MODEL || process.env.AGENT_EXEC_MODEL || "";
  return process.env.CODEX_EXEC_MODEL || process.env.AGENT_EXEC_MODEL || "";
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
