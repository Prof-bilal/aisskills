# AI Skills Platform — Development Phases

This document defines the implementation order for the local-first AI Skills
Platform. The phases are deliberately incremental: each phase should produce a
usable, testable result before the next one begins.

## Product outcome

The platform will eventually let a developer install one CLI, connect the AI
agents already installed on their machine, choose skill packs, run workflows,
and receive evidence-backed verification instead of an unsupported “done”.

## Phase 0 — Repository and architecture audit

Goal: understand the repository before committing to an architecture.

Deliverables:

- repository inventory
- package and runtime decision
- CLI and package layout decision
- documented risks and open questions
- initial acceptance tests

Exit criteria:

- the implementation stack is chosen with reasons
- the smallest viable architecture is documented
- no major package or runtime assumption is unverified

## Phase 1 — Installable package foundation

Goal: create a minimal package that can be installed and invoked locally.

Deliverables:

- package metadata
- `aiskills` executable
- `aiskills --help`
- configuration directory handling without hardcoded user paths
- structured logging and error handling
- basic test setup

Exit criteria:

- clean install succeeds in a temporary directory
- the CLI runs on the development platform
- invalid configuration produces a useful error

## Phase 2 — Skill manifests and registry

Goal: load and validate reusable declarative skills.

Deliverables:

- versioned skill manifest schema
- manifest validation
- built-in skill registry
- duplicate ID and circular dependency detection
- `aiskills skills list`
- first foundational skills: repo explorer, planner, evidence-first, and
  completion checker

Exit criteria:

- valid skills load
- invalid skills are rejected with actionable diagnostics
- dependencies resolve deterministically

## Phase 3 — Agent detection and adapters

Goal: detect installed coding agents and represent them behind one interface.

Deliverables:

- agent adapter interface
- local executable detection
- version detection
- capability reporting
- `aiskills agents`
- only adapters that are actually testable on the target machine

Exit criteria:

- installed and missing agents are distinguished correctly
- core routing code has no provider-specific execution logic

## Phase 4 — Interactive initialization and profiles

Goal: let a new user configure the system without writing YAML manually.

Deliverables:

- `aiskills init`
- agent selection
- skill-pack selection
- execution mode selection
- profile persistence
- `aiskills profile create` and `aiskills profile use`

Exit criteria:

- a fresh user can complete setup
- configuration can be read back and changed safely
- explicit project settings have defined precedence

## Phase 5 — Project context

Goal: inspect the current repository and build a trustworthy project context.

Deliverables:

- language and framework detection
- package manager and test-runner detection
- repository and monorepo detection
- confidence and evidence attached to inferred facts
- project-local `.ai/` configuration support
- `aiskills init --project`

Exit criteria:

- detection reports what was observed versus inferred
- existing files are not overwritten unexpectedly

## Phase 6 — Evidence and claims

Goal: make evidence-first reasoning a system behavior rather than a prompt.

Deliverables:

- claim states: `VERIFIED`, `SUPPORTED`, `LIKELY`, `UNVERIFIED`,
  `CONTRADICTED`, and `UNKNOWN`
- evidence records with source and confidence
- repository, test, runtime, and user-statement evidence levels
- claim verification hooks
- explicit uncertainty in reports

Exit criteria:

- user claims are not treated as facts automatically
- contradictory repository evidence is surfaced
- the system never reports unperformed verification as complete

## Phase 7 — Planning and skill routing

Goal: select the minimum effective skills and workflow for a task.

Deliverables:

- task classification
- structured plans separating facts, assumptions, and claims to verify
- skill routing by capability and project context
- basic workflow selection
- `aiskills plan`

Exit criteria:

- unrelated skills are not activated by default
- routing decisions are explainable

## Phase 8 — Execution and orchestration

Goal: execute planned work through selected agents safely.

Deliverables:

- agent task/result normalization
- timeouts and bounded retries
- read-only and write permissions
- task dependency handling
- safe parallelism for isolated work
- conflict and failure reporting
- `aiskills run`

Exit criteria:

- one end-to-end task can inspect, plan, execute, and return a structured result
- agents cannot silently exceed declared permissions

## Phase 9 — Verification and completion reporting

Goal: verify work proportionally and report its actual state.

Deliverables:

- static checks
- test execution
- requirements checks
- security review hooks
- adversarial review hooks
- completion states: `COMPLETE`, `PARTIALLY VERIFIED`, `IMPLEMENTED BUT
  UNVERIFIED`, `BLOCKED`, `FAILED`, and `NEEDS USER ACTION`
- `aiskills verify`

Exit criteria:

- completion reports include evidence
- failed or unavailable checks are visible
- “done” is never used as a substitute for verification

## Phase 10 — Skill packs

Goal: make useful collections of skills easy to install.

Initial packs:

