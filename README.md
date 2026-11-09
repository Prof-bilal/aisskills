# AI Skills

AI Skills is a local-first runtime for reusable AI-agent skills, skill packs,
project context, evidence-backed verification, permissions, and agent adapters.
It is designed to work with coding agents already installed on your machine.

## Status

`0.2.0-beta.2` is publicly available on npm under the `beta` channel. The
packages are built, tested, audited, and verified through a clean install of
the published CLI.

## The theory

AI agents should not receive every installed skill, plugin, or MCP tool at the
start of every task. Large always-on catalogs waste context, increase tool
selection noise, slow startup, and make unrelated integrations part of the
agent's trust surface. AI Skills treats the user's catalog as a capability
store, then selects only relevant declarative guidance and exposes executable
tools through a small discovery gateway when the task needs them.

The runtime follows this flow:

1. The user adds a local skill with `aiskills add ./path` or a GitHub source with
   `aiskills install owner/repository --path=skills/example`.
2. AI Skills snapshots and scans the source without running its code. The user
   reviews and approves it, enables it for a project, and receives a lockfile
   containing content and runtime-policy hashes.
3. A task router matches the task, project provider evidence, agent
   compatibility, dependencies, pins, and budget. Only matching instructions
   enter the initial context.
4. The session exposes compact metadata tools. `discover_capabilities` and
   `load_skill` are available immediately; `search_tools` starts only matching
   approved MCP gateways and returns tool names before schemas, and `call_capability` opens a Warden-protected
   connection only for the requested call.
5. Every executable call rechecks project activation, snapshot integrity,
   compatibility, reviewed policy hashes, and Warden enforcement. Tool schemas
   and results are bounded and treated as untrusted data.

This is progressive disclosure, not automatic permission granting. Installed
skills stay inactive until project enablement, executable runtimes require a
separate Warden review, read-only sessions cannot start executable gateways,
and a task or tool result cannot approve a package or permission. The result is
less initial context while retaining an explicit path to stronger capabilities
when the work actually requires them. See [launch readiness](docs/LAUNCH_READINESS.md)
for measured checks and known limits.

The same catalog stores bounded HTTPS reference evidence in SQLite. Design,
backend, and product references can be fetched or rendered through the guarded
browser flow, then explicit user preferences can influence future routing.
External pages and inferred observations remain untrusted candidate data and
cannot grant access.

## Requirements

- Node.js 20 or newer
- pnpm 12 or newer
- At least one supported local agent for `aiskills run`: Codex, Claude Code,
  OpenCode, or Gemini CLI

## Use from this repository

```bash
git clone https://github.com/Prof-bilal/aisskills.git
cd aisskills
pnpm install
pnpm build
pnpm test
```

Run the CLI without installing a global command:

```bash
node packages/cli/dist/index.js --help
node packages/cli/dist/index.js skills list
node packages/cli/dist/index.js packs list
```

For a convenient shell alias:

```bash
alias aiskills="node $(pwd)/packages/cli/dist/index.js"
```

Initialize the user profile and the current project:

```bash
aiskills init --project --mode=review-first
aiskills agents
aiskills doctor
```

The user configuration is stored under `~/.config/aiskills` on Linux. Set
`AI_SKILLS_HOME` to use another location. Project configuration is stored in
the project-local `.ai/config.json` file.

Project memory and saved reference metadata are stored in `.ai/aiskills.db`
using SQLite. Existing `.ai/memory.json` records are migrated on first access.
URLs are treated as untrusted data; local and private-network targets are
rejected.

## Main commands

```bash
aiskills skills list
aiskills packs list
aiskills packs install security
aiskills profile create security --packs=core,security --mode=review-first
aiskills profile use security
aiskills plan "review the authentication implementation"
aiskills verify "authentication is complete" --run-tests --run-static
aiskills run "inspect the repository architecture"
aiskills run "find security risks in this repository" --agent claude
aiskills run "explain the database design" --agent codex
aiskills security
aiskills goals
aiskills workflows
aiskills tools
aiskills memory
aiskills reference add https://example.com --type=design
aiskills reference list
aiskills preference list
```

