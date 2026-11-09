import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {openPackageCatalog,installSkillPackage,sanitizeAccess,declaredAccess} from '../packages/core/dist/index.js';
import {evaluateGuard} from '../packages/cli/dist/guard.js';

test('access parsing is default-deny: only well-typed hosts and an explicit secrets:true count',()=>{
  assert.deepEqual(sanitizeAccess(undefined),{network:[],secrets:false});
  assert.deepEqual(sanitizeAccess({network:['Release.Example.com',42,'bad host;rm'],secrets:'yes'}),{network:['release.example.com'],secrets:false});
  assert.deepEqual(sanitizeAccess({network:['api.example.com'],secrets:true}),{network:['api.example.com'],secrets:true});
});

test('declared access is the union of enabled skills; disabled skills contribute nothing',async t=>{
  const root=await mkdtemp(join(tmpdir(),'aiskills-access-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const saved=process.env.AI_SKILLS_HOME;process.env.AI_SKILLS_HOME=join(root,'state');t.after(()=>{if(saved===undefined)delete process.env.AI_SKILLS_HOME;else process.env.AI_SKILLS_HOME=saved;});
  const make=async(name,fm)=>{const d=join(root,name);await mkdir(d);await writeFile(join(d,'SKILL.md'),`---\nname: ${name}\ndescription: Review ${name} things\n${fm}\n---\nGuidance.`);return d;};
  const a=await make('alpha','access:\n  network: [health.example.com]');
  const b=await make('beta','access:\n  secrets: true');
  const catalog=await openPackageCatalog();
  try{
    const pa=await installSkillPackage(catalog,{source:a,approve:true});const pb=await installSkillPackage(catalog,{source:b,approve:true});
    await catalog.enable(pa.id,root,true);
    const before=await declaredAccess(catalog,root);
    assert.deepEqual([...before.network],['health.example.com']);assert.equal(before.secrets,false);
    await catalog.enable(pb.id,root,true);
    assert.equal((await declaredAccess(catalog,root)).secrets,true);
    await catalog.enable(pb.id,root,false);
    assert.equal((await declaredAccess(catalog,root)).secrets,false);
  }finally{catalog.close();}
});

test('guard honours declared hosts and secrets, and still denies everything else',()=>{
  const base={cwd:'/work/project',home:'/home/user'};
  const curl=cmd=>evaluateGuard({...base,tool:'Bash',input:{command:cmd},allowHosts:['health.example.com'],secretsAllowed:false});
  assert.equal(curl('curl https://health.example.com/ping'),null);
  assert.ok(curl('curl https://evil.test/x'));
  const read=(p,secretsAllowed)=>evaluateGuard({...base,tool:'Read',input:{file_path:p},allowHosts:[],secretsAllowed});
  assert.ok(read('/work/project/.env',false));
  assert.equal(read('/work/project/.env',true),null);
});
