import { resolve, relative, isAbsolute } from 'node:path';

export interface GuardCall { tool: string; input: Record<string, unknown>; cwd: string; home: string; allowHosts: string[] }

const SECRET = /(^|\/)(\.ssh|\.aws|\.gnupg|\.config\/gh|\.npmrc|\.netrc|\.docker\/config\.json|id_rsa|id_ed25519)(\/|$)|(^|\/)\.env(?!\.(example|sample|template)$)(\.[\w-]+)?$/;
// A client counts only in command position (start, after ; & | ( ` $( or env/xargs/time), so "fix curl bug" in a commit message is not a network call.
const NET_CLIENT = /(^|[;&|`(]|\$\()\s*((env|xargs|time|nohup)\s+)*(curl|wget|nc|ncat|netcat|socat|ssh|scp|sftp|ftp|telnet)(\s|$)/;
const NET_INLINE = /(^|[\s;&|`(])(python3?|node|deno|bun|ruby|perl|php)\s[^|;&]*(urllib|http|socket|fetch|requests|net\.connect|XMLHttpRequest)/;
const WRITE_ALL = new Set(['touch', 'tee', 'rm', 'mkdir', 'rmdir', 'truncate', 'shred']);
const WRITE_LAST = new Set(['cp', 'mv', 'ln', 'install', 'rsync']);

const expand = (p: string, home: string) => (p === '~' ? home : p.startsWith('~/') ? `${home}${p.slice(1)}` : p);
const inside = (path: string, cwd: string) => { const r = relative(cwd, path); return r === '' || (!r.startsWith('..') && !isAbsolute(r)); };
const hostOf = (url: string) => { try { return new URL(url).hostname.toLowerCase(); } catch { return null; } };
const allowed = (host: string | null, list: string[]) => !!host && list.some(a => host === a || host.endsWith(`.${a}`));

function resolvePath(p: string, call: GuardCall) { return resolve(call.cwd, expand(p, call.home)); }

/** Writes to a path outside the project (or /dev/null-style sinks, which are harmless). */
function outsideWrite(raw: string, call: GuardCall): boolean {
  if (!raw || raw === '/dev/null' || raw.startsWith('/dev/std') || raw.startsWith('&')) return false;
  if (/[$`]/.test(raw)) return true; // unresolvable: cannot prove it stays inside the project
  return !inside(resolvePath(raw, call), call.cwd);
}

function bashReason(command: string, call: GuardCall): string | null {
  if (/(^|[\s;&|`(])sudo(\s|$)/.test(command)) return 'sudo is not allowed while user-installed skills are active';
  const urls = [...command.matchAll(/https?:\/\/([^/\s:'"?#]+)/gi)].map(m => m[1].toLowerCase());
  if (NET_CLIENT.test(command) || NET_INLINE.test(command)) {
    if (!urls.length || urls.some(h => !allowed(h, call.allowHosts))) return 'network commands to hosts that are not allowed are blocked while user-installed skills are active';
  }
  for (const token of command.split(/[\s;&|<>()`'"]+/)) {
    if (!token) continue;
    const t = expand(token, call.home);
    if (SECRET.test(t) || SECRET.test(resolve(call.cwd, t))) return 'commands that touch secret files are blocked';
  }
  for (const m of command.matchAll(/>>?\s*([^\s;&|<>]+)/g)) if (outsideWrite(m[1], call)) return 'writing outside the project is blocked';
  for (const part of command.split(/[;&|]+/)) {
    const words = part.trim().split(/\s+/).filter(w => !w.startsWith('-'));
    const verb = words[0];
    const args = words.slice(1).filter(w => !w.startsWith('>'));
    if (WRITE_ALL.has(verb) && args.some(a => outsideWrite(a, call))) return 'writing outside the project is blocked';
    if (WRITE_LAST.has(verb) && args.length && outsideWrite(args[args.length - 1], call)) return 'writing outside the project is blocked';
  }
  return null;
}

/**
 * Returns a reason to deny the tool call, or null to leave the normal permission flow alone.
 * shortcut: a string-level shell check cannot catch every obfuscated command (base64 pipelines, eval of
 * built strings); the sandbox settings remain the hard boundary, this is the first line of defence.
 */
export function evaluateGuard(call: GuardCall): string | null {
  const { tool, input } = call;
  if (tool === 'Bash') return typeof input.command === 'string' ? bashReason(input.command, call) : 'Bash call without a command';
  if (tool === 'Read' || tool === 'Edit' || tool === 'Write' || tool === 'NotebookEdit' || tool === 'MultiEdit') {
    const file = typeof input.file_path === 'string' ? input.file_path : typeof input.notebook_path === 'string' ? input.notebook_path : null;
    if (!file) return null;
    const path = resolvePath(file, call);
    if (SECRET.test(path)) return 'secret files are blocked while user-installed skills are active';
    if (tool !== 'Read' && !inside(path, call.cwd)) return 'writing outside the project is blocked';
    return null;
  }
  if (tool === 'Glob' || tool === 'Grep') {
    const path = typeof input.path === 'string' ? resolvePath(input.path, call) : null;
    return path && SECRET.test(path) ? 'secret locations are blocked while user-installed skills are active' : null;
  }
  if (tool === 'WebFetch') {
    const host = typeof input.url === 'string' ? hostOf(input.url) : null;
    return allowed(host, call.allowHosts) ? null : 'WebFetch to hosts that are not allowed is blocked while user-installed skills are active';
  }
  if (tool === 'WebSearch') return 'WebSearch is blocked while user-installed skills are active';
  return null;
}