`aiskills run` is read-only by default and requires a configured, available
agent. Pass `--agent codex`, `--agent claude`, `--agent opencode`, or
`--agent gemini` to choose the provider explicitly. `openai` and `gpt` are
aliases for Codex. During execution the CLI loads the routed skills, starts
the real local provider process, streams its live output, and then prints the
final status. State-changing operations remain subject to the permission
policy.

## MCP and orchestration

Start the MCP stdio server with `aiskills mcp` from the target repository. By
default it exposes only the four gateway tools described below. `aiskills mcp --full`
also exposes project inspection, skill recommendations, planning, execution, claim and
run verification, goal checks and agent discovery through the same core used by
`aiskills run`. Native worker output remains unverified until independently checked.

### Use with your agent directly

You do not need `aiskills session` to get on-demand tools. Register AI Skills as
the agent's MCP server, and add your other MCP servers to AI Skills instead of to
the agent (`aiskills install`, `skills prepare --yes`, `skills enable`). They then
stay stopped until a task needs them.

```bash
# Claude Code
claude mcp add aiskills -- aiskills mcp --allow-capability-execution
```

```toml
# Codex: ~/.codex/config.toml
[mcp_servers.aiskills]
command = "aiskills"
args = ["mcp", "--allow-capability-execution"]
```

Omit `--allow-capability-execution` for skills-only use; tool calls are then refused.
The four gateway tools carry `anthropic/alwaysLoad`, so Claude Code's own tool
search keeps them visible.

### Use with Claude Code daily (skills with no extra turns)

The prompt hook routes each prompt and adds only the matching skills to that
message, so the agent needs no `use_skills`/`load_skill` round trips.
Add it to `.claude/settings.json` (project) or `~/.claude/settings.json` (user):

```json
{
  "hooks": {
    "UserPromptSubmit": [{ "hooks": [{ "type": "command", "command": "aiskills hook" }] }],
    "PreToolUse": [{ "hooks": [{ "type": "command", "command": "aiskills guard" }] }]
  },
  "sandbox": {
    "enabled": true,
    "network": { "allowedDomains": [] },
    "filesystem": { "denyRead": ["~/.ssh", "~/.aws", "~/.config/gh", "~/.npmrc", ".env", ".env.*"] }
  },
  "permissions": {
    "deny": ["WebFetch", "WebSearch", "Read(~/.ssh/**)", "Read(~/.aws/**)", "Read(**/.env)", "Read(**/.env.*)",
             "Write(//tmp/**)", "Edit(//tmp/**)", "Write(~/.bashrc)", "Write(~/.ssh/**)", "Write(~/.config/**)"]
  }
}
```

The `PreToolUse` guard (`aiskills guard`, add `--allow-host=example.com` per allowed host) blocks network
commands, secret reads and writes outside the project while user-installed skills are enabled; it is a
first line of defence, not a complete shell parser. The `sandbox` and `permissions` blocks matter: user-installed skills are third-party
text, and no scanner can reliably stop text that tricks a model. The sandbox stops a
tricked agent's shell commands from reaching the network, writing outside the project or
reading secrets. It does not cover Claude Code's file tools, so the `permissions` rules
block those writes and reads. Add hosts to `allowedDomains` only for work that needs them. `aiskills doctor`
warns when user skills are enabled without the sandbox. `aiskills session` applies these
limits automatically and also runs Claude Code without shell tools.

### How AI Skills handles untrusted skills

- **Marking:** user-installed skill text reaches the agent inside an
  `<untrusted-skill>` block with a random boundary and a note that it is reference
  data, not instructions.
