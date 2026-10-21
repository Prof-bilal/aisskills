# AI Skills

AI Skills is a local-first runtime for reusable AI-agent skills, skill packs,
project context, evidence-backed verification, permissions, and agent adapters.
It is designed to work with coding agents already installed on your machine.

## Status

Public release `0.1.4` is available on npm. The repository builds and the test
suite passes.

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
aiskills security
aiskills goals
aiskills workflows
aiskills tools
aiskills memory
```

`aiskills run` is read-only by default and requires a configured, available
agent. State-changing operations remain subject to the permission policy.

## Built-in skills

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
npm install -g @prof-bilal/aiskills@0.1.4
aiskills --version
aiskills skills list
```

The supporting packages use unscoped names so they can be published by the
authenticated npm account without requiring an organization scope.

For automated releases, add an `NPM_TOKEN` repository secret and push a
version tag such as `v0.1.4`. The repository workflow runs the tests and
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

