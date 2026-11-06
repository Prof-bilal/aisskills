import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ensureProjectMemoryStore,captureBrowserReference} from '../packages/core/dist/index.js';

test('browser capture fails closed when Warden is unavailable',async t=>{
  const root=await mkdtemp(join(tmpdir(),'aiskills-browser-deny-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const old={state:process.env.AI_SKILLS_HOME,warden:process.env.AI_SKILLS_WARDEN_BINARY,chromium:process.env.AI_SKILLS_CHROMIUM_BINARY};process.env.AI_SKILLS_HOME=join(root,'state');process.env.AI_SKILLS_WARDEN_BINARY='/does/not/exist';process.env.AI_SKILLS_CHROMIUM_BINARY=process.execPath;
  t.after(()=>{for(const [key,value] of [['AI_SKILLS_HOME',old.state],['AI_SKILLS_WARDEN_BINARY',old.warden],['AI_SKILLS_CHROMIUM_BINARY',old.chromium]])if(value===undefined)delete process.env[key];else process.env[key]=value;});
  const store=await ensureProjectMemoryStore(root);try{const ref=store.addReference({url:'https://example.com'});await assert.rejects(captureBrowserReference(store,ref.id),/ENOENT/);assert.equal(store.getReference(ref.id).status,'failed');assert.deepEqual(store.referenceArtifacts(ref.id),[]);}finally{store.close();}
});
test('capture failure cancels pending broker requests and waits for forced child termination',{skip:process.platform==='win32'},async t=>{
  const root=await mkdtemp(join(tmpdir(),'aiskills-browser-cleanup-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const previous={state:process.env.AI_SKILLS_HOME,warden:process.env.AI_SKILLS_WARDEN_BINARY,chromium:process.env.AI_SKILLS_CHROMIUM_BINARY};
  const fake=join(root,'supervisor');const pidFile=join(root,'pid');
  await writeFile(fake,`#!${process.execPath}\nconst fs=require('node:fs');fs.writeFileSync(${JSON.stringify(pidFile)},String(process.pid));process.on('SIGTERM',()=>{});process.stdout.write(JSON.stringify({kind:'request',id:1,url:'https://example.com/'})+'\\ninvalid protocol\\n');setInterval(()=>{},1000);`,{mode:0o700});
  process.env.AI_SKILLS_HOME=join(root,'state');process.env.AI_SKILLS_WARDEN_BINARY=fake;process.env.AI_SKILLS_CHROMIUM_BINARY=process.execPath;
  t.after(()=>{for(const [key,value] of [['AI_SKILLS_HOME',previous.state],['AI_SKILLS_WARDEN_BINARY',previous.warden],['AI_SKILLS_CHROMIUM_BINARY',previous.chromium]])if(value===undefined)delete process.env[key];else process.env[key]=value;});
  let cancelled=false;const store=await ensureProjectMemoryStore(root);try{const ref=store.addReference({url:'https://example.com'});await assert.rejects(captureBrowserReference(store,ref.id,[],async(_url,_hosts,_redirects,budget)=>new Promise((_resolve,reject)=>{budget.signal.addEventListener('abort',()=>{cancelled=true;reject(new Error('cancelled'));},{once:true});})),/protocol/);assert.equal(cancelled,true);const pid=Number(await readFile(pidFile,'utf8'));assert.throws(()=>process.kill(pid,0));}finally{store.close();}
});

test('real Warden browser renders JavaScript and stores PNG evidence without direct networking',{skip:!process.env.AI_SKILLS_BROWSER_LIVE},async t=>{
  const root=await mkdtemp(join(tmpdir(),'aiskills-browser-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const previous=process.env.AI_SKILLS_WARDEN_BINARY;const state=process.env.AI_SKILLS_HOME;process.env.AI_SKILLS_WARDEN_BINARY=process.env.AI_SKILLS_BROWSER_LIVE;process.env.AI_SKILLS_HOME=join(root,'state');
  t.after(()=>{if(previous===undefined)delete process.env.AI_SKILLS_WARDEN_BINARY;else process.env.AI_SKILLS_WARDEN_BINARY=previous;if(state===undefined)delete process.env.AI_SKILLS_HOME;else process.env.AI_SKILLS_HOME=state;});
  const store=await ensureProjectMemoryStore(root);try{
    const ref=store.addReference({url:'https://example.com',sourceType:'design'});
    const artifact=await captureBrowserReference(store,ref.id,[],async url=>{
      if(url!=='https://example.com/')throw new Error('Not an approved fixture request');
      return {url,contentType:'text/html',body:Buffer.from('<html><title>JS fixture</title><body><h1 id="title">Initial</h1><script>document.getElementById("title").textContent="Rendered JavaScript sentinel";</script></body></html>')};
    });
    assert.match(artifact.text,/Rendered JavaScript sentinel/);assert.match(artifact.snapshot,/heading/);assert.equal((await readFile(artifact.screenshotPath)).subarray(0,8).toString('hex'),'89504e470d0a1a0a');assert.equal(store.getReference(ref.id).status,'acquired');assert.ok(!JSON.stringify(artifact).includes('base64'));
  }finally{store.close();}
});
