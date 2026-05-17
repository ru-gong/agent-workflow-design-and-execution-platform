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

## What It Does

- `GET /api/health`: detects locally available coding tools. Codex and Claude Code are currently supported.
- `GET /api/config` / `PUT /api/config`: reads and saves `orchestrator.config.json`, including the selected tool provider, project paths, session storage, artifact output paths, default models, and reasoning effort.
- `POST /api/plan`: asks the selected tool provider to generate an editable orchestration plan constrained by `schemas/orchestration-plan.schema.json`.
- `PUT /api/sessions/:id/plan`: saves the human-edited plan into the session.
- `POST /api/runs`: creates a run and schedules nodes according to DAG dependencies.
- `GET /api/runs/:id/events`: streams node status, logs, and final results through SSE.
- `POST /api/runs/:id/nodes/:nodeId/continue`: resumes a paused human review node or a node waiting for network permission.
- `POST /api/runs/:id/stop`: stops a run and cancels active tool subprocesses.
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
- Session artifacts: each plan creates `.orchestrator/sessions/<session-id>/` for internal records and `artifacts/<session-id>/` for user-facing outputs.

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
      ...
```

The "Run Settings" panel can edit providers, paths, and default models. On macOS, folder picker buttons can open native directory selection. Keeping `artifactRoot` inside `workspaceRoot` is recommended so `workspace-write` nodes can write deliverables safely.

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
