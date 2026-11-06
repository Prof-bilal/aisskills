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