- `core`
- `fullstack`
- `security`
- `research`
- `product`

Deliverables:

- pack manifest schema
- dependency resolution through skill IDs
- `aiskills packs install`
- lock-file concept for reproducibility

Exit criteria:

- packs do not duplicate skill definitions
- installed versions and dependencies are inspectable

## Phase 11 — Security and permissions

Goal: make extensions and execution boundaries explicit.

Deliverables:

- permission declarations
- minimum-permission policy
- risk classification
- installation review for third-party packages
- prompt-injection defenses for repository and external content
- approval gates for high-risk operations

Exit criteria:

- executable extensions are clearly distinguished from declarative skills
- requested permissions cannot be hidden
- untrusted content cannot override user or system policy

## Phase 12 — Goals, memory, and learning

Goal: preserve useful project context without treating every observation as fact.

Deliverables:

- project goals and milestones
- goal relevance checks
- decision log
- project memory categories
- candidate learnings with evidence counts
- retrospectives after substantial tasks

Exit criteria:

- discretionary work can be compared with active goals
- temporary observations are not silently promoted to permanent rules

## Phase 13 — Tool discovery and workflows

Goal: coordinate skills, agents, and approved local tools.

Deliverables:

- workflow schema and dependency graph
- tool registry and capability matching
- installed-tool detection
- permission-aware tool recommendations
- workflow commands

Exit criteria:

- tools are installed only with user approval when required
- workflows are reproducible and explain their sequence

## Phase 14 — SDK and third-party packages

Goal: enable safe ecosystem extensions after the local runtime is proven.

Deliverables:

- `defineSkill`
- `defineWorkflow`
- `defineAdapter`
- `defineTool`
- `definePack`
- npm-compatible package loading
- schema and permission validation for external packages

Exit criteria:

- extension authors receive clear validation errors
- updates surface permission changes before installation

## Phase 15 — Public registry readiness

Goal: prepare for a registry without making it an MVP dependency.

Potential future work:

- package checksums and lock files
- publisher identity and provenance
- signed packages
- verified publishers
- registry search and metadata
- compatibility and security scanning

This phase must not begin until local installation, routing, execution, and
verification are working reliably.

## MVP boundary

The first usable release ends after Phase 9, with a small number of built-in
skills and tested local agent adapters. Phase 10 may follow immediately if the
core loop is stable.

The MVP must prove:

```text
install → init → detect agents → choose packs → detect project
→ verify a claim → plan → execute → test → report evidence
```

The hosted marketplace, accounts, payments, ratings, cloud synchronization,
analytics backend, and large skill catalog are explicitly outside the MVP.

## Current status

- Phase 0: complete — repository, environment, architecture, risks, and Phase 1 acceptance criteria documented.
- Phase 1: complete — workspace, packages, CLI foundation, configuration paths, SDK validation, tests, and clean local package installation verified.
- Phase 2: complete — versioned YAML skill manifests, validation, registry loading, dependency resolution, built-in skills, and `aiskills skills list` verified.
- Phase 3: complete — provider-neutral adapter contract, local executable discovery, version probing, capabilities, and `aiskills agents` verified.
- Phase 4: complete — profile persistence, agent/pack/mode selection, `aiskills init`, `profile create`, and `profile use` verified.
- Phase 5: complete — project file, language, framework, package manager, test runner, database, and monorepo detection with evidence/status labels verified.
- Phase 6: complete — claim states, typed evidence records, evidence priority, contradiction handling, and `aiskills verify` verified.
- Phase 7: complete — task analysis, workflow selection, minimum-effective skill routing, structured plans, and `aiskills plan` verified.
- Phase 8: complete — permission-aware normalized execution results, dependency-aware task graphs, bounded parallelism, retries, verified provider argument contracts, and a real read-only Codex adapter task verified.
- Phase 9: complete — verification reports, completion states, bounded static/test execution, repository security scanning, explicit requirements criteria, and skipped-check reporting verified.
- Phase 10: complete — pack manifests, pack registry, dependency resolution, five built-in packs, and `aiskills packs list/install/remove` verified.
- Phase 11: complete — centralized permission assessment, risk levels, mandatory denials, approval escalation, prompt-injection scanning, and executable-plugin installation review verified.
- Phase 12: complete — goals, milestone relevance, project goal persistence, decision records, categorized memory, candidate learning promotion, and retrospective capture verified.
- Phase 13: complete — workflow registry, dependency validation, tool manifests, installed-tool detection, capability recommendations, and permission-aware workflow execution boundary verified.
- Phase 14: complete — validated SDK constructors and safe declarative third-party skill-package loading verified; executable plugins remain on the separately reviewed path.
- Phase 15: complete — local lockfile generation/loading and package-source abstraction implemented without adding a hosted registry.
