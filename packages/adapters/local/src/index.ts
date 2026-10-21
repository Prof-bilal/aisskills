import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

function runCommand(command: string, args: string[], options: Parameters<typeof execFile>[2]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = execFile(command, args, options, (error, stdout, stderr) => {
      if (error) reject(Object.assign(error, { stdout, stderr }));
      else resolve({ stdout: String(stdout), stderr: String(stderr) });
    });
    child.stdin?.end();
  });
}

export type AgentStatus = "available" | "not-installed" | "unverified";

export interface AgentCapabilities {
  taskExecution: boolean;
  repositoryInspection: boolean;
  repositoryModification: boolean;
}

export interface AgentAvailability {
  id: string;
  name: string;
  status: AgentStatus;
  executable: string | null;
  version: string | null;
  capabilities: AgentCapabilities;
  reason?: string;
}

export interface AgentTask {
  prompt: string;
  workingDirectory?: string;
  readOnly?: boolean;
  permissions?: string[];
  timeoutMs?: number;
}

export type ExecutionStatus = "completed" | "failed" | "unsupported" | "blocked";

export interface AgentResult {
  status: ExecutionStatus;
  message: string;
  output?: string;
  error?: string;
  durationMs: number;
  attempts: number;
  permissions: string[];
}

export interface AgentAdapter {
  readonly id: string;
  readonly name: string;
  detect(): Promise<AgentAvailability>;
  version(): Promise<string | null>;
  capabilities(): Promise<AgentCapabilities>;
  execute(task: AgentTask): Promise<AgentResult>;
}

export interface CommandAgentDefinition {
  id: string;
  name: string;
  command: string;
  versionArguments: string[];
  capabilities: AgentCapabilities;
  buildArguments?: (task: AgentTask) => string[];
}

export const SAFE_READ_PERMISSIONS = ["repository.read"] as const;

const defaultDetectionTimeoutMs = 2500;
const defaultExecutionTimeoutMs = 120_000;

export class CommandAgentAdapter implements AgentAdapter {
  readonly id: string;
  readonly name: string;
  private readonly definition: CommandAgentDefinition;
  private readonly timeoutMs: number;

  constructor(definition: CommandAgentDefinition, timeoutMs = defaultDetectionTimeoutMs) {
    this.definition = definition;
    this.id = definition.id;
    this.name = definition.name;
    this.timeoutMs = timeoutMs;
  }

  async detect(): Promise<AgentAvailability> {
    const executable = await findExecutable(this.definition.command);
    if (!executable) {
      return {
        id: this.id,
        name: this.name,
        status: "not-installed",
        executable: null,
        version: null,
        capabilities: await this.capabilities(),
        reason: `${this.definition.command} was not found on PATH`
      };
    }

    const version = await this.version();
    return {
      id: this.id,
      name: this.name,
      status: version ? "available" : "unverified",
      executable,
      version,
      capabilities: await this.capabilities(),
      reason: version ? undefined : "executable found, but version probe did not complete"
    };
  }

  async version(): Promise<string | null> {
    try {
      const result = await execFileAsync(this.definition.command, this.definition.versionArguments, {
        timeout: this.timeoutMs,
        windowsHide: true,
        maxBuffer: 1024 * 1024
      });
      const output = `${result.stdout}\n${result.stderr}`.trim();
      return output.split(/\r?\n/)[0]?.trim() || null;
    } catch {
      return null;
    }
  }

  async capabilities(): Promise<AgentCapabilities> {
    return { ...this.definition.capabilities };
  }

