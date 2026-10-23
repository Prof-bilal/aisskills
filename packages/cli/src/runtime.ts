import { CoreRuntime, loadUserConfig, NativeOrchestrationEngine, SmurfOrchestrationEngine } from 'aiskills-core';
import { readFile } from 'node:fs/promises';
import { createBuiltInAdapters } from 'aiskills-adapters-local';

export async function createLocalRuntime(agentId?: string, onOutput?: (chunk: string) => void): Promise<CoreRuntime> {
  // This file is selected by the process host, never by MCP requests or repository discovery.
  const host = process.env.AI_SKILLS_RUNTIME_CONFIG
    ? JSON.parse(await readFile(process.env.AI_SKILLS_RUNTIME_CONFIG, 'utf8')) : {};
  const smurf = host.smurf ?? host.smurfDevelopment;
  const engines = smurf ? [new SmurfOrchestrationEngine(smurf)] : [];
  const options = { projectRoot: host.projectRoot ?? process.cwd(), permissions: host.permissions, allowedChecks: host.allowedChecks };
  const config = await loadUserConfig();
  const profile = config.profiles[config.activeProfile];
  const candidates = agentId ? [agentId] : [profile?.agents.primary, ...(profile?.agents.fallback ?? [])];
  const adapters = createBuiltInAdapters();
  const selected: typeof adapters = [];
  for (const id of [...new Set(candidates)]) {
    const adapter = adapters.find(a => a.id === id);
    if (adapter && (await adapter.detect()).status === 'available') selected.push(adapter);
  }
  const worker = selected.length ? {
    id: selected[0].id,
    async execute(task: Parameters<(typeof selected)[number]['execute']>[0]) {
      let last;
      for (const adapter of selected) {
        const result = await adapter.execute({ ...task, onOutput });
        last = { ...result, agentId: adapter.id };
        if (result.status === 'completed') return last;
      }
      return last!;
    }
  } : undefined;
  return new CoreRuntime({ ...options, engines: [...engines, new NativeOrchestrationEngine(worker)] });
}
