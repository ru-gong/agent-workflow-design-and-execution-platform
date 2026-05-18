import {
  OUTPUT_REQUIREMENT_OPTIONS,
  customForOutputRequirementTypeChange,
  defaultOutputRequirement,
  normalizeOutputRequirement,
  outputRequirementGuidance
} from "./outputRequirement.js";

const $ = (id) => document.getElementById(id);

const icons = {
  spark: svg("M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6L12 3zm6 10l.9 2.1L21 16l-2.1.9L18 19l-.9-2.1L15 16l2.1-.9L18 13zM5 14l.9 2.1L8 17l-2.1.9L5 20l-.9-2.1L2 17l2.1-.9L5 14z"),
  refresh: svg("M21 12a9 9 0 1 1-2.64-6.36M21 4v6h-6"),
  plus: svg("M12 5v14M5 12h14"),
  layout: svg("M3 5h7v6H3V5zm11 0h7v4h-7V5zM3 15h7v4H3v-4zm11-2h7v6h-7v-6z"),
  download: svg("M12 3v12m0 0l-4-4m4 4l4-4M4 21h16"),
  play: svg("M8 5v14l11-7-11-7z"),
  stop: svg("M6 6h12v12H6z"),
  trash: svg("M4 7h16M10 11v6m4-6v6M6 7l1 14h10l1-14M9 7V4h6v3"),
  broom: svg("M15 4l5 5-9 9H6v-5l9-9zM4 21h16"),
  undo: svg("M9 14L4 9l5-5M4 9h9a7 7 0 1 1-5 12"),
  check: svg("M20 6L9 17l-5-5"),
  clock: svg("M12 6v6l4 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z"),
  zoomIn: svg("M12 5v14M5 12h14"),
  zoomOut: svg("M5 12h14"),
  fit: svg("M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"),
  close: svg("M18 6L6 18M6 6l12 12"),
  open: svg("M14 3h7v7M21 3l-9 9M5 7h5M5 12h7M5 17h14"),
  folder: svg("M3 6h6l2 2h10v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6z")
};

const TOOL_PROVIDERS = {
  codex: {
    label: "Codex",
    defaultPlannerModel: "gpt-5.3-codex",
    defaultExecutorModel: "gpt-5.3-codex",
    models: ["gpt-5.5", "gpt-5.4", "gpt-5.4-mini", "gpt-5.3-codex", "gpt-5.3-codex-spark", "gpt-5.2"]
  },
  claude: {
    label: "Claude Code",
    defaultPlannerModel: "sonnet",
    defaultExecutorModel: "sonnet",
    models: ["sonnet", "opus", "haiku", "opusplan", "claude-sonnet-4-6", "claude-opus-4-7"]
  }
};

const CODEX_EFFORT_LEVELS = ["low", "medium", "high", "xhigh"];
const CLAUDE_SONNET_EFFORT_LEVELS = ["low", "medium", "high", "max"];
const CLAUDE_OPUS_47_EFFORT_LEVELS = ["low", "medium", "high", "xhigh", "max"];
const state = {
  plan: null,
  skills: [],
  selectedNodeId: "",
  selectedNodeIds: new Set(),
  run: null,
  logs: [],
  nodeActivity: {},
  reviewDialog: null,
  reviewDismissedNodeIds: new Set(),
  reviewManifest: null,
  reviewManifestSessionId: "",
  reviewManifestError: "",
  eventSource: null,
  drag: null,
  pan: null,
  selection: null,
  pendingActivityFocusNodeId: "",
  canvasZoom: 1,
  config: null,
  health: null,
  session: null,
  sessionSaveTimer: null,
  sessionSaveStatus: "",
  sessionTitleSaveStatus: "",
  undoStack: [],
  lastHistoryState: null
};

const FLOW_NODE_WIDTH = 200;
const FLOW_NODE_HEIGHT = 116;
const FLOW_CANVAS_PADDING = 56;
const INSERT_NODE_GAP = 340;
const ACTIVITY_BUBBLE_WIDTH = 218;
const ACTIVITY_BUBBLE_GAP = 10;
const ACTIVITY_BUBBLE_ROW_HEIGHT = 44;
const ACTIVITY_VIEW_MARGIN = 12;
const CANVAS_ZOOM_MIN = 0.4;
const CANVAS_ZOOM_MAX = 1.5;
const CANVAS_ZOOM_STEP = 0.1;
const MAX_UNDO_STEPS = 80;

function svg(path) {
  return `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${path}"/></svg>`;
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  if (!response.ok) throw new Error(data.error || `请求失败：${response.status}`);
  return data;
}

function normalizeToolProvider(value) {
  return TOOL_PROVIDERS[value] ? value : "codex";
}

function currentToolProvider() {
  return normalizeToolProvider(state.config?.toolProvider || $("toolProviderInput")?.value || "codex");
}

function toolLabel(provider) {
  return TOOL_PROVIDERS[normalizeToolProvider(provider)].label;
}

function defaultPlannerModel(provider) {
  return TOOL_PROVIDERS[normalizeToolProvider(provider)].defaultPlannerModel;
}

function defaultExecutorModel(provider) {
  return TOOL_PROVIDERS[normalizeToolProvider(provider)].defaultExecutorModel;
}

function providerModelRows(provider, { includeDefault = false, current = "" } = {}) {
  const normalized = normalizeToolProvider(provider);
  const models = TOOL_PROVIDERS[normalized].models;
  const rows = includeDefault ? [["", "默认执行模型"]] : [];
  for (const model of models) rows.push([model, model]);
  if (current && !rows.some(([value]) => value === current)) rows.unshift([current, current]);
  return rows;
}

function renderModelSelect(select, value, { provider = currentToolProvider(), includeDefault = false } = {}) {
  if (!select) return;
  const selected = value || (includeDefault ? "" : defaultPlannerModel(provider));
  select.innerHTML = providerModelRows(provider, { includeDefault, current: selected })
    .map(([model, label]) => `<option value="${escapeAttr(model)}" ${model === selected ? "selected" : ""}>${escapeHtml(label)}</option>`)
    .join("");
  select.value = selected;
}

function effortLevelsFor(provider = currentToolProvider(), model = "") {
  const normalized = normalizeToolProvider(provider);
  if (normalized === "codex") return CODEX_EFFORT_LEVELS;

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
  return [];
}

