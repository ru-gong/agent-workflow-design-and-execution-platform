import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { ROOT } from "./utils.js";

export async function pickFolder({
  title = "选择文件夹",
  currentPath = "",
  fallbackPath = "",
  root = ROOT,
  execFileImpl = execFile,
  platform = process.platform
} = {}) {
  if (platform !== "darwin") {
    return { supported: false, error: "Folder picker is currently implemented for macOS." };
  }

  const defaultPath = await resolvePickerDefaultPath({ currentPath, fallbackPath, root });
  const script = buildChooseFolderScript({ title, defaultPath });

  try {
    const { stdout } = await execFilePromise(execFileImpl, "osascript", ["-e", script], { timeout: 120_000 });
    const selectedPath = String(stdout || "").trim();
    return selectedPath ? { supported: true, path: selectedPath } : { supported: true, cancelled: true };
  } catch (error) {
    const text = `${error?.stderr || ""}\n${error?.message || ""}`;
    if (text.includes("-128") || /User canceled/i.test(text)) {
      return { supported: true, cancelled: true };
    }
    throw error;
  }
}

export async function resolvePickerDefaultPath({ currentPath = "", fallbackPath = "", root = ROOT } = {}) {
  const candidates = [currentPath, fallbackPath, root]
    .map((value) => resolveCandidatePath(value, root))
    .filter(Boolean);

  for (const candidate of candidates) {
    try {
      const stat = await fs.stat(candidate);
      if (stat.isDirectory()) return candidate;
      const parent = path.dirname(candidate);
      const parentStat = await fs.stat(parent);
      if (parentStat.isDirectory()) return parent;
    } catch {
      // Try the next candidate.
    }
  }
  return root;
}

export function buildChooseFolderScript({ title = "选择文件夹", defaultPath = ROOT } = {}) {
  return [
    `set defaultFolder to POSIX file ${appleScriptString(defaultPath)}`,
    `set pickedFolder to choose folder with prompt ${appleScriptString(title)} default location defaultFolder`,
    "POSIX path of pickedFolder"
  ].join("\n");
}

function resolveCandidatePath(value, root) {
  const text = String(value || "").trim();
  if (!text) return "";
  return path.normalize(path.isAbsolute(text) ? text : path.resolve(root, text));
}

function appleScriptString(value) {
  return `"${String(value || "").replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
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
