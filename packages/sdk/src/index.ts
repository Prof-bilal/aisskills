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
