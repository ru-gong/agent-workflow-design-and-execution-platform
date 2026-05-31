# Agent Workflow Design and Execution Platform

[中文 README](./README.md)

A local visual agent orchestration system. Users describe a goal, the backend asks a local coding tool such as Codex or Claude Code to generate a DAG workflow, and the web UI lets users drag, edit, insert, delete, and connect nodes before execution. After confirmation, the runner executes nodes by dependency order and pauses at human review steps when needed.

## Screenshot

![Agent workflow orchestration screenshot](./jietuxiaoguo.png)

## Run

```bash
npm start
```

Open <http://localhost:8787>.

To try the UI and planning flow without spending real tool calls:

```bash
USE_MOCK_CODEX=1 npm start
```

## Test

```bash
npm test
```

## License

This project is licensed under the [Apache License 2.0](./LICENSE).

## Latest Updates - 2026-05-19

- Conversation title and artifact note: each generated workflow derives a visible conversation name that users can edit at the top of the canvas. The artifact folder now includes `对话命名.md`, which records the current title, original goal, session path, and artifact path, and is updated after user renaming.
- Artifact quick actions: process artifacts and final deliverables can be opened directly from the UI, including one-click access to their containing folders.
- Larger execution console: the bottom command/log panel has been expanded so users can see more Codex or Claude Code stdout, stderr, and run events while execution is in progress.
- Output requirement fix: when a synthesis node selects PPT, HTML, spreadsheets, images, PDF, Word documents, or another deliverable type, both the frontend guidance and backend execution prompt now treat that selected type as authoritative instead of being overridden by stale Markdown default wording.
- Windows compatibility: path configuration preserves `C:\...` drive prefixes, and native folder picking plus local CLI startup now handle macOS and Windows more reliably.

## Latest Updates - 2026-05-30

- Execution preview: clicking "Confirm execution" now opens a preflight dialog showing node count, concurrency, human checkpoints, auto-review nodes, network access, and estimated token usage. Users can adjust max concurrency, network policy, timeouts, token budget, failure pausing, and resume behavior before starting.
- Run governance: the runner writes `checkpoint.json` and `run-options.json`, supports budget/timeout pauses, failure pauses, resume, rerun node, and rerun node with downstream nodes.
- Layered run view: the bottom execution panel now has Overview, Node Detail, and Logs views. Overview shows status and budget, while Node Detail exposes task parameters, output summary, prompt/output quick open actions, and rerun controls.
- Workflow templates: the left panel now includes a template library. Users can create a workflow from built-in templates, save the current canvas as a template, export template JSON, and import template JSON. Built-ins include deep industry research, codebase audit, PR/change review, sources-to-PPT, and multi-source fact checking.

## Latest Updates - 2026-05-31

- Token budget estimates are now more realistic: the execution preview no longer estimates from raw plan JSON size only. It accounts for node prompt scaffolding, the global goal, upstream context, expected outputs, logs, and tool-call overhead, then shows a conservative range plus prompt/output/log breakdown.
- Frontend and backend estimates now share the same CJK-aware tokenizer, so Chinese workflows are no longer heavily underestimated during live run accounting.

## What It Does

- `GET /api/health`: detects locally available coding tools. Codex and Claude Code are currently supported.
- `GET /api/config` / `PUT /api/config`: reads and saves `orchestrator.config.json`, including the selected tool provider, project paths, session storage, artifact output paths, default models, and reasoning effort.
- `POST /api/plan`: asks the selected tool provider to generate an editable orchestration plan constrained by `schemas/orchestration-plan.schema.json`.
- `PUT /api/sessions/:id/plan`: saves the human-edited plan into the session.
- `PUT /api/sessions/:id/title`: saves a user-edited conversation title. New sessions first derive a title from the user's goal.
- `POST /api/open-path`: opens a file or containing folder under the configured workspace, session storage, or artifact root.
- `POST /api/runs`: creates a run and schedules nodes according to DAG dependencies.
- `GET /api/runs/:id/events`: streams node status, logs, and final results through SSE.
- `POST /api/runs/:id/nodes/:nodeId/continue`: resumes a paused human review node or a node waiting for network permission.
- `POST /api/runs/:id/resume`: resumes a run paused by budget, timeout, or failure governance.
- `POST /api/runs/:id/nodes/:nodeId/rerun`: reruns one node, optionally including downstream nodes.
- `POST /api/runs/:id/stop`: stops a run and cancels active tool subprocesses.
- `GET /api/templates` / `POST /api/templates` / `GET /api/templates/:id` / `DELETE /api/templates/:id`: manages reusable workflow templates.
- `GET /api/weather?city=...`: sample generated artifact backend proxy using Open-Meteo. No API key is required.

## Design Notes

Agent View is not just multiple chat windows. It is a single operational view for many background agents: their state, inputs, dependencies, lifecycle, and human intervention points.

