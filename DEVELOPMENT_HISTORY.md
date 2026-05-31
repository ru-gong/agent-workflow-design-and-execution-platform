# Development History

本文件记录 `Agent Workflow Design and Execution Platform`（中文：Agent 工作流设计与执行平台）项目的历史开发脉络，作为第一次 Git 提交的整理基线。后续功能、修复和架构调整应继续按时间追加。

## 2026-05-13 至 2026-05-17：首个可运行版本

### 产品目标

项目定位为本地可运行的可视化 agent 编排系统：

- 用户在界面中输入需求。
- 系统调用 Codex 生成可编辑任务流。
- 用户可人工调整子 agent、任务、skill、依赖和推理强度。
- 用户确认后，后端按依赖自动执行任务流。
- 执行过程通过画布节点、事件日志、人工确认窗口和产物目录持续反馈。

### 后端能力

- 搭建无框架 Node.js HTTP 服务，提供静态资源和 `/api/*` 接口。
- 接入 Codex CLI：
  - `POST /api/plan` 调用 Codex 生成结构化编排方案。
  - `POST /api/runs` 按 DAG 依赖执行节点。
  - `GET /api/runs/:id/events` 通过 SSE 推送运行事件。
- 实现 DAG 运行器：
  - 支持并发调度。
  - 支持 `codex`、`synthesis`、`human-review` 节点。
  - 支持停止运行、人工确认继续、节点输出落盘。
  - 支持 `USE_MOCK_CODEX=1` 的本地快速验证模式。
- 增加运行配置：
  - 项目目录、会话目录、产物目录。
  - planning/executor 模型。
  - 默认推理强度。
- 增加 session 与 artifact 管理：
  - `.orchestrator/sessions/<session-id>/` 保存目标、计划、运行记录、prompt、输出和 summary。
  - `artifacts/<session-id>/manifest.json` 保存用户可交付产物清单。
  - 新增 `/api/sessions/:id/artifacts` 读取产物清单，供人工确认窗口审阅。
- 增加 skills 发现能力，读取本地 Codex skills 并在界面中作为可选项展示。
- 增加天气查询示例后端代理，使用 Open-Meteo 作为实际可运行交付页的示范能力。

### 前端能力

- 构建三栏式工作台：
  - 左侧需求输入、模型/推理选择、运行设置、skills。
  - 中间画布、工具栏、运行日志。
  - 右侧节点配置面板。
- 支持任务流可视化：
  - 节点状态展示。
  - 依赖边绘制。
  - 自动布局。
  - 缩放、总览、1:1 重置。
  - 空白画布拖动平移。
  - `Shift + 拖动` 框选多节点。
  - 多节点拖动。
- 支持编排编辑：
  - 节点标题、agent、模式、沙箱、模型、推理强度、任务、验收标准直接编辑。
  - skill 通过下拉菜单选择，展示名称和简介。
  - 可新增节点、删除节点、插入到现有阶段之间。
  - 可调整依赖。
  - 支持撤回上一步和 `Cmd/Ctrl+Z`。
- 支持执行过程可视化：
  - 节点运行时高亮和脉冲。
  - 执行路径连线流动。
  - 节点旁过程气泡逐步弹出，并自动避让其他节点。
  - 底部时间线和日志同步展示状态。
- 支持人工确认：
  - 执行到 `human-review` 节点时自动弹出确认窗口。
  - 窗口展示当前确认任务、上游节点输出摘要、产物目录、manifest、运行目录。
  - 用户可填写确认意见后继续执行。

### 文档与说明

- `README.md`：项目运行、测试、API、目录结构、Codex 集成说明。
- `dag-workflow-vs-dialogue.html`：解释本工具为什么使用 DAG 工作流，以及与直接对话式协作的区别。
- `agent-workflow-platform-share.html`：项目分享说明页面。
- `GIT_WORKFLOW_RULES.md`：记录用户指定的 Git 工作流红线、分支策略和提交规范；该文件保留在本地项目目录，不纳入仓库。

### 测试覆盖

当前测试命令：

```bash
npm test
```

当前测试覆盖：

- runtime config 与 session 持久化。
- 文件夹选择脚本生成与平台兜底。
- 编排计划归一化、fallback、推理强度偏好。
- runner 人工确认暂停与继续。
- mock Codex 渐进日志事件。
- skill 描述解析。
- 天气查询与天气代码解释。

