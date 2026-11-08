#!/usr/bin/env node
// Summarizes every benchmarks/results/*/runs.jsonl into a per-agent, per-setup report.
// Usage: node benchmarks/report.mjs  -> benchmarks/results/REPORT.md
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const resultsRoot = join(here, 'results');
const runs = [];
for (const dir of await readdir(resultsRoot, { withFileTypes: true }).catch(() => [])) {
  if (!dir.isDirectory() || dir.name.startsWith('dev-')) continue; // dev-* are development checks, not benchmark runs
  const file = join(resultsRoot, dir.name, 'runs.jsonl');
  const text = await readFile(file, 'utf8').catch(() => '');
  for (const line of text.split('\n').filter(Boolean)) runs.push(JSON.parse(line));
}

const median = a => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const sum = (rs, k) => rs.reduce((s, r) => s + (Number(r[k]) || 0), 0);
const fmt = (v, d = 0) => (v === null || v === undefined ? 'n/a' : Number(v).toFixed(d));
const money = v => (v === null || v === undefined ? 'n/a' : `$${Number(v).toFixed(4)}`);

const groups = new Map();
for (const r of runs) {
  const key = `${r.agent} / ${r.model ?? "model n/a"} / ${r.arm}`;
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push(r);
}

const lines = [
  '# AI Skills benchmark report', '',
  `Runs: ${runs.length}. Tokens are as reported by each agent. "Total input" = uncached + cache read + cache write.`, '',
  '| Agent / model / setup | Runs | Pass rate | Median time | Median total input | Median output | Median cost | Total cost |',
  '|---|---|---|---|---|---|---|---|',
];
for (const [key, rs] of groups) {
  const totalInput = rs.map(r => (r.inputTokens ?? 0) + (r.cacheReadTokens ?? 0) + (r.cacheCreateTokens ?? 0));
  const passes = rs.filter(r => r.pass).length;
  lines.push(`| ${key} | ${rs.length} | ${passes}/${rs.length} (${((passes / rs.length) * 100).toFixed(0)}%) | ${fmt((median(rs.map(r => r.wallMs ?? 0)) ?? 0) / 1000, 1)} s | ${fmt(median(totalInput))} | ${fmt(median(rs.map(r => r.outputTokens ?? 0)))} | ${money(median(rs.map(r => r.costUsd ?? 0)))} | ${money(sum(rs, 'costUsd'))} |`);
}
lines.push('', '## Per run', '', '| Run | Task | Setup | Rep | Pass | Time (s) | Uncached in | Cache read | Cache write | Output | Cost |', '|---|---|---|---|---|---|---|---|---|---|---|');
for (const r of runs) lines.push(`| ${r.run} | ${r.task} | ${r.arm} | ${r.rep} | ${r.pass ? 'yes' : 'no'} | ${fmt((r.wallMs ?? 0) / 1000, 1)} | ${fmt(r.inputTokens)} | ${fmt(r.cacheReadTokens)} | ${fmt(r.cacheCreateTokens)} | ${fmt(r.outputTokens)} | ${money(r.costUsd)} |`);
lines.push('', 'Setups not yet run are absent, not zero. Freebuff has no headless mode and is excluded.');
const out = join(resultsRoot, 'REPORT.md');
await writeFile(out, lines.join('\n') + '\n');
console.log(lines.join('\n'));
console.log(`\nWritten: ${out}`);