  async execute(_task: AgentTask): Promise<AgentResult> {
    const started = Date.now();
    const permissions = _task.permissions ?? [];
    const invalid = permissions.filter((permission) => !permission.includes("."));
    if (invalid.length) {
      return {
        status: "blocked",
        message: "Execution blocked because the task requested invalid permissions.",
        error: `Invalid permissions: ${invalid.join(", ")}`,
        durationMs: Date.now() - started,
        attempts: 0,
        permissions
      };
    }
    if (!_task.readOnly && !permissions.includes("repository.write")) {
      return { status: "blocked", message: "Write execution requires repository.write permission.", error: "Missing repository.write", durationMs: Date.now() - started, attempts: 0, permissions };
    }
    if (this.definition.buildArguments) {
      let lastError = "unknown execution error";
      const maxAttempts = 2;
      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        try {
          const result = await runCommand(this.definition.command, this.definition.buildArguments(_task), {
            cwd: _task.workingDirectory,
            timeout: _task.timeoutMs ?? defaultExecutionTimeoutMs,
            windowsHide: true,
            maxBuffer: 4 * 1024 * 1024
          });
          return { status: "completed", message: `${this.name} completed the task.`, output: `${result.stdout}${result.stderr}`.trim(), durationMs: Date.now() - started, attempts: attempt, permissions };
        } catch (error) {
          lastError = error instanceof Error ? error.message : String(error);
          if (attempt === maxAttempts) return { status: "failed", message: `${this.name} failed while executing the task.`, error: lastError, durationMs: Date.now() - started, attempts: attempt, permissions };
        }
      }
    }
    return {
      status: "unsupported",
      message: `${this.name} execution is not enabled until its provider-specific invocation contract is verified.`,
      durationMs: Date.now() - started,
      attempts: 0,
      permissions
    };
  }
}

export const builtInAgentDefinitions: CommandAgentDefinition[] = [
  {
    id: "codex",
    name: "Codex",
    command: "codex",
    versionArguments: ["--version"],
    capabilities: { taskExecution: true, repositoryInspection: true, repositoryModification: true }
    ,buildArguments: (task) => ["exec", "--sandbox", task.readOnly === false ? "workspace-write" : "read-only", "--cd", task.workingDirectory ?? process.cwd(), task.prompt]
  },
  {
    id: "claude",
    name: "Claude Code",
    command: "claude",
    versionArguments: ["--version"],
    capabilities: { taskExecution: true, repositoryInspection: true, repositoryModification: true }
    ,buildArguments: (task) => [task.prompt, "--print", "--no-session-persistence", "--permission-mode", task.readOnly === false ? "default" : "plan", "--add-dir", task.workingDirectory ?? process.cwd()]
  },
  {
    id: "opencode",
    name: "OpenCode",
    command: "opencode",
    versionArguments: ["--version"],
    capabilities: { taskExecution: true, repositoryInspection: true, repositoryModification: true }
    ,buildArguments: (task) => ["run", "--format", "json", ...(task.readOnly === false ? ["--auto"] : []), task.prompt]
  },
  {
    id: "gemini",
    name: "Gemini CLI",
    command: "gemini",
    versionArguments: ["--version"],
    capabilities: { taskExecution: true, repositoryInspection: true, repositoryModification: true }
    ,buildArguments: (task) => ["--prompt", task.prompt, "--approval-mode", task.readOnly === false ? "default" : "plan", "--output-format", "json"]
  }
];

export function createBuiltInAdapters(timeoutMs = defaultDetectionTimeoutMs): CommandAgentAdapter[] {
  return builtInAgentDefinitions.map((definition) => new CommandAgentAdapter(definition, timeoutMs));
}

export async function detectAgents(adapters = createBuiltInAdapters()): Promise<AgentAvailability[]> {
  return Promise.all(adapters.map((adapter) => adapter.detect()));
}

async function findExecutable(command: string): Promise<string | null> {
  const lookup = process.platform === "win32" ? "where.exe" : "which";
  try {
    const result = await execFileAsync(lookup, [command], { timeout: defaultDetectionTimeoutMs, windowsHide: true });
    const path = result.stdout.trim().split(/\r?\n/)[0];
    if (!path) return null;
    await access(path, constants.X_OK).catch(() => undefined);
    return path;
  } catch {
    return null;
  }
}