截至本记录整理时，测试通过：

```text
tests 17
pass 17
fail 0
```

### Git 基线策略

- 第一次提交只纳入源代码、文档、配置样例、测试、schema 和必要静态资源。
- 运行数据、session 记录和 artifact 产物默认忽略。
- 当前首个工作分支：`chore/initial-history`。

## 2026-05-17：只读沙箱与产物节点修复

- 规划阶段明确区分只读节点与可产生产物的可读写节点。
- 归一化计划时，将报告、文档、代码、文件、产物路径等产物型节点自动设置为 `workspace-write`。
- 人工确认节点始终保持 `read-only`，避免不必要的文件写入权限。
- 执行提示词按实际沙箱动态生成：
  - `read-only` 节点不再要求写入文件或更新 `manifest.json`。
  - `workspace-write` 节点继续要求产物落盘并登记 manifest。
- 前端节点卡片新增“只读”标识和左侧视觉提示，便于用户快速识别不能写文件的节点。
- 新增测试覆盖 sandbox 归一化、只读/可读写执行提示词差异，并将测试数量提升到 19 个。

## 2026-05-17：真实 Skill 发现修复

- 移除 `documentation-writer`、`codebase-explorer` 等虚拟 fallback skills，避免界面展示子 Codex 实际不可加载的能力。
- skills 发现范围扩展到 Codex 插件缓存，纳入真实可用的 `documents`、`presentations`、`spreadsheets`、`browser`、`github` 等插件 skill。
- skill 名称改为优先读取 `SKILL.md` frontmatter 的 `name`，与 Codex loader 的真实识别名保持一致。
- 过滤 description 元数据超过 Codex loader 限制的 skill，避免“文件存在但运行时不可加载”的假阳性。
- 规划结果会移除不可用或幻觉出来的 skill，前端下拉也不再保留自定义/未知 skill 选项。
- 新增测试覆盖真实 skill 发现、不可加载 skill 过滤、计划中不可用 skill 清理，并将测试数量提升到 22 个。

## 2026-05-17：节点级联网策略

- 生成前新增默认联网策略下拉；每个节点新增 `networkPolicy`：`confirm` 表示需要联网时先找用户确认，`full-access` 表示以完全联网高权限方式执行。
- 规划 schema、计划归一化、fallback plan 和节点配置面板均支持联网策略。
- `confirm` 节点执行时会禁止先行联网；若需要访问外部 URL，会输出 `NETWORK_ACCESS_REQUEST` 并暂停等待用户确认。
- 用户确认后，该节点会用 `danger-full-access` 方式重跑，允许 `curl`、`defuddle`、下载 PDF 等联网命令能力，避免向当前 Codex CLI 传入不支持的 `--search` 参数。
- 节点卡片新增“需确认 / 全联网”标识，人工确认弹窗可区分“联网确认”和普通人工确认。
- 新增测试覆盖 Codex CLI 参数构建、联网策略归一化、生成默认联网策略、网络请求暂停与确认后重跑，将测试数量提升到 27 个。

## 2026-05-17：规划 skill 配置策略

- 自动编排阶段只允许把人物视角、书籍框架、行业经验、思考方式等特色 skill 写入节点 `skills`。
- `defuddle`、`mineru-pdf2md`、browser、documents、spreadsheets、presentations、GitHub、Obsidian 等通用执行/检索/产出 skill 不再由规划器预先绑定到节点。
- 执行阶段保留自主性：Codex 可以按节点需要自行调用通用 skill；但节点配置里保留下来的特色 skill 被视为必用项。
- 新增测试覆盖特色 skill 判定、通用 skill 过滤、fallback plan 不预绑通用 skill、执行提示词的必用 skill 语义。

## 2026-05-17：画布整体拖动与运行气泡可视性

- 画布空白处左键按住拖动时，直接平移所有节点坐标，用户可以像拖动画图一样整体移动任务流；`Shift + 拖动` 保留为框选多节点。
- 整体拖动画布会进入撤回栈，支持工具栏撤回和 `Cmd/Ctrl+Z`。
- 运行过程气泡从固定位置改为按当前可视区域、其他节点碰撞和原始方向偏好综合评分，自动选择 `left/right/top/bottom` 及偏移量。
- 气泡渲染后会做一次可视性校验，必要时轻微滚动画布，保证正式运行时当前步骤的过程总结不会跑出画布窗口。
- 使用 `USE_MOCK_CODEX=1` 在浏览器中完成生成、空白拖动画布、确认执行和运行气泡可视性验证；`npm test` 通过 31 个测试。

