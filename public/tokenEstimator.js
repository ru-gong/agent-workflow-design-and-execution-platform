const NODE_PROMPT_BASE_TOKENS = 1180;
const TOOL_CALL_OVERHEAD_TOKENS = 260;
const UPSTREAM_CONTEXT_CAP_TOKENS = 1350;
const DEFAULT_LOG_TOKENS_PER_NODE = 130;

const MODE_OUTPUT_BASE_TOKENS = {
  codex: 1050,
  agent: 1050,
  "human-review": 90,
  "auto-review": 620,
  synthesis: 1650
};

const EFFORT_OUTPUT_MULTIPLIER = {
  low: 0.78,
  medium: 1,
  high: 1.28,
  xhigh: 1.55,
  max: 1.7
};

const OUTPUT_TYPE_MULTIPLIER = {
  markdown: 1,
  ppt: 1.95,
  html: 1.7,
  spreadsheet: 1.45,
  image: 1.25,
  pdf: 1.65,
  docx: 1.65,
  other: 1.25
};

export function estimateTokens(text) {
  const normalized = String(text || "").trim();
  if (!normalized) return 0;

  const cjk = (normalized.match(/[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]/g) || []).length;
  const latin = (normalized.match(/[A-Za-z]/g) || []).length;
  const digits = (normalized.match(/[0-9]/g) || []).length;
  const whitespace = (normalized.match(/\s/g) || []).length;
  const punctuation = Math.max(0, normalized.length - cjk - latin - digits - whitespace);

  return Math.max(1, Math.ceil(
    cjk * 1.05
    + latin / 3.6
    + digits / 2
    + punctuation / 2.4
    + Math.min(whitespace / 12, 80)
  ));
}

export function estimatePlanTokenUsage(plan = {}, { goal = "", runOptions = {} } = {}) {
  const nodes = Array.isArray(plan?.nodes) ? plan.nodes : [];
  const nodeOutputEstimates = new Map();
  const nodeEstimates = [];
  let promptTokens = 0;
  let outputTokens = 0;
  let logTokens = 0;
  let overheadTokens = estimateTokens(JSON.stringify({
    version: plan?.version,
    name: plan?.name,
    summary: plan?.summary,
    strategy: plan?.strategy,
    finalDeliverable: plan?.finalDeliverable,
    maxConcurrency: plan?.maxConcurrency
  })) + 420;

  for (const node of nodes) {
    const output = estimateNodeOutputTokens(node);
    nodeOutputEstimates.set(node.id, output);
  }

  for (const node of nodes) {
    const upstreamTokens = estimateUpstreamContextTokens(node, nodeOutputEstimates);
    const prompt = estimateNodePromptTokens(plan, node, { goal, upstreamTokens, runOptions });
    const output = nodeOutputEstimates.get(node.id) || estimateNodeOutputTokens(node);
    const logs = estimateNodeLogTokens(node);
    const overhead = node.mode === "human-review" || node.requiresReview ? 45 : TOOL_CALL_OVERHEAD_TOKENS;
    const total = prompt + output + logs + overhead;

    promptTokens += prompt;
    outputTokens += output;
    logTokens += logs;
    overheadTokens += overhead;
    nodeEstimates.push({
      id: node.id,
      title: node.title || node.id,
      promptTokens: prompt,
      outputTokens: output,
      logTokens: logs,
      overheadTokens: overhead,
      estimatedTokens: total
    });
  }

  const estimatedTokens = promptTokens + outputTokens + logTokens + overheadTokens;
  return {
    estimatedTokens,
    lowerBoundTokens: Math.max(1, Math.round(estimatedTokens * 0.72)),
    upperBoundTokens: Math.max(1, Math.round(estimatedTokens * 1.38)),
    promptTokens,
    outputTokens,
    logTokens,
    overheadTokens,
    nodes: nodeEstimates
  };
}