function coerceEffort(provider, model, value, fallback = "medium") {
  const levels = effortLevelsFor(provider, model);
  if (!levels.length) return "";
  const requested = String(value || "").trim().toLowerCase();
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

function renderEffortSelect(select, value, { provider = currentToolProvider(), model = "" } = {}) {
  if (!select) return "";
  const levels = effortLevelsFor(provider, model);
  if (!levels.length) {
    select.innerHTML = '<option value="">不适用</option>';
    select.value = "";
    select.disabled = true;
    select.title = "当前模型未声明支持 Claude Code --effort。";
    return "";
  }

  const selected = coerceEffort(provider, model, value);
  select.disabled = false;
  select.title = effortHelpText(provider, model);
  select.innerHTML = levels
    .map((level) => `<option value="${escapeAttr(level)}" ${level === selected ? "selected" : ""}>${escapeHtml(level)}</option>`)
    .join("");
  select.value = selected;
  return selected;
}

function effortOptionsMarkup({ provider = currentToolProvider(), model = "", value = "medium" } = {}) {
  const levels = effortLevelsFor(provider, model);
  if (!levels.length) return '<option value="">不适用</option>';
  const selected = coerceEffort(provider, model, value);
  return levels.map((level) => `<option value="${escapeAttr(level)}" ${level === selected ? "selected" : ""}>${escapeHtml(level)}</option>`).join("");
}

function effortSelectDisabledAttr(provider, model) {
  return effortLevelsFor(provider, model).length ? "" : "disabled";
}

function effortHelpText(provider, model) {
  if (normalizeToolProvider(provider) !== "claude") return "Codex 支持 low / medium / high / xhigh。";
  const levels = effortLevelsFor(provider, model);
  if (!levels.length) return "当前 Claude Code 模型未声明支持 --effort。";
  return `Claude Code 当前模型支持：${levels.join(" / ")}。`;
}

function selectedPlannerModel() {
  return $("modelInput")?.value || defaultPlannerModel(currentToolProvider());
}

function selectedExecutorModel() {
  return $("executorModelInput")?.value || state.config?.models?.executor || defaultExecutorModel(currentToolProvider());
}

function effectiveNodeModel(node) {
  return node?.model || selectedExecutorModel();
}

function ensureOutputRequirement(node) {
  node.outputRequirement = normalizeOutputRequirement(node.outputRequirement || defaultOutputRequirement());
  return node.outputRequirement;
}

function defaultReviewPolicy() {
  return {
    maxIterations: 3,
    targetNodeIds: [],
    criteria: "检查上游结果是否满足用户原始需求、验收标准、产物完整性和可验证性；发现可修复问题时发起一次受控迭代。",
    continueOnLimit: true
  };
}

function normalizeReviewPolicy(value = {}) {
  const defaults = defaultReviewPolicy();
  const parsedMax = Number.parseInt(value?.maxIterations, 10);
  const maxIterations = Number.isFinite(parsedMax) ? Math.min(Math.max(parsedMax, 1), 10) : defaults.maxIterations;
  return {
    maxIterations,
    targetNodeIds: Array.isArray(value?.targetNodeIds) ? value.targetNodeIds.map(String).slice(0, 6) : [],
    criteria: String(value?.criteria || defaults.criteria).slice(0, 1000),
    continueOnLimit: value?.continueOnLimit === undefined ? true : Boolean(value.continueOnLimit)
  };
}

function ensureReviewPolicy(node) {
  node.reviewPolicy = normalizeReviewPolicy(node.reviewPolicy || defaultReviewPolicy());
  const candidates = reviewTargetCandidates(node).map((item) => item.id);
  node.reviewPolicy.targetNodeIds = node.reviewPolicy.targetNodeIds.filter((id) => candidates.includes(id));
  if (!node.reviewPolicy.targetNodeIds.length && candidates.length) {
    node.reviewPolicy.targetNodeIds = [candidates.at(-1)];
  }
  return node.reviewPolicy;
}

function syncTopLevelEffortControls() {
  const provider = currentToolProvider();
  const defaultEffort = state.config?.models?.reasoningEffort || "medium";
  renderEffortSelect($("effortInput"), $("effortInput")?.value || defaultEffort, { provider, model: selectedPlannerModel() });
  renderEffortSelect($("defaultEffortInput"), $("defaultEffortInput")?.value || defaultEffort, { provider, model: selectedExecutorModel() });
}

function availableTools() {
  return Object.values(state.health?.tools || {}).filter((tool) => tool.ok);
}

function initButtons() {
  $("generateBtn").innerHTML = `${icons.spark}<span>生成编排</span>`;
  $("sampleBtn").textContent = "示例";
  $("refreshSkillsBtn").innerHTML = icons.refresh;
  $("addNodeBtn").innerHTML = icons.plus;
  $("layoutBtn").innerHTML = icons.layout;
  $("exportBtn").innerHTML = icons.download;
  $("runBtn").innerHTML = `${icons.play}<span>确认执行</span>`;
  $("stopRunBtn").innerHTML = icons.stop;
  $("deleteNodeBtn").innerHTML = icons.trash;
  $("undoBtn").innerHTML = icons.undo;
  $("clearLogsBtn").innerHTML = `${icons.broom}<span>清空</span>`;
  $("zoomOutBtn").innerHTML = icons.zoomOut;
  $("zoomInBtn").innerHTML = icons.zoomIn;
  $("fitCanvasBtn").innerHTML = icons.fit;
  $("closeReviewBtn").innerHTML = icons.close;
  $("saveConversationTitleBtn").textContent = "保存";
}

async function loadHealth() {
  try {
    const health = await api("/api/health");
    state.health = health;
    renderToolStatus();
  } catch (error) {
    $("toolStatus").className = "pill bad";
    $("toolStatus").textContent = error.message;
  }
}

function renderToolStatus() {
  const selected = currentToolProvider();
  const selectedInfo = state.health?.tools?.[selected];
  const available = availableTools();
  const status = $("toolStatus");
  if (!status) return;
  if (!available.length) {
    status.className = "pill bad";
    status.textContent = "未找到编程工具";
    return;
  }
  if (state.health?.mockMode) {
    status.className = "pill warn";
    status.textContent = "Mock 模式：未调用真实模型";
    return;
  }
  status.className = `pill ${selectedInfo?.ok ? "ok" : "warn"}`;
  status.textContent = selectedInfo?.ok
    ? `${toolLabel(selected)} 可用`
    : `${toolLabel(selected)} 未找到`;
}

async function loadConfig() {
  try {
    const data = await api("/api/config");
    state.config = data.config;
    applyConfigToForm();
    renderConfigStatus("已加载");
  } catch (error) {
    renderConfigStatus(error.message || "加载失败", "bad");
  }
}

function applyConfigToForm() {
  const config = state.config;
  if (!config) return;
  const provider = normalizeToolProvider(config.toolProvider);
  $("toolProviderInput").value = provider;
  $("settingsToolProviderInput").value = provider;
  renderModelSelect($("modelInput"), config.models?.planner || defaultPlannerModel(provider), { provider });
  renderModelSelect($("plannerModelInput"), config.models?.planner || defaultPlannerModel(provider), { provider });
  renderModelSelect($("executorModelInput"), config.models?.executor || defaultExecutorModel(provider), { provider });
  $("workspaceRootInput").value = config.workspaceRoot || ".";
  $("storageRootInput").value = config.storageRoot || ".orchestrator";
  $("artifactRootInput").value = config.artifactRoot || "artifacts";
  renderEffortSelect($("defaultEffortInput"), config.models?.reasoningEffort || "medium", {
    provider,
    model: $("executorModelInput").value
  });
  renderEffortSelect($("effortInput"), config.models?.reasoningEffort || $("effortInput").value || "medium", {
    provider,
    model: $("modelInput").value
  });
  renderConfigPaths();
  renderToolStatus();
}

async function saveConfigFromForm() {
  setBusy($("saveConfigBtn"), true, `${icons.refresh}<span>保存中</span>`);
  try {
    const data = await api("/api/config", {
      method: "PUT",
      body: JSON.stringify({
        config: {
          workspaceRoot: $("workspaceRootInput").value.trim() || ".",
          storageRoot: $("storageRootInput").value.trim() || ".orchestrator",
          artifactRoot: $("artifactRootInput").value.trim() || "artifacts",
          toolProvider: $("settingsToolProviderInput").value,
          toolProviderConfirmed: true,
          models: {
            planner: $("plannerModelInput").value,
            executor: $("executorModelInput").value,
            reasoningEffort: $("defaultEffortInput").value
          },
          codex: { adapter: "cli" },
          claude: { adapter: "cli" }
        }
      })
    });
    state.config = data.config;
    applyConfigToForm();
    renderConfigStatus("已保存");
    showNotice("运行设置已保存，之后生成和执行都会使用新配置。");
  } catch (error) {
    renderConfigStatus(error.message || "保存失败", "bad");
  } finally {
    setBusy($("saveConfigBtn"), false, "保存设置");
  }
}

async function selectToolProvider(provider, { confirmed = true, persist = true } = {}) {
  const normalized = normalizeToolProvider(provider);
  const previous = currentToolProvider();
  const planner = previous === normalized ? $("plannerModelInput").value : defaultPlannerModel(normalized);
  const executor = previous === normalized ? $("executorModelInput").value : defaultExecutorModel(normalized);
  $("toolProviderInput").value = normalized;
  $("settingsToolProviderInput").value = normalized;
  renderModelSelect($("modelInput"), planner, { provider: normalized });
  renderModelSelect($("plannerModelInput"), planner, { provider: normalized });
  renderModelSelect($("executorModelInput"), executor, { provider: normalized });
  const reasoningEffort = renderEffortSelect($("defaultEffortInput"), $("defaultEffortInput").value || state.config?.models?.reasoningEffort || "medium", {
    provider: normalized,
    model: executor
  });
  renderEffortSelect($("effortInput"), reasoningEffort || $("effortInput").value || "medium", {
    provider: normalized,
    model: planner
  });
  if (!state.config) return;
  state.config = {
    ...state.config,
    toolProvider: normalized,
    toolProviderConfirmed: confirmed,
    models: {
      ...(state.config.models || {}),
      planner,
      executor,
      reasoningEffort
    }
  };
  renderConfigPaths();
  renderToolStatus();
  renderInspector();
  await loadSkills(normalized);
  if (!persist) return;
  try {
    const data = await api("/api/config", {
      method: "PUT",
      body: JSON.stringify({ config: state.config })
    });
    state.config = data.config;
    applyConfigToForm();
    renderConfigStatus("已选择");
    showNotice(`已切换为 ${toolLabel(normalized)}，之后生成和执行都会使用该工具。`);
  } catch (error) {
    renderConfigStatus(error.message || "保存失败", "bad");
  }
}

function maybePromptToolChoice() {
  const tools = availableTools();
  if (!state.config || state.config.toolProviderConfirmed) return;
  if (tools.length < 2 && state.health?.tools?.[currentToolProvider()]?.ok) return;
  renderToolChoiceModal();
}

function renderToolChoiceModal() {
  const modal = $("toolChoiceModal");
  const cards = $("toolChoiceCards");
  if (!modal || !cards) return;
  const tools = Object.values(state.health?.tools || {}).filter((tool) => tool.ok);
  cards.innerHTML = tools.map((tool) => `
    <button class="tool-choice-card" type="button" data-tool-choice="${escapeAttr(tool.id)}">
      <strong>${escapeHtml(tool.label)}</strong>
      <span>${escapeHtml(tool.version || tool.command || "已检测到命令")}</span>
    </button>
  `).join("") || '<div class="tool-choice-empty">未检测到 Codex 或 Claude Code。请先安装至少一个编程工具。</div>';
  modal.classList.toggle("hidden", false);
  for (const button of cards.querySelectorAll("[data-tool-choice]")) {
    button.addEventListener("click", async () => {
      await selectToolProvider(button.dataset.toolChoice, { confirmed: true, persist: true });
      modal.classList.add("hidden");
    });
  }
}

async function pickConfigFolder(inputId, fallbackPathKey, title, button) {
  setBusy(button, true, `${icons.refresh}<span>选择中</span>`);
  try {
    const data = await api("/api/select-folder", {
      method: "POST",
      body: JSON.stringify({
        title,
        currentPath: $(inputId).value.trim(),
        fallbackPath: state.config?.paths?.[fallbackPathKey] || ""
      })
    });
    if (data.cancelled) {
      renderConfigStatus("已取消");
      return;
    }
    if (data.path) {
      $(inputId).value = data.path;
      renderConfigStatus("已选择，待保存");
    }
  } catch (error) {
    renderConfigStatus(error.message || "选择失败", "bad");
  } finally {
    setBusy(button, false, "选择");
  }
}

function renderConfigStatus(text, tone = "") {
  const status = $("configStatus");
  if (!status) return;
  status.textContent = text;
  status.className = `settings-status ${tone}`;
}

function renderConfigPaths() {
  const box = $("configPaths");
  if (!box || !state.config?.paths) return;
  box.innerHTML = `
    <div><span>tool</span><strong>${escapeHtml(toolLabel(state.config.toolProvider))}</strong></div>
    <div><span>workspace</span><strong>${escapeHtml(state.config.paths.workspaceRootPath)}</strong></div>
    <div><span>sessions</span><strong>${escapeHtml(state.config.paths.sessionsRootPath)}</strong></div>
    <div><span>artifacts</span><strong>${escapeHtml(state.config.paths.artifactRootPath)}</strong></div>
  `;
}

async function loadSkills(provider = currentToolProvider()) {
  $("refreshSkillsBtn").classList.add("spin");
  try {
    const data = await api(`/api/skills?toolProvider=${encodeURIComponent(normalizeToolProvider(provider))}`);
    state.skills = data.skills || [];
    sanitizeUnavailablePlanSkills();
  } catch {
    state.skills = [];
  } finally {
    $("refreshSkillsBtn").classList.remove("spin");
    renderSkills();
    renderInspector();
    renderCanvas();
  }
}

function loadSample() {
  $("goalInput").value = "请做一个天气查询网页";
  $("modelInput").value = defaultPlannerModel(currentToolProvider());
  renderEffortSelect($("effortInput"), "low", { provider: currentToolProvider(), model: $("modelInput").value });
  $("networkPolicyInput").value = "confirm";
}

async function generatePlan() {
  const goal = $("goalInput").value.trim();
  if (goal.length < 4) {
    showNotice("请输入更具体的任务目标。", "bad");
    return;
  }

  const provider = currentToolProvider();
  const model = $("modelInput").value.trim();
  const reasoningEffort = $("effortInput").value;
  const networkPolicy = $("networkPolicyInput").value;
  const startedAt = Date.now();
  state.run = null;
  state.logs = [];
  appendPlanLog(`starting ${toolLabel(provider)} planner · model=${model || "default"} · effort=${reasoningEffort || "auto"} · network=${networkPolicy}`);
  const planningHeartbeat = setInterval(() => {
    appendPlanLog(`${toolLabel(provider)} planner still running · ${Math.round((Date.now() - startedAt) / 1000)}s elapsed`);
  }, 15000);

  setBusy($("generateBtn"), true, `${icons.refresh}<span>生成中</span>`);
  showNotice(state.health?.mockMode
    ? "当前服务处于 Mock 模式，将生成快速备用草案，不会调用真实模型。"
    : `正在调用 ${toolLabel(provider)} 生成可编辑编排方案...`, state.health?.mockMode ? "warn" : "");
  try {
    const data = await api("/api/plan", {
      method: "POST",
      body: JSON.stringify({
        goal,
        toolProvider: provider,
        model,
        reasoningEffort,
        networkPolicy
      })
    });
    state.plan = data.plan;
    sanitizeUnavailablePlanSkills(state.plan);
    state.session = data.session || null;
    state.sessionSaveStatus = state.session ? "已保存" : "";
    state.sessionTitleSaveStatus = state.session ? "已自动命名" : "";
    state.selectedNodeId = state.plan.nodes[0]?.id || "";
    state.selectedNodeIds = new Set(state.selectedNodeId ? [state.selectedNodeId] : []);
    state.run = null;
    state.nodeActivity = {};
    state.reviewDialog = null;
    state.reviewDismissedNodeIds = new Set();
    state.reviewManifest = null;
    state.reviewManifestSessionId = "";
    state.reviewManifestError = "";
    autoLayout(false);
    resetPlanHistory();
    const toolSource = ["codex", "claude"].includes(data.source);
    appendPlanLog(`completed · source=${data.source || "unknown"} · nodes=${state.plan.nodes?.length || 0} · session=${state.session?.id || "none"} · ${Math.round((Date.now() - startedAt) / 1000)}s`);
    if (data.warning) appendPlanLog(`warning · ${data.warning}`);
    showNotice(toolSource ? `已由 ${toolLabel(data.source)} 生成并创建会话，可继续人工调整。` : `已生成备用方案：${data.warning || ""}`, toolSource ? "" : "warn");
    renderAll();
    requestAnimationFrame(fitCanvasToView);
  } catch (error) {
    appendPlanLog(`failed · ${error.message}`);
    showNotice(error.message, "bad");
  } finally {
    clearInterval(planningHeartbeat);
    setBusy($("generateBtn"), false, `${icons.spark}<span>生成编排</span>`);
  }
}

function setBusy(button, busy, html) {
  button.disabled = busy;
  button.innerHTML = html;
  button.classList.toggle("busy", busy);
  button.querySelector(".icon")?.classList.toggle("spin", busy);
}

function showNotice(text, tone = "") {
  $("planNotice").className = `notice ${tone}`;
  $("planNotice").textContent = text || "";
}

function renderAll() {
  renderPlanHeader();
  renderCanvas();
  renderInspector();
  renderSkills();
  ensureArtifactManifestLoaded();
  renderRun();
  renderReviewDialog();
  renderUndoControls();
  queueActivityVisibilityCheck();
}

function renderPlanHeader() {
  renderConversationTitle();
  $("planName").textContent = state.plan?.name || "等待生成编排";
  $("planSummary").textContent = state.plan?.summary || `输入需求后，让 ${toolLabel(currentToolProvider())} 生成可编辑的 DAG 任务流。`;
  renderSessionMeta();
}

function renderConversationTitle() {
  const input = $("conversationTitleInput");
  const button = $("saveConversationTitleBtn");
  const status = $("conversationTitleStatus");
  if (!input || !button || !status) return;
  const hasSession = Boolean(state.session?.id);
  const title = state.session?.title || "";
  input.disabled = !hasSession;
  button.disabled = !hasSession;
  if (document.activeElement !== input) {
    input.value = title;
  }
  status.textContent = hasSession
    ? (state.sessionTitleSaveStatus || "可直接修改后保存")
    : "生成工作流后自动创建名称";
  status.classList.toggle("bad", /失败|错误/.test(state.sessionTitleSaveStatus || ""));
}

function renderSessionMeta() {
  const box = $("sessionMeta");
  if (!box) return;
  if (!state.session) {
    box.textContent = "尚未创建会话。";
    return;
  }
  const save = state.sessionSaveStatus ? ` · ${state.sessionSaveStatus}` : "";
  box.textContent = `Session ${state.session.id}${save} · ${state.session.paths?.artifactDir || ""}`;
}

async function saveConversationTitle() {
  if (!state.session?.id) return;
  const input = $("conversationTitleInput");
  const title = input.value.trim();
  if (!title) {
    state.sessionTitleSaveStatus = "名称不能为空";
    renderConversationTitle();
    return;
  }
  if (title === state.session.title) {
    state.sessionTitleSaveStatus = "已保存";
    renderConversationTitle();
    return;
  }
  setBusy($("saveConversationTitleBtn"), true, `${icons.refresh}<span>保存中</span>`);
  state.sessionTitleSaveStatus = "保存中";
  renderConversationTitle();
  try {
    const data = await api(`/api/sessions/${encodeURIComponent(state.session.id)}/title`, {
      method: "PUT",
      body: JSON.stringify({ title })
    });
    state.session = data.session || state.session;
    state.sessionTitleSaveStatus = "已保存";
    renderPlanHeader();
    renderArtifactQuickPanel();
  } catch (error) {
    state.sessionTitleSaveStatus = `保存失败：${error.message}`;
    renderConversationTitle();
  } finally {
    setBusy($("saveConversationTitleBtn"), false, "保存");
  }
}

function isNodeSelected(nodeId) {
  return state.selectedNodeIds?.has(nodeId) || state.selectedNodeId === nodeId;
}

function setNodeSelection(ids, primaryId = "") {
  const validIds = new Set(state.plan?.nodes?.map((node) => node.id) || []);
  const selected = [...new Set(ids)].filter((id) => validIds.has(id));
  state.selectedNodeIds = new Set(selected);
  state.selectedNodeId = primaryId && validIds.has(primaryId)
    ? primaryId
    : selected.at(-1) || "";
}

function selectSingleNode(nodeId) {
  setNodeSelection(nodeId ? [nodeId] : [], nodeId);
}

function selectedNodes() {
  return state.plan?.nodes?.filter((node) => state.selectedNodeIds.has(node.id)) || [];
}

function renderCanvas() {
  const nodeLayer = $("nodeLayer");
  nodeLayer.innerHTML = "";
  hideSelectionRect();
  $("emptyState").classList.toggle("hidden", Boolean(state.plan?.nodes?.length));

  for (const node of state.plan?.nodes || []) {
    const el = document.createElement("article");
    const status = nodeState(node.id);
    const isReadOnly = (node.sandbox || "workspace-write") === "read-only";
    const networkPolicy = node.networkPolicy || "confirm";
    const activityPlacement = getActivityPlacement(node);
    el.className = ["flow-node", status, isReadOnly ? "read-only-node" : "", isNodeSelected(node.id) ? "selected" : "", state.nodeActivity[node.id]?.length ? "has-activity" : ""].filter(Boolean).join(" ");
    el.dataset.nodeId = node.id;
    el.style.left = `${node.x || 0}px`;
    el.style.top = `${node.y || 0}px`;
    el.innerHTML = `
      <div class="node-head">
        <div class="node-title" contenteditable="true" spellcheck="false"></div>
        <div class="node-badges">
          ${isReadOnly ? '<span class="node-sandbox-badge" title="只读节点不会写入文件，结果由运行器保存">只读</span>' : ""}
          <span class="node-network-badge ${escapeAttr(networkPolicy)}" title="${escapeAttr(networkPolicyTitle(networkPolicy))}">${escapeHtml(networkPolicyLabel(networkPolicy))}</span>
          <span class="node-status ${status}">${statusLabel(status)}</span>
        </div>
      </div>
      <div class="node-body">
        <div class="node-agent"></div>
        <div class="node-task"></div>
        <div class="node-skills"></div>
      </div>
      ${renderNodeActivity(node.id, activityPlacement)}
    `;
    el.querySelector(".node-title").textContent = node.title;
    el.querySelector(".node-title").addEventListener("input", (event) => {
      node.title = event.currentTarget.textContent.trim() || node.title;
      markPlanDirty("plan:node-title");
      renderPlanHeader();
      renderInspector();
      renderRun();
    });
    el.querySelector(".node-agent").textContent = `${node.agent} · ${modeDisplayLabel(node.mode)} · ${node.reasoningEffort || "auto"}`;
    el.querySelector(".node-task").textContent = node.task;
    const skillBox = el.querySelector(".node-skills");
    for (const skill of node.skills || []) {
      const chip = document.createElement("span");
      chip.className = "node-skill";
      chip.textContent = skill;
      skillBox.appendChild(chip);
    }
    bindNodeDrag(el, node);
    nodeLayer.appendChild(el);
  }
  resizeCanvasToNodes();
  renderEdges();
}

function bindNodeDrag(el, node) {
  el.addEventListener("pointerdown", (event) => {
    if (event.target.closest("[contenteditable], input, textarea, select, button")) return;
    event.preventDefault();
    if (event.shiftKey || event.metaKey) {
      const next = new Set(state.selectedNodeIds);
      if (next.has(node.id)) next.delete(node.id);
      else next.add(node.id);
      setNodeSelection([...next], next.has(node.id) ? node.id : [...next].at(-1) || "");
      updateNodeSelection();
      renderInspector();
      renderSkills();
      return;
    }
    if (!isNodeSelected(node.id)) selectSingleNode(node.id);
    el.setPointerCapture(event.pointerId);
    const nodes = selectedNodes().length ? selectedNodes() : [node];
    state.drag = {
      type: "nodes",
      nodeIds: nodes.map((item) => item.id),
      startX: event.clientX,
      startY: event.clientY,
      origins: Object.fromEntries(nodes.map((item) => [item.id, { x: item.x || 0, y: item.y || 0 }]))
    };
    updateNodeSelection();
    renderInspector();
    renderSkills();
  });
  el.addEventListener("pointermove", (event) => {
    if (!state.drag || state.drag.type !== "nodes" || !state.drag.nodeIds.includes(node.id)) return;
    const zoom = state.canvasZoom || 1;
    const dx = (event.clientX - state.drag.startX) / zoom;
    const dy = (event.clientY - state.drag.startY) / zoom;
    for (const id of state.drag.nodeIds) {
      const moved = state.plan.nodes.find((item) => item.id === id);
      const origin = state.drag.origins[id];
      if (!moved || !origin) continue;
      moved.x = Math.max(20, origin.x + dx);
      moved.y = Math.max(20, origin.y + dy);
      const movedEl = document.querySelector(`[data-node-id="${id}"]`);
      if (movedEl) {
        movedEl.style.left = `${moved.x}px`;
        movedEl.style.top = `${moved.y}px`;
      }
    }
    resizeCanvasToNodes();
    renderEdges();
  });
  el.addEventListener("pointerup", () => {
    if (state.drag?.type === "nodes" && state.drag.nodeIds.includes(node.id)) markPlanDirty("plan:node-position");
    state.drag = null;
  });
  el.addEventListener("pointercancel", () => {
    state.drag = null;
  });
}

function updateNodeSelection() {
  for (const el of document.querySelectorAll(".flow-node")) {
    el.classList.toggle("selected", isNodeSelected(el.dataset.nodeId));
  }
  renderEdges();
}

function bindCanvasSelection() {
  const viewport = $("flowViewport");
  const scroller = $("canvasScroller");
  viewport.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    if (event.target.closest(".flow-node, button, input, textarea, select, summary")) return;
    if (event.shiftKey && state.plan?.nodes?.length) {
      startCanvasSelection(event, viewport, scroller);
      return;
    }
    startCanvasPan(event, viewport, scroller);
  });

  viewport.addEventListener("pointermove", (event) => {
    if (state.pan && state.pan.pointerId === event.pointerId) {
      updateCanvasPan(event, scroller);
      return;
    }
    if (!state.selection || state.selection.pointerId !== event.pointerId) return;
    const point = canvasPointFromEvent(event);
    state.selection.currentX = point.x;
    state.selection.currentY = point.y;
    updateSelectionRect();
    updateMarqueeSelection();
  });

  viewport.addEventListener("pointerup", (event) => {
    if (state.pan && state.pan.pointerId === event.pointerId) {
      finishCanvasPan(event, viewport, scroller);
      return;
    }
    if (!state.selection || state.selection.pointerId !== event.pointerId) return;
    const rect = selectionBounds();
    if (rect.width < 4 && rect.height < 4 && state.selection.baseIds.size === 0) {
      selectSingleNode("");
      updateNodeSelection();
      renderInspector();
      renderSkills();
    } else {
      updateMarqueeSelection();
    }
    state.selection = null;
    scroller?.classList.remove("selecting");
    hideSelectionRect();
  });

  viewport.addEventListener("pointercancel", (event) => {
    if (state.pan?.pointerId === event.pointerId) state.pan = null;
    state.selection = null;
    scroller?.classList.remove("panning", "selecting");
    hideSelectionRect();
  });
}

