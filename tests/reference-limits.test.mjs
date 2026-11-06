import test from 'node:test';
import assert from 'node:assert/strict';
import https from 'node:https';
import dns from 'node:dns/promises';
import {syncBuiltinESMExports} from 'node:module';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {fetchBrowserResource} from '../packages/core/dist/index.js';

test('HTTPS response rejection destroys streams and aggregate limits abort transfers',async t=>{
  const originalRequest=https.request;const originalLookup=dns.lookup;let handler;let requests=0;
  dns.lookup=async()=>[{address:'93.184.216.34',family:4}];
  https.request=(_url,options,callback)=>{
    requests++;const req=new EventEmitter();let response;let destroyed=false;
    req.destroy=error=>{if(destroyed)return;destroyed=true;response?.destroy();if(error)queueMicrotask(()=>req.emit('error',error));};
    options.signal?.addEventListener('abort',()=>req.destroy(new Error('cancelled')),{once:true});
    req.end=()=>queueMicrotask(()=>{response=handler();callback(response);if(!response.destroyed){response.end(Buffer.alloc(4096));}});
    return req;
  };
  syncBuiltinESMExports();
  const make=(status,headers={})=>{const res=new PassThrough();res.statusCode=status;res.headers=headers;return res;};
  try {
    await t.test('rejected error response is destroyed rather than drained',async()=>{const res=make(500);handler=()=>res;await assert.rejects(fetchBrowserResource('https://example.com',['example.com']),/unavailable/);assert.equal(res.destroyed,true);});
    await t.test('redirect body is destroyed even when destination is rejected',async()=>{const res=make(302,{location:'https://127.0.0.1/private'});handler=()=>res;await assert.rejects(fetchBrowserResource('https://example.com',['example.com']));assert.equal(res.destroyed,true);});
    await t.test('streaming consumes shared bytes and cancels on exhaustion',async()=>{const res=make(200,{'content-type':'text/html'});handler=()=>res;const controller=new AbortController();let exhausted=false;const budget={remaining:1024,signal:controller.signal,exhausted(){exhausted=true;controller.abort();}};await assert.rejects(fetchBrowserResource('https://example.com',['example.com'],0,budget),/cancel|budget/);assert.equal(exhausted,true);assert.equal(res.destroyed,true);assert.equal(controller.signal.aborted,true);});
    await t.test('cancelled capture cannot open a new HTTP request',async()=>{const count=requests;const controller=new AbortController();controller.abort();await assert.rejects(fetchBrowserResource('https://example.com',['example.com'],0,{remaining:1024,signal:controller.signal,exhausted(){}}),/cancel/);assert.equal(requests,count);});
  }finally{https.request=originalRequest;dns.lookup=originalLookup;syncBuiltinESMExports();}
});
