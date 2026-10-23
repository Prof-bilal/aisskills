import { readdir } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";

const execFileAsync = promisify(execFile);
const root = process.cwd();
const release = join(root, "release");
const expected = new Map([
  ["aiskills-core", ["package/dist/index.js", "package/skills/"]],
  ["aiskills-adapters-local", ["package/dist/index.js"]],
  ["aiskills-sdk", ["package/dist/index.js"]],
  ["@prof-bilal/aiskills", ["package/dist/index.js"]]
]);
const files = (await readdir(release)).filter(file => file.endsWith(".tgz"));
if (files.length < expected.size) throw new Error(`Expected at least ${expected.size} release tarballs, found ${files.length}`);

const seen = new Set();
for (const file of files) {
  const archive = join(release, file);
  const { stdout: metadata } = await execFileAsync("tar", ["-xOf", archive, "package/package.json"]);
  const pkg = JSON.parse(metadata);
  if (pkg.name === "aiskills-workspace") continue;
  if (seen.has(pkg.name) || !expected.has(pkg.name)) throw new Error(`Unexpected or duplicate package: ${pkg.name}`);
  seen.add(pkg.name);
  if (pkg.version !== "0.1.6") throw new Error(`${pkg.name} has version ${pkg.version}, expected 0.1.6`);
  if (pkg.engines?.node !== ">=20") throw new Error(`${pkg.name} must declare Node.js >=20`);
  const { stdout: listing } = await execFileAsync("tar", ["-tzf", archive]);
  if (listing.split("\n").some(entry => entry.includes(".integration/") || entry.includes("node_modules/"))) {
    throw new Error(`${pkg.name} archive contains development-only integration files`);
  }
  for (const required of expected.get(pkg.name)) {
    if (required.endsWith("/") ? !listing.split("\n").some(entry => entry.startsWith(required)) : !listing.split("\n").includes(required)) {
      throw new Error(`${pkg.name} archive is missing ${required}`);
    }
  }
}
if (seen.size !== expected.size) throw new Error("Release package set is incomplete");
console.log(`Release artifacts verified: ${[...seen].join(", ")}`);
