import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { CoreRuntime, SmurfOrchestrationEngine } from '../packages/core/dist/index.js';
import { applyScopedFileBlocks } from '../packages/core/dist/api-files.js';
import { detectCheckSandbox, runIsolatedCheck } from '../packages/core/dist/sandbox.js';
import { createMcpServer } from '../packages/cli/dist/mcp.js';
import { Client } from '../packages/cli/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js';
import { InMemoryTransport } from '../packages/cli/node_modules/@modelcontextprotocol/sdk/dist/esm/inMemory.js';
const checkout = resolve('.integration/smurf');
const hasSource = await access(join(checkout, 'agents/engine/src/engine.ts')).then(() => true, () => false);
const sandbox = await detectCheckSandbox();
const apiAvailable = hasSource && sandbox.available && Number(process.versions.node.split('.')[0]) >= 24;
const grants = ['repository.read', 'repository.write', 'git.read', 'git.write', 'shell.execute', 'network.read', 'network.write'];
const git = (repo, ...args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).trim();
async function temp(t) {
  const root = await mkdtemp(join(tmpdir(), 'aiskills-api-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}
async function listen(t, handler) {
  const server = createServer(handler);
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  return `http://127.0.0.1:${server.address().port}/v1`;
}
async function fixture(t, malicious = false) {
  const root = await temp(t); const repo = join(root, 'repo'); await mkdir(repo);
  const secret = join(root, 'private'); await writeFile(secret, 'never-send-this-sentinel');
  await writeFile(join(repo, 'package.json'), JSON.stringify({ type: 'module' }));
  await writeFile(join(repo, 'endpoint.js'), 'export const validate = value => true;\n');
  await writeFile(join(repo, 'endpoint.test.js'), "import assert from 'node:assert/strict'; import { validate } from './endpoint.js'; assert.equal(validate(''), false); assert.equal(validate('hello'), true); assert.equal(process.env.AI_SKILLS_TEST_KEY, undefined);\n");
  git(repo, 'init', '-q', '-b', 'main'); git(repo, 'add', '.'); git(repo, '-c', 'user.name=test', '-c', 'user.email=test@local', 'commit', '-qm', 'fixture');
  const requests = [];
  const baseUrl = await listen(t, async (req, res) => {
    try {
      assert.equal(req.url, '/v1/chat/completions');
      let raw = ''; for await (const part of req) raw += part;
      const body = JSON.parse(raw); requests.push({ body, authorization: req.headers.authorization });
      const prompt = body.messages[0].content;
      let content;
      if (/^ORCH:review/m.test(prompt)) content = JSON.stringify({ score: 95, verdict: 'ok', findings: [] });
      else if (/^ORCH:senior.confirm/m.test(prompt)) content = JSON.stringify({ decision: 'accept', reason: 'Checks and review passed' });
      else content = `<<<FILE endpoint.js>>>\nexport const validate = value => typeof value === 'string' && value.length > 0;\n<<<END>>>\n## Changes\nValidated endpoint input; engine must run independent tests.\n${malicious ? `<<<FILE ${secret}>>>\ncompromised\n<<<END>>>` : ''}`;
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { content } }], usage: { prompt_tokens: 100, completion_tokens: 100 } }));
    } catch (error) { res.writeHead(500); res.end(String(error)); }
  });
  const previousKey = process.env.AI_SKILLS_TEST_KEY; process.env.AI_SKILLS_TEST_KEY = 'transport-test-key';
  t.after(() => { if (previousKey === undefined) delete process.env.AI_SKILLS_TEST_KEY; else process.env.AI_SKILLS_TEST_KEY = previousKey; });
  const options = { checkout, stateDirectory: join(root, 'state'), api: { seniorModel: 'local:senior', providers: { local: { baseUrl, apiKeyEnv: 'AI_SKILLS_TEST_KEY', billing: 'free', models: [{ model: 'coder', tier: 'strong' }, { model: 'senior', tier: 'strong' }] } } } };
  const engine = new SmurfOrchestrationEngine(options);
  const step = { id: 'endpoint', brief: 'Validate endpoint input', files: ['endpoint.js'], dependencies: [], checks: ['node endpoint.test.js'] };
  const runtime = new CoreRuntime({ projectRoot: repo, engines: [engine], permissions: grants, allowedChecks: step.checks });
  return { root, repo, secret, requests, engine, options, step, runtime };
}
test('API file blocks reject traversal and symlinks and only apply exact scopes', async t => {
  const root = await temp(t); const workspace = join(root, 'workspace'); await mkdir(workspace);
  const secret = join(root, 'private'); await writeFile(secret, 'unchanged');
  if (process.platform !== 'win32') await symlink(secret, join(workspace, 'alias.js'));
  const text = '<<<FILE allowed.js>>>\nexport const answer = 42;\n<<<END>>>\n<<<FILE ../private>>>\nunsafe\n<<<END>>>\n<<<FILE alias.js>>>\nunsafe\n<<<END>>>';
  const result = await applyScopedFileBlocks(text, workspace, ['allowed.js', 'alias.js']);
  assert.deepEqual(result.written, process.platform === 'win32' ? ['allowed.js', 'alias.js'] : ['allowed.js']);
  assert.ok(result.rejected.includes('../private'));
  assert.equal(await readFile(secret, 'utf8'), 'unchanged');
  assert.match(await readFile(join(workspace, 'allowed.js'), 'utf8'), /42/);
});
test('verification sandbox denies host files, environment, network, and workspace writes', { skip: !sandbox.available }, async t => {
  const root = await temp(t); const worktrees = join(root, 'worktrees'); const cwd = join(worktrees, 'task'); await mkdir(cwd, { recursive: true });
  const secret = join(root, 'private'); await writeFile(secret, 'private');
  await writeFile(join(cwd, '.git'), 'gitdir: /host/metadata');
  const url = await listen(t, (_req, res) => res.end('unexpected network access'));
  const previous = process.env.AI_SKILLS_TEST_KEY; process.env.AI_SKILLS_TEST_KEY = 'private-env';
  t.after(() => { if (previous === undefined) delete process.env.AI_SKILLS_TEST_KEY; else process.env.AI_SKILLS_TEST_KEY = previous; });
  await writeFile(join(cwd, 'probe.mjs'), `import assert from 'node:assert/strict'; import fs from 'node:fs';\nassert.throws(() => fs.readFileSync(${JSON.stringify(secret)})); assert.equal(process.env.AI_SKILLS_TEST_KEY, undefined); for (const pid of fs.readdirSync('/proc').filter(p => /^[0-9]+$/.test(p))) { let environment = ''; try { environment = fs.readFileSync('/proc/' + pid + '/environ','utf8'); } catch {} assert.ok(!environment.includes('private-env')); } assert.throws(() => fs.writeFileSync('tamper','x')); let metadata = ''; try { metadata = fs.readFileSync('.git','utf8'); } catch {} assert.equal(metadata,''); assert.throws(() => fs.writeFileSync('.git','tamper'));  await assert.rejects(fetch(${JSON.stringify(url)}, {signal:AbortSignal.timeout(1000)})); fs.writeFileSync('/tmp/scratch','ok'); console.log('boundary verified');`);
  assert.match((await runIsolatedCheck('node probe.mjs', cwd, worktrees)).stdout, /boundary verified/);
  await assert.rejects(runIsolatedCheck('true', root, worktrees), /outside/);
});
test('MCP uses upstream API transport with guarded edits and isolated checks', { skip: !apiAvailable }, async t => {
  const f = await fixture(t);
  assert.equal((await f.engine.detect()).available, true);
  const server = createMcpServer(f.runtime); const client = new Client({ name: 'api-fixture', version: '1' });
  const [left, right] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(left), client.connect(right)]);
  t.after(async () => { await client.close(); await server.close(); });
  const response = await client.callTool({ name: 'execute_task', arguments: { task: 'Add a validated endpoint', mode: 'smurf', steps: [f.step] } });
  const result = JSON.parse(response.content[0].text);
  assert.equal(result.status, 'COMPLETE', JSON.stringify(result));
  assert.equal(result.review.status, 'passed');
  assert.deepEqual(result.agents.sort(), ['local:coder', 'local:senior']);
  assert.ok(f.requests.length >= 2);
  assert.ok(f.requests.every(r => r.authorization === 'Bearer transport-test-key'));
  assert.ok(f.requests.every(r => !JSON.stringify(r.body).includes('transport-test-key') && !JSON.stringify(r.body).includes('never-send-this-sentinel')));
  assert.ok(result.evidence.some(e => e.name.startsWith('integration:') && e.status === 'passed'));
  assert.equal(git(f.repo, 'diff', '--name-only', 'HEAD', result.integrationBranch), 'endpoint.js');
  assert.equal(await readFile(f.secret, 'utf8'), 'never-send-this-sentinel');
  assert.match(await readFile(join(f.repo, 'endpoint.js'), 'utf8'), /value => true/);
});
test('provider responses cannot write host secrets even when they request it', { skip: !apiAvailable }, async t => {
  const f = await fixture(t, true);
  const result = await f.runtime.executeTask({ task: 'Add validated endpoint', mode: 'smurf', steps: [f.step] });
  assert.notEqual(result.status, 'COMPLETE');
  assert.ok(result.security_findings.some(f => f.includes('Rejected API write')));
  assert.equal(await readFile(f.secret, 'utf8'), 'never-send-this-sentinel');
});
test('missing network grants stop API requests before delegation', { skip: !apiAvailable }, async t => {
  const f = await fixture(t);
  const runtime = new CoreRuntime({ ...f.runtime.options, permissions: grants.filter(p => !p.startsWith('network.')) });
  const result = await runtime.executeTask({ task: 'Add validated endpoint', mode: 'smurf', steps: [f.step] });
  assert.equal(result.status, 'BLOCKED'); assert.equal(f.requests.length, 0);
});
