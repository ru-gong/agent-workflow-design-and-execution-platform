import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";

test("planning schema keeps node properties required for Codex structured output", async () => {
  const schema = JSON.parse(await fs.readFile("schemas/orchestration-plan.schema.json", "utf8"));
  const nodeSchema = schema.properties.nodes.items;
  const propertyNames = Object.keys(nodeSchema.properties).sort();
  const requiredNames = [...nodeSchema.required].sort();

  assert.deepEqual(requiredNames, propertyNames);
  assert.equal(requiredNames.includes("outputRequirement"), true);
});
