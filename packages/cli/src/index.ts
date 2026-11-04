#!/usr/bin/env node

import {
  defaultProfile,
  createClaim,
  createTaskPlan,
  createVerificationReport,
  assessPermissions,
  defaultSecurityPolicy,
  overallPermissionDecision,
  scanUntrustedContent,
  reviewExtensionInstallation,
  assessGoalRelevance,
  defineGoal,
  loadProjectGoals,
  saveProjectGoals,
  appendMemoryRecord,
  createDecisionRecord,
  createRetrospective,
  loadMemoryRecords,
  ensureProjectMemoryStore,
  ensureUserMemoryStore,
  getBuiltInToolsDirectory,
  getBuiltInWorkflowsDirectory,
  ToolRegistry,
  detectTools,
  recommendTools,
  WorkflowRegistry,
  detectProjectContext,
  createLogger,
  getBuiltInSkillsDirectory,
  getConfigPaths,
  getVersion,
  loadUserConfig,
  saveProjectConfig,
  saveUserConfig,
  SkillRegistry
} from "aiskills-core";
import { getBuiltInPacksDirectory, PackRegistry } from "aiskills-core";
import type { VerificationCheck } from "aiskills-core";
import { createBuiltInAdapters, detectAgents, SAFE_READ_PERMISSIONS } from "aiskills-adapters-local";
import { realpathSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { createLocalRuntime } from "./runtime.js";
import { serveMcp } from "./mcp.js";

const execFileAsync = promisify(execFile);

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
  profile    Create or activate a user profile
  plan       Create a task plan
  mcp        Serve AI Skills over MCP stdio
  run        Execute a task
  reference  Save and inspect URL references
  preference Manage candidate and promoted preferences
  verify     Verify a task or claim

Options:
  --agent    Choose the provider: codex, claude, opencode, or gemini
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
    const config = await loadUserConfig(paths);
    console.log("AI Skills Doctor\n");
    console.log("Core Runtime        PASS");
    console.log(`Configuration      READY (${paths.root})`);
    console.log(`Active Profile      ${config.activeProfile}`);
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

  if (command === "packs") return managePacks(argv.slice(1));

  if (command === "agents") return listAgents();

  if (command === "init") return initialize(argv.slice(1));
  if (command === "profile") return manageProfile(argv.slice(1));
  if (command === "verify") return verifyClaim(argv.slice(1));
  if (command === "plan") return createPlan(argv.slice(1));
  if (command === "mcp") { await serveMcp(await createLocalRuntime(), detectAgents); return 0; }
  if (command === "run") return runTask(argv.slice(1));
  if (command === "security") return securityCheck(argv.slice(1));
  if (command === "goals" || command === "goal") return manageGoals(command, argv.slice(1));
  if (command === "workflows") return listWorkflows(argv.slice(1));
  if (command === "tools") return listTools();
  if (command === "memory") return manageMemory(argv.slice(1));
  if (command === "reference") return manageReferences(argv.slice(1));
  if (command === "preference" || command === "preferences") return managePreferences(argv.slice(1));

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

async function listAgents(): Promise<number> {
  const agents = await detectAgents();
  console.log("AI Agents\n");
  for (const agent of agents) {
    const marker = agent.status === "available" ? "✓" : agent.status === "unverified" ? "?" : "✗";
    console.log(`${marker} ${agent.name}`);
    console.log(`  Status: ${agent.status}`);
    console.log(`  Version: ${agent.version ?? "unknown"}`);
    console.log(`  Executable: ${agent.executable ?? "not found"}`);
    if (agent.reason) console.log(`  Note: ${agent.reason}`);
  }
  return 0;
}

async function initialize(args: string[]): Promise<number> {
  const project = args.includes("--project");
  const profileName = option(args, "profile") ?? "default";
  const mode = option(args, "mode") ?? "auto-safe";
  if (!["ask", "auto-safe", "review-first"].includes(mode)) {
    logger.error(`Invalid mode: ${mode}`);
    return 2;
  }

  const detected = await detectAgents();
  const available = detected.filter((agent) => agent.status === "available").map((agent) => agent.id);
  const agents = splitOption(args, "agents") ?? available;
  const packs = splitOption(args, "packs") ?? ["core"];
  const profile = defaultProfile(profileName, agents);
  profile.packs = packs;
  profile.mode = mode as typeof profile.mode;
  const paths = getConfigPaths();
  const config = await loadUserConfig(paths);
  config.profiles[profileName] = profile;
  config.activeProfile = profileName;
  await saveUserConfig(config, paths);

  console.log("AI Skills initialization\n");
  console.log(`Agents: ${agents.length ? agents.join(", ") : "none detected"}`);
  console.log(`Packs: ${packs.join(", ")}`);
  console.log(`Mode: ${profile.mode}`);
  console.log(`Profile saved: ${paths.configFile}`);

  if (project) {
    const context = await detectProjectContext();
    const projectConfig = await saveProjectConfig(context.root, profile);
    printProjectContext(context);
    console.log(`Project config saved: ${projectConfig}`);
  }
  return 0;
}

async function manageProfile(args: string[]): Promise<number> {
  const action = args[0];
  const name = args[1];
  if (!action || !name || !["create", "use"].includes(action)) {
    console.error("Usage: aiskills profile create <name> [--agents=a,b] [--packs=x,y] [--mode=auto-safe]");
    console.error("       aiskills profile use <name>");
    return 2;
  }
  const paths = getConfigPaths();
  const config = await loadUserConfig(paths);
  if (action === "use") {
    if (!config.profiles[name]) {
      logger.error(`Profile not found: ${name}`);
      return 2;
    }
    config.activeProfile = name;
  } else {
    const detected = await detectAgents();
    const agents = splitOption(args, "agents") ?? detected.filter((agent) => agent.status === "available").map((agent) => agent.id);
    const profile = defaultProfile(name, agents);
    profile.packs = splitOption(args, "packs") ?? ["core"];
    const mode = option(args, "mode") ?? "auto-safe";
    if (!["ask", "auto-safe", "review-first"].includes(mode)) {
      logger.error(`Invalid mode: ${mode}`);
      return 2;
    }
    profile.mode = mode as typeof profile.mode;
    config.profiles[name] = profile;
    config.activeProfile = name;
  }
  await saveUserConfig(config, paths);
  console.log(`Active profile: ${config.activeProfile}`);
  return 0;
}

function option(args: string[], name: string): string | undefined {
  const prefix = `--${name}=`;
  return args.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

function splitOption(args: string[], name: string): string[] | undefined {
  const value = option(args, name);
  return value === undefined ? undefined : value.split(",").map((item) => item.trim()).filter(Boolean);
}

function printProjectContext(context: Awaited<ReturnType<typeof detectProjectContext>>): void {
  console.log("\nProject detected");
  console.log(`Root: ${context.root}`);
  console.log(`Languages: ${context.languages.value.join(", ") || "unknown"} (${context.languages.status})`);
  console.log(`Frameworks: ${context.frameworks.value.join(", ") || "unknown"} (${context.frameworks.status})`);
  console.log(`Package manager: ${context.packageManager.value ?? "unknown"} (${context.packageManager.status})`);
  console.log(`Test runners: ${context.testRunners.value.join(", ") || "unknown"} (${context.testRunners.status})`);
  console.log(`Databases: ${context.databases.value.join(", ") || "unknown"} (${context.databases.status})`);
  console.log(`Monorepo: ${context.monorepo.value ? "yes" : "no"} (${context.monorepo.status})`);
}

async function verifyClaim(args: string[]): Promise<number> {
  const text = args.filter((arg) => !arg.startsWith("--")).join(" ").trim();
  if (!text) {
    logger.error('A claim is required. Example: aiskills verify "authentication is complete"');
    return 2;
  }
  const claim = createClaim(text);
  const context = await detectProjectContext();
  const securityCheck = await scanProjectSecurity(context);
  const checks: VerificationCheck[] = [
    { id: "repository-inspection", category: "requirements" as const, status: "PASS" as const, summary: "Project context was detected from repository files.", evidence: context.files.slice(0, 10) },
    { id: "static-checks", category: "static" as const, status: "SKIPPED" as const, summary: "Use --run-static to run the detected project build command." },
    { id: "automated-tests", category: "test" as const, status: "SKIPPED" as const, summary: "Use --run-tests to run the detected project test command." },
    securityCheck,
    { id: "requirements", category: "requirements" as const, status: "SKIPPED" as const, summary: "Requirements comparison needs an implementation plan or explicit criteria." }
  ];
  if (args.includes("--run-tests")) {
    const testCheck = await runDetectedTests(context);
    checks[2] = testCheck;
  }
  if (args.includes("--run-static")) checks[1] = await runDetectedStaticCheck(context);
  const criteria = option(args, "criteria")?.split(",").map((item) => item.trim()).filter(Boolean) ?? [];
  if (criteria.length) checks[4] = await runRequirementsCheck(context, criteria);
  const report = createVerificationReport(claim.text, checks);
  console.log(JSON.stringify({ claim: { text: claim.text, state: claim.state }, ...report }, null, 2));
  return report.status === "FAILED" ? 1 : 0;
}

async function runDetectedStaticCheck(context: Awaited<ReturnType<typeof detectProjectContext>>) {
  const packageManager = context.packageManager.value;
  if (!packageManager) return { id: "static-checks", category: "static" as const, status: "SKIPPED" as const, summary: "No supported package manager was detected." };
  const command = packageManager === "pnpm" ? "pnpm" : packageManager === "yarn" ? "yarn" : packageManager === "bun" ? "bun" : "npm";
  try {
    await execFileAsync(command, ["run", "build"], { cwd: context.root, timeout: 60_000, windowsHide: true, maxBuffer: 4 * 1024 * 1024 });
    return { id: "static-checks", category: "static" as const, status: "PASS" as const, summary: `${command} run build completed successfully.`, evidence: [`${command} run build`] };
  } catch (error) {
    return { id: "static-checks", category: "static" as const, status: "FAIL" as const, summary: `${command} run build failed: ${error instanceof Error ? error.message : String(error)}` };
  }
}

async function runRequirementsCheck(context: Awaited<ReturnType<typeof detectProjectContext>>, criteria: string[]): Promise<VerificationCheck> {
  const files = context.files.filter((file) => /\.(ts|tsx|js|jsx|py|go|rs|md|json|ya?ml)$/i.test(file)).slice(0, 50);
  const contents: string[] = [];
  for (const file of files) {
    try { contents.push((await readFile(`${context.root}/${file}`, "utf8")).toLowerCase()); } catch { /* report missing evidence below */ }
  }
  const missing = criteria.filter((criterion) => !contents.some((content) => content.includes(criterion.toLowerCase())));
  return missing.length
    ? { id: "requirements", category: "requirements", status: "FAIL", summary: `Required criteria not found in inspected repository evidence: ${missing.join(", ")}` }
    : { id: "requirements", category: "requirements", status: "PASS", summary: "All explicit criteria were found in inspected repository evidence.", evidence: criteria };
}

async function scanProjectSecurity(context: Awaited<ReturnType<typeof detectProjectContext>>): Promise<VerificationCheck> {
  const candidates = context.files.filter((file) => /\.(md|txt|json|ya?ml|toml)$/i.test(file)).slice(0, 20);
  const findings: string[] = [];
  for (const file of candidates) {
    try {
      const content = await readFile(`${context.root}/${file}`, "utf8");
      if (scanUntrustedContent(content).length) findings.push(file);
    } catch { /* inaccessible files remain outside this proportional scan */ }
  }
  return findings.length
    ? { id: "security-review", category: "security", status: "FAIL", summary: `Prompt-injection patterns found in: ${findings.join(", ")}`, evidence: findings }
    : { id: "security-review", category: "security", status: "PASS", summary: "Scanned selected repository metadata for common prompt-injection patterns.", evidence: candidates };
}

async function runDetectedTests(context: Awaited<ReturnType<typeof detectProjectContext>>) {
  const packageManager = context.packageManager.value;
  if (!packageManager) return { id: "automated-tests", category: "test" as const, status: "SKIPPED" as const, summary: "No supported package manager was detected." };
  const command = packageManager === "pnpm" ? "pnpm" : packageManager === "yarn" ? "yarn" : packageManager === "bun" ? "bun" : "npm";
  try {
    await execFileAsync(command, ["test"], { cwd: context.root, timeout: 60_000, windowsHide: true, maxBuffer: 4 * 1024 * 1024 });
    return { id: "automated-tests", category: "test" as const, status: "PASS" as const, summary: `${command} test completed successfully.`, evidence: [`${command} test`] };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { id: "automated-tests", category: "test" as const, status: "FAIL" as const, summary: `${command} test failed: ${message}` };
  }
}

async function createPlan(args: string[]): Promise<number> {
  const task = args.filter((arg) => !arg.startsWith("--")).join(" ").trim();
  if (!task) {
    logger.error('A task is required. Example: aiskills plan "review authentication"');
    return 2;
  }
  const context = await detectProjectContext();
  const registry = await SkillRegistry.fromDirectory(getBuiltInSkillsDirectory());
  const plan = createTaskPlan(task, context, registry.list().map((skill) => skill.id));
  console.log(JSON.stringify(plan, null, 2));
  return 0;
}

async function managePacks(args: string[]): Promise<number> {
  const registry = await PackRegistry.fromDirectory(getBuiltInPacksDirectory());
  const action = args[0] ?? "list";
  if (action === "list") {
    console.log("Built-in packs\n");
    for (const pack of registry.list()) console.log(`${pack.id}  ${pack.version}  ${pack.description}`);
    return 0;
  }
  const id = args[1];
  if (!id || !["install", "remove"].includes(action)) {
    console.error("Usage: aiskills packs list|install <id>|remove <id>");
    return 2;
  }
  const pack = registry.get(id);
  if (!pack) {
    logger.error(`Pack not found: ${id}`);
    return 2;
  }
  const config = await loadUserConfig();
  const profile = config.profiles[config.activeProfile];
  if (!profile) {
    logger.error(`Active profile not found: ${config.activeProfile}`);
    return 2;
  }
  if (action === "install") {
    registry.resolve([id]);
    profile.packs = [...new Set([...profile.packs, ...pack.dependencies.packs, id])];
  } else {
    profile.packs = profile.packs.filter((installed) => installed !== id);
  }
  await saveUserConfig(config);
  console.log(`${action === "install" ? "Installed" : "Removed"} pack: ${id}`);
  console.log(`Active profile: ${config.activeProfile}`);
  console.log(`Packs: ${profile.packs.join(", ") || "none"}`);
  return 0;
}

async function runTask(args: string[]): Promise<number> {
  const parsed = parseRunArguments(args);
  const task = parsed.task;
  if (!task) {
    logger.error('A task is required. Example: aiskills run "review authentication" --agent claude');
    return 2;
  }
  const requestedAgent = parsed.agent ? normalizeAgentId(parsed.agent) : undefined;
  if (parsed.agent && !requestedAgent) {
    logger.error(`Unknown agent "${parsed.agent}". Choose codex, claude, opencode, or gemini.`);
    return 2;
  }
  const runtime = await createLocalRuntime(requestedAgent, chunk => process.stdout.write(chunk));
  const result = await runtime.executeTask({ task });
  console.log(`Status: ${result.status}`);
  console.log(`Execution: ${result.summary}`);
  console.log(`Skills: ${result.skills.join(", ")}`);
  return ["COMPLETE", "IMPLEMENTED_BUT_UNVERIFIED"].includes(result.status) ? 0 : 1;
}

function parseRunArguments(args: string[]): { task: string; agent?: string } {
  const taskParts: string[] = [];
  let agent: string | undefined;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--agent") {
      agent = args[index + 1];
      index += 1;
      continue;
    }
    if (arg.startsWith("--agent=")) {
      agent = arg.slice("--agent=".length);
      continue;
    }
    if (!arg.startsWith("--")) taskParts.push(arg);
  }
  return { task: taskParts.join(" ").trim(), agent };
}

