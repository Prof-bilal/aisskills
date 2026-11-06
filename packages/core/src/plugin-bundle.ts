import {readFile,readdir} from 'node:fs/promises';
import {join,resolve,relative,isAbsolute} from 'node:path';
import {validateCapabilityRuntime} from './capabilities.js';
import type {CapabilityRuntime} from './capabilities.js';
import {parse} from 'yaml';
import {adaptNativePlugin} from './native-plugins.js';
export interface PluginBundle {schema_version:1;id:string;name:string;description:string;version:string;skills:string[];runtimes:Record<string,CapabilityRuntime>;hooks:Partial<Record<'before-session'|'after-session',string>>;nativeSource?:string}
export function validatePluginBundle(value:unknown,native=false):PluginBundle {
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Plugin bundle must be an object');
  const b=value as PluginBundle;
  if(Object.keys(b).some(k=>![...['schema_version','id','name','description','version','skills','runtimes','hooks'],...(native?['nativeSource']:[])].includes(k))||b.schema_version!==1)throw new Error('Unsupported plugin bundle schema');
  if(!/^[a-z0-9][a-z0-9-]*$/.test(b.id)||typeof b.name!=='string'||!b.name.trim()||typeof b.description!=='string'||!b.description.trim()||!/^\d+\.\d+\.\d+$/.test(b.version))throw new Error('Plugin bundle identity is invalid');
  if(!Array.isArray(b.skills)||b.skills.length>32||b.skills.some(p=>typeof p!=='string'||!p||isAbsolute(p)||p.includes('\\')||p.split('/').some(x=>x==='..'||x==='.'||!x)||!p.endsWith('SKILL.md')))throw new Error('Plugin skills must be bounded relative SKILL.md paths');
  if(!b.runtimes||typeof b.runtimes!=='object'||Array.isArray(b.runtimes)||Object.keys(b.runtimes).length>16)throw new Error('Invalid plugin runtimes');
  for(const [id,runtime] of Object.entries(b.runtimes)){if(!/^[a-z0-9][a-z0-9-]*$/.test(id))throw new Error('Invalid runtime entry ID');validateCapabilityRuntime(native?{...runtime,tools:['review-required'],...(runtime.command?{command:['/host-review-required',...runtime.command.slice(1)]}:{})}:runtime);}
  if(!b.hooks||typeof b.hooks!=='object'||Array.isArray(b.hooks)||Object.keys(b.hooks).some(k=>!['before-session','after-session'].includes(k)))throw new Error('Unsupported hook event');
  for(const id of Object.values(b.hooks))if(typeof id!=='string'||!b.runtimes[id]||b.runtimes[id].kind!=='command')throw new Error('Hooks must reference command runtimes');
  return b;
}
export async function readPluginBundle(directory:string,files?:Map<string,Buffer>):Promise<PluginBundle|undefined> {
  try{return validatePluginBundle(JSON.parse(await readFile(join(directory,'aiskills-plugin.json'),'utf8')));}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
  if(!files){let native=false;for(const path of ['.claude-plugin/plugin.json','.codex-plugin/plugin.json','plugin.json'])try{await readFile(join(directory,path));native=true;break;}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}if(!native)return undefined;}
  if(!files){files=new Map();const walk=async(dir:string,depth:number):Promise<void>=>{if(depth>12)throw new Error('Plugin nesting limit');for(const e of await readdir(dir,{withFileTypes:true})){if(e.name==='.git')continue;const path=join(dir,e.name);if(e.isSymbolicLink())throw new Error('Plugin symlink rejected');if(e.isDirectory())await walk(path,depth+1);else {if(files!.size>=1000)throw new Error('Plugin file limit');files!.set(relative(directory,path).split('\\').join('/'),await readFile(path));}}};await walk(directory,0);}
  const native=adaptNativePlugin(files);return native?validatePluginBundle(native,true):undefined;
}
export async function bundleGuidance(directory:string,bundle:PluginBundle,task:string):Promise<string[]> {
  const words=new Set(task.toLowerCase().split(/\W+/));const selected:string[]=[];let size=0;
  for(const path of bundle.skills){const file=resolve(directory,path);if(relative(directory,file).startsWith('..'))throw new Error('Skill path escapes bundle');
    const text=await readFile(file,'utf8');const header=text.match(/^---\r?\n([\s\S]*?)\r?\n---/);if(!header)throw new Error('Bundle skill requires frontmatter');
    const metadata=parse(header[1]);if(typeof metadata?.name!=='string'||typeof metadata?.description!=='string')throw new Error('Bundle skill requires name and description');
    const terms=`${metadata.name} ${metadata.description}`.toLowerCase().split(/\W+/).filter(w=>w.length>3);
    if(!terms.some(t=>words.has(t)))continue;
    size+=text.length;if(text.length>20000||size>40000)throw new Error('Bundle guidance exceeds context budget');selected.push(text);
  }return selected;
}
