import test from "node:test";
import assert from "node:assert/strict";
import {
  applyNetworkPreference,
  applyReasoningPreference,
  createPlan,
  fallbackPlan,
  filterPlannerAssignableSkills,
  filterUnavailableSkills,
  isPlannerAssignableSkill,
  normalizeOutputRequirement,
  normalizePlan,
  normalizeReviewPolicy,
  plannerAssignableSkills
} from "../server/planner.js";

test("normalizePlan deduplicates dependency edges and appends synthesis when missing", () => {
  const plan = normalizePlan(
    {
      name: "Demo",
      summary: "Demo summary",
      nodes: [
        {
          id: "Research",
          title: "Research",
          agent: "Explorer",
          task: "Inspect the codebase and summarize facts.",
          skills: ["codebase-explorer"],
          dependsOn: [],
          acceptance: ["Facts are clear."],
          mode: "codex",
          x: 20,
          y: 30
        },
        {
          id: "Build",
          title: "Build",
          agent: "Worker",
          task: "Implement the requested behavior.",
          skills: [],
          dependsOn: ["research", "research"],
          acceptance: ["Implementation exists."],
          mode: "codex",
          x: 300,
          y: 30
        }
      ],
      edges: [{ from: "research", to: "build" }, { from: "research", to: "build" }]
    },
    "demo goal"
  );

  assert.equal(plan.version, "1.0");
  assert.equal(plan.nodes.some((node) => node.mode === "synthesis"), true);
  assert.equal(plan.edges.filter((edge) => edge.from === "research" && edge.to === "build").length, 1);
});

test("fallbackPlan creates an executable editable DAG", () => {
  const plan = fallbackPlan("ship a feature", [
    { name: "codebase-explorer" },
    { name: "test-runner" },
    { name: "documents" }
  ]);

  assert.equal(plan.nodes.length >= 4, true);
  assert.equal(plan.nodes.at(-1).mode, "synthesis");
  assert.equal(plan.edges.length, plan.nodes.length - 1);
  assert.equal(plan.nodes.every((node) => Array.isArray(node.acceptance) && node.acceptance.length > 0), true);
});

test("createPlan requires real planner success by default", async () => {
  const previousMock = process.env.USE_MOCK_CODEX;
  const previousFallback = process.env.ALLOW_PLANNER_FALLBACK;
  delete process.env.USE_MOCK_CODEX;
  delete process.env.ALLOW_PLANNER_FALLBACK;
  try {
    await assert.rejects(
      createPlan({
        goal: "ship a feature",
        skills: [],
        agentPlanner: async () => {
          throw new Error("auth failed");
        }
      }),
      /Codex planning failed: auth failed/
    );
  } finally {
    if (previousMock === undefined) delete process.env.USE_MOCK_CODEX;
    else process.env.USE_MOCK_CODEX = previousMock;
    if (previousFallback === undefined) delete process.env.ALLOW_PLANNER_FALLBACK;
    else process.env.ALLOW_PLANNER_FALLBACK = previousFallback;
  }
});

test("createPlan only generates local fallback when explicitly allowed", async () => {
  const previousMock = process.env.USE_MOCK_CODEX;
  const previousFallback = process.env.ALLOW_PLANNER_FALLBACK;
  delete process.env.USE_MOCK_CODEX;
  process.env.ALLOW_PLANNER_FALLBACK = "1";
  try {
    const result = await createPlan({
      goal: "ship a feature",
      skills: [],
      agentPlanner: async () => {
        throw new Error("temporary planner outage");
      }
    });
    assert.equal(result.source, "fallback");
    assert.match(result.warning, /ALLOW_PLANNER_FALLBACK=1/);
    assert.equal(result.plan.nodes.at(-1).mode, "synthesis");
  } finally {
    if (previousMock === undefined) delete process.env.USE_MOCK_CODEX;
    else process.env.USE_MOCK_CODEX = previousMock;
    if (previousFallback === undefined) delete process.env.ALLOW_PLANNER_FALLBACK;
    else process.env.ALLOW_PLANNER_FALLBACK = previousFallback;
  }
});

test("normalizePlan keeps output requirements only for synthesis nodes", () => {
  const plan = normalizePlan({
    name: "Output Flow",
    nodes: [
      {
        id: "research",
        title: "Research",
        agent: "Researcher",
        task: "Gather facts.",
        skills: [],
        dependsOn: [],
        acceptance: ["Facts are clear."],
        mode: "codex",
        outputRequirement: { type: "ppt", custom: "Do not keep this on a work node." }
      },
      {
        id: "final",
        title: "Final",
        agent: "Synthesis Lead",
        task: "Create the final deliverable.",
        skills: [],
        dependsOn: ["research"],
        acceptance: ["Deck is ready."],
        mode: "synthesis",
        outputRequirement: { type: "ppt", custom: "做成投资评审风格，10 页以内。" }
      }
    ],
    edges: []
  });

  assert.equal(plan.nodes.find((node) => node.id === "research").outputRequirement, undefined);
  assert.deepEqual(plan.nodes.find((node) => node.id === "final").outputRequirement, {
    type: "ppt",
    custom: "做成投资评审风格，10 页以内。"
  });
});

