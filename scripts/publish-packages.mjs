import { mkdtemp, readFile } from "node:fs/promises";
import { readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const root = process.cwd();
const releaseDirectory = await mkdtemp(join(tmpdir(), "aiskills-publish-"));
const packages = ["aiskills-core", "aiskills-adapters-local", "aiskills-sdk", "@prof-bilal/aiskills"];

for (const packageName of packages) {
  const before = new Set(readdirSync(releaseDirectory).filter((file) => file.endsWith(".tgz")));
  const { stdout, stderr } = await execFileAsync("pnpm", ["--filter", packageName, "pack", "--pack-destination", releaseDirectory], { cwd: root, maxBuffer: 4 * 1024 * 1024 });
  process.stdout.write(stdout);
  process.stderr.write(stderr);
  const tarball = readdirSync(releaseDirectory).find((file) => file.endsWith(".tgz") && !before.has(file));
  if (!tarball) throw new Error(`No tarball was created for ${packageName}`);
  const result = await execFileAsync("npm", ["publish", join(releaseDirectory, tarball), "--access", "public", "--ignore-scripts"], { cwd: root, maxBuffer: 4 * 1024 * 1024 });
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
}