function startCanvasSelection(event, viewport, scroller) {
  event.preventDefault();
  const start = canvasPointFromEvent(event);
  state.selection = {
    pointerId: event.pointerId,
    startX: start.x,
    startY: start.y,
    currentX: start.x,
    currentY: start.y,
    baseIds: event.metaKey ? new Set(state.selectedNodeIds) : new Set()
  };
  viewport.setPointerCapture(event.pointerId);
  scroller?.classList.add("selecting");
  updateSelectionRect();
}

function startCanvasPan(event, viewport, scroller) {
  if (!scroller) return;
  event.preventDefault();
  const nodes = state.plan?.nodes || [];
  state.pan = {
    type: "canvas",
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    origins: Object.fromEntries(nodes.map((node) => [node.id, { x: node.x || 0, y: node.y || 0 }])),
    moved: false
  };
  viewport.setPointerCapture(event.pointerId);
  scroller.classList.add("panning");
}

function updateCanvasPan(event, scroller) {
  if (!state.pan || !scroller) return;
  const zoom = state.canvasZoom || 1;
  const rawDx = (event.clientX - state.pan.startX) / zoom;
  const rawDy = (event.clientY - state.pan.startY) / zoom;
  if (Math.abs(rawDx) + Math.abs(rawDy) > 3) state.pan.moved = true;
  if (state.pan.type !== "canvas" || !state.plan?.nodes?.length) return;
  const origins = Object.values(state.pan.origins || {});
  const minOriginX = Math.min(...origins.map((origin) => origin.x));
  const minOriginY = Math.min(...origins.map((origin) => origin.y));
  const dx = Math.max(20 - minOriginX, rawDx);
  const dy = Math.max(20 - minOriginY, rawDy);
  for (const node of state.plan.nodes) {
    const origin = state.pan.origins[node.id];
    if (!origin) continue;
    node.x = origin.x + dx;
    node.y = origin.y + dy;
    const nodeEl = document.querySelector(`[data-node-id="${node.id}"]`);
    if (nodeEl) {
      nodeEl.style.left = `${node.x}px`;
      nodeEl.style.top = `${node.y}px`;
    }
  }
  resizeCanvasToNodes();
  renderEdges();
}

function finishCanvasPan(event, viewport, scroller) {
  const pan = state.pan;
  state.pan = null;
  scroller?.classList.remove("panning");
  if (viewport.hasPointerCapture?.(event.pointerId)) viewport.releasePointerCapture(event.pointerId);
  if (pan?.moved && pan.type === "canvas" && state.plan?.nodes?.length) {
    markPlanDirty("plan:canvas-pan");
    renderCanvas();
    return;
  }
  if (!pan?.moved) {
    selectSingleNode("");
    updateNodeSelection();
    renderInspector();
    renderSkills();
  }
}

function canvasPointFromEvent(event) {
  const rect = $("flowViewport").getBoundingClientRect();
  const zoom = state.canvasZoom || 1;
  return {
    x: (event.clientX - rect.left) / zoom,
    y: (event.clientY - rect.top) / zoom
  };
}

function selectionBounds() {
  const selection = state.selection;
  if (!selection) return { x: 0, y: 0, width: 0, height: 0 };
  const x = Math.min(selection.startX, selection.currentX);
  const y = Math.min(selection.startY, selection.currentY);
  return {
    x,
    y,
    width: Math.abs(selection.currentX - selection.startX),
    height: Math.abs(selection.currentY - selection.startY)
  };
}

function updateSelectionRect() {
  const rect = $("selectionRect");
  const bounds = selectionBounds();
  rect.classList.remove("hidden");
  rect.style.left = `${bounds.x}px`;
  rect.style.top = `${bounds.y}px`;
  rect.style.width = `${bounds.width}px`;
  rect.style.height = `${bounds.height}px`;
}

function hideSelectionRect() {
  const rect = $("selectionRect");
  if (!rect) return;
  rect.classList.add("hidden");
  rect.style.width = "0";
  rect.style.height = "0";
}

function updateMarqueeSelection() {
  const bounds = selectionBounds();
  const selected = new Set(state.selection?.baseIds || []);
  for (const node of state.plan?.nodes || []) {
    if (rectsIntersect(bounds, { x: node.x || 0, y: node.y || 0, width: FLOW_NODE_WIDTH, height: FLOW_NODE_HEIGHT })) {
      selected.add(node.id);
    }
  }
  setNodeSelection([...selected], [...selected].at(-1) || "");
  updateNodeSelection();
  renderInspector();
  renderSkills();
}

function rectsIntersect(a, b) {
  return a.x <= b.x + b.width
    && a.x + a.width >= b.x
    && a.y <= b.y + b.height
    && a.y + a.height >= b.y;
}

function rectOverlapArea(a, b) {
  const width = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const height = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  return width * height;
}

function getActivityPlacement(node) {
  const entries = state.nodeActivity[node.id] || [];
  if (!entries.length) return { name: "bottom", offsetX: 8, offsetY: FLOW_NODE_HEIGHT + ACTIVITY_BUBBLE_GAP };
  const bubbleHeight = Math.max(44, entries.length * ACTIVITY_BUBBLE_ROW_HEIGHT + Math.max(0, entries.length - 1) * 5);
  const x = node.x || 0;
  const y = node.y || 0;
  const bounds = getCanvasLogicalBounds();
  const visible = getVisibleLogicalRect(bounds);
  const constraint = intersectRects(
    { x: 0, y: 0, width: bounds.width, height: bounds.height },
    visible
  ) || { x: 0, y: 0, width: bounds.width, height: bounds.height };
  const otherRects = (state.plan?.nodes || [])
    .filter((candidate) => candidate.id !== node.id)
    .map((candidate) => ({
      x: candidate.x || 0,
      y: candidate.y || 0,
      width: FLOW_NODE_WIDTH,
      height: FLOW_NODE_HEIGHT
    }));
  const candidates = [
    { name: "right", bias: 0, rect: { x: x + FLOW_NODE_WIDTH + ACTIVITY_BUBBLE_GAP, y, width: ACTIVITY_BUBBLE_WIDTH, height: bubbleHeight } },
    { name: "bottom", bias: 8, rect: { x: x + 8, y: y + FLOW_NODE_HEIGHT + ACTIVITY_BUBBLE_GAP, width: ACTIVITY_BUBBLE_WIDTH, height: bubbleHeight } },
    { name: "left", bias: 14, rect: { x: x - ACTIVITY_BUBBLE_WIDTH - ACTIVITY_BUBBLE_GAP, y, width: ACTIVITY_BUBBLE_WIDTH, height: bubbleHeight } },
    { name: "top", bias: 18, rect: { x: x + 8, y: y - bubbleHeight - ACTIVITY_BUBBLE_GAP, width: ACTIVITY_BUBBLE_WIDTH, height: bubbleHeight } }
  ];
  const best = candidates
    .map((candidate) => {
      const rect = clampRectToBounds(candidate.rect, constraint, ACTIVITY_VIEW_MARGIN);
      const ownCollision = rectOverlapArea(rect, { x, y, width: FLOW_NODE_WIDTH, height: FLOW_NODE_HEIGHT });
      const moveDistance = Math.abs(rect.x - candidate.rect.x) + Math.abs(rect.y - candidate.rect.y);
      return {
        ...candidate,
        rect,
        score: scoreActivityPlacement(rect, visible, otherRects) + ownCollision * 5 + moveDistance * 1.5 + candidate.bias
      };
    })
    .sort((a, b) => a.score - b.score)[0];

  return best
    ? { name: best.name, offsetX: Math.round(best.rect.x - x), offsetY: Math.round(best.rect.y - y) }
    : { name: "bottom", offsetX: 8, offsetY: FLOW_NODE_HEIGHT + ACTIVITY_BUBBLE_GAP };
}

