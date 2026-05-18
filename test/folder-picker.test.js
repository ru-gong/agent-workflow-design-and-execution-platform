import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildChooseFolderScript, buildWindowsChooseFolderArgs, pickFolder, resolvePickerDefaultPath } from "../server/folderPicker.js";

test("buildChooseFolderScript escapes prompt and default path for AppleScript", () => {
  const script = buildChooseFolderScript({
    title: '选择 "项目" 文件夹',
    defaultPath: '/tmp/demo "folder"'
  });

  assert.match(script, /choose folder with prompt "选择 \\"项目\\" 文件夹"/);
  assert.match(script, /POSIX file "\/tmp\/demo \\"folder\\""/);
});

test("resolvePickerDefaultPath prefers an existing directory", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "folder-picker-"));
  const existing = path.join(root, "existing");
  await fs.mkdir(existing);

  assert.equal(await resolvePickerDefaultPath({ currentPath: "missing", fallbackPath: existing, root }), existing);
});

test("pickFolder returns selected folder and handles cancel", async () => {
  const success = await pickFolder({
    platform: "darwin",
    currentPath: "/tmp",
    execFileImpl: (_command, _args, _options, callback) => callback(null, "/tmp/selected\n", "")
  });
  assert.deepEqual(success, { supported: true, path: "/tmp/selected" });

  const cancelled = await pickFolder({
    platform: "darwin",
    currentPath: "/tmp",
    execFileImpl: (_command, _args, _options, callback) => {
      const error = new Error("osascript failed");
      callback(error, "", "execution error: User canceled. (-128)");
    }
  });
  assert.deepEqual(cancelled, { supported: true, cancelled: true });
});

test("pickFolder supports Windows folder picker through PowerShell", async () => {
  const args = buildWindowsChooseFolderArgs({
    title: "选择产物目录",
    defaultPath: "C:\\Users\\demo"
  });
  assert.equal(args[0], "-NoProfile");
  assert.equal(args.includes("-STA"), true);
  assert.equal(args.at(-2), "选择产物目录");
  assert.equal(args.at(-1), "C:\\Users\\demo");

  const success = await pickFolder({
    platform: "win32",
    currentPath: "/tmp",
    execFileImpl: (command, commandArgs, _options, callback) => {
      assert.equal(command, "powershell.exe");
      assert.equal(commandArgs.includes("-STA"), true);
      callback(null, "C:\\Users\\demo\\selected\r\n", "");
    }
  });
  assert.deepEqual(success, { supported: true, path: "C:\\Users\\demo\\selected" });
});

test("pickFolder reports unsupported platforms without invoking osascript", async () => {
  const result = await pickFolder({
    platform: "linux",
    execFileImpl: () => {
      throw new Error("should not be called");
    }
  });

  assert.equal(result.supported, false);
});
