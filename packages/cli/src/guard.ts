import { resolve, relative, isAbsolute } from 'node:path';

export interface GuardCall { tool: string; input: Record<string, unknown>; cwd: string; home: string; allowHosts: string[]; secretsAllowed?: boolean }
/** Secret locations are denied unless an enabled skill declares `access.secrets: true`. */
const secretHit=(path:string,call:GuardCall)=>!call.secretsAllowed&&SECRET.test(path);

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

const WRAPPERS = new Set(['env', 'nohup', 'time', 'command', 'builtin', 'nice', 'stdbuf', 'xargs', 'timeout', 'sudo', 'doas']);
const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh', 'fish', 'csh', 'tcsh']);
const EVALS = new Set(['eval', 'source', '.', 'exec']);
const NET_CMDS = new Set(['curl', 'wget', 'nc', 'ncat', 'netcat', 'socat', 'ssh', 'scp', 'sftp', 'ftp', 'telnet']);

/**
 * Quote-aware split into command segments (separated by ; & | newline) and words.
 * shortcut: not a full shell grammar (no heredocs, arithmetic or function bodies); unknown constructs
 * fall through to the regex checks below, and substitution is denied outright, which is the conservative side.
 */
export function splitShell(command: string): { segments: string[][]; substitution: boolean } {
  const segments: string[][] = [[]]; let word = ''; let inWord = false; let quote: '"' | "'" | null = null; let substitution = false;
  const endWord = () => { if (inWord) segments[segments.length - 1].push(word); word = ''; inWord = false; };
  for (let i = 0; i < command.length; i++) {
    const c = command[i];
    if (quote === "'") { if (c === "'") quote = null; else word += c; inWord = true; continue; }
    if (c === '$' && command[i + 1] === '(') substitution = true;
    if (c === '`' || (c === '<' || c === '>') && command[i + 1] === '(') substitution = true;
    if (quote === '"') { if (c === '"') quote = null; else word += c; inWord = true; continue; }
    if (c === '"' || c === "'") { quote = c; inWord = true; continue; }
    if (c === ' ' || c === '\t') { endWord(); continue; }
    if (c === ';' || c === '&' || c === '|' || c === '\n' || c === '(' || c === ')') { endWord(); segments.push([]); continue; }
    word += c; inWord = true;
  }
  endWord();
  return { segments: segments.filter(s => s.length), substitution };
}

