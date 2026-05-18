import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { PLAN_SCHEMA_PATH, ROOT, ensureDir, safeId } from "./utils.js";

export const PROGRAMMING_TOOLS = {
  codex: {
    id: "codex",
    label: "Codex",
    command: "codex",
    plannerDefaultModel: "gpt-5.3-codex",
    executorDefaultModel: "gpt-5.3-codex",
    models: ["gpt-5.5", "gpt-5.4", "gpt-5.4-mini", "gpt-5.3-codex", "gpt-5.3-codex-spark", "gpt-5.2"]
  },
  claude: {
    id: "claude",
    label: "Claude Code",
    command: "claude",
    plannerDefaultModel: "sonnet",
    executorDefaultModel: "sonnet",
    models: ["sonnet", "opus", "haiku", "opusplan", "claude-sonnet-4-6", "claude-opus-4-7"]
  }
};

export const CODEX_EFFORT_LEVELS = ["low", "medium", "high", "xhigh"];
export const CLAUDE_SONNET_EFFORT_LEVELS = ["low", "medium", "high", "max"];
export const CLAUDE_OPUS_47_EFFORT_LEVELS = ["low", "medium", "high", "xhigh", "max"];
export const CLAUDE_UNSUPPORTED_EFFORT_LEVELS = [];

export function normalizeToolProvider(value) {
  return PROGRAMMING_TOOLS[value] ? value : "codex";
}

export function providerLabel(provider) {
  return PROGRAMMING_TOOLS[normalizeToolProvider(provider)].label;
}

export function defaultModelForProvider(provider, role = "executor") {
  const tool = PROGRAMMING_TOOLS[normalizeToolProvider(provider)];
  return role === "planner" ? tool.plannerDefaultModel : tool.executorDefaultModel;
}

export function effortLevelsForProvider(provider = "codex", model = "") {
  const normalizedProvider = normalizeToolProvider(provider);
  if (normalizedProvider === "codex") return CODEX_EFFORT_LEVELS;

  const normalizedModel = String(model || "").trim().toLowerCase();
  if (!normalizedModel || normalizedModel === "sonnet" || normalizedModel === "claude-sonnet-4-6") {
    return CLAUDE_SONNET_EFFORT_LEVELS;
  }
  if (
    normalizedModel === "opus"
    || normalizedModel === "best"
    || normalizedModel === "opus[1m]"
    || normalizedModel === "claude-opus-4-7"
    || normalizedModel === "claude-opus-4-7[1m]"
  ) {
    return CLAUDE_OPUS_47_EFFORT_LEVELS;
  }
  if (normalizedModel === "opusplan" || normalizedModel === "default" || normalizedModel === "claude-opus-4-6") {
    return CLAUDE_SONNET_EFFORT_LEVELS;
  }
  return CLAUDE_UNSUPPORTED_EFFORT_LEVELS;
}

export function normalizeReasoningEffortForProvider(provider = "codex", model = "", effort = "", fallback = "medium") {
  const levels = effortLevelsForProvider(provider, model);
  if (!levels.length) return "";
  const requested = String(effort || "").trim().toLowerCase();
  if (levels.includes(requested)) return requested;

  const rank = ["low", "medium", "high", "xhigh", "max"];
  const requestedIndex = rank.indexOf(requested);
  if (requestedIndex >= 0) {
    for (let index = requestedIndex; index >= 0; index -= 1) {
      if (levels.includes(rank[index])) return rank[index];
    }
  }

  return levels.includes(fallback) ? fallback : levels[0];
}

export async function detectProgrammingTools({ runner = spawn } = {}) {
  const entries = await Promise.all(
    Object.values(PROGRAMMING_TOOLS).map(async (tool) => {
      const status = await commandExists(tool.command, runner);
      return [
        tool.id,
        {
          id: tool.id,
          label: tool.label,
          command: tool.command,
          ok: status.ok,
          version: status.version,
          plannerDefaultModel: tool.plannerDefaultModel,
          executorDefaultModel: tool.executorDefaultModel,
          models: tool.models
        }
      ];
    })
  );
  return Object.fromEntries(entries);
}

