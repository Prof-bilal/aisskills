#!/usr/bin/env node
// Runs benchmark tasks through Claude Code (claude-haiku-5-5, low effort) and records usage.
// Usage: node benchmarks/run-claude.mjs --tasks=ky-timeout,ky-retry --arm=bare --reps=1
import { mkdtemp, mkdir, writeFile, readFile, rm, appendFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import YAML from '../packages/core/node_modules/yaml/dist/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const arg = (k, d) => process.argv.find(a => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d;
const taskIds = arg('tasks', '').split(',').filter(Boolean);
const arm = arg('arm', 'bare');
const reps = Number(arg('reps', '1'));
const runId = arg('run', new Date().toISOString().replace(/[:.]/g, '-'));
const resultsDir = join(here, 'results', runId);
const repos = YAML.parse(await readFile(join(here, 'config', 'repos.yaml'), 'utf8'));
const tasks = YAML.parse(await readFile(join(here, 'config', 'tasks-smoke.yaml'), 'utf8'));

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

async function checkout(repo, dir) {
  await run('git', ['clone', '-q', repo.url, dir], {});
  await run('git', ['-C', dir, 'checkout', '-q', repo.commit], {});
}

// Parses Claude Code `--output-format json` result (single object with usage and cost).
function parseClaude(stdout) {
  const result = JSON.parse(stdout.trim().split('\n').filter(Boolean).pop());
  const u = result.usage ?? {};
  return {
    isError: result.is_error === true,
    inputTokens: u.input_tokens ?? 0,
    outputTokens: u.output_tokens ?? 0,
    cacheReadTokens: u.cache_read_input_tokens ?? 0,
    cacheCreateTokens: u.cache_creation_input_tokens ?? 0,
    costUsd: result.total_cost_usd ?? null,
    durationMs: result.duration_ms ?? null,
    turns: result.num_turns ?? null,
    answer: result.result ?? '',
    model: Object.keys(result.modelUsage ?? {})[0] ?? null,
  };
}

await mkdir(resultsDir, { recursive: true });
const jsonl = join(resultsDir, 'runs.jsonl');

for (const id of taskIds) {
  const task = tasks[id];
  if (!task) throw new Error(`Unknown task ${id}`);
  for (let rep = 1; rep <= reps; rep++) {
    const sandbox = await mkdtemp(join(tmpdir(), `bench-${id}-`));
    try {
      const repoDir = join(sandbox, 'repo');
      await checkout(repos[task.repo], repoDir);
      const started = performance.now();
      const { stdout, stderr, code } = await run('claude', [
        '-p', task.prompt,
        '--model', 'claude-haiku-5-5',
        '--effort', 'low',
        '--output-format', 'json',
        '--permission-mode', 'acceptEdits',
        '--allowedTools', 'Read,Write,Edit,Glob,Grep,Bash(git log:*),Bash(git show:*)',
        // Isolate from user settings, hooks, plugins and MCP servers; keep login (CLAUDE_CONFIG_DIR would drop it).
        '--setting-sources', '', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}', '--disable-slash-commands',
      ], { cwd: repoDir, env: { ...process.env }, timeoutMs: (task.timeout_seconds ?? 300) * 1000 });
      const wallMs = Math.round(performance.now() - started);
      let parsed;
      try { parsed = parseClaude(stdout); } catch (e) { parsed = { parseError: String(e).slice(0, 200), stderr: stderr.slice(0, 300) }; }
      const answerFile = join(repoDir, task.answer_file);
      const answer = await readFile(answerFile, 'utf8').catch(() => null);
      const words = (answer ?? '').toLowerCase().split(/\s+/).filter(Boolean);
      const pass = answer !== null && words.length > 0 && task.expect_any.some(e => words.includes(String(e).toLowerCase()));
      const record = { run: runId, task: id, arm, rep, agent: 'claude-code', model: 'claude-haiku-5-5', effort: 'low', exitCode: code, wallMs, pass, ...parsed };
      await appendFile(jsonl, JSON.stringify(record) + '\n');
      console.log(`${id} ${arm} rep${rep}: ${pass ? 'PASS' : 'FAIL'} in ${(wallMs / 1000).toFixed(1)}s, ${parsed.inputTokens ?? '?'} in / ${parsed.outputTokens ?? '?'} out tokens, $${parsed.costUsd ?? '?'}`);
    } finally {
      await rm(sandbox, { recursive: true, force: true });
    }
  }
}
console.log(`Results: ${jsonl}`);
