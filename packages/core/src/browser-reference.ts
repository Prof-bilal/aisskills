import {spawn} from 'node:child_process';
import {mkdtemp,mkdir,writeFile,rm,realpath,lstat,readFile} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {stringify} from 'yaml';
import {fetchBrowserResource,validateFetchUrl} from './reference-fetch.js';
import {getConfigPaths,scanUntrustedContent} from './index.js';
import type {MemoryStore} from './memory-store.js';

export async function captureBrowserReference(store:MemoryStore,id:string,assetHosts:string[]=[],resourceFetcher:typeof fetchBrowserResource=fetchBrowserResource):Promise<any> {
  const reference=store.getReference(id);if(!reference)throw new Error('Reference not found in current scope');
  const target=validateFetchUrl(reference.canonicalUrl);
  if(assetHosts.length>16||assetHosts.some(h=>!/^[a-zA-Z0-9][a-zA-Z0-9.-]*$/.test(h)))throw new Error('Asset hosts must be exact hostnames');
  const hosts=[target.hostname,...assetHosts];const root=getConfigPaths().root;await mkdir(root,{recursive:true,mode:0o700});const temp=await mkdtemp(join(root,'.browser-'));
  try {
    const worker=fileURLToPath(new URL('./browser-worker.js',import.meta.url));const coreRoot=dirname(dirname(worker));
    const library=dirname(fileURLToPath(import.meta.resolve('playwright-core')));
    const chromium=await realpath(process.env.AI_SKILLS_CHROMIUM_BINARY??'/usr/lib/chromium/chromium');
    const policy=stringify({filesystem:{read:[coreRoot,library,await realpath(process.execPath),chromium],write:[],protect_secrets:true},network:{allow:[]},env:{allow:['HOME']},limits:{memory_mb:2048,timeout_s:45}});
    const policyPath=join(temp,'browser.yaml');await writeFile(policyPath,policy,{mode:0o600});const digest=createHash('sha256').update(policy).digest('hex');
    const result=await new Promise<any>((resolve,reject)=>{
      const child=spawn(process.env.AI_SKILLS_WARDEN_BINARY??'warden',['run','--policy',policyPath,'--policy-sha256',digest,'--',process.execPath,worker,chromium,target.toString()],{stdio:['pipe','pipe','pipe']});
      let buffer='';let output=0;let requests=0;let bytes=0;let pending=0;let blocked=0;let stderr='';let result:any;const seen=new Set<number>();
      const abort=new AbortController();let failure:Error|undefined;let killTimer:ReturnType<typeof setTimeout>|undefined;
      const fail=(error:Error)=>{if(failure)return;failure=error;abort.abort();child.kill('SIGTERM');killTimer=setTimeout(()=>child.kill('SIGKILL'),1000);};
      const budget={remaining:16*1024*1024,signal:abort.signal,exhausted:()=>fail(new Error('Browser download budget exceeded'))};
      const timer=setTimeout(()=>fail(new Error('Browser capture timed out')),50000);
      child.once('error',e=>{clearTimeout(timer);reject(e);});
      child.stderr.on('data',chunk=>{if(stderr.length<4000)stderr+=chunk.toString();});
      child.stdout.on('data',chunk=>{
        if(failure)return;
        output+=chunk.length;if(output>5*1024*1024)return fail(new Error('Browser output limit exceeded'));buffer+=chunk.toString();
        let index;while((index=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,index);buffer=buffer.slice(index+1);let m:any;try{m=JSON.parse(line);}catch{return fail(new Error('Invalid browser protocol output'));}
          if(m.kind==='result'){result=m;continue;}if(m.kind==='error')return fail(new Error(String(m.error).slice(0,1000)));
          if(m.kind!=='request'||!Number.isSafeInteger(m.id)||seen.has(m.id)||typeof m.url!=='string'||m.url.length>4096||++requests>64||pending>=8)return fail(new Error('Browser request budget or protocol violated'));
          seen.add(m.id);pending++;
          void resourceFetcher(m.url,hosts,0,budget).then(r=>{bytes+=r.body.length;if(bytes>16*1024*1024){fail(new Error('Browser download budget exceeded'));return;}if(!abort.signal.aborted&&!child.stdin.destroyed)child.stdin.write(JSON.stringify({id:m.id,url:r.url,contentType:r.contentType,body:r.body.toString('base64')})+'\n');}).catch(()=>{blocked++;if(!abort.signal.aborted&&!child.stdin.destroyed)child.stdin.write(JSON.stringify({id:m.id,error:'Resource blocked or unavailable'})+'\n');}).finally(()=>{pending--;});
        }
      });
      child.stdin.on('error',()=>{});
      child.once('close',code=>{clearTimeout(timer);if(killTimer)clearTimeout(killTimer);abort.abort();if(failure)reject(failure);else if(code!==0||!result)reject(new Error(`Sandboxed browser failed (${requests} requests, ${bytes} bytes): ${stderr.slice(0,1000)}`));else resolve({...result,network:{requests,bytes,blocked}});});
    });
    if(typeof result.url!=='string'||!hosts.includes(validateFetchUrl(result.url).hostname)||typeof result.title!=='string'||result.title.length>300||typeof result.text!=='string'||result.text.length>16000||typeof result.snapshot!=='string'||result.snapshot.length>16000||typeof result.screenshot!=='string'||result.screenshot.length>3*1024*1024)throw new Error('Invalid browser capture artifact');
    const screenshot=Buffer.from(result.screenshot,'base64');if(screenshot.length>2*1024*1024||screenshot.subarray(0,8).toString('hex')!=='89504e470d0a1a0a')throw new Error('Invalid screenshot');
    const contentHash=createHash('sha256').update(screenshot).digest('hex');const artifacts=join(dirname(store.path),'reference-artifacts');await mkdir(artifacts,{recursive:true,mode:0o700});
    if(await realpath(artifacts)!==artifacts)throw new Error('Reference artifact directory must not be a symlink');
    const screenshotPath=join(artifacts,`${contentHash}.png`);try{await writeFile(screenshotPath,screenshot,{flag:'wx',mode:0o600});}catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;const st=await lstat(screenshotPath);if(!st.isFile()||st.isSymbolicLink()||createHash('sha256').update(await readFile(screenshotPath)).digest('hex')!==contentHash)throw new Error('Existing screenshot artifact failed integrity validation');}
    const findings=scanUntrustedContent(`${result.text}\n${result.snapshot}`);
    const artifact={url:result.url,title:result.title,text:result.text,snapshot:result.snapshot,screenshotPath,contentHash,network:result.network,capturedAt:new Date().toISOString(),trust:'untrusted-external-data',findings};
    store.saveReferenceArtifact(id,artifact,findings.some(f=>f.severity==='high')?'review-required':'acquired');return artifact;
  }catch(error){store.setReferenceStatus(id,'failed');throw error;}finally{await rm(temp,{recursive:true,force:true});}
}
export async function readReferenceScreenshot(store:MemoryStore,id:string):Promise<Buffer> {
  const artifact=store.referenceArtifacts(id).find((a:any)=>typeof a.screenshotPath==='string') as {screenshotPath:string;contentHash:string}|undefined;
  if(!artifact||!/^[a-f0-9]{64}$/.test(artifact.contentHash))throw new Error('No captured screenshot');
  const expected=join(dirname(store.path),'reference-artifacts',`${artifact.contentHash}.png`);
  if(artifact.screenshotPath!==expected||await realpath(expected)!==expected)throw new Error('Screenshot path failed integrity validation');
  const st=await lstat(expected);if(!st.isFile()||st.size>2*1024*1024)throw new Error('Invalid screenshot file');
  const bytes=await readFile(expected);if(bytes.subarray(0,8).toString('hex')!=='89504e470d0a1a0a'||createHash('sha256').update(bytes).digest('hex')!==artifact.contentHash)throw new Error('Screenshot content failed integrity validation');
  return bytes;
}
