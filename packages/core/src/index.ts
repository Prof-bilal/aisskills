import { homedir, platform } from "node:os";
import { join } from "node:path";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
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