function normalizeAgentId(value: string): string | undefined {
  const aliases: Record<string, string> = {
    codex: "codex",
    openai: "codex",
    gpt: "codex",
    "gpt-5": "codex",
    claude: "claude",
    "claude-code": "claude",
    opencode: "opencode",
    "open-code": "opencode",
    gemini: "gemini",
    "gemini-cli": "gemini"
  };
  return aliases[value.trim().toLowerCase()];
}

async function securityCheck(args: string[]): Promise<number> {
  const content = args.filter((arg) => !arg.startsWith("--")).join(" ");
  if (content) {
    const findings = scanUntrustedContent(content);
    console.log(JSON.stringify({ trusted: findings.length === 0, findings }, null, 2));
    return findings.some((finding) => finding.severity === "high") ? 1 : 0;
  }
  if (args.includes("--review-plugin")) {
    console.log(JSON.stringify(reviewExtensionInstallation("executable-plugin", ["repository.read", "shell.execute", "network.write"]), null, 2));
    return 0;
  }
  const assessments = assessPermissions(["repository.read", "repository.write", "shell.execute"], ["repository.read"], defaultSecurityPolicy);
  console.log(JSON.stringify({ policy: defaultSecurityPolicy, overall: overallPermissionDecision(assessments), assessments }, null, 2));
  return 0;
}

