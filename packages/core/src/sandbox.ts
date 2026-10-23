import { execFile } from 'node:child_process';
import { access, lstat, realpath } from 'node:fs/promises';
import { isAbsolute, join, relative } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
const exec = promisify(execFile);
const launcherEnvironment = { PATH: '/usr/bin:/bin', LANG: 'C.UTF-8' };
const quote = (text: string) => `'${text.replaceAll("'", "'\\''")}'`;

async function argumentsFor(command: string, cwd: string): Promise<string[]> {
  const args = ['--die-with-parent', '--new-session', '--unshare-all', '--clearenv'];
  for (const path of ['/usr', '/bin', '/sbin', '/lib', '/lib64']) {
    if (await access(path).then(() => true, () => false)) args.push('--ro-bind', path, path);
  }
  args.push('--dir', '/runtime', '--ro-bind', await realpath(process.execPath), '/runtime/node');
  args.push('--proc', '/proc', '--dev', '/dev', '--tmpfs', '/tmp', '--dir', '/home', '--dir', '/etc');
  if (await access('/etc/ld.so.cache').then(() => true, () => false)) args.push('--ro-bind', '/etc/ld.so.cache', '/etc/ld.so.cache');
  args.push('--ro-bind', cwd, '/workspace');
  const metadata = await lstat(join(cwd, '.git')).catch(() => null);
  if (metadata?.isDirectory()) args.push('--tmpfs', '/workspace/.git');
  else if (metadata) args.push('--ro-bind', '/dev/null', '/workspace/.git');
  args.push('--setenv', 'PATH', '/runtime:/usr/bin:/bin', '--setenv', 'HOME', '/tmp', '--setenv', 'TMPDIR', '/tmp', '--setenv', 'LANG', 'C.UTF-8', '--chdir', '/workspace', '--', '/bin/sh', '-c', command);
  return args;
}

export async function detectCheckSandbox(): Promise<{ available: boolean; reason?: string }> {
  if (process.platform !== 'linux') return { available: false, reason: 'API execution currently requires Linux bubblewrap for verification checks' };
  try {
    await exec('bwrap', await argumentsFor('node -e \"process.exit(0)\"', await realpath(process.cwd())), { env: launcherEnvironment, timeout: 5000, maxBuffer: 65536 });
    return { available: true };
  } catch { return { available: false, reason: 'bubblewrap is unavailable or its namespace probe failed' }; }
}

export async function runIsolatedCheck(command: string, cwd: string, worktreeRoot: string) {
  const [actual, root] = await Promise.all([realpath(cwd), realpath(worktreeRoot)]);
  const child = relative(root, actual);
  if (!child || child.startsWith('..') || isAbsolute(child)) throw new Error('Check workspace is outside the run worktree root');
  return exec('bwrap', await argumentsFor(command, actual), { env: launcherEnvironment, timeout: 60000, maxBuffer: 1024 * 1024 });
}

/** A fixed host-side launcher, not provider-supplied shell syntax. */
export function isolatedCheckCommand(command: string, worktreeRoot: string): string {
  const payload = Buffer.from(JSON.stringify({ command, worktreeRoot })).toString('base64url');
  return `${quote(process.execPath)} ${quote(fileURLToPath(import.meta.url))} ${quote(payload)}`;
}

if (process.argv[1] && await realpath(process.argv[1]).catch(() => '') === fileURLToPath(import.meta.url)) {
  try {
    const request = JSON.parse(Buffer.from(process.argv[2], 'base64url').toString('utf8'));
    const result = await runIsolatedCheck(request.command, process.cwd(), request.worktreeRoot);
    process.stdout.write(result.stdout); process.stderr.write(result.stderr);
  } catch (error) {
    const result = error as { stdout?: string; stderr?: string; message?: string };
    process.stderr.write(`${result.stdout ?? ''}${result.stderr ?? ''}${result.message ?? 'Isolated verification failed'}\n`);
    process.exitCode = 1;
  }
}
