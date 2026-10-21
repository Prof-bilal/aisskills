#!/usr/bin/env node

import { createLogger, getBuiltInSkillsDirectory, getConfigPaths, getVersion, SkillRegistry } from "@aiskills/core";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

const logger = createLogger();

export function renderHelp(): string {
  return `AI Skills — local-first AI agent runtime

Usage:
  aiskills <command> [options]

Commands:
  init       Configure AI Skills for a user or project
  doctor     Check the local runtime and configuration
  agents     List detected AI agents
  skills     List and manage skills
  packs      List and manage skill packs
  plan       Create a task plan
  run        Execute a task
  verify     Verify a task or claim

Options:
  --help     Show this help
  --version  Show the installed version
`;
}

export async function run(argv: string[] = process.argv.slice(2)): Promise<number> {
  const [command] = argv;

  if (!command || command === "--help" || command === "-h" || command === "help") {
    console.log(renderHelp());
    return 0;
  }

  if (command === "--version" || command === "-v") {
    console.log(getVersion());
    return 0;
  }

  if (command === "doctor") {
    const paths = getConfigPaths();
    console.log("AI Skills Doctor\n");
    console.log("Core Runtime        PASS");
    console.log(`Configuration      READY (${paths.root})`);
    console.log("Skill Registry      NOT INITIALIZED");
    console.log("Agent Adapters      NOT INITIALIZED");
    console.log("\nPhase 1 foundation is installed. Full diagnostics arrive in later phases.");
    return 0;
  }

  if (command === "skills") {
    if (argv[1] && argv[1] !== "list") {
      logger.error(`Skill command not implemented yet: ${argv[1]}`);
      return 2;
    }
    return listSkills();
  }

  logger.error(`Command not implemented yet: ${command}`);
  console.error("Run `aiskills --help` to see available commands.");
  return 2;
}

async function listSkills(): Promise<number> {
  try {
    const registry = await SkillRegistry.fromDirectory(getBuiltInSkillsDirectory());
    console.log("Built-in skills\n");
    for (const skill of registry.list()) console.log(`${skill.id}  ${skill.version}  ${skill.description}`);
    return 0;
  } catch (error: unknown) {
    logger.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

const invokedPath = process.argv[1];
const modulePath = fileURLToPath(import.meta.url);
if (invokedPath && realpathSync(invokedPath) === realpathSync(modulePath)) {
  process.exitCode = await run();
}
