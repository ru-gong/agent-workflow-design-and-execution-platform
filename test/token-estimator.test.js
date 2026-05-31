import test from "node:test";
import assert from "node:assert/strict";
import { estimatePlanTokenUsage, estimateTokens } from "../public/tokenEstimator.js";

function samplePlan({ outputType = "markdown" } = {}) {
  return {
    version: "1.0",
    name: "行业机会研究",
    summary: "对铝和钛粉末冶金应用进行深度调研并评估消费级无人机机会。",
    strategy: "先范围澄清，再并行研究材料与应用，自动评审后输出最终建议。",
    maxConcurrency: 2,
    nodes: [
      {
        id: "scope",
        title: "范围澄清",
        agent: "Planning Analyst",
        task: "明确研究边界、目标行业、证据标准和最终产物要求。",
        skills: [],
        dependsOn: [],
        acceptance: ["边界清晰", "证据标准明确"],
        mode: "codex",
        sandbox: "workspace-write",
        networkPolicy: "confirm",
        reasoningEffort: "medium",
        outputRequirement: { type: "markdown", custom: "" }
      },
      {
        id: "research",
        title: "产业研究",
        agent: "Research Agent",
        task: "调研铝粉末冶金、钛粉末冶金在工业、航空、消费电子和无人机相关领域的成熟应用。",
        skills: [],
        dependsOn: ["scope"],
        acceptance: ["覆盖关键应用", "列出证据与不确定性"],
        mode: "codex",
        sandbox: "workspace-write",
        networkPolicy: "full-access",
        reasoningEffort: "high",
        outputRequirement: { type: "markdown", custom: "" }
      },
      {
        id: "quality-review",
        title: "自动评审",
        agent: "Quality Reviewer",
        task: "检查证据链、逻辑、应用判断和产物完整性，必要时要求研究节点返工。",
        skills: [],
        dependsOn: ["research"],
        acceptance: ["输出明确判定"],
        mode: "auto-review",
        sandbox: "read-only",
        networkPolicy: "confirm",
        reasoningEffort: "medium",
        reviewPolicy: {
          maxIterations: 3,
          targetNodeIds: ["research"],
          criteria: "证据必须可信，机会判断要能落到业务场景。",
          continueOnLimit: true
        },
        outputRequirement: { type: "markdown", custom: "" }
      },
      {
        id: "final",
        title: "最终汇总",
        agent: "Synthesis Writer",
        task: "整合所有节点结果，输出面向研发、战略和供应链团队的评估材料。",
        skills: [],
        dependsOn: ["quality-review"],
        acceptance: ["结论清晰", "建议可执行"],
        mode: "synthesis",
        sandbox: "workspace-write",
        networkPolicy: "confirm",
        reasoningEffort: "high",
        outputRequirement: { type: outputType, custom: "包含技术路线、应用潜力、风险和下一步建议。" }
      }
    ],
    edges: []
  };
}

test("estimateTokens uses a conservative CJK-aware tokenizer", () => {
  assert.ok(estimateTokens("铝和钛粉末冶金在消费级无人机中的应用潜力") >= 20);
  assert.ok(estimateTokens("Summarize the current codebase architecture and risk profile.") >= 12);
});

test("estimatePlanTokenUsage includes prompt scaffolding, upstream context, output, logs, and overhead", () => {
  const plan = samplePlan();
  const naiveJsonEstimate = Math.ceil(JSON.stringify(plan).length / 4);
  const estimate = estimatePlanTokenUsage(plan, {
    goal: "请做一份深度行业研究。",
    runOptions: { networkPolicy: "plan" }
  });

  assert.equal(estimate.nodes.length, 4);
  assert.ok(estimate.promptTokens > naiveJsonEstimate, "prompt estimate should exceed raw plan JSON size");
  assert.ok(estimate.estimatedTokens > naiveJsonEstimate * 5, "total estimate should be meaningfully higher than JSON-only estimate");
  assert.ok(estimate.upperBoundTokens > estimate.lowerBoundTokens);
  assert.ok(estimate.nodes.find((node) => node.id === "final").estimatedTokens > 0);
});

test("synthesis output format affects token budget estimate", () => {
  const markdown = estimatePlanTokenUsage(samplePlan({ outputType: "markdown" }));
  const ppt = estimatePlanTokenUsage(samplePlan({ outputType: "ppt" }));

  assert.ok(ppt.estimatedTokens > markdown.estimatedTokens);
  assert.ok(ppt.nodes.find((node) => node.id === "final").outputTokens > markdown.nodes.find((node) => node.id === "final").outputTokens);
});