async function manageGoals(command: string, args: string[]): Promise<number> {
  const goals = await loadProjectGoals();
  if (command === "goals" && (!args[0] || args[0] === "list")) {
    console.log(JSON.stringify(goals, null, 2));
    return 0;
  }
  if (args[0] === "add") {
    const id = args[1];
    const title = args.slice(2).filter((arg) => !arg.startsWith("--")).join(" ").trim();
    if (!id || !title) { console.error("Usage: aiskills goal add <id> <title>"); return 2; }
    const goal = defineGoal({ id, title, priority: "medium", milestones: [] });
    await saveProjectGoals([...goals.filter((existing) => existing.id !== id), goal]);
    console.log(`Goal saved: ${goal.id}`);
    return 0;
  }
  if (args[0] === "check") {
    const task = args.slice(1).join(" ").trim();
    if (!task) { console.error("Usage: aiskills goal check <task>"); return 2; }
    console.log(JSON.stringify(goals.map((goal) => assessGoalRelevance(task, goal)), null, 2));
    return 0;
  }
  console.error("Usage: aiskills goals | aiskills goal add <id> <title> | aiskills goal check <task>");
  return 2;
}

async function listWorkflows(args: string[]): Promise<number> {
  const registry = await WorkflowRegistry.fromDirectory(getBuiltInWorkflowsDirectory());
  const shouldExecute = args.includes("--execute");
  if (args[0] === "run") {
    const workflow = registry.get(args[1] ?? "");
    if (!workflow) { logger.error(`Workflow not found: ${args[1] ?? ""}`); return 2; }
    if (!shouldExecute) {
      console.log(JSON.stringify({ id: workflow.id, steps: workflow.steps, status: "READY_FOR_EXECUTION" }, null, 2));
      return 0;
    }
    const config = await loadUserConfig();
    const profile = config.profiles[config.activeProfile];
    const adapter = createBuiltInAdapters().find((candidate) => candidate.id === profile?.agents.primary);
    if (!adapter) { console.log(JSON.stringify({ id: workflow.id, status: "BLOCKED", reason: "No primary agent is configured." }, null, 2)); return 1; }
    const availability = await adapter.detect();
    if (availability.status !== "available") { console.log(JSON.stringify({ id: workflow.id, status: "BLOCKED", reason: availability.reason ?? "Agent unavailable." }, null, 2)); return 1; }
    const result = await adapter.execute({ prompt: `Execute workflow ${workflow.name} using these steps: ${workflow.steps.join(" → ")}`, workingDirectory: process.cwd(), readOnly: true, permissions: [...SAFE_READ_PERMISSIONS] });
    console.log(JSON.stringify({ id: workflow.id, status: result.status, message: result.message, output: result.output, steps: workflow.steps }, null, 2));
    return result.status === "completed" ? 0 : 1;
  }
  console.log(JSON.stringify(registry.list(), null, 2));
  return 0;
}