- **Install triage:** `add --yes` rejects high-risk patterns and holds skills with
  hidden content (HTML comments, zero-width characters, hidden styling) for review.
  This is triage, not a guarantee.
- **Action limits:** the protection that holds when a model is fooled is limiting
  what it can do: no network, no writes outside the project, no secret reads.

The Smurf bridge uses the local engine for isolated worktrees, parallel lanes,
review and combined-branch checks. It supports deterministic development workers
and host-configured OpenAI-compatible API models. API edits pass through exact
file validation, and verification runs under Linux bubblewrap. CLI-based Smurf
workers remain disabled until their process boundary is integrated. See [MCP setup](docs/MCP.md) and the
[integration audit](docs/SMURF_INTEGRATION.md) for the precise supported scope.

## User-installed skills

Acquire a saved design/backend reference and inspect its evidence:

```bash
aiskills reference add https://example.com --type=design
aiskills reference fetch <reference-id>
aiskills reference inspect <reference-id>
aiskills preference add design "Prefer warm colors and compact navigation"
aiskills preference confirm <preference-id>
```

Acquisition supports public HTTPS pages, validates every redirect and DNS answer,
pins each connection to a validated address, bounds time/response size, and stores
untrusted text, title, color/font observations, findings and a content hash in SQLite.
It does not execute JavaScript, bypass authentication or capture screenshots.
MCP acquisition additionally requires the host's `network.read` grant. Design
observations become candidate preferences for inspection; sessions include only
confirmed explicit user preferences relevant to the task. Preferences cannot
enable packages or grant permissions. Inferred observations never auto-promote.

For rendered public pages, use `aiskills reference capture <reference-id>`.
This launches an ephemeral Chromium process inside Warden with no direct network
grants. The parent HTTPS broker validates DNS, redirects, allowed hosts and request
budgets before fulfilling GET requests. JavaScript rendering and accessibility
snapshots are supported; PNG screenshots are stored as files beside the memory DB,
not injected as base64 into tool context. `--asset-hosts=cdn.example.com` explicitly
allows additional asset hosts. POST requests, WebSockets, service workers, downloads
and existing browser profiles/cookies are unavailable in this read-only capture.

Set `AI_SKILLS_CHROMIUM_BINARY` to an installed Chromium executable (Linux default:
`/usr/lib/chromium/chromium`) and `AI_SKILLS_WARDEN_BINARY` to a working Warden.
The driver uses a 45-second/2 GiB process budget. Warden is mandatory; browser
capture fails closed when isolation cannot start. The driver passes the `HOME`
environment name for Playwright initialization but does not mount the home directory.
Chromium's inner sandbox is disabled inside the required Warden boundary. This
path is verified on Linux; other platforms remain unverified.
MCP `inspect_reference` returns compact saved evidence; `view_reference_screenshot`
loads integrity-verified PNG bytes only when explicitly called. The browser
boundary, review findings and regression evidence are recorded in
[the browser security notes](docs/BROWSER_SECURITY.md).

Launch a session with capabilities selected for the task:

```bash
aiskills session --agent=codex --dry-run "review widgets"
aiskills session --agent=claude "review widgets"
aiskills session --agent=codex --print "explain this project"
aiskills session --agent=codex --write "implement the dashboard"
```

Sessions use temporary configuration and approved skills enabled in the current
project. Read-only/plan mode is the default. `--write` selects Codex's workspace-write
sandbox or Claude's normal permission prompts; Warden runtime grants remain separate.
Read-only sessions deny executable MCP startup/calls and session hooks because
an approved external tool could still change remote state. Standalone MCP hosts
must grant `shell.execute` in their runtime configuration or explicitly launch
`mcp --allow-capability-execution`; requests cannot grant it themselves.
Matched declarative instructions are included. A compact four-tool MCP interface
provides discovery, instruction loading, tool search and tool calls. Tool schemas
and MCP processes load on demand through reviewed Warden launchers, including
when the task changes later in the session. Each call checks current activation,
snapshot integrity, agent compatibility and approval, then closes its gateway.
An already-started call is not retroactively canceled by a later approval change.
Session signals and print timeouts escalate to a forced process-group shutdown
after one second on Linux, including remaining agent/MCP descendants.
Claude gets strict
MCP configuration and disabled slash-command discovery. Codex explicitly disables
each effective MCP server before adding the selected set. Existing agent settings
are never rewritten. Temporary files are removed on normal exit or spawn failure.
Use `AI_SKILLS_CODEX_BINARY` or `AI_SKILLS_CLAUDE_BINARY` for a specific executable.

