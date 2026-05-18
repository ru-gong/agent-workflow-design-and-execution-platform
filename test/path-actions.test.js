import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildOpenPathCommand, openLocalPath, resolveRequestedPath } from "../server/pathActions.js";
import { resolveRuntimeConfig } from "../server/config.js";

test("buildOpenPathCommand maps platforms to native openers", () => {
  assert.deepEqual(buildOpenPathCommand("/tmp/report.md", "darwin"), { command: "open", args: ["/tmp/report.md"] });
  assert.deepEqual(buildOpenPathCommand("/tmp/report.md", "linux"), { command: "xdg-open", args: ["/tmp/report.md"] });
  const win = buildOpenPathCommand("C:\\Users\\demo\\report.md", "win32");
  assert.equal(win.command, "powershell.exe");
  assert.equal(win.args.at(-1), "C:\\Users\\demo\\report.md");
});

test("openLocalPath opens files and containing folders inside configured roots", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "path-actions-"));
  const artifactRoot = path.join(tempRoot, "artifacts");
  const artifactDir = path.join(artifactRoot, "session-1");
  const reportPath = path.join(artifactDir, "report.md");
  await fs.mkdir(artifactDir, { recursive: true });
  await fs.writeFile(reportPath, "# Report\n");
  const runtime = resolveRuntimeConfig({
    workspaceRoot: tempRoot,
    storageRoot: ".orchestrator",
    artifactRoot: "artifacts"
  });
  const calls = [];
  const execFileImpl = (command, args, _options, callback) => {
    calls.push({ command, args });
    callback(null, "", "");
  };

  const fileResult = await openLocalPath({ targetPath: reportPath, runtime, platform: "darwin", execFileImpl });
  assert.equal(fileResult.path, reportPath);
  assert.deepEqual(calls[0], { command: "open", args: [reportPath] });

  const folderResult = await openLocalPath({ targetPath: reportPath, mode: "folder", runtime, platform: "darwin", execFileImpl });
  assert.equal(folderResult.path, artifactDir);
});

test("openLocalPath rejects external paths and URL-like inputs", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "path-actions-root-"));
  const runtime = resolveRuntimeConfig({ workspaceRoot: tempRoot });

  assert.throws(() => resolveRequestedPath("https://example.com/report.md", runtime), /本地产物路径/);
  await assert.rejects(
    openLocalPath({
      targetPath: path.join(os.tmpdir(), "outside-report.md"),
      runtime,
      platform: "darwin",
      execFileImpl: () => {
        throw new Error("should not open");
      }
    }),
    /不在当前工作区/
  );
});