function getCanvasLogicalBounds() {
  const zoom = state.canvasZoom || 1;
  const scroller = $("canvasScroller");
  const minWidth = Math.max(320, (scroller?.clientWidth || 0) / zoom);
  const minHeight = Math.max(360, (scroller?.clientHeight || 0) / zoom);
  const nodes = state.plan?.nodes || [];
  const activityPadding = getActivityCanvasPadding();
  const maxX = nodes.reduce((value, node) => Math.max(value, (node.x || 0) + FLOW_NODE_WIDTH + FLOW_CANVAS_PADDING + activityPadding.x), 0);
  const maxY = nodes.reduce((value, node) => Math.max(value, (node.y || 0) + FLOW_NODE_HEIGHT + FLOW_CANVAS_PADDING + activityPadding.y), 0);
  return {
    width: Math.max(minWidth, maxX),
    height: Math.max(minHeight, maxY)
  };
}

function getVisibleLogicalRect(bounds = getCanvasLogicalBounds()) {
  const zoom = state.canvasZoom || 1;
  const scroller = $("canvasScroller");
  if (!scroller) return { x: 0, y: 0, width: bounds.width, height: bounds.height };
  return {
    x: scroller.scrollLeft / zoom,
    y: scroller.scrollTop / zoom,
    width: scroller.clientWidth / zoom,
    height: scroller.clientHeight / zoom
  };
}

function getActivityCanvasPadding() {
  const maxEntries = Math.max(0, ...Object.values(state.nodeActivity || {}).map((entries) => entries?.length || 0));
  if (!maxEntries) return { x: 0, y: 0 };
  const maxHeight = Math.max(44, maxEntries * ACTIVITY_BUBBLE_ROW_HEIGHT + Math.max(0, maxEntries - 1) * 5);
  return {
    x: ACTIVITY_BUBBLE_WIDTH + ACTIVITY_BUBBLE_GAP * 2,
    y: maxHeight + ACTIVITY_BUBBLE_GAP * 2
  };
}

function scoreActivityPlacement(rect, bounds, otherRects) {
  const overflow = Math.max(0, bounds.x - rect.x)
    + Math.max(0, bounds.y - rect.y)
    + Math.max(0, rect.x + rect.width - (bounds.x + bounds.width))
    + Math.max(0, rect.y + rect.height - (bounds.y + bounds.height));
  const collision = otherRects.reduce((total, other) => total + rectOverlapArea(rect, other), 0);
  return collision * 3 + overflow * 40;
}

function clampRectToBounds(rect, bounds, margin = 0) {
  const maxX = bounds.x + Math.max(0, bounds.width - rect.width - margin);
  const maxY = bounds.y + Math.max(0, bounds.height - rect.height - margin);
  return {
    ...rect,
    x: Math.min(Math.max(rect.x, bounds.x + margin), maxX),
    y: Math.min(Math.max(rect.y, bounds.y + margin), maxY)
  };
}

function intersectRects(a, b) {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  if (right <= x || bottom <= y) return null;
  return { x, y, width: right - x, height: bottom - y };
}

function renderEdges() {
  const svgEl = $("edgeLayer");
  svgEl.innerHTML = "";
  if (!state.plan) return;
  syncEdgesFromDependencies();
  const byId = new Map(state.plan.nodes.map((node) => [node.id, node]));
  for (const edge of state.plan.edges || []) {
    const from = byId.get(edge.from);
    const to = byId.get(edge.to);
    if (!from || !to) continue;
    const x1 = (from.x || 0) + FLOW_NODE_WIDTH;
    const y1 = (from.y || 0) + Math.round(FLOW_NODE_HEIGHT / 2);
    const x2 = to.x || 0;
    const y2 = (to.y || 0) + Math.round(FLOW_NODE_HEIGHT / 2);
    const mid = Math.max(52, Math.abs(x2 - x1) / 2);
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", `M ${x1} ${y1} C ${x1 + mid} ${y1}, ${x2 - mid} ${y2}, ${x2} ${y2}`);
    const fromStatus = nodeState(edge.from);
    const toStatus = nodeState(edge.to);
    const classes = ["edge-path"];
    if (isNodeSelected(edge.to) || isNodeSelected(edge.from)) classes.push("active");
    if (["running", "waiting"].includes(toStatus)) classes.push("live");
    if (fromStatus === "completed" && toStatus === "completed") classes.push("completed");
    path.setAttribute("class", classes.join(" "));
    svgEl.appendChild(path);
  }
}

function resizeCanvasToNodes() {
  const canvas = $("flowCanvas");
  const viewport = $("flowViewport");
  const scroller = $("canvasScroller");
  const zoom = state.canvasZoom || 1;
  const nodes = state.plan?.nodes || [];
  const minWidth = Math.max(320, (scroller?.clientWidth || 0) / zoom);
  const minHeight = Math.max(360, (scroller?.clientHeight || 0) / zoom);
  const activityPadding = getActivityCanvasPadding();
  const maxX = nodes.reduce((value, node) => Math.max(value, (node.x || 0) + FLOW_NODE_WIDTH + FLOW_CANVAS_PADDING + activityPadding.x), 0);
  const maxY = nodes.reduce((value, node) => Math.max(value, (node.y || 0) + FLOW_NODE_HEIGHT + FLOW_CANVAS_PADDING + activityPadding.y), 0);
  const logicalWidth = Math.max(minWidth, maxX);
  const logicalHeight = Math.max(minHeight, maxY);
  canvas.style.width = `${Math.ceil(logicalWidth * zoom)}px`;
  canvas.style.height = `${Math.ceil(logicalHeight * zoom)}px`;
  viewport.style.width = `${logicalWidth}px`;
  viewport.style.height = `${logicalHeight}px`;
  viewport.style.transform = `scale(${zoom})`;
  $("edgeLayer").setAttribute("width", String(logicalWidth));
  $("edgeLayer").setAttribute("height", String(logicalHeight));
  if (scroller) scroller.style.backgroundSize = `${Math.max(12, 32 * zoom)}px ${Math.max(12, 32 * zoom)}px`;
  renderZoomControls();
}

function clampZoom(value) {
  return Math.min(CANVAS_ZOOM_MAX, Math.max(CANVAS_ZOOM_MIN, Number(value) || 1));
}

function roundedZoom(value) {
  return Math.round(clampZoom(value) * 100) / 100;
}

function setCanvasZoom(nextZoom) {
  const scroller = $("canvasScroller");
  const previousZoom = state.canvasZoom || 1;
  const centerX = scroller ? (scroller.scrollLeft + scroller.clientWidth / 2) / previousZoom : 0;
  const centerY = scroller ? (scroller.scrollTop + scroller.clientHeight / 2) / previousZoom : 0;
  state.canvasZoom = roundedZoom(nextZoom);
  resizeCanvasToNodes();
  if (scroller) {
    requestAnimationFrame(() => {
      scroller.scrollLeft = Math.max(0, centerX * state.canvasZoom - scroller.clientWidth / 2);
      scroller.scrollTop = Math.max(0, centerY * state.canvasZoom - scroller.clientHeight / 2);
    });
  }
}

function zoomCanvasBy(delta) {
  setCanvasZoom((state.canvasZoom || 1) + delta);
}

function handleCanvasWheel(event) {
  if (!event.ctrlKey && !event.metaKey) return;
  event.preventDefault();
  const scroller = $("canvasScroller");
  const previousZoom = state.canvasZoom || 1;
  const rect = scroller.getBoundingClientRect();
  const pointerX = event.clientX - rect.left;
  const pointerY = event.clientY - rect.top;
  const logicalX = (scroller.scrollLeft + pointerX) / previousZoom;
  const logicalY = (scroller.scrollTop + pointerY) / previousZoom;
  state.canvasZoom = roundedZoom(previousZoom + (event.deltaY > 0 ? -CANVAS_ZOOM_STEP : CANVAS_ZOOM_STEP));
  resizeCanvasToNodes();
  requestAnimationFrame(() => {
    scroller.scrollLeft = Math.max(0, logicalX * state.canvasZoom - pointerX);
    scroller.scrollTop = Math.max(0, logicalY * state.canvasZoom - pointerY);
  });
}

function resetCanvasZoom() {
  setCanvasZoom(1);
}

function fitCanvasToView() {
  const scroller = $("canvasScroller");
  const nodes = state.plan?.nodes || [];
  if (!scroller || !nodes.length) {
    setCanvasZoom(1);
    return;
  }
  const minX = Math.min(...nodes.map((node) => node.x || 0));
  const minY = Math.min(...nodes.map((node) => node.y || 0));
  const maxX = Math.max(...nodes.map((node) => (node.x || 0) + FLOW_NODE_WIDTH));
  const maxY = Math.max(...nodes.map((node) => (node.y || 0) + FLOW_NODE_HEIGHT));
  const contentWidth = Math.max(1, maxX - minX + FLOW_CANVAS_PADDING * 2);
  const contentHeight = Math.max(1, maxY - minY + FLOW_CANVAS_PADDING * 2);
  const widthZoom = (scroller.clientWidth - 24) / contentWidth;
  const heightZoom = (scroller.clientHeight - 24) / contentHeight;
  state.canvasZoom = roundedZoom(Math.min(1, widthZoom, heightZoom));
  resizeCanvasToNodes();
  requestAnimationFrame(() => {
    scroller.scrollLeft = Math.max(0, (minX - FLOW_CANVAS_PADDING) * state.canvasZoom);
    scroller.scrollTop = Math.max(0, (minY - FLOW_CANVAS_PADDING) * state.canvasZoom);
  });
}

function renderZoomControls() {
  const label = $("zoomLabel");
  if (!label) return;
  const zoom = state.canvasZoom || 1;
  label.textContent = `${Math.round(zoom * 100)}%`;
  $("zoomOutBtn").disabled = zoom <= CANVAS_ZOOM_MIN;
  $("zoomInBtn").disabled = zoom >= CANVAS_ZOOM_MAX;
}

function selectedNode() {
  return state.plan?.nodes?.find((node) => node.id === state.selectedNodeId);
}

function renderInspector() {
  const inspector = $("inspector");
  const node = selectedNode();
  $("selectedNodeHint").textContent = node ? `${node.id} · ${statusLabel(nodeState(node.id))}` : "选择一个节点开始编辑。";
  $("deleteNodeBtn").disabled = !node;
  if (!node) {
    inspector.className = "inspector empty";
    inspector.innerHTML = '<div class="empty-copy">节点任务、必用 skill、依赖、推理强度和验收标准都可以在这里直接改。</div>';
    return;
  }
  inspector.className = "inspector";
  const nodeModel = effectiveNodeModel(node);
  const nodeEffort = coerceEffort(currentToolProvider(), nodeModel, node.reasoningEffort || state.config?.models?.reasoningEffort || "medium");
  node.reasoningEffort = nodeEffort;
  inspector.innerHTML = `
    ${field("标题", "title", node.title)}
    ${field("Agent", "agent", node.agent)}
    <div class="form-field">
      <label for="nodeMode">模式 / Mode</label>
      <select id="nodeMode">
        <option value="codex">Agent 执行 / Agent Execution</option>
        <option value="human-review">人工确认 / Human Review</option>
        <option value="auto-review">自动评审 / Auto Review</option>
        <option value="synthesis">结果汇总 / Synthesis</option>
      </select>
    </div>
    <div class="two-col">
      <div class="form-field">
        <label for="nodeReasoning">推理强度</label>
        <select id="nodeReasoning" ${effortSelectDisabledAttr(currentToolProvider(), nodeModel)} title="${escapeAttr(effortHelpText(currentToolProvider(), nodeModel))}">
          ${effortOptionsMarkup({ provider: currentToolProvider(), model: nodeModel, value: nodeEffort })}
        </select>
      </div>
      <div class="form-field">
        <label for="nodeSandbox">沙箱</label>
        <select id="nodeSandbox">
          <option value="read-only">read-only</option>
          <option value="workspace-write">workspace-write</option>
        </select>
      </div>
    </div>
    <div class="form-field">
      <label for="nodeNetworkPolicy">联网策略</label>
      <select id="nodeNetworkPolicy">
        <option value="confirm">需要联网时找用户确认</option>
        <option value="full-access">完全联网（高权限）</option>
      </select>
    </div>
    ${outputRequirementMarkup(node)}
    ${reviewPolicyMarkup(node)}
    <div class="form-field">
      <label for="model">模型</label>
      <select id="model">${modelOptionsMarkup(node.model || "")}</select>
    </div>
    ${textarea("任务", "task", node.task)}
    <div class="form-field">
      <label id="nodeSkillsLabel">必用 Skills</label>
      ${skillPickerMarkup(node)}
    </div>
    <label class="check-row"><input id="requiresReview" type="checkbox" /><span>执行到此节点时等待人工确认</span></label>
    <div class="form-field">
      <label>依赖节点</label>
      <div id="dependencyList" class="dependency-list"></div>
    </div>
    <div class="form-field">
      <label>验收标准</label>
      <div id="acceptanceList" class="acceptance-list"></div>
      <button id="addAcceptanceBtn" class="mini-button" type="button">${icons.plus}<span>添加标准</span></button>
    </div>
  `;

  bindInput("title", (value) => {
    node.title = value;
    markPlanDirty("plan:node-title");
    renderAll();
  });
  bindInput("agent", (value) => {
    node.agent = value;
    markPlanDirty("plan:node-agent");
    renderCanvas();
  });
  $("model").addEventListener("change", (event) => {
    const value = event.target.value;
    node.model = value;
    node.reasoningEffort = coerceEffort(currentToolProvider(), effectiveNodeModel(node), node.reasoningEffort || state.config?.models?.reasoningEffort || "medium");
    markPlanDirty("plan:node-model");
    renderAll();
  });
  bindInput("task", (value) => {
    node.task = value;
    markPlanDirty("plan:node-task");
    renderCanvas();
  });
  $("nodeMode").value = node.mode;
  $("nodeMode").addEventListener("change", (event) => {
    node.mode = event.target.value;
    node.requiresReview = node.mode === "human-review" ? true : node.requiresReview;
    if (node.mode === "synthesis") {
      ensureOutputRequirement(node);
      if ((node.sandbox || "workspace-write") === "read-only") node.sandbox = "workspace-write";
    }
    if (node.mode === "auto-review") {
      ensureReviewPolicy(node);
      node.requiresReview = false;
      node.sandbox = "read-only";
    }
    markPlanDirty("plan:node-mode");
    renderAll();
  });
  $("nodeReasoning").value = node.reasoningEffort || "";
  $("nodeReasoning").addEventListener("change", (event) => {
    node.reasoningEffort = event.target.value;
    markPlanDirty("plan:node-reasoning");
    renderCanvas();
  });
  $("nodeSandbox").value = node.sandbox || "workspace-write";
  $("nodeSandbox").addEventListener("change", (event) => {
    node.sandbox = event.target.value;
    markPlanDirty("plan:node-sandbox");
    renderCanvas();
  });
  $("nodeNetworkPolicy").value = node.networkPolicy || "confirm";
  $("nodeNetworkPolicy").addEventListener("change", (event) => {
    node.networkPolicy = event.target.value;
    markPlanDirty("plan:node-network-policy");
    renderCanvas();
  });
  $("requiresReview").checked = Boolean(node.requiresReview);
  $("requiresReview").addEventListener("change", (event) => {
    node.requiresReview = event.target.checked;
    markPlanDirty("plan:node-review");
  });
  bindOutputRequirement(node);
  bindReviewPolicy(node);
  bindSkillPicker(node);
  renderDependencies(node);
  renderAcceptance(node);
}

