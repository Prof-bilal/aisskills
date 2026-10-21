# AI Skills Platform Roadmap

## Now: Phase 0 — Audit

Status: complete after the audit recorded in `docs/SYSTEM_AUDIT.md`.

Decisions made:

- greenfield TypeScript implementation
- pnpm workspace monorepo
- small initial package set: core, CLI, and SDK
- provider-neutral core with adapter boundaries
- local-first storage and no hosted service dependency

## Complete: Phase 1 — Package foundation

Build the smallest installable slice:

1. initialize package metadata and workspace configuration
2. add TypeScript build and test configuration
3. add `packages/core`
4. add `packages/cli` with `aiskills --help` and `aiskills doctor` skeleton
5. add `packages/sdk` with validated definition placeholders
6. add platform-safe configuration paths
7. add structured error and log output
8. add unit and CLI smoke tests
9. verify local packed installation in a temporary directory

Phase 1 acceptance is complete: a fresh checkout builds and tests, both core
and CLI packages can be packed, and the installed CLI invokes `--version` and
`doctor` without relying on global project files.

## Complete: Phase 2 — Skill manifests and registry

Implemented:

- versioned YAML manifest schema
- permission and field validation
- duplicate ID detection
- circular and missing dependency detection
- built-in registry loading
- four foundational built-in skills
- `aiskills skills list`
- tests for valid loading and invalid manifests

## Complete: Phase 3 — Agent detection and adapters

Implemented:

- provider-neutral `AgentAdapter` contract
- local executable discovery with platform-aware lookup
- bounded version probing
- capability reporting
- tested built-in adapters for Codex, Claude Code, OpenCode, and Gemini CLI
- `aiskills agents`
- explicit `unverified` status when an executable exists but its version probe
  cannot complete

Observed on the development machine: Codex, Claude Code, and OpenCode are
available; Gemini CLI is present on `PATH` but remains unverified because its
version command did not complete within the adapter timeout.

## Complete: Phase 4 — Interactive initialization and profiles

Implemented:

- persisted user configuration with schema versioning
- profile creation and activation
- selected agents, packs, and execution modes
- `aiskills init`
- `aiskills profile create`
- `aiskills profile use`
- project initialization through `aiskills init --project`

The CLI accepts explicit selection flags for automation, while the profile
model is ready for a richer interactive prompt in a later UX pass.

## Complete: Phase 5 — Project context

Implemented:

- repository file inventory
- JavaScript, TypeScript, Python, Go, Rust, and C# detection
- common framework detection from manifests and files
- npm, pnpm, Yarn, and Bun package-manager detection
- common test-runner detection
- common database dependency detection
- monorepo detection
- `VERIFIED`, `SUPPORTED`, and `UNKNOWN` evidence status labels
- project-local `.ai/config.json` creation

## Complete: Phase 6 — Evidence and claims

Implemented:

- claim states: `VERIFIED`, `SUPPORTED`, `LIKELY`, `UNVERIFIED`,
  `CONTRADICTED`, and `UNKNOWN`
- typed evidence records with source, reference, summary, and confidence
- evidence priority from runtime behavior through user statements and AI
  assumptions
- contradiction handling that preserves competing evidence
- `aiskills verify "claim"`
- tests proving that user statements do not override stronger runtime evidence

## Complete: Phase 7 — Planning and skill routing

Implemented:

- task classification for verification, bug-fix, feature, research, and general work
- capability extraction from task intent
- minimum-effective routing over available skills
- workflow selection
- structured plans separating facts, assumptions, claims, steps, and success criteria
- `aiskills plan "task"`

## Complete: Phase 8 — Execution and orchestration

Implemented so far:

- normalized agent execution results
- permission checks and read-only task defaults
- bounded task graph execution with dependency validation
- safe parallel batches for independent nodes
- `aiskills run` planning and execution boundary
- explicit `BLOCKED` and `NEEDS USER ACTION` reporting
- real read-only Codex task execution through the adapter contract

## Complete: Phase 9 — Verification and completion reporting

Implemented so far:

- structured verification checks and reports
- completion states including `COMPLETE`, `PARTIALLY VERIFIED`, `FAILED`, and
  `IMPLEMENTED BUT UNVERIFIED`
- bounded execution of the detected project test command
- explicit evidence for passing checks
- visible skipped checks and next actions
- static checks and explicit requirements criteria
- routed repository security scanning
- adversarial-check category and visible skipped state

## Complete: Phase 10 — Skill packs

Implemented:

- versioned pack manifest schema
- pack registry loading and validation
- pack dependency resolution and cycle detection
- built-in `core`, `fullstack`, `security`, `research`, and `product` packs
- profile-backed `aiskills packs list`, `install`, and `remove`
- packs reference skill IDs instead of copying skill definitions

## Complete: Phase 11 — Security and permissions

Implemented so far:

- centralized permission assessment
- low, medium, and high risk classification
- minimum-permission policy with mandatory secret-access denial
- approval escalation for state-changing and external-system access
- prompt-injection scanning for untrusted content
- `aiskills security`
- executable-plugin installation review with explicit permission denial
- dangerous-operation approval boundary

## Complete: Phase 12 — Goals, memory, and learning

Implemented so far:

- project goals with priorities and milestones
- goal relevance checks for requested work
- local `.ai/goals.json` persistence
- candidate learnings with evidence-count promotion
- `aiskills goals` and `aiskills goal add/check`
- decision-log persistence and inspection
- categorized project memory records
- retrospective capture after substantial tasks

## Complete: Phase 13 — Tool discovery and workflows

Implemented so far:

- declarative workflow manifests
- workflow dependency resolution
- built-in feature-development and security-review workflows
- declarative tool manifests for Git and pnpm
- `aiskills workflows`
- `aiskills tools`
- installed-tool detection and capability recommendations
- permission-aware workflow execution boundary

## Complete: Phase 14 — SDK and third-party packages

Implemented so far:

- `defineSkill`
- `defineWorkflow`
- `defineAdapter`
- `defineTool`
- `definePack`
- shared ID, version, risk, and duplicate normalization checks
- local declarative package loading with package and manifest validation
- executable-plugin separation and permission review

## Complete: Phase 15 — Registry readiness foundation

Implemented:

- versioned `aiskills.lock` model
- deterministic skill and pack version recording
- package source abstraction for built-in, npm, and Git sources
- permission recording in lock entries
- local-only implementation with no hosted registry dependency

## In progress: Phase 16 — Skill catalog and release preparation

Implemented:

- complete initial catalog of 38 declarative skills
- expanded core, fullstack, product, research, and security packs
- publish metadata for all workspace packages
- README with local usage, package layout, and npm release steps
- packed tarball verification for dependency rewriting and skill inclusion

Remaining external action:

- authenticate an npm account with access to the `@aiskills` scope and publish
  the packages in dependency order

## Release sequence

| Phase | Focus | Main proof |
| --- | --- | --- |
| 0–15 | Platform foundation | implementation and verification complete |
| 16 | Skill catalog and release preparation | manifests load, tarballs are valid, npm auth remains external |

## MVP release gate

Do not pursue a hosted registry or large skill catalog until this local loop is
working:

```text
install → init → detect agents → choose packs → inspect project
→ verify claim → plan → execute → test → report evidence
```

