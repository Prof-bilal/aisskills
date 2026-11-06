import type { SkillManifest } from './index.js';

export interface RoutingCandidate {id:string;manifest:SkillManifest;estimatedTokens:number;dependencyOnly?:boolean}
export interface RoutingOptions {agent?:string;pinned?:string[];projectCapabilities?:string[];budgetTokens?:number}
export interface RoutingDecision {selected:string[];reasons:Record<string,string[]>;excluded:Record<string,string>;estimatedTokens:number;baselineTokens:number}
const terms=(text:string)=>new Set(text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));
function phrase(text:Set<string>,value:string):boolean {const parts=[...terms(value)];return !!parts.length&&parts.every(t=>text.has(t));}

/** Deterministic metadata-only selection; permission approval is never inferred. */
export function evaluateCapabilityRouting(task:string,candidates:RoutingCandidate[],options:RoutingOptions={}):RoutingDecision {
  const words=terms(task);const excluded:Record<string,string>={};const reasons:Record<string,string[]>={};
  const pinned=new Set(options.pinned??[]);const project=new Set(options.projectCapabilities??[]);
  const genericBackend=[...words].some(t=>['auth','authentication','database','backend','sql','rls','migration','storage','query'].includes(t));
  const ranked:Array<{id:string;score:number}>=[];const byId=new Map(candidates.map(c=>[c.id,c]));
  for(const c of candidates) {
    if(c.dependencyOnly) continue;
    const m=c.manifest;const why:string[]=[];let score=0;
    if(options.agent&&m.compatible_agents.length&&!m.compatible_agents.includes(options.agent)) {excluded[c.id]='Agent is incompatible';continue;}
    if(!pinned.has(c.id)&&m.activation?.negative_triggers?.some(t=>phrase(words,t))) {excluded[c.id]='Negative trigger matched';continue;}
    if(pinned.has(c.id)) {score+=100;why.push('Explicit project pin');}
    if(phrase(words,c.id)) {score+=5;why.push('Skill name matched');}
    for(const t of m.activation?.triggers??[]) if(phrase(words,t)) {score+=4;why.push(`Trigger: ${t}`);}
    for(const t of m.capabilities) if(phrase(words,t)) {score+=3;why.push(`Capability: ${t}`);}
    for(const t of terms(m.description)) if(t.length>5&&words.has(t)) {score++;why.push(`Description: ${t}`);}
    if(genericBackend&&[c.id,...m.capabilities].some(t=>[...project].some(p=>t.toLowerCase().includes(p)))) {score+=3;why.push('Backend task matches detected project provider');}
    if(score) {ranked.push({id:c.id,score});reasons[c.id]=why;} else excluded[c.id]='No task or project evidence';
  }
  ranked.sort((a,b)=>b.score-a.score||a.id.localeCompare(b.id));
  const selected=new Set<string>();let estimatedTokens=0;
  const budget=options.budgetTokens??12000;if(!Number.isInteger(budget)||budget<1) throw new Error('Routing budget must be a positive integer');
  function dependencies(id:string,chain:string[]=[]):string[] {
    if(chain.includes(id)) throw new Error(`Circular routing dependency: ${[...chain,id].join(' -> ')}`);
    const c=byId.get(id);if(!c)throw new Error(`Dependency must be installed, approved and enabled: ${id}`);
    if(options.agent&&c.manifest.compatible_agents.length&&!c.manifest.compatible_agents.includes(options.agent))throw new Error(`Dependency is incompatible: ${id}`);
    if(c.manifest.activation?.negative_triggers?.some(t=>phrase(words,t))&&!pinned.has(id))throw new Error(`Dependency excluded by negative trigger: ${id}`);
    return [...c.manifest.dependencies.skills.flatMap(d=>dependencies(d,[...chain,id])),id];
  }
  for(const candidate of ranked) {
    const needed=[...new Set(dependencies(candidate.id))].filter(id=>!selected.has(id));
    const cost=needed.reduce((sum,id)=>sum+byId.get(id)!.estimatedTokens,0);
    if(cost+estimatedTokens>budget) {if(pinned.has(candidate.id))throw new Error(`Pinned skill exceeds context budget: ${candidate.id}`);excluded[candidate.id]='Context budget exceeded';delete reasons[candidate.id];continue;}
    for(const id of needed) {selected.add(id);delete excluded[id];reasons[id]??=[`Dependency of ${candidate.id}`];}estimatedTokens+=cost;
  }
  return {selected:[...selected],reasons,excluded,estimatedTokens,baselineTokens:candidates.reduce((sum,c)=>sum+c.estimatedTokens,0)};
}
