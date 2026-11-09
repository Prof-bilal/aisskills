import { resolve, relative, isAbsolute } from 'node:path';

export interface GuardCall { tool: string; input: Record<string, unknown>; cwd: string; home: string; allowHosts: string[]; uploadHosts?: string[]; secretsAllowed?: boolean }
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
// Uploads: a declared host is readable by default, but sending data to it needs the user's own --allow-upload-host approval.
const WRITE_FLAG = /(^|\s)(-[a-zA-Z]*[dFT]|--data(-[a-z]+)?|--form|--json|--upload-file)(?=\s|=|$)/;
const WRITE_METHOD = /(^|\s)(-X|--request)[\s=]*(POST|PUT|PATCH|DELETE)\b/i;
// Interpreter code that sends a body: request bodies, POST/PUT methods, socket writes.
const UPLOAD_HINT = /\b(data|body|json|files)\s*[=:]|\.(post|put|patch|delete|send|sendall|write)\s*\(|method\W{0,6}(post|put|patch|delete)/i;
// Case-sensitive POST/PUT so a URL path like /post/ does not count as an upload.
const UPLOAD_HINT_CASE = /\bPOST\b|\bPUT\b/;

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

/** Actions that send data out or touch secrets: allowed by policy, but checked against the task (option 2). */
export function isRiskyAction(call: GuardCall): { risky: boolean; action: string } {
  const { tool, input } = call;
  if (tool === 'Bash' && typeof input.command === 'string') {
    const c = input.command;
    return { risky: /(^|[\s;&|`(])(curl|wget|nc|ncat|socat|ssh|scp|sftp|ftp|python3?|node|perl|ruby|php|deno|bun)(\s|$)/.test(c), action: c };
  }
  if (tool === 'WebFetch') return { risky: true, action: String(input.url ?? '') };
  if (['Read', 'Edit', 'Write', 'NotebookEdit', 'MultiEdit'].includes(tool)) {
    const file = String(input.file_path ?? input.notebook_path ?? '');
    return { risky: !!file && SECRET.test(resolvePath(file, call)), action: `${tool} ${file}` };
  }
  return { risky: false, action: '' };
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

function uploadReason(command: string, call: GuardCall): string | null {
  if (!WRITE_FLAG.test(command) && !WRITE_METHOD.test(command) && !UPLOAD_HINT.test(command) && !UPLOAD_HINT_CASE.test(command)) return null;
  const hosts = [...command.matchAll(/https?:\/\/([^/\s:'"?#]+)/gi)].map(m => m[1].toLowerCase());
  if (hosts.some(h => !allowed(h, call.uploadHosts ?? []))) return 'sending data to a host (POST, PUT, data or upload flags) needs approval; start the guard with --allow-upload-host=<host>';
  return null;
}

function bashReason(command: string, call: GuardCall): string | null {
  const structural = structuralReason(command, call);
  if (structural) return structural;
  if (/(^|[\s;&|`(])sudo(\s|$)/.test(command)) return 'sudo is not allowed while user-installed skills are active';
  const urls = [...command.matchAll(/https?:\/\/([^/\s:'"?#]+)/gi)].map(m => m[1].toLowerCase());
  if (NET_CLIENT.test(command) || NET_INLINE.test(command)) {
    if (!urls.length || urls.some(h => !allowed(h, call.allowHosts))) return 'network commands to hosts that are not allowed are blocked while user-installed skills are active';
    const upload = uploadReason(command, call);
    if (upload) return upload;
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

// Reply guard: secret values in the model's final reply (the one shown to the user and passed on).
const SECRET_KEY_VALUE = /\b[A-Za-z_]*(?:token|secret|password|passwd|api[_-]?key|private[_-]?key)[A-Za-z_]*\s*[:=]\s*["'`]?([^\s"'`,;]{8,})/gi;
const SECRET_SHAPES = [/AKIA[0-9A-Z]{16}/, /gh[pousr]_[A-Za-z0-9]{36}/, /sk-[A-Za-z0-9_-]{20,}/, /-----BEGIN [A-Z ]*PRIVATE KEY-----/];
const PLACEHOLDER = /redact|^[*x.<\[({]+$|^\$\{?\w+\}?$/i;

/** Returns the kinds of secret found in the reply (never the values). envValues are values from the project's .env. */
export function leakedSecrets(reply: string, envValues: string[] = []): string[] {
  const hits: string[] = [];
  for (const m of reply.matchAll(SECRET_KEY_VALUE)) if (!PLACEHOLDER.test(m[1])) hits.push('key=value secret');
  for (const re of SECRET_SHAPES) if (re.test(reply)) hits.push('secret-shaped token');
  for (const v of envValues) if (v.length >= 8 && reply.includes(v)) hits.push('project .env value');
  return hits;
}

// Plain read: a single curl/wget GET to an allowed host using only output/timeout flags, with a short path and no
// query, cannot carry file contents, so it skips the model alignment check.
// shortcut: data could still be spelled out in short path segments; an adaptive attacker can do that. Upgrade by
// pinning declared paths per skill (access.paths) if that matters.
const READ_FLAGS = new Set(['-s', '-S', '-f', '-L', '-i', '-I', '-sS', '-fsS', '-sSf', '-fsSL', '-sSL', '-sL', '-sf', '-fs', '-q', '-qO-', '-O-',
  '--silent', '--show-error', '--fail', '--location', '--compressed', '--head', '--include', '--quiet']);
const READ_FLAGS_WITH_VALUE = new Set(['--max-time', '-m', '--connect-timeout', '--retry', '-w', '--write-out', '-o', '-O']);
export function isPlainRead(call: GuardCall): boolean {
  if (call.tool !== 'Bash' || typeof call.input.command !== 'string') return false;
  const { segments, substitution } = splitShell(call.input.command);
  if (substitution || segments.length !== 1) return false;
  const [name, ...rest] = segments[0];
  if (name !== 'curl' && name !== 'wget') return false;
  let url: string | null = null;
  for (let i = 0; i < rest.length; i++) {
    const w = rest[i];
    if (/^https?:\/\//i.test(w)) { if (url) return false; url = w; continue; }
    if (READ_FLAGS.has(w) || /^--(timeout|max-time|connect-timeout|retry)=\d+$/.test(w)) continue;
    if (READ_FLAGS_WITH_VALUE.has(w) && i + 1 < rest.length) {
      const v = rest[++i];
      if ((w === '-o' || w === '-O') && v !== '/dev/null' && v !== '-') return false;
      if (['--max-time', '-m', '--connect-timeout', '--retry'].includes(w) && !/^\d+(\.\d+)?$/.test(v)) return false;
      continue;
    }
    return false;
  }
  if (!url) return false;
  let parsed: URL;
  try { parsed = new URL(url); } catch { return false; }
  if (parsed.username || parsed.password || parsed.search || parsed.hash || !allowed(parsed.hostname.toLowerCase(), call.allowHosts)) return false;
  return /^\/[A-Za-z0-9._\/-]{0,80}$/.test(parsed.pathname) && !/[A-Za-z0-9_-]{20,}/.test(parsed.pathname);
}
