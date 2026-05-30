import { promises as fs } from "node:fs";
import path from "node:path";
import { clampText, ensureDir, safeId } from "./utils.js";
import { normalizePlan } from "./planner.js";
import { normalizeRunOptions } from "./runner.js";

const TEMPLATE_ID_PATTERN = /^[a-z0-9-]+$/i;

const BUILT_IN_TEMPLATES = [
  {
    id: "builtin-industry-research",
    builtIn: true,
    name: "深度行业研究",
    description: "资料搜集、竞争格局、机会矩阵、自动评审与最终报告。",
    goalHint: "用于产业、供应链、市场机会和技术路线调研。",
    plan: baseTemplatePlan("深度行业研究", "完成行业研究并输出结构化结论。")
  },
  {
    id: "builtin-codebase-audit",
    builtIn: true,
    name: "代码库审计",
    description: "扫描架构、关键风险、测试缺口并形成整改建议。",
    goalHint: "用于大型代码库质量审计、迁移评估和架构复盘。",
    plan: baseTemplatePlan("代码库审计", "审计代码库并输出风险和改进项。")
  },
  {
    id: "builtin-pr-review",
    builtIn: true,
    name: "PR / 变更自动评审",
    description: "分析变更、验证风险、自动评审并汇总可执行建议。",
    goalHint: "用于 Pull Request、发布前变更和补丁审查。",
    plan: baseTemplatePlan("PR 变更自动评审", "评审变更并输出结论。")
  },
  {
    id: "builtin-sources-to-ppt",
    builtIn: true,
    name: "资料收集到 PPT",
    description: "搜集证据、提炼叙事、自动评审后生成 PPT 汇报材料。",
    goalHint: "用于把研究资料变成管理层或项目评审 PPT。",
    plan: {
      ...baseTemplatePlan("资料收集到 PPT", "把资料整理成 PPT 汇报材料。"),
      finalDeliverable: "PPT 汇报材料",
      nodes: baseTemplatePlan("资料收集到 PPT", "把资料整理成 PPT 汇报材料。").nodes.map((node) => (
        node.mode === "synthesis"
          ? { ...node, outputRequirement: { type: "ppt", custom: "输出中文 PPT 汇报材料，包含核心结论、证据、风险和行动建议。" } }
          : node
      ))
    }
  },
  {
    id: "builtin-fact-check",
    builtIn: true,
    name: "多来源事实核查",
    description: "多来源搜证、交叉验证、自动评审与可信度结论。",
    goalHint: "用于事实判断、证据链评估和争议问题核查。",
    plan: baseTemplatePlan("多来源事实核查", "核查事实并输出可信度判断。")
  }
];

export async function listTemplates(runtime) {
  const templates = [...BUILT_IN_TEMPLATES.map(publicTemplate)];
  const customDir = templatesDir(runtime);
  await ensureDir(customDir);
  const files = await fs.readdir(customDir).catch(() => []);
  for (const file of files.filter((item) => item.endsWith(".json"))) {
    try {
      const template = JSON.parse(await fs.readFile(path.join(customDir, file), "utf8"));
      templates.push(publicTemplate(template));
    } catch {
      // Ignore broken user templates, they can be overwritten from the UI.
    }
  }
  return templates.sort((a, b) => Number(b.builtIn) - Number(a.builtIn) || a.name.localeCompare(b.name, "zh-CN"));
}

export async function getTemplate(templateId, runtime) {
  const id = validateTemplateId(templateId);
  const builtIn = BUILT_IN_TEMPLATES.find((template) => template.id === id);
  if (builtIn) return publicTemplate(builtIn, { includePlan: true });
  const templatePath = path.join(templatesDir(runtime), `${id}.json`);
  const template = JSON.parse(await fs.readFile(templatePath, "utf8"));
  return publicTemplate(template, { includePlan: true });
}

export async function saveTemplate(input = {}, runtime) {
  const now = new Date().toISOString();
  const id = input.id && !String(input.id).startsWith("builtin-")
    ? validateTemplateId(input.id)
    : safeId("template");
  const plan = normalizePlan(input.plan || {}, input.goal || input.description || input.name || "模板工作流");
  const template = {
    id,
    builtIn: false,
    name: clampText(input.name || plan.name || "未命名模板", 80),
    description: clampText(input.description || plan.summary || "", 500),
    goalHint: clampText(input.goalHint || input.goal || "", 500),
    plan,
    runOptions: normalizeRunOptions(input.runOptions || {}, plan),
    createdAt: input.createdAt || now,
    updatedAt: now
  };
  const dir = templatesDir(runtime);
  await ensureDir(dir);
  await fs.writeFile(path.join(dir, `${id}.json`), `${JSON.stringify(template, null, 2)}\n`);
  return publicTemplate(template, { includePlan: true });
}

