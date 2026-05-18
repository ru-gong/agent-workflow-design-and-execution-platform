import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { getRuntimeConfig } from "./config.js";

export async function openLocalPath({
  targetPath = "",
  mode = "item",
  runtime,
  platform = process.platform,
  execFileImpl = execFile
} = {}) {
  const resolvedRuntime = runtime || await getRuntimeConfig();
  const resolvedTarget = resolveRequestedPath(targetPath, resolvedRuntime);
  assertOpenAllowed(resolvedTarget, resolvedRuntime, platform);

  const openTarget = await resolveOpenTarget(resolvedTarget, mode);
  const command = buildOpenPathCommand(openTarget, platform);
  if (!command) {
    throw withStatus(new Error("当前系统不支持一键打开文件。"), 501);
  }

  await execFilePromise(execFileImpl, command.command, command.args, { timeout: 30_000 });
  return {
    ok: true,
    mode: mode === "folder" ? "folder" : "item",
    path: openTarget
  };
}

export function buildOpenPathCommand(targetPath, platform = process.platform) {
  if (platform === "darwin") return { command: "open", args: [targetPath] };
  if (platform === "win32") {
    return {
      command: "powershell.exe",
      args: ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", "Start-Process -LiteralPath $args[0]", targetPath]
    };
  }
  if (["linux", "freebsd", "openbsd"].includes(platform)) return { command: "xdg-open", args: [targetPath] };
  return null;
}

export function resolveRequestedPath(inputPath, runtime) {
  const text = String(inputPath || "").trim();
  if (!text) throw withStatus(new Error("缺少需要打开的路径。"), 400);
  if (/^[a-z][a-z0-9+.-]*:/i.test(text) && !/^[a-z]:[\\/]/i.test(text)) {
    throw withStatus(new Error("只能打开本地产物路径。"), 400);
  }
  return path.normalize(path.isAbsolute(text) ? text : path.resolve(runtime.paths.workspaceRootPath, text));
}

async function resolveOpenTarget(target, mode) {
  const wantsFolder = mode === "folder";
  try {
    const stat = await fs.stat(target);
    if (!wantsFolder) return target;
    return stat.isDirectory() ? target : path.dirname(target);
  } catch (error) {
    if (!wantsFolder) throw withStatus(new Error("路径不存在，无法打开。"), 404);
    const parent = path.dirname(target);
    try {
      const parentStat = await fs.stat(parent);
      if (parentStat.isDirectory()) return parent;
    } catch {
      // Fall through to the clearer not-found error below.
    }
    throw withStatus(new Error("路径和所在文件夹都不存在，无法打开。"), 404);
  }
}

function assertOpenAllowed(target, runtime, platform) {
  const roots = [
    runtime.paths.workspaceRootPath,
    runtime.paths.storageRootPath,
    runtime.paths.artifactRootPath
  ].filter(Boolean);
  if (!roots.some((root) => isPathInside(target, root, platform))) {
    throw withStatus(new Error("路径不在当前工作区、记录目录或产物目录内。"), 403);
  }
}

function isPathInside(target, root, platform) {
  const normalize = (value) => {
    const resolved = path.resolve(value);
    return platform === "win32" ? resolved.toLowerCase() : resolved;
  };
  const normalizedTarget = normalize(target);
  const normalizedRoot = normalize(root);
  const relative = path.relative(normalizedRoot, normalizedTarget);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function withStatus(error, statusCode) {
  error.statusCode = statusCode;
  return error;
}

function execFilePromise(execFileImpl, command, args, options) {
  return new Promise((resolve, reject) => {
    execFileImpl(command, args, options, (error, stdout, stderr) => {
      if (error) {
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}
