#!/usr/bin/env node
// Skill benchmark, Claude Code only (claude-haiku-5-5, low effort).
//   native15 : the 15 skills installed directly into the agent (.claude/skills in the project)
//   aiskills15: the same 15 added to an AI Skills catalog, enabled for the project, reached through the gateway
// Usage: node benchmarks/run-skills.mjs --arm=native15|aiskills15 --reps=3 --run=ID [--tasks=a,b]
import { mkdtemp, mkdir, writeFile, readFile, rm, appendFile, cp, stat } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import YAML from '../packages/core/node_modules/yaml/dist/index.js';

const exec = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const arg = (k, d) => process.argv.find(a => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d;
const arm = arg('arm', 'native15');
const reps = Number(arg('reps', '1'));
const runId = arg('run', `skills-${arm}-${new Date().toISOString().replace(/[:.]/g, '-')}`);
const only = arg('tasks', '').split(',').filter(Boolean);
const cache = join(here, '.cache', 'skills15');
const cli = join(here, '..', 'packages', 'cli', 'dist', 'index.js');
const warden = process.env.AI_SKILLS_WARDEN_BINARY ?? join(process.env.HOME, 'Projects', 'ShieldCI', 'dist', 'warden');
const set = YAML.parse(await readFile(join(here, 'config', 'skillset.yaml'), 'utf8'));
const tasks = YAML.parse(await readFile(join(here, 'config', 'tasks-skills.yaml'), 'utf8'));
const model = 'claude-haiku-5-5';

const exists = p => stat(p).then(() => true, () => false);

// Clone each source at its pinned commit and copy the 15 skills into .cache/skills15/src. Build the AI Skills catalog once.
async function ensureCache() {
  if (await exists(join(cache, 'ready'))) return;
  await mkdir(join(cache, 'src'), { recursive: true });
  for (const [name, source] of Object.entries(set.sources)) {
    const dir = join(cache, 'clones', name.replace('/', '__'));
    if (!(await exists(dir))) await exec('git', ['clone', '-q', source.url, dir]);
    await exec('git', ['-C', dir, 'checkout', '-q', source.commit]);
    for (const skill of set.skills.filter(s => s.source === name)) await cp(join(dir, source.path, skill.name), join(cache, 'src', skill.name), { recursive: true });
  }
  const catalog = join(cache, 'catalog');
  for (const skill of set.skills) {
    const r = await exec('node', [cli, 'add', join(cache, 'src', skill.name), '--yes'], { env: { ...process.env, AI_SKILLS_HOME: catalog } }).catch(e => e);
    if (r instanceof Error) throw new Error(`add ${skill.name} failed: ${(r.stderr || r.message).slice(0, 200)}`);
  }
  await writeFile(join(cache, 'ready'), new Date().toISOString());
}

function run(cmd, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { ...options, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', d => (stdout += d));
    child.stderr.on('data', d => (stderr += d));
    const timer = setTimeout(() => child.kill('SIGKILL'), options.timeoutMs ?? 600000);
    child.on('close', code => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
    child.on('error', reject);
  });
}

// Reads the stream-json transcript: final usage/cost and every tool the agent called.
function parseStream(stdout) {
  let result = null;
  const tools = [];
  for (const line of stdout.split('\n')) {
    if (!line.startsWith('{')) continue;
    const ev = JSON.parse(line);
    if (ev.type === 'assistant') for (const block of ev.message?.content ?? []) if (block.type === 'tool_use') tools.push(block.name);
    if (ev.type === 'result') result = ev;
  }
  if (!result) throw new Error('no result event');
  const u = result.usage ?? {};
  return {
    isError: result.is_error === true,
    inputTokens: u.input_tokens ?? 0,
    outputTokens: u.output_tokens ?? 0,
    cacheReadTokens: u.cache_read_input_tokens ?? 0,
    cacheCreateTokens: u.cache_creation_input_tokens ?? 0,
    costUsd: result.total_cost_usd ?? null,
    turns: result.num_turns ?? null,
    answer: result.result ?? '',
    tools,
    skillCalls: tools.filter(t => t === 'Skill').length,
    aiskillsCalls: tools.filter(t => t.startsWith('mcp__aiskills__')).length,
  };
}

const prompt = topic => `Use the installed skill for this job to answer, and do not guess: ${topic}.\nQuestion: how many level-2 headings (lines that start with "## ") does that skill's SKILL.md contain?\nExplain briefly, then end your reply with a final line of the form "ANSWER: <number>".`;

await ensureCache();
const jsonl = join(here, 'results', runId, 'runs.jsonl');
await mkdir(dirname(jsonl), { recursive: true });

for (const [id, task] of Object.entries(tasks)) {
  if (only.length && !only.includes(id)) continue;
  for (let rep = 1; rep <= reps; rep++) {
    const sandbox = await mkdtemp(join(tmpdir(), `bench-skills-${id}-`));
    try {
      const repo = join(sandbox, 'repo');
      await mkdir(repo);
      await run('git', ['-C', repo, 'init', '-q'], {});
      await writeFile(join(repo, 'README.md'), '# scratch project\n');
      const env = { ...process.env };
      const mcp = join(sandbox, 'mcp.json');
      let flags;
      if (arm === 'native15') {
        // Skills installed the normal way: in the project's .claude/skills. Only project settings load.
        await cp(join(cache, 'src'), join(repo, '.claude', 'skills'), { recursive: true });
        await writeFile(mcp, JSON.stringify({ mcpServers: {} }));
        flags = ['--setting-sources', 'project', '--strict-mcp-config', '--mcp-config', mcp];
      } else {
        // Same skills in an AI Skills catalog. Each run gets its own copy, enabled for this project.
        const home = join(sandbox, 'aiskills-home');
        await cp(join(cache, 'catalog'), home, { recursive: true });
        env.AI_SKILLS_HOME = home;
        env.AI_SKILLS_WARDEN_BINARY = warden;
        for (const skill of set.skills) await exec('node', [cli, 'skills', 'enable', skill.name], { cwd: repo, env });
        await writeFile(mcp, JSON.stringify({ mcpServers: { aiskills: { command: process.execPath, args: [cli, 'mcp', '--allow-capability-execution'], env: { AI_SKILLS_HOME: home, AI_SKILLS_WARDEN_BINARY: warden } } } }));
        flags = ['--setting-sources', '', '--strict-mcp-config', '--mcp-config', mcp, '--disable-slash-commands', '--append-system-prompt',
          'Approved skills for this project are available through the aiskills MCP tools. For the task, call mcp__aiskills__discover_capabilities with the task text, then mcp__aiskills__load_skill for the relevant skill id, then answer.'];
      }
      const started = performance.now();
      const { stdout, stderr, code } = await run('claude', ['-p', prompt(task.topic), '--model', model, '--effort', 'low', '--output-format', 'stream-json', '--verbose', '--permission-mode', 'default', '--allowedTools', 'Skill,Read,Glob,Grep,mcp__aiskills', ...flags], { cwd: repo, env, timeoutMs: 300000 });
      const wallMs = Math.round(performance.now() - started);
      let parsed;
      try { parsed = parseStream(stdout); } catch (e) { parsed = { parseError: String(e).slice(0, 200), stderr: stderr.slice(0, 300) }; }
      const match = /^ANSWER:\s*(.+)$/m.exec(parsed.answer ?? '');
      const value = match ? match[1].replace(/[*`'".]/g, '').trim().toLowerCase() : null;
      const pass = value !== null && task.expect.some(e => value === String(e));
      await appendFile(jsonl, JSON.stringify({ run: runId, task: id, arm, rep, agent: 'claude-code', model, effort: 'low', exitCode: code, wallMs, pass, ...parsed }) + '\n');
      console.log(`${id} ${arm} rep${rep}: ${pass ? 'PASS' : 'FAIL'} in ${(wallMs / 1000).toFixed(1)}s, uncached ${parsed.inputTokens ?? '?'}, cache-create ${parsed.cacheCreateTokens ?? '?'}, skill calls ${parsed.skillCalls ?? '?'}, aiskills calls ${parsed.aiskillsCalls ?? '?'}`);
    } finally {
      await rm(sandbox, { recursive: true, force: true });
    }
  }
}
console.log(`Results: ${jsonl}`);
