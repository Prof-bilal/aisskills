# System Audit — Phase 0

Audit date: 2026-10-21

## Repository state

- Workspace: `/home/abdullah/Projects/aisskills`
- Existing files: `docs/PHASES.md` only
- Git repository: not initialized
- Existing package metadata: none found
- Existing source code: none found
- Existing tests: none found
- Existing CLI: none found
- Existing skills, packs, adapters, workflows, or configuration: none found

This is a greenfield repository. There are no reusable implementation
components or architecture conflicts to preserve.

## Local environment evidence

Observed on the audit machine:

| Capability | Result |
| --- | --- |
| Operating system | Linux x86_64, Omarchy kernel |
| Node.js | v26.12.0 |
| npm | 11.20.0 |
| pnpm | 12.14.0 |
| Yarn | 4.18.1 |
| Bun | 1.4.3 |
| Deno | 2.9.7 |
| Python | 3.15.0 |
| Go | 1.27.3 |
| Codex executable | found; `codex-cli 0.163.0` |
| Claude executable | found; `2.1.305` |
| OpenCode executable | found; `v2.1.2` |
| Gemini executable | found, version probe timed out after 3 seconds |
| TypeScript compiler | not globally installed |
| Test runners | none detected globally |

Agent executable discovery is evidence of an executable on `PATH`, not proof
that the adapter can execute a task. Adapter health must be tested separately.

## Requirements extracted from the product brief

The first implementation must eventually support:

- an installable `aiskills` CLI
- user-selected agents and skill packs
- declarative skills with validated manifests
- project detection and local project configuration
- evidence-first claim verification
- permission-aware execution
- proportional testing and completion reporting
- extensibility through an SDK

The brief explicitly excludes a hosted marketplace, accounts, payments, cloud
sync, and a large skill catalog from the MVP.

## Architecture decisions

1. Use TypeScript on Node.js. The target is an installable cross-platform CLI,
   and the local environment already provides Node and multiple package
   managers.
2. Use a pnpm workspace monorepo. pnpm is installed, has first-class workspace
   support, and matches the requested package-oriented architecture.
3. Keep the first workspace small: `packages/core`, `packages/cli`, and
   `packages/sdk`. Add adapters, packs, and workflows only when their contracts
   are needed.
4. Keep the core provider-neutral. Agent-specific detection and execution will
   live behind adapter packages.
5. Prefer JSON-compatible domain objects and schema validation at boundaries.
   This makes CLI output, tests, future adapters, and future registry support
   share one model.
6. Use platform APIs for paths and process discovery. Do not hardcode this
   machine's home directory, executable paths, or agent availability.

## Risks and open questions

- The exact invocation and output contracts of Codex, Claude Code, OpenCode,
  and Gemini need adapter-specific experiments.
- Node 26 is available locally, but the published support range should target a
  maintained LTS line and be verified in CI on Linux, macOS, and Windows.
- No Git repository exists yet, so change history and branch-based isolation
  are not currently available.
- Interactive prompts need a non-interactive mode for CI and automation.
- Executable third-party plugins require a stronger sandbox and approval model
  than declarative skills; they should not be enabled in the first package
  foundation.

## Phase 0 acceptance checks

- [x] Repository inventory completed
- [x] Existing reusable components checked
- [x] Runtime and package-manager options checked
- [x] Agent executable presence checked
- [x] Architecture conflicts identified
- [x] Workspace layout selected
- [x] Phase 1 boundary defined
- [x] Package foundation implemented — Phase 1
- [x] Clean package installation verified — Phase 1