export function commandExists(command, runner = spawn) {
  return new Promise((resolve) => {
    const child = runner(command, ["--version"], spawnOptions({ stdio: ["ignore", "pipe", "pipe"] }));
    let output = "";
    child.stdout?.on("data", (chunk) => {
      output += chunk.toString();
    });
    child.stderr?.on("data", (chunk) => {
      output += chunk.toString();
    });
    child.on("error", () => resolve({ ok: false, version: "" }));
    child.on("close", (code) => resolve({ ok: code === 0, version: output.trim() }));
  });
}

export async function runAgentExec({
  provider = "codex",
  prompt,
  cwd = ROOT,
  sandbox = "workspace-write",
  model = "",
  schemaPath = "",
  outputPath = "",
  timeoutMs = 15 * 60 * 1000,
  onEvent = () => {},
  env = process.env,
  signal,
  resolveOnOutputFile = false,
  reasoningEffort = "",
  ephemeral = false,
  ignoreUserConfig = false,
  ignoreRules = false
}) {
  const normalizedProvider = normalizeToolProvider(provider);
  const tool = PROGRAMMING_TOOLS[normalizedProvider];
  const schema = normalizedProvider === "claude" && schemaPath ? await readJsonSchemaForCli(schemaPath) : "";
  const args = buildToolExecArgs({
    provider: normalizedProvider,
    sandbox,
    cwd,
    ephemeral,
    ignoreUserConfig,
    ignoreRules,
    model,
    reasoningEffort,
    schemaPath,
    outputPath,
    schema
  });

  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const child = spawn(tool.command, args, spawnOptions({
      cwd,
      env: { ...env, NO_COLOR: "1" },
      stdio: ["pipe", "pipe", "pipe"]
    }));
    let stdout = "";
    let stderr = "";
    let settled = false;
    let outputPoller = null;
    let lastOutputSignature = "";

    const cleanup = (abort) => {
      clearTimeout(timer);
      if (outputPoller) clearInterval(outputPoller);
      signal?.removeEventListener("abort", abort);
    };

    const settle = (abort, handler) => {
      if (settled) return false;
      settled = true;
      cleanup(abort);
      handler();
      return true;
    };

    const timer = setTimeout(() => {
      settle(abort, () => {
        child.kill("SIGTERM");
        reject(new Error(`${tool.label} timed out after ${Math.round(timeoutMs / 1000)}s`));
      });
    }, timeoutMs);

    const abort = () => {
      settle(abort, () => {
        child.kill("SIGTERM");
        reject(new Error(`${tool.label} run was cancelled`));
      });
    };

    signal?.addEventListener("abort", abort, { once: true });

    if (normalizedProvider === "codex" && resolveOnOutputFile && outputPath) {
      outputPoller = setInterval(async () => {
        if (settled) return;
        try {
          const finalMessage = await fs.readFile(outputPath, "utf8");
          if (!finalMessage.trim()) return;
          const mode = resolveOnOutputFile === true ? "json" : resolveOnOutputFile;
          if (mode === "json") {
            JSON.parse(finalMessage);
          } else if (mode === "text") {
            const signature = `${finalMessage.length}:${finalMessage.slice(-160)}`;
            if (lastOutputSignature !== signature) {
              lastOutputSignature = signature;
              return;
            }
          }
          settle(abort, () => {
            child.kill("SIGTERM");
            resolve({
              code: 0,
              stdout,
              stderr,
              finalMessage,
              durationMs: Date.now() - startedAt,
              resolvedFromOutputFile: true
            });
          });
        } catch {
          // The file may not exist yet, or the tool may still be writing it.
        }
      }, 1000);
    }

    child.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      stdout += text;
      onEvent({ type: "stdout", text });
    });

    child.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      stderr += text;
      onEvent({ type: "stderr", text });
    });

    child.on("error", (error) => {
      settle(abort, () => reject(error));
    });

    child.on("close", async (code) => {
      if (settled) return;
      let finalMessage = "";
      if (outputPath && normalizedProvider === "codex") {
        try {
          finalMessage = await fs.readFile(outputPath, "utf8");
        } catch {
          finalMessage = "";
        }
      }
      finalMessage = finalMessage || stdout;
      if (outputPath && normalizedProvider !== "codex" && finalMessage.trim()) {
        try {
          await fs.writeFile(outputPath, finalMessage);
        } catch {
          // The caller still receives stdout as finalMessage if sidecar persistence fails.
        }
      }
      const result = {
        code,
        stdout,
        stderr,
        finalMessage,
        durationMs: Date.now() - startedAt
      };
      settle(abort, () => {
        if (code === 0) resolve(result);
        else {
          const error = new Error(`${tool.label} exited with code ${code}`);
          error.result = result;
          reject(error);
        }
      });
    });

    child.stdin.end(prompt);
  });
}

