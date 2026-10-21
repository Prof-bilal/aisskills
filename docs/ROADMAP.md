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

## Next sequence

| Phase | Focus | Main proof |
| --- | --- | --- |
| 2 | Skill manifests and registry | invalid manifests fail clearly |
| 3 | Agent adapters | installed agents are detected and represented safely |
| 4 | Init and profiles | a new user can configure agents and packs interactively |
| 5 | Project context | repository facts include evidence and confidence |
| 6 | Evidence engine | claims become verified, contradicted, or unknown based on checks |
| 7 | Planner and router | only relevant skills are selected |
| 8 | Execution | one task runs through a permission-aware adapter |
| 9 | Verification | results include tests, evidence, and a real completion state |
| 10 | Packs | users install small collections without duplicated definitions |
| 11 | Security | permissions, risk, and prompt-injection handling are enforced |
| 12 | Goals and memory | work aligns with goals and records durable context carefully |
| 13 | Workflows and tools | multi-step work is coordinated and reproducible |
| 14 | SDK packages | external declarative extensions can be validated safely |
| 15 | Registry readiness | provenance and future registry integration have a clean boundary |

## MVP release gate

Do not pursue a hosted registry or large skill catalog until this local loop is
working:

```text
install → init → detect agents → choose packs → inspect project
→ verify claim → plan → execute → test → report evidence
```

