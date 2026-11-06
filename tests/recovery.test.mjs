import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {PackageCatalog,installSkillPackage,writePackageLock,resetProjectLock,packageRecoveryReport,verifyPackage} from '../packages/core/dist/index.js';
async function fixture(t){const root=await mkdtemp(join(tmpdir(),'aiskills-recovery-'));t.after(()=>rm(root,{recursive:true,force:true}));const state=join(root,'state');const source=join(root,'source');await mkdir(state);await mkdir(source);await writeFile(join(source,'SKILL.md'),'---\nname: recovery-widget\ndescription: Review recovery widgets\n---\nInspect widgets.');const catalog=new PackageCatalog(state);t.after(()=>catalog.close());return {root,state,source,catalog};}

test('failed lock write blocks activation and reset preserves the broken file for recovery',async t=>{
  const {root,source,catalog}=await fixture(t);const p=await installSkillPackage(catalog,{source,approve:true});await writeFile(join(root,'aiskills.lock'),'{broken lock');
  await assert.rejects(catalog.enable(p.id,root,true));assert.equal(catalog.pendingLocks().length,1);await assert.rejects(catalog.active(root),/sync-lock/);
  const backup=await resetProjectLock(catalog,root);assert.equal(await readFile(backup,'utf8'),'{broken lock');assert.equal(catalog.pendingLocks().length,0);assert.deepEqual((await catalog.active(root)).map(p=>p.id),[p.id]);
});
test('a tampered lock cannot change activation or authorize a different digest',async t=>{
  const {root,source,catalog}=await fixture(t);const p=await installSkillPackage(catalog,{source,approve:true});await catalog.enable(p.id,root,true);const file=join(root,'aiskills.lock');const lock=JSON.parse(await readFile(file,'utf8'));lock.installed_packages[p.id].content_hash='forged';await writeFile(file,JSON.stringify(lock));await assert.rejects(catalog.active(root),/differs/);await writePackageLock(catalog,root);assert.equal((await catalog.active(root))[0].digest,p.digest);
});
test('concurrent conflicting imports through independent SQLite connections have one winner',async t=>{
  const {state,source,catalog}=await fixture(t);const other=join(state,'other-source');await mkdir(other);await writeFile(join(other,'SKILL.md'),'---\nname: recovery-widget\ndescription: Review recovery widgets\n---\nDifferent content.');const second=new PackageCatalog(state);t.after(()=>second.close());
  const results=await Promise.allSettled([installSkillPackage(catalog,{source}),installSkillPackage(second,{source:other})]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.filter(r=>r.status==='rejected').length,1);assert.equal(catalog.list().length,1);await verifyPackage(catalog.get('recovery-widget'));
});
test('interrupted directory reports distinguish live ownership from missing evidence without deleting data',async t=>{
  const {state,catalog}=await fixture(t);const live=join(state,'.quarantine-live');const unknown=join(state,'.session-unknown');await mkdir(live);await mkdir(unknown);await writeFile(join(live,'owner.json'),JSON.stringify({pid:process.pid}));await mkdir(join(state,'packages', 'a'.repeat(64)),{recursive:true});
  const report=await packageRecoveryReport(catalog);assert.equal(report.temporaryDirectories.find(x=>x.path===live).ownerAlive,true);assert.equal(report.temporaryDirectories.find(x=>x.path===unknown).ownerAlive,null);assert.deepEqual(report.unreferencedSnapshots,['a'.repeat(64)]);assert.equal(await readFile(join(live,'owner.json'),'utf8'),JSON.stringify({pid:process.pid}));
});
test('pending lock sync does not prevent revoking a capability',async t=>{
  const {root,source,catalog}=await fixture(t);const p=await installSkillPackage(catalog,{source,approve:true});await writeFile(join(root,'aiskills.lock'),'{broken');await assert.rejects(catalog.enable(p.id,root,true));await assert.rejects(catalog.enable(p.id,root,false));assert.deepEqual(await catalog.active(root),[]);
});
for(const phase of ['quarantine','snapshot'])test(`process death after ${phase} publication cannot activate a partial import`,{skip:process.platform==='win32'},async t=>{
  const {root,state,source,catalog}=await fixture(t);const moduleUrl=new URL('../packages/core/dist/index.js',import.meta.url).href;
  const code=`import fs from 'node:fs/promises';import {syncBuiltinESMExports} from 'node:module';
const pause=async()=>{setInterval(()=>{},1000);process.send('ready');await new Promise(()=>{});};
const write=fs.writeFile;const rename=fs.rename;
fs.writeFile=async(...args)=>{const result=await write(...args);if(${JSON.stringify(phase)}==='quarantine'&&String(args[0]).endsWith('/owner.json'))await pause();return result;};
fs.rename=async(...args)=>{const result=await rename(...args);if(${JSON.stringify(phase)}==='snapshot'&&String(args[1]).startsWith(${JSON.stringify(join(state,'packages'))}))await pause();return result;};syncBuiltinESMExports();
const {PackageCatalog,installSkillPackage}=await import(${JSON.stringify(moduleUrl)});const catalog=new PackageCatalog(${JSON.stringify(state)});await installSkillPackage(catalog,{source:${JSON.stringify(source)},approve:true});`;
  const child=spawn(process.execPath,['--input-type=module','-e',code],{stdio:['ignore','ignore','pipe','ipc']});t.after(()=>{if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');});
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{child.kill('SIGKILL');reject(new Error('Crash fixture did not reach publication phase'));},10000);child.once('message',()=>{clearTimeout(timer);resolve();});child.once('error',e=>{clearTimeout(timer);reject(e);});child.once('exit',()=>{clearTimeout(timer);reject(new Error('Crash fixture exited before publication phase'));});});
  const exit=once(child,'exit');child.kill('SIGKILL');const [,signal]=await exit;assert.equal(signal,'SIGKILL');assert.equal(catalog.list().length,0);assert.deepEqual(await catalog.active(root),[]);
  const report=await packageRecoveryReport(catalog);assert.equal(report.temporaryDirectories[0].ownerAlive,false);if(phase==='snapshot')assert.equal(report.unreferencedSnapshots.length,1);
  const recovered=await installSkillPackage(catalog,{source,approve:true});await verifyPackage(recovered);assert.equal(catalog.list().length,1);
});