## 2026-05-17：编程工具 Provider 与 Claude Code 兼容

- 后端新增编程工具 provider 抽象，启动和健康检查会扫描本机 `codex` 与 `claude`，返回可用状态、版本、默认模型和模型列表。
- 配置新增 `toolProvider` 与 `toolProviderConfirmed`，首次启动检测到多个可用工具时，前端弹窗要求用户选择 Codex 或 Claude Code。
- 计划生成和节点执行都改为按当前 provider 调度：Codex 继续走 `codex exec`，Claude Code 走 `claude --print`，并映射模型、推理强度、结构化 JSON schema 和权限模式。
- 页面左侧和运行设置均增加“编程工具”选择，切换工具后模型下拉会自动切换到对应模型集合。
- 运行器在 session 中携带 provider，节点提示词、mock 输出、执行心跳和最终日志会显示当前选择的工具。
- 新增测试覆盖 Claude Code 参数构建、工具扫描、Claude 默认模型归一化、运行器 provider 传递。

## 2026-05-17：Provider 专属 Skill 来源隔离

- 核实 Claude Code 官方 skill 目录约定后，后端 skill 发现改为按当前 provider 分流。
- 选择 Codex 时只扫描 `~/.codex/skills`、`~/.agents/skills` 与 Codex 插件缓存；选择 Claude Code 时只扫描 `~/.claude/skills`、项目 `.claude/skills` 与 Claude 插件目录。
- `/api/skills` 支持 `toolProvider` 参数，前端切换 Codex / Claude Code 后会立刻重新加载对应 provider 的 skill 下拉列表。
- 计划生成前先解析当前 provider，再把对应 provider 的真实 skill 列表交给规划器，避免把 Codex skill 配置到 Claude Code 节点，或把 Claude Code skill 配置到 Codex 节点。
- 执行提示词会说明节点配置中的 skill 来自当前工具的 active skill registry；Claude Code 节点要求优先以 `/skill-name` 方式调用匹配 skill。
- 新增测试覆盖 provider 专属扫描根目录、Claude Code skill 解析规则、超长 description 差异、Claude 通用产出类 skill 不自动预绑。

## 2026-05-17：Claude Code Effort 兼容性核实与修复

- 核实 Claude Code v2.1.114 CLI 与官方 Model configuration 文档：`--effort` 支持 `low/medium/high/xhigh/max`，但实际可用级别取决于模型。
- 前端推理强度下拉改为按当前 provider 与模型动态生成：Codex 保持 `low/medium/high/xhigh`；Claude Sonnet 显示 `low/medium/high/max`；Claude Opus 4.7 显示 `low/medium/high/xhigh/max`；Haiku 等未声明支持 effort 的模型禁用该控件。
- Claude Code 模型列表更新为当前官方 alias/版本方向，移除旧的 `claude-opus-4-5`，加入 `opusplan` 与 `claude-opus-4-7`。
- 后端在调用 CLI 前归一化 effort：例如 Sonnet 上的 `xhigh` 会降级为 `high`，Haiku 不传 `--effort`，Codex 上的 `max` 会降级为 `xhigh`。
- 编排 schema 与计划归一化允许 `max`，用于 Claude Code 支持该级别的模型。
- 新增测试覆盖 Claude/Codex effort 归一化、模型能力映射、配置保存与 max 计划传播。

## 2026-05-17：生成阶段日志反馈

- 核实底部命令窗口此前只绑定执行阶段 SSE，生成编排阶段的 `/api/plan` 普通请求不会向窗口输出进度。
- 前端生成编排开始时会清空旧日志并写入 planner 启动信息，包含 provider、模型、推理强度和联网策略。
- 规划耗时较长时，每 15 秒写入一次 planner heartbeat，避免 Claude Code / Codex 真实调用期间窗口看起来无响应。
- 生成完成后写入 source、节点数量、session id、耗时；如果使用 mock/fallback，也会把 warning 写入日志窗口。

## 2026-05-17：节点模式中英文文案

