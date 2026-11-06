import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {Client} from '../packages/cli/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js';
import {InMemoryTransport} from '../packages/cli/node_modules/@modelcontextprotocol/sdk/dist/esm/inMemory.js';
import {createMcpServer} from '../packages/cli/dist/mcp.js';
import {CapabilityBroker} from '../packages/cli/dist/capability-broker.js';
import {CoreRuntime,openPackageCatalog,installSkillPackage,prepareCapability,SkillRegistry,getBuiltInSkillsDirectory} from '../packages/core/dist/index.js';

for(const live of [false,true])test(`${live?'live Warden':'fixture'} lazy gateway discovers later tasks, bounds output and rechecks revocation`,{skip:live&&!process.env.AI_SKILLS_WARDEN_LIVE},async t=>{
  const root=await mkdtemp(join(tmpdir(),'aiskills-broker-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const previous={AI_SKILLS_HOME:process.env.AI_SKILLS_HOME,AI_SKILLS_WARDEN_BINARY:process.env.AI_SKILLS_WARDEN_BINARY};
  t.after(()=>{for(const [k,v] of Object.entries(previous))if(v===undefined)delete process.env[k];else process.env[k]=v;});
  process.env.AI_SKILLS_HOME=join(root,'state');
  const source=join(root,'source');await mkdir(source);
  await writeFile(join(source,'SKILL.md'),'---\nname: widget-tools\ndescription: Inspect widget components\n---\nRead widgets.');
  await writeFile(join(source,'runtime.json'),JSON.stringify({kind:'mcp',command:[process.execPath,'${PACKAGE}/server.mjs'],tools:['read']}));
  await writeFile(join(source,'server.mjs'),`import readline from 'node:readline';
readline.createInterface({input:process.stdin}).on('line',line=>{const r=JSON.parse(line);if(r.id===undefined)return;let result={};if(r.method==='initialize')result={protocolVersion:'2025-11-25',capabilities:{tools:{}},serverInfo:{name:'widget',version:'1'}};if(r.method==='tools/list')result={tools:[{name:'read',description:'Read widget',inputSchema:{type:'object',properties:{large:{type:'boolean'}}}}]};if(r.method==='tools/call')result={content:[{type:'text',text:r.params.arguments.large?'x'.repeat(300000):'widget result'}]};console.log(JSON.stringify({jsonrpc:'2.0',id:r.id,result}));});`);
  if(live)process.env.AI_SKILLS_WARDEN_BINARY=process.env.AI_SKILLS_WARDEN_LIVE;
  else {
    const supervisor=join(root,'supervisor.mjs');
    await writeFile(supervisor,`#!${process.execPath}\n${await readFile(join(source,'server.mjs'),'utf8')}`,{mode:0o700});
    process.env.AI_SKILLS_WARDEN_BINARY=supervisor;
  }
  const catalog=await openPackageCatalog();t.after(()=>catalog.close());
  const p=await installSkillPackage(catalog,{source,approve:true});await prepareCapability(catalog,p.id,true);await catalog.enable(p.id,root,true);
  const aborted=new AbortController();aborted.abort();
  await assert.rejects(new CapabilityBroker(root).search('widgets',aborted.signal),{name:'AbortError'});
  await assert.rejects(new CapabilityBroker(root).call(p.id,'default','read',{},aborted.signal),{name:'AbortError'});
  await assert.rejects(new CapabilityBroker(root).call(p.id,'default','read',{}),/shell.execute/);
  const prototype=Object.getPrototypeOf(catalog),active=prototype.active,connect=Client.prototype.connect;
  const canceledDuringLookup=new AbortController();let starts=0;
  try {
    prototype.active=async function(...args){const result=await active.apply(this,args);canceledDuringLookup.abort();return result;};
    Client.prototype.connect=async function(){starts++;throw new Error('Unexpected gateway startup');};
    await assert.rejects(new CapabilityBroker(root,undefined,true).call(p.id,'default','read',{},canceledDuringLookup.signal),{name:'AbortError'});
    assert.equal(starts,0);
  } finally {prototype.active=active;Client.prototype.connect=connect;}
  const originalManifest=p.manifest;
  catalog.save({...p,manifest:{...p.manifest,compatible_agents:['claude']}});
  await assert.rejects(new CapabilityBroker(root,'codex',true).call(p.id,'default','read',{}),/incompatible/);
  assert.deepEqual((await new CapabilityBroker(root,'codex',true).search('inspect widget components')).tools,[]);
  catalog.save({...p,manifest:originalManifest});
  const server=createMcpServer(new CoreRuntime({projectRoot:root,engines:[],permissions:['shell.execute']}),undefined,{compact:true});
  const client=new Client({name:'broker-test',version:'1'});const [a,b]=InMemoryTransport.createLinkedPair();await server.connect(a);await client.connect(b);t.after(async()=>{await client.close();await server.close();});
  assert.deepEqual((await client.listTools()).tools.map(t=>t.name),['search_tools','call_capability','discover_capabilities','load_skill']);
  const descriptions=(await client.listTools()).tools;for(const tool of descriptions)assert.equal(tool.annotations.readOnlyHint,['discover_capabilities','load_skill'].includes(tool.name));
  const builtin=(await SkillRegistry.fromDirectory(getBuiltInSkillsDirectory())).list()[0];
  const guidance=await client.callTool({name:'load_skill',arguments:{id:builtin.id}});assert.equal(JSON.parse(guidance.content[0].text).source,'built-in');
  const search=async task=>JSON.parse((await client.callTool({name:'search_tools',arguments:{task}})).content[0].text);
  assert.deepEqual((await search('fix unrelated payments')).tools,[]);
  const found=await search('inspect widget components');assert.equal(found.errors.length,0,JSON.stringify(found.errors));assert.equal(found.tools[0].tool,'read');assert.equal(found.tools[0].entry,'default');
  const call=arguments_=>client.callTool({name:'call_capability',arguments:{id:p.id,entry:'default',tool:'read',arguments:{},...arguments_}});
  assert.match(JSON.stringify(await call({})),/widget result/);
  assert.equal((await call({tool:'erase'})).isError,true);
  assert.equal((await call({arguments:{large:true}})).isError,true);
  assert.equal((await call({arguments:'bad'})).isError,true);
  await catalog.enable(p.id,root,false);
  assert.equal((await call({})).isError,true);assert.deepEqual((await search('inspect widget components')).tools,[]);
});