function spawnOptions(options) {
  if (process.platform !== "win32") return options;
  return { ...options, shell: true, windowsHide: true };
}

export async function runCodexExec(options) {
  return runAgentExec({ ...options, provider: "codex" });
}

export function buildToolExecArgs({ provider = "codex", ...options } = {}) {
  return normalizeToolProvider(provider) === "claude"
    ? buildClaudePrintArgs(options)
    : buildCodexExecArgs(options);
}

export function buildCodexExecArgs({
  sandbox = "workspace-write",
  cwd = ROOT,
  ephemeral = false,
  ignoreUserConfig = false,
  ignoreRules = false,
  model = "",
  reasoningEffort = "",
  schemaPath = "",
  outputPath = ""
} = {}) {
  const args = [
    "exec",
    "--skip-git-repo-check",
    "--color",
    "never",
    "--sandbox",
    sandbox,
    "-C",
    cwd
  ];

  if (ephemeral) args.push("--ephemeral");
  if (ignoreUserConfig) args.push("--ignore-user-config");
  if (ignoreRules) args.push("--ignore-rules");
  if (model) args.push("-m", model);
  const normalizedEffort = normalizeReasoningEffortForProvider("codex", model, reasoningEffort);
  if (normalizedEffort) args.push("-c", `model_reasoning_effort="${normalizedEffort}"`);
  if (schemaPath) args.push("--output-schema", schemaPath);
  if (outputPath) args.push("-o", outputPath);
  args.push("-");
  return args;
}

export function buildClaudePrintArgs({
  sandbox = "workspace-write",
  cwd = ROOT,
  model = "",
  reasoningEffort = "",
  schema = "",
  ephemeral = false
} = {}) {
  const args = [
    "--print",
    "--input-format",
    "text",
    "--output-format",
    "text",
    "--add-dir",
    cwd,
    "--permission-mode",
    claudePermissionMode(sandbox)
  ];

  if (model) args.push("--model", model);
  const normalizedEffort = normalizeReasoningEffortForProvider("claude", model, reasoningEffort);
  if (normalizedEffort) args.push("--effort", normalizedEffort);
  if (schema) args.push("--json-schema", schema);
  if (ephemeral) args.push("--no-session-persistence");
  if (sandbox === "read-only") args.push("--tools", "Read,Grep,Glob,LS");
  else args.push("--tools", "default");
  if (sandbox === "danger-full-access") args.push("--dangerously-skip-permissions");
  return args;
}

function claudePermissionMode(sandbox) {
  if (sandbox === "danger-full-access") return "bypassPermissions";
  if (sandbox === "read-only") return "plan";
  return "acceptEdits";
}

async function readJsonSchemaForCli(schemaPath) {
  const raw = await fs.readFile(schemaPath, "utf8");
  return JSON.stringify(JSON.parse(raw));
}