- 右侧节点配置面板的“模式”下拉改为中英文对照展示。
- 内部模式值保持 `codex`、`human-review`、`synthesis` 不变，兼容既有计划、会话和后端执行逻辑。

## 2026-05-17：结果汇总节点输出物要求

- 当节点模式为“结果汇总 / Synthesis”时，右侧节点配置面板显示“输出物要求”配置块。
- 输出类型支持 PPT、HTML、MD 文档、表格、图片、PDF、Word 文档和其他类型，并提供人工补充输入。
- 计划 schema、计划归一化和执行 prompt 都已支持 `outputRequirement`，最终汇总节点会按该要求组织最终答案和可交付产物。

## 2026-05-17：自动评审回环节点

- 新增 `auto-review` 节点模式，右侧节点配置显示最大迭代次数、返工目标节点、评审标准和上限后继续策略。
- 执行器支持自动评审节点返回 `pass`、`iterate` 或 `capped` 结构化判定；`iterate` 会把返工说明写入目标节点并重置目标路径重新运行。
- 默认最多迭代 3 次，达到上限后输出剩余问题建议并继续推进，避免工作流死循环。
- 运行事件新增 `node:iteration`，画布气泡会显示打回目标和当前迭代轮次。

## 2026-05-17：产品命名调整

- 项目英文名称调整为 `Agent Workflow Design and Execution Platform`。
- 项目中文名称调整为 `Agent 工作流设计与执行平台`。
- 主界面标题、浏览器标题、README、分享说明和启动日志统一使用新名称。

## 2026-05-18：对话命名、产物打开与 Windows 兼容

- 新增对话名称能力：创建 session 时根据用户输入目标自动归纳名称，画布顶部提供清晰显眼的名称输入框和保存按钮。
- 产物目录会自动生成 `对话命名.md`，记录当前对话名称、原始需求、session id 和相关路径；用户改名后同步更新。
- 新增产物快捷入口：过程产物、结果产物、manifest 和已登记文件产物支持一键打开和打开所在文件夹。
- 新增 `/api/open-path`，仅允许打开工作区、记录目录和产物目录内的本地路径。
- Windows 兼容修复：保留 `C:\...` 盘符路径，文件夹选择支持 PowerShell 原生窗口，CLI 检测/执行在 Windows 下使用 shell 兼容 npm `.cmd` 命令。

## 2026-05-30：执行治理、恢复重跑与模板库

- 新增执行前预览窗口：确认执行前展示节点数量、并发、人工确认、自动评审、联网节点和预计 token，并允许用户调整最大并发、联网策略、单节点/总运行超时、token 预算、失败暂停和恢复策略。
- 运行器新增 `runOptions`、`checkpoint.json` 与 `run-options.json`，支持预算/超时暂停、失败暂停、继续运行、重跑单节点和重跑节点及下游。
- 底部执行区改为分层视图：总览展示运行状态和预算，节点详情展示任务、模型、推理、沙箱、联网、输出摘要、Prompt/输出快捷打开和重跑动作，日志视图保留完整命令窗口。
- 新增模板库 API 与左侧模板入口，支持内置模板、保存当前画布为模板、从模板创建工作流、导出模板 JSON、导入模板 JSON。
- 内置模板包括深度行业研究、代码库审计、PR/变更自动评审、资料收集到 PPT、多来源事实核查。
- 新增测试覆盖运行参数归一化、checkpoint、失败暂停恢复、节点/下游重跑和模板持久化。

## 2026-05-31：Token 预算估算修正

- 修复执行前“预计 token”严重偏低的问题：旧实现只按编排 JSON 字符数估算，无法反映真实 Codex / Claude Code 节点 prompt、上游上下文和输出规模。
- 新增前后端共享的 `tokenEstimator`，按中英文混合文本、节点提示词脚手架、上游输出注入、预期产物、运行日志和工具开销计算保守区间。
- 执行预览 UI 改为展示“预算 token”区间，并在卡片中显示提示词、输出、日志/开销拆分；每个节点行增加单节点估算徽标。
- 后端运行时 token 累计切换到同一套 CJK-aware 估算器，中文需求和中文日志不再被低估。

## 2026-05-31：开源许可证声明

- 为远端公开仓库补充 Apache License 2.0 标准许可证文件。
- `package.json` 增加 `license: "Apache-2.0"`，README 中英文版本增加 License 章节，确保 GitHub 与 npm 元数据口径一致。
