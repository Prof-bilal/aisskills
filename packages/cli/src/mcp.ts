import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { analyzeTask, assessGoalRelevance, CoreRuntime, createClaim, getBuiltInSkillsDirectory, getVersion, loadProjectGoals, routeSkills, SkillRegistry } from 'aiskills-core';
import type { TaskRequest } from 'aiskills-core';

const taskSchema = { type: 'object', properties: { task: { type: 'string', minLength: 1, maxLength: 32000 } }, required: ['task'], additionalProperties: false };
export function createMcpServer(runtime: CoreRuntime, listAgents: () => Promise<unknown> = async () => []) {
  const server = new Server({ name: 'aiskills', version: getVersion() }, { capabilities: { tools: {} } });
  const tools = [
    { name: 'inspect_project', description: 'Inspect the host-configured project', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
    ...['recommend_skills', 'plan_task', 'verify_claim', 'check_goal'].map(name => ({ name, description: name.replaceAll('_', ' '), inputSchema: taskSchema })),
    { name: 'execute_task', description: 'Execute through AI Skills policy and engine routing', inputSchema: { ...taskSchema, properties: { ...taskSchema.properties, mode: { type: 'string', enum: ['auto', 'single', 'native', 'smurf'] }, steps: { type: 'array', maxItems: 32, items: { type: 'object', properties: { id: { type: 'string' }, brief: { type: 'string' }, files: { type: 'array', items: { type: 'string' } }, dependencies: { type: 'array', items: { type: 'string' } }, checks: { type: 'array', items: { type: 'string' } } }, required: ['id', 'brief', 'files', 'dependencies', 'checks'], additionalProperties: false } } } } },
    { name: 'verify_task', description: 'Return recorded evidence for a run in this session', inputSchema: { type: 'object', properties: { runId: { type: 'string' } }, required: ['runId'], additionalProperties: false } },
    { name: 'list_agents', description: 'List detected agents', inputSchema: { type: 'object', properties: {}, additionalProperties: false } }
  ];
  const results = new Map<string, unknown>();
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));
  server.setRequestHandler(CallToolRequestSchema, async request => {
    try {
      const name = request.params.name;
      const tool = tools.find(t => t.name === name);
      if (!tool) throw new Error('Unknown tool');
      const args = request.params.arguments ?? {};
      const allowed = Object.keys(tool.inputSchema.properties);
      if (Object.keys(args).some(k => !allowed.includes(k))) throw new Error('Unexpected request property');
      if (['recommend_skills', 'plan_task', 'verify_claim', 'check_goal', 'execute_task'].includes(name) && (typeof args.task !== 'string' || !args.task.trim() || args.task.length > 32000)) throw new Error('A task of 1–32000 characters is required');
      let data: unknown;
      switch (name) {
        case 'inspect_project': data = await runtime.inspectProject(); break;
        case 'recommend_skills': {
          const registry = await SkillRegistry.fromDirectory(getBuiltInSkillsDirectory());
          data = routeSkills(analyzeTask(args.task as string), registry.list().map(s => s.id)); break;
        }
        case 'plan_task': data = await runtime.planTask(args as unknown as TaskRequest); break;
        case 'execute_task': {
          const result = await runtime.executeTask(args as unknown as TaskRequest);
          data = result;
          if (result.runId) { if (results.size >= 100) results.delete(results.keys().next().value!); results.set(result.runId, result); }
          break;
        }
        case 'verify_claim': {
          const claim = createClaim(args.task as string);
          data = await runtime.options.verifyClaim?.(claim, await runtime.inspectProject()) ?? claim; break;
        }
        case 'verify_task': if (typeof args.runId !== 'string' || !results.has(args.runId)) throw new Error('No recorded run in this session'); else data = results.get(args.runId); break;
        case 'check_goal': data = (await loadProjectGoals((await runtime.inspectProject()).root)).map(g => assessGoalRelevance(args.task as string, g)); break;
        case 'list_agents': data = await listAgents(); break;
      }
      return { content: [{ type: 'text', text: JSON.stringify(data) }] };
    } catch (error) { return { isError: true, content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }] }; }
  });
  return server;
}
export async function serveMcp(runtime: CoreRuntime, agents: () => Promise<unknown>) {
  const server = createMcpServer(runtime, agents);
  await server.connect(new StdioServerTransport());
  return server;
}
