import test from "node:test";
import assert from "node:assert/strict";
import {
  defaultRuntimeConfig,
  getBuiltInSkillsDirectory,
  getConfigPaths,
  SkillRegistry,
  validateSkillManifest
} from "../packages/core/dist/index.js";
import { defineSkill } from "../packages/sdk/dist/index.js";
import { renderHelp, run } from "../packages/cli/dist/index.js";

test("core uses an overrideable configuration root", () => {
  const paths = getConfigPaths({ AI_SKILLS_HOME: "/tmp/aiskills-test" });
  assert.equal(paths.root, "/tmp/aiskills-test");
  assert.equal(paths.configFile, "/tmp/aiskills-test/config.json");
});

test("core exposes a safe default runtime config", () => {
  assert.deepEqual(defaultRuntimeConfig(), { schemaVersion: 1, mode: "auto-safe" });
});

test("SDK validates and normalizes skill definitions", () => {
  const skill = defineSkill({
    id: "repo-explorer",
    name: "Repository Explorer",
    version: "0.1.0",
    category: "core",
    capabilities: ["repository-inspection", "repository-inspection"]
  });
  assert.deepEqual(skill.capabilities, ["repository-inspection"]);
});

test("skill registry loads built-ins and resolves dependencies", async () => {
  const registry = await SkillRegistry.fromDirectory(getBuiltInSkillsDirectory());
  assert.equal(registry.list().length, 4);
  assert.deepEqual(registry.resolve(["completion-checker"]).map((skill) => skill.id), [
    "repo-explorer",
    "evidence-first",
    "planner",
    "completion-checker"
  ]);
});

test("manifest validation rejects unsupported permissions and schema versions", () => {
  const result = validateSkillManifest({
    schema_version: 99,
    id: "unsafe-skill",
    name: "Unsafe Skill",
    version: "0.1.0",
    category: "test",
    description: "test",
    capabilities: [],
    requires: { permissions: ["secrets.read.all"] },
    recommended_tools: [],
    compatible_agents: [],
    dependencies: { skills: [] },
    checks: [],
    risk_level: "high"
  });
  assert.equal(result.valid, false);
  assert.match(result.errors.join(" "), /schema_version/);
  assert.match(result.errors.join(" "), /unsupported permission/);
});

test("registry rejects duplicate IDs and circular dependencies", () => {
  const registry = new SkillRegistry();
  const skill = (id, dependencies = []) => ({
    schema_version: 1,
    id,
    name: id,
    version: "0.1.0",
    category: "test",
    description: "test skill",
    capabilities: [],
    requires: { permissions: ["repository.read"] },
    recommended_tools: [],
    compatible_agents: [],
    dependencies: { skills: dependencies },
    checks: [],
    risk_level: "low"
  });

  registry.add(skill("alpha"));
  assert.throws(() => registry.add(skill("alpha")), /duplicate skill ID/);

  const cycle = new SkillRegistry();
  cycle.add(skill("alpha", ["beta"]));
  cycle.add(skill("beta", ["alpha"]));
  assert.throws(() => cycle.resolve(["alpha"]), /circular skill dependency/);
});

test("CLI exposes help and version commands", async () => {
  assert.match(renderHelp(), /aiskills <command>/);
  assert.equal(await run(["--version"]), 0);
  assert.equal(await run(["--help"]), 0);
});
