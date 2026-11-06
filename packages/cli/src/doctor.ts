import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {getBuiltInSkillsDirectory,SkillRegistry,loadUserConfig,openPackageCatalog,verifyPackage} from 'aiskills-core';
import {detectAgents} from 'aiskills-adapters-local';

const exec=promisify(execFile);
export interface Diagnostic {name:string;status:'PASS'|'WARN'|'FAIL';detail:string}
export async function collectDiagnostics():Promise<Diagnostic[]> {
  const checks:Diagnostic[]=[];
  async function check(name:string,run:()=>Promise<string>) {try{checks.push({name,status:'PASS',detail:await run()});}catch(error){checks.push({name,status:'FAIL',detail:error instanceof Error?error.message:String(error)});}}
  await check('Node runtime',async()=>{if(Number(process.versions.node.split('.')[0])<20)throw new Error('Node 20 or later required');return process.version;});
  await check('Configuration',async()=>{const config=await loadUserConfig();if(!config.profiles[config.activeProfile])throw new Error('Active profile is missing');return `Active profile: ${config.activeProfile}`;});
  await check('Built-in registry',async()=>{const registry=await SkillRegistry.fromDirectory(getBuiltInSkillsDirectory());registry.resolve(registry.list().map(s=>s.id));return `${registry.list().length} manifests validated, dependencies resolved`;});
  await check('Installed package integrity',async()=>{const catalog=await openPackageCatalog();try{for(const p of catalog.list())await verifyPackage(p);return `${catalog.list().length} installed snapshots verified`;}finally{catalog.close();}});
  await check('Activation lock synchronization',async()=>{const catalog=await openPackageCatalog();try{const pending=catalog.pendingLocks();if(pending.length)throw new Error(`${pending.length} project locks require synchronization; run skills recover and skills sync-lock in the affected project`);return 'No pending activation lock writes';}finally{catalog.close();}});
  const agents=await detectAgents();checks.push({name:'Agent executables',status:agents.some(a=>a.status==='available')?'PASS':'WARN',detail:agents.map(a=>`${a.id}: ${a.status}`).join('; ')});
  const binary=process.env.AI_SKILLS_WARDEN_BINARY??'warden';
  try {
    const probe=await exec(binary,['doctor'],{timeout:10000,maxBuffer:65536});
    checks.push({name:'Warden sandbox',status:/Status:\s*READY|sandbox.*ready/i.test(probe.stdout)?'PASS':'WARN',detail:/Status:\s*READY|sandbox.*ready/i.test(probe.stdout)?'Sandbox diagnostics report ready':'Inspect warden doctor output; readiness not established'});
    let output='';try{await exec(binary,['connect'],{timeout:5000,maxBuffer:65536});}catch(error){output=String((error as {stderr?:string}).stderr??'');}
    checks.push({name:'Warden MCP gateway',status:/--rules required/.test(output)?'PASS':'WARN',detail:/--rules required/.test(output)?'connect command available':'A Warden build with connect is required for MCP capability execution'});
  }catch{checks.push({name:'Warden sandbox',status:'WARN',detail:'Warden could not establish readiness; executable capabilities must remain blocked. Run warden doctor or set AI_SKILLS_WARDEN_BINARY.'});}
  checks.push({name:'Session isolation',status:'WARN',detail:'MCP/plugin/hook overrides are verified for supported clients; native skill discovery and administrator-managed capabilities require client-specific verification.'});
  return checks;
}
