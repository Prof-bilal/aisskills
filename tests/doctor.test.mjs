import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {collectDiagnostics} from '../packages/cli/dist/doctor.js';

test('doctor reports invalid configuration and unavailable Warden without claiming readiness',async t=>{
  const root=await mkdtemp(join(tmpdir(),'aiskills-doctor-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const old=process.env.AI_SKILLS_HOME;const warden=process.env.AI_SKILLS_WARDEN_BINARY;
  process.env.AI_SKILLS_HOME=root;process.env.AI_SKILLS_WARDEN_BINARY='/does/not/exist';
  t.after(()=>{if(old===undefined)delete process.env.AI_SKILLS_HOME;else process.env.AI_SKILLS_HOME=old;if(warden===undefined)delete process.env.AI_SKILLS_WARDEN_BINARY;else process.env.AI_SKILLS_WARDEN_BINARY=warden;});
  await writeFile(join(root,'config.json'),'{invalid JSON');
  const checks=await collectDiagnostics();assert.equal(checks.find(c=>c.name==='Configuration').status,'FAIL');assert.equal(checks.find(c=>c.name==='Warden sandbox').status,'WARN');assert.equal(checks.find(c=>c.name==='Built-in registry').status,'PASS');
});
