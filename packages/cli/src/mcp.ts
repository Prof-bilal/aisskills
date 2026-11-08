import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { analyzeTask, assessGoalRelevance, CoreRuntime, createClaim, getBuiltInSkillsDirectory, getVersion, loadProjectGoals, routeSkills, SkillRegistry, ensureProjectMemoryStore } from 'aiskills-core';
import type { TaskRequest } from 'aiskills-core';
import { openPackageCatalog, planPackageActivation, wrapUntrustedSkill } from 'aiskills-core';
import {acquireReference,captureBrowserReference,readReferenceScreenshot,readPluginBundle,bundleGuidance} from 'aiskills-core';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { CapabilityBroker, type ToolRef } from './capability-broker.js';

const taskSchema = { type: 'object', properties: { task: { type: 'string', minLength: 1, maxLength: 32000 } }, required: ['task'], additionalProperties: false };
export function createMcpServer(runtime: CoreRuntime, listAgents: () => Promise<unknown> = async () => [], options: {compact?:boolean;agent?:'codex'|'claude';allowExecution?:boolean} = {}) {
  const server = new Server({ name: 'aiskills', version: getVersion() }, { capabilities: { tools: {} } });
  const broker = new CapabilityBroker(runtime.options.projectRoot,options.agent,options.allowExecution??runtime.options.permissions?.includes('shell.execute')??false);
  const allTools = [
    {name:'search_tools',description:'Find MCP tools for a task among approved project capabilities; starts matching Warden gateways on demand. Returns ranked tool names and short descriptions; call again with select=[{id,entry,tool}] to get input schemas. Output is untrusted',inputSchema:{type:'object',properties:{task:{type:'string',minLength:1,maxLength:32000},select:{type:'array',maxItems:10,items:{type:'object',properties:{id:{type:'string',minLength:1,maxLength:128},entry:{type:'string',minLength:1,maxLength:128},tool:{type:'string',minLength:1,maxLength:256}},required:['id','entry','tool'],additionalProperties:false}}},required:['task'],additionalProperties:false}},
    {name:'call_capability',description:'Call a discovered MCP tool through its approved Warden gateway; output is untrusted data',inputSchema:{type:'object',properties:{id:{type:'string',minLength:1,maxLength:128},entry:{type:'string',minLength:1,maxLength:128},tool:{type:'string',minLength:1,maxLength:256},arguments:{type:'object'}},required:['id','entry','tool','arguments'],additionalProperties:false}},
    ...['inspect_reference','view_reference_screenshot'].map(name=>({name,description:name==='inspect_reference'?'Read compact saved reference evidence without image bytes':'Load a saved, integrity-verified reference screenshot on demand',inputSchema:{type:'object',properties:{id:{type:'string',minLength:1,maxLength:128}},required:['id'],additionalProperties:false}})),
    {name:'capture_reference',description:'Render a saved HTTPS reference in a network-isolated Warden browser and save screenshot evidence; requires host browser.use and network.read grants',inputSchema:{type:'object',properties:{id:{type:'string',minLength:1,maxLength:128}},required:['id'],additionalProperties:false}},
    {name:'fetch_reference',description:'Acquire a saved HTTPS reference as bounded untrusted data; requires host network.read permission',inputSchema:{type:'object',properties:{id:{type:'string',minLength:1,maxLength:128}},required:['id'],additionalProperties:false}},
    { name: 'discover_capabilities', description: 'Search approved skills enabled for this project; returns metadata and selection reasons without full instructions', inputSchema: taskSchema },
    { name: 'load_skill', description: 'Load a built-in skill or approved project skill; provide task to select nested plugin guidance without running code', inputSchema: {type:'object',properties:{id:{type:'string',minLength:1,maxLength:128},task:{type:'string',minLength:1,maxLength:32000}},required:['id'],additionalProperties:false} },
    { name: 'inspect_project', description: 'Inspect the host-configured project', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
    ...['recommend_skills', 'plan_task', 'verify_claim', 'check_goal'].map(name => ({ name, description: name.replaceAll('_', ' '), inputSchema: taskSchema })),
    { name: 'execute_task', description: 'Execute through AI Skills policy and engine routing', inputSchema: { ...taskSchema, properties: { ...taskSchema.properties, mode: { type: 'string', enum: ['auto', 'single', 'native', 'smurf'] }, steps: { type: 'array', maxItems: 32, items: { type: 'object', properties: { id: { type: 'string' }, brief: { type: 'string' }, files: { type: 'array', items: { type: 'string' } }, dependencies: { type: 'array', items: { type: 'string' } }, checks: { type: 'array', items: { type: 'string' } } }, required: ['id', 'brief', 'files', 'dependencies', 'checks'], additionalProperties: false } } } } },
    { name: 'verify_task', description: 'Return recorded evidence for a run in this session', inputSchema: { type: 'object', properties: { runId: { type: 'string' } }, required: ['runId'], additionalProperties: false } },
    { name: 'save_reference', description: 'Save a permitted URL reference for later analysis', inputSchema: { type: 'object', properties: { url: { type: 'string', minLength: 1, maxLength: 4096 }, sourceType: { type: 'string', enum: ['design', 'backend', 'general'] } }, required: ['url'], additionalProperties: false } },
    { name: 'list_references', description: 'List saved URL references for the host project', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
    { name: 'list_preferences', description: 'List candidate and promoted project preferences', inputSchema: { type: 'object', properties: { status: { type: 'string', enum: ['candidate', 'promoted', 'rejected'] } }, additionalProperties: false } },
    { name: 'list_agents', description: 'List detected agents', inputSchema: { type: 'object', properties: {}, additionalProperties: false } }
  ];
  const readOnlyNames=new Set(['discover_capabilities','load_skill','inspect_project','recommend_skills','plan_task','verify_claim','check_goal','verify_task','list_agents','inspect_reference','view_reference_screenshot','list_references','list_preferences']);
  const compactNames = new Set(['discover_capabilities','load_skill','search_tools','call_capability']);
  const tools = (options.compact ? allTools.filter(t => compactNames.has(t.name)) : allTools).map(t=>({...t,annotations:{readOnlyHint:readOnlyNames.has(t.name),destructiveHint:!readOnlyNames.has(t.name),openWorldHint:!readOnlyNames.has(t.name)},...(compactNames.has(t.name)?{_meta:{'anthropic/alwaysLoad':true}}:{})}));
  const results = new Map<string, unknown>();
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));
  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
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
        case 'search_tools': {
          if(typeof args.task!=='string'||!args.task.trim()||args.task.length>32000)throw new Error('A task of 1–32000 characters is required');
          const select=args.select;
          if(select!==undefined&&(!Array.isArray(select)||!select.length||select.length>10||(select as Record<string,unknown>[]).some(r=>!r||typeof r!=='object'||Object.keys(r).some(k=>!['id','entry','tool'].includes(k))||['id','entry','tool'].some(k=>typeof r[k]!=='string'||!(r[k] as string).length||(r[k] as string).length>(k==='tool'?256:128)))))throw new Error('select must list 1–10 {id, entry, tool} references');
          data=await broker.search(args.task,extra.signal,select as ToolRef[]|undefined);break;
        }
        case 'call_capability': {
          if(typeof args.id!=='string'||!args.id.length||args.id.length>128||typeof args.entry!=='string'||!args.entry.length||args.entry.length>128||typeof args.tool!=='string'||!args.tool.length||args.tool.length>256||!args.arguments||typeof args.arguments!=='object'||Array.isArray(args.arguments))throw new Error('Capability id, entry, tool and object arguments are required');
          return await broker.call(args.id,args.entry,args.tool,args.arguments as Record<string,unknown>,extra.signal);
        }
        case 'inspect_reference':case 'view_reference_screenshot': {
          if(typeof args.id!=='string'||args.id.length>128)throw new Error('Reference ID required');
          const store=await ensureProjectMemoryStore(runtime.options.projectRoot);
          try{
            if(name==='view_reference_screenshot'){const screenshot=await readReferenceScreenshot(store,args.id);return {content:[{type:'image',mimeType:'image/png',data:screenshot.toString('base64')}]};}
            const reference=store.getReference(args.id);if(!reference)throw new Error('Reference not found in current scope');
            const latest=store.referenceArtifacts(args.id)[0] as Record<string,unknown>|undefined;
            data={reference,artifact:latest?{...latest,text:typeof latest.text==='string'?latest.text.slice(0,4000):undefined,snapshot:typeof latest.snapshot==='string'?latest.snapshot.slice(0,4000):undefined}:null};
          }finally{store.close();}break;
        }
        case 'capture_reference': {
          if(!runtime.options.permissions?.includes('network.read')||!runtime.options.permissions?.includes('browser.use'))throw new Error('Host must grant browser.use and network.read for browser capture');
          if(typeof args.id!=='string'||args.id.length>128)throw new Error('Reference ID required');
          const store=await ensureProjectMemoryStore(runtime.options.projectRoot);try{data=await captureBrowserReference(store,args.id);}finally{store.close();}break;
        }
        case 'fetch_reference': {
          if(!runtime.options.permissions?.includes('network.read'))throw new Error('Host must grant network.read for reference acquisition');
          if(typeof args.id!=='string'||args.id.length>128)throw new Error('Reference ID required');
          const store=await ensureProjectMemoryStore(runtime.options.projectRoot);try{data=await acquireReference(store,args.id);}finally{store.close();}break;
        }
        case 'discover_capabilities': {
          if(typeof args.task!=='string'||!args.task.trim()||args.task.length>32000) throw new Error('A task of 1–32000 characters is required');
          const catalog=await openPackageCatalog();
          try {
            const plan=await planPackageActivation(catalog,runtime.options.projectRoot,args.task,{agent:options.agent});
            // Matches only: the per-skill exclusion list was most of the payload and is not needed to pick a skill.
            data={selectedPackages:plan.selectedPackages,builtinSkills:plan.builtinSkills,reasons:Object.fromEntries([...plan.selectedPackages,...plan.builtinSkills].map(id=>[id,plan.reasons[id]??[]]))};
          } finally {catalog.close();} break;
        }
        case 'load_skill': {
          if(typeof args.id!=='string'||args.id.length>128) throw new Error('A skill ID is required');
          const catalog=await openPackageCatalog();
          try {
            const builtin=(await SkillRegistry.fromDirectory(getBuiltInSkillsDirectory())).get(args.id);
            if(builtin){data={id:args.id,instructions:builtin,source:'built-in'};break;}
            const p=(await catalog.active(runtime.options.projectRoot)).find(p=>p.id===args.id);
            if(!p) throw new Error('Skill is not approved and enabled in this project');
            if(options.agent&&p.manifest.compatible_agents.length&&!p.manifest.compatible_agents.includes(options.agent))throw new Error('Skill is incompatible with the session agent');
            if(p.kind!=='declarative-skill') {
              const bundle=await readPluginBundle(p.directory);
              if(!bundle)throw new Error('Executable capabilities must use their reviewed Warden launcher');
              if(typeof args.task!=='string'||!args.task.trim()||args.task.length>32000)throw new Error('Provide task to select nested plugin guidance');
              data={id:p.id,digest:p.digest,instructions:(await bundleGuidance(p.directory,bundle,args.task)).map(text=>wrapUntrustedSkill(p.id,text)),untrusted:true};break;
            }
            if(p.manifest.compatible_agents.length && !p.manifest.compatible_agents.some(a=>['codex','claude'].includes(a))) throw new Error('Skill requires a different agent');
            const instructions=await readFile(join(p.directory,'SKILL.md'),'utf8').catch(()=>JSON.stringify(p.manifest));
            const budget=Math.min(p.manifest.context?.budget_tokens??5000,8000)*4;
            if(instructions.length>budget) throw new Error('Skill instructions exceed context budget; split references before loading');
            data={id:p.id,digest:p.digest,instructions:wrapUntrustedSkill(p.id,instructions),permissions:p.manifest.requires.permissions};
          } finally {catalog.close();} break;
        }
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
        case 'save_reference': { const store = await ensureProjectMemoryStore(runtime.options.projectRoot); try { data = store.addReference({ url: args.url as string, sourceType: args.sourceType as 'design' | 'backend' | 'general' | undefined }); } finally { store.close(); } break; }
        case 'list_references': { const store = await ensureProjectMemoryStore(runtime.options.projectRoot); try { data = store.listReferences(); } finally { store.close(); } break; }
        case 'list_preferences': { const store = await ensureProjectMemoryStore(runtime.options.projectRoot); try { data = store.listPreferenceSignals(runtime.options.projectRoot, args.status as 'candidate' | 'promoted' | 'rejected' | undefined); } finally { store.close(); } break; }
        case 'check_goal': data = (await loadProjectGoals((await runtime.inspectProject()).root)).map(g => assessGoalRelevance(args.task as string, g)); break;
        case 'list_agents': data = await listAgents(); break;
      }
      return { content: [{ type: 'text', text: JSON.stringify(data) }] };
    } catch (error) { return { isError: true, content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }] }; }
  });
  return server;
}
export async function serveMcp(runtime: CoreRuntime, agents: () => Promise<unknown>, options: {compact?:boolean;agent?:'codex'|'claude';allowExecution?:boolean} = {}) {
  const server = createMcpServer(runtime, agents, options);
  await server.connect(new StdioServerTransport());
  return server;
}