test("normalizeOutputRequirement aliases formats and defaults safely", () => {
  assert.deepEqual(normalizeOutputRequirement("HTML"), { type: "html", custom: "" });
  assert.deepEqual(normalizeOutputRequirement({ type: "xlsx", custom: "按业务线拆表" }), {
    type: "spreadsheet",
    custom: "按业务线拆表"
  });
  assert.deepEqual(normalizeOutputRequirement({ type: "invalid" }), { type: "markdown", custom: "" });
});

test("normalizePlan configures auto-review nodes with bounded upstream targets", () => {
  const plan = normalizePlan({
    name: "Auto Review Flow",
    nodes: [
      {
        id: "draft",
        title: "Draft",
        agent: "Worker",
        task: "Create a draft result.",
        mode: "codex"
      },
      {
        id: "review",
        title: "Auto Review",
        agent: "Reviewer",
        task: "Review the draft and request iteration when needed.",
        mode: "auto-review",
        requiresReview: true,
        dependsOn: ["draft"],
        reviewPolicy: {
          maxIterations: 99,
          targetNodeIds: ["missing", "draft"],
          criteria: "Check completeness.",
          continueOnLimit: false
        }
      }
    ],
    edges: []
  });
  const review = plan.nodes.find((node) => node.id === "review");

  assert.equal(review.mode, "auto-review");
  assert.equal(review.requiresReview, false);
  assert.equal(review.sandbox, "read-only");
  assert.deepEqual(review.reviewPolicy, {
    maxIterations: 10,
    targetNodeIds: ["draft"],
    criteria: "Check completeness.",
    continueOnLimit: false
  });
});

test("normalizeReviewPolicy applies safe defaults and bounds", () => {
  assert.deepEqual(normalizeReviewPolicy({ maxIterations: 0, targetNodeIds: ["A Node"], criteria: "", continueOnLimit: undefined }), {
    maxIterations: 1,
    targetNodeIds: ["a-node"],
    criteria: "检查上游结果是否满足用户原始需求、验收标准、产物完整性和可验证性；发现可修复问题时发起一次受控迭代。",
    continueOnLimit: true
  });
});

test("fallbackPlan defaults final synthesis output to markdown", () => {
  const plan = fallbackPlan("ship a feature");
  assert.deepEqual(plan.nodes.find((node) => node.mode === "synthesis").outputRequirement, {
    type: "markdown",
    custom: ""
  });
});

test("filterUnavailableSkills removes hallucinated or virtual skills", () => {
  const plan = filterUnavailableSkills(
    normalizePlan({
      name: "Skill Filter",
      nodes: [
        {
          id: "writer",
          title: "Writer",
          agent: "Writer",
          task: "Write docs.",
          skills: ["documents", "documentation-writer"],
          mode: "codex"
        }
      ],
      edges: []
    }),
    [{ name: "documents" }]
  );

  assert.deepEqual(plan.nodes.find((node) => node.id === "writer").skills, ["documents"]);
});

test("plannerAssignableSkills only keeps distinctive specialty skills for auto planning", () => {
  const skills = [
    { name: "defuddle", description: "Extract clean markdown content from web pages." },
    { name: "mineru-pdf2md", description: "Use MinerU to convert scanned/digital PDFs to Markdown." },
    { name: "documents", description: "Create, edit, redline, and comment on document artifacts." },
    { name: "frank-wang-tao-perspective", description: "汪滔（Frank Wang / DJI 大疆创始人）的思维框架与表达方式。" },
    { name: "f03-digital-transformation-planning-3-phases-12-steps", description: "华为的三阶十二步法，指导企业进行数字化转型规划。" }
  ];

  assert.deepEqual(
    plannerAssignableSkills(skills).map((skill) => skill.name),
    ["frank-wang-tao-perspective", "f03-digital-transformation-planning-3-phases-12-steps"]
  );
  assert.equal(isPlannerAssignableSkill({ name: "browser", description: "Browser automation." }), false);
  assert.equal(isPlannerAssignableSkill({ name: "web-artifacts-builder", description: "Build complex HTML artifacts." }), false);
  assert.equal(isPlannerAssignableSkill({ name: "taleb-perspective", description: "塔勒布的思维框架。" }), true);
});

