import { parseMaybeJson, safeId } from "./utils.js";
import { normalizeToolProvider, providerLabel, runAgentPlanner } from "./codexRunner.js";

export function normalizePlan(plan, goal = "") {
  const normalized = {
    version: "1.0",
    name: String(plan.name || "Agent 编排方案").slice(0, 80),
    summary: String(plan.summary || goal || "自动生成的任务编排。").slice(0, 600),
    strategy: String(plan.strategy || "").slice(0, 1200),
    nodes: Array.isArray(plan.nodes) ? plan.nodes : [],
    edges: Array.isArray(plan.edges) ? plan.edges : [],
    maxConcurrency: Number.isInteger(plan.maxConcurrency) ? Math.min(Math.max(plan.maxConcurrency, 1), 4) : 2,
    finalDeliverable: String(plan.finalDeliverable || "完成执行并输出汇总结果。").slice(0, 600)
  };

  const seen = new Set();
  normalized.nodes = normalized.nodes.slice(0, 12).map((node, index) => {
    let id = slug(node.id || node.title || `node-${index + 1}`);
    if (seen.has(id)) id = `${id}-${index + 1}`;
    seen.add(id);
    const acceptance = Array.isArray(node.acceptance) && node.acceptance.length
      ? node.acceptance.map(String).slice(0, 8)
      : ["结果可验证且有清晰输出。"];
    const mode = ["codex", "human-review", "synthesis", "auto-review"].includes(node.mode) ? node.mode : "codex";
    const normalizedNode = {
      id,
      title: String(node.title || `步骤 ${index + 1}`).slice(0, 80),
      agent: String(node.agent || "Agent Worker").slice(0, 80),
      task: String(node.task || "执行该步骤并报告结果。").slice(0, 1600),
      skills: Array.isArray(node.skills) ? node.skills.map(String).slice(0, 8) : [],
      dependsOn: Array.isArray(node.dependsOn) ? node.dependsOn.map(slug).filter(Boolean).slice(0, 8) : [],
      acceptance,
      mode,
      requiresReview: Boolean(node.requiresReview),
      model: String(node.model || "").slice(0, 80),
      reasoningEffort: ["low", "medium", "high", "xhigh", "max"].includes(node.reasoningEffort) ? node.reasoningEffort : "medium",
      networkPolicy: normalizeNetworkPolicy(node.networkPolicy),
      x: Number.isFinite(node.x) ? node.x : 80 + index * 280,
      y: Number.isFinite(node.y) ? node.y : 90 + (index % 2) * 180
    };
    if (mode === "synthesis") {
      normalizedNode.outputRequirement = normalizeOutputRequirement(node.outputRequirement);
    }
    if (mode === "auto-review") {
      normalizedNode.reviewPolicy = normalizeReviewPolicy(node.reviewPolicy);
      normalizedNode.requiresReview = false;
    }
    return {
      ...normalizedNode,
      sandbox: normalizeSandbox(node, normalizedNode)
    };
  });

  const ids = new Set(normalized.nodes.map((node) => node.id));
  for (const node of normalized.nodes) {
    node.dependsOn = node.dependsOn.filter((id) => ids.has(id) && id !== node.id);
  }

  normalizeAutoReviewTargets(normalized);

  const edgeKey = new Set();
  normalized.edges = [
    ...normalized.edges.map((edge) => ({ from: slug(edge.from), to: slug(edge.to), label: String(edge.label || "").slice(0, 80) })),
    ...normalized.nodes.flatMap((node) => node.dependsOn.map((from) => ({ from, to: node.id, label: "" })))
  ].filter((edge) => {
    if (!ids.has(edge.from) || !ids.has(edge.to) || edge.from === edge.to) return false;
    const key = `${edge.from}->${edge.to}`;
    if (edgeKey.has(key)) return false;
    edgeKey.add(key);
    return true;
  });

  if (!normalized.nodes.some((node) => node.mode === "synthesis")) {
    const leafIds = normalized.nodes
      .filter((node) => !normalized.edges.some((edge) => edge.from === node.id))
      .map((node) => node.id);
    const synthesisId = uniqueId("final-synthesis", ids);
    normalized.nodes.push({
      id: synthesisId,
      title: "结果汇总",
      agent: "Synthesis Lead",
      task: "汇总所有上游节点产物，输出面向用户的最终结果、验证状态和后续建议。",
      skills: [],
      dependsOn: leafIds,
      acceptance: ["覆盖所有已完成节点的关键结论。", "明确说明执行结果与剩余风险。"],
      mode: "synthesis",
      requiresReview: false,
      model: "",
      reasoningEffort: "medium",
      outputRequirement: defaultOutputRequirement(),
      sandbox: "workspace-write",
      networkPolicy: "confirm",
      x: 80 + normalized.nodes.length * 280,
      y: 120
    });
    ids.add(synthesisId);
    for (const from of leafIds) normalized.edges.push({ from, to: synthesisId, label: "" });
  }

  return normalized;
}

