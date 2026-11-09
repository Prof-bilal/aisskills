// Bench-only shim: records the user's task for the guard's alignment check without delivering any skill text.
// Used by the native-guard arm so the skill arrives exactly as in the native arm (a file in .claude/skills).
import { storeTask } from '../../packages/cli/dist/align.js';
const chunks = [];
for await (const c of process.stdin) chunks.push(c);
const input = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
if (typeof input.prompt === 'string' && typeof input.session_id === 'string' && /^[\w-]{1,128}$/.test(input.session_id))
  await storeTask(typeof input.cwd === 'string' ? input.cwd : process.cwd(), input.session_id, input.prompt).catch(() => undefined);