Routing uses task tokens, explicit triggers, negative triggers, agent compatibility,
and backend providers detected from project dependencies. Required skills load
before their consumers; missing, incompatible or cyclic dependencies stop routing
with an actionable error. A 12,000-token estimated budget bounds selected guidance.
`skills pin <id>` keeps an approved enabled skill selected; `skills unpin <id>`
restores automatic selection. Pins cannot approve packages or bypass compatibility.
`skills metrics` shows recent local routing decisions and estimated context sizes;
raw task text is omitted. Token counts use character estimates and are not billing
measurements. Run `pnpm benchmark:routing` for the deterministic selection corpus.

Run `aiskills doctor --json` for configuration, registry/dependency, snapshot
integrity, executable and Warden readiness checks. Failures return exit code 1;
optional integrations and unverified client isolation produce warnings.
`node scripts/verify-release.mjs <tarball-directory>` checks packaged files and
`node scripts/smoke-release.mjs <tarball-directory>` installs the four tarballs
in a clean temporary environment and verifies CLI, SQLite and MCP behavior.
The smoke test defaults to cached/offline dependencies; set
`AI_SKILLS_SMOKE_ONLINE=1` to allow dependency downloads.

Activation and runtime-policy changes are journaled before lockfile writes.
Pending synchronization blocks surviving active capabilities from loading. Run
`aiskills skills recover` to inspect pending project locks, temporary directories
and unreferenced snapshots, then `aiskills skills sync-lock` in an affected project
to synchronize from reviewed catalog state. For an invalid lockfile,
`skills sync-lock --reset` preserves it as a uniquely named backup before rebuilding.
No temporary directories or snapshots are deleted by recovery reporting. Owner-PID
probes are diagnostic only; missing owner metadata is unknown, not proof of a dead run.
Lockfiles pin package content and per-runtime policy/rule hashes. New runtime
permissions require lock synchronization; edited project lockfiles cannot grant
permissions or change the reviewed catalog state.

Session overrides disable Codex's native plugin/remote-plugin and hook features,
and disable installed Claude plugins plus native hooks for the invocation.
Administrator-managed capabilities and native skill discovery still require
client-specific policy checks; session overrides do not claim to bypass admin policy.

```bash
aiskills add ./my-skill
aiskills install owner/repository --ref=main --path=skills/my-skill
aiskills skills inspect my-skill
aiskills skills review my-skill --yes
aiskills skills enable my-skill
aiskills plan "review widgets"
aiskills skills disable my-skill
```

`aiskill` is also available as an alias for `aiskills`.

Imports accept `skill.yaml` or `SKILL.md` with name/description frontmatter.
They snapshot content into the user configuration directory, reject symlinks,
enforce size limits, and scan instructions without executing package code.
GitHub imports pin the resolved commit and content hash. `--dry-run` previews
an import; `--yes` approves only local candidates without high-risk or hidden-content findings.
Remote (GitHub) installs never auto-approve: run `aiskills skills inspect <id>`, read the findings and
the pinned commit, then `aiskills skills review <id> --yes`. Hidden content (HTML comments, zero-width
or invisible characters, hidden styling) always needs that review. At load time, user skill text is
sanitised (those items are removed and the removal is reported), and a skill whose files changed after
approval is refused. Activation is project scoped
and writes a version-2 lockfile; version-1 lockfiles remain readable.

