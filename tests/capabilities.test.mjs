import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {Client} from '../packages/cli/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js';
import {StdioClientTransport} from '../packages/cli/node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js';
import {PackageCatalog,installSkillPackage,prepareCapability,capabilityLaunch,validateCapabilityRuntime} from '../packages/core/dist/index.js';

test('runtime validation rejects shell shortcuts, unknown grants and unsafe remote transports',()=>{
  for(const runtime of [{kind:'mcp',command:['node','server.js'],tools:['read']},{kind:'mcp',upstream:'http://example.com/mcp',tools:['read']},{kind:'mcp',upstream:'https://127.0.0.1/mcp',tools:['read']},{kind:'mcp',upstream:'https://example.com/mcp',tools:[]},{kind:'command',command:['/usr/bin/node'],network:['*']},{kind:'command',command:['/usr/bin/node'],write:['/']}]) assert.throws(()=>validateCapabilityRuntime(runtime));
});
test('live Warden blocks host-file access, writes and inherited credentials', {skip:!process.env.AI_SKILLS_WARDEN_LIVE}, async t=>{
  const root=await mkdtemp(join(tmpdir(),'aiskills-warden-live-')); t.after(()=>rm(root,{recursive:true,force:true}));
  const source=join(root,'source');const state=join(root,'state');await mkdir(source);await mkdir(state);
  const secret=join(root,'private.txt');await writeFile(secret,'host-private-test-data');
  await writeFile(join(source,'SKILL.md'),'---\nname: boundary-probe\ndescription: Test process boundary\n---\nRun the boundary test.');
  await writeFile(join(source,'probe.mjs'),`import fs from 'node:fs'; import assert from 'node:assert/strict'; assert.throws(()=>fs.readFileSync(${JSON.stringify(secret)})); assert.throws(()=>fs.writeFileSync(new URL('./tamper',import.meta.url),'bad')); assert.equal(process.env.AIS_TEST_CREDENTIAL,undefined); console.log('boundary verified');`);
  await writeFile(join(source,'runtime.json'),JSON.stringify({kind:'command',command:[process.execPath,'${PACKAGE}/probe.mjs'],network:[],env:[]}));
  const catalog=new PackageCatalog(state);t.after(()=>catalog.close());const p=await installSkillPackage(catalog,{source,approve:true});
  await prepareCapability(catalog,p.id,true);const launch=await capabilityLaunch(catalog,p.id);
  const result=await promisify(execFile)(process.env.AI_SKILLS_WARDEN_LIVE,launch.args,{env:{...process.env,AIS_TEST_CREDENTIAL:'fake-private-token'},timeout:15000});assert.match(result.stdout,/boundary verified/);
});
test('executable capability needs separate approval, uses Warden and rejects changed policy',async t=>{
  const root=await mkdtemp(join(tmpdir(),'aiskills-capability-')); t.after(()=>rm(root,{recursive:true,force:true}));
  const source=join(root,'source');const state=join(root,'state');await mkdir(source);await mkdir(state);
  await writeFile(join(source,'SKILL.md'),'---\nname: example-server\ndescription: Example MCP server\n---\nCall the allowed read tool.');
  await writeFile(join(source,'runtime.json'),JSON.stringify({kind:'mcp',command:[process.execPath,'${PACKAGE}/server.mjs'],tools:['read'],env:[],network:[]}));
  await writeFile(join(source,'server.mjs'),'console.error("fixture")');
  const catalog=new PackageCatalog(state);t.after(()=>catalog.close());
  const p=await installSkillPackage(catalog,{source,approve:true});
  await assert.rejects(capabilityLaunch(catalog,p.id));
  const preview=await prepareCapability(catalog,p.id);assert.equal(preview.approved,false);assert.match(preview.rules,/"read"/);
  await assert.rejects(capabilityLaunch(catalog,p.id));
  const approval=await prepareCapability(catalog,p.id,true);const launch=await capabilityLaunch(catalog,p.id);
  assert.equal(launch.command,'warden');assert.equal(launch.args[0],'connect');assert.ok(launch.args.includes('--policy'));
  assert.match(approval.policy,/write: \[\]/);assert.match(approval.policy,/allow: \[\]/);
  await writeFile(join(state,'capabilities',p.digest,'policy.yaml'),'changed');await assert.rejects(capabilityLaunch(catalog,p.id),/changed/);
});
test('live Warden MCP gateway completes handshake and filters unapproved tools',{skip:!process.env.AI_SKILLS_WARDEN_LIVE},async t=>{
  const root=await mkdtemp(join(tmpdir(),'aiskills-mcp-live-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const source=join(root,'source');const state=join(root,'state');await mkdir(source);await mkdir(state);
  await writeFile(join(source,'SKILL.md'),'---\nname: gateway-probe\ndescription: Test MCP gateway\n---\nUse read only.');
  await writeFile(join(source,'runtime.json'),JSON.stringify({kind:'mcp',command:[process.execPath,'${PACKAGE}/server.mjs'],tools:['read']}));
  await writeFile(join(source,'server.mjs'),`import readline from 'node:readline';
const tools=['read','erase'].map(name=>({name,description:name,inputSchema:{type:'object',properties:{}}}));
readline.createInterface({input:process.stdin}).on('line',line=>{const r=JSON.parse(line);if(r.id===undefined)return;let result={};if(r.method==='initialize')result={protocolVersion:'2025-11-25',capabilities:{tools:{}},serverInfo:{name:'probe',version:'1'}};if(r.method==='tools/list')result={tools};if(r.method==='tools/call')result={content:[{type:'text',text:'allowed result'}]};console.log(JSON.stringify({jsonrpc:'2.0',id:r.id,result}));});`);
  const catalog=new PackageCatalog(state);t.after(()=>catalog.close());const p=await installSkillPackage(catalog,{source,approve:true});await prepareCapability(catalog,p.id,true);
  const launch=await capabilityLaunch(catalog,p.id);const client=new Client({name:'gateway-test',version:'1'});
  const transport=new StdioClientTransport({command:process.env.AI_SKILLS_WARDEN_LIVE,args:launch.args,stderr:'pipe'});
  t.after(()=>client.close());await client.connect(transport);
  assert.deepEqual((await client.listTools()).tools.map(t=>t.name),['read']);
  assert.match(JSON.stringify(await client.callTool({name:'read',arguments:{}})),/allowed result/);
  await assert.rejects(client.callTool({name:'erase',arguments:{}}));await client.close();
});