export async function createPlan({ goal, skills, model, reasoningEffort = "medium", networkPolicy = "confirm", provider = "codex", workspace, planningDir }) {
  const toolProvider = normalizeToolProvider(provider);
  const label = providerLabel(toolProvider);
  const plannerSkills = plannerAssignableSkills(skills);
  if (process.env.USE_MOCK_CODEX === "1") {
    const plan = finalizeGeneratedPlan(fallbackPlan(goal, plannerSkills, toolProvider), skills, reasoningEffort, networkPolicy);
    return { plan, source: "mock", warning: "USE_MOCK_CODEX=1" };
  }

  try {
    const result = await runAgentPlanner({ provider: toolProvider, goal, skills: plannerSkills, model, reasoningEffort, workspace, planningDir });
    const parsed = parseMaybeJson(result.finalMessage);
    const plan = finalizeGeneratedPlan(normalizePlan(parsed, goal), skills, reasoningEffort, networkPolicy);
    return { plan, source: toolProvider, raw: result.finalMessage };
  } catch (error) {
    const plan = finalizeGeneratedPlan(fallbackPlan(goal, plannerSkills, toolProvider), skills, reasoningEffort, networkPolicy);
    return {
      plan,
      source: "fallback",
      warning: `${label} planning failed: ${error.message}`,
      raw: error.result?.finalMessage || error.result?.stderr || ""
    };
  }
}