Approved declarative packages participate in runtime task routing. Their
instructions load only when selected. Original source edits do not change the
installed snapshot, and every use verifies integrity. `remove <id>` removes the
registration and activations but retains the snapshot for recovery. Use
`aiskills skills update <id> --dry-run` to preview changed content, then run
`update <id>` to register it. Changed content revokes approval and disables
all project activations. Review and enable again before use. `history <id>`
lists previous revisions; `rollback <id> --digest=<hash>` restores one for review.

Executable packages remain disabled for instruction activation. For explicit
runtime execution, add a `runtime.json` declaration:

```json
{"kind":"mcp","command":["/absolute/path/to/node","${PACKAGE}/server.mjs"],"tools":["read"],"network":[],"env":[]}
```

Use `aiskills skills prepare <id>` to preview the generated policy and rules,
then `prepare <id> --yes` to approve execution. `aiskills skills connect <id>`
launches through Warden with inherited stdio. The policy grants read access to
the package and executable, no writes, and only declared hosts/environment names.
`kind: command` runs a plain sandboxed command. An MCP declaration may instead
provide an HTTPS `upstream`; its server runs remotely and has no local process
isolation. The declared `tools` are filtered through the Warden gateway.

After preparing an MCP package, use `skills enable <id>` to make it eligible for
task-selected session activation. Commands without MCP stay explicit-only.

MCP execution requires Warden with `connect`; the published `0.2.0-beta.4` Linux
binary passed the gateway, broker and browser integration tests. Stable 0.1.16
does not provide `connect`. Set `AI_SKILLS_WARDEN_BINARY` to a compatible verified
binary. No direct execution fallback is provided. Remote credential setup and
background updates remain follow-up work.
The heuristic scanner cannot prove
instructions safe; review and runtime permissions remain necessary.

The AI Skills MCP server exposes `use_skills` (routes the task and returns the matching skills in one call),
`load_skill` (one skill by id), `search_tools` (matching gateway tools)
and `call_capability` (a reviewed tool call). `load_skill` supports built-ins and
approved enabled project skills, including task-selected nested plugin guidance.
Loading verifies installed snapshots and enforces context budgets. Tool discovery
starts at most eight matching gateways and works in two steps: `search_tools` first
returns up to 20 tool names with short descriptions, ranked against the task, then
`search_tools` with `select` (up to 10 `{id, entry, tool}` references) returns full
input schemas for only those tools, within 64 KB. Calls accept at most 64 KB of
arguments. Results up to 16 KB return inline; larger results up to 256 KiB are saved
under `.ai/results/` (git-ignored) and the call returns the file path plus a 2 KB
preview. Tool names must be advertised by the approved gateway; Warden enforces the
reviewed allowlist. `mcp` exposes only these four tools by default (`--compact` is
accepted for compatibility); `mcp --full` also exposes project, orchestration and
reference tools. Remote callers cannot install packages
or approve permissions. Upstreams are closed after each request, so stateful MCP
servers that depend on connection-local state require a different integration.

## Built-in skills

### Plugin bundles

An `aiskills-plugin.json` can combine nested skills, MCP runtimes and bounded
session hooks. Each runtime requires a separate `prepare --entry` approval:

```json
{
  "schema_version": 1,
  "id": "product-bundle",
  "name": "Product bundle",
  "description": "Frontend product workflows",
  "version": "1.0.0",
  "skills": ["skills/frontend/SKILL.md"],
  "runtimes": {
    "docs": {"kind":"mcp","command":["/absolute/path/to/node","${PACKAGE}/docs.mjs"],"tools":["search"]},
    "check": {"kind":"command","command":["/absolute/path/to/node","${PACKAGE}/check.mjs"]}
  },
  "hooks": {"before-session":"check"}
}
```

