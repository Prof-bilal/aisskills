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
import { openPackageCatalog, installSkillPackage, verifyPackage, planPackageActivation, writePackageLock, updateSkillPackage,resetProjectLock,packageRecoveryReport } from 'aiskills-core';
import { prepareCapability, capabilityLaunch } from 'aiskills-core';
import { spawn } from 'node:child_process';
import { prepareAgentSession, runAgentSession, buildSkillGuidance } from './session.js';
import { evaluateGuard } from './guard.js';
import { homedir } from 'node:os';
import { collectDiagnostics } from './doctor.js';
import { acquireReference,captureBrowserReference } from 'aiskills-core';

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
             add <local-path> | install <github-url> [--ref=value] [--path=value]
             inspect|review|enable|disable|remove|verify|history <id> [--yes]
             update <id> [--ref=value] [--dry-run]
             rollback <id> --digest=value
             prepare <id> [--entry=name] [--yes] | connect <id> [--entry=name]
             pin|unpin <id> | metrics
             sync-lock [--reset] | recover
  packs      List and manage skill packs
  profile    Create or activate a user profile
  plan       Create a task plan
  mcp        Serve AI Skills over MCP stdio (4 gateway tools; --full for all tools)
  run        Execute a task
  hook       Claude Code UserPromptSubmit hook: adds only the matched skills to the prompt
  guard      Claude Code PreToolUse hook: blocks network, secret and outside-project actions while user skills are active [--allow-host=host]
  session    Launch task-selected Codex/Claude configuration [--agent=codex|claude] [--dry-run] [--print] [--write] [--allow-network]
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
  if(command==='session') {
    const agent=option(argv,'agent')??'codex';
    if(agent!=='codex'&&agent!=='claude') {logger.error('Session agent must be codex or claude');return 2;}
    const task=argv.slice(1).filter(a=>!a.startsWith('--')).join(' ');
    const options={agent,task,project:process.cwd(),cliPath:fileURLToPath(import.meta.url),print:argv.includes('--print'),write:argv.includes('--write'),allowNetwork:argv.includes('--allow-network')} as const;
    try {if(argv.includes('--dry-run')) {const session=await prepareAgentSession(options);try{console.log(JSON.stringify({command:session.command,selected:session.selected,sandboxed:session.sandboxed,disabledMcp:session.disabledMcp,disabledPlugins:session.disabledPlugins,beforeHooks:session.before.length,afterHooks:session.after.length},null,2));}finally{await session.cleanup();}return 0;}return await runAgentSession(options);}catch(error){logger.error(error instanceof Error?error.message:String(error));return 1;}
  }
  if (command === 'add' || command === 'install') return manageInstalledSkills([command, ...argv.slice(1)]);

  if (!command || command === "--help" || command === "-h" || command === "help") {
    console.log(renderHelp());
    return 0;
  }

  if (command === "--version" || command === "-v") {
    console.log(getVersion());
    return 0;
  }

  if (command === "doctor") {
    const checks=await collectDiagnostics();
    if(argv.includes('--json'))console.log(JSON.stringify(checks,null,2));
    else {console.log('AI Skills Doctor\n');for(const c of checks)console.log(`${c.status} ${c.name}: ${c.detail}`);}
    return checks.some(c=>c.status==='FAIL')?1:0;
  }

  if (command === "skills") {
    if (argv[1] && argv[1] !== 'list') return manageInstalledSkills(argv.slice(1));
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
  if (command === "mcp") {
    const agent=option(argv,'session-agent');
    if(agent!==undefined&&agent!=='codex'&&agent!=='claude'){logger.error('Session agent must be codex or claude');return 2;}
    const allow=argv.includes('--allow-capability-execution'),deny=argv.includes('--deny-capability-execution');
    if(allow&&deny){logger.error('Conflicting capability execution options');return 2;}
    await serveMcp(await createLocalRuntime(), detectAgents, {compact:!argv.includes('--full'),agent,...(allow||deny?{allowExecution:allow}:{})}); return 0;
  }
  if (command === "hook") return promptHook();
  if (command === "guard") return guardHook(argv.slice(1));
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
    const catalog = await openPackageCatalog();
    try { for (const p of catalog.list()) console.log(`${p.id}  ${p.manifest.version}  ${p.status}  ${p.kind}`); } finally { catalog.close(); }
    return 0;
  } catch (error: unknown) {
    logger.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

async function manageInstalledSkills(args: string[]): Promise<number> {
  const catalog = await openPackageCatalog();
  try {
    const [action, id] = args;
    if(action==='metrics'){console.log(JSON.stringify(await catalog.telemetry(process.cwd()),null,2));return 0;}
    if(action==='recover'){console.log(JSON.stringify(await packageRecoveryReport(catalog),null,2));return 0;}
    if(action==='sync-lock'){if(args.slice(1).some(a=>a!=='--reset'))throw new Error('Usage: aiskills skills sync-lock [--reset]');if(args.includes('--reset'))console.log(JSON.stringify({backup:await resetProjectLock(catalog,process.cwd())}));else await writePackageLock(catalog,process.cwd());console.log('Project lock synchronized from reviewed catalog state.');return 0;}
    const allowedFlags = action==='add'||action==='install' ? ['--ref=','--path=','--yes','--dry-run'] : action==='update' ? ['--ref=','--dry-run'] : action==='rollback' ? ['--digest='] : action==='prepare'?['--entry=','--tools=','--executable=','--hosts=','--yes']:action==='connect'?['--entry=']:['--yes'];
    for(const flag of args.slice(2)) if(!allowedFlags.some(f=>f.endsWith('=')?flag.startsWith(f):flag===f)) throw new Error(`Unsupported option: ${flag}`);
    if (!id) throw new Error('Usage: aiskills skills add|install <source> or inspect|review|enable|disable|remove|verify <id>');
    if (action === 'add' || action === 'install') {
      const result = await installSkillPackage(catalog, {source:id,remote:action==='install',ref:option(args,'ref'),subdirectory:option(args,'path'),approve:args.includes('--yes'),dryRun:args.includes('--dry-run')});
      console.log(JSON.stringify(result,null,2));
      if(!args.includes('--dry-run') && result.status==='review-required') console.log(`Review with: aiskills skills review ${result.id} --yes; then enable with: aiskills skills enable ${result.id}`);
    } else if (action === 'enable' || action === 'disable') { await catalog.enable(id,process.cwd(),action==='enable'); await writePackageLock(catalog,process.cwd()); console.log(`${action}: ${id}`); }
    else if(action==='remove') { catalog.remove(id); await writePackageLock(catalog,process.cwd()); console.log(`Removed catalog registration: ${id}; content retained for recovery.`); }
    else if(action==='update') { console.log(JSON.stringify(await updateSkillPackage(catalog,id,{ref:option(args,'ref'),dryRun:args.includes('--dry-run')}),null,2)); if(!args.includes('--dry-run')) await writePackageLock(catalog,process.cwd()); }
    else if(action==='history') console.log(JSON.stringify(catalog.history(id),null,2));
    else if(action==='pin'||action==='unpin'){await catalog.pin(id,process.cwd(),action==='pin');console.log(`${action}: ${id}`);}
    else if(action==='prepare') console.log(JSON.stringify(await prepareCapability(catalog,id,args.includes('--yes'),option(args,'entry'),{tools:splitOption(args,'tools'),executable:option(args,'executable'),hosts:splitOption(args,'hosts')}),null,2));
    else if(action==='connect') {
      const launch=await capabilityLaunch(catalog,id,option(args,'entry'));
      return await new Promise<number>((resolve,reject)=>{const child=spawn(launch.command,launch.args,{stdio:'inherit'});child.once('error',reject);child.once('exit',code=>resolve(code??1));});
    }
    else if(action==='rollback') { const digest=option(args,'digest'); if(!digest) throw new Error('--digest is required'); await catalog.rollback(id,digest); await writePackageLock(catalog,process.cwd()); console.log('Rolled back; review and enable again before use.'); }
    else if(action==='inspect' || action==='review' || action==='verify') {
      const p=catalog.get(id); await verifyPackage(p);
      if(action==='review' && args.includes('--yes')) { if(p.findings.some(f=>f.severity==='high'||f.severity==='blocker')) throw new Error('Remediate high-risk findings before approval'); p.status='approved'; catalog.save(p); }
      console.log(JSON.stringify(p,null,2));
    } else throw new Error(`Unsupported skill command: ${action}`);
    return 0;
  } catch(error) { logger.error(error instanceof Error?error.message:String(error)); return 1; } finally { catalog.close(); }
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
  const catalog = await openPackageCatalog();
  try { const activation = await planPackageActivation(catalog, context.root, task); plan.selectedSkills = [...new Set([...plan.selectedSkills,...activation.selectedPackages])]; console.log(JSON.stringify({activation},null,2)); } finally { catalog.close(); }
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
      console.log(JSON.stringify({reference,artifacts:store.referenceArtifacts(reference.id)}, null, 2));
      return 0;
    }
    if(args[0]==='fetch') {if(!args[1])throw new Error('Usage: aiskills reference fetch <id>');console.log(JSON.stringify(await acquireReference(store,args[1]),null,2));return 0;}
    if(args[0]==='capture') {if(!args[1])throw new Error('Usage: aiskills reference capture <id> [--asset-hosts=cdn.example.com]');console.log(JSON.stringify(await captureBrowserReference(store,args[1],splitOption(args,'asset-hosts')??[]),null,2));return 0;}
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

/** Claude Code UserPromptSubmit hook: routes the prompt and adds only matched skill text, with no extra agent turns. */
async function promptHook(): Promise<number> {
  let input: { prompt?: unknown; cwd?: unknown };
  try {
    const chunks: Buffer[] = []; let size = 0;
    for await (const chunk of process.stdin) { size += chunk.length; if (size > 1024 * 1024) throw new Error('Hook input exceeds 1 MiB'); chunks.push(chunk as Buffer); }
    input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch (error) { logger.error(`Invalid hook input: ${error instanceof Error ? error.message : String(error)}`); return 1; }
  if (typeof input.prompt !== 'string' || !input.prompt.trim() || input.prompt.length > 32000) return 0;
  const project = typeof input.cwd === 'string' ? input.cwd : process.cwd();
  const catalog = await openPackageCatalog();
  try {
    const plan = await planPackageActivation(catalog, project, input.prompt, { agent: 'claude' });
    if (!plan.selectedPackages.length && !plan.builtinSkills.length) return 0;
    const { guidance } = await buildSkillGuidance(catalog, plan, input.prompt, 'claude');
    process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: `Task-selected skill guidance (AI Skills):\n${guidance.join('\n\n')}` } }));
    return 0;
  } catch (error) {
    // Fail open: a routing problem must not block the user's prompt; it only means no guidance this turn.
    logger.error(`AI Skills hook skipped: ${error instanceof Error ? error.message : String(error)}`);
    return 0;
  } finally { catalog.close(); }
}

