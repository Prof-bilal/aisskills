# AI Skills MCP

Start the stdio server with `aiskills mcp`. The CLI package contains the server;
there is one AI Skills installation and one MCP connection. Configure the client's
command to `aiskills`, arguments `["mcp"]` (or `["mcp", "--full"]` for orchestration tools), and working directory to the target
project. Alternatively set `projectRoot` in the trusted host runtime file. The
server fixes its project root at startup; requests cannot change it.
Stdout is reserved for MCP framing. Node 20+ supports the base server; the optional
Smurf development bridge needs Node 24.

By default the server exposes only the four gateway tools: `use_skills`,
`load_skill`, `search_tools` and `call_capability`. `use_skills` routes a task and returns only the matching
skills, marked as untrusted data, in a single call. `discover_capabilities` remains in `--full`. They are marked
`anthropic/alwaysLoad` so Claude Code's tool search does not hide them.
`search_tools` returns ranked tool names first; pass `select` to fetch schemas for
the chosen tools. `call_capability` results over 16 KB are saved under
`.ai/results/` and returned as a path plus preview. Add `--allow-capability-execution`
to permit approved tool calls. See the README section "Use with your agent directly".

Start with `aiskills mcp --full` to also expose: `inspect_project`,
`recommend_skills`, `plan_task`, `execute_task`, `verify_claim`, `verify_task`,
`check_goal`, `list_agents`, and the reference tools.

`execute_task` accepts `task`, optional `mode` (`auto`, `single`, `native`,
`smurf`) and optional `steps`. Each step has `id`, `brief`, exact relative `files`,
`dependencies` (step IDs), and `checks` (host-approved command strings).
Unknown request properties are rejected. Host permissions, provider configuration,
engine checkout and project path cannot be supplied through a tool call.

```json
{
  "task": "Add a validated API endpoint",
  "mode": "smurf",
  "steps": [{
    "id": "endpoint",
    "brief": "Validate input and return a 400 response for invalid names",
    "files": ["endpoint.js"],
    "dependencies": [],
    "checks": ["node endpoint.test.js"]
  }]
}
```

Production defaults expose native read-only execution through a configured local
agent. Its claims remain `IMPLEMENTED_BUT_UNVERIFIED`. A causal claim without
host-verified evidence is blocked before delegation. `verify_claim` preserves
uncertainty: absent a host verifier it returns `UNVERIFIED`. `verify_task` returns
recorded verification for a run in the current server session; it does not rerun
commands. Results are bounded to the most recent 100 recorded runs.

For local deterministic integration development only, select an external trusted
JSON file using `AI_SKILLS_RUNTIME_CONFIG`. Its shape is:

```json
{
  "permissions": ["repository.read", "repository.write", "git.read", "git.write", "shell.execute"],
  "allowedChecks": ["node endpoint.test.js"],
  "smurfDevelopment": {
    "checkout": "/absolute/path/to/.integration/smurf",
    "stateDirectory": "/absolute/path/outside/project/run-state",
    "mockScript": "/absolute/path/to/mock.json"
  }
}
```

The development host must also explicitly set `ORCH_MOCK_SCRIPT` to that exact
script path. Never use an untrusted repository file as host configuration. This development configuration enables only the mock provider. API workers use
the separate configuration below. The normal install does not
contain or download Smurf source. See the license and sandbox blockers in
[SMURF_INTEGRATION.md](SMURF_INTEGRATION.md).

## OpenAI-compatible API providers

For real API workers, use `smurf` in the trusted host runtime file instead of
`smurfDevelopment`. The checkout is the existing local clone. No separate Smurf
commands or application setup are needed. This mode needs Node 24 and a working
Linux `bwrap` executable; the base AI Skills installation remains independent of it.

```json
{
  "permissions": ["repository.read", "repository.write", "git.read", "git.write", "shell.execute", "network.read", "network.write"],
  "allowedChecks": ["node endpoint.test.js"],
  "smurf": {
    "checkout": "/absolute/path/to/.integration/smurf",
    "stateDirectory": "/absolute/path/outside/project/run-state",
    "api": {
      "seniorModel": "compatible:review-model",
      "budget": {"perRunUsd": 1, "perTaskUsd": 0.5},
      "providers": {
        "compatible": {
          "baseUrl": "https://your-provider.example/v1",
          "apiKeyEnv": "AI_SKILLS_PROVIDER_KEY",
          "billing": "metered",
          "models": [
            {"model": "worker-model", "tier": "strong", "priceIn": 1, "priceOut": 2},
            {"model": "review-model", "tier": "strong", "priceIn": 1, "priceOut": 2}
          ]
        }
      }
    }
  }
}
```

The endpoint/model names and prices above are placeholders. Set actual supported
model IDs and prices per million tokens. Local compatible endpoints can use
loopback HTTP and `billing: "free"`; non-loopback endpoints require HTTPS. At
least two distinct model identities and a configured senior model are required.
Set the named API key in the host environment; requests cannot choose a key name.
Only transport authentication receives it. `ORCH_MOCK_SCRIPT` is unnecessary in
API mode. Checks run without inherited credentials, network, writable project
files or other host directories. See [SECURITY.md](SECURITY.md) for supported
verification workloads and current CLI-provider limitations.