```bash
aiskills add ./product-bundle --yes
aiskills skills prepare product-bundle --entry=docs
aiskills skills prepare product-bundle --entry=docs --yes
aiskills skills prepare product-bundle --entry=check --yes
aiskills skills enable product-bundle
aiskills session --agent=claude "product-bundle frontend review"
```

All runtime entries must be approved before activation. Nested skills load only
on a task match. `before-session` and `after-session` hooks reference command
entries and run through Warden with a 30-second host timeout; a failing pre-hook
prevents agent startup. Imports do not execute hooks. Native lifecycle events
require explicit mappings to this format; automatic third-party hook registration
is not supported.

Native `.claude-plugin/plugin.json`, `.codex-plugin/plugin.json`, and root
`plugin.json` layouts can also be imported. Their nested skills and MCP servers
are adapted without executing installers. Native servers require explicit host
preparation, for example:

```bash
aiskills skills prepare native-product --entry=docs --executable=/absolute/path/to/node --tools=search,read
aiskills skills prepare native-product --entry=docs --executable=/absolute/path/to/node --tools=search,read --yes
```

`--hosts=api.example.com` grants named egress hosts in the reviewed policy.
Environment placeholders must use same-name `${VARIABLE}` references; inline
credential values/headers are rejected. Unsupported native hook, agent or command
layouts require explicit bundle mappings and fail import with an actionable error.

Skills are declarative YAML manifests in `packages/core/skills`. They are
loaded by the core registry and routed by capability and task context.

The built-in catalog includes:

- Core: repository exploration, planning, orchestration, evidence-first,
  simplification, and completion checking
- Build: backend, frontend, full-stack, database, UI, product engineering,
  and technical writing
- Think: research, brainstorming, idea validation, adversarial review,
  architecture, prioritization, build-vs-buy, and startup validation
- QA: QA engineering, code review, requirements, regression, and integration
  verification
- Security: security review, authentication, authorization, input validation,
  API, dependency, secrets, agent, prompt-injection, and threat modeling

Skill packs in `packages/core/packs` reference these skill IDs without copying
their definitions: `core`, `fullstack`, `security`, `research`, and `product`.

## Package layout

| Package | Purpose |
| --- | --- |
| `@prof-bilal/aiskills` | CLI executable (`aiskills` command) |
| `aiskills-core` | Registry, project context, evidence, planning, security, workflows, and lockfile APIs |
| `aiskills-adapters-local` | Local agent detection and normalized execution adapters |
| `aiskills-sdk` | Constructors for third-party declarative extensions |

## Publish to npm

The packages are versioned together. Authenticate first and verify access:

```bash
npm login
npm whoami
```

Build and inspect every tarball before publishing:

```bash
pnpm clean
pnpm install
pnpm build
pnpm test
pnpm -r pack --pack-destination ./release
```

Publish in dependency order:

```bash
npm publish --workspace packages/core --access public
npm publish --workspace packages/adapters/local --access public
npm publish --workspace packages/sdk --access public
npm publish --workspace packages/cli --access public
```

After publication, verify the user-facing package in a clean directory:

```bash
mkdir /tmp/aiskills-smoke
cd /tmp/aiskills-smoke
npm init -y
npm install -g @prof-bilal/aiskills@0.1.6
aiskills --version
aiskills skills list
```

The supporting packages use unscoped names so they can be published by the
authenticated npm account without requiring an organization scope.

For automated releases, add an `NPM_TOKEN` repository secret and push a
version tag such as `v0.1.6`. The repository workflow runs the tests and
publishes the packages in dependency order.

## Development checks

```bash
pnpm build
pnpm test
git status --short
```

Tests cover manifest validation and dependency resolution, agent detection,
project context, profiles, claims and evidence, planning, orchestration,
verification, packs, permissions, goals and memory, workflows, tools, SDK
constructors, and package loading.

## License

MIT