async function listTools(): Promise<number> {
  const registry = await ToolRegistry.fromDirectory(getBuiltInToolsDirectory());
  if (process.argv.includes("recommend")) console.log(JSON.stringify(recommendTools(registry, process.argv.slice(process.argv.indexOf("recommend") + 1)), null, 2));
  else console.log(JSON.stringify(await detectTools(registry), null, 2));
  return 0;
}

async function manageMemory(args: string[]): Promise<number> {
  if (!args[0] || args[0] === "list") {
    console.log(JSON.stringify(await loadMemoryRecords(), null, 2));
    return 0;
  }
  if (args[0] === "decision") {
    const decision = args.slice(1).join(" ").trim();
    if (!decision) { console.error("Usage: aiskills memory decision <decision text>"); return 2; }
    const record = createDecisionRecord({ id: `decision-${Date.now()}`, decision, reason: "Recorded by user", alternatives: [], confidence: "medium", revisitIf: [] });
    await appendMemoryRecord({ id: record.id, category: "decision", content: record.decision, createdAt: record.date });
    console.log(`Decision recorded: ${record.id}`);
    return 0;
  }
  if (args[0] === "retrospective") {
    const content = args.slice(1).join(" ").trim();
    if (!content) { console.error("Usage: aiskills memory retrospective <what worked / failed / wrong assumption / future avoidance>"); return 2; }
    const record = createRetrospective({ whatWorked: content, whatFailed: "", wrongAssumption: "", futureAvoidance: "" });
    await appendMemoryRecord(record);
    console.log(`Retrospective recorded: ${record.id}`);
    return 0;
  }
  console.error("Usage: aiskills memory | aiskills memory decision <text>");
  return 2;
}

