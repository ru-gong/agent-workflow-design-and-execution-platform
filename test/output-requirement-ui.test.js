import test from "node:test";
import assert from "node:assert/strict";
import {
  customForOutputRequirementTypeChange,
  outputRequirementGuidance
} from "../public/outputRequirement.js";

test("output requirement type change replaces stale Markdown guidance", () => {
  const custom = customForOutputRequirementTypeChange(
    {
      type: "markdown",
      custom: "输出中文Markdown深度研究报告，适合直接给研发、战略或供应链团队评审。"
    },
    "ppt"
  );

  assert.match(custom, /PPT 汇报材料/);
  assert.doesNotMatch(custom, /Markdown深度研究报告/);
});

test("output requirement type change preserves non-format custom details", () => {
  const custom = customForOutputRequirementTypeChange(
    {
      type: "markdown",
      custom: "聚焦研发、战略和供应链团队，保留关键证据与风险判断。"
    },
    "ppt"
  );

  assert.equal(custom, "聚焦研发、战略和供应链团队，保留关键证据与风险判断。");
});

test("output requirement guidance is format-specific", () => {
  assert.match(outputRequirementGuidance("ppt"), /PPT 汇报材料/);
  assert.match(outputRequirementGuidance("html"), /HTML 单页报告/);
  assert.match(outputRequirementGuidance("markdown"), /Markdown 深度研究报告/);
});
