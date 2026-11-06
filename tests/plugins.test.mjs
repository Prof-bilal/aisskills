import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {PackageCatalog,installSkillPackage,prepareCapability,capabilityLaunches,validatePluginBundle,bundleGuidance,writePackageLock} from '../packages/core/dist/index.js';
import {prepareAgentSession} from '../packages/cli/dist/session.js';
import {createMcpServer} from '../packages/cli/dist/mcp.js';
import {CoreRuntime} from '../packages/core/dist/index.js';
import {Client} from '../packages/cli/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js';
import {InMemoryTransport} from '../packages/cli/node_modules/@modelcontextprotocol/sdk/dist/esm/inMemory.js';

const definition=()=>({schema_version:1,id:'widget-bundle',name:'Widget bundle',description:'Frontend widget workflows',version:'1.0.0',skills:['skills/frontend/SKILL.md'],runtimes:{server:{kind:'mcp',command:[process.execPath,'${PACKAGE}/server.mjs'],tools:['read']},check:{kind:'command',command:[process.execPath,'-e','process.exit(0)']}},hooks:{'before-session':'check'}});
test('bundle validation rejects path escapes, shell hooks, unknown events and missing runtimes',()=>{
  assert.equal(validatePluginBundle(definition()).id,'widget-bundle');
  for(const patch of [{skills:['../SKILL.md']},{hooks:{'before-session':'shell command'}},{hooks:{SessionStart:'check'}},{hooks:{'before-session':'server'}}])assert.throws(()=>validatePluginBundle({...definition(),...patch}));
});
test('bundle import does not execute code and each runtime needs separate approval',async t=>{
  const root=await mkdtemp(join(tmpdir(),'aiskills-plugin-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const state=join(root,'state');const source=join(root,'source');await mkdir(state);await mkdir(join(source,'skills/frontend'),{recursive:true});
  const bundle=definition();await writeFile(join(source,'aiskills-plugin.json'),JSON.stringify(bundle));
  await writeFile(join(source,'skills/frontend/SKILL.md'),'---\nname: frontend-widgets\ndescription: Frontend widget design\n---\nNested guidance sentinel.');
  await writeFile(join(source,'server.mjs'),'throw Error("must not execute during import")');
  const catalog=new PackageCatalog(state);t.after(()=>catalog.close());const p=await installSkillPackage(catalog,{source,approve:true});assert.equal(p.id,'widget-bundle');
  await assert.rejects(catalog.enable(p.id,root,true),/every bundle runtime/);
  await prepareCapability(catalog,p.id,true,'server');await assert.rejects(catalog.enable(p.id,root,true),/every bundle runtime/);
  await prepareCapability(catalog,p.id,true,'check');await catalog.enable(p.id,root,true);
  const launches=await capabilityLaunches(catalog,p.id);assert.equal(launches.server.args[0],'connect');assert.equal(launches.check.args[0],'run');
  const originalLock=JSON.parse(await readFile(join(root,'aiskills.lock'),'utf8'));assert.ok(originalLock.installed_packages[p.id].runtime_policies.server.policyDigest);
  await prepareCapability(catalog,p.id,true,'server',{hosts:['api.example.com']});await assert.rejects(catalog.active(root),/synchronization pending/);await writePackageLock(catalog,root);assert.equal((await catalog.active(root))[0].id,p.id);
  assert.match((await bundleGuidance(p.directory,bundle,'frontend design'))[0],/Nested guidance sentinel/);assert.deepEqual(await bundleGuidance(p.directory,bundle,'database migration'),[]);
  const old=process.env.AI_SKILLS_HOME;process.env.AI_SKILLS_HOME=state;t.after(()=>{if(old===undefined)delete process.env.AI_SKILLS_HOME;else process.env.AI_SKILLS_HOME=old;});
  await assert.rejects(prepareAgentSession({agent:'claude',task:'widget-bundle frontend design',project:root,cliPath:'/host/aiskills.js'}),/hooks require --write/);
  const session=await prepareAgentSession({agent:'claude',task:'widget-bundle frontend design',project:root,cliPath:'/host/aiskills.js',write:true});
  try{assert.equal(session.before.length,1);assert.equal(session.before[0].command,'warden');const config=JSON.parse(await readFile(session.args[session.args.indexOf('--mcp-config')+1],'utf8'));assert.deepEqual(Object.keys(config.mcpServers),['aiskills']);assert.ok(config.mcpServers.aiskills.args.includes('--compact'));assert.match(session.args.at(-1),/Nested guidance sentinel/);}finally{await session.cleanup();}
  const server=createMcpServer(new CoreRuntime({projectRoot:root,engines:[]}),undefined,{compact:true});const client=new Client({name:'plugin-guidance-test',version:'1'});const [a,b]=InMemoryTransport.createLinkedPair();await server.connect(a);await client.connect(b);
  try{assert.equal((await client.callTool({name:'load_skill',arguments:{id:p.id}})).isError,true);const guidance=await client.callTool({name:'load_skill',arguments:{id:p.id,task:'frontend design'}});assert.match(guidance.content[0].text,/Nested guidance sentinel/);}finally{await client.close();await server.close();}
  await assert.rejects(prepareCapability(catalog,p.id,true,'../escape'),/entry/);
  await writeFile(join(state,'capabilities',p.digest,'server','rules.json'),'{}');await assert.rejects(catalog.active(root),/changed/);
});
test('native Claude plugin import adapts nested skills and requires a host MCP allowlist',async t=>{
  const root=await mkdtemp(join(tmpdir(),'aiskills-native-plugin-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const source=join(root,'source');const state=join(root,'state');await mkdir(state);await mkdir(join(source,'.claude-plugin'),{recursive:true});await mkdir(join(source,'skills/frontend'),{recursive:true});
  await writeFile(join(source,'.claude-plugin/plugin.json'),JSON.stringify({name:'native-product',version:'1.0.0',description:'Product workflows'}));
  await writeFile(join(source,'skills/frontend/SKILL.md'),'---\nname: frontend-design\ndescription: Frontend typography and components\n---\nNative guidance sentinel.');
  await writeFile(join(source,'.mcp.json'),JSON.stringify({mcpServers:{docs:{command:'node',args:['${CLAUDE_PLUGIN_ROOT}/server.mjs']}}}));
  await writeFile(join(source,'server.mjs'),'throw Error("not executed")');
  const catalog=new PackageCatalog(state);t.after(()=>catalog.close());const p=await installSkillPackage(catalog,{source,approve:true});assert.equal(p.id,'native-product');assert.ok(p.manifest.activation.triggers.includes('frontend'));
  await assert.rejects(prepareCapability(catalog,p.id,true,'docs'),/executable/);
  await assert.rejects(prepareCapability(catalog,p.id,true,'docs',{executable:process.execPath}),/allowlist/);
  const approval=await prepareCapability(catalog,p.id,true,'docs',{executable:process.execPath,tools:['search']});assert.equal(approval.runtime.command[1],join(p.directory,'server.mjs'));assert.deepEqual(approval.runtime.tools,['search']);
  await catalog.enable(p.id,root,true);assert.equal((await capabilityLaunches(catalog,p.id)).docs.args[0],'connect');
});
test('native plugin hook files are rejected rather than silently executed or omitted',async t=>{
  const root=await mkdtemp(join(tmpdir(),'aiskills-native-hook-'));t.after(()=>rm(root,{recursive:true,force:true}));const state=join(root,'state');const source=join(root,'source');await mkdir(state);await mkdir(join(source,'.claude-plugin'),{recursive:true});await mkdir(join(source,'hooks'));
  await writeFile(join(source,'.claude-plugin/plugin.json'),JSON.stringify({name:'native-hooks'}));await writeFile(join(source,'hooks/hooks.json'),'{}');const catalog=new PackageCatalog(state);t.after(()=>catalog.close());await assert.rejects(installSkillPackage(catalog,{source}),/Native hooks require/);assert.equal(catalog.list().length,0);
});
