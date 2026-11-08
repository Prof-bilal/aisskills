#!/usr/bin/env node
// Scanner benchmark: does AI Skills' untrusted-content scanner catch malicious skill text,
// and does it leave ordinary skill text alone? No model calls; deterministic.
// Usage: node benchmarks/security/scanner-bench.mjs  -> benchmarks/results/security/scanner.json
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanUntrustedContent, openPackageCatalog, installSkillPackage } from '../../packages/core/dist/index.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { ATTACKS, BENIGN } from './corpus.mjs';

const here = dirname(fileURLToPath(import.meta.url));
// The real gate is `aiskills add --yes`: it can approve, hold for review, or reject.
const tmp = await mkdtemp(join(tmpdir(), 'aiskills-scan-'));
process.env.AI_SKILLS_HOME = join(tmp, 'home');
const catalog = await openPackageCatalog();
async function installVerdict(id, text) {
  const dir = join(tmp, id); await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'SKILL.md'), `---\nname: ${id}\ndescription: Benchmark skill ${id}\n---\n\n${text}`);
  try { return (await installSkillPackage(catalog, { source: dir, approve: true })).status === 'approved' ? 'approved' : 'review'; }
  catch { return 'rejected'; }
}
const attacks = [], benign = [];
for (const a of ATTACKS) attacks.push({ ...a, findings: scanUntrustedContent(a.text).length, verdict: await installVerdict(a.id, a.text) });
for (const b of BENIGN) benign.push({ ...b, findings: scanUntrustedContent(b.text).length, verdict: await installVerdict(b.id, b.text) });
catalog.close(); await rm(tmp, { recursive: true, force: true });
const detected = attacks.filter(a => a.findings > 0);
const missed = attacks.filter(a => a.findings === 0);
const falsePositives = benign.filter(b => b.findings > 0);

const byCategory = {};
for (const a of attacks) {
  byCategory[a.category] ??= { total: 0, detected: 0 };
  byCategory[a.category].total++;
  if (a.findings > 0) byCategory[a.category].detected++;
}

const result = {
  attacks: attacks.length,
  detected: detected.length,
  detectionRate: +(detected.length / attacks.length).toFixed(3),
  byCategory,
  missed: missed.map(m => ({ id: m.id, category: m.category, text: m.text })),
  benign: benign.length,
  falsePositives: falsePositives.map(f => ({ id: f.id, findings: f.findings })),
  falsePositiveRate: +(falsePositives.length / benign.length).toFixed(3),
  install: {
    attacks: { approved: attacks.filter(a => a.verdict === 'approved').length, review: attacks.filter(a => a.verdict === 'review').length, rejected: attacks.filter(a => a.verdict === 'rejected').length },
    benign: { approved: benign.filter(b => b.verdict === 'approved').length, review: benign.filter(b => b.verdict === 'review').length, rejected: benign.filter(b => b.verdict === 'rejected').length },
    attacksAutoApproved: attacks.filter(a => a.verdict === 'approved').map(a => a.id),
  },
};
const out = join(here, '..', 'results', 'security');
await mkdir(out, { recursive: true });
await writeFile(join(out, 'scanner.json'), JSON.stringify(result, null, 2) + '\n');
console.log(`Attacks detected: ${result.detected}/${result.attacks} (${(result.detectionRate * 100).toFixed(0)}%)`);
for (const [cat, c] of Object.entries(byCategory)) console.log(`  ${cat}: ${c.detected}/${c.total}`);
console.log(`Benign flagged: ${result.falsePositives.length}/${result.benign} (${(result.falsePositiveRate * 100).toFixed(0)}%)`);
console.log(`Install gate (add --yes): attacks ${JSON.stringify(result.install.attacks)}, benign ${JSON.stringify(result.install.benign)}`);
console.log(`Written: ${join(out, 'scanner.json')}`);
