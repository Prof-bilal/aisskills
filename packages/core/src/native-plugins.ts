import {isAbsolute} from 'node:path';
import type {PluginBundle} from './plugin-bundle.js';
import type {CapabilityRuntime} from './capabilities.js';

/** Translates metadata only. Never runs native installers, hooks or commands. */
export function adaptNativePlugin(files:Map<string,Buffer>):PluginBundle|undefined {
  const source=['.claude-plugin/plugin.json','.codex-plugin/plugin.json','plugin.json'].find(p=>files.has(p));
  if(!source)return undefined;
  const meta=JSON.parse(files.get(source)!.toString());
  if(!meta||typeof meta!=='object'||typeof meta.name!=='string')throw new Error('Native plugin requires a name');
  if(meta.hooks||files.has('hooks/hooks.json'))throw new Error('Native hooks require explicit aiskills-plugin.json runtime mappings before import');
  if(meta.commands||meta.agents||[...files.keys()].some(p=>/^(commands|agents)\//.test(p)))throw new Error('Native commands/agents require explicit bundle mappings before import');
  const skills=[...files.keys()].filter(p=>/^skills\/.+\/SKILL\.md$/.test(p));
  const roots=meta.skills===undefined?['skills']:typeof meta.skills==='string'?[meta.skills]:meta.skills;
  if(!Array.isArray(roots)||roots.some((p:unknown)=>typeof p!=='string'||isAbsolute(p)||p.split('/').includes('..')))throw new Error('Native skill roots must stay within the plugin');
  const selectedSkills=[...new Set([...(meta.skills===undefined?skills:[]),...[...files.keys()].filter(p=>roots.some((r:string)=>p.startsWith(r.replace(/^\.\//,'').replace(/\/$/,'')+'/'))&&p.endsWith('/SKILL.md'))])];
  if(meta.skills!==undefined&&roots.some((r:string)=>!selectedSkills.some(p=>p.startsWith(r.replace(/^\.\//,'').replace(/\/$/,'')+'/'))))throw new Error('Declared native skill root contains no SKILL.md files');
  const runtimes:Record<string,CapabilityRuntime>={};
  const configName=typeof meta.mcpServers==='string'?meta.mcpServers.replace(/^\.\//,''):meta.mcpServers!==undefined?undefined:files.has('.mcp.json')?'.mcp.json':files.has('mcp.json')?'mcp.json':undefined;
  if(configName&&(isAbsolute(configName)||configName.split('/').includes('..')))throw new Error('Native MCP config path escapes package');
  const config=configName?JSON.parse(files.get(configName)?.toString()??(()=>{throw new Error('Native MCP config is missing');})()):meta.mcpServers??{};
  const servers=config.mcpServers??config;
  if(!servers||typeof servers!=='object'||Array.isArray(servers))throw new Error('Invalid native MCP configuration');
  for(const [id,raw] of Object.entries(servers)) {
    if(!/^[a-z0-9][a-z0-9-]*$/.test(id))throw new Error('Native server names must be lowercase IDs');
    const s=raw as {command?:unknown;args?:unknown;url?:unknown;env?:unknown;headers?:unknown;type?:unknown};
    if(!s||typeof s!=='object'||s.headers)throw new Error('Native MCP headers require host-managed credential configuration');
    if(Object.keys(s).some(k=>!['command','args','url','env','type'].includes(k)))throw new Error('Unsupported native MCP option; use explicit bundle configuration');
    if(s.type&&!['stdio','http','streamable-http','streamable_http'].includes(String(s.type)))throw new Error('Unsupported native MCP transport');
    const env:string[]=[];
    if(s.env){if(typeof s.env!=='object'||Array.isArray(s.env))throw new Error('Invalid native environment');for(const [name,value] of Object.entries(s.env)){if(value!==`\${${name}}`)throw new Error('Native env values must use same-name ${VARIABLE} placeholders; inline values are not imported');env.push(name);}}
    if(s.url){if(typeof s.url!=='string'||s.command)throw new Error('Invalid native remote MCP server');runtimes[id]={kind:'mcp',upstream:s.url,tools:[],env};}
    else {
      if(typeof s.command!=='string'||!s.command||s.command.startsWith('-')||s.args!==undefined&&(!Array.isArray(s.args)||s.args.some(a=>typeof a!=='string')))throw new Error('Native MCP requires command and argv');
      const command=[s.command,...(s.args as string[]??[])].map(a=>a.replaceAll('${CLAUDE_PLUGIN_ROOT}','${PACKAGE}').replaceAll('${CODEX_PLUGIN_ROOT}','${PACKAGE}'));
      runtimes[id]={kind:'mcp',command,tools:[],env};
    }
  }
  return {schema_version:1,id:meta.name,name:meta.name,description:meta.description??`Skills and tools from ${meta.name}`,version:meta.version??'0.0.0',skills:selectedSkills,runtimes,hooks:{},nativeSource:source};
}