export async function runAgentPlanner({
  provider = "codex",
  goal,
  skills = [],
  workspace = ROOT,
  model = "",
  reasoningEffort = "medium",
  planningDir = path.join(ROOT, "runs", ".planning")
}) {
  await ensureDir(planningDir);
  const outputPath = path.join(planningDir, `${safeId("plan")}.json`);
  const skillHint = skills.slice(0, 40).map((skill) => `- ${skill.name}: ${skill.description || skill.path || ""}`).join("\n");
  const label = providerLabel(provider);
  const prompt = `You are designing a concrete ${label}-powered agent orchestration plan.

Return only JSON that matches the provided schema. Do not include markdown.

User goal:
${goal}

Available specialty skills for explicit node.skills:
${skillHint || "(No local skills discovered.)"}

Design principles:
- Use 3 to 7 nodes unless the task is tiny.
- Each node must have a crisp task, agent role, acceptance criteria, and explicit dependencies.
- Use mode "codex" for executable work, "human-review" for approval/checkpoints, "auto-review" for autonomous quality gates that can request bounded iteration, and "synthesis" for final consolidation.
- node.skills is only for mandatory specialty skills: distinctive expertise, book-derived frameworks, perspective skills, thinking methods, or domain playbooks.
- Do not put generic execution/retrieval/output skills in node.skills, including defuddle, mineru-pdf2md, browser, chrome, computer-use, documents, presentations, spreadsheets, imagegen, json-canvas, obsidian, github, codebase-explorer, implementation-worker, test-runner, or documentation-writer.
- Generic skills and tools remain available during execution; the executor can choose them autonomously when needed. If you include a skill in node.skills, the executor will be required to apply it.
- The plan must be editable by a human before execution.
- Lay out nodes left-to-right with x/y coordinates suitable for a visual canvas.
- Use sandbox "workspace-write" for any node that must create, update, save, or register files, code, reports, documents, tables, decks, artifacts, or final deliverable paths.
- Use sandbox "read-only" only for pure research/review/decision nodes that can complete entirely as a textual node result.
- Set node.networkPolicy to "confirm" by default. Use "full-access" only when the node clearly must browse, fetch URLs, download PDFs, install packages, or call networked CLIs to satisfy the task.
- Every node must include outputRequirement. For non-synthesis nodes, set outputRequirement to {"type":"markdown","custom":""}. For synthesis nodes, set outputRequirement.type to one of ppt, html, markdown, spreadsheet, image, pdf, docx, or other. Use outputRequirement.custom for any user-specific deliverable requirement; default to markdown when the user did not ask for a format.
- Every node must include reviewPolicy. For non-auto-review nodes, set reviewPolicy to {"maxIterations":3,"targetNodeIds":[],"criteria":"","continueOnLimit":true}. For auto-review nodes, set maxIterations to 3 by default, targetNodeIds to upstream executable nodes that should be rerun when issues are found, criteria to the concrete quality standard, and continueOnLimit to true.
- Leave node.model as an empty string unless the user explicitly requested a specific execution model; the runner supplies the default ${label} model.
- Set node.reasoningEffort to "low" for human checkpoints, "medium" for normal planning/review/synthesis, and "high" or "xhigh" only when a node truly needs deeper implementation reasoning.
- Include a final synthesis node that depends on the last executable nodes.
`;

  return runAgentExec({
    provider,
    prompt,
    cwd: workspace,
    sandbox: "read-only",
    model,
    schemaPath: PLAN_SCHEMA_PATH,
    outputPath,
    timeoutMs: 8 * 60 * 1000,
    resolveOnOutputFile: "json",
    reasoningEffort,
    ephemeral: true,
    ignoreUserConfig: true,
    ignoreRules: true
  });
}

export async function runCodexPlanner(options) {
  return runAgentPlanner({ ...options, provider: "codex" });
}