/** Claude Code PreToolUse hook. Active only when user-installed skills are enabled for the project; built-in-only use is untouched. */
async function guardHook(args: string[]): Promise<number> {
  let input: { tool_name?: unknown; tool_input?: unknown; cwd?: unknown };
  try {
    const chunks: Buffer[] = []; let size = 0;
    for await (const chunk of process.stdin) { size += chunk.length; if (size > 1024 * 1024) throw new Error('Hook input exceeds 1 MiB'); chunks.push(chunk as Buffer); }
    input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch (error) { logger.error(`Guard blocked the call: invalid hook input (${error instanceof Error ? error.message : String(error)})`); return 2; }
  if (typeof input.tool_name !== 'string') return 0;
  const cwd = typeof input.cwd === 'string' ? input.cwd : process.cwd();
  const catalog = await openPackageCatalog();
  let userSkills = 0;
  try { userSkills = (await catalog.active(cwd)).length; } catch { userSkills = 1; /* cannot read the catalog: stay protective */ } finally { catalog.close(); }
  if (!userSkills) return 0;
  const allowHosts = args.filter(a => a.startsWith('--allow-host=')).map(a => a.slice(13).toLowerCase());
  const toolInput = input.tool_input && typeof input.tool_input === 'object' ? input.tool_input as Record<string, unknown> : {};
  const reason = evaluateGuard({ tool: input.tool_name, input: toolInput, cwd, home: homedir(), allowHosts });
  if (reason) process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: `AI Skills guard: ${reason}` } }));
  return 0;
}
