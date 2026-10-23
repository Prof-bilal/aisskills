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
│   ├── sdk/        # public declarative extension definitions
│   └── adapters/
│       └── local/  # local executable discovery and adapter contracts
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
CLI ───────► Adapters
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
  directory as versioned JSON.
- Project configuration lives in `.ai/config.json` inside the repository.
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

Phase 1 created the workspace, package metadata, runnable CLI, core package, SDK
foundation, configuration-path helpers, logging, and tests. Phase 2 added the
skill registry. Phase 3 added local agent detection and adapter contracts.
Agent task execution remains intentionally deferred until Phase 8.


## MCP-first orchestration integration

The CLI package now hosts the MCP stdio server (`aiskills mcp`). It and manual
`aiskills run` use `CoreRuntime` in core, which retains AI Skills ownership of
project facts, evidence, goals, skills and policy. Two implementations share the
AI Skills `OrchestrationEngine` contract: native read-only execution and a
programmatic Smurf bridge with deterministic and OpenAI-compatible API workers. The latter dynamically loads an explicit
external checkout; no unlicensed upstream source is bundled. See
[the orchestration contract](ORCHESTRATION.md), [MCP tools](MCP.md),
[security boundaries](SECURITY.md) and [integration audit](SMURF_INTEGRATION.md).

Flow: MCP/CLI → CoreRuntime → project/premise/goal/skill checks → execution plan →
engine selection → native or Smurf → execution evidence → review → structured
result. Smurf retains its graph scheduler and task worktrees internally. Optional
context providers can replace built-in inspection. Heavy tools are not required.
