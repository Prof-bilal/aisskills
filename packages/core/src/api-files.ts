import { constants } from 'node:fs';
import { lstat, mkdir, open, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';

/** API responses are data: only explicit complete-file blocks can change scoped files. */
export async function applyScopedFileBlocks(text: string, cwd: string, allowed: readonly string[]) {
  const root = await realpath(cwd);
  const written: string[] = []; const rejected: string[] = [];
  const blocks = [...text.matchAll(/<<<FILE\s+([^>\n]+?)>>>\n?([\s\S]*?)\n?<<<END>>>/g)];
  if (text.length > 4 * 1024 * 1024 || blocks.length > 128) throw new Error('API edit response exceeds limits');
  for (const block of blocks) {
    const file = block[1].trim();
    const target = resolve(root, file);
    const path = relative(root, target);
    if (!allowed.includes(file) || !path || path.startsWith('..') || isAbsolute(path) || isAbsolute(file) || file.includes('\\') || file.split('/').some(p => !p || p === '.' || p === '..' || p === '.git' || p === '.ai')) {
      rejected.push(file); continue;
    }
    let symlink = false; let component = root;
    for (const part of file.split('/')) {
      component = join(component, part);
      const info = await lstat(component).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
      if (info?.isSymbolicLink()) { symlink = true; break; }
    }
    if (symlink) { rejected.push(file); continue; }
    await mkdir(dirname(target), { recursive: true });
    const handle = await open(target, constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | constants.O_NOFOLLOW, 0o644);
    try { await handle.writeFile(block[2].endsWith('\n') ? block[2] : block[2] + '\n'); } finally { await handle.close(); }
    written.push(file);
  }
  return { written, rejected, rest: text.replace(/<<<FILE\s+([^>\n]+?)>>>\n?([\s\S]*?)\n?<<<END>>>/g, '').trim() };
}
