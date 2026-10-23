# Execution security

AI Skills separates host authorization from MCP task data. Requests cannot supply
permission grants, engine module paths, provider configuration or check allowlists.
The host selects the project and trusted runtime configuration. Do not discover
that configuration from untrusted repository content.

The Smurf bridge requires repository read/write, Git read/write and shell execution.
API providers additionally require network read/write grants. The host names each
API endpoint, model and optional credential environment variable. Model requests
have no shell, filesystem or tool-call interface. AI Skills reuses Smurf's API
transport and model discovery, but disables upstream automatic file writes and
applies validated complete-file blocks itself. Exact file scope, traversal and
symlink checks constrain writes; a rejected write fails that worker attempt.
Credentials authenticate the transport and are not placed in model prompts.

API verification commands run under Linux bubblewrap with separate process and
network namespaces. The workspace is mounted read-only, Git metadata is hidden,
the inherited environment is cleared, the home directory and other host files
are absent, and temporary writes use private `/tmp`. System executables/libraries
and the current Node executable are mounted read-only. Host-approved commands
still require an exact allowlist match. Bubblewrap availability and a working
Node runtime are probed before execution; there is no unsandboxed fallback.
The same boundary covers checks on the combined integration branch. Checks must
work with the tracked repository and system runtime; arbitrary host dependency
folders, package installation, network-dependent tests and writable build output
are not currently mounted/enabled.

CLI/API providers are different execution modes. Arbitrary Smurf CLI and OpenHands
workers remain disabled until their own process/credential boundaries are
connected. The deterministic development mock is retained for compatibility and
runs trusted host-approved checks directly; use it only with trusted fixtures.
Native execution retains existing provider-specific read-only modes and does not
certify those providers' sandboxes.

Repository instructions do not grant authority. A bounded scan of root `AGENTS.md`
and `README.md` records suspicious instructions; symlinks and oversized documents
are skipped. Prompts identify repository content as data. The scanner is heuristic;
API edit validation and check isolation enforce the relevant host boundaries.
Tests include hostile file blocks and real verification subprocesses attempting
host-file access, environment access, network use, workspace writes and Git
metadata tampering. These tests do not establish general model correctness or
kernel/resource isolation against every possible attack.

Causal claims need host evidence or a corrected brief before delegation. Worker
claims cannot establish completion. Nonempty passing checks, scope evidence,
an independent model review and combined-branch checks determine results. API
cost routing uses configured prices and observed token counts through Smurf's
budget mechanism; configured budgets are not a guaranteed provider billing cap.
Accepted output remains on an integration branch. Waiting/failed runs retain
state for diagnosis; preserve work before cleaning retained worktrees.
