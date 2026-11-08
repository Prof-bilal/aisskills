#!/usr/bin/env node
// Runs benchmark tasks through Command Code (deepseek/deepseek-v4.1-flash) and records token usage.
// Usage: node benchmarks/run-command.mjs --tasks=a,b --arm=bare|aiskills-mcp --reps=3 --run=ID
// Command Code reads its config from $HOME/.commandcode, so each run gets a temporary HOME.
// The login file is copied into that HOME and deleted with it after the run.
import { mkdtemp, mkdir, writeFile, readFile, rm, appendFile, copyFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir, homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import YAML from '../packages/core/node_modules/yaml/dist/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const arg = (k, d) => process.argv.find(a => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d;
const taskIds = arg('tasks', '').split(',').filter(Boolean);
const arm = arg('arm', 'bare');
const reps = Number(arg('reps', '1'));
const runId = arg('run', new Date().toISOString().replace(/[:.]/g, '-'));
const model = 'deepseek/deepseek-v4.1-flash';
const resultsDir = join(here, 'results', runId);
const repos = YAML.parse(await readFile(join(here, 'config', 'repos.yaml'), 'utf8'));
const tasks = YAML.parse(await readFile(join(here, 'config', 'tasks.yaml'), 'utf8'));
const cli = join(here, '..', 'packages', 'cli', 'dist', 'index.js');

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

// Sums usage from the NDJSON event stream: the final run_end result is authoritative.
function parseCommand(stdout) {
  let end = null, requests = 0;
  for (const line of stdout.split('\n')) {
    if (!line.startsWith('{')) continue;
    const ev = JSON.parse(line).event ?? {};
    if (ev.type === 'model_request_end') requests++;
    if (ev.type === 'run_end') end = ev.result;
  }
  if (!end) throw new Error('no run_end event');
  const u = end.usage ?? {};
  return {
    isError: end.stopReason === 'error',
    inputTokens: u.inputTokens ?? 0,
    outputTokens: u.outputTokens ?? 0,
    cacheReadTokens: u.cacheReadTokens ?? 0,
    cacheCreateTokens: u.cacheWriteTokens ?? 0,
    costUsd: null,
    turns: end.turnCount ?? requests,
    answer: end.finalText ?? '',
    model,
  };
}

await mkdir(resultsDir, { recursive: true });
const jsonl = join(resultsDir, 'runs.jsonl');

for (const id of taskIds) {
  const task = tasks[id];
  if (!task) throw new Error(`Unknown task ${id}`);
  for (let rep = 1; rep <= reps; rep++) {
    const sandbox = await mkdtemp(join(tmpdir(), `bench-cmd-${id}-`));
    const home = join(sandbox, 'home');
    try {
      await mkdir(join(home, '.commandcode'), { recursive: true });
      await copyFile(join(homedir(), '.commandcode', 'auth.json'), join(home, '.commandcode', 'auth.json'));
      const env = { ...process.env, HOME: home, DO_NOT_TRACK: '1', COMMAND_CODE_TELEMETRY_SYNC: '0' };

      const repoDir = join(sandbox, 'repo');
      await run('git', ['clone', '-q', repos[task.repo].url, repoDir], {});
      await run('git', ['-C', repoDir, 'checkout', '-q', repos[task.repo].commit], {});

      if (arm === 'aiskills-mcp') {
        // Register only AI Skills' gateway, with its own catalog, in the temporary HOME.
        const json = JSON.stringify({ type: 'stdio', command: process.execPath, args: [cli, 'mcp', '--allow-capability-execution'], env: { AI_SKILLS_HOME: join(sandbox, 'aiskills-home'), AI_SKILLS_WARDEN_BINARY: process.env.AI_SKILLS_WARDEN_BINARY ?? 'warden' } });
        const added = await run('cmd', ['mcp', 'add-json', '--scope', 'user', 'aiskills', json], { cwd: repoDir, env, timeoutMs: 60000 });
        if (added.code !== 0) throw new Error(`mcp add failed: ${added.stderr.slice(0, 200)}`);
      }

      const started = performance.now();
      const { stdout, stderr, code } = await run('cmd', [
        '-p', task.prompt,
        '-m', model,
        '--output-format', 'json',
        '--permission-mode', 'accept-edits',
        '-t', '--no-session', '--skip-onboarding', '--no-auto-update',
        '--no-skills',
      ], { cwd: repoDir, env, timeoutMs: (task.timeout_seconds ?? 300) * 1000 });
      const wallMs = Math.round(performance.now() - started);
      let parsed;
      try { parsed = parseCommand(stdout); } catch (e) { parsed = { parseError: String(e).slice(0, 200), stderr: stderr.slice(0, 300) }; }

      const answer = await readFile(join(repoDir, task.answer_file), 'utf8').catch(() => null);
      const words = (answer ?? '').toLowerCase().split(/\s+/).filter(Boolean);
      const pass = answer !== null && words.length > 0 && task.expect_any.some(e => words.includes(String(e).toLowerCase()));
      const record = { run: runId, task: id, arm, rep, agent: 'command-code', model, effort: null, exitCode: code, wallMs, pass, ...parsed };
      await appendFile(jsonl, JSON.stringify(record) + '\n');
      console.log(`${id} ${arm} rep${rep}: ${pass ? 'PASS' : 'FAIL'} in ${(wallMs / 1000).toFixed(1)}s, ${parsed.inputTokens ?? '?'} in / ${parsed.outputTokens ?? '?'} out tokens`);
    } finally {
      await rm(sandbox, { recursive: true, force: true });
    }
  }
}
console.log(`Results: ${jsonl}`);
