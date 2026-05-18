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
  const defaultPath = await resolvePickerDefaultPath({ currentPath, fallbackPath, root });
  const command = buildChooseFolderCommand({ title, defaultPath, platform });
  if (!command) {
    return { supported: false, error: "Folder picker is currently implemented for macOS and Windows." };
  }

  try {
    const { stdout } = await execFilePromise(execFileImpl, command.command, command.args, { timeout: 120_000 });
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

export function buildWindowsChooseFolderArgs({ title = "选择文件夹", defaultPath = ROOT } = {}) {
  const script = [
    "Add-Type -AssemblyName System.Windows.Forms",
    "$dialog = New-Object System.Windows.Forms.FolderBrowserDialog",
    "$dialog.Description = $args[0]",
    "$dialog.SelectedPath = $args[1]",
    "$dialog.ShowNewFolderButton = $true",
    "if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { $dialog.SelectedPath }"
  ].join("; ");
  return ["-NoProfile", "-STA", "-ExecutionPolicy", "Bypass", "-Command", script, title, defaultPath];
}

function buildChooseFolderCommand({ title, defaultPath, platform }) {
  if (platform === "darwin") {
    return { command: "osascript", args: ["-e", buildChooseFolderScript({ title, defaultPath })] };
  }
  if (platform === "win32") {
    return { command: "powershell.exe", args: buildWindowsChooseFolderArgs({ title, defaultPath }) };
  }
  return null;
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
