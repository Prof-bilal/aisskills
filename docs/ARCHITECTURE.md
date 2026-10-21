# AI Skills Platform Architecture

## Guiding boundary

The platform is a local-first runtime and package system for AI-agent skills.
The core owns policy, context, routing, evidence, and verification. External
agents and local tools are integrations selected through explicit adapters.

The initial architecture is intentionally smaller than the long-term product:
it establishes stable contracts before adding a registry, plugins, or complex
orchestration.

## Workspace layout

```text
ai-skills/
├── package.json
├── pnpm-workspace.yaml
├── tsconfig.json
├── packages/
│   ├── core/       # domain types and provider-neutral runtime logic
│   ├── cli/        # aiskills executable and user-facing commands
│   └── sdk/        # public declarative extension definitions
├── skills/         # built-in declarative skill packages
├── packs/          # built-in pack manifests
├── workflows/      # built-in workflow definitions
├── tests/          # cross-package acceptance tests
└── docs/
```

Future adapter and tool packages can be added under `packages/` without making
the core depend on a specific AI provider.

## Dependency direction

```text
CLI ───────► Core
SDK ────────► Core domain contracts
Adapters ───► Core adapter contracts
Skills ─────► Core manifest contracts
Packs ──────► Skill IDs and pack contracts
Workflows ──► Skill IDs and workflow contracts
```

Core must not import CLI code, provider SDKs, or a concrete shell command.

## Initial runtime flow

```text
CLI input
  ↓
configuration resolution
  ↓
project context detection
  ↓
claim/task analysis
  ↓
skill and workflow routing
  ↓
agent adapter selection
  ↓
execution with permissions
  ↓
verification and evidence report
```

## Initial contracts

The first code phase should establish these contracts:

- `SkillManifest`: ID, schema version, metadata, capabilities, dependencies,
  permissions, and checks
- `SkillRegistry`: load, validate, list, and resolve skills
- `AgentAdapter`: detect, report version/capabilities, and execute a task
- `ProjectContext`: observed files, detected tools, inferred stack, and
  confidence/evidence
- `Claim` and `EvidenceRecord`: a claim state plus traceable supporting or
  contradicting evidence
- `Config`: global, profile, project, and task-level configuration with fixed
  precedence
- `ExecutionResult`: status, evidence, diagnostics, and requested follow-up

These are contracts, not permission to implement every feature immediately.

## Configuration precedence

```text
system safety policy
  ↓
global configuration
  ↓
active profile
  ↓
project configuration
  ↓
task-specific options
```

Lower levels may narrow or customize behavior but may not disable mandatory
system safety policy.

## Storage strategy

- User configuration and profiles live in an OS-appropriate application-data
  directory.
- Project configuration lives in `.ai/` inside the repository.
- Skill and pack installation state will use a lock file when installation is
  implemented.
- No absolute path, username, or provider-specific location is part of the
  source code.

## Security boundary

Declarative skills are data plus instructions and are lower risk. Executable
plugins are a separate, higher-risk class and must declare permissions before
they can be installed or run. Repository files, websites, and tool output are
untrusted data and cannot override system policy or user intent.

## Phase 1 implementation boundary

Phase 1 should create the workspace, package metadata, a runnable CLI, a small
core package, SDK foundation types, configuration-path helpers, logging, and
tests. It should not yet implement agent execution, marketplace behavior,
third-party plugins, or full orchestration.

