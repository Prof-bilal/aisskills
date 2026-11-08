import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateCapabilityRouting} from '../packages/core/dist/index.js';

function candidate(id,extra={}) {return {id,estimatedTokens:1000,manifest:{id,description:`Guidance for ${id}`,capabilities:[id],compatible_agents:[],activation:{},dependencies:{skills:[]},...extra}};}
test('routing uses exact tokens, project evidence, negative triggers and compatibility',()=>{
  const candidates=[candidate('supabase'),candidate('firebase'),candidate('ui'),candidate('claude-only',{compatible_agents:['claude']})];
  assert.deepEqual(evaluateCapabilityRouting('build authentication',candidates,{projectCapabilities:['supabase']}).selected,['supabase']);
  assert.deepEqual(evaluateCapabilityRouting('build application',candidates).selected,[]);
  assert.deepEqual(evaluateCapabilityRouting('claude-only',candidates,{agent:'codex'}).selected,[]);
  assert.deepEqual(evaluateCapabilityRouting('firebase migration',[candidate('supabase',{activation:{triggers:['migration'],negative_triggers:['firebase']}})]).selected,[]);
});
test('pins cannot bypass compatibility; dependency closure respects budget and cycles',()=>{
  const candidates=[candidate('frontend',{dependencies:{skills:['review']}}),candidate('review')];
  assert.deepEqual(evaluateCapabilityRouting('frontend',candidates).selected,['review','frontend']);
  assert.deepEqual(evaluateCapabilityRouting('frontend',candidates,{budgetTokens:1500}).selected,[]);
  assert.throws(()=>evaluateCapabilityRouting('frontend',candidates,{budgetTokens:1500,pinned:['frontend']}),/budget/);
  assert.throws(()=>evaluateCapabilityRouting('frontend',[candidate('frontend',{dependencies:{skills:['missing']}})]),/approved and enabled/);
  assert.throws(()=>evaluateCapabilityRouting('frontend',[candidate('frontend',{dependencies:{skills:['frontend']}})]),/Circular/);
  assert.deepEqual(evaluateCapabilityRouting('other',[candidate('frontend')],{pinned:['frontend']}).selected,['frontend']);
});

test('sessions route built-in skills by task without any installed packages',async t=>{
  const {mkdtemp,rm}=await import('node:fs/promises');const {join}=await import('node:path');const {tmpdir}=await import('node:os');
  const {openPackageCatalog,planPackageActivation}=await import('../packages/core/dist/index.js');
  const root=await mkdtemp(join(tmpdir(),'aiskills-builtin-routing-'));const previous=process.env.AI_SKILLS_HOME;process.env.AI_SKILLS_HOME=join(root,'home');
  t.after(async()=>{if(previous===undefined)delete process.env.AI_SKILLS_HOME;else process.env.AI_SKILLS_HOME=previous;await rm(root,{recursive:true,force:true});});
  const catalog=await openPackageCatalog();t.after(()=>catalog.close());
  const login=await planPackageActivation(catalog,root,'add login to my app with secure authentication',{agent:'claude'});
  assert.deepEqual(login.selectedPackages,[]);
  assert.ok(login.builtinSkills.includes('auth-security'));
  assert.ok(login.builtinSkills.filter(id=>!['repo-explorer','planner','evidence-first','completion-checker','simplify'].includes(id)).length<=3);
  assert.ok(login.estimatedContextTokens>0&&login.estimatedContextTokens<login.baselineContextTokens);
  assert.ok(!(await planPackageActivation(catalog,root,'what does the parse function return')).builtinSkills.includes('auth-security'));
});