const INTERPRETERS = new Set(['python', 'python3', 'node', 'perl', 'ruby', 'php', 'deno', 'bun']);
const WRITE_HINT = /open\s*\(|writeFile|appendFile|createWriteStream|fs\.(write|rm|unlink|rename|copy)|File\.write|file_put_contents|os\.(remove|rename|system)|shutil\.|subprocess|child_process|execSync|spawnSync|Bun\.write|system\s*\(|exec\s*\(/;
const QUOTED = /["']([^"'\n]*)["']/g;

/**
 * Inline interpreter code (python -c, node -e, ...) is code, not a shell word: deny any write-capable call whose
 * target is outside the project, any target we cannot read as a literal, and any shell escape from inside it.
 * shortcut: a regex over the program text cannot prove what a dynamic path resolves to; those are denied, not analysed.
 */
function inlineReason(words: string[], call: GuardCall): string | null {
  const flag = words.findIndex(w => w === '-c' || w === '-e');
  if (flag === -1 || flag + 1 >= words.length) return null;
  const code = words.slice(flag + 1).join(' ');
  if (/subprocess|child_process|execSync|spawnSync|os\.system|system\s*\(|exec\s*\(/.test(code)) return 'shell escape from inline interpreter code is blocked while user-installed skills are active';
  if (!WRITE_HINT.test(code)) return null;
  if (/(open|writeFile|writeFileSync|appendFile|appendFileSync|createWriteStream|file_put_contents|write_file|File\.write)\s*\(\s*[^'"\s)]/.test(code)) return 'inline interpreter code that writes to a non-literal path is blocked while user-installed skills are active';
  const targets = [...code.matchAll(QUOTED)].map(m => m[1]).filter(t => t.length);
  if (!targets.length) return 'inline interpreter code that writes to a path it cannot read literally is blocked while user-installed skills are active';
  for (const target of targets) if (!inside(resolvePath(target, call), call.cwd)) return 'inline interpreter code that writes outside the project is blocked while user-installed skills are active';
  return null;
}

/** Structural denials: substitution, shell and eval indirection, and decoded payloads piped onward. */
export function structuralReason(command: string, call: GuardCall): string | null {
  const { segments, substitution } = splitShell(command);
  if (substitution) return 'command substitution is blocked while user-installed skills are active';
  const piped = /\|(?!\|)/.test(command);
  for (const seg of segments) {
    let words = seg.slice();
    while (words.length && (/^[A-Za-z_][A-Za-z0-9_]*=/.test(words[0]) || WRAPPERS.has(words[0].split('/').pop() ?? ''))) {
      const wrapper = words.shift()!;
      if (wrapper === 'timeout' && words.length) words.shift();
    }
    const name = (words[0] ?? '').split('/').pop() ?? '';
    if (EVALS.has(name)) return 'shell evaluation (eval, source, exec) is blocked while user-installed skills are active';
    if (SHELLS.has(name)) return 'starting a shell from a command is blocked while user-installed skills are active';
    if (name === 'base64' && piped && words.some(w => /^(-d|-D|--decode)$/.test(w))) return 'decoded input piped onward is blocked while user-installed skills are active';
    if (INTERPRETERS.has(name)) { const reason = inlineReason(words, call); if (reason) return reason; }
    if (NET_CMDS.has(name)) {
      const hosts = [...command.matchAll(/https?:\/\/([^/\s:'"?#]+)/gi)].map(m => m[1].toLowerCase());
      if (!hosts.length || hosts.some(h => !allowed(h, call.allowHosts))) return 'network commands to hosts that are not allowed are blocked while user-installed skills are active';
    }
  }
  return null;
}

function bashReason(command: string, call: GuardCall): string | null {
  const structural = structuralReason(command, call);
  if (structural) return structural;
  if (/(^|[\s;&|`(])sudo(\s|$)/.test(command)) return 'sudo is not allowed while user-installed skills are active';
  const urls = [...command.matchAll(/https?:\/\/([^/\s:'"?#]+)/gi)].map(m => m[1].toLowerCase());
  if (NET_CLIENT.test(command) || NET_INLINE.test(command)) {
    if (!urls.length || urls.some(h => !allowed(h, call.allowHosts))) return 'network commands to hosts that are not allowed are blocked while user-installed skills are active';
  }
  for (const token of command.split(/[\s;&|<>()`'"]+/)) {
    if (!token) continue;
    const t = expand(token, call.home);
    if (secretHit(t,call) || secretHit(resolve(call.cwd, t),call)) return 'commands that touch secret files are blocked';
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
    if (secretHit(path,call)) return 'secret files are blocked while user-installed skills are active';
    if (tool !== 'Read' && !inside(path, call.cwd)) return 'writing outside the project is blocked';
    return null;
  }
  if (tool === 'Glob' || tool === 'Grep') {
    const path = typeof input.path === 'string' ? resolvePath(input.path, call) : null;
    return path && secretHit(path,call) ? 'secret locations are blocked while user-installed skills are active' : null;
  }
  if (tool === 'WebFetch') {
    const host = typeof input.url === 'string' ? hostOf(input.url) : null;
    return allowed(host, call.allowHosts) ? null : 'WebFetch to hosts that are not allowed is blocked while user-installed skills are active';
  }
  if (tool === 'WebSearch') return 'WebSearch is blocked while user-installed skills are active';
  return null;
}