test("filterPlannerAssignableSkills removes generic configured skills from generated plans", () => {
  const plan = filterPlannerAssignableSkills(
    normalizePlan({
      name: "Skill Policy",
      nodes: [
        {
          id: "research",
          title: "Research",
          agent: "Researcher",
          task: "Research PM reports.",
          skills: ["defuddle", "mineru-pdf2md", "frank-wang-tao-perspective", "missing-skill"],
          mode: "codex"
        }
      ],
      edges: []
    }),
    [
      { name: "defuddle", description: "Extract clean markdown content from web pages." },
      { name: "mineru-pdf2md", description: "Use MinerU to convert scanned/digital PDFs to Markdown." },
      { name: "frank-wang-tao-perspective", description: "汪滔（Frank Wang / DJI 大疆创始人）的思维框架与表达方式。" }
    ]
  );

  assert.deepEqual(plan.nodes.find((node) => node.id === "research").skills, ["frank-wang-tao-perspective"]);
});

test("fallbackPlan does not preconfigure generic execution skills", () => {
  const plan = fallbackPlan("研究大疆产品策略", [
    { name: "defuddle", description: "Extract clean markdown content from web pages." },
    { name: "mineru-pdf2md", description: "Use MinerU to convert scanned/digital PDFs to Markdown." },
    { name: "frank-wang-tao-perspective", description: "汪滔（Frank Wang / DJI 大疆创始人）的思维框架与表达方式。" }
  ]);
  const configured = plan.nodes.flatMap((node) => node.skills || []);

  assert.equal(configured.includes("defuddle"), false);
  assert.equal(configured.includes("mineru-pdf2md"), false);
  assert.equal(configured.includes("frank-wang-tao-perspective"), true);
});

test("normalizePlan assigns writable sandbox to artifact-producing nodes", () => {
  const plan = normalizePlan({
    name: "Artifact Flow",
    nodes: [
      {
        id: "research",
        title: "只读调研",
        agent: "Researcher",
        task: "分析资料并给出文字结论。",
        mode: "codex",
        sandbox: "read-only"
      },
      {
        id: "report",
        title: "报告产物",
        agent: "Writer",
        task: "生成一份报告文件并保存产物路径。",
        mode: "codex",
        sandbox: "read-only",
        dependsOn: ["research"]
      },
      {
        id: "approval",
        title: "人工确认",
        agent: "Human",
        task: "确认报告是否通过。",
        mode: "human-review",
        sandbox: "workspace-write",
        dependsOn: ["report"]
      }
    ],
    edges: []
  });

  assert.equal(plan.nodes.find((node) => node.id === "research").sandbox, "read-only");
  assert.equal(plan.nodes.find((node) => node.id === "report").sandbox, "workspace-write");
  assert.equal(plan.nodes.find((node) => node.id === "approval").sandbox, "read-only");
});

test("normalizePlan keeps explicit node network policy and defaults to confirm", () => {
  const plan = normalizePlan({
    name: "Network Flow",
    nodes: [
      {
        id: "offline",
        title: "Offline",
        agent: "Researcher",
        task: "Summarize local files only.",
        mode: "codex"
      },
      {
        id: "online",
        title: "Online",
        agent: "Researcher",
        task: "Fetch public sources.",
        mode: "codex",
        networkPolicy: "full-access"
      }
    ],
    edges: []
  });

  assert.equal(plan.nodes.find((node) => node.id === "offline").networkPolicy, "confirm");
  assert.equal(plan.nodes.find((node) => node.id === "online").networkPolicy, "full-access");
});

test("applyNetworkPreference applies the generation default while keeping human checkpoints confirm-only", () => {
  const plan = applyNetworkPreference(fallbackPlan("ship a feature"), "full-access");

  assert.equal(plan.nodes.find((node) => node.mode === "codex").networkPolicy, "full-access");
  assert.equal(plan.nodes.find((node) => node.mode === "human-review").networkPolicy, "confirm");

  const confirmPlan = applyNetworkPreference(fallbackPlan("ship a feature"), "not-valid");
  assert.equal(confirmPlan.nodes.find((node) => node.mode === "codex").networkPolicy, "confirm");
});

test("applyReasoningPreference uses user-selected effort while keeping review nodes light", () => {
  const plan = applyReasoningPreference(fallbackPlan("ship a feature"), "low");

  assert.equal(plan.nodes.every((node) => node.reasoningEffort === "low"), true);

  const highPlan = applyReasoningPreference(fallbackPlan("ship a feature"), "high");
  assert.equal(highPlan.nodes.find((node) => node.mode === "codex").reasoningEffort, "high");
  assert.equal(highPlan.nodes.find((node) => node.mode === "human-review").reasoningEffort, "low");

  const maxPlan = applyReasoningPreference(fallbackPlan("ship a feature"), "max");
  assert.equal(maxPlan.nodes.find((node) => node.mode === "codex").reasoningEffort, "max");
});