function field(label, id, value, placeholder = "") {
  return `<div class="form-field"><label for="${id}">${label}</label><input id="${id}" value="${escapeAttr(value)}" placeholder="${escapeAttr(placeholder)}" /></div>`;
}

function modelOptionsMarkup(value) {
  const options = providerModelRows(currentToolProvider(), { includeDefault: true, current: value });
  return options.map(([model, label]) => `<option value="${escapeAttr(model)}" ${model === value ? "selected" : ""}>${escapeHtml(label)}</option>`).join("");
}

function outputRequirementMarkup(node) {
  if (node.mode !== "synthesis") return "";
  const requirement = ensureOutputRequirement(node);
  const placeholder = outputRequirementGuidance(requirement.type);
  return `
    <div class="form-field output-requirement">
      <label for="outputRequirementType">输出物要求</label>
      <select id="outputRequirementType">
        ${outputRequirementOptionsMarkup(requirement.type)}
      </select>
      <textarea id="outputRequirementCustom" placeholder="${escapeAttr(placeholder)}">${escapeHtml(requirement.custom)}</textarea>
    </div>
  `;
}

function outputRequirementOptionsMarkup(value) {
  return OUTPUT_REQUIREMENT_OPTIONS
    .map(([type, label]) => `<option value="${escapeAttr(type)}" ${type === value ? "selected" : ""}>${escapeHtml(label)}</option>`)
    .join("");
}

function bindOutputRequirement(node) {
  const typeSelect = $("outputRequirementType");
  const customInput = $("outputRequirementCustom");
  if (!typeSelect || !customInput) return;
  const requirement = ensureOutputRequirement(node);
  typeSelect.value = requirement.type;
  typeSelect.addEventListener("change", (event) => {
    const previousRequirement = ensureOutputRequirement(node);
    const nextType = normalizeOutputRequirement(event.target.value).type;
    const nextCustom = customForOutputRequirementTypeChange(previousRequirement, nextType);
    node.outputRequirement = {
      ...previousRequirement,
      type: nextType,
      custom: nextCustom
    };
    customInput.value = nextCustom;
    customInput.placeholder = outputRequirementGuidance(nextType);
    if (node.outputRequirement.type !== "markdown" && (node.sandbox || "workspace-write") === "read-only") {
      node.sandbox = "workspace-write";
      if ($("nodeSandbox")) $("nodeSandbox").value = node.sandbox;
      renderCanvas();
    }
    markPlanDirty("plan:node-output-requirement");
  });
  customInput.addEventListener("input", (event) => {
    node.outputRequirement = {
      ...ensureOutputRequirement(node),
      custom: event.target.value.slice(0, 600)
    };
    markPlanDirty("plan:node-output-requirement");
  });
}

function reviewPolicyMarkup(node) {
  if (node.mode !== "auto-review") return "";
  const policy = ensureReviewPolicy(node);
  return `
    <div class="form-field review-policy">
      <label for="reviewMaxIterations">自动评审策略</label>
      <div class="two-col">
        <div class="form-field">
          <label for="reviewMaxIterations">最大迭代次数</label>
          <input id="reviewMaxIterations" type="number" min="1" max="10" value="${escapeAttr(policy.maxIterations)}" />
        </div>
        <label class="check-row review-policy-check">
          <input id="reviewContinueOnLimit" type="checkbox" ${policy.continueOnLimit ? "checked" : ""} />
          <span>达到上限后继续推进</span>
        </label>
      </div>
      <div class="form-field">
        <label>返工目标节点</label>
        <div id="reviewTargetList" class="dependency-list"></div>
      </div>
      <div class="form-field">
        <label for="reviewCriteria">评审标准</label>
        <textarea id="reviewCriteria" placeholder="描述这个自动评审节点如何判断是否需要打回上游节点。">${escapeHtml(policy.criteria)}</textarea>
      </div>
    </div>
  `;
}

function bindReviewPolicy(node) {
  if (node.mode !== "auto-review") return;
  const maxInput = $("reviewMaxIterations");
  const continueInput = $("reviewContinueOnLimit");
  const criteriaInput = $("reviewCriteria");
  if (!maxInput || !continueInput || !criteriaInput) return;
  ensureReviewPolicy(node);
  maxInput.addEventListener("input", (event) => {
    node.reviewPolicy.maxIterations = Math.min(Math.max(Number.parseInt(event.target.value, 10) || 3, 1), 10);
    markPlanDirty("plan:review-policy");
  });
  continueInput.addEventListener("change", (event) => {
    node.reviewPolicy.continueOnLimit = event.target.checked;
    markPlanDirty("plan:review-policy");
  });
  criteriaInput.addEventListener("input", (event) => {
    node.reviewPolicy.criteria = event.target.value.slice(0, 1000);
    markPlanDirty("plan:review-policy");
  });
  renderReviewTargets(node);
}

function renderReviewTargets(node) {
  const box = $("reviewTargetList");
  if (!box) return;
  box.innerHTML = "";
  const policy = ensureReviewPolicy(node);
  const selected = new Set(policy.targetNodeIds || []);
  const candidates = reviewTargetCandidates(node);
  if (!candidates.length) {
    box.innerHTML = '<div class="empty-copy">请先为自动评审节点配置上游依赖。</div>';
    return;
  }
  for (const candidate of candidates) {
    const label = document.createElement("label");
    label.className = "check-row";
    label.innerHTML = `<input type="checkbox" /><span></span>`;
    label.querySelector("span").textContent = candidate.title;
    const input = label.querySelector("input");
    input.checked = selected.has(candidate.id);
    input.addEventListener("change", () => {
      const next = new Set(node.reviewPolicy.targetNodeIds || []);
      if (input.checked) next.add(candidate.id);
      else next.delete(candidate.id);
      node.reviewPolicy.targetNodeIds = [...next].slice(0, 6);
      markPlanDirty("plan:review-targets");
    });
    box.appendChild(label);
  }
}

function reviewTargetCandidates(node) {
  const nodes = state.plan?.nodes || [];
  const byId = new Map(nodes.map((item) => [item.id, item]));
  const visited = new Set();
  const visit = (nodeId) => {
    const current = byId.get(nodeId);
    if (!current) return;
    for (const depId of current.dependsOn || []) {
      if (visited.has(depId)) continue;
      visited.add(depId);
      visit(depId);
    }
  };
  visit(node.id);
  return nodes.filter((item) => visited.has(item.id) && !["human-review", "auto-review"].includes(item.mode));
}

function skillPickerMarkup(node) {
  const selected = new Set(node.skills || []);
  const options = skillOptionsForNode(node);
  const rows = options.length
    ? options.map((skill) => `
      <label class="skill-option">
        <input data-skill-option type="checkbox" value="${escapeAttr(skill.name)}" ${selected.has(skill.name) ? "checked" : ""} />
        <span class="skill-option-copy">
          <strong>${escapeHtml(skill.name)}</strong>
          <span>${escapeHtml(skill.description || skill.path || "暂无简介")}</span>
        </span>
      </label>
    `).join("")
    : `<div class="skill-option empty">没有发现本地 skills，仍可直接调用 ${escapeHtml(toolLabel(currentToolProvider()))}。</div>`;

  return `
    <details id="skillPicker" class="skill-picker">
      <summary aria-labelledby="nodeSkillsLabel">
        <span id="skillPickerSummary">${escapeHtml(skillSummary(node))}</span>
      </summary>
      <div class="skill-menu" role="listbox" aria-labelledby="nodeSkillsLabel">
        ${rows}
      </div>
    </details>
  `;
}

function skillOptionsForNode(node) {
  const byName = new Map();
  for (const skill of state.skills) {
    byName.set(skill.name, {
      name: skill.name,
      description: shortDescription(skill.description || skill.path || "")
    });
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function bindSkillPicker(node) {
  const picker = $("skillPicker");
  if (!picker) return;
  for (const checkbox of picker.querySelectorAll("[data-skill-option]")) {
    checkbox.addEventListener("change", () => {
      const selected = new Set(node.skills || []);
      if (checkbox.checked) selected.add(checkbox.value);
      else selected.delete(checkbox.value);
      node.skills = [...selected].sort((a, b) => a.localeCompare(b));
      markPlanDirty("plan:node-skills");
      updateSkillPickerSummary(node);
      renderCanvas();
      renderSkills();
    });
  }
}

function updateSkillPickerSummary(node) {
  const summary = $("skillPickerSummary");
  if (summary) summary.textContent = skillSummary(node);
}

function skillSummary(node) {
  const skills = node.skills || [];
  if (!skills.length) return "未选择 skill";
  if (skills.length <= 2) return skills.join(", ");
  return `${skills.slice(0, 2).join(", ")} +${skills.length - 2}`;
}

function networkPolicyLabel(policy) {
  return policy === "full-access" ? "全联网" : "需确认";
}

function networkPolicyTitle(policy) {
  return policy === "full-access"
    ? "该节点会以高权限联网模式运行，可使用 curl、defuddle 和下载类命令。"
    : "该节点需要联网时会先暂停并请求用户确认。";
}

function sanitizeUnavailablePlanSkills(plan = state.plan) {
  if (!plan?.nodes?.length || !state.skills.length) return false;
  const available = new Set(state.skills.map((skill) => skill.name));
  let changed = false;
  for (const node of plan.nodes) {
    const next = (node.skills || []).filter((skill) => available.has(skill));
    if (next.length !== (node.skills || []).length) {
      node.skills = next;
      changed = true;
    }
  }
  return changed;
}

function shortDescription(value) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text || text === "|" || text === ">") return "本地 skill，可作为该节点的专业能力调用。";
  return text.length > 120 ? `${text.slice(0, 117)}...` : text;
}

function textarea(label, id, value) {
  return `<div class="form-field"><label for="${id}">${label}</label><textarea id="${id}">${escapeHtml(value)}</textarea></div>`;
}

function bindInput(id, onChange) {
  $(id).addEventListener("input", (event) => onChange(event.target.value));
}

function renderDependencies(node) {
  const box = $("dependencyList");
  box.innerHTML = "";
  for (const candidate of state.plan.nodes.filter((item) => item.id !== node.id)) {
    const label = document.createElement("label");
    label.className = "check-row";
    label.innerHTML = `<input type="checkbox" /><span></span>`;
    label.querySelector("span").textContent = candidate.title;
    const input = label.querySelector("input");
    input.checked = (node.dependsOn || []).includes(candidate.id);
    input.addEventListener("change", () => {
      const deps = new Set(node.dependsOn || []);
      if (input.checked) deps.add(candidate.id);
      else deps.delete(candidate.id);
      node.dependsOn = [...deps];
      if (node.mode === "auto-review") ensureReviewPolicy(node);
      syncEdgesFromDependencies();
      markPlanDirty("plan:dependencies");
      renderInspector();
      renderEdges();
      renderRun();
    });
    box.appendChild(label);
  }
}

function renderAcceptance(node) {
  const box = $("acceptanceList");
  box.innerHTML = "";
  node.acceptance = node.acceptance?.length ? node.acceptance : ["结果可验证且有清晰输出。"];
  node.acceptance.forEach((item, index) => {
    const row = document.createElement("div");
    row.className = "acceptance-row";
    row.innerHTML = `<input value="${escapeAttr(item)}" /><button class="icon-button danger" type="button" title="删除" aria-label="删除">${icons.trash}</button>`;
    row.querySelector("input").addEventListener("input", (event) => {
      node.acceptance[index] = event.target.value;
      markPlanDirty("plan:acceptance");
    });
    row.querySelector("button").addEventListener("click", () => {
      node.acceptance.splice(index, 1);
      markPlanDirty("plan:acceptance");
      renderInspector();
    });
    box.appendChild(row);
  });
  $("addAcceptanceBtn").addEventListener("click", () => {
    node.acceptance.push("新增验收标准。");
    markPlanDirty("plan:acceptance");
    renderInspector();
  });
}

function renderSkills() {
  const box = $("skillsList");
  if (!box) return;
  box.innerHTML = "";
  const node = selectedNode();
  const selected = new Set(node?.skills || []);
  for (const skill of state.skills.slice(0, 80)) {
    const chip = document.createElement("button");
    chip.className = `skill-chip ${selected.has(skill.name) ? "selected" : ""}`;
    chip.type = "button";
    chip.textContent = skill.name;
    chip.title = skill.description || skill.path || "";
    chip.addEventListener("click", () => {
      if (!node) return;
      const next = new Set(node.skills || []);
      if (next.has(skill.name)) next.delete(skill.name);
      else next.add(skill.name);
      node.skills = [...next];
      markPlanDirty("plan:node-skills");
      renderAll();
    });
    box.appendChild(chip);
  }
  if (!state.skills.length) {
    box.innerHTML = `<div class="empty-copy">没有发现本地 skills，仍可直接调用 ${escapeHtml(toolLabel(currentToolProvider()))}。</div>`;
  }
}