async function manageReferences(args: string[]): Promise<number> {
  const scope: "user" | "project" = option(args, "scope") === "user" ? "user" : "project";
  const store = scope === "user" ? await ensureUserMemoryStore(getConfigPaths().root) : await ensureProjectMemoryStore();
  try {
    if (!args[0] || args[0] === "list") {
      console.log(JSON.stringify(store.listReferences(), null, 2));
      return 0;
    }
    if (args[0] === "add") {
      const url = args[1];
      if (!url) { console.error("Usage: aiskills reference add <url> [--type=design|backend|general] [--scope=user|project]"); return 2; }
      const reference = store.addReference({ url, scope, sourceType: (option(args.slice(2), "type") as "design" | "backend" | "general" | undefined) ?? "general" });
      console.log(JSON.stringify(reference, null, 2));
      return 0;
    }
    if (args[0] === "inspect") {
      const reference = store.getReference(args[1] ?? "");
      if (!reference) { logger.error("Reference not found"); return 2; }
      console.log(JSON.stringify(reference, null, 2));
      return 0;
    }
    if (args[0] === "search") {
      const query = args.slice(1).join(" ").trim();
      if (!query) { console.error("Usage: aiskills reference search <query>"); return 2; }
      console.log(JSON.stringify(store.searchReferences(query), null, 2));
      return 0;
    }
    console.error("Usage: aiskills reference add <url> | aiskills reference list | aiskills reference search <query> | aiskills reference inspect <id>");
    return 2;
  } finally { store.close(); }
}

