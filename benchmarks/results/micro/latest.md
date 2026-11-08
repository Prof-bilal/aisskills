# AI Skills micro-benchmarks

Bytes are exact; tokens are chars/4 estimates; timings are machine-dependent medians of 5.

## 1. Context at session start (tool definitions)

| Tools on servers | All loaded upfront | Names only (agent tool search) | AI Skills (4 tools) | AI Skills --full |
| --- | --- | --- | --- | --- |
| 50 | 41166 B (~10292 tok) | 923 B (~231 tok) | 2339 B (~585 tok) | 7439 B |
| 100 | 82902 B (~20726 tok) | 1861 B (~466 tok) | 2339 B (~585 tok) | 7439 B |
| 200 | 166482 B (~41621 tok) | 3838 B (~960 tok) | 2339 B (~585 tok) | 7439 B |

## 2. search_tools payload

| Tools on server | All schemas | Previous search (64 KB cap) | Step 1 (names) | Step 2 (3 schemas) |
| --- | --- | --- | --- | --- |
| 50 | 43066 B | 43015 B | 5243 B (20 tools) | 2105 B (3 tools) |
| 100 | 86802 B | 63137 B | 5263 B (20 tools) | 2108 B (3 tools) |
| 200 | 174282 B | 63137 B | 5263 B (20 tools) | 2108 B (3 tools) |

## 3. Tool result reaching the agent

| Result size | Bytes to agent | Saved to file |
| --- | --- | --- |
| 1000 chars | 1039 B (~260 tok) | no |
| 8000 chars | 8039 B (~2010 tok) | no |
| 16000 chars | 16039 B (~4010 tok) | no |
| 32000 chars | 2239 B (~560 tok) | yes |
| 100000 chars | 2240 B (~560 tok) | yes |
| 250000 chars | 2240 B (~560 tok) | yes |

## 4. Startup (synthetic servers, no Warden sandbox)

| Setup | Servers | Tools | Ready in | Memory |
| --- | --- | --- | --- | --- |
| All servers upfront | 9 | 220 | 93 ms | 481 MB |
| AI Skills | 1 | 4 | 320 ms | 90 MB |

Cost AI Skills pays instead: each tool call starts its gateway, about **166 ms** per call here (more with the real Warden sandbox).

## 5. Built-in skill routing

42 labelled tasks. Precision 0.32, recall 0.825, 3 clearly wrong picks. Average selected guidance ~757 tok vs ~6439 tok for all 43 skills.

- missed: "add secure password reset to the signup flow" expected auth-security; got security-reviewer, threat-model, secrets-review
- missed: "audit npm dependencies for known vulnerabilities" expected dependency-security; got security-reviewer, threat-model
- missed: "should we build our own auth or buy a service" expected build-vs-buy; got security-reviewer, threat-model, auth-security, frontend-engineer, ui-designer, backend-engineer, fullstack-engineer
- missed: "validate this startup idea for a dog walking marketplace" expected startup-validator, idea-validator; got input-validation, product-engineer, idea-validator, feature-prioritizer
- missed: "simplify this overly complex module" expected simplify; got nothing task-specific
- missed: "write the README and API documentation" expected technical-writer; got backend-engineer, fullstack-engineer, api-security
- missed: "challenge my plan and find the weak points" expected devil-advocate; got nothing task-specific