export async function deleteTemplate(templateId, runtime) {
  const id = validateTemplateId(templateId);
  if (id.startsWith("builtin-")) {
    const error = new Error("内置模板不能删除。");
    error.statusCode = 409;
    throw error;
  }
  await fs.unlink(path.join(templatesDir(runtime), `${id}.json`));
  return { ok: true };
}

function templatesDir(runtime) {
  return path.join(runtime.paths.storageRootPath, "templates");
}

function publicTemplate(template, { includePlan = false } = {}) {
  const result = {
    id: template.id,
    builtIn: Boolean(template.builtIn),
    name: template.name || "未命名模板",
    description: template.description || "",
    goalHint: template.goalHint || "",
    runOptions: normalizeRunOptions(template.runOptions || {}, template.plan || {}),
    createdAt: template.createdAt || "",
    updatedAt: template.updatedAt || ""
  };
  if (includePlan) result.plan = normalizePlan(template.plan || {}, template.goalHint || template.name || "模板工作流");
  return result;
}

function validateTemplateId(templateId) {
  const id = String(templateId || "").trim();
  if (!TEMPLATE_ID_PATTERN.test(id)) throw new Error("Invalid template id");
  return id;
}

function baseTemplatePlan(name, summary) {
  return {
    version: "1.0",
    name,
    summary,
    strategy: "先拆分任务、并行执行关键节点，再通过自动评审做受控迭代，最终汇总成用户指定产物。",
    maxConcurrency: 2,
    finalDeliverable: "结构化最终交付物",
    nodes: [
      {
        id: "scope",
        title: "范围澄清",
        agent: "Planning Analyst",
        task: "明确用户目标、边界、验收标准、需要收集或检查的关键对象。",
        skills: [],
        dependsOn: [],
        acceptance: ["范围和验收标准清晰。"],
        mode: "codex",
        requiresReview: false,
        model: "",
        reasoningEffort: "medium",
        sandbox: "workspace-write",
        networkPolicy: "confirm",
        outputRequirement: { type: "markdown", custom: "" },
        reviewPolicy: { maxIterations: 3, targetNodeIds: [], criteria: "", continueOnLimit: true },
        x: 80,
        y: 90
      },
      {
        id: "research",
        title: "关键工作执行",
        agent: "Execution Agent",
        task: "围绕范围澄清结果完成核心研究、审计、实现或资料整理工作，并输出可被评审的中间结果。",
        skills: [],
        dependsOn: ["scope"],
        acceptance: ["核心材料完整且可追溯。"],
        mode: "codex",
        requiresReview: false,
        model: "",
        reasoningEffort: "high",
        sandbox: "workspace-write",
        networkPolicy: "confirm",
        outputRequirement: { type: "markdown", custom: "" },
        reviewPolicy: { maxIterations: 3, targetNodeIds: [], criteria: "", continueOnLimit: true },
        x: 380,
        y: 90
      },
      {
        id: "quality-review",
        title: "自动评审",
        agent: "Quality Reviewer",
        task: "检查上游结果是否满足用户目标、证据完整性、逻辑一致性和产物要求，必要时发起受控返工。",
        skills: [],
        dependsOn: ["research"],
        acceptance: ["评审结论明确。"],
        mode: "auto-review",
        requiresReview: false,
        model: "",
        reasoningEffort: "medium",
        sandbox: "read-only",
        networkPolicy: "confirm",
        outputRequirement: { type: "markdown", custom: "" },
        reviewPolicy: {
          maxIterations: 3,
          targetNodeIds: ["research"],
          criteria: "结果必须满足用户目标，证据链清晰，风险与建议可执行。",
          continueOnLimit: true
        },
        x: 680,
        y: 90
      },
      {
        id: "final-synthesis",
        title: "最终汇总",
        agent: "Synthesis Writer",
        task: "整合所有节点输出、评审结论和产物路径，形成最终可交付结果。",
        skills: [],
        dependsOn: ["quality-review"],
        acceptance: ["最终输出满足用户指定格式和验收标准。"],
        mode: "synthesis",
        requiresReview: false,
        model: "",
        reasoningEffort: "high",
        sandbox: "workspace-write",
        networkPolicy: "confirm",
        outputRequirement: { type: "markdown", custom: "输出中文 Markdown 深度报告，包含结论、证据、风险和行动建议。" },
        reviewPolicy: { maxIterations: 3, targetNodeIds: [], criteria: "", continueOnLimit: true },
        x: 980,
        y: 90
      }
    ],
    edges: [
      { from: "scope", to: "research", label: "" },
      { from: "research", to: "quality-review", label: "" },
      { from: "quality-review", to: "final-synthesis", label: "" }
    ]
  };
}
