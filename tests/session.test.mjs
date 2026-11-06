import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {openPackageCatalog,installSkillPackage} from '../packages/core/dist/index.js';
import {prepareAgentSession,runAgentSession,runSessionProcess} from '../packages/cli/dist/session.js';

test('Claude session includes only matched instructions and ephemeral MCP configuration',async t=>{
  const root=await mkdtemp(join(tmpdir(),'aiskills-session-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const before=process.env.AI_SKILLS_HOME;process.env.AI_SKILLS_HOME=join(root,'state');t.after(()=>{if(before===undefined)delete process.env.AI_SKILLS_HOME;else process.env.AI_SKILLS_HOME=before;});
  const previousClaude=process.env.CLAUDE_CONFIG_DIR;process.env.CLAUDE_CONFIG_DIR=join(root,'claude');t.after(()=>{if(previousClaude===undefined)delete process.env.CLAUDE_CONFIG_DIR;else process.env.CLAUDE_CONFIG_DIR=previousClaude;});
  await mkdir(join(root,'claude','plugins'),{recursive:true});await writeFile(join(root,'claude','plugins','installed_plugins.json'),JSON.stringify({version:2,plugins:{'example@local':[]}}));
  const source=join(root,'skill');await mkdir(source);await writeFile(join(source,'SKILL.md'),'---\nname: widgets\ndescription: Review widgets carefully\n---\nWidget instruction sentinel.');
  const catalog=await openPackageCatalog();try{const p=await installSkillPackage(catalog,{source,approve:true});await catalog.enable(p.id,root,true);}finally{catalog.close();}
  const options={agent:'claude',task:'review widgets',project:root,cliPath:'/host/aiskills.js'};
  const session=await prepareAgentSession(options);
  assert.deepEqual(session.selected,['widgets']);assert.ok(session.args.includes('--strict-mcp-config'));assert.ok(session.args.includes('--disable-slash-commands'));assert.match(session.args.at(-1),/Widget instruction sentinel/);
  const settings=JSON.parse(session.args[session.args.indexOf('--settings')+1]);assert.equal(settings.enabledPlugins['example@local'],false);assert.equal(settings.disableAllHooks,true);assert.deepEqual(session.disabledPlugins,['example@local']);
  const config=JSON.parse(await readFile(session.args[session.args.indexOf('--mcp-config')+1],'utf8'));assert.deepEqual(Object.keys(config.mcpServers),['aiskills']);
  assert.ok(config.mcpServers.aiskills.args.includes('--compact'));assert.ok(config.mcpServers.aiskills.args.includes('--session-agent=claude'));
  assert.ok(config.mcpServers.aiskills.args.includes('--deny-capability-execution'));
  assert.equal(config.mcpServers.aiskills.env.AI_SKILLS_HOME,process.env.AI_SKILLS_HOME);
  const pinnedRuntime=JSON.parse(await readFile(config.mcpServers.aiskills.env.AI_SKILLS_RUNTIME_CONFIG,'utf8'));assert.equal(pinnedRuntime.projectRoot,root);assert.deepEqual(pinnedRuntime.permissions,['repository.read']);
  assert.equal(session.args[session.args.indexOf('--permission-mode')+1],'plan');
  await session.cleanup();await assert.rejects(readFile(join(session.directory,'session.json')));
  const unrelated=await prepareAgentSession({...options,task:'fix payments'});assert.deepEqual(unrelated.selected,[]);assert.ok(!unrelated.args.at(-1).includes('Widget instruction sentinel'));await unrelated.cleanup();
  const writable=await prepareAgentSession({...options,write:true});assert.equal(writable.args[writable.args.indexOf('--permission-mode')+1],'default');const writeConfig=JSON.parse(await readFile(writable.args[writable.args.indexOf('--mcp-config')+1],'utf8'));assert.ok(writeConfig.mcpServers.aiskills.args.includes('--allow-capability-execution'));await writable.cleanup();
  const old=process.env.AI_SKILLS_CLAUDE_BINARY;process.env.AI_SKILLS_CLAUDE_BINARY='/does/not/exist';
  try {await assert.rejects(runAgentSession(options));assert.deepEqual((await readdir(process.env.AI_SKILLS_HOME)).filter(x=>x.startsWith('.session-')),[]);}finally{if(old===undefined)delete process.env.AI_SKILLS_CLAUDE_BINARY;else process.env.AI_SKILLS_CLAUDE_BINARY=old;}
});
test('live Codex effective MCP set contains only session servers enabled',{skip:!process.env.AI_SKILLS_CODEX_LIVE},async t=>{
  const root=await mkdtemp(join(tmpdir(),'aiskills-codex-config-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const previous=process.env.AI_SKILLS_HOME;const binary=process.env.AI_SKILLS_CODEX_BINARY;
  process.env.AI_SKILLS_HOME=root;process.env.AI_SKILLS_CODEX_BINARY=process.env.AI_SKILLS_CODEX_LIVE;
  t.after(()=>{if(previous===undefined)delete process.env.AI_SKILLS_HOME;else process.env.AI_SKILLS_HOME=previous;if(binary===undefined)delete process.env.AI_SKILLS_CODEX_BINARY;else process.env.AI_SKILLS_CODEX_BINARY=binary;});
  const session=await prepareAgentSession({agent:'codex',task:'review project',project:process.cwd(),cliPath:join(process.cwd(),'packages/cli/dist/index.js')});
  try {const prefix=session.args.slice(0,session.args.indexOf('--sandbox'));const output=await promisify(execFile)(session.command,[...prefix,'mcp','list','--json']);const rows=JSON.parse(output.stdout);assert.deepEqual(rows.filter(r=>r.enabled).map(r=>r.name),['aiskills']);const features=(await promisify(execFile)(session.command,[...prefix,'features','list'])).stdout;for(const name of ['plugins','remote_plugin','hooks'])assert.match(features,new RegExp(`^${name}\\s+stable\\s+false$`,'m'));}finally{await session.cleanup();}
});
test('session timeout kills an agent and its descendant even when SIGTERM is ignored',{skip:process.platform==='win32',timeout:10000},async t=>{
  const root=await mkdtemp(join(tmpdir(),'aiskills-session-kill-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const pidFile=join(root,'descendant.pid');
  const script=`const {spawn}=require('node:child_process');const fs=require('node:fs');process.on('SIGTERM',()=>{});const child=spawn(process.execPath,['-e',"process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"],{stdio:'inherit'});fs.writeFileSync(${JSON.stringify(pidFile)},String(child.pid));setInterval(()=>{},1000);`;
  const started=Date.now();assert.equal(await runSessionProcess(process.execPath,['-e',script],root,500),1);assert.ok(Date.now()-started<5000);
  const pid=Number(await readFile(pidFile,'utf8'));
  // Linux may briefly retain the killed child as a zombie before reaping it.
  try{const status=await readFile(`/proc/${pid}/status`,'utf8');assert.match(status,/State:\s+Z/);}catch(error){if(error.code!=='ENOENT')throw error;}
});