- Status overview: every node shows pending, running, waiting, completed, or failed state.
- Startup tool choice: the app scans local Codex and Claude Code availability and lets the user choose the provider.
- Peek: the bottom log panel continuously shows tool stdout, stderr, and run events.
- Human-in-the-loop: `human-review` or `requiresReview` nodes pause until the user continues them.
- Network-in-the-loop: each node can run without network, with full network access, or ask the user before retrying with network access.
- Skill policy: specialty skills can be attached to planned nodes, while generic tools such as browser, document, spreadsheet, PDF extraction, and web scraping remain available to the executor at runtime.
- Dispatch: confirmed runs execute multiple agent nodes by DAG dependency order with limited concurrency.
- Editing safety: node changes, dependencies, tasks, and skill edits support undo. The canvas supports drag-to-pan and box selection.
- Conversation title: each generated workflow gets a visible, editable conversation name at the top of the canvas.
- Session artifacts: each plan creates `.orchestrator/sessions/<session-id>/` for internal records and `artifacts/<session-id>/` for user-facing outputs. The artifact folder also gets `对话命名.md`, a markdown note that records the current conversation title, original goal, and related paths; it is updated when the user renames the conversation. Process and result artifacts can be opened directly from the UI, including their containing folders.

## Workspace, Sessions, And Artifacts

Default configuration lives in `orchestrator.config.json`:

```json
{
  "workspaceRoot": ".",
  "storageRoot": ".orchestrator",
  "artifactRoot": "artifacts",
  "toolProvider": "codex",
  "toolProviderConfirmed": false,
  "models": {
    "planner": "gpt-5.3-codex",
    "executor": "gpt-5.3-codex",
    "reasoningEffort": "medium"
  },
  "codex": {
    "adapter": "cli"
  },
  "claude": {
    "adapter": "cli"
  }
}
```

- `toolProvider`: selected coding tool, currently `codex` or `claude`.
- `toolProviderConfirmed`: whether the startup provider choice has been confirmed.
- `workspaceRoot`: project directory where coding tools execute.
- `storageRoot`: internal session and run record directory. The default is `.orchestrator`.
- `artifactRoot`: user-facing artifact output directory. The default is `artifacts`.
- `models.planner`: default model for plan generation.
- `models.executor`: default model for node execution.
- `models.reasoningEffort`: default reasoning effort for planning and execution.

Directory structure:

```text
project-root/
  orchestrator.config.json
  .orchestrator/
    sessions/
      <session-id>/
        metadata.json
        conversation.jsonl
        plan.json
        plan.current.json
        runs/
          <run-id>/
            plan.json
            <node-id>.prompt.md
            <node-id>.last-message.md
            <node-id>.md
            summary.md
  artifacts/
    <session-id>/
      manifest.json
      对话命名.md
      ...
```

The "Run Settings" panel can edit providers, paths, and default models. On macOS and Windows, folder picker buttons can open native directory selection. Keeping `artifactRoot` inside `workspaceRoot` is recommended so `workspace-write` nodes can write deliverables safely.

## Tool Integration

Codex planning runs in a read-only sandbox:

```bash
codex exec --skip-git-repo-check --sandbox read-only --output-schema schemas/orchestration-plan.schema.json -
```

Claude Code planning uses non-interactive print mode and receives the JSON schema through `--json-schema`:

```bash
claude --print --input-format text --output-format text --json-schema '<schema-json>'
```

Skill discovery is provider-specific. Codex scans Codex skill roots and plugin caches, while Claude Code scans Claude skill roots and plugin directories. Switching providers reloads the skill list and prevents mixing provider-specific skills in planned node configuration.

Node execution uses the node's configured sandbox, defaulting to `workspace-write`. The runner uses short-lived tool sessions, suppresses noisy plugin sync logs, and advances once final output stabilizes. Nodes can override `model` and `reasoningEffort`; simple checks can use lower effort while complex implementation or synthesis nodes can request higher effort.

Synthesis nodes can specify output requirements such as PPT, HTML, Markdown, spreadsheets, images, PDF, Word documents, or custom deliverables. Auto-review nodes can define review criteria, maximum iterations, and target nodes to rerun, returning `pass`, `iterate`, or `capped`.

The current model integration is local CLI based. The web app does not store API keys; authentication, account state, and model access are handled by the local Codex or Claude Code environment.

## Project Layout

- `server/index.js`: HTTP API and static file server.
- `server/planner.js`: plan normalization, fallback drafts, and provider planner calls.
- `server/runner.js`: DAG scheduling, human review, SSE events, and run artifacts.
- `server/codexRunner.js`: Codex / Claude Code provider detection and subprocess wrapper.
- `public/app.js`: frontend state, canvas interactions, node editing, and execution panel.
- `public/style.css`: dependency-free application styling.
- `public/weather.html` / `public/weather.js`: sample generated weather query deliverable.
- `schemas/orchestration-plan.schema.json`: structured plan output schema.

## References

- Anthropic: [Agent view in Claude Code](https://claude.com/blog/agent-view-in-claude-code)
- Claude Code Docs: [Manage multiple agents with agent view](https://code.claude.com/docs/en/agent-view)
- Claude Code Docs: [Run agents in parallel](https://code.claude.com/docs/en/agents)
- Claude Code Docs: [Create custom subagents](https://code.claude.com/docs/en/sub-agents)
- Claude Docs: [Agent Skills](https://docs.claude.com/en/docs/claude-code/skills)
