import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  discoverSkills,
  isCodexLoadableSkillContent,
  isSkillLoadableContent,
  parseSkillContent,
  skillRootsForProvider
} from "../server/skills.js";

test("parseSkillContent expands YAML block descriptions into readable summaries", () => {
  const skill = parseSkillContent(
    `---
name: demo-skill
description: |
  第一行能力简介。
  第二行说明触发场景。
type: workflow
---

# Demo Skill
`,
    "/tmp/demo-skill/SKILL.md"
  );

  assert.equal(skill.name, "demo-skill");
  assert.equal(skill.description, "第一行能力简介。 第二行说明触发场景。");
  assert.equal(skill.provider, "codex");
});

test("parseSkillContent keeps inline descriptions", () => {
  const skill = parseSkillContent(
    `---
description: Make scoped changes safely.
---

# implementation-worker
`,
    "/tmp/implementation-worker/SKILL.md"
  );

  assert.equal(skill.description, "Make scoped changes safely.");
});

test("isCodexLoadableSkillContent rejects oversized descriptions", () => {
  const content = `---
name: noisy-skill
description: ${"x".repeat(1025)}
---

# Noisy Skill
`;

  assert.equal(isCodexLoadableSkillContent(content), false);
  assert.equal(isSkillLoadableContent(content, "claude"), true);
});

test("skillRootsForProvider separates Codex and Claude Code skill registries", () => {
  const codexRoots = skillRootsForProvider("codex", { homeDir: "/home/alice", workspaceRoot: "/workspace/app" });
  const claudeRoots = skillRootsForProvider("claude", { homeDir: "/home/alice", workspaceRoot: "/workspace/app" });

  assert.equal(codexRoots.some((root) => root.includes("/.codex/skills")), true);
  assert.equal(codexRoots.some((root) => root.includes("/.agents/skills")), true);
  assert.equal(codexRoots.every((root) => !root.includes("/.claude/skills")), true);
  assert.deepEqual(claudeRoots.slice(0, 2), ["/home/alice/.claude/skills", "/workspace/app/.claude/skills"]);
  assert.equal(claudeRoots.every((root) => !root.includes("/.codex/skills")), true);
});

test("discoverSkills only returns filesystem skills from configured roots", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "orchestrator-skills-"));
  const realSkill = path.join(root, "real-skill");
  const invalidSkill = path.join(root, "invalid-skill");
  await fs.mkdir(realSkill, { recursive: true });
  await fs.mkdir(invalidSkill, { recursive: true });
  await fs.writeFile(path.join(realSkill, "SKILL.md"), `---
name: real-skill
description: Ready to use.
---

# Real Skill
`);
  await fs.writeFile(path.join(invalidSkill, "SKILL.md"), `---
name: invalid-skill
description: ${"x".repeat(1025)}
---

# Invalid Skill
`);

  const skills = await discoverSkills({ roots: [root] });

  assert.deepEqual(skills.map((skill) => skill.name), ["real-skill"]);
  assert.equal(skills[0].provider, "codex");
  assert.equal(skills.every((skill) => !skill.path.startsWith("virtual://")), true);
});

test("discoverSkills uses Claude Code loadability rules for Claude provider", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "orchestrator-claude-skills-"));
  const verboseSkill = path.join(root, "verbose-skill");
  await fs.mkdir(verboseSkill, { recursive: true });
  await fs.writeFile(path.join(verboseSkill, "SKILL.md"), `---
name: verbose-skill
description: ${"x".repeat(1400)}
---

# Verbose Skill
`);

  const codexSkills = await discoverSkills({ provider: "codex", roots: [root] });
  const claudeSkills = await discoverSkills({ provider: "claude", roots: [root] });

  assert.deepEqual(codexSkills, []);
  assert.deepEqual(claudeSkills.map((skill) => [skill.name, skill.provider]), [["verbose-skill", "claude"]]);
});
