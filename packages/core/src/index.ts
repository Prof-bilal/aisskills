import { homedir, platform } from "node:os";
import { join } from "node:path";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, extname } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { parse as parseYaml } from "yaml";

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface Logger {
  debug(message: string, data?: Record<string, unknown>): void;
  info(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
  error(message: string, data?: Record<string, unknown>): void;
}

export interface ConfigPaths {
  root: string;
  configFile: string;
  profilesDirectory: string;
}

export interface RuntimeConfig {
  schemaVersion: 1;
  mode: "ask" | "auto-safe" | "review-first";
}

export function getConfigPaths(environment: NodeJS.ProcessEnv = process.env): ConfigPaths {
  const override = environment.AI_SKILLS_HOME;
  const root = override ?? defaultConfigRoot(environment);

  return {
    root,
    configFile: join(root, "config.json"),
    profilesDirectory: join(root, "profiles")
  };
}

export interface Profile {
  name: string;
  agents: {
    primary: string | null;
    fallback: string[];
  };
  packs: string[];
  mode: RuntimeConfig["mode"];
}

export interface UserConfig {
  schemaVersion: 1;
  activeProfile: string;
  profiles: Record<string, Profile>;
}

export function defaultProfile(name = "default", agents: string[] = []): Profile {
  return {
    name,
    agents: { primary: agents[0] ?? null, fallback: agents.slice(1) },
    packs: ["core"],
    mode: "auto-safe"
  };
}

export function defaultUserConfig(): UserConfig {
  return { schemaVersion: 1, activeProfile: "default", profiles: { default: defaultProfile() } };
}

export async function loadUserConfig(paths = getConfigPaths()): Promise<UserConfig> {
  try {
    const source = await readFile(paths.configFile, "utf8");
    const value = JSON.parse(source) as UserConfig;
    if (value.schemaVersion !== 1 || !value.profiles || !value.activeProfile) throw new Error("invalid config schema");
    return value;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return defaultUserConfig();
    throw new Error(`Unable to read ${paths.configFile}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function saveUserConfig(config: UserConfig, paths = getConfigPaths()): Promise<void> {
  await mkdir(dirname(paths.configFile), { recursive: true });
  await writeFile(paths.configFile, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

export async function saveProjectConfig(root: string, profile: Profile): Promise<string> {
  const directory = join(root, ".ai");
  const file = join(directory, "config.json");
  await mkdir(directory, { recursive: true });
  await writeFile(file, `${JSON.stringify({ schemaVersion: 1, project: { profile } }, null, 2)}\n`, "utf8");
  return file;
}

export interface EvidenceFact<T> {
  value: T;
  status: "VERIFIED" | "SUPPORTED" | "UNKNOWN";
  evidence: string[];
}

export interface ProjectContext {
  root: string;
  files: string[];
  languages: EvidenceFact<string[]>;
  frameworks: EvidenceFact<string[]>;
  packageManager: EvidenceFact<string | null>;
  testRunners: EvidenceFact<string[]>;
  databases: EvidenceFact<string[]>;
  monorepo: EvidenceFact<boolean>;
}

export async function detectProjectContext(root = process.cwd()): Promise<ProjectContext> {
  const entries = await readdir(root, { withFileTypes: true });
  const files = entries.filter((entry) => entry.isFile()).map((entry) => entry.name).sort();
  const directories = new Set(entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name));
  const fileSet = new Set(files);
  const languages = new Set<string>();
  const frameworks = new Set<string>();
  const testRunners = new Set<string>();
  const databases = new Set<string>();
  const languageEvidence: string[] = [];
  const frameworkEvidence: string[] = [];
  const testEvidence: string[] = [];
  const databaseEvidence: string[] = [];
  let packageManager: string | null = null;
  let packageManagerEvidence: string[] = [];

  for (const file of files) {
    const extension = extname(file);
    if (extension === ".ts" || extension === ".tsx") languages.add("TypeScript");
    if (extension === ".js" || extension === ".jsx" || extension === ".mjs" || extension === ".cjs") languages.add("JavaScript");
    if (extension === ".py") languages.add("Python");
    if (extension === ".go") languages.add("Go");
    if (extension === ".rs") languages.add("Rust");
    if (extension === ".cs") languages.add("C#");
  }
  if (fileSet.has("package.json")) {
    languages.add("JavaScript");
    const packageJson = JSON.parse(await readFile(join(root, "package.json"), "utf8")) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    const dependencies = { ...packageJson.dependencies, ...packageJson.devDependencies };
    for (const dependency of Object.keys(dependencies)) {
      if (dependency === "typescript") languages.add("TypeScript");
      if (dependency === "next") frameworks.add("Next.js");
      if (dependency === "react") frameworks.add("React");
      if (dependency === "vue") frameworks.add("Vue");
      if (dependency === "svelte") frameworks.add("Svelte");
      if (dependency === "express") frameworks.add("Express");
      if (dependency === "fastify") frameworks.add("Fastify");
      if (["vitest", "jest", "mocha", "ava"].includes(dependency)) testRunners.add(dependency);
      if (dependency === "prisma" || dependency === "@prisma/client") databases.add("Prisma");
      if (dependency === "mongoose") databases.add("MongoDB");
      if (dependency === "pg" || dependency === "postgres") databases.add("PostgreSQL");
    }
    if (fileSet.has("pnpm-lock.yaml") || fileSet.has("pnpm-workspace.yaml")) packageManager = "pnpm";
    else if (fileSet.has("yarn.lock")) packageManager = "yarn";
    else if (fileSet.has("bun.lock") || fileSet.has("bun.lockb")) packageManager = "bun";
    else if (fileSet.has("package-lock.json")) packageManager = "npm";
    if (packageManager) packageManagerEvidence = [packageManager === "pnpm" ? "package.json plus pnpm lock/workspace file" : `${packageManager} lockfile`];
  }
  if (fileSet.has("pyproject.toml") || fileSet.has("requirements.txt")) languages.add("Python");
  if (fileSet.has("go.mod")) languages.add("Go");
  if (fileSet.has("Cargo.toml")) languages.add("Rust");
  if (fileSet.has("Dockerfile") || fileSet.has("docker-compose.yml") || fileSet.has("compose.yml")) frameworks.add("Docker");

  for (const file of files) {
    if (/^(vitest|jest|mocha|ava)\.config\./.test(file)) testRunners.add(file.split(".")[0]);
  }
  for (const language of languages) languageEvidence.push(`repository file or manifest indicates ${language}`);
  for (const framework of frameworks) frameworkEvidence.push(`dependency or project file indicates ${framework}`);
  for (const runner of testRunners) testEvidence.push(`test configuration or dependency indicates ${runner}`);
  for (const database of databases) databaseEvidence.push(`dependency indicates ${database}`);

  const monorepo = fileSet.has("pnpm-workspace.yaml") || fileSet.has("lerna.json") || fileSet.has("nx.json") || directories.has("packages") || directories.has("apps");
  return {
    root,
    files,
    languages: { value: [...languages].sort(), status: languages.size ? "VERIFIED" : "UNKNOWN", evidence: languageEvidence },
    frameworks: { value: [...frameworks].sort(), status: frameworks.size ? "SUPPORTED" : "UNKNOWN", evidence: frameworkEvidence },
    packageManager: { value: packageManager, status: packageManager ? "VERIFIED" : "UNKNOWN", evidence: packageManagerEvidence },
    testRunners: { value: [...testRunners].sort(), status: testRunners.size ? "SUPPORTED" : "UNKNOWN", evidence: testEvidence },
    databases: { value: [...databases].sort(), status: databases.size ? "SUPPORTED" : "UNKNOWN", evidence: databaseEvidence },
    monorepo: { value: monorepo, status: monorepo ? "SUPPORTED" : "UNKNOWN", evidence: monorepo ? ["workspace marker or apps/packages directory found"] : [] }
  };
}

function defaultConfigRoot(environment: NodeJS.ProcessEnv): string {
  if (platform() === "win32") {
    return join(environment.APPDATA ?? join(homedir(), "AppData", "Roaming"), "aiskills");
  }

  if (platform() === "darwin") {
    return join(homedir(), "Library", "Application Support", "aiskills");
  }

  return join(environment.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "aiskills");
}

export function defaultRuntimeConfig(): RuntimeConfig {
  return { schemaVersion: 1, mode: "auto-safe" };
}

export function createLogger(level: LogLevel = "info"): Logger {
  const order: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };
  const threshold = order[level];

  const write = (messageLevel: LogLevel, message: string, data?: Record<string, unknown>) => {
    if (order[messageLevel] < threshold) return;
    const suffix = data ? ` ${JSON.stringify(data)}` : "";
    const line = `[${messageLevel.toUpperCase()}] ${message}${suffix}`;
    if (messageLevel === "error" || messageLevel === "warn") console.error(line);
    else console.log(line);
  };

  return {
    debug: (message, data) => write("debug", message, data),
    info: (message, data) => write("info", message, data),
    warn: (message, data) => write("warn", message, data),
    error: (message, data) => write("error", message, data)
  };
}

export function getVersion(): string {
  return "0.1.0";
}

export type ClaimState = "VERIFIED" | "SUPPORTED" | "LIKELY" | "UNVERIFIED" | "CONTRADICTED" | "UNKNOWN";
export type EvidenceKind = "supports" | "contradicts";
export type EvidenceSource =
  | "runtime"
  | "automated-test"
  | "repository-source"
  | "logs-traces"
  | "installed-package"
  | "official-documentation"
  | "reliable-external"
  | "user-statement"
  | "ai-assumption";

export interface EvidenceRecord {
  id: string;
  kind: EvidenceKind;
  source: EvidenceSource;
  reference: string;
  summary: string;
  confidence: number;
}

export interface Claim {
  id: string;
  text: string;
  state: ClaimState;
  evidence: EvidenceRecord[];
}

const evidencePriority: Record<EvidenceSource, number> = {
  runtime: 100,
  "automated-test": 90,
  "repository-source": 80,
  "logs-traces": 70,
  "installed-package": 60,
  "official-documentation": 50,
  "reliable-external": 40,
  "user-statement": 20,
  "ai-assumption": 10
};

const execFileCore = promisify(execFile);

export function createClaim(text: string, id = `claim-${Date.now()}`): Claim {
  if (!text.trim()) throw new Error("claim text cannot be empty");
  return { id, text: text.trim(), state: "UNVERIFIED", evidence: [] };
}

export function recordEvidence(claim: Claim, evidence: EvidenceRecord): Claim {
  if (!evidence.summary.trim()) throw new Error("evidence summary cannot be empty");
  if (!evidence.reference.trim()) throw new Error("evidence reference cannot be empty");
  if (!(evidence.source in evidencePriority)) throw new Error(`unsupported evidence source: ${evidence.source}`);
  if (evidence.confidence < 0 || evidence.confidence > 1) throw new Error("evidence confidence must be between 0 and 1");
  return { ...claim, evidence: [...claim.evidence, evidence], state: evaluateClaim([...claim.evidence, evidence]) };
}

export function evaluateClaim(evidence: EvidenceRecord[]): ClaimState {
  if (!evidence.length) return "UNVERIFIED";
  const supporting = evidence.filter((item) => item.kind === "supports");
  const contradicting = evidence.filter((item) => item.kind === "contradicts");
  const bestSupport = strongestEvidence(supporting);
  const bestContradiction = strongestEvidence(contradicting);

  if (!bestSupport && !bestContradiction) return "UNKNOWN";
  if (bestContradiction && (!bestSupport || bestContradiction.score >= bestSupport.score)) return "CONTRADICTED";
  if (!bestSupport) return "UNKNOWN";
  if (bestSupport.source === "runtime" || bestSupport.source === "automated-test") return "VERIFIED";
  if (["repository-source", "logs-traces", "installed-package"].includes(bestSupport.source)) return "SUPPORTED";
  if (["official-documentation", "reliable-external"].includes(bestSupport.source)) return "LIKELY";
  return "UNVERIFIED";
}

export type TaskKind = "verification" | "bug-fix" | "feature" | "research" | "general";

export interface TaskAnalysis {
  task: string;
  kind: TaskKind;
  capabilities: string[];
  claimsToVerify: string[];
  assumptions: string[];
}

export interface TaskPlan {
  task: string;
  workflow: string;
  facts: string[];
  assumptions: string[];
  claimsToVerify: string[];
  selectedSkills: string[];
  steps: string[];
  successCriteria: string[];
}

export function analyzeTask(task: string): TaskAnalysis {
  const normalized = task.trim().toLowerCase();
  if (!normalized) throw new Error("task cannot be empty");
  const claimsToVerify: string[] = [];
  if (/(complete|complete|works|secure|causing|exists|implemented|done|finished)/.test(normalized)) claimsToVerify.push(task.trim());

  let kind: TaskKind = "general";
  if (/(verify|check|review|complete|secure|audit)/.test(normalized)) kind = "verification";
  else if (/(bug|fix|failure|broken|error|regression)/.test(normalized)) kind = "bug-fix";
  else if (/(research|compare|evaluate|investigate)/.test(normalized)) kind = "research";
  else if (/(build|create|implement|add|develop|change)/.test(normalized)) kind = "feature";

  const capabilities = new Set<string>();
  if (/(auth|login|permission|security|secure|secret|token|threat|vulnerab)/.test(normalized)) capabilities.add("security-review");
  if (/(auth|login|token|session|credential)/.test(normalized)) capabilities.add("authentication");
  if (/(permission|role|authorization|access control|privilege)/.test(normalized)) capabilities.add("authorization");
  if (/(secret|credential|api key|password)/.test(normalized)) capabilities.add("secrets");
  if (/(validate|validation|sanitize|parser|injection)/.test(normalized)) capabilities.add("input-validation");
  if (/(prompt injection|untrusted instruction|jailbreak)/.test(normalized)) capabilities.add("prompt-injection");
  if (/(screenshot|ui|interface|frontend|page|responsive|visual|accessibility)/.test(normalized)) capabilities.add("frontend");
  if (/(api|backend|server|service|endpoint)/.test(normalized)) capabilities.add("backend");
  if (/(api|endpoint|http|graphql|route)/.test(normalized)) capabilities.add("api-security");
  if (/(database|schema|sql|mongo|postgres|query|migration)/.test(normalized)) capabilities.add("database");
  if (/(dependency|package|supply chain|lockfile)/.test(normalized)) capabilities.add("dependency-security");
  if (/(agent|mcp|tool permission|delegat)/.test(normalized)) capabilities.add("agent-security");
  if (/(research|compare|evaluate|investigate|source|literature)/.test(normalized)) capabilities.add("research");
  if (/(brainstorm|ideas|ideate|options)/.test(normalized)) capabilities.add("ideation");
  if (/(product|startup|market|user need|priorit)/.test(normalized)) capabilities.add("product-thinking");
  if (/(architecture|system design|tradeoff|technology choice|tech stack)/.test(normalized)) capabilities.add("architecture");
  if (/(test|qa|quality|regression|integration)/.test(normalized)) capabilities.add("qa");
  if (/(code review|review this change|pull request)/.test(normalized)) capabilities.add("code-review");
  if (/(requirement|acceptance criteria|specification)/.test(normalized)) capabilities.add("requirements");
  if (claimsToVerify.length) capabilities.add("claim-verification");

  return {
    task: task.trim(),
    kind,
    capabilities: [...capabilities],
    claimsToVerify,
    assumptions: ["Repository state and existing implementation must be inspected before changes are proposed."]
  };
}

export function routeSkills(analysis: TaskAnalysis, availableSkillIds: string[]): string[] {
  const available = new Set(availableSkillIds);
  const selected: string[] = [];
  const add = (id: string) => {
    if (available.has(id) && !selected.includes(id)) selected.push(id);
  };
  add("repo-explorer");
  add("planner");
  if (analysis.claimsToVerify.length || analysis.capabilities.includes("claim-verification") || analysis.capabilities.includes("security-review")) add("evidence-first");

  const capabilityRoutes: Record<string, string[]> = {
    "security-review": ["security-reviewer", "threat-model"],
    authentication: ["auth-security"],
    authorization: ["authorization-security"],
    secrets: ["secrets-review"],
    "input-validation": ["input-validation"],
    "api-security": ["api-security"],
    "prompt-injection": ["prompt-injection-review"],
    "frontend": ["frontend-engineer", "ui-designer"],
    "backend": ["backend-engineer", "fullstack-engineer"],
    "database": ["database-architect"],
    "dependency-security": ["dependency-security"],
    "agent-security": ["agent-security"],
    research: ["researcher"],
    ideation: ["brainstorm"],
    "product-thinking": ["product-engineer", "idea-validator", "feature-prioritizer"],
    architecture: ["architecture-review", "tech-stack-selector"],
    qa: ["qa-engineer", "regression-checker", "integration-verifier"],
    "code-review": ["code-reviewer"],
    requirements: ["requirements-checker"]
  };
  for (const capability of analysis.capabilities) for (const skill of capabilityRoutes[capability] ?? []) add(skill);
  if (analysis.kind === "bug-fix") add("simplify");
  if (analysis.kind === "feature" && analysis.capabilities.includes("frontend") && analysis.capabilities.includes("backend")) add("fullstack-engineer");
  if (analysis.kind !== "research") add("completion-checker");
  return selected;
}

export function createTaskPlan(task: string, context: ProjectContext | null, availableSkillIds: string[]): TaskPlan {
  const analysis = analyzeTask(task);
  const facts = context
    ? [
        `Project root: ${context.root}`,
        `Languages: ${context.languages.value.join(", ") || "unknown"} (${context.languages.status})`,
        `Frameworks: ${context.frameworks.value.join(", ") || "unknown"} (${context.frameworks.status})`,
        `Package manager: ${context.packageManager.value ?? "unknown"} (${context.packageManager.status})`
      ]
    : [];
  const workflow = analysis.kind === "verification" ? "verification" : analysis.kind === "bug-fix" ? "bug-fix" : analysis.kind === "feature" ? "feature-development" : "general-investigation";
  const steps = ["inspect repository and project context", "separate verified facts from assumptions"];
  if (analysis.claimsToVerify.length) steps.push("verify claims against repository, tests, and runtime evidence");
  if (analysis.kind === "feature" || analysis.kind === "bug-fix") steps.push("plan and implement only confirmed changes");
  steps.push("run proportional checks and report evidence");
  return {
    task: analysis.task,
    workflow,
    facts,
    assumptions: analysis.assumptions,
    claimsToVerify: analysis.claimsToVerify,
    selectedSkills: routeSkills(analysis, availableSkillIds),
    steps,
    successCriteria: ["requested outcome is checked against repository evidence", "unverified work is reported explicitly"]
  };
}

export interface ExecutionNode<T> {
  id: string;
  dependsOn?: string[];
  run: () => Promise<T>;
}

export interface ExecutionGraphResult<T> {
  completed: string[];
  results: Record<string, T>;
}

export async function executeTaskGraph<T>(nodes: ExecutionNode<T>[], parallelism = 1): Promise<ExecutionGraphResult<T>> {
  if (parallelism < 1 || !Number.isInteger(parallelism)) throw new Error("parallelism must be a positive integer");
  const byId = new Map(nodes.map((node) => [node.id, node]));
  if (byId.size !== nodes.length) throw new Error("duplicate execution node ID");
  for (const node of nodes) {
    for (const dependency of node.dependsOn ?? []) if (!byId.has(dependency)) throw new Error(`missing execution dependency: ${dependency}`);
  }

  const completed: string[] = [];
  const results: Record<string, T> = {};
  const remaining = new Set(nodes.map((node) => node.id));
  while (remaining.size) {
    const ready = [...remaining].filter((id) => (byId.get(id)?.dependsOn ?? []).every((dependency) => completed.includes(dependency)));
    if (!ready.length) throw new Error("cyclic or blocked execution dependencies");
    for (let index = 0; index < ready.length; index += parallelism) {
      const batch = ready.slice(index, index + parallelism);
      const values = await Promise.all(batch.map(async (id) => [id, await byId.get(id)!.run()] as const));
      for (const [id, result] of values) {
        results[id] = result;
        completed.push(id);
        remaining.delete(id);
      }
    }
  }
  return { completed, results };
}

export type VerificationCheckStatus = "PASS" | "FAIL" | "SKIPPED";
export type CompletionStatus = "COMPLETE" | "PARTIALLY VERIFIED" | "IMPLEMENTED BUT UNVERIFIED" | "BLOCKED" | "FAILED" | "NEEDS USER ACTION";

export interface VerificationCheck {
  id: string;
  category: "static" | "test" | "security" | "requirements" | "adversarial" | "goal";
  status: VerificationCheckStatus;
  summary: string;
  evidence?: string[];
}

export interface VerificationReport {
  task: string;
  status: CompletionStatus;
  checks: VerificationCheck[];
  evidence: EvidenceRecord[];
  nextActions: string[];
}

export function createVerificationReport(task: string, checks: VerificationCheck[], evidence: EvidenceRecord[] = []): VerificationReport {
  if (!task.trim()) throw new Error("verification task cannot be empty");
  const failed = checks.some((check) => check.status === "FAIL");
  const skipped = checks.some((check) => check.status === "SKIPPED");
  const passed = checks.length > 0 && checks.every((check) => check.status === "PASS");
  const status: CompletionStatus = failed
    ? "FAILED"
    : passed
      ? "COMPLETE"
      : skipped
        ? "PARTIALLY VERIFIED"
        : "IMPLEMENTED BUT UNVERIFIED";
  const nextActions = checks.filter((check) => check.status !== "PASS").map((check) => `${check.id}: ${check.summary}`);
  return { task: task.trim(), status, checks, evidence, nextActions };
}

export type PermissionDecision = "ALLOW" | "REQUIRES_APPROVAL" | "DENY";
export type RiskLevel = "low" | "medium" | "high";

export interface PermissionAssessment {
  permission: string;
  decision: PermissionDecision;
  risk: RiskLevel;
  reason: string;
}

export interface SecurityPolicy {
  minimumPermissions: boolean;
  autoApproveReadOnly: boolean;
}

export const defaultSecurityPolicy: SecurityPolicy = {
  minimumPermissions: true,
  autoApproveReadOnly: true
};

const highRiskPermissions = new Set(["secrets.read", "network.write", "system.modify", "deployment.execute", "database.write"]);
const mediumRiskPermissions = new Set(["repository.write", "git.write", "shell.execute", "package.install", "database.read", "network.read", "browser.use"]);

export function assessPermissions(requested: string[], granted: string[] = [], policy = defaultSecurityPolicy): PermissionAssessment[] {
  const grantedSet = new Set(granted);
  return [...new Set(requested)].map((permission) => {
    const risk: RiskLevel = highRiskPermissions.has(permission) ? "high" : mediumRiskPermissions.has(permission) ? "medium" : "low";
    if (!grantedSet.has(permission)) return { permission, decision: "DENY", risk, reason: "Permission was not granted by the active policy." };
    if (policy.minimumPermissions && permission === "secrets.read") return { permission, decision: "DENY", risk, reason: "Secret access is denied by minimum-permission policy." };
    if (risk === "high") return { permission, decision: "REQUIRES_APPROVAL", risk, reason: "High-risk permission requires explicit approval." };
    if (risk === "medium") return { permission, decision: "REQUIRES_APPROVAL", risk, reason: "Permission can change state or access external systems." };
    return { permission, decision: "ALLOW", risk, reason: "Low-risk permission is allowed by the active policy." };
  });
}

export function overallPermissionDecision(assessments: PermissionAssessment[]): PermissionDecision {
  if (assessments.some((assessment) => assessment.decision === "DENY")) return "DENY";
  if (assessments.some((assessment) => assessment.decision === "REQUIRES_APPROVAL")) return "REQUIRES_APPROVAL";
  return "ALLOW";
}

export interface ExtensionReview {
  kind: "declarative-skill" | "executable-plugin";
  risk: RiskLevel;
  decision: PermissionDecision;
  permissions: PermissionAssessment[];
  warning: string;
}

export function reviewExtensionInstallation(kind: ExtensionReview["kind"], requestedPermissions: string[]): ExtensionReview {
  const assessments = assessPermissions(requestedPermissions, [], defaultSecurityPolicy);
  const hasHighRisk = assessments.some((assessment) => assessment.risk === "high");
  const risk: RiskLevel = kind === "executable-plugin" || hasHighRisk ? "high" : assessments.some((assessment) => assessment.risk === "medium") ? "medium" : "low";
  return {
    kind,
    risk,
    decision: overallPermissionDecision(assessments),
    permissions: assessments,
    warning: kind === "executable-plugin" ? "Executable plugins require explicit review before installation or execution." : "Declarative skills contain instructions and metadata but do not execute code."
  };
}

export interface PromptInjectionFinding {
  pattern: string;
  summary: string;
  severity: "medium" | "high";
}

export function scanUntrustedContent(content: string): PromptInjectionFinding[] {
  const findings: PromptInjectionFinding[] = [];
  const patterns: Array<[RegExp, string, PromptInjectionFinding["severity"]]> = [
    [/ignore\s+(all|any|the)\s+previous\s+instructions?/i, "Attempts to override trusted instructions", "high"],
    [/(read|cat|exfiltrate|upload).{0,40}(\.ssh|id_rsa|credentials|secrets?)/i, "Attempts to access or disclose credentials", "high"],
    [/you\s+are\s+now\s+(the|a)\s+/i, "Attempts to redefine agent identity or authority", "medium"],
    [/system\s+message\s*:/i, "Content impersonates a system message", "medium"]
  ];
  for (const [pattern, summary, severity] of patterns) if (pattern.test(content)) findings.push({ pattern: pattern.source, summary, severity });
  return findings;
}

export interface ProjectGoal {
  id: string;
  title: string;
  metrics?: Record<string, number>;
  deadline?: string;
  priority: "low" | "medium" | "high" | "critical";
  milestones: string[];
}

export type GoalRelevance = "HIGH" | "MEDIUM" | "LOW" | "UNKNOWN";

export interface GoalAssessment {
  goalId: string;
  relevance: GoalRelevance;
  reason: string;
}

export interface MemoryRecord {
  id: string;
  category: "preference" | "verified-fact" | "decision" | "observation" | "candidate-learning";
  content: string;
  evidence?: string[];
  createdAt: string;
}

export interface DecisionRecord {
  id: string;
  decision: string;
  reason: string;
  alternatives: string[];
  confidence: "low" | "medium" | "high";
  revisitIf: string[];
  date: string;
}

export interface CandidateLearning {
  pattern: string;
  evidenceCount: number;
  status: "candidate" | "promoted";
}

export function defineGoal(goal: ProjectGoal): ProjectGoal {
  if (!ID_PATTERN.test(goal.id)) throw new Error(`Invalid goal ID: ${goal.id}`);
  if (!goal.title.trim()) throw new Error("Goal title cannot be empty");
  if (!["low", "medium", "high", "critical"].includes(goal.priority)) throw new Error("Invalid goal priority");
  return { ...goal, milestones: [...goal.milestones] };
}

export function assessGoalRelevance(task: string, goal: ProjectGoal): GoalAssessment {
  const taskWords = new Set(task.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length > 3));
  const goalWords = new Set(goal.title.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length > 3));
  const overlap = [...taskWords].filter((word) => goalWords.has(word));
  const milestoneMatch = goal.milestones.find((milestone) => task.toLowerCase().includes(milestone.toLowerCase()));
  if (milestoneMatch) return { goalId: goal.id, relevance: "HIGH", reason: `Task directly matches milestone: ${milestoneMatch}.` };
  if (!overlap.length) return { goalId: goal.id, relevance: "LOW", reason: "No meaningful task terms overlap with the active goal." };
  if (overlap.length >= 2) {
    return { goalId: goal.id, relevance: "HIGH", reason: `Task overlaps with goal terms: ${overlap.join(", ")}.` };
  }
  return { goalId: goal.id, relevance: "MEDIUM", reason: `Task overlaps with goal term: ${overlap[0]}.` };
}

export function createCandidateLearning(pattern: string, evidenceCount = 1): CandidateLearning {
  if (!pattern.trim()) throw new Error("learning pattern cannot be empty");
  return { pattern: pattern.trim(), evidenceCount, status: evidenceCount >= 3 ? "promoted" : "candidate" };
}

export function addLearningEvidence(learning: CandidateLearning): CandidateLearning {
  return { ...learning, evidenceCount: learning.evidenceCount + 1, status: learning.evidenceCount + 1 >= 3 ? "promoted" : "candidate" };
}

export async function loadProjectGoals(root = process.cwd()): Promise<ProjectGoal[]> {
  const file = join(root, ".ai", "goals.json");
  try { return JSON.parse(await readFile(file, "utf8")) as ProjectGoal[]; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
}

export async function saveProjectGoals(goals: ProjectGoal[], root = process.cwd()): Promise<void> {
  const directory = join(root, ".ai");
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, "goals.json"), `${JSON.stringify(goals, null, 2)}\n`, "utf8");
}

export function createDecisionRecord(decision: Omit<DecisionRecord, "date"> & { date?: string }): DecisionRecord {
  if (!decision.decision.trim() || !decision.reason.trim()) throw new Error("decision and reason are required");
  return { ...decision, date: decision.date ?? new Date().toISOString().slice(0, 10) };
}

export async function loadMemoryRecords(root = process.cwd()): Promise<MemoryRecord[]> {
  try { return JSON.parse(await readFile(join(root, ".ai", "memory.json"), "utf8")) as MemoryRecord[]; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
}

export async function saveMemoryRecords(records: MemoryRecord[], root = process.cwd()): Promise<void> {
  const directory = join(root, ".ai");
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, "memory.json"), `${JSON.stringify(records, null, 2)}\n`, "utf8");
}

export async function appendMemoryRecord(record: MemoryRecord, root = process.cwd()): Promise<void> {
  await saveMemoryRecords([...(await loadMemoryRecords(root)), record], root);
}

export interface Retrospective {
  whatWorked: string;
  whatFailed: string;
  wrongAssumption: string;
  futureAvoidance: string;
}

export function createRetrospective(retrospective: Retrospective): MemoryRecord {
  return {
    id: `retrospective-${Date.now()}`,
    category: "observation",
    content: JSON.stringify(retrospective),
    createdAt: new Date().toISOString()
  };
}

function strongestEvidence(records: EvidenceRecord[]): (EvidenceRecord & { score: number }) | null {
  if (!records.length) return null;
  return records
    .map((record) => ({ ...record, score: evidencePriority[record.source] * record.confidence }))
    .sort((a, b) => b.score - a.score)[0] ?? null;
}

export const SUPPORTED_SKILL_SCHEMA_VERSION = 1;
export const VALID_PERMISSIONS = new Set([
  "repository.read",
  "repository.write",
  "git.read",
  "git.write",
  "shell.execute",
  "network.read",
  "network.write",
  "browser.use",
  "database.read",
  "database.write",
  "package.install",
  "system.modify",
  "secrets.read",
  "deployment.execute"
]);

export type SkillRiskLevel = "low" | "medium" | "high";

export interface SkillManifest {
  schema_version: number;
  id: string;
  name: string;
  version: string;
  category: string;
  description: string;
  capabilities: string[];
  requires: {
    permissions: string[];
  };
  recommended_tools: string[];
  compatible_agents: string[];
  dependencies: {
    skills: string[];
  };
  checks: string[];
  risk_level: SkillRiskLevel;
}

export interface SkillValidationResult {
  valid: boolean;
  errors: string[];
}

const ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

export function validateSkillManifest(value: unknown): SkillValidationResult {
  const errors: string[] = [];
  if (!value || typeof value !== "object") {
    return { valid: false, errors: ["manifest must be an object"] };
  }

  const manifest = value as Partial<SkillManifest>;
  if (manifest.schema_version !== SUPPORTED_SKILL_SCHEMA_VERSION) {
    errors.push(`schema_version must be ${SUPPORTED_SKILL_SCHEMA_VERSION}`);
  }
  if (typeof manifest.id !== "string" || !ID_PATTERN.test(manifest.id)) {
    errors.push("id must contain lowercase letters, numbers, and hyphens");
  }
  if (typeof manifest.name !== "string" || !manifest.name.trim()) errors.push("name is required");
  if (typeof manifest.version !== "string" || !VERSION_PATTERN.test(manifest.version)) {
    errors.push("version must use semantic version format");
  }
  if (typeof manifest.category !== "string" || !manifest.category.trim()) errors.push("category is required");
  if (typeof manifest.description !== "string" || !manifest.description.trim()) errors.push("description is required");

  for (const field of ["capabilities", "recommended_tools", "compatible_agents", "checks"] as const) {
    if (!Array.isArray(manifest[field]) || manifest[field].some((item) => typeof item !== "string")) {
      errors.push(`${field} must be an array of strings`);
    }
  }

  const permissions = manifest.requires?.permissions;
  if (!Array.isArray(permissions) || permissions.some((permission) => typeof permission !== "string")) {
    errors.push("requires.permissions must be an array of strings");
  } else {
    for (const permission of permissions) {
      if (!VALID_PERMISSIONS.has(permission)) errors.push(`unsupported permission: ${permission}`);
    }
  }

  if (!Array.isArray(manifest.dependencies?.skills) || manifest.dependencies.skills.some((item) => typeof item !== "string")) {
    errors.push("dependencies.skills must be an array of strings");
  }
  if (!manifest.risk_level || !["low", "medium", "high"].includes(manifest.risk_level)) {
    errors.push("risk_level must be low, medium, or high");
  }

  return { valid: errors.length === 0, errors };
}

export function parseSkillManifest(source: string, sourceName = "manifest"): SkillManifest {
  let parsed: unknown;
  try {
    parsed = parseYaml(source);
  } catch (error) {
    throw new Error(`${sourceName}: invalid YAML (${error instanceof Error ? error.message : String(error)})`);
  }

  const result = validateSkillManifest(parsed);
  if (!result.valid) throw new Error(`${sourceName}: ${result.errors.join("; ")}`);
  return parsed as SkillManifest;
}

export class SkillRegistry {
  private readonly skills = new Map<string, SkillManifest>();

  add(manifest: SkillManifest, sourceName = manifest.id): void {
    const result = validateSkillManifest(manifest);
    if (!result.valid) throw new Error(`${sourceName}: ${result.errors.join("; ")}`);
    if (this.skills.has(manifest.id)) throw new Error(`duplicate skill ID: ${manifest.id}`);
    this.skills.set(manifest.id, manifest);
  }

  get(id: string): SkillManifest | undefined {
    return this.skills.get(id);
  }

  list(): SkillManifest[] {
    return [...this.skills.values()].sort((a, b) => a.id.localeCompare(b.id));
  }

  resolve(ids: string[]): SkillManifest[] {
    const resolved = new Map<string, SkillManifest>();
    const visiting = new Set<string>();

    const visit = (id: string, chain: string[]) => {
      if (resolved.has(id)) return;
      if (visiting.has(id)) throw new Error(`circular skill dependency: ${[...chain, id].join(" -> ")}`);
      const skill = this.get(id);
      if (!skill) throw new Error(`missing skill dependency: ${id}`);
      visiting.add(id);
      for (const dependency of skill.dependencies.skills) visit(dependency, [...chain, id]);
      visiting.delete(id);
      resolved.set(id, skill);
    };

    for (const id of ids) visit(id, []);
    return [...resolved.values()];
  }

  static async fromDirectory(directory: string): Promise<SkillRegistry> {
    const registry = new SkillRegistry();
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const manifestPath = join(directory, entry.name, "skill.yaml");
      try {
        const source = await readFile(manifestPath, "utf8");
        registry.add(parseSkillManifest(source, manifestPath), manifestPath);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
        throw error;
      }
    }
    return registry;
  }
}

export function getBuiltInSkillsDirectory(): string {
  return fileURLToPath(new URL("../skills/", import.meta.url));
}

export interface PackManifest {
  schema_version: number;
  id: string;
  name: string;
  version: string;
  description: string;
  skills: string[];
  dependencies: { packs: string[] };
}

export function validatePackManifest(value: unknown): string[] {
  const errors: string[] = [];
  if (!value || typeof value !== "object") return ["manifest must be an object"];
  const pack = value as Partial<PackManifest>;
  if (pack.schema_version !== 1) errors.push("schema_version must be 1");
  if (typeof pack.id !== "string" || !ID_PATTERN.test(pack.id)) errors.push("id must contain lowercase letters, numbers, and hyphens");
  if (typeof pack.name !== "string" || !pack.name.trim()) errors.push("name is required");
  if (typeof pack.version !== "string" || !VERSION_PATTERN.test(pack.version)) errors.push("version must use semantic version format");
  if (typeof pack.description !== "string" || !pack.description.trim()) errors.push("description is required");
  if (!Array.isArray(pack.skills) || pack.skills.some((skill) => typeof skill !== "string")) errors.push("skills must be an array of strings");
  if (!Array.isArray(pack.dependencies?.packs) || pack.dependencies.packs.some((dependency) => typeof dependency !== "string")) errors.push("dependencies.packs must be an array of strings");
  return errors;
}

export function parsePackManifest(source: string, sourceName = "pack manifest"): PackManifest {
  let parsed: unknown;
  try {
    parsed = parseYaml(source);
  } catch (error) {
    throw new Error(`${sourceName}: invalid YAML (${error instanceof Error ? error.message : String(error)})`);
  }
  const errors = validatePackManifest(parsed);
  if (errors.length) throw new Error(`${sourceName}: ${errors.join("; ")}`);
  return parsed as PackManifest;
}

export class PackRegistry {
  private readonly packs = new Map<string, PackManifest>();

  add(pack: PackManifest, sourceName = pack.id): void {
    const errors = validatePackManifest(pack);
    if (errors.length) throw new Error(`${sourceName}: ${errors.join("; ")}`);
    if (this.packs.has(pack.id)) throw new Error(`duplicate pack ID: ${pack.id}`);
    this.packs.set(pack.id, pack);
  }

  get(id: string): PackManifest | undefined { return this.packs.get(id); }
  list(): PackManifest[] { return [...this.packs.values()].sort((a, b) => a.id.localeCompare(b.id)); }

  resolve(ids: string[]): PackManifest[] {
    const resolved = new Map<string, PackManifest>();
    const visiting = new Set<string>();
    const visit = (id: string, chain: string[]) => {
      if (resolved.has(id)) return;
      if (visiting.has(id)) throw new Error(`circular pack dependency: ${[...chain, id].join(" -> ")}`);
      const pack = this.get(id);
      if (!pack) throw new Error(`missing pack dependency: ${id}`);
      visiting.add(id);
      for (const dependency of pack.dependencies.packs) visit(dependency, [...chain, id]);
      visiting.delete(id);
      resolved.set(id, pack);
    };
    for (const id of ids) visit(id, []);
    return [...resolved.values()];
  }

  static async fromDirectory(directory: string): Promise<PackRegistry> {
    const registry = new PackRegistry();
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const manifestPath = join(directory, entry.name, "pack.yaml");
      try {
        registry.add(parsePackManifest(await readFile(manifestPath, "utf8"), manifestPath), manifestPath);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
        throw error;
      }
    }
    return registry;
  }
}

export function getBuiltInPacksDirectory(): string {
  return fileURLToPath(new URL("../packs/", import.meta.url));
}

export interface WorkflowManifest {
  schema_version: number;
  id: string;
  name: string;
  version: string;
  description: string;
  steps: string[];
  dependencies: { workflows: string[] };
}

export class WorkflowRegistry {
  private readonly workflows = new Map<string, WorkflowManifest>();
  add(workflow: WorkflowManifest, sourceName = workflow.id): void {
    if (workflow.schema_version !== 1 || !ID_PATTERN.test(workflow.id) || !VERSION_PATTERN.test(workflow.version) || !workflow.name.trim() || !workflow.description.trim() || !Array.isArray(workflow.steps) || !Array.isArray(workflow.dependencies?.workflows)) throw new Error(`${sourceName}: invalid workflow manifest`);
    if (this.workflows.has(workflow.id)) throw new Error(`duplicate workflow ID: ${workflow.id}`);
    this.workflows.set(workflow.id, workflow);
  }
  get(id: string): WorkflowManifest | undefined { return this.workflows.get(id); }
  list(): WorkflowManifest[] { return [...this.workflows.values()].sort((a, b) => a.id.localeCompare(b.id)); }
  resolve(ids: string[]): WorkflowManifest[] {
    const resolved = new Map<string, WorkflowManifest>(); const visiting = new Set<string>();
    const visit = (id: string, chain: string[]) => { if (resolved.has(id)) return; if (visiting.has(id)) throw new Error(`circular workflow dependency: ${[...chain, id].join(" -> ")}`); const item = this.get(id); if (!item) throw new Error(`missing workflow dependency: ${id}`); visiting.add(id); for (const dependency of item.dependencies.workflows) visit(dependency, [...chain, id]); visiting.delete(id); resolved.set(id, item); };
    for (const id of ids) visit(id, []);
    return [...resolved.values()];
  }
  static async fromDirectory(directory: string): Promise<WorkflowRegistry> {
    const registry = new WorkflowRegistry(); const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) { if (!entry.isDirectory()) continue; const file = join(directory, entry.name, "workflow.yaml"); try { registry.add(parseYaml(await readFile(file, "utf8")) as WorkflowManifest, file); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") continue; throw error; } }
    return registry;
  }
}

export function getBuiltInWorkflowsDirectory(): string { return fileURLToPath(new URL("../workflows/", import.meta.url)); }

export interface ToolManifest {
  schema_version: number;
  id: string;
  name: string;
  category: string[];
  capabilities: string[];
  risk_level: RiskLevel;
  command: string;
}

export class ToolRegistry {
  private readonly tools = new Map<string, ToolManifest>();
  add(tool: ToolManifest, sourceName = tool.id): void {
    if (tool.schema_version !== 1 || !ID_PATTERN.test(tool.id) || !tool.name.trim() || !Array.isArray(tool.category) || !Array.isArray(tool.capabilities) || !["low", "medium", "high"].includes(tool.risk_level) || !tool.command.trim()) throw new Error(`${sourceName}: invalid tool manifest`);
    if (this.tools.has(tool.id)) throw new Error(`duplicate tool ID: ${tool.id}`);
    this.tools.set(tool.id, tool);
  }
  list(): ToolManifest[] { return [...this.tools.values()].sort((a, b) => a.id.localeCompare(b.id)); }
  static async fromDirectory(directory: string): Promise<ToolRegistry> { const registry = new ToolRegistry(); const entries = await readdir(directory, { withFileTypes: true }); for (const entry of entries) { if (!entry.isDirectory()) continue; const file = join(directory, entry.name, "tool.yaml"); try { registry.add(parseYaml(await readFile(file, "utf8")) as ToolManifest, file); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") continue; throw error; } } return registry; }
}

export interface ToolAvailability extends ToolManifest {
  installed: boolean;
  path: string | null;
}

export async function detectTools(registry: ToolRegistry): Promise<ToolAvailability[]> {
  const lookup = process.platform === "win32" ? "where.exe" : "which";
  return Promise.all(registry.list().map(async (tool) => {
    try {
      const result = await execFileCore(lookup, [tool.command], { timeout: 2500, windowsHide: true });
      return { ...tool, installed: true, path: result.stdout.trim().split(/\r?\n/)[0] || null };
    } catch {
      return { ...tool, installed: false, path: null };
    }
  }));
}

export function recommendTools(registry: ToolRegistry, capabilities: string[]): ToolManifest[] {
  const wanted = new Set(capabilities);
  return registry.list().filter((tool) => tool.capabilities.some((capability) => wanted.has(capability)));
}

export async function loadDeclarativeSkillPackage(directory: string): Promise<{ packageName: string; manifest: SkillManifest; review: ExtensionReview }> {
  const packageJson = JSON.parse(await readFile(join(directory, "package.json"), "utf8")) as { name?: string; type?: string };
  if (!packageJson.name) throw new Error("skill package package.json requires a name");
  if (packageJson.type === "executable-plugin") throw new Error("Executable plugins require a separate reviewed plugin path");
  const manifest = parseSkillManifest(await readFile(join(directory, "skill.yaml"), "utf8"), join(directory, "skill.yaml"));
  return { packageName: packageJson.name, manifest, review: reviewExtensionInstallation("declarative-skill", manifest.requires.permissions) };
}

export function getBuiltInToolsDirectory(): string { return fileURLToPath(new URL("../tools/", import.meta.url)); }

export type PackageSource = "built-in" | "npm" | "git";

export interface LockedPackage {
  version: string;
  source: PackageSource;
  permissions?: string[];
}

export interface AisSkillsLockfile {
  schema_version: 1;
  skills: Record<string, LockedPackage>;
  packs: Record<string, LockedPackage>;
}

export function createLockfile(skills: SkillManifest[], packs: PackManifest[]): AisSkillsLockfile {
  return {
    schema_version: 1,
    skills: Object.fromEntries(skills.sort((a, b) => a.id.localeCompare(b.id)).map((skill) => [skill.id, { version: skill.version, source: "built-in", permissions: skill.requires.permissions }])),
    packs: Object.fromEntries(packs.sort((a, b) => a.id.localeCompare(b.id)).map((pack) => [pack.id, { version: pack.version, source: "built-in" }]))
  };
}

export async function saveLockfile(lockfile: AisSkillsLockfile, root = process.cwd()): Promise<string> {
  const file = join(root, "aiskills.lock");
  await writeFile(file, `${JSON.stringify(lockfile, null, 2)}\n`, "utf8");
  return file;
}

export async function loadLockfile(root = process.cwd()): Promise<AisSkillsLockfile | null> {
  try {
    const lockfile = JSON.parse(await readFile(join(root, "aiskills.lock"), "utf8")) as AisSkillsLockfile;
    if (lockfile.schema_version !== 1 || !lockfile.skills || !lockfile.packs) throw new Error("invalid lock file schema");
    return lockfile;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export * from "./orchestration.js";
export * from "./smurf.js";
