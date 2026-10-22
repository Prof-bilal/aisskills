# Orchestration

`CoreRuntime` in `packages/core/src/orchestration.ts` owns project inspection,
planning, skill dependency resolution, premise checks, goal relevance, engine
routing and normalized execution. Both `aiskills run` and MCP `execute_task`
call it. The existing generic `executeTaskGraph` API remains available.

A skill describes expertise, a workflow describes process, an agent performs
work, and an orchestration engine schedules execution. Smurf is an engine.
`OrchestrationEngine` defines detection, capabilities, suitability and execution;
`ExecutionPlan`, `ExecutionContext` and `ExecutionResult` are AI Skills contracts.
Upstream types stay private to `smurf.ts`.

Routing uses explicit step count, security sensitivity and parallel/full-stack
signals. Small tasks use native; complex tasks request Smurf. Explicit mode can
choose an engine, but cannot override its permissions or suitability checks.
Unavailable Smurf does not silently fall back to unsafe native writes. Current
routing is a conservative heuristic, not a learned performance/cost estimator.

Native execution currently handles one read-only task and passes selected skill
manifests into its prompt. Worker output alone never establishes completion.
Smurf development execution consumes explicit scoped steps through
`Engine.startWith`, using the existing tasks workflow, conflict-aware lanes,
worktrees, model routing, independent review, evidence checks and retry decisions.
Selected skill manifests, project facts, task brief and acceptance criteria enter
worker context. Graphify is removed from the workflow. OpenHands and CLI workers
are disabled. Host-configured API models reuse Smurf's transport and discovery;
AI Skills applies their validated exact-file edits. Verification commands and
combined-branch checks use Linux bubblewrap in API mode. Mock execution retains
the original trusted-fixture behavior.

The bridge reads checked-in Smurf defaults directly, avoiding environment/local
provider overrides. Each run gets separate state outside the target repository.
Only exact host-approved checks execute. It requires a clean committed Git
repository. Dependencies are validated for missing IDs and cycles. File scopes
reject traversal, metadata paths and escaping symlinks. Preset mock edits must
match exact allowed files; mock stray writes are disabled.

Accepted tasks merge into Smurf's integration branch, never the user's checkout.
The bridge checks the combined branch in a temporary detached worktree and removes
that checkout afterward. `COMPLETE` requires all tasks accepted, nonempty passing
checks, clean scope, a different reviewer with an acceptable score and no severe
findings, and passing combined checks. It means verified output exists on the
returned branch; applying it to the user's branch is still an explicit operation.
Waiting/failed runs retain upstream state for diagnosis; no resume/apply MCP tool
is implemented yet. The upstream clone remains intact for behavior comparison.

`ContextProvider` defaults to built-in project inspection. External CodeAtlas,
Graphify, memory backend translation, CLI-provider sandboxing, automatic model
planning, durable resume/cancel and benchmark commands remain migration work.
There is no added desktop, Docker, model, Python or Obsidian requirement.
