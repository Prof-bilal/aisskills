# Capability routing launch gates

The launch objective covers user-installed skills, tools and plugins; automatic
task selection across Codex and Claude Code; Warden enforcement; preference
memory; and reproducible release artifacts. Passing a subset is not launch approval.

## Verified implementation

- Local and GitHub imports accept native YAML and Agent Skills Markdown.
- Quarantine snapshots reject links and special files and bound package sizes.
- Git imports record exact commits; snapshots are checked before use.
- User catalogs require project enablement and approval before routing.
- Update revokes approvals/activations; history and rollback preserve recovery.
- Project lockfiles contain package digests and source commits.
- MCP discovery returns compact matches; instruction loading is separate and bounded.
- Warden command API uses digest-pinned host policy and has no direct fallback.
- `runtime.json` declarations support local commands and local/remote MCP.
- Separate execution preparation records policy and tool-rule approval hashes.
- Live Linux Warden tests verify host-file denial, immutable package mounts,
  credential filtering, MCP handshake and rejection of an unapproved tool.
- Session command generates temporary Codex/Claude MCP configuration and selected
  instructions with cleanup on exit and spawn failure. A live Codex config test
  verifies only the AI Skills session server is enabled.
- Routing applies token matching, project provider evidence, compatibility,
  dependency closure, negative triggers, explicit pins and an estimated budget.
- Bounded local telemetry omits raw task text. The deterministic 25-task routing
  corpus passes with precision/recall 1.0 and ~87.5% estimated context reduction
  relative to all eight fixture skills loaded. This is a regression corpus, not
  evidence of real model success or billed savings.
- Doctor validates configuration, registry dependencies, installed integrity,
  agent executables and Warden readiness, with explicit warnings for gaps.
- All four public package tarballs passed file-content verification and a clean
  npm installation, SQLite skill import, activation/lockfile, routing and real
  MCP discovery/loading smoke test on Linux with Node 24.22.1.
- Codex v0.163.0 completed an authenticated read-only session smoke request
  with READY and no tool calls (reported 1,511 tokens). Existing host hook-config
  warnings remain visible. This is startup evidence, not a task-quality benchmark.
- Claude completed the same minimal authenticated session request with READY
  after retrying the initial DNS failure outside the outer network sandbox.
- Reference acquisition validates DNS and redirects, pins public IPv4 connections,
  enforces HTTPS and response limits, and stores extraction artifacts in SQLite.
  A real example.com fetch stored Example Domain with acquired status and hash.
- Task sessions read bounded, relevant, confirmed explicit-user preferences;
  inferred design observations remain candidates and cannot grant permissions.
- Explicit plugin bundles combine nested skills, independently approved runtimes,
  and Warden-backed before/after-session hooks. Validation rejects path escapes,
  invalid hook events and missing runtime approvals.
- Live Codex feature inspection confirms native plugins, remote plugins and hooks
  disabled alongside MCP overrides. A live Claude inventory comparison confirms
  temporary disabled-plugin settings remove user plugin activation.
- Native Claude/Codex/root plugin layouts adapt nested skills and MCP declarations.
  Host preparation requires executable paths and named MCP allowlists. Unsupported
  native hooks/commands/agents fail import instead of silently losing behavior.
- A live dry-run imported the official `frontend-design` plugin version 1.1.1 at
  `anthropics/claude-plugins-official` commit
  `fa4eb54397ee2faccb6940512a19c017cb1337f3` without executing plugin code.
- CI is configured for Linux Node 20/22/24, routing regression checks and clean
  packed-install smoke tests. These matrix jobs still need remote run evidence.
- Browser capture runs Playwright/Chromium inside Warden with no direct networking.
  A validated public-HTTPS broker fulfills approved GET requests. A live fixture
  verified JavaScript rendering, accessibility extraction and PNG evidence; a real
  example.com capture succeeded and its screenshot was visually inspected.
  Linux verification required a 2 GiB process budget; inner Chromium sandboxing
  is disabled within mandatory Warden isolation. Browser startup fails closed.
- Independent browser-driver review findings about response draining, aggregate
  transfer limits and cancellation were fixed, with controlled-stream and
  forced-termination regression tests. Compact reference inspection and explicit,
  integrity-verified screenshot loading avoid unconditional image context.
- Activation changes use durable pending-sync markers and revision checks.
  Active packages verify project lock content and runtime policy/rule hashes.
  Recovery reports do not delete state; reset backs up an invalid lockfile.
  Tests cover conflicting imports on separate SQLite connections, broken/tampered
  locks and explicit recovery. SIGKILL import-phase tests are part of the suite.
