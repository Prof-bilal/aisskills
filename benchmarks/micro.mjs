#!/usr/bin/env node
// Deterministic micro-benchmarks: no model calls, no network. Byte metrics are exact and
// reproducible; timing metrics depend on this machine. Token figures are chars/4 estimates.
// Usage: node benchmarks/micro.mjs [--out=benchmarks/results/micro]
import { mkdtemp, mkdir, writeFile, readFile, rm, chmod } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import YAML from '../packages/core/node_modules/yaml/dist/index.js';
import { Client } from '../packages/cli/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js';
import { StdioClientTransport } from '../packages/cli/node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js';
import { InMemoryTransport } from '../packages/cli/node_modules/@modelcontextprotocol/sdk/dist/esm/inMemory.js';
import { createMcpServer } from '../packages/cli/dist/mcp.js';
import { CapabilityBroker } from '../packages/cli/dist/capability-broker.js';
import { CoreRuntime, openPackageCatalog, installSkillPackage, prepareCapability, planPackageActivation } from '../packages/core/dist/index.js';
import { syntheticTools } from './fixtures/synthetic-mcp.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const synthetic = join(here, 'fixtures', 'synthetic-mcp.mjs');
const cli = resolve(here, '..', 'packages', 'cli', 'dist', 'index.js');
const out = process.argv.find(a => a.startsWith('--out='))?.slice(6) ?? join(here, 'results', 'micro');
const SIZES = [50, 100, 200];
const bytes = v => Buffer.byteLength(typeof v === 'string' ? v : JSON.stringify(v));
const tok = b => Math.ceil(b / 4);
const median = a => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
const rssKb = pid => readFile(`/proc/${pid}/status`, 'utf8').then(s => Number(/VmRSS:\s+(\d+)/.exec(s)?.[1] ?? 0)).catch(() => 0);

const root = await mkdtemp(join(tmpdir(), 'aiskills-micro-'));
const project = join(root, 'project');
await mkdir(project);
process.env.AI_SKILLS_HOME = join(root, 'home');
// Fake Warden: runs the command after `--` with no sandbox. Measures AI Skills overhead, not Warden's.
const supervisor = join(root, 'fake-warden.mjs');
await writeFile(supervisor, `#!${process.execPath}\nimport {spawn} from 'node:child_process';const a=process.argv.slice(2);const c=a.slice(a.indexOf('--')+1);spawn(c[0],c.slice(1),{stdio:'inherit'}).on('exit',code=>process.exit(code??0));`);
await chmod(supervisor, 0o700);
process.env.AI_SKILLS_WARDEN_BINARY = supervisor;