export function fallbackPlan(goal, skills = [], provider = "codex") {
  const label = providerLabel(provider);
  const specialtySkills = plannerAssignableSkills(skills);
  const matchedSpecialtySkills = pickSpecialtySkills(goal, specialtySkills, 2);
  return normalizePlan(
    {
      version: "1.0",
      name: `${label} 自动编排草案`,
      summary: `围绕“${goal}”生成的可执行草案；${label} 可在每个节点中继续细化。`,
      strategy: "先澄清与拆解，再并行执行核心工作，随后测试/审查，最后汇总结果。",
      maxConcurrency: 2,
      finalDeliverable: "一份包含执行结果、验证记录和可交付产物路径的最终汇总。",
      nodes: [
        {
          id: "intent-architecture",
          title: "需求澄清与架构拆解",
          agent: "Orchestration Architect",
          task: `分析用户目标，识别关键约束、可并行工作、风险点和最终交付物。用户目标：${goal}`,
          skills: matchedSpecialtySkills.slice(0, 1),
          dependsOn: [],
          acceptance: ["拆出可执行子任务。", "列出关键风险与确认点。"],
          mode: "codex",
          requiresReview: false,
          model: "",
          reasoningEffort: "medium",
          sandbox: "read-only",
          networkPolicy: "confirm",
          x: 80,
          y: 110
        },
        {
          id: "implementation-flow",
          title: "核心任务执行",
          agent: "Implementation Worker",
          task: "根据拆解结果完成主要实现或产物创建，保持输出可验证、可回滚、可说明。",
          skills: [],
          dependsOn: ["intent-architecture"],
          acceptance: ["完成核心产物。", "产物路径或结果可被后续节点读取。"],
          mode: "codex",
          requiresReview: false,
          model: "",
          reasoningEffort: "high",
          sandbox: "workspace-write",
          networkPolicy: "confirm",
          x: 360,
          y: 80
        },
        {
          id: "quality-gate",
          title: "质量验证",
          agent: "QA Reviewer",
          task: "运行可用验证，检查遗漏、错误、格式问题和执行风险，并提出必要修复。",
          skills: [],
          dependsOn: ["implementation-flow"],
          acceptance: ["给出验证命令和结果。", "阻断级问题已修复或明确说明。"],
          mode: "auto-review",
          requiresReview: false,
          model: "",
          reasoningEffort: "medium",
          reviewPolicy: {
            maxIterations: 3,
            targetNodeIds: ["implementation-flow"],
            criteria: "检查核心产物是否满足用户原始需求、是否有清晰输出、是否有验证记录；发现可修复问题时打回核心任务执行节点。",
            continueOnLimit: true
          },
          sandbox: "workspace-write",
          networkPolicy: "confirm",
          x: 640,
          y: 150
        },
        {
          id: "human-confirmation",
          title: "人工确认",
          agent: "Human Checkpoint",
          task: "请用户检查关键结果、风险说明和是否继续最终汇总。",
          skills: [],
          dependsOn: ["quality-gate"],
          acceptance: ["用户确认继续。"],
          mode: "human-review",
          requiresReview: true,
          model: "",
          reasoningEffort: "low",
          sandbox: "read-only",
          networkPolicy: "confirm",
          x: 920,
          y: 85
        },
        {
          id: "final-synthesis",
          title: "最终汇总",
          agent: "Synthesis Lead",
          task: "整合全部节点输出，形成最终可交付结果、验证记录和简洁说明。",
          skills: matchedSpecialtySkills.slice(1, 2),
          dependsOn: ["human-confirmation"],
          acceptance: ["输出完整结果摘要。", "包含验证状态和交付路径。"],
          mode: "synthesis",
          requiresReview: false,
          model: "",
          reasoningEffort: "medium",
          outputRequirement: defaultOutputRequirement(),
          sandbox: "workspace-write",
          networkPolicy: "confirm",
          x: 1200,
          y: 120
        }
      ],
      edges: [
        { from: "intent-architecture", to: "implementation-flow" },
        { from: "implementation-flow", to: "quality-gate" },
        { from: "quality-gate", to: "human-confirmation" },
        { from: "human-confirmation", to: "final-synthesis" }
      ]
    },
    goal
  );
}

export function filterUnavailableSkills(plan, skills = []) {
  const available = new Set(skills.map((skill) => skill.name));
  if (!available.size) return plan;
  return {
    ...plan,
    nodes: plan.nodes.map((node) => ({
      ...node,
      skills: (node.skills || []).filter((skill) => available.has(skill))
    }))
  };
}

export function filterPlannerAssignableSkills(plan, skills = []) {
  const assignable = new Set(plannerAssignableSkills(skills).map((skill) => skill.name));
  return {
    ...plan,
    nodes: plan.nodes.map((node) => ({
      ...node,
      skills: (node.skills || []).filter((skill) => assignable.has(skill))
    }))
  };
}

export function plannerAssignableSkills(skills = []) {
  return skills.filter((skill) => isPlannerAssignableSkill(skill));
}

export function isPlannerAssignableSkill(skill) {
  const name = String(typeof skill === "string" ? skill : skill?.name || "");
  const description = String(typeof skill === "string" ? "" : skill?.description || "");
  const lowerName = name.toLowerCase();
  const text = `${name} ${description}`;

  if (!name || GENERAL_PURPOSE_SKILL_PATTERNS.some((pattern) => pattern.test(lowerName))) return false;
  return SPECIALTY_SKILL_PATTERN.test(text);
}

