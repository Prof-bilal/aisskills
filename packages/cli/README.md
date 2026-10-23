# AI Skills CLI

Local-first runtime for reusable AI-agent skills, project context, evidence-backed verification, permissions, and MCP orchestration.

## Install

```bash
npm install -g @prof-bilal/aiskills
aiskills --version
```

Initialize a profile, inspect installed agents, or list built-in skills:

```bash
aiskills init --project
aiskills agents
aiskills skills list
```

`aiskills run` is read-only by default. Start the MCP stdio server with `aiskills mcp` for clients that support Model Context Protocol. Smurf orchestration is opt-in through the host runtime configuration; see the repository documentation for API provider and sandbox requirements.

Requires Node.js 20 or newer.
