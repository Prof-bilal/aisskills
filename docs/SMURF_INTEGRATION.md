# Smurf integration audit

AI Skills is the control plane; Smurf is an optional internal execution engine.
The integration source is https://github.com/HusnainMaroof/smurf, cloned under
`.integration/smurf` for comparison. No source is vendored into published packages.

## Reality check before implementation

AI Skills has four packages: CLI, core, local adapters and SDK. Core already owns
manifest registries, skill routing, evidence records, goals, permissions, memory,
project inspection, declarative workflows and a dependency graph executor. The CLI
currently invokes local agents directly. There is no MCP server in this baseline.
Smurf has a dependency-free TypeScript engine, graph workflows, CLI/API/mock and
OpenHands adapters, worktree management, evidence verification, model ranking,
quota/cooldown tracking, lessons, persistent run state and independent review.
Its source imports `.ts` directly and needs Node >=23.6; AI Skills supports Node 20.
Its defaults depend on an `agents/config` and markdown vault layout. The vault is
plain files: Obsidian is not a runtime dependency.

## Local use and publication

The user explicitly authorized cloning and using Smurf. Local integration and
execution proceed under that authorization; publication is a separate action.

No LICENSE, COPYING, NOTICE, or package license field was found in the cloned
source. A public repository is not a redistribution grant. Public redistribution
of Smurf source is **BLOCKED pending permission/license resolution**. Development
uses dynamic imports from an explicitly host-configured checkout. The integration
clone is excluded from Git and package file allowlists. No publication is authorized.
This prevents a fully self-contained npm distribution today.

## Capability matrix

| Capability | AI Skills baseline | Smurf | Decision |
|---|---|---|---|
| Skills, packs, profiles | Implemented | Claude skill setup | KEEP AI-SKILLS |
| Goals, user intent | Implemented | Senior planning | KEEP AI-SKILLS |
| Evidence for user claims | Typed records | Agent evidence only | KEEP AI-SKILLS |
| Task decomposition | Static plan | Senior and preset tasks | ADAPT |
| Dependency scheduling | Generic graph | Conflict-aware lanes | REUSE |
| Worktree isolation | Absent | Task and integration branches | REUSE |
| Providers | Four CLI adapters | CLI/API/OpenHands/mock | ADAPT |
| Verification | Report aggregation | Commands, scope, metrics | ADAPT |
| Independent review | Skill only | Separate model, review gate | REUSE |
| Retry/reassignment | CLI retry | Workflow decisions and cooldown | REUSE |
| Result integration | Absent | Task merges, owner merge checks | REUSE |
| Memory | JSON project records | Markdown vault and lessons | ADAPT |
| Learned ranking | Absent | Weighted benchmark/history | OPTIONAL |
| Graphify, CodeAtlas | Absent | Graphify optional | OPTIONAL |
| OpenHands | Absent | Python/ACP bridge | OPTIONAL |
| Legacy setup/UI/CLI | AI Skills CLI | Standalone commands | DROP from user flow |
| MCP | Absent | Separate legacy services | REPLACE with AI Skills MCP |

## Reuse boundary

Wrap `Engine.startWith` with AI Skills-owned preset steps and scoped context;
retain Smurf's scheduler, workspace, verification, review and decision nodes.
Do not duplicate these in a new package hierarchy. Keep native execution in core.
Smurf's `ship` merge code runs shell checks and expects its own config; final
integration verification must remain explicit and must not silently merge the
user's active checkout. Accepted output is an inspectable integration branch.

## Security constraints

A Git worktree is not a process sandbox. Existing Smurf CLI adapters can run shell
commands, API adapters write files, and checks execute repository code. Permission
strings and prompt instructions alone cannot enforce filesystem/network isolation.
The mock bridge remains available for trusted development fixtures. API providers
now have no direct tools: AI Skills validates exact-file edits and runs checks
under Linux bubblewrap. CLI/OpenHands worker execution remains disabled pending
a corresponding process boundary. Unknown permissions, unverified causal premises, unsafe paths and
unapproved check commands must fail before engine execution. MCP clients cannot
choose the engine checkout, provider config, policy grants or shell allowlist.

## Baselines

Recorded before adapting behavior. See follow-up validation section for exact
revision, suite outcomes and integration proof limitations.

## Recorded baseline and implemented slice

Upstream commit: `1d1e3609b8fd5cc9c3dbe3d2112dccaef415a092`.
Node: 24.22.1. Unchanged upstream `npm test`: **9 scripts passed, 0 failed**
(e2e, parallel, pick, guards, setup, graph, lessons, verify, adapters). These are
script-level outcomes, not a fabricated assertion/test count. Upstream
`npm run typecheck` passed. AI Skills baseline: **39 tests passed, 0 failed**.
The upstream clone and tests remain unchanged and excluded from publication.

