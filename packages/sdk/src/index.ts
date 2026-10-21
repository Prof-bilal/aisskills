export interface SkillDefinition {
  id: string;
  name: string;
  version: string;
  category: string;
  description?: string;
  capabilities?: string[];
}

export function defineSkill(definition: SkillDefinition): SkillDefinition {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(definition.id)) {
    throw new Error(`Invalid skill ID: ${definition.id}`);
  }

  if (!definition.name.trim()) throw new Error("Skill name cannot be empty");
  if (!/^\d+\.\d+\.\d+$/.test(definition.version)) {
    throw new Error(`Invalid skill version: ${definition.version}`);
  }

  return {
    ...definition,
    capabilities: [...new Set(definition.capabilities ?? [])]
  };
}

export interface WorkflowDefinition {
  id: string;
  name: string;
  version: string;
  description: string;
  steps: string[];
}

export interface AdapterDefinition {
  id: string;
  name: string;
  command: string;
  capabilities: string[];
}

export interface ToolDefinition {
  id: string;
  name: string;
  category: string[];
  capabilities: string[];
  riskLevel: "low" | "medium" | "high";
  command: string;
}

export interface PackDefinition {
  id: string;
  name: string;
  version: string;
  description: string;
  skills: string[];
}

function validateId(id: string, kind: string): void {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) throw new Error(`Invalid ${kind} ID: ${id}`);
}

function validateVersion(version: string, kind: string): void {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`Invalid ${kind} version: ${version}`);
}

export function defineWorkflow(definition: WorkflowDefinition): WorkflowDefinition {
  validateId(definition.id, "workflow");
  validateVersion(definition.version, "workflow");
  if (!definition.name.trim() || !definition.description.trim() || !definition.steps.length) throw new Error("Workflow requires name, description, and steps");
  return { ...definition, steps: [...new Set(definition.steps)] };
}

export function defineAdapter(definition: AdapterDefinition): AdapterDefinition {
  validateId(definition.id, "adapter");
  if (!definition.name.trim() || !definition.command.trim()) throw new Error("Adapter requires name and command");
  return { ...definition, capabilities: [...new Set(definition.capabilities)] };
}

export function defineTool(definition: ToolDefinition): ToolDefinition {
  validateId(definition.id, "tool");
  if (!definition.name.trim() || !definition.command.trim()) throw new Error("Tool requires name and command");
  if (!["low", "medium", "high"].includes(definition.riskLevel)) throw new Error("Invalid tool risk level");
  return { ...definition, category: [...new Set(definition.category)], capabilities: [...new Set(definition.capabilities)] };
}

export function definePack(definition: PackDefinition): PackDefinition {
  validateId(definition.id, "pack");
  validateVersion(definition.version, "pack");
  if (!definition.name.trim() || !definition.description.trim()) throw new Error("Pack requires name and description");
  return { ...definition, skills: [...new Set(definition.skills)] };
}