- Task sessions expose four compact MCP tools. Matching executable schemas load
  on demand; calls open a Warden gateway and recheck activation, agent compatibility,
  snapshot integrity and policy hashes. Connections close after each request.
  Cancellation stops further discovery and aborts in-flight MCP requests.
- The published Warden `0.2.0-beta.4` Linux amd64 binary was downloaded using its
  npm wrapper's checksum-verifying runtime into a temporary directory. All four
  capability tests, both lazy broker tests and all three browser tests passed
  against this artifact. No checkout-built binary is required for this evidence.
- The full suite passed with all optional live checks enabled: 104 tests passed,
  zero failed and zero skipped. The final annotation/approval changes also passed
  all nine affected broker/plugin/session checks. Normal subprocess
  access is required; the outer Codex filesystem sandbox closes the stdio fixture.
- Writable sessions are explicit: `--write` uses Codex workspace-write or Claude
  default permission prompts. Warden grants and installed-package approvals stay
  independently enforced.
- Independent gateway review identified missing session execution ceilings,
  cancellation during approval checks and unbounded agent termination. Read-only
  sessions now explicitly deny MCP execution and hooks even if the host config
  has broader grants; cancellation is rechecked before subprocess startup;
  Linux session shutdown escalates after one second and terminates descendants.
  Regression checks cover these boundaries.
- Authenticated Codex and Claude sessions began with zero selected packages,
  called metadata discovery followed by on-demand instruction loading, and returned
  the fixture marker `NEBULA_LAZY_OK`. Codex reported 6,823 tokens for this small
  task; this is an observed usage count, not a savings measurement. Read-only tool
  annotations and Codex's `writes` approval mode allow metadata tools while keeping
  executable tool calls subject to native approval. Claude plan mode passed after
  the prompt explicitly distinguished metadata discovery from executable startup.
- Session MCP configuration pins catalog/project runtime paths and explicitly
  forwards reviewed environment variable names. Credential values are never
  serialized into the temporary agent configuration.
- Workspace/public packages are versioned `0.2.0-beta.1`; both `aiskills` and
  `aiskill` CLI names are included. Publishing chooses the beta tag for prereleases.
  All four beta archives passed inspection and clean-install SQLite/MCP smoke tests.
  All four packages are now published publicly on npm at the `beta` tag, and a
  clean install of `@prof-bilal/aiskills@0.2.0-beta.1` passed the CLI version check.
- Runtime dependency audit reported zero vulnerabilities after upgrading the
  compatible transitive `body-parser` resolution to 2.4.0, which addresses
  [GHSA-27r3-jxmh-p828](https://github.com/expressjs/body-parser/security/advisories/GHSA-27r3-jxmh-p828).

Automated evidence lives in `tests/packages.test.mjs` and the existing runtime,
MCP, security and orchestration suites. A live GitHub dry-run imported
`anthropics/skills`, subdirectory `skills/frontend-design`, at commit
`ca45fc496a3436251f191354091d557da31c15b5` on 2026-11-05. This verifies fetching,
ref resolution, parsing and classification, not the content's safety or effectiveness.

## Remaining launch gates

- Expand explicit mappings for native agent/command/hook layouts beyond the
  currently supported nested-skill and MCP adapters.
- Govern remote MCP through tool allowlists and independent remote trust review.
- Complete native skill discovery suppression and administrator-policy visibility
  in the session adapters; extend startup smoke tests to real task scenarios.
- Measure model task success, tokenizer/billing counts, tool-result volume and
  native discovery baselines in addition to deterministic routing telemetry.
- Validate browser capture across larger public SPA references, remote asset-host
  approval flows and supported OS/runtime combinations; current browser evidence
  covers Linux, a JS fixture and one public page.
- Extend concurrency/recovery checks to multi-project policy updates and interrupted
  session/application handoffs in addition to current catalog/lock/import tests.
- Extend recovery diagnostics for client plugin policies and persisted session interruptions.
- Verify supported OS and Node runtime combinations before claiming compatibility.
- Review security, licenses, versioning and publication metadata before release.

## Security limits

Text scanning is heuristic. Approval and hashes do not prove a package safe.
Local sandboxing cannot isolate a server running on someone else's host.
Execution uses separately approved runtime declarations. Permanent agent settings must not be
changed as a side effect of package import or discovery.
