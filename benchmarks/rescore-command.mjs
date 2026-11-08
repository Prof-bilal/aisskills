#!/usr/bin/env node
// Re-scores stored Command Code replies with the same word-level rule the Claude checker uses
// (file-name answers match by basename; "30 minutes" matches "30"). No model calls.
// Keeps the original strict result as passStrict so both are visible.
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from '../packages/core/node_modules/yaml/dist/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const tasks = YAML.parse(await readFile(join(here, 'config', 'tasks.yaml'), 'utf8'));
export function lenientPass(answerText, expected) {
  const match = /^ANSWER:\s*(.+)$/m.exec(answerText ?? '');
  if (!match) return false;
  const tokens = match[1].split(/\s+/).map(t => t.replace(/^[`'"*]+|[`'"*.,]+$/g, '').toLowerCase()).filter(Boolean);
  return tokens.some(t => expected.some(e => t === String(e).toLowerCase() || t.endsWith('/' + String(e).toLowerCase())));
}
const file = process.argv[2];
const lines = (await readFile(file, 'utf8')).trim().split('\n').map(l => JSON.parse(l));
let changed = 0;
for (const r of lines) {
  const task = tasks[r.task];
  if (!task || r.passStrict !== undefined) continue;
  r.passStrict = r.pass;
  r.pass = lenientPass(r.answer, task.expect_any);
  if (r.pass !== r.passStrict) changed++;
}
await writeFile(file, lines.map(r => JSON.stringify(r)).join('\n') + '\n');
console.log(`${file}: re-scored ${lines.length} runs, ${changed} changed`);