The implementation adds core contracts and routing, native execution, a
programmatic external-checkout bridge, eight MCP tools, shared CLI runtime and
normalized results. No new workspace package layers or copied upstream modules
were needed. The MCP SDK is the only new direct dependency; it brings its normal
transitive JavaScript dependencies, including unused HTTP transport support.
No Python, Docker, Graphify, OpenHands or desktop dependencies were added.

Integration exposed two existing built-in skill dependency cycles:
`security-reviewer ↔ threat-model` and `input-validation ↔ api-security`.
Threat modeling now depends on evidence-first rather than its consumer; input
validation no longer depends on the API specialization. All skill dependency
closures are tested, and cycle rejection remains intact.

## Proof scope and remaining work

1. Validated HTTP endpoint fixture: MCP client → core → Smurf's real engine →
   deterministic worker in a Git worktree → different mock model review → immutable
   request/response checks → integration branch → combined checks. Owner checkout
   stays unchanged. This proves orchestration plumbing, not model coding quality.
2. Incorrect MongoDB premise: execution blocks before workers. The client supplies
   the corrected controller-validation brief and the right file changes. Automatic
   causal diagnosis/correction is not implemented; a trusted verifier hook exists.
3. Parallel fixture: backend/frontend tasks have distinct worktrees and run together;
   a third task depends on both. Scope evidence and combined checks are verified.
   These are deterministic fixture modules, not a real login/register/reset feature.
4. Injection fixture: repository instructions attempting secret access are logged
   as untrusted; deterministic workers only edit approved files. This does not
   certify arbitrary CLI-provider secret isolation. The later API boundary is
   covered separately below.

Additional tests cover absent permissions, unsafe scopes/checks/cycles, malformed
MCP input, unverified native claims, failing worker checks and real MCP stdio
handshake. When the external clone is absent, upstream-dependent tests explicitly
skip; the normal package never downloads it. Use `pnpm test` with the checkout
present to run the development proofs.

**Production integration remains incomplete.** Blockers include licensing,
CLI-provider sandboxing, automatic decomposition/causal diagnosis, durable
resume/application, AI Skills memory translation and actual provider validation.
Optional benchmark, CodeAtlas, Graphify and OpenHands adapters are not claimed as
implemented. No source was published, pushed or silently relicensed.

## First-slice validation

`pnpm test`: **50 passed, 0 failed, 0 skipped**, including the 11 new orchestration
and MCP tests. Build/typecheck passed for every workspace package. Package dry-runs
for core and CLI confirmed the external checkout, node_modules and upstream engine
source are absent. `git diff --check` passed. Upstream Git status remained clean.
The deterministic development proof works locally; this is not a production release
or a completed migration of every Smurf capability.


## API execution follow-up

Local use authorization is recorded above. The bridge now also accepts explicit
OpenAI-compatible providers through trusted host configuration. It reuses Smurf's
API transport, discovery, routing, review, retry and budget accounting. AI Skills
disables the upstream adapter's direct writes and applies file blocks through
exact-scope, traversal and symlink checks. Rejected writes fail the attempt.
Input/output prices must be configured for metered models; observed token counts
provide a cost estimate when the provider omits a cost field.

Both task and combined-branch checks run through a bubblewrap launcher: private
process/network namespaces, read-only workspace/system runtime, hidden Git metadata,
no inherited environment, absent host home/files and private scratch space. The
current Node binary is explicitly mounted so nvm and bundled installations work.
This optional API mode requires Linux bubblewrap and Node 24. It never falls back
to host checks when isolation is unavailable. CLI/OpenHands remain disabled.

New tests exercise the upstream API protocol with a local HTTP server, independent
review identities, authentication header handling without prompt credential leakage,
rejected host-secret writes, missing network grants and real sandbox subprocesses.
These are protocol and isolation tests, not a claim that a live external model has
been exercised. Checks requiring untracked dependencies, writable build directories
or network access are not yet supported by this isolation profile.

API follow-up validation: **55 tests passed, 0 failed, 0 skipped** with the local
checkout and bubblewrap available. All nine unchanged upstream test scripts and
upstream typecheck passed again. Core/CLI package dry-runs include the AI Skills
sandbox/edit helpers and exclude the source checkout. The bubblewrap launcher
receives a minimal environment before namespace creation; the sandbox test also
checks visible process environments for the dummy credential sentinel.
