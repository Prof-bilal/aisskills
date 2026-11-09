import { createHash } from 'node:crypto';
import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

export interface AuditEntry { time: string; tool: string; argsDigest: string; ok: boolean; reason?: string }
const GENESIS = '0'.repeat(64);
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value ?? null)).digest('hex');

/** Hash-chained JSONL: each line stores the previous line's hash, so edits or deletions break verification. */
export async function appendAudit(dir: string, entry: Omit<AuditEntry, 'time' | 'argsDigest'> & { args?: unknown }): Promise<void> {
  const file = join(dir, 'audit.jsonl');
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const previous = await readFile(file, 'utf8').then(text => text.trimEnd().split('\n').pop() ?? '', () => '');
  const prevHash = previous ? createHash('sha256').update(previous).digest('hex') : GENESIS;
  const { args, ...rest } = entry;
  const record = { ...rest, time: new Date().toISOString(), argsDigest: digest(args), prev: prevHash };
  await appendFile(file, JSON.stringify(record) + '\n', { mode: 0o600 });
}

/** Returns true when every line links to the one before it.
 * shortcut: the newest line is not covered until another line follows it; anchoring the head hash outside the file would close that gap. */
export function verifyAuditText(text: string): boolean {
  let prev = GENESIS;
  for (const line of text.trimEnd().split('\n').filter(Boolean)) {
    const record = JSON.parse(line) as { prev: string };
    if (record.prev !== prev) return false;
    prev = createHash('sha256').update(line).digest('hex');
  }
  return true;
}