function addNode() {
  if (!state.plan) return;
  const id = uniqueNodeId("custom-node");
  const source = selectedNode();
  const directChildren = source
    ? state.plan.nodes.filter((item) => (item.dependsOn || []).includes(source.id))
    : [];
  if (source && directChildren.length) shiftNodes([...collectDescendantIds(directChildren.map((item) => item.id))], INSERT_NODE_GAP);
  const node = {
    id,
    title: "新节点",
    agent: `${toolLabel(currentToolProvider())} Worker`,
    task: "描述这个节点要完成的具体任务。",
    skills: [],
    dependsOn: source ? [source.id] : [],
    acceptance: ["节点输出清晰可验证。"],
    mode: "codex",
    requiresReview: false,
    model: "",
    reasoningEffort: coerceEffort(currentToolProvider(), selectedExecutorModel(), $("effortInput").value || state.config?.models?.reasoningEffort || "medium"),
    sandbox: "workspace-write",
    networkPolicy: "confirm",
    reviewPolicy: defaultReviewPolicy(),
    x: source ? (source.x || 0) + INSERT_NODE_GAP : 120 + state.plan.nodes.length * 80,
    y: source ? (source.y || 0) : 120 + state.plan.nodes.length * 40
  };
  for (const child of directChildren) {
    child.dependsOn = (child.dependsOn || []).map((depId) => depId === source.id ? id : depId);
  }
  state.plan.nodes.push(node);
  setNodeSelection([id], id);
  syncEdgesFromDependencies();
  markPlanDirty(directChildren.length ? "plan:insert-node" : "plan:add-node");
  renderAll();
}

function deleteNode() {
  const node = selectedNode();
  if (!node || !state.plan) return;
  state.plan.nodes = state.plan.nodes.filter((item) => item.id !== node.id);
  for (const item of state.plan.nodes) {
    item.dependsOn = (item.dependsOn || []).filter((id) => id !== node.id);
  }
  syncEdgesFromDependencies();
  setNodeSelection(state.plan.nodes[0]?.id ? [state.plan.nodes[0].id] : [], state.plan.nodes[0]?.id || "");
  markPlanDirty("plan:delete-node");
  renderAll();
}

function collectDescendantIds(startIds) {
  const descendants = new Set(startIds);
  let changed = true;
  while (changed) {
    changed = false;
    for (const node of state.plan?.nodes || []) {
      if (descendants.has(node.id)) continue;
      if ((node.dependsOn || []).some((depId) => descendants.has(depId))) {
        descendants.add(node.id);
        changed = true;
      }
    }
  }
  return descendants;
}

function shiftNodes(nodeIds, dx, dy = 0) {
  const ids = new Set(nodeIds);
  for (const node of state.plan?.nodes || []) {
    if (!ids.has(node.id)) continue;
    node.x = (node.x || 0) + dx;
    node.y = (node.y || 0) + dy;
  }
}

function autoLayout(shouldRender = true) {
  if (!state.plan) return;
  const scrollerWidth = (($("canvasScroller")?.clientWidth || window.innerWidth || 1000) / (state.canvasZoom || 1));
  const levels = new Map();
  const byId = new Map(state.plan.nodes.map((node) => [node.id, node]));
  const visit = (node) => {
    if (!node || levels.has(node.id)) return levels.get(node?.id) || 0;
    const deps = (node.dependsOn || []).map((id) => byId.get(id)).filter(Boolean);
    const level = deps.length ? Math.max(...deps.map(visit)) + 1 : 0;
    levels.set(node.id, level);
    return level;
  };
  for (const node of state.plan.nodes) visit(node);
  const grouped = new Map();
  for (const node of state.plan.nodes) {
    const level = levels.get(node.id) || 0;
    grouped.set(level, [...(grouped.get(level) || []), node]);
  }

  const maxLevel = Math.max(0, ...grouped.keys());
  const shouldStack = scrollerWidth < 820;
  if (shouldStack) {
    state.plan.nodes.forEach((node, index) => {
      node.x = Math.max(24, Math.round((scrollerWidth - FLOW_NODE_WIDTH) / 2));
      node.y = 36 + index * 150;
    });
    markPlanDirty("plan:auto-layout");
    if (shouldRender) renderAll();
    return;
  }

  const available = Math.max(520, scrollerWidth - FLOW_CANVAS_PADDING * 2);
  const columnGap = maxLevel > 0
    ? Math.max(300, Math.min(420, Math.floor((available - FLOW_NODE_WIDTH) / maxLevel)))
    : 0;
  const rowGap = scrollerWidth < 1080 ? 190 : 220;

  for (const [level, nodes] of grouped) {
    nodes.forEach((node, index) => {
      node.x = FLOW_CANVAS_PADDING + level * columnGap;
      node.y = FLOW_CANVAS_PADDING + index * rowGap;
    });
  }
  markPlanDirty("plan:auto-layout");
  if (shouldRender) renderAll();
}

function exportPlan() {
  if (!state.plan) return;
  const text = JSON.stringify(state.plan, null, 2);
  navigator.clipboard?.writeText(text).catch(() => {});
  state.logs.push(`[plan]\n${text}`);
  trimLogs();
  renderRun();
  showNotice("JSON 已写入日志；浏览器允许时也会复制到剪贴板。");
}

function markPlanDirty(reason = "plan:edited") {
  if (!state.plan) return;
  recordUndoState();
  scheduleSessionPlanSave(reason);
}

function resetPlanHistory() {
  state.undoStack = [];
  state.lastHistoryState = capturePlanHistoryState();
  renderUndoControls();
}

function capturePlanHistoryState() {
  if (!state.plan) return null;
  return {
    plan: JSON.parse(JSON.stringify(state.plan)),
    selectedNodeId: state.selectedNodeId,
    selectedNodeIds: [...(state.selectedNodeIds || [])]
  };
}

function historyKey(snapshot) {
  return JSON.stringify(snapshot?.plan || null);
}

function recordUndoState() {
  const current = capturePlanHistoryState();
  if (!current) return;
  if (!state.lastHistoryState) {
    state.lastHistoryState = current;
    renderUndoControls();
    return;
  }
  if (historyKey(state.lastHistoryState) !== historyKey(current)) {
    state.undoStack.push(state.lastHistoryState);
    if (state.undoStack.length > MAX_UNDO_STEPS) state.undoStack.shift();
    state.lastHistoryState = current;
  } else {
    state.lastHistoryState = current;
  }
  renderUndoControls();
}

function undoPlanChange() {
  const previous = state.undoStack.pop();
  if (!previous) return;
  state.plan = JSON.parse(JSON.stringify(previous.plan));
  const validIds = new Set(state.plan.nodes.map((node) => node.id));
  const selected = (previous.selectedNodeIds || []).filter((id) => validIds.has(id));
  setNodeSelection(selected, validIds.has(previous.selectedNodeId) ? previous.selectedNodeId : selected.at(-1) || "");
  state.lastHistoryState = capturePlanHistoryState();
  syncEdgesFromDependencies();
  scheduleSessionPlanSave("plan:undo");
  showNotice("已撤回上一步编排修改。");
  renderAll();
}

function renderUndoControls() {
  const button = $("undoBtn");
  if (!button) return;
  button.disabled = !state.plan || state.undoStack.length === 0;
}

function scheduleSessionPlanSave(reason = "plan:edited") {
  if (!state.session?.id || !state.plan) {
    renderUndoControls();
    return;
  }
  state.sessionSaveStatus = "待保存";
  renderSessionMeta();
  if (state.sessionSaveTimer) clearTimeout(state.sessionSaveTimer);
  state.sessionSaveTimer = setTimeout(() => {
    saveSessionPlan(reason).catch((error) => {
      state.sessionSaveStatus = `保存失败：${error.message}`;
      renderSessionMeta();
    });
  }, 650);
}

async function saveSessionPlan(reason = "plan:edited") {
  if (!state.session?.id || !state.plan) return;
  if (state.sessionSaveTimer) {
    clearTimeout(state.sessionSaveTimer);
    state.sessionSaveTimer = null;
  }
  state.sessionSaveStatus = "保存中";
  renderSessionMeta();
  syncEdgesFromDependencies();
  const data = await api(`/api/sessions/${state.session.id}/plan`, {
    method: "PUT",
    body: JSON.stringify({ plan: state.plan, reason })
  });
  state.session = data.session || state.session;
  state.sessionSaveStatus = "已保存";
  renderSessionMeta();
}

