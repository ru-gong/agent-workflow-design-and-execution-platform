import test from "node:test";
import assert from "node:assert/strict";
import {
  buildClaudePrintArgs,
  buildCodexExecArgs,
  detectProgrammingTools,
  effortLevelsForProvider,
  normalizeReasoningEffortForProvider
} from "../server/codexRunner.js";

test("buildCodexExecArgs does not pass unsupported native search flags", () => {
  const args = buildCodexExecArgs({
    cwd: "/tmp/project",
    sandbox: "danger-full-access",
    model: "gpt-5.3-codex",
    reasoningEffort: "high",
    outputPath: "/tmp/output.md",
    enableWebSearch: true,
    ephemeral: true,
    ignoreUserConfig: true,
    ignoreRules: true
  });

  assert.equal(args.includes("--search"), false);
  assert.deepEqual(args.slice(args.indexOf("--sandbox"), args.indexOf("--sandbox") + 2), ["--sandbox", "danger-full-access"]);
  assert.equal(args.includes("--ignore-user-config"), true);
  assert.equal(args.includes("--ignore-rules"), true);
});

test("buildCodexExecArgs downgrades unsupported max effort to xhigh", () => {
  const args = buildCodexExecArgs({ cwd: "/tmp/project", reasoningEffort: "max" });

  assert.deepEqual(args.slice(args.indexOf("-c"), args.indexOf("-c") + 2), ["-c", "model_reasoning_effort=\"xhigh\""]);
});

test("buildClaudePrintArgs maps model, effort, schema, and permissions", () => {
  const args = buildClaudePrintArgs({
    cwd: "/tmp/project",
    sandbox: "danger-full-access",
    model: "opus",
    reasoningEffort: "xhigh",
    schema: "{\"type\":\"object\"}",
    ephemeral: true
  });

  assert.equal(args.includes("--print"), true);
  assert.deepEqual(args.slice(args.indexOf("--model"), args.indexOf("--model") + 2), ["--model", "opus"]);
  assert.deepEqual(args.slice(args.indexOf("--effort"), args.indexOf("--effort") + 2), ["--effort", "xhigh"]);
  assert.deepEqual(args.slice(args.indexOf("--json-schema"), args.indexOf("--json-schema") + 2), ["--json-schema", "{\"type\":\"object\"}"]);
  assert.deepEqual(args.slice(args.indexOf("--permission-mode"), args.indexOf("--permission-mode") + 2), ["--permission-mode", "bypassPermissions"]);
  assert.equal(args.includes("--dangerously-skip-permissions"), true);
  assert.equal(args.includes("--no-session-persistence"), true);
});

test("buildClaudePrintArgs normalizes effort to model capabilities", () => {
  const sonnetArgs = buildClaudePrintArgs({ cwd: "/tmp/project", model: "sonnet", reasoningEffort: "xhigh" });
  const haikuArgs = buildClaudePrintArgs({ cwd: "/tmp/project", model: "haiku", reasoningEffort: "high" });

  assert.deepEqual(sonnetArgs.slice(sonnetArgs.indexOf("--effort"), sonnetArgs.indexOf("--effort") + 2), ["--effort", "high"]);
  assert.equal(haikuArgs.includes("--effort"), false);
  assert.deepEqual(effortLevelsForProvider("claude", "sonnet"), ["low", "medium", "high", "max"]);
  assert.deepEqual(effortLevelsForProvider("claude", "opus"), ["low", "medium", "high", "xhigh", "max"]);
  assert.deepEqual(effortLevelsForProvider("claude", "haiku"), []);
  assert.equal(normalizeReasoningEffortForProvider("claude", "sonnet", "max"), "max");
  assert.equal(normalizeReasoningEffortForProvider("claude", "sonnet", "xhigh"), "high");
});

test("buildClaudePrintArgs restricts read-only nodes to read tools", () => {
  const args = buildClaudePrintArgs({ cwd: "/tmp/project", sandbox: "read-only" });

  assert.deepEqual(args.slice(args.indexOf("--permission-mode"), args.indexOf("--permission-mode") + 2), ["--permission-mode", "plan"]);
  assert.deepEqual(args.slice(args.indexOf("--tools"), args.indexOf("--tools") + 2), ["--tools", "Read,Grep,Glob,LS"]);
});

test("detectProgrammingTools reports Codex and Claude availability", async () => {
  const runner = (command, args) => {
    assert.deepEqual(args, ["--version"]);
    const listeners = {};
    const child = {
      stdout: { on: (event, callback) => { if (event === "data" && command === "codex") callback("codex-cli 1.0.0"); } },
      stderr: { on: (event, callback) => { if (event === "data" && command === "claude") callback("2.0.0 (Claude Code)"); } },
      on: (event, callback) => {
        listeners[event] = callback;
        if (event === "close") queueMicrotask(() => callback(command === "codex" || command === "claude" ? 0 : 127));
      }
    };
    return child;
  };

  const tools = await detectProgrammingTools({ runner });

  assert.equal(tools.codex.ok, true);
  assert.equal(tools.codex.version, "codex-cli 1.0.0");
  assert.equal(tools.claude.ok, true);
  assert.equal(tools.claude.version, "2.0.0 (Claude Code)");
});