export function applyReasoningPreference(plan, reasoningEffort = "medium") {
  const effort = ["low", "medium", "high", "xhigh", "max"].includes(reasoningEffort) ? reasoningEffort : "medium";
  return {
    ...plan,
    nodes: plan.nodes.map((node) => ({
      ...node,
      reasoningEffort: node.mode === "human-review" || node.requiresReview ? "low" : effort
    }))
  };
}

export function applyNetworkPreference(plan, networkPolicy = "confirm") {
  const policy = normalizeNetworkPolicy(networkPolicy);
  return {
    ...plan,
    nodes: plan.nodes.map((node) => ({
      ...node,
      networkPolicy: node.mode === "human-review" || node.requiresReview ? "confirm" : policy
    }))
  };
}

function finalizeGeneratedPlan(plan, skills, reasoningEffort, networkPolicy) {
  return applyNetworkPreference(
    applyReasoningPreference(
      filterPlannerAssignableSkills(filterUnavailableSkills(plan, skills), skills),
      reasoningEffort
    ),
    networkPolicy
  );
}

function slug(value) {
  const text = String(value || "").toLowerCase().trim();
  const ascii = text
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .replace(/_/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return ascii || safeId("node");
}

function normalizeSandbox(rawNode, normalizedNode) {
  const requested = ["read-only", "workspace-write"].includes(rawNode.sandbox) ? rawNode.sandbox : "";
  if (normalizedNode.mode === "human-review" || normalizedNode.requiresReview) return "read-only";
  if (normalizedNode.mode === "auto-review") return "read-only";
  if (needsWritableSandbox(normalizedNode)) return "workspace-write";
  return requested || "workspace-write";
}

function normalizeNetworkPolicy(value) {
  return ["confirm", "full-access"].includes(value) ? value : "confirm";
}

export function defaultOutputRequirement() {
  return { type: "markdown", custom: "" };
}

export function normalizeOutputRequirement(value = {}) {
  const aliases = {
    ppt: "ppt",
    powerpoint: "ppt",
    slides: "ppt",
    deck: "ppt",
    html: "html",
    webpage: "html",
    web: "html",
    md: "markdown",
    markdown: "markdown",
    document: "markdown",
    doc: "markdown",
    table: "spreadsheet",
    spreadsheet: "spreadsheet",
    xlsx: "spreadsheet",
    csv: "spreadsheet",
    image: "image",
    picture: "image",
    png: "image",
    pdf: "pdf",
    word: "docx",
    docx: "docx",
    other: "other"
  };
  const rawType = typeof value === "string" ? value : value?.type;
  const type = aliases[String(rawType || "").trim().toLowerCase()] || "markdown";
  return {
    type,
    custom: String(typeof value === "object" && value ? value.custom || "" : "").slice(0, 600)
  };
}

export function defaultReviewPolicy() {
  return {
    maxIterations: 3,
    targetNodeIds: [],
    criteria: "检查上游结果是否满足用户原始需求、验收标准、产物完整性和可验证性；发现可修复问题时发起一次受控迭代。",
    continueOnLimit: true
  };
}

export function normalizeReviewPolicy(value = {}) {
  const defaults = defaultReviewPolicy();
  const requestedMax = Number.parseInt(value?.maxIterations, 10);
  const maxIterations = Number.isFinite(requestedMax) ? Math.min(Math.max(requestedMax, 1), 10) : defaults.maxIterations;
  return {
    maxIterations,
    targetNodeIds: Array.isArray(value?.targetNodeIds)
      ? value.targetNodeIds.map(slug).filter(Boolean).slice(0, 6)
      : [],
    criteria: String(value?.criteria || defaults.criteria).slice(0, 1000),
    continueOnLimit: value?.continueOnLimit === undefined ? true : Boolean(value.continueOnLimit)
  };
}

function normalizeAutoReviewTargets(plan) {
  for (const node of plan.nodes) {
    if (node.mode !== "auto-review") continue;
    const policy = normalizeReviewPolicy(node.reviewPolicy);
    const ancestors = collectAncestorIds(plan, node.id);
    let targets = policy.targetNodeIds.filter((id) => ancestors.has(id));
    if (!targets.length) {
      const directTarget = [...(node.dependsOn || [])]
        .reverse()
        .find((id) => {
          const candidate = plan.nodes.find((item) => item.id === id);
          return candidate && !["human-review", "auto-review"].includes(candidate.mode);
        });
      targets = directTarget ? [directTarget] : (node.dependsOn || []).filter((id) => ancestors.has(id)).slice(-1);
    }
    node.reviewPolicy = {
      ...policy,
      targetNodeIds: targets.slice(0, 6)
    };
  }
}

function collectAncestorIds(plan, nodeId) {
  const byId = new Map(plan.nodes.map((node) => [node.id, node]));
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

function needsWritableSandbox(node) {
  if (node.mode === "synthesis" && node.outputRequirement?.type && node.outputRequirement.type !== "markdown") return true;
  const text = [
    node.title,
    node.agent,
    node.task,
    ...(node.acceptance || []),
    ...(node.skills || [])
  ].join(" ");
  return /产物|交付|文件|文档|报告|表格|幻灯|演示|落盘|写入|保存|路径|实现|创建|生成|修改|更新|代码|deliverable|artifact|file|document|report|spreadsheet|presentation|deck|slide|write|save|create|generate|implement|modify|update|code/i.test(text);
}

function pickSpecialtySkills(text, skills, limit = 2) {
  const query = String(text || "").toLowerCase();
  return skills
    .map((skill) => ({ skill, score: specialtyScore(query, skill) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.skill.name.localeCompare(b.skill.name))
    .slice(0, limit)
    .map((item) => item.skill.name);
}

function specialtyScore(query, skill) {
  const haystack = `${skill.name} ${skill.description || ""}`.toLowerCase();
  let score = 0;
  if (/大疆|dji/i.test(query) && /大疆|dji|wang|汪滔/i.test(haystack)) score += 6;
  if (/数字化|转型|企业/.test(query) && /数字化|转型|huawei|华为/i.test(haystack)) score += 4;
  if (/内容|视频|增长|twitter|x\b/.test(query) && /content|twitter|x\/twitter|mentor|内容/i.test(haystack)) score += 3;
  for (const token of query.split(/[^\p{L}\p{N}]+/u).filter((part) => part.length >= 3)) {
    if (haystack.includes(token)) score += 1;
  }
  return score;
}

function uniqueId(base, ids) {
  let id = base;
  let index = 2;
  while (ids.has(id)) {
    id = `${base}-${index}`;
    index += 1;
  }
  return id;
}

const GENERAL_PURPOSE_SKILL_PATTERNS = [
  /^(browser|chrome|computer-use|defuddle|mineru-pdf2md|documents|presentations|spreadsheets)$/i,
  /^(imagegen|openai-docs|plugin-creator|skill-creator|skill-installer|find-skills)$/i,
  /^(json-canvas|obsidian-bases|obsidian-cli|obsidian-markdown|book2skill|huashu-nuwa)$/i,
  /^(web-artifacts-builder|docx|xlsx|pptx|pdf|theme-factory|canvas-design|slack-gif-creator)$/i,
  /^(claude-api|doc-coauthoring|skill-creator|mcp-builder|webapp-testing|frontend-design)$/i,
  /^(github|github:.+|gh-.+)$/i,
  /^(codebase-explorer|implementation-worker|test-runner|documentation-writer)$/i
];

const SPECIALTY_SKILL_PATTERN = /perspective|mentor|framework|model|playbook|operating system|principle|method|经验|书籍|著作|思维|心智|框架|模型|方法论|原则|启发式|视角|导师|操作系统|华为|人物|案例|决策/i;