function syncEdgesFromDependencies() {
  if (!state.plan) return;
  const seen = new Set();
  state.plan.edges = state.plan.nodes
    .flatMap((node) => (node.dependsOn || []).map((from) => ({ from, to: node.id, label: "" })))
    .filter((edge) => {
      const key = `${edge.from}->${edge.to}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function uniqueNodeId(base) {
  const ids = new Set(state.plan?.nodes?.map((node) => node.id) || []);
  let id = base;
  let index = 2;
  while (ids.has(id)) {
    id = `${base}-${index}`;
    index += 1;
  }
  return id;
}

async function startRun() {
  if (!state.plan) return;
  setBusy($("runBtn"), true, `${icons.refresh}<span>启动中</span>`);
  state.logs = [];
  state.nodeActivity = {};
  state.reviewDialog = null;
  state.reviewDismissedNodeIds = new Set();
  state.reviewManifest = null;
  state.reviewManifestSessionId = "";
  state.reviewManifestError = "";
  try {
    syncEdgesFromDependencies();
    await saveSessionPlan("run:plan-snapshot");
    const data = await api("/api/runs", {
      method: "POST",
      body: JSON.stringify({ goal: $("goalInput").value.trim(), plan: state.plan, sessionId: state.session?.id || "", toolProvider: currentToolProvider() })
    });
    state.session = data.session || state.session;
    state.run = data;
    connectRunEvents(data.id);
    renderAll();
  } catch (error) {
    state.logs.push(`[error] ${error.message}`);
    renderRun();
  } finally {
    setBusy($("runBtn"), false, `${icons.play}<span>确认执行</span>`);
  }
}

function connectRunEvents(runId) {
  if (state.eventSource) state.eventSource.close();
  state.eventSource = new EventSource(`/api/runs/${runId}/events`);
  const handle = (event) => {
    const data = JSON.parse(event.data);
    if (event.type === "snapshot") {
      state.run = data;
      hydrateRunActivity(data);
      syncWaitingReviewDialog();
    } else if (event.type === "node:log") {
      appendLog(data.nodeId, data.stream, data.text);
      recordRunActivity(event.type, data);
    } else {
      if (event.type === "run:finished") {
        state.run = data;
        state.eventSource?.close();
        state.eventSource = null;
      } else if (data?.nodes) {
        state.run = data;
      } else if (state.run) {
        patchRunFromEvent(event.type, data);
      }
      recordRunActivity(event.type, data);
      syncReviewDialogFromEvent(event.type, data);
      state.logs.push(`[${event.type}] ${formatEvent(data)}`);
    }
    trimLogs();
    renderAll();
  };
  for (const name of ["snapshot", "run:started", "run:error", "run:finished", "run:cancelled", "node:started", "node:waiting", "node:log", "node:iteration", "node:completed", "node:failed", "node:cancelled"]) {
    state.eventSource.addEventListener(name, handle);
  }
  state.eventSource.onerror = () => {
    state.logs.push("[sse] 连接中断，刷新运行快照。");
    refreshRun(runId);
  };
}

function appendLog(nodeId, stream, text) {
  const clean = String(text || "").replace(/\r/g, "").slice(0, 3000);
  if (!clean.trim()) return;
  state.logs.push(`[${nodeId}] ${stream}: ${clean}`);
}

function appendPlanLog(text) {
  const clean = String(text || "").replace(/\r/g, "").slice(0, 3000);
  if (!clean.trim()) return;
  state.logs.push(`[plan] ${clean}`);
  trimLogs();
  renderRun();
}

function hydrateRunActivity(run) {
  state.nodeActivity = {};
  for (const event of run?.events || []) {
    recordRunActivity(event.name, event.data);
  }
  for (const [nodeId, node] of Object.entries(run?.nodes || {})) {
    if (node.status === "running" && !state.nodeActivity[nodeId]?.length) {
      recordNodeActivity(nodeId, "正在执行节点任务", "running");
    }
    if (node.status === "waiting" && !state.nodeActivity[nodeId]?.length) {
      recordNodeActivity(nodeId, node.waitingReason === "network" ? "等待允许联网后继续" : "等待人工确认后继续", "waiting");
    }
  }
}

function recordRunActivity(type, data) {
  const nodeId = data?.nodeId;
  if (!nodeId) return;
  const node = findPlanNode(nodeId);
  if (type === "node:started") {
    recordNodeActivity(nodeId, data?.reason === "network-approved" ? "已允许联网，继续执行节点" : `开始执行：${node?.title || nodeId}`, "running");
  } else if (type === "node:waiting") {
    recordNodeActivity(nodeId, data?.reason === "network" ? "请求联网权限，等待确认" : "等待人工确认后继续", "waiting");
  } else if (type === "node:log") {
    const summary = summarizeActivityLog(data.text, data.stream);
    if (summary) recordNodeActivity(nodeId, summary, "running");
  } else if (type === "node:iteration") {
    const text = `发现改进项，打回 ${data.targetNodeIds?.join(", ") || "上游节点"}，第 ${data.iteration}/${data.maxIterations} 轮`;
    recordNodeActivity(nodeId, text, "waiting");
    for (const targetId of data.targetNodeIds || []) {
      recordNodeActivity(targetId, `收到自动评审返工指令，第 ${data.iteration}/${data.maxIterations} 轮`, "running");
    }
  } else if (type === "node:completed") {
    recordNodeActivity(nodeId, "完成，结果已写入节点输出", "completed");
  } else if (type === "node:failed") {
    recordNodeActivity(nodeId, `失败：${compactActivityText(data.error || "请查看日志", 72)}`, "failed");
  } else if (type === "node:cancelled") {
    recordNodeActivity(nodeId, "已停止执行", "waiting");
  }
}

function syncReviewDialogFromEvent(type, data) {
  if (type === "node:waiting" && data?.nodeId) {
    const currentNote = state.reviewDialog?.nodeId === data.nodeId ? state.reviewDialog.note : "";
    state.reviewDismissedNodeIds.delete(data.nodeId);
    state.reviewDialog = { nodeId: data.nodeId, note: currentNote || "" };
  }
  if (["node:completed", "node:failed", "node:cancelled"].includes(type) && state.reviewDialog?.nodeId === data?.nodeId) {
    state.reviewDialog = null;
  }
  if (["run:finished", "run:cancelled", "run:error"].includes(type)) {
    state.reviewDialog = null;
  }
}

function syncWaitingReviewDialog() {
  const waitingNode = (state.plan?.nodes || state.run?.plan?.nodes || [])
    .find((node) => nodeState(node.id) === "waiting" && !state.reviewDismissedNodeIds.has(node.id));
  if (!waitingNode) return;
  if (state.reviewDialog?.nodeId === waitingNode.id) return;
  state.reviewDialog = { nodeId: waitingNode.id, note: "" };
}

function recordNodeActivity(nodeId, text, tone = "info") {
  const clean = compactActivityText(text, 86);
  if (!nodeId || !clean) return;
  const entries = state.nodeActivity[nodeId] || [];
  const last = entries.at(-1);
  if (last?.text === clean && last?.tone === tone) return;
  entries.push({
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    text: clean,
    tone,
    at: Date.now()
  });
  state.nodeActivity[nodeId] = entries.slice(-3);
  state.pendingActivityFocusNodeId = nodeId;
}

function summarizeActivityLog(text, stream = "") {
  const clean = compactActivityText(text, 86);
  if (!clean) return "";
  const heartbeat = clean.match(/仍在执行\s*(.*?)，已运行\s*([0-9]+s)/);
  if (heartbeat) return `持续执行中，已运行 ${heartbeat[2]}`;
  if (/^codex\s*[:：-]/i.test(clean)) return clean.replace(/^codex\s*[:：-]\s*/i, "");
  if (stream === "status") return clean;
  return clean;
}

function compactActivityText(text, limit = 86) {
  const clean = String(text || "")
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  if (!clean) return "";
  return clean.length > limit ? `${clean.slice(0, limit - 1)}…` : clean;
}

function findPlanNode(nodeId) {
  return state.plan?.nodes?.find((node) => node.id === nodeId)
    || state.run?.plan?.nodes?.find((node) => node.id === nodeId)
    || null;
}

function renderNodeActivity(nodeId, placement = "bottom") {
  const entries = state.nodeActivity[nodeId] || [];
  if (!entries.length) return "";
  const bubble = typeof placement === "string"
    ? { name: placement, offsetX: 8, offsetY: FLOW_NODE_HEIGHT + ACTIVITY_BUBBLE_GAP }
    : placement;
  return `
    <div class="node-bubbles" data-placement="${escapeAttr(bubble.name || "bottom")}" style="--bubble-left:${Number(bubble.offsetX) || 0}px; --bubble-top:${Number(bubble.offsetY) || 0}px;" aria-live="polite">
      ${entries.map((entry) => `
        <div class="node-bubble ${entry.tone || "info"}">
          <span class="bubble-dot"></span>
          <span>${escapeHtml(entry.text)}</span>
        </div>
      `).join("")}
    </div>
  `;
}

function queueActivityVisibilityCheck() {
  const nodeId = state.pendingActivityFocusNodeId;
  if (!nodeId) return;
  state.pendingActivityFocusNodeId = "";
  requestAnimationFrame(() => ensureNodeActivityVisible(nodeId));
}

function ensureNodeActivityVisible(nodeId) {
  const scroller = $("canvasScroller");
  const nodeEl = [...document.querySelectorAll(".flow-node")].find((el) => el.dataset.nodeId === nodeId);
  const bubble = nodeEl?.querySelector(".node-bubbles");
  if (!scroller || !bubble) return;
  const scrollerRect = scroller.getBoundingClientRect();
  const bubbleRect = bubble.getBoundingClientRect();
  let dx = 0;
  let dy = 0;

  if (bubbleRect.left < scrollerRect.left + ACTIVITY_VIEW_MARGIN) {
    dx = bubbleRect.left - scrollerRect.left - ACTIVITY_VIEW_MARGIN;
  } else if (bubbleRect.right > scrollerRect.right - ACTIVITY_VIEW_MARGIN) {
    dx = bubbleRect.right - scrollerRect.right + ACTIVITY_VIEW_MARGIN;
  }

  if (bubbleRect.top < scrollerRect.top + ACTIVITY_VIEW_MARGIN) {
    dy = bubbleRect.top - scrollerRect.top - ACTIVITY_VIEW_MARGIN;
  } else if (bubbleRect.bottom > scrollerRect.bottom - ACTIVITY_VIEW_MARGIN) {
    dy = bubbleRect.bottom - scrollerRect.bottom + ACTIVITY_VIEW_MARGIN;
  }

  if (dx || dy) {
    scroller.scrollLeft += dx;
    scroller.scrollTop += dy;
  }
}

function patchRunFromEvent(type, data) {
  const nodeId = data?.nodeId;
  if (!nodeId || !state.run?.nodes?.[nodeId]) return;
  const node = state.run.nodes[nodeId];
  if (type === "node:started") {
    node.status = "running";
    node.waitingReason = "";
  }
  if (type === "node:waiting") {
    node.status = "waiting";
    node.waitingReason = data.reason || "human-review";
    node.output = data.output || node.output;
  }
  if (type === "node:completed") {
    node.status = "completed";
    node.waitingReason = "";
    node.output = data.output || node.output;
  }
  if (type === "node:iteration") {
    for (const affectedNodeId of data.affectedNodeIds || []) {
      const affected = state.run.nodes?.[affectedNodeId];
      if (!affected) continue;
      affected.status = "pending";
      affected.waitingReason = "";
      affected.error = "";
      if (affectedNodeId !== data.nodeId) affected.output = "";
    }
    const reviewNode = state.run.nodes?.[nodeId];
    if (reviewNode) {
      reviewNode.status = "pending";
      reviewNode.iterationCount = data.iteration;
      reviewNode.output = data.summary || reviewNode.output;
    }
  }
  if (type === "node:failed") {
    node.status = "failed";
    node.error = data.error || node.error;
  }
  if (type === "node:cancelled") node.status = "cancelled";
}

async function refreshRun(runId) {
  try {
    state.run = await api(`/api/runs/${runId}`);
    hydrateRunActivity(state.run);
    syncWaitingReviewDialog();
    renderAll();
  } catch {
    // The log line above is enough context for the user.
  }
}

function formatEvent(data) {
  if (!data) return "";
  if (data.nodeId) return `${data.nodeId}${data.error ? `: ${data.error}` : ""}`;
  if (data.status) return data.status;
  if (data.error) return data.error;
  return JSON.stringify(data).slice(0, 240);
}

function trimLogs() {
  if (state.logs.length > 500) state.logs.splice(0, state.logs.length - 500);
}

function renderRun() {
  const run = state.run;
  const runStatus = $("runStatus");
  if (run) {
    runStatus.className = `pill ${run.status === "completed" ? "ok" : run.status === "failed" ? "bad" : run.status === "cancelled" ? "warn" : "ok"}`;
    runStatus.textContent = statusLabel(run.status);
    $("runMeta").textContent = `${run.id} · ${run.startedAt || ""}`;
  } else {
    runStatus.className = "pill muted";
    runStatus.textContent = "未执行";
    $("runMeta").textContent = "等待确认。";
  }
  $("stopRunBtn").classList.toggle("hidden", !run || !["running", "waiting"].includes(run.status));
  renderArtifactQuickPanel();

  const timeline = $("runTimeline");
  timeline.innerHTML = "";
  for (const node of state.plan?.nodes || []) {
    const status = nodeState(node.id);
    const item = document.createElement("button");
    item.className = `timeline-item ${status}`;
    item.type = "button";
    item.innerHTML = `<span class="timeline-dot"></span><span class="timeline-label"></span>`;
    item.querySelector(".timeline-label").textContent = node.title;
    item.disabled = status !== "waiting";
    if (status === "waiting") {
      item.title = state.run?.nodes?.[node.id]?.waitingReason === "network" ? "点击确认联网权限" : "点击填写确认意见";
      item.addEventListener("click", () => openReviewDialog(node.id));
    }
    timeline.appendChild(item);
  }
  $("logOutput").textContent = state.logs.join("\n");
  $("logOutput").scrollTop = $("logOutput").scrollHeight;
}

async function continueNode(nodeId, note = "人工确认通过。") {
  if (!state.run) return;
  try {
    await api(`/api/runs/${state.run.id}/nodes/${nodeId}/continue`, {
      method: "POST",
      body: JSON.stringify({ note })
    });
  } catch (error) {
    state.logs.push(`[error] ${error.message}`);
    renderAll();
    throw error;
  }
}

function openReviewDialog(nodeId) {
  if (!state.run || nodeState(nodeId) !== "waiting") return;
  const currentNote = state.reviewDialog?.nodeId === nodeId ? state.reviewDialog.note : "";
  state.reviewDismissedNodeIds.delete(nodeId);
  state.reviewDialog = { nodeId, note: currentNote || "" };
  renderReviewDialog();
  requestAnimationFrame(() => $("reviewNoteInput")?.focus());
}

function closeReviewDialog() {
  if (state.reviewDialog?.nodeId) state.reviewDismissedNodeIds.add(state.reviewDialog.nodeId);
  state.reviewDialog = null;
  renderReviewDialog();
}

function renderReviewDialog() {
  const modal = $("reviewModal");
  if (!modal) return;
  const nodeId = state.reviewDialog?.nodeId || "";
  const node = findPlanNode(nodeId);
  const isWaiting = nodeId && node && nodeState(nodeId) === "waiting";
  const waitingReason = state.run?.nodes?.[nodeId]?.waitingReason || "human-review";
  modal.classList.toggle("hidden", !isWaiting);
  if (!isWaiting) return;

  $("reviewModalTitle").textContent = waitingReason === "network" ? "联网确认" : "人工确认";
  $("reviewNodeMeta").textContent = `${node.id} · ${node.title}`;
  $("reviewTask").textContent = waitingReason === "network"
    ? (state.run?.nodes?.[nodeId]?.output || "该节点请求联网权限，请确认是否允许继续。")
    : (node.task || "请确认该节点结果是否可以继续。");
  $("submitReviewBtn").textContent = waitingReason === "network" ? "允许联网并继续" : "确认并继续";
  renderReviewUpstream(node);
  ensureReviewManifestLoaded();
  renderReviewArtifacts();
  if ($("reviewNoteInput").value !== (state.reviewDialog.note || "")) {
    $("reviewNoteInput").value = state.reviewDialog.note || "";
  }
}

function renderReviewUpstream(node) {
  const list = $("reviewUpstreamList");
  if (!list) return;
  const upstreamNodes = getReviewUpstreamNodes(node);
  list.innerHTML = "";
  if (!upstreamNodes.length) {
    const empty = document.createElement("div");
    empty.className = "review-empty";
    empty.textContent = "当前确认节点没有可展示的上游输出。";
    list.appendChild(empty);
    return;
  }

  for (const upstream of upstreamNodes) {
    const runNode = state.run?.nodes?.[upstream.id] || {};
    const status = runNode.status || nodeState(upstream.id);
    const output = compactReviewOutput(runNode.output || runNode.error || "");
    const card = document.createElement("article");
    card.className = "review-upstream-card";
    card.innerHTML = `
      <div class="review-upstream-head">
        <div>
          <div class="review-upstream-title"></div>
          <div class="review-upstream-meta"></div>
        </div>
        <span class="node-status ${escapeAttr(status)}">${escapeHtml(statusLabel(status))}</span>
      </div>
      <pre class="review-upstream-output"></pre>
    `;
    card.querySelector(".review-upstream-title").textContent = upstream.title || upstream.id;
    card.querySelector(".review-upstream-meta").textContent = `${upstream.id} · ${upstream.agent || "agent"} · ${modeDisplayLabel(upstream.mode || "codex")}`;
    card.querySelector(".review-upstream-output").textContent = output || "该节点尚未返回可展示输出。";
    list.appendChild(card);
  }
}

function getReviewUpstreamNodes(node) {
  const nodes = state.run?.plan?.nodes || state.plan?.nodes || [];
  const byId = new Map(nodes.map((item) => [item.id, item]));
  const visited = new Set();
  const visit = (nodeId) => {
    if (!nodeId || visited.has(nodeId)) return;
    const upstream = byId.get(nodeId);
    if (!upstream) return;
    for (const depId of upstream.dependsOn || []) visit(depId);
    visited.add(nodeId);
  };
  for (const depId of node.dependsOn || []) visit(depId);

  let upstreamNodes = nodes.filter((item) => visited.has(item.id));
  if (!upstreamNodes.length) {
    const currentIndex = nodes.findIndex((item) => item.id === node.id);
    upstreamNodes = nodes
      .slice(0, currentIndex < 0 ? 0 : currentIndex)
      .filter((item) => ["completed", "failed", "cancelled"].includes(nodeState(item.id)));
  }
  return upstreamNodes.filter((item) => item.id !== node.id);
}

function ensureArtifactManifestLoaded() {
  const sessionId = state.run?.sessionId || state.session?.id || "";
  if (!sessionId || state.reviewManifestSessionId === sessionId) return;
  state.reviewManifestSessionId = sessionId;
  state.reviewManifest = null;
  state.reviewManifestError = "";
  api(`/api/sessions/${encodeURIComponent(sessionId)}/artifacts`)
    .then((data) => {
      if (state.reviewManifestSessionId !== sessionId) return;
      state.reviewManifest = data.manifest || null;
      state.reviewManifestError = "";
      renderReviewArtifacts();
      renderArtifactQuickPanel();
    })
    .catch((error) => {
      if (state.reviewManifestSessionId !== sessionId) return;
      state.reviewManifest = null;
      state.reviewManifestError = /not found/i.test(error.message || "")
        ? "产物清单接口需要服务重启后生效；当前仍可查看上方节点输出和产物目录。"
        : error.message || "产物清单读取失败。";
      renderReviewArtifacts();
      renderArtifactQuickPanel();
    });
}

function ensureReviewManifestLoaded() {
  ensureArtifactManifestLoaded();
}

function renderArtifactQuickPanel() {
  const panel = $("artifactQuickPanel");
  if (!panel) return;
  const paths = state.run?.paths || state.session?.paths || {};
  const rows = [
    { label: "过程产物", path: paths.runDir || paths.sessionDir },
    { label: "结果产物", path: paths.artifactDir },
    { label: "Manifest", path: paths.manifestPath }
  ].filter((row) => row.path);
  const artifacts = relevantManifestArtifacts(new Set()).slice(0, 6);
  panel.innerHTML = "";
  panel.classList.toggle("hidden", !rows.length && !artifacts.length && !state.reviewManifestError);
  if (!rows.length && !artifacts.length && !state.reviewManifestError) return;

  const head = document.createElement("div");
  head.className = "artifact-quick-head";
  head.innerHTML = `<span>产物快捷入口</span><small>${escapeHtml(state.session?.title || state.session?.id || "当前会话")}</small>`;
  panel.appendChild(head);

  const pathGrid = document.createElement("div");
  pathGrid.className = "artifact-path-grid";
  for (const row of rows) {
    pathGrid.appendChild(createArtifactPathRow(row.label, row.path, { compact: true }));
  }
  panel.appendChild(pathGrid);

  if (state.reviewManifestError) {
    const warning = document.createElement("div");
    warning.className = "artifact-warning";
    warning.textContent = state.reviewManifestError;
    panel.appendChild(warning);
  } else if (state.reviewManifestSessionId && !state.reviewManifest) {
    const loading = document.createElement("div");
    loading.className = "artifact-warning";
    loading.textContent = "正在读取产物清单...";
    panel.appendChild(loading);
  } else if (artifacts.length) {
    const list = document.createElement("div");
    list.className = "artifact-manifest-grid";
    for (const artifact of artifacts) {
      const targetPath = artifactPath(artifact);
      const item = document.createElement("article");
      item.className = "artifact-manifest-card";
      item.innerHTML = `
        <div class="artifact-card-copy">
          <strong></strong>
          <span></span>
          <code></code>
        </div>
      `;
      item.querySelector("strong").textContent = artifact.title || artifact.name || basename(targetPath || "未命名产物");
      item.querySelector("span").textContent = artifact.description || artifact.summary || artifact.sourceNodeId || artifact.nodeId || "已登记产物";
      item.querySelector("code").textContent = targetPath || "未登记路径";
      item.appendChild(createPathActions(targetPath));
      list.appendChild(item);
    }
    panel.appendChild(list);
  }
}

function renderReviewArtifacts() {
  const box = $("reviewArtifacts");
  if (!box) return;
  const paths = state.run?.paths || state.session?.paths || {};
  const reviewNode = findPlanNode(state.reviewDialog?.nodeId || "");
  const upstreamIds = new Set(reviewNode ? getReviewUpstreamNodes(reviewNode).map((node) => node.id) : []);
  const manifestArtifacts = relevantManifestArtifacts(upstreamIds);
  const rows = [
    ["产物目录", paths.artifactDir],
    ["Manifest", paths.manifestPath],
    ["运行记录", paths.runDir || paths.sessionDir]
  ].filter(([, value]) => value);
  box.innerHTML = "";
  if (!rows.length && !manifestArtifacts.length && !state.reviewManifestError) {
    const empty = document.createElement("div");
    empty.className = "review-empty";
    empty.textContent = "尚未配置产物目录。";
    box.appendChild(empty);
    return;
  }
  if (rows.length) {
    const pathsBox = document.createElement("div");
    pathsBox.className = "review-artifact-paths";
    for (const [label, value] of rows) {
      pathsBox.appendChild(createArtifactPathRow(label, value));
    }
    box.appendChild(pathsBox);
  }

  if (state.reviewManifestError) {
    const warning = document.createElement("div");
    warning.className = "review-empty";
    warning.textContent = state.reviewManifestError;
    box.appendChild(warning);
  } else if (state.reviewManifestSessionId && !state.reviewManifest) {
    const loading = document.createElement("div");
    loading.className = "review-empty";
    loading.textContent = "正在读取产物清单...";
    box.appendChild(loading);
  } else if (manifestArtifacts.length) {
    const artifactList = document.createElement("div");
    artifactList.className = "review-manifest-list";
    for (const artifact of manifestArtifacts.slice(0, 10)) {
      const item = document.createElement("article");
      item.className = "review-manifest-item";
      item.innerHTML = `
        <div class="review-manifest-copy">
          <div class="review-manifest-title"></div>
          <div class="review-manifest-desc"></div>
          <div class="review-manifest-path"></div>
        </div>
      `;
      const targetPath = artifactPath(artifact);
      item.querySelector(".review-manifest-title").textContent = artifact.title || artifact.name || basename(targetPath || "未命名产物");
      item.querySelector(".review-manifest-desc").textContent = artifact.description || artifact.summary || artifact.sourceNodeId || artifact.nodeId || "已登记产物";
      item.querySelector(".review-manifest-path").textContent = targetPath;
      item.appendChild(createPathActions(targetPath));
      artifactList.appendChild(item);
    }
    box.appendChild(artifactList);
  } else if (state.reviewManifest) {
    const empty = document.createElement("div");
    empty.className = "review-empty";
    empty.textContent = "产物清单中暂未登记上游节点的文件产物；可先查看上方节点输出里的路径。";
    box.appendChild(empty);
  }
}

function createArtifactPathRow(label, value, { compact = false, openItem = true } = {}) {
  const row = document.createElement("div");
  row.className = `review-artifact-row ${compact ? "compact" : ""}`;
  row.innerHTML = `<span></span><strong></strong>`;
  row.querySelector("span").textContent = label;
  row.querySelector("strong").textContent = value;
  row.appendChild(createPathActions(value, { openItem }));
  return row;
}

function createPathActions(targetPath, { openItem = true } = {}) {
  const actions = document.createElement("div");
  actions.className = "path-actions";
  const canOpen = isOpenablePath(targetPath);
  if (openItem) {
    actions.appendChild(createPathActionButton("打开", icons.open, targetPath, "item", canOpen));
  }
  actions.appendChild(createPathActionButton("所在文件夹", icons.folder, targetPath, "folder", canOpen));
  return actions;
}

function createPathActionButton(label, icon, targetPath, mode, enabled) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "path-action-button";
  button.innerHTML = `${icon}<span>${escapeHtml(label)}</span>`;
  button.disabled = !enabled;
  button.title = enabled ? label : "当前不是本地文件路径";
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    openPathFromUi(targetPath, mode, button);
  });
  return button;
}

async function openPathFromUi(targetPath, mode, button) {
  if (!isOpenablePath(targetPath)) return;
  const original = button.innerHTML;
  button.disabled = true;
  button.innerHTML = `${icons.refresh}<span>打开中</span>`;
  button.querySelector(".icon")?.classList.add("spin");
  try {
    const data = await api("/api/open-path", {
      method: "POST",
      body: JSON.stringify({ path: targetPath, mode })
    });
    showNotice(`${mode === "folder" ? "已打开所在文件夹" : "已打开产物"}：${data.path || targetPath}`);
  } catch (error) {
    showNotice(error.message || "打开失败", "bad");
  } finally {
    button.disabled = false;
    button.innerHTML = original;
  }
}

function artifactPath(artifact) {
  return String(artifact?.path || artifact?.file || artifact?.filePath || artifact?.href || "").trim();
}

function isOpenablePath(value) {
  const text = String(value || "").trim();
  return Boolean(text) && !/^[a-z][a-z0-9+.-]*:/i.test(text.replace(/^[a-z]:[\\/]/i, ""));
}

function relevantManifestArtifacts(upstreamIds) {
  const artifacts = Array.isArray(state.reviewManifest?.artifacts) ? state.reviewManifest.artifacts : [];
  if (!artifacts.length) return [];
  if (!upstreamIds.size) return artifacts;
  return artifacts.filter((artifact) => {
    const source = artifact.sourceNodeId || artifact.nodeId || artifact.source_node_id || artifact.sourceNode || artifact.node;
    return !source || upstreamIds.has(source);
  });
}

function basename(filePath) {
  return String(filePath || "").split(/[\\/]/).filter(Boolean).at(-1) || "未命名产物";
}

function compactReviewOutput(text, limit = 1400) {
  const clean = String(text || "").replace(/\r/g, "").trim();
  if (!clean) return "";
  return clean.length > limit ? `${clean.slice(0, limit - 1)}…` : clean;
}

async function submitReviewDialog() {
  const nodeId = state.reviewDialog?.nodeId;
  if (!nodeId) return;
  const waitingReason = state.run?.nodes?.[nodeId]?.waitingReason || "human-review";
  const note = $("reviewNoteInput").value.trim() || (waitingReason === "network" ? "允许该节点完全联网并继续执行。" : "人工确认通过。");
  setBusy($("submitReviewBtn"), true, `${icons.refresh}<span>提交中</span>`);
  try {
    await continueNode(nodeId, note);
    closeReviewDialog();
  } catch {
    // continueNode has already pushed the actionable error into the console.
  } finally {
    setBusy($("submitReviewBtn"), false, waitingReason === "network" ? "允许联网并继续" : "确认并继续");
  }
}

async function stopRun() {
  if (!state.run) return;
  await api(`/api/runs/${state.run.id}/stop`, { method: "POST", body: "{}" });
}

function clearLogs() {
  state.logs = [];
  renderRun();
}

function nodeState(nodeId) {
  return state.run?.nodes?.[nodeId]?.status || "pending";
}

function statusLabel(status) {
  return {
    pending: "待执行",
    running: "运行中",
    completed: "已完成",
    failed: "失败",
    waiting: "等待确认",
    cancelled: "已停止"
  }[status] || status || "未知";
}

function modeDisplayLabel(mode) {
  if (mode === "codex") return "agent";
  if (mode === "human-review") return "human-review";
  if (mode === "auto-review") return "auto-review";
  if (mode === "synthesis") return "synthesis";
  return mode;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char]));
}

function escapeAttr(value) {
  return escapeHtml(value);
}

function bindEvents() {
  bindCanvasSelection();
  $("generateBtn").addEventListener("click", generatePlan);
  $("sampleBtn").addEventListener("click", loadSample);
  $("refreshSkillsBtn").addEventListener("click", () => loadSkills());
  $("modelInput").addEventListener("change", () => {
    renderEffortSelect($("effortInput"), $("effortInput").value || state.config?.models?.reasoningEffort || "medium", {
      provider: currentToolProvider(),
      model: $("modelInput").value
    });
  });
  $("executorModelInput").addEventListener("change", () => {
    renderEffortSelect($("defaultEffortInput"), $("defaultEffortInput").value || state.config?.models?.reasoningEffort || "medium", {
      provider: currentToolProvider(),
      model: $("executorModelInput").value
    });
  });
  $("toolProviderInput").addEventListener("change", (event) => selectToolProvider(event.target.value, { confirmed: true, persist: true }));
  $("settingsToolProviderInput").addEventListener("change", (event) => selectToolProvider(event.target.value, { confirmed: true, persist: false }));
  $("saveConfigBtn").addEventListener("click", saveConfigFromForm);
  $("saveConversationTitleBtn").addEventListener("click", saveConversationTitle);
  $("conversationTitleInput").addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      saveConversationTitle();
      event.currentTarget.blur();
    }
  });
  $("conversationTitleInput").addEventListener("input", () => {
    if (state.session?.id) {
      state.sessionTitleSaveStatus = "有未保存修改";
      $("conversationTitleStatus").textContent = state.sessionTitleSaveStatus;
    }
  });
  $("undoBtn").addEventListener("click", undoPlanChange);
  $("pickWorkspaceRootBtn").addEventListener("click", (event) => {
    pickConfigFolder("workspaceRootInput", "workspaceRootPath", "选择项目文件夹", event.currentTarget);
  });
  $("pickStorageRootBtn").addEventListener("click", (event) => {
    pickConfigFolder("storageRootInput", "storageRootPath", "选择对话与运行记录目录", event.currentTarget);
  });
  $("pickArtifactRootBtn").addEventListener("click", (event) => {
    pickConfigFolder("artifactRootInput", "artifactRootPath", "选择产物目录", event.currentTarget);
  });
  $("addNodeBtn").addEventListener("click", addNode);
  $("deleteNodeBtn").addEventListener("click", deleteNode);
  $("layoutBtn").addEventListener("click", () => autoLayout(true));
  $("zoomOutBtn").addEventListener("click", () => zoomCanvasBy(-CANVAS_ZOOM_STEP));
  $("zoomInBtn").addEventListener("click", () => zoomCanvasBy(CANVAS_ZOOM_STEP));
  $("fitCanvasBtn").addEventListener("click", fitCanvasToView);
  $("resetZoomBtn").addEventListener("click", resetCanvasZoom);
  $("canvasScroller").addEventListener("wheel", handleCanvasWheel, { passive: false });
  $("exportBtn").addEventListener("click", exportPlan);
  $("runBtn").addEventListener("click", startRun);
  $("stopRunBtn").addEventListener("click", stopRun);
  $("clearLogsBtn").addEventListener("click", clearLogs);
  $("closeReviewBtn").addEventListener("click", closeReviewDialog);
  $("cancelReviewBtn").addEventListener("click", closeReviewDialog);
  $("submitReviewBtn").addEventListener("click", submitReviewDialog);
  $("reviewNoteInput").addEventListener("input", (event) => {
    if (state.reviewDialog) state.reviewDialog.note = event.currentTarget.value;
  });
  $("reviewModal").addEventListener("click", (event) => {
    if (event.target === event.currentTarget) closeReviewDialog();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && state.reviewDialog) {
      closeReviewDialog();
      return;
    }
    const isUndo = (event.metaKey || event.ctrlKey) && !event.shiftKey && event.key.toLowerCase() === "z";
    if (!isUndo) return;
    if (event.target?.closest?.("input, textarea, [contenteditable='true']")) return;
    event.preventDefault();
    undoPlanChange();
  });
}

initButtons();
bindEvents();
await Promise.all([loadHealth(), loadConfig()]);
await loadSkills();
renderAll();
maybePromptToolChoice();
