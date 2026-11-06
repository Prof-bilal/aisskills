import {lookup} from 'node:dns/promises';
import {request} from 'node:https';
import {BlockList,isIP} from 'node:net';
import {createHash} from 'node:crypto';
import {canonicalizeReferenceUrl} from './memory-store.js';
import {scanUntrustedContent} from './index.js';
import type {MemoryStore} from './memory-store.js';

const blocked=new BlockList();
for(const [address,prefix] of [['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],['169.254.0.0',16],['172.16.0.0',12],['192.0.0.0',24],['192.168.0.0',16],['198.18.0.0',15],['224.0.0.0',4],['240.0.0.0',4]] as const)blocked.addSubnet(address,prefix,'ipv4');
export function isPublicReferenceAddress(address:string):boolean {return isIP(address)===4&&!blocked.check(address,'ipv4');}
export function validateFetchUrl(raw:string):URL {
  const url=canonicalizeReferenceUrl(raw);
  if(url.protocol!=='https:'||url.username||url.password||(url.port&&url.port!=='443'))throw new Error('Acquisition requires HTTPS on port 443 without credentials');
  if(isIP(url.hostname)&&!isPublicReferenceAddress(url.hostname))throw new Error('Acquisition requires a public IPv4 destination');
  return url;
}
export async function resolvePublicReferenceAddress(host:string,resolver:(host:string)=>Promise<Array<{address:string}>>=h=>lookup(h,{all:true,family:4})):Promise<string> {
  let timer:ReturnType<typeof setTimeout>|undefined;
  try {
    const addresses=await Promise.race([resolver(host),new Promise<never>((_resolve,reject)=>{timer=setTimeout(()=>reject(new Error('Reference DNS timed out')),5000);})]);
    if(!addresses.length||addresses.some(a=>!isPublicReferenceAddress(a.address)))throw new Error('Reference DNS resolves to a non-public destination');
    return addresses[0].address;
  }finally{if(timer)clearTimeout(timer);}
}
export interface BrowserDownloadBudget {remaining:number;signal:AbortSignal;exhausted():void}
export async function fetchBrowserResource(raw:string,allowedHosts:string[],redirects=0,budget?:BrowserDownloadBudget):Promise<{url:string;contentType:string;body:Buffer}> {
  const url=validateFetchUrl(raw);if(!allowedHosts.includes(url.hostname)||redirects>3)throw new Error('Browser resource host or redirect is not approved');
  const address=await resolvePublicReferenceAddress(url.hostname);
  if(budget?.signal.aborted)throw new Error('Browser acquisition cancelled');
  const result=await new Promise<{contentType:string;body:Buffer;location?:string}>((resolve,reject)=>{
    const timer=setTimeout(()=>req.destroy(new Error('Browser resource timeout')),10000);
    const req=request(url,{signal:budget?.signal,family:4,headers:{'accept-encoding':'identity','user-agent':'AI-Skills-Reference/0.1'},lookup:(_h,o,cb)=>o.all?cb(null,[{address,family:4}]):cb(null,address,4)},res=>{
      if((res.statusCode??0)>=300&&(res.statusCode??0)<400){res.destroy();clearTimeout(timer);if(!res.headers.location)reject(new Error('Redirect without Location'));else resolve({body:Buffer.alloc(0),contentType:'',location:res.headers.location});return;}
      if((res.statusCode??0)<200||(res.statusCode??0)>=300||res.headers['content-encoding']&&res.headers['content-encoding']!=='identity'){res.destroy();clearTimeout(timer);reject(new Error('Browser resource unavailable or compressed'));return;}
      const chunks:Buffer[]=[];let size=0;
      res.on('data',(chunk:Buffer)=>{size+=chunk.length;if(budget){budget.remaining-=chunk.length;if(budget.remaining<0){budget.exhausted();req.destroy(new Error('Browser aggregate download budget exceeded'));return;}}if(size>2*1024*1024)req.destroy(new Error('Browser resource exceeds 2 MiB'));else chunks.push(chunk);});
      res.once('error',reject);res.once('end',()=>{clearTimeout(timer);resolve({body:Buffer.concat(chunks),contentType:res.headers['content-type']??'application/octet-stream'});});
    });req.once('error',e=>{clearTimeout(timer);reject(e);});req.end();
  });
  if(result.location)return fetchBrowserResource(new URL(result.location,url).toString(),allowedHosts,redirects+1,budget);
  return {url:url.toString(),body:result.body,contentType:result.contentType};
}
export interface AcquiredReference {url:string;contentHash:string;title:string;text:string;colors:string[];fontFamilies:string[];findings:ReturnType<typeof scanUntrustedContent>;capturedAt:string;trust:'untrusted-external-data'}
export function extractReference(raw:string,url:string):AcquiredReference {
  const title=raw.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/<[^>]*>/g,'').trim().slice(0,300)??'';
  const text=raw.replace(/<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi,' ').replace(/<!--[^]*?-->/g,' ').replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim().slice(0,16000);
  return {url,contentHash:createHash('sha256').update(raw).digest('hex'),title,text,colors:[...new Set(raw.match(/#[0-9a-f]{6}\b/gi)??[])].slice(0,24),fontFamilies:[...raw.matchAll(/font-family\s*:\s*([^;}]{1,120})/gi)].map(m=>m[1]).slice(0,12),findings:scanUntrustedContent(raw),capturedAt:new Date().toISOString(),trust:'untrusted-external-data'};
}
async function download(url:URL,redirects=0):Promise<{url:string;body:string}> {
  if(redirects>3)throw new Error('Reference redirect limit exceeded');
  const address=await resolvePublicReferenceAddress(url.hostname);
  const result=await new Promise<{body:string;location?:string}>((resolve,reject)=>{
    const timer=setTimeout(()=>req.destroy(new Error('Reference request timed out')),10000);
    const req=request(url,{family:4,headers:{accept:'text/html,text/plain','accept-encoding':'identity','user-agent':'AI-Skills-Reference/0.1'},lookup:(_hostname,options,callback)=>options.all?callback(null,[{address,family:4}]):callback(null,address,4)},res=>{
      const status=res.statusCode??0;
      if(status>=300&&status<400) {res.destroy();clearTimeout(timer);if(!res.headers.location)reject(new Error('Redirect without Location'));else resolve({body:'',location:res.headers.location});return;}
      if(status<200||status>=300) {res.destroy();clearTimeout(timer);reject(new Error(`Reference HTTP ${status}`));return;}
      if(!/^(text\/html|text\/plain)(;|$)/i.test(res.headers['content-type']??'')||res.headers['content-encoding']&&res.headers['content-encoding']!=='identity'){res.destroy();clearTimeout(timer);reject(new Error('Reference must be uncompressed HTML or plain text'));return;}
      const chunks:Buffer[]=[];let size=0;
      res.on('data',(chunk:Buffer)=>{size+=chunk.length;if(size>2*1024*1024)req.destroy(new Error('Reference exceeds 2 MiB'));else chunks.push(chunk);});
      res.once('error',reject);res.once('end',()=>{clearTimeout(timer);resolve({body:Buffer.concat(chunks).toString('utf8')});});
    });
    req.once('error',e=>{clearTimeout(timer);reject(e);});req.end();
  });
  if(result.location)return download(validateFetchUrl(new URL(result.location,url).toString()),redirects+1);
  return {url:url.toString(),body:result.body};
}
export async function acquireReference(store:MemoryStore,id:string):Promise<AcquiredReference> {
  const reference=store.getReference(id);if(!reference)throw new Error('Reference not found in current scope');
  try {
    const response=await download(validateFetchUrl(reference.canonicalUrl));const artifact=extractReference(response.body,response.url);
    store.saveReferenceArtifact(id,artifact,artifact.findings.some(f=>f.severity==='high')?'review-required':'acquired');
    if(reference.sourceType==='design'&&(artifact.colors.length||artifact.fontFamilies.length))store.addPreferenceSignal({projectId:reference.scopeId,category:'design',signal:`Reference observations to confirm: colors ${artifact.colors.join(', ') || 'unknown'}; fonts ${artifact.fontFamilies.join(', ') || 'unknown'}`,evidenceReferenceId:id,source:'inferred',confidence:0.3});
    return artifact;
  }catch(error){store.setReferenceStatus(id,'failed');throw error;}
}
