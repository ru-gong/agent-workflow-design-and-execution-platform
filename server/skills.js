import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { normalizeToolProvider } from "./codexRunner.js";
import { ROOT } from "./utils.js";

export function skillRootsForProvider(provider = "codex", { homeDir = os.homedir(), workspaceRoot = ROOT } = {}) {
  const normalized = normalizeToolProvider(provider);
  if (normalized === "claude") {
    return [
      path.join(homeDir, ".claude", "skills"),
      path.join(workspaceRoot, ".claude", "skills"),
      path.join(homeDir, ".claude", "plugins"),
      path.join(homeDir, ".claude", "plugin-cache")
    ];
  }

  const codexHome = path.join(homeDir, ".codex");
  return [
    path.join(codexHome, "skills"),
    path.join(homeDir, ".agents", "skills"),
    path.join(codexHome, "skills", ".system"),
    path.join(codexHome, "plugins", "cache", "openai-bundled"),
    path.join(codexHome, "plugins", "cache", "openai-curated"),
    path.join(codexHome, "plugins", "cache", "openai-primary-runtime")
  ];
}

export async function discoverSkills({ provider = "codex", roots, workspaceRoot = ROOT } = {}) {
  const normalized = normalizeToolProvider(provider);
  const searchRoots = roots || skillRootsForProvider(normalized, { workspaceRoot });
  const found = [];
  for (const root of searchRoots) {
    await walkSkillRoot(root, found, 0, normalized);
  }
  const deduped = new Map();
  for (const skill of found) {
    if (!deduped.has(skill.name)) deduped.set(skill.name, skill);
  }
  return [...deduped.values()].sort((a, b) => a.name.localeCompare(b.name));
}

async function walkSkillRoot(root, found, depth = 0, provider = "codex") {
  if (depth > 4) return;
  let entries;
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch {
    return;
  }

  const hasSkill = entries.some((entry) => entry.isFile() && entry.name === "SKILL.md");
  if (hasSkill) {
    const skillPath = path.join(root, "SKILL.md");
    const skill = await readSkill(skillPath, provider);
    if (skill) found.push(skill);
    return;
  }

  await Promise.all(
    entries
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith(".git"))
      .map((entry) => walkSkillRoot(path.join(root, entry.name), found, depth + 1, provider))
  );
}

async function readSkill(skillPath, provider = "codex") {
  let content = "";
  try {
    content = await fs.readFile(skillPath, "utf8");
  } catch {
    return null;
  }
  if (!isSkillLoadableContent(content, provider)) return null;
  return parseSkillContent(content, skillPath, provider);
}

export function parseSkillContent(content, skillPath, provider = "codex") {
  const dir = path.dirname(skillPath);
  const fallbackName = path.basename(dir);
  const lines = content.split(/\r?\n/).filter(Boolean);
  const frontmatterName = extractInlineField(lines, "name");
  const heading = lines.find((line) => /^#\s+/.test(line));
  const name = frontmatterName || (heading ? heading.replace(/^#\s+/, "").trim() : fallbackName);
  const description = extractDescription(lines);
  return { name, description, path: skillPath, provider: normalizeToolProvider(provider) };
}

export function isCodexLoadableSkillContent(content) {
  return isSkillLoadableContent(content, "codex");
}

export function isSkillLoadableContent(content, provider = "codex") {
  if (normalizeToolProvider(provider) === "claude") return true;
  const description = extractRawDescription(content.split(/\r?\n/));
  return description.length <= 1024;
}

function extractDescription(lines) {
  const descriptionIndex = lines.findIndex((line) => /^description\s*:/i.test(line));
  if (descriptionIndex >= 0) {
    const inline = lines[descriptionIndex].replace(/^description\s*:\s*/i, "").trim();
    if (inline && inline !== "|" && inline !== ">") {
      return trimDescription(inline);
    }

    const block = [];
    for (const line of lines.slice(descriptionIndex + 1)) {
      if (/^---\s*$/.test(line)) break;
      if (/^\S[^:]*:\s*/.test(line)) break;
      const trimmed = line.trim();
      if (trimmed) block.push(trimmed);
    }
    if (block.length) return trimDescription(block.join(" "));
  }

  const fallback = lines.find((line) => !line.startsWith("#") && !line.startsWith("---") && line.trim().length > 20) || "";
  return trimDescription(fallback);
}

function extractInlineField(lines, field) {
  const pattern = new RegExp(`^${field}\\s*:\\s*(.+)$`, "i");
  const line = lines.find((candidate) => pattern.test(candidate));
  if (!line) return "";
  const value = line.replace(pattern, "$1").trim();
  if (!value || value === "|" || value === ">") return "";
  return value.replace(/^['"]|['"]$/g, "").trim();
}

function extractRawDescription(lines) {
  const descriptionIndex = lines.findIndex((line) => /^description\s*:/i.test(line));
  if (descriptionIndex < 0) return "";

  const inline = lines[descriptionIndex].replace(/^description\s*:\s*/i, "").trim();
  if (inline && inline !== "|" && inline !== ">") return inline.replace(/^['"]|['"]$/g, "");

  const block = [];
  for (const line of lines.slice(descriptionIndex + 1)) {
    if (/^---\s*$/.test(line)) break;
    if (/^\S[^:]*:\s*/.test(line)) break;
    block.push(line.trim());
  }
  return block.join("\n").trim();
}

function trimDescription(value) {
  return String(value || "")
    .replace(/^['"]|['"]$/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 240);
}