async function listTools(compact) {
  const server = createMcpServer(new CoreRuntime({ projectRoot: project, engines: [] }), undefined, { compact });
  const client = new Client({ name: 'micro', version: '1' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a); await client.connect(b);
  const { tools } = await client.listTools();
  await client.close(); await server.close();
  return tools;
}

async function gateway(catalog, n) {
  const source = join(root, `synthetic-${n}`);
  await mkdir(source, { recursive: true });
  await writeFile(join(source, 'SKILL.md'), `---\nname: synthetic-${n}\ndescription: Widget inventory workspace tools (${n} tools)\n---\nUse for widget inventory tasks.`);
  await writeFile(join(source, 'server.mjs'), `process.env.SYN_SERVE='1';process.env.SYN_TOOLS='${n}';await import(${JSON.stringify(synthetic)});`);
  await writeFile(join(source, 'runtime.json'), JSON.stringify({ kind: 'mcp', command: [process.execPath, '${PACKAGE}/server.mjs'], tools: syntheticTools(n).map(t => t.name).slice(0, 128) })); // product limit: 128 allowlisted tools per runtime
  const p = await installSkillPackage(catalog, { source, approve: true });
  await prepareCapability(catalog, p.id, true);
  return p.id;
}

const results = { generatedBy: 'benchmarks/micro.mjs', note: 'Bytes are exact; tokens are chars/4 estimates; timings are machine-dependent medians of 5.', static: [], search: [], spill: [], startup: {}, routing: {} };
const catalog = await openPackageCatalog();
try {
  // 1. Static context: what an agent receives at session start.
  const compact = bytes(await listTools(true)), full = bytes(await listTools(false));
  for (const n of SIZES) {
    const tools = syntheticTools(n);
    results.static.push({ tools: n, nativeEagerBytes: bytes(tools), nativeDeferredNamesBytes: bytes(tools.map(t => t.name)), aiskillsCompactBytes: compact, aiskillsFullBytes: full });
  }

  // 2 + 3. Search payload and result spill, one approved gateway at a time.
  for (const n of SIZES) {
    const home = join(root, `home-${n}`);
    process.env.AI_SKILLS_HOME = home;
    const cat = await openPackageCatalog();
    try {
      const id = await gateway(cat, n);
      await cat.enable(id, project, true);
      const broker = new CapabilityBroker(project, undefined, true);
      const task = 'inspect widget inventory issue records';
      const tools = syntheticTools(n).map(t => ({ id, entry: 'default', tool: t.name, description: t.description, inputSchema: t.inputSchema }));
      let capped = 0; for (const t of tools) { if (capped + bytes(t) > 64000) break; capped += bytes(t); }
      const step1 = await broker.search(task);
      const select = step1.tools.slice(0, 3).map(t => ({ id: t.id, entry: t.entry, tool: t.tool }));
      const step2 = await broker.search(task, undefined, select);
      results.search.push({ tools: n, allSchemasBytes: bytes(tools), previousSearchBytes: capped, step1Bytes: bytes(step1), step1Tools: step1.tools.length, step2Bytes: bytes(step2), step2Tools: step2.tools.length });
      if (n === SIZES[0]) for (const size of [1000, 8000, 16000, 32000, 100000, 250000]) {
        const r = await broker.call(id, 'default', 'widget_dump', { bytes: size });
        results.spill.push({ resultChars: size, bytesToAgent: bytes(r), savedToFile: r.content[0].text.includes('"saved"') });
      }
      // Cold per-call cost: AI Skills starts the gateway for every call.
      const calls = [];
      for (let i = 0; i < 5; i++) { const t0 = performance.now(); await broker.call(id, 'default', 'widget_dump', { bytes: 10 }); calls.push(performance.now() - t0); }
      if (n === SIZES[0]) results.startup.coldCallMs = Math.round(median(calls));
    } finally { cat.close(); }
  }
  process.env.AI_SKILLS_HOME = join(root, 'home');

  // 4. Startup: nine native servers started up front vs one AI Skills server.
  const fleet = [50, 40, 30, 25, 20, 20, 15, 10, 10];
  const native = [], aiskills = [];
  for (let i = 0; i < 5; i++) {
    const t0 = performance.now();
    const clients = await Promise.all(fleet.map(async n => {
      const transport = new StdioClientTransport({ command: process.execPath, args: [synthetic, `--tools=${n}`], stderr: 'ignore' });
      const c = new Client({ name: 'fleet', version: '1' }); await c.connect(transport); await c.listTools(); return { c, transport };
    }));
    const ms = performance.now() - t0;
    const rss = (await Promise.all(clients.map(x => rssKb(x.transport.pid)))).reduce((s, v) => s + v, 0);
    native.push({ ms, rss }); await Promise.all(clients.map(x => x.c.close()));
    const t1 = performance.now();
    const transport = new StdioClientTransport({ command: process.execPath, args: [cli, 'mcp'], cwd: project, env: { ...process.env }, stderr: 'ignore' });
    const c = new Client({ name: 'aiskills', version: '1' }); await c.connect(transport); await c.listTools();
    aiskills.push({ ms: performance.now() - t1, rss: await rssKb(transport.pid) }); await c.close();
  }
  results.startup.native = { servers: fleet.length, tools: fleet.reduce((s, v) => s + v, 0), readyMs: Math.round(median(native.map(x => x.ms))), rssMb: Math.round(median(native.map(x => x.rss)) / 1024) };
  results.startup.aiskills = { servers: 1, tools: 4, readyMs: Math.round(median(aiskills.map(x => x.ms))), rssMb: Math.round(median(aiskills.map(x => x.rss)) / 1024) };

  // 5. Routing quality over the 43 built-in skills.
  const core = new Set(['repo-explorer', 'planner', 'evidence-first', 'completion-checker']);
  const corpus = YAML.parse(await readFile(join(here, 'config', 'routing-tasks.yaml'), 'utf8'));
  let tp = 0, picked = 0, expected = 0, wrong = 0, sel = 0, base = 0; const misses = [];
  for (const c of corpus) {
    const plan = await planPackageActivation(catalog, project, c.task);
    const specific = plan.builtinSkills.filter(id => !core.has(id));
    const hit = c.expect.filter(id => specific.includes(id));
    tp += hit.length; picked += specific.length; expected += c.expect.length;
    wrong += c.reject.filter(id => plan.builtinSkills.includes(id)).length;
    sel += plan.estimatedContextTokens; base += plan.baselineContextTokens;
    if (hit.length < c.expect.length) misses.push({ task: c.task, expected: c.expect, got: specific });
  }
  results.routing = { tasks: corpus.length, precision: +(tp / picked).toFixed(3), recall: +(tp / expected).toFixed(3), wrongPicks: wrong, avgSelectedTokens: Math.round(sel / corpus.length), allSkillsTokens: Math.round(base / corpus.length), misses };
} finally { catalog.close(); await rm(root, { recursive: true, force: true }); }

const row = cells => `| ${cells.join(' | ')} |`;
const md = [
  '# AI Skills micro-benchmarks', '', results.note, '',
  '## 1. Context at session start (tool definitions)', '',
  row(['Tools on servers', 'All loaded upfront', 'Names only (agent tool search)', 'AI Skills (4 tools)', 'AI Skills --full']), row(['---', '---', '---', '---', '---']),
  ...results.static.map(s => row([s.tools, `${s.nativeEagerBytes} B (~${tok(s.nativeEagerBytes)} tok)`, `${s.nativeDeferredNamesBytes} B (~${tok(s.nativeDeferredNamesBytes)} tok)`, `${s.aiskillsCompactBytes} B (~${tok(s.aiskillsCompactBytes)} tok)`, `${s.aiskillsFullBytes} B`])),
  '', '## 2. search_tools payload', '',
  row(['Tools on server', 'All schemas', 'Previous search (64 KB cap)', 'Step 1 (names)', 'Step 2 (3 schemas)']), row(['---', '---', '---', '---', '---']),
  ...results.search.map(s => row([s.tools, `${s.allSchemasBytes} B`, `${s.previousSearchBytes} B`, `${s.step1Bytes} B (${s.step1Tools} tools)`, `${s.step2Bytes} B (${s.step2Tools} tools)`])),
  '', '## 3. Tool result reaching the agent', '',
  row(['Result size', 'Bytes to agent', 'Saved to file']), row(['---', '---', '---']),
  ...results.spill.map(s => row([`${s.resultChars} chars`, `${s.bytesToAgent} B (~${tok(s.bytesToAgent)} tok)`, s.savedToFile ? 'yes' : 'no'])),
  '', '## 4. Startup (synthetic servers, no Warden sandbox)', '',
  row(['Setup', 'Servers', 'Tools', 'Ready in', 'Memory']), row(['---', '---', '---', '---', '---']),
  row(['All servers upfront', results.startup.native.servers, results.startup.native.tools, `${results.startup.native.readyMs} ms`, `${results.startup.native.rssMb} MB`]),
  row(['AI Skills', 1, 4, `${results.startup.aiskills.readyMs} ms`, `${results.startup.aiskills.rssMb} MB`]),
  '', `Cost AI Skills pays instead: each tool call starts its gateway, about **${results.startup.coldCallMs} ms** per call here (more with the real Warden sandbox).`,
  '', '## 5. Built-in skill routing', '',
  `${results.routing.tasks} labelled tasks. Precision ${results.routing.precision}, recall ${results.routing.recall}, ${results.routing.wrongPicks} clearly wrong picks. Average selected guidance ~${results.routing.avgSelectedTokens} tok vs ~${results.routing.allSkillsTokens} tok for all 43 skills.`,
  '', ...results.routing.misses.map(m => `- missed: "${m.task}" expected ${m.expected.join(', ')}; got ${m.got.join(', ') || 'nothing task-specific'}`),
].join('\n');
await mkdir(out, { recursive: true });
await writeFile(join(out, 'latest.json'), JSON.stringify(results, null, 2) + '\n');
await writeFile(join(out, 'latest.md'), md + '\n');
console.log(md);
