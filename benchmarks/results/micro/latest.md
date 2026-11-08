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
| All servers upfront | 9 | 220 | 113 ms | 481 MB |
| AI Skills | 1 | 4 | 390 ms | 89 MB |

Cost AI Skills pays instead: each tool call starts its gateway, about **171 ms** per call here (more with the real Warden sandbox).

## 5. Built-in skill routing

42 labelled tasks. Precision 0.556, recall 0.625, 0 clearly wrong picks. Average selected guidance ~444 tok vs ~6439 tok for all 43 skills.

- missed: "add login to my app" expected auth-security; got nothing task-specific
- missed: "add secure password reset to the signup flow" expected auth-security; got nothing task-specific
- missed: "check API keys are not committed and rotate exposed credentials" expected secrets-review; got api-security, backend-engineer
- missed: "audit npm dependencies for known vulnerabilities" expected dependency-security; got nothing task-specific
- missed: "do a full security review of this repository" expected security-reviewer, threat-model; got security-reviewer
- missed: "make the landing page responsive on mobile" expected frontend-engineer; got ui-designer
- missed: "redesign the dashboard UI with better spacing and typography" expected ui-designer; got nothing task-specific
- missed: "build a React settings page with a form" expected frontend-engineer; got nothing task-specific
- missed: "add a REST endpoint that returns paginated orders" expected backend-engineer; got nothing task-specific
- missed: "build a full stack todo feature with API and UI" expected fullstack-engineer; got api-security, backend-engineer
- missed: "should we build our own auth or buy a service" expected build-vs-buy; got auth-security, backend-engineer
- missed: "validate this startup idea for a dog walking marketplace" expected startup-validator, idea-validator; got idea-validator
- missed: "simplify this overly complex module" expected simplify; got nothing task-specific
- missed: "write the README and API documentation" expected technical-writer; got api-security, backend-engineer
- missed: "challenge my plan and find the weak points" expected devil-advocate; got nothing task-specific