async function managePreferences(args: string[]): Promise<number> {
  const store = await ensureProjectMemoryStore();
  try {
    if (!args[0] || args[0] === "list") {
      console.log(JSON.stringify(store.listPreferenceSignals(process.cwd()), null, 2));
      return 0;
    }
    if (args[0] === "add") {
      const category = args[1];
      const signal = args.slice(2).join(" ").trim();
      if (!category || !signal) { console.error("Usage: aiskills preference add <category> <signal>"); return 2; }
      console.log(JSON.stringify(store.addPreferenceSignal({ projectId: process.cwd(), category, signal, source: "explicit-user", confidence: 1 }), null, 2));
      return 0;
    }
    if (args[0] === "confirm" || args[0] === "reject") {
      if (!args[1]) { console.error(`Usage: aiskills preference ${args[0]} <id>`); return 2; }
      store.setPreferenceStatus(args[1], args[0] === "confirm" ? "promoted" : "rejected");
      console.log(`Preference ${args[0]}ed: ${args[1]}`);
      return 0;
    }
    console.error("Usage: aiskills preference list | add <category> <signal> | confirm <id> | reject <id>");
    return 2;
  } finally { store.close(); }
}

const invokedPath = process.argv[1];
const modulePath = fileURLToPath(import.meta.url);
if (invokedPath && realpathSync(invokedPath) === realpathSync(modulePath)) {
  process.exitCode = await run();
}
