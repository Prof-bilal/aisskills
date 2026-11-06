import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, realpath } from 'node:fs/promises';
import { join, isAbsolute } from 'node:path';
import { stringify } from 'yaml';
import { PackageCatalog, verifyPackage } from './packages.js';
import {readPluginBundle} from './plugin-bundle.js';

export interface CapabilityRuntime {
  kind: 'command' | 'mcp'; command?: string[]; upstream?: string;
  tools?: string[]; network?: string[]; env?: string[];
}
export interface PreparedCapability {
  id: string; packageDigest: string; runtime: CapabilityRuntime;
  policy: string; rules: string; policyDigest: string; rulesDigest: string;
  approved: boolean;
  entry?:string;
}
const hash=(data:string)=>createHash('sha256').update(data).digest('hex');
export function validateCapabilityRuntime(value:unknown): CapabilityRuntime {
  if(!value || typeof value!=='object' || Array.isArray(value)) throw new Error('runtime.json must contain an object');
  const v=value as CapabilityRuntime;
  if(Object.keys(v).some(k=>!['kind','command','upstream','tools','network','env'].includes(k))) throw new Error('Unknown runtime property');
  if(!['command','mcp'].includes(v.kind)) throw new Error('Runtime kind must be command or mcp');
  if(Boolean(v.command)===Boolean(v.upstream)) throw new Error('Provide exactly one command or remote upstream');
  if(v.command && (!Array.isArray(v.command)||!v.command.length||v.command.length>64||v.command.some(a=>typeof a!=='string'||a.length>4096||a.includes('\0'))||!isAbsolute(v.command[0]))) throw new Error('Runtime command must use an absolute executable and bounded argv');
  if(v.upstream) { const url=new URL(v.upstream); if(v.kind!=='mcp'||url.protocol!=='https:'||url.username||url.password||url.hash||url.hostname==='localhost'||/^(127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(url.hostname)||url.hostname.includes(':')) throw new Error('Remote MCP requires a public HTTPS upstream'); }
  for(const key of ['tools','network','env'] as const) if(v[key]!==undefined && (!Array.isArray(v[key])||v[key]!.length>128||v[key]!.some(s=>typeof s!=='string'||!s||s.length>256))) throw new Error(`Invalid runtime ${key}`);
  if(v.network?.some(h=>!/^[a-zA-Z0-9][a-zA-Z0-9.-]*$/.test(h))) throw new Error('Network grants must be exact hostnames');
  if(v.env?.some(e=>!/^[A-Za-z_][A-Za-z0-9_]*$/.test(e))) throw new Error('Environment grants must name variables');
  if(v.kind==='mcp' && !v.tools?.length) throw new Error('MCP runtime must declare a nonempty tool allowlist');
  return v;
}
export async function prepareCapability(catalog:PackageCatalog,id:string,approve=false,entry?:string,options:{tools?:string[];executable?:string;hosts?:string[]}={}):Promise<PreparedCapability> {
  const p=catalog.get(id); await verifyPackage(p);
  if(p.status!=='approved') throw new Error('Review the package before preparing execution');
  if(entry&&!/^[a-z0-9][a-z0-9-]*$/.test(entry))throw new Error('Invalid runtime entry');
  const bundle=await readPluginBundle(p.directory);
  if(bundle&&!entry)throw new Error(`Select a bundle runtime with --entry: ${Object.keys(bundle.runtimes).join(', ')}`);
  const declared=bundle?bundle.runtimes[entry!]:JSON.parse(await readFile(join(p.directory,'runtime.json'),'utf8'));
  if(!declared)throw new Error('Runtime entry not found');
  if(options.executable&&!declared.command)throw new Error('Executable override requires a local runtime');
  const candidate={...declared,...(options.tools?{tools:options.tools}:{}),...(options.hosts?{network:options.hosts}:{}),...(options.executable?{command:[options.executable,...declared.command.slice(1)]}:{})};
  if(candidate.command&&!isAbsolute(candidate.command[0]))throw new Error('Native command requires --executable=/absolute/path after host review');
  if(candidate.kind==='mcp'&&!candidate.tools?.length)throw new Error('Native MCP requires an explicit --tools=name1,name2 allowlist');
  const runtime=validateCapabilityRuntime(candidate);
  const command=runtime.command?.map(a=>a.replaceAll('${PACKAGE}',p.directory));
  const normalized={...runtime,command};
  const policy=stringify({command,filesystem:{read:command?[p.directory,await realpath(command[0])]:[],write:[],protect_secrets:true},network:{allow:runtime.network??[]},env:{allow:runtime.env??[]},limits:{memory_mb:512,timeout_s:300}});
  const rules=JSON.stringify({version:1,tools:Object.fromEntries((runtime.tools??[]).map(t=>[t,{}])),resources:[],prompts:[],max_bytes:1048576,timeout_seconds:60});
  const prepared:PreparedCapability={id,packageDigest:p.digest,entry,runtime:normalized,policy,rules,policyDigest:hash(policy),rulesDigest:hash(rules),approved:approve};
  if(approve) {
    const directory=join(catalog.root,'capabilities',p.digest,...(entry?[entry]:[])); await mkdir(directory,{recursive:true,mode:0o700});
    let changed=true;try{const previous=JSON.parse(await readFile(join(directory,'approval.json'),'utf8'));changed=previous.policyDigest!==prepared.policyDigest||previous.rulesDigest!==prepared.rulesDigest;}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
    if(changed)catalog.invalidateProjectLocks(id);
    await writeFile(join(directory,'policy.yaml'),policy,{mode:0o600}); await writeFile(join(directory,'rules.json'),rules,{mode:0o600});
    await writeFile(join(directory,'approval.json'),JSON.stringify(prepared,null,2),{mode:0o600});
  }
  return prepared;
}
export async function capabilityLaunch(catalog:PackageCatalog,id:string,entry?:string):Promise<{command:string;args:string[]}> {
  const p=catalog.get(id); await verifyPackage(p); if(p.status!=='approved') throw new Error('Package approval revoked');
  if(entry&&!/^[a-z0-9][a-z0-9-]*$/.test(entry))throw new Error('Invalid runtime entry');
  const directory=join(catalog.root,'capabilities',p.digest,...(entry?[entry]:[]));
  const approval=JSON.parse(await readFile(join(directory,'approval.json'),'utf8')) as PreparedCapability;
  if(!approval.approved||approval.packageDigest!==p.digest||approval.id!==id||approval.entry!==entry) throw new Error('Capability approval does not match package');
  const policy=join(directory,'policy.yaml'); const rules=join(directory,'rules.json');
  if(hash(await readFile(policy,'utf8'))!==approval.policyDigest||hash(await readFile(rules,'utf8'))!==approval.rulesDigest) throw new Error('Reviewed policy or rules changed');
  const runtime=validateCapabilityRuntime(approval.runtime);
  const binary=process.env.AI_SKILLS_WARDEN_BINARY??'warden';
  if(runtime.kind==='command') return {command:binary,args:['run','--policy',policy,'--policy-sha256',approval.policyDigest,'--',...runtime.command!]};
  return {command:binary,args:['connect','--rules',rules,...(runtime.upstream?['--upstream',runtime.upstream]:['--policy',policy,'--',...runtime.command!])]};
}
export async function capabilityLaunches(catalog:PackageCatalog,id:string):Promise<Record<string,{command:string;args:string[]}>> {
  const p=catalog.get(id);await verifyPackage(p);const bundle=await readPluginBundle(p.directory);
  if(!bundle)return {default:await capabilityLaunch(catalog,id)};
  if(p.status!=='approved')throw new Error('Package approval revoked');
  const result:Record<string,{command:string;args:string[]}>={};
  for(const entry of Object.keys(bundle.runtimes))result[entry]=await capabilityLaunch(catalog,id,entry);
  return result;
}
export async function capabilityPolicySummary(catalog:PackageCatalog,id:string):Promise<Record<string,{policyDigest:string;rulesDigest:string}>> {
  const p=catalog.get(id);const bundle=await readPluginBundle(p.directory);const entries=bundle?Object.keys(bundle.runtimes):['default'];
  await capabilityLaunches(catalog,id);
  const result:Record<string,{policyDigest:string;rulesDigest:string}>={};for(const entry of entries){const file=join(catalog.root,'capabilities',p.digest,...(bundle?[entry]:[]),'approval.json');const a=JSON.parse(await readFile(file,'utf8'));result[entry]={policyDigest:a.policyDigest,rulesDigest:a.rulesDigest};}return result;
}
/** Names only; session configuration must never serialize credential values. */
export async function capabilityEnvironmentNames(catalog:PackageCatalog,id:string):Promise<string[]> {
  const p=catalog.get(id);const bundle=await readPluginBundle(p.directory);
  await capabilityLaunches(catalog,id);
  const result=new Set<string>();
  for(const entry of (bundle?Object.keys(bundle.runtimes):['default'])) {
    const approval=JSON.parse(await readFile(join(catalog.root,'capabilities',p.digest,...(bundle?[entry]:[]),'approval.json'),'utf8')) as PreparedCapability;
    for(const name of validateCapabilityRuntime(approval.runtime).env??[])result.add(name);
  }
  return [...result].sort();
}