export function formatTokenEstimate(estimate) {
  const usage = typeof estimate === "number" ? { lowerBoundTokens: estimate, upperBoundTokens: estimate } : estimate;
  if (!usage) return "≈ 0";
  return `≈ ${formatCompactTokens(usage.lowerBoundTokens)}-${formatCompactTokens(usage.upperBoundTokens)}`;
}

export function formatCompactTokens(value) {
  const tokens = Math.max(0, Number(value || 0));
  if (tokens >= 1_000_000) return `${trimNumber(tokens / 1_000_000)}M`;
  if (tokens >= 1000) return `${trimNumber(tokens / 1000)}k`;
  return String(Math.round(tokens));
}

function estimateNodePromptTokens(plan, node, { goal = "", upstreamTokens = 0, runOptions = {} } = {}) {
  const nodeConfig = [
    plan?.name,
    plan?.summary,
    plan?.strategy,
    goal,
    node.id,
    node.title,
    node.agent,
    node.mode,
    node.task,
    (node.skills || []).join(", "),
    (node.acceptance || []).join("\n"),
    JSON.stringify(node.outputRequirement || {}),
    JSON.stringify(node.reviewPolicy || {}),
    `sandbox:${node.sandbox || "workspace-write"}`,
    `network:${runOptions.networkPolicy === "plan" ? (node.networkPolicy || "confirm") : (runOptions.networkPolicy || node.networkPolicy || "confirm")}`,
    `reasoning:${node.reasoningEffort || "default"}`
  ].join("\n");

  const specialtyRules = (node.skills || []).length ? 180 : 120;
  const modeRules = node.mode === "auto-review" ? 520 : node.mode === "synthesis" ? 380 : 220;
  const artifactRules = (node.sandbox || "workspace-write") === "read-only" ? 180 : 230;
  const networkRules = (node.networkPolicy || "confirm") === "full-access" || runOptions.networkPolicy === "full-access" ? 210 : 260;

  return Math.ceil(
    NODE_PROMPT_BASE_TOKENS
    + estimateTokens(nodeConfig)
    + upstreamTokens
    + specialtyRules
    + modeRules
    + artifactRules
    + networkRules
  );
}

function estimateUpstreamContextTokens(node, nodeOutputEstimates) {
  return (node.dependsOn || []).reduce((sum, depId) => {
    const projected = nodeOutputEstimates.get(depId) || 0;
    return sum + Math.min(projected + 32, UPSTREAM_CONTEXT_CAP_TOKENS);
  }, 0);
}

function estimateNodeOutputTokens(node) {
  const mode = node.mode || "codex";
  const base = MODE_OUTPUT_BASE_TOKENS[mode] || MODE_OUTPUT_BASE_TOKENS.codex;
  const effort = EFFORT_OUTPUT_MULTIPLIER[String(node.reasoningEffort || "medium").toLowerCase()] || 1;
  const taskWeight = estimateTokens([
    node.title,
    node.agent,
    node.task,
    (node.acceptance || []).join("\n"),
    (node.skills || []).join(", ")
  ].join("\n"));
  const outputType = node.mode === "synthesis" ? String(node.outputRequirement?.type || "markdown") : "markdown";
  const outputTypeMultiplier = OUTPUT_TYPE_MULTIPLIER[outputType] || OUTPUT_TYPE_MULTIPLIER.markdown;
  const reviewMultiplier = node.mode === "auto-review"
    ? 1 + Math.min(Number(node.reviewPolicy?.maxIterations || 3), 10) * 0.08
    : 1;

  return Math.ceil((base + taskWeight * 1.7) * effort * outputTypeMultiplier * reviewMultiplier);
}

function estimateNodeLogTokens(node) {
  if (node.mode === "human-review" || node.requiresReview) return 35;
  return DEFAULT_LOG_TOKENS_PER_NODE + (node.mode === "auto-review" ? 50 : 0);
}

function trimNumber(value) {
  return Number(value.toFixed(value >= 10 ? 0 : 1)).toString();
}
