# Gateway research: stronger, more secure, cheaper (40 rounds)

Goal: keep test-pass rate at the old gateway's level (111/120), cut cost, and reduce obedience to injected text (baseline 9/12 security tasks obeyed).

## Round 1: injection defences for tool-calling agents
- Spotlighting / delimiting weak on tool agents (AgentShield 2026, arxiv 2605.11026).
- Instruction hierarchy and system-level warnings: unclear measurements.
- Layered runtime checks best reported (AgentArmor, arxiv 2508.01249).

## Rounds 2-5 (batch 1)

### MCP server instructions and tool-result trust
- MCP servers can send an `instructions` field; attacker-written text there enters the agent before any tool call (red-team report, runtimewire). Claude Code caps server instructions at 2 KB. Mitigation: treat as untrusted, limit length. Source: https://runtimewire.com/article/mcp-prompt-injection-before-first-tool-call
- "Untrusted tool descriptions" appears only as non-normative spec guidance; clients should pin tool definitions on approval and re-prompt on change (rug pull). Source: https://simonw.substack.com/p/model-context-protocol-has-prompt?r=18hsl
- Wrapping external results in a structured tag reduces but does not eliminate injection. Source: https://socket.dev/glossary/mcp-security

### Training against injections
- Instruction hierarchy (system > developer > user > tool) trained in models improves robustness, including to unseen attacks (Wallace et al., 2024, up to 63% gain on GPT-3.5, vendor-reported). Source: https://arxiv.org/pdf/2404.13208
- OpenAI IH-Challenge (March 2026) reports gains on CyberSecEval 2 and an internal benchmark; vendor-reported, no independent replication found. Source: https://openai.com/index/instruction-hierarchy-challenge
- Implication for us: the gateway cannot train the model. Only prompt placement and tool-result format are in our control.

### Adaptive attacks (AgentDojo family)
- AgentDojo: a secondary detector (DeBERTa classifiers) cut static ASR to 8%. Source: https://arxiv.org/html/2406.13352v3
- 2026 adaptive attacks (AutoDojo) recover a large share of attacks against defences that show 0% static ASR (28% overall, 64% on action-open tasks). Detectors that look for instruction-like text fail when the injection poses as ordinary data. Source: https://huggingface.co/papers/2606.15057.md
- Implication: a classifier on skill text is not a security boundary; limits on actions still are.

### Prompt caching (cost)
- "Don't Break the Cache" (arXiv 2601.06007): caching cuts cost 41–80%; system-prompt-only caching is most consistent; caching dynamic tool results can increase latency. Source: https://arxiv.org/html/2601.06007
- Keep stable content first, put dynamic values last; one dynamic identifier moved to the end raised hit rate to 74% in one production case (vendor-reported). Source: https://www.ssw.com.au/rules/do-you-follow-best-practices-for-prompt-caching
- Break-even on a 1.25x write premium is about two reads (third-party). Verify Anthropic pricing before use.

### Tool-result size (tokens)
- Pruning to the last few tool results cut tokens 63.9% in one enterprise workflow, but the baseline was a different configuration. Source: https://arxiv.org/html/2606.10209
- Query-aware compression of tool output: vendor-reported near-100% retention with 94–99% token cut on a synthetic task. Source: https://pypi.org/project/tooltrim/
- Focus (active context compression): 22.7% token cut with identical accuracy on a 5-task set. Source: https://arxiv.org/pdf/2601.07190
- Caveat across all: small benchmarks, naive truncation performs badly.

### Working conclusions after round 5
1. Obedience: layered controls, not text alone. Keep placement and marking, add action limits (already in place), and an explicit MCP-server-level rule.
2. Cost: stable prefix + skill text placed late (already the hook design) + pruning of old tool results is the cheapest lever we control.
3. Next rounds: check how Claude Code itself treats tool results and reminders; check Warden/guard coverage for MCP tool calls; measure our own numbers on the old gateway.

## Rounds 6-10 (batch 2)

### Hooks and enforcement
- Known bug (closed issue): PreToolUse `permissionDecision: deny` was not enforced for MCP tool calls in some versions. We must test deny on MCP tools ourselves before relying on it. Source: https://claudeissues.com/issue/33106-pretooluse-hook-permissiondecision-deny-not-enforced-for-mcp-server-tool-calls
- Matchers can target MCP tools by name pattern (`mcp__server__.*`). Use this to guard the aiskills MCP tools too. Source: https://agentpatterns.ai/tool-engineering/hooks-invoking-mcp-tools/
- Only exit code 2 blocks a command hook; any other non-zero code lets the action proceed. Our `guard` already exits 2 on bad input. Source: https://code.claude.com/docs/en/hooks

### Tool poisoning and rug pulls (MCP)
- Hash-pin each approved tool description and schema; block or alert on change. Hash the full schema, not just names. Sources: https://invariantlabs.ai/blog/introducing-mcp-scan , https://waxell.ai/docs/observe/mcp-governance/rug-pull-detection
- Blind spots: tools poisoned from first contact have no baseline; pinning does not catch a malicious call that matches the schema. Source: https://dev.to/luckypipewrench/your-mcp-servers-tool-descriptions-are-an-attack-surface-37pj
- Implication for us: applies to `use_skills`/`load_skill` only if skill text is pinned at approval. Our skills are already digest-pinned (`InstalledSkillPackage.digest`), so this is partly in place.

### Information-flow designs (beyond CaMeL)
- FIDES (Microsoft, arXiv 2505.23643): integrity labels on every data element; per-call checks. Secondary summary only. Source: https://arxiv.org/pdf/2505.22852 (CaMeL operationalisation) and related pages.
- RTBAS (arXiv 2502.08966): dependency screening plus an LLM judge, heavier than we want.
- CaMeLoT (arXiv 2609.18674): static plan verification; caught 7/7 temporal-policy violations vs 1/7 per-call. Relevant if we ever plan before acting.
- CaMeL strict policy: 67% task completion on AgentDojo; too costly for our test-pass bar. Source: https://arxiv.org/pdf/2505.22852
- Working decision: information-flow controls are the strongest design but reduce pass rate; we keep action limits (guard, sandbox) and marking instead.

### Malicious skills in the wild (supply chain)
- Snyk (Feb 2026): 76 of 3,984 scanned skills confirmed malicious; 91% of those also use prompt injection. Source: https://research.snyk.io/blog/agent-skills-threat-landscape/
- ESET (H1 2026): vendor figures, about 1 in 300 flagged as directly malicious. Source: https://expertinsights.com/news/1-in-300-ai-agent-skills-is-directly-malicious-eset-research-finds
- Holzbauer et al. (arXiv 2603.16572): context-free scanning overestimates risk; also documents hijacking of abandoned GitHub repos. Source: https://arxiv.org/pdf/2603.16572
- Implication: the install path is the attack path. Pin by digest, prefer commit-pinned GitHub sources, and re-review on update (already implemented as `update` revoking approval).

### Cost and orchestration
- "The Harness Effect" (arXiv 2607.06906, preprint): orchestration code alone changed cost per task by 41% and tokens by 38%. Check methodology before relying on it. Source: https://arxiv.org/pdf/2607.06906
- Sub-agent delegation carries context forward; cost multiplies with cascades (one unsourced 3–10x figure, do not use).
- Routing to a small model by default and escalating on a measurable gap is widely reported (30–60% savings, not peer-reviewed). Source: various practitioner posts.
- Same-task token use varied up to 30x across runs on SWE-bench Verified with no quality gain from the expensive runs. Lesson: cost is mostly variance, so measure distributions, not medians.

### Updated design implications
1. Put every MCP tool that returns skill text under the guard's matcher and test deny on MCP tools (bug risk).
2. Keep the new `use_skills` only if its output stays small; otherwise the old two-call gateway is cheaper in cache writes (our data).
3. Measure cost variance (p90), not only the median, since a few expensive runs dominate totals.

## Rounds 11-15 (batch 3)

### Sandbox and egress (Warden / bubblewrap)
- Bubblewrap is not a hardened isolation boundary against an agent intent on harm (Pydantic docs). For untrusted skills, use a separate user or a stronger sandbox. Source: https://pydantic.dev/docs/ai/harness/bubblewrap-sandbox/
- Egress must be enforced before the socket opens, not after DNS lookup (DNS rebinding). Proposed in an Apache magpie issue. Source: https://github.com/apache/magpie/issues/1059
- Warden (dsvxmedia) egress allowlist is stored but not enforced yet (self-described). Not the same project as our Warden binary. Source: https://github.com/dsvxmedia/warden
- Implication: our sandbox boundary is only as strong as its network layer. Test DNS rebinding against our sandbox settings before claiming egress control.

### Reminders and marking
- Tag or sandwich defences alone are weak; they only help as one layer. Sources: https://arxiv.org/pdf/2410.07283 (LLM tagging helps when combined), https://arxiv.org/pdf/2506.17318 (existing agents "woefully inadequate").
- FATH hash-based tags report 0% ASR on some benchmarks, but on the authors' own evaluation. Source: https://arxiv.org/pdf/2410.21492
- Per-request (dynamic) separators reduced one attack from 0.88 to 0.38 on one model (preprint, 16 payloads). Source: https://arxiv.org/abs/2605.30534
- Adaptive attackers with ~500 rounds eventually defeated delimiter boxing; only deterministic external output filtering held up. Source: https://arxiv.org/abs/2604.23887
- Implication: marking is cheap and worth keeping, but the security gain must come from output and action controls.

### Progressive disclosure (skill cost)
- SkillReducer (arXiv 2603.29919): always-loaded core plus on-demand modules; 48% description compression and 39% body reduction. Source: https://arxiv.org/html/2603.29919
- Modeled MCP savings (about 77%) shrank to about 13% when replayed against real transcripts (vendor). Source: https://archestra.ai/blog/progressive-disclosure-for-mcp-tools
- Conversation history can dominate the budget; per-component savings overstate end-to-end savings.
- Implication: measure end-to-end session cost, not just the skill payload. Our benchmark already does (total tokens).

### Over-defense (false positives)
- Guard models over-block on trigger words such as "ignore"; benign quoted injections and security docs get flagged. Source: https://arxiv.org/html/2410.22770v1
- Shortcut learning: defences learn surface cues; a single trigger token raised false refusals by up to 50% (Jan 2026). Source: https://fugumt.com/fugumt/paper_check/2601.07185v1_enmode
- Implication: our install triage and any text-level detector will over-block. Test benign skills that discuss secrets, curl, and "ignore" (our 16 benign set is too easy). Add hard benign cases before claiming low false positives.

### Working conclusions after round 15
1. A text-level detector is not worth its false positives for the gateway. Keep it as triage only.
2. The reliable security lever is deterministic: sandbox with verified egress, guard on MCP tool calls, and measured action outcomes.
3. For cost, measure end-to-end; the skill payload is a small fraction of a session.
4. Open gaps: no 2026 head-to-head of marking vs output filtering vs action limits on tool agents; MCP spec text on server instructions not yet read.

## Rounds 16-20 (batch 4)

### Egress and output (exfiltration)
- "Silent Egress" (arXiv 2602.22450): in 480 runs, 95% of successful exfiltration was not caught by output-based safety checks; the vector was URL previews. Source: https://arxiv.org/abs/2602.22450
- Covert channels (timing, size, rate) evade both domain allowlists and secret scanners; a reference monitor needs those signals too (arXiv 2605.20734, preprint). Source: https://arxiv.org/pdf/2605.20734
- Implication for us: our `guard` checks network hosts and secret paths only; add checks for encoded payloads and URL previews, and keep egress deny-by-default.

### MCP spec (annotations and trust)
- 2025-11-25 keeps the tool annotation hints (readOnlyHint, destructiveHint, etc.); the spec treats them as hints, not guarantees. Source: https://glama.ai/mcp/servers/@chrishayuk/chuk-mcp-server-reference/blob/9ddab97f9b578b38cce2687dadabf9c33da69271/specs/2025-11-25/README.md (mirror; check modelcontextprotocol.io).
- Server `instructions` text: not covered by any result; still unverified. Our plan's step to add instructions must be checked against the spec before shipping.

### Memory and caching
- Retrieval instead of full context: 51–72% token cut measured on a small store (vendor). Source: https://mem0.ai/blog/6-techniques-to-cut-ai-agent-memory-cost-beyond-basic-retrieval
- Warm prompt-cache hit rates varied 12–75% across systems; cold starts get no hits (MemForest preprint). Source: https://arxiv.org/pdf/2605.23986
- No measured result for deduplicating repeated tool calls within a run. Gap.

### Anthropic cache pricing (verify before use)
- 1-hour cache write costs 2x base input; 5-minute write 1.25x; reads 0.1x. Break-even: 5-minute write pays after one read, 1-hour after two. Source (docs snippet via search): https://platform.claude.com/docs/en/build-with-claude/prompt-caching
- Several blogs claim newer prices and a silent TTL change in March 2026; unverified.

### Cheap classifiers for tool calls
- A 4B judge intercepted ~94–96% of risky calls at ~490 ms, versus LLM judges (arXiv 2603.07191, governance paper). Source: https://arxiv.org/pdf/2603.07191
- Vendor demo: purpose-built guard ~104 ms vs 1.9 s for an LLM judge, same decisions on one scenario. Source: https://arize.com/blog/llm-guardrails-jev/
- Zero-shot small models barely intercepted anything (NLI); fine-tuning matters. Chain-of-thought judging is the main cost driver.
- Implication: a classifier would add per-call latency and tokens on every tool call; only worth it if it prevents failures we measure. Do not add without an action-benchmark result.

### Round 20 conclusions
1. Egress and covert channels are the gap in our guard; add encoded-payload and URL-preview checks, not more text detection.
2. Cache TTL choice matters for cost: the one-hour write only pays when the same prefix is reused within the hour; check the real reuse pattern in our benchmarks before changing it.
3. Still missing: measured results for guard coverage on obfuscated commands (our own obf-* attacks will supply this), spec text on server instructions, and tool-result dedupe.

## Rounds 21-25 (batch 5)

### Shell-command filters (defensive)
- GuardFall (Adversa AI, June 2026): 10 of 11 open-source agents check shell commands as text, while bash rewrites text before it runs (built-ins, quoting, substitution). One agent tokenizes first and evaluates substitutions recursively. Source: https://securityaffairs.com/194546/ai/guardfall-flaw-hits-10-of-11-popular-open-source-ai-agents.html
- Cursor CVE-2026-22708: shell built-ins escaped the risk check. Source: https://dev.to/cverports/cve-2026-22708-trust-issues-bypassing-cursor-ais-safe-mode-via-shell-built-ins-55ao
- Implication for `guard`: our regex checks are the same class of design that GuardFall attacks. Fix by parsing the command with a real shell tokenizer and treating built-ins, `eval`, `sh -c`, `$( )`, base64 pipes as high risk, not by adding more regexes. Keep the sandbox as the boundary.

### Tool-result caching and dedupe
- No peer-reviewed measurement of memoizing repeated tool calls. One anecdote: 800 geocoding calls for 40 unique addresses (single case). Gap remains.
- Asana (vendor, Oct 2026): 76x cost cut came from keeping the prompt prefix cached and pruning, not from dedupe. Source: https://asana.com/inside-asana/cut-browsers-agent-cost

### Context editing
- The "84%" figure is secondhand; no primary evaluation found. To measure our own: compare Anthropic's `original_input_tokens` with `input_tokens` in responses when context editing is applied. Source: https://platform.claude.com/docs/en/build-with-claude/prompt-caching (context editing pages were not fetched).
- Context editing is an API feature; Claude Code CLI does not expose it to us. Only our own SDK-based agents could use it.

### Cross-family transfer of injections
- Token-level (GCG) injections optimized on small open models transfer weakly to frontier models (<2% ASR); transfer within a family is stronger (24–36%). Source: https://arxiv.org/pdf/2606.10525
- A large red-team study (272,000 attempts, 13 models) found universal strategies that transfer across families; semantic attacks may transfer more than token attacks. Source: same arXiv listing family.
- Implication: our benchmark on Claude Haiku may not generalise to other models; state the model in every security claim.

### Least privilege per task (gateway design)
- Gateway denies by default; tools are granted per task, with short-lived grants that end on completion, timeout or cancel. Sources: https://www.gravitee.io/least-privilege.html and https://gravitee.io/corpus/gen-1040/good-practice/least-privilege-by-default-for-ai-agents-and-mcp-tool-access.html (vendor guidance, no measured results).
- Our gateway already gates skills by project activation and `call_capability` by approval. A per-task allowlist of MCP tools (from `search_tools` select) is the missing step: only tools a task selected can be called.
- Structured audit logs per tool call are a prerequisite for verifying scoping. We have no per-call audit log today; the benchmark logs are external. Add one.

### Round 25 conclusions
1. Rework `guard` on a real shell parser, not more regexes (GuardFall lesson).
2. Add per-task tool scoping to `call_capability`: deny tools the task did not select.
3. Add a per-call audit log for every gateway tool call (needed to verify 1 and 2).
4. Keep sandbox as the hard boundary; keep marking as cheap extra.
5. Cost levers unchanged: stable prefix, late skill text, measured end-to-end.

## Rounds 26-30 (batch 6)

### Shell policy (AST, not regex)
- Parse with a real shell parser (shfmt-style AST), extract every nested command (including `$( )` and `eval`), validate each against an allowlist, and reject any AST node type not explicitly recognised. Never execute the command being analysed. Sources: https://awesome.ecosyste.ms/projects/github.com%2Fanswerdotai%2Fsafecmd , https://docs.rs/crate/lean-ctx/3.7.1/source/src/core/shell_allowlist.rs (deny-by-default for compound commands).
- Regex checks are tripwires only (execkit describes itself this way). Source: https://docs.rs/crate/execkit/0.4.1/source/src/policy.rs
- Implication: replace `guard`'s regex matching for Bash with an AST-based check; keep regex only as a fast pre-filter. This is the main security change to plan.

### Audit logs
- Log every tool call at the enforcement point, not from the model's account. Append-only, hash-chained records are the common tamper-evidence pattern. Sources: https://workos.com/blog/ai-agent-trace-tampering-audit-logs , https://mojoauth.com/blog/audit-logging-for-ai-agents-what-to-capture.md
- Survey of six platforms (July 2026, vendor-reported): none log tool arguments natively. Source: https://www.gravitee.io/corpus/gen-627/bits-from-last-week-s-radio/secure-prompt-and-tool-execution-logging-for-ai-agents-designing-tamper-evident-auditable-trails-across-mcp-and-a2a-flows.html
- Implication: add a gateway-side JSONL audit log (tool, arguments digest, decision, time) with hash chaining. Small and needed to verify scoping.

### Skill routing quality (matters for cost and pass rate)
- Dense retrieval beats BM25 for skill routing (about 0.31 vs 0.6 Hit@1 in SkillRouter). Source: https://arxiv.org/pdf/2603.22455
- Routing with the body text beats the description alone by 31–44 points; richer skill text routes better. Source: same.
- Implication: our keyword routing (precision 0.56) is the weak point. An embedding index over skill text is the highest-leverage routing change, but it adds a model dependency; a local model or none at all should be tested first.

### Tool count and top-k
- Filtering tools by retrieval raised selection accuracy (13.6% to 43.1%, RAG-MCP) and cut prompt tokens by over half (secondary write-up). Source: https://www.alphaxiv.org/abs/2605.24660.md (Meta paper on tool-count depth; read for methodology).
- Recall saturates with k; selection accuracy drops as candidates grow. Pick k by measuring both (recall@k and selection), not by intuition.
- Implication: our 3-skill routing cap is a k choice; measure recall@3 vs recall@5 on the 40-task set before changing it.

### Network egress (sandbox)
- Strong design: a network namespace with no route except a host proxy, so the namespace enforces egress even if the process ignores proxy variables. Source: https://docs.nvidia.com/openshell/latest/security/best-practices
- DNS is the usual gap: a June 2026 CVE (Docker Sandboxes) forwarded DNS labels to the host resolver, enabling exfiltration. Source: https://stack.watch/vuln/CVE-2026-12039/
- Rebinding: pin the checked IP through to the connection; block private and link-local ranges after resolution; remove DNS from the sandbox if possible. Source: https://simedw.com/2026/06/05/proxy-agents/ (design write-up).
- Implication: our Rule-of-Two settings use Claude Code's sandbox (Bash only, allowedDomains). We have not tested DNS exfiltration against it. Add a DNS-exfil attack to the action benchmark before claiming egress control.

### Round 30 conclusions (priority)
1. AST-based Bash policy in `guard` (biggest security gap found so far).
2. Hash-chained gateway audit log.
3. Embedding or better-than-keyword routing (biggest routing gain; tests needed).
4. Measure recall@k before changing the routing cap.
5. Add DNS-exfiltration and encoded-command attacks to the action benchmark.

## Rounds 31-35 (batch 7)

### Cost is not token count
- "Token Reduction Is Not Cost Reduction" (arXiv 2607.12161, July 2026, preprint): removing 38% of tool-output tokens raised paired cost by 6.8%; per-task token reduction was weakly tied to cost. Judge by success-adjusted billed cost. Source: https://arxiv.org/abs/2607.12161
- Implication: our earlier finding fits this: the gateway had more tokens but less cost, because cache reads are cheap. Always report billed cost and pass rate together; never claim a saving from tokens alone.
- Vendor "compression" claims were contradicted by an independent test (JetBrains SkillsBench: a tool that claims 60–90% savings produced a 7.6% cost increase). Treat marketing numbers as unverified.

### Subagents and context isolation
- Subagents get their own context; each spawn repeats base overhead. Cost multipliers (4–7x) are secondhand; no primary Anthropic figure found. Measure with our own runs before adopting subagents for cost.

### Tool-result injection classifiers
- Prompt Guard 2 (86M): vendor-reported ~97.5% detection at 1% false positives; not independently verified; Meta publishes no CPU latency. Source: https://arxiv.org/pdf/2605.30837 (routing detectors by latency budget; read for method).
- Production guidance (practitioner): keep false positives under about 2% before blocking; log-only period first. Benign tool content (docs, code, security text) triggers the same patterns.
- Implication: a classifier on tool outputs would block benign results at our scale; use it only as log-only telemetry first.

### Reasoning effort
- Lower reasoning effort reduces output tokens with little quality loss on routine tasks (blog, attribution unverified). Our benchmark already uses low effort for every arm, so this is a fixed condition, not a lever to tune now.

### Statistics for our benchmarks
- Single-run evals are statistically weak; estimate pass rate from several runs per task and report intervals (arXiv 2602.07150; variance 2.2–6.0% reported). Our 3 reps per task is at the low end; per-task variance matters.
- Ranking can flip: the top strategy wins only 77% of head-to-head runs (ReasonBENCH, arXiv 2512.07795). So a 2–5% gap between arms (like 111 vs 107 of 120) is not a verdict.
- Implication: the gateway-vs-hook gap is within noise. Any claim needs bootstrap CIs over tasks and reps, which report.py does not yet compute.

### RAG-MCP (tool retrieval) details
- Retrieval over tool metadata: selection accuracy 13.62% (full catalog) to 43.13% (retrieved), prompt tokens 2134 to 1084 (secondary summary; arXiv 2505.03275). Verify numbers in the paper before citing.

### Round 35 conclusions
1. Report success-adjusted billed cost per task (the metric the arXiv paper proposes), with bootstrap CIs over tasks.
2. Do not call the gateway cheaper or the hook more accurate from current numbers; both differences are within noise.
3. Any injection classifier starts as log-only; false-positive budget must be measured on our own benign set.

## Rounds 36-40 (batch 8)

### Over-refusal
- NotInject (InjecGuard, ACL 2025): 339 benign prompts with trigger words; guard models drop to near-chance accuracy on them. Source: https://arxiv.org/abs/2410.22770v1
- Implication: any detector we add must be scored on hard benign cases (skill text that mentions secrets, curl, "ignore") or it will block legitimate skills.

### Per-request tool exposure
- Scoping tools per role or per request reduces what a compromised agent can reach; no measured attack-reduction study found. Source: https://docs.getbifrost.ai/features/governance/mcp-tools (vendor feature).
- Pinned tool maps fail for dynamic, per-session tool names; diff `tools/list` per session. Source: https://dev.to/luckypipewrench/your-mcp-servers-tool-descriptions-are-an-attack-surface-37pj
- Implication: our compact tools already limit exposure; per-task scoping of `call_capability` (planned) is the real extension.

### Plan-then-act and autonomy
- PRUDENTIA (Kolluri et al., ICLR 2026, arXiv 2602.11416): measures autonomy (share of consequential actions run without human approval while staying secure) and reports up to 1.9x fewer human approvals than SOTA, on AgentDojo and WASP (secondary summary). Source: https://arxiv.org/abs/2602.11416
- Plan-validate-execute: validate the plan in a trusted state before reading untrusted data; human checks work better during execution than at planning. Source: https://www.themoonlight.io/fr/review/architecting-resilient-llm-agents-a-guide-to-secure-plan-then-execute-implementations
- Implication: a cheap version for us is a plan step before any action in a session; cost is one planning turn.

### Claude Code auto mode (for context)
- Anthropic's auto mode (March 2026 preview per secondary sources) uses a two-stage transcript classifier before tool calls; blocks after repeated denials. Several dates and figures are unverified secondary claims. Source: https://claudefa.st/blog/guide/development/auto-mode
- Implication: an agent-side classifier exists in the product; our guard is deterministic and does not replace it. Document that our hooks run alongside whatever permission mode the user has.

### Indirect injection: structural defences
- Privilege separation: the action agent never sees raw untrusted content; quarantined model outputs structured data only (dual-LLM pattern; blog-level evidence). Sources: https://arxiv.org/pdf/2603.13424 and https://jvoltci.github.io/mosaic/applied/frontier/safety
- CausalArmor (Google, ICML 2026): sanitize only when an untrusted input drives a privileged action (attribution). Source: https://research.google/pubs/causal-armor-efficient-indirect-prompt-injection-guardrails-via-causal-attribution/
- DataFilter (arXiv 2510.19207, SaTML 2026): filtering reduces attack success near zero in its tests (own evaluation). Source: https://arxiv.org/abs/2510.19207
- Implication: CausalArmor-style triggering is the cheapest structural idea that fits our gateway: only sanitize or gate when a tool result would drive an action. Needs a measurable test before adoption.

## FINAL SUMMARY (40 rounds)

### What the evidence supports
1. **Obedience cannot be solved by text.** Marking, reminders and detectors each help only partly, fail against adaptive attackers, and raise false positives. Keep marking as cheap extra; do not claim a text defence.
2. **Action limits are the reliable layer.** Sandbox, deny rules, and session without shell gave 0 harmful runs in our action benchmark (with the caveats recorded).
3. **Strongest next security steps (ordered):**
   a. Replace `guard`'s regex Bash matching with an AST-based policy (GuardFall evidence: regex checks fail on built-ins, substitution, encodings).
   b. Per-task tool scoping in `call_capability`: deny tools the task did not select (least privilege per task).
   c. Hash-chained gateway audit log per tool call (verification for a and b).
   d. Test DNS exfiltration against our sandbox settings; add to the action benchmark.
   e. Consider CausalArmor-style gating only if measured to help; log-only first.
4. **Cost:**
   a. Keep stable prefix and late skill text (already the hook's design).
   b. Judge by success-adjusted billed cost, not token counts (arXiv 2607.12161). The gateway's lower cost came from cheap cache reads despite more tokens.
   c. Routing: an embedding index over skill text beats keyword routing (SkillRouter evidence); measure recall@k before changing the cap of 3.
   d. Do not add a per-call LLM judge: it costs latency and tokens on every call and has not been shown to help on our data.
5. **Statistics:** the gateway-vs-hook gap (111 vs 107 of 120) is within noise. Report bootstrap CIs over tasks and reps before any ranking.

### Limits of this research
- Most sources are preprints, vendor blogs or secondary summaries; key numbers are marked unverified above.
- No 2026 head-to-head of marking vs action limits vs classifiers on tool agents was found.
- MCP spec text on server instructions and on tool-result trust was not read from the primary spec.
- Anthropic-specific numbers (cache TTL prices, auto-mode dates) need checking against platform.claude.com before use.

### Next step if approved
Implement 3a–3c as a plan (AST guard, per-task scope, audit log), then rerun the action benchmark with the new DNS and obfuscation attacks, and the 40-task cost benchmark with CIs.

## Plain-English obedience: blocking it (research, after corrected benchmark: 18/52, 53% of installed plain-English runs)

- **Progent** (arXiv 2504.11703, UC Berkeley/UCSB): a policy layer between agent and tools, default-deny per tool call. Self-reported AgentDojo IPI ASR 41.2% to 2.2%; LLM-generated policies do well but not perfectly; adaptive tests on policy generation reported. Authors' evaluation only. Fits our gateway: per-task policy on `call_capability` (already partly built as per-session selection). https://arxiv.org/html/2504.11703v2
- **MELON** (ICML 2025, arXiv 2502.05174): re-runs the agent with user input masked; if the tool calls stay the same, they came from injected data and are flagged. Authors report >99% prevention on AgentDojo (self-reported). Costs roughly one extra model run per task, which conflicts with our cost goal unless applied only to high-risk actions. https://arxiv.org/html/2502.05174v4 , code https://github.com/ucsb-mlsec/MELON
- **Task Shield** (ACL 2025, arXiv 2412.16682): checks each instruction and tool call against the user's goal. AgentDojo ASR 2.07% with GPT-4o at 69.79% utility (authors' evaluation). https://arxiv.org/html/2412.16682v1
- **Adaptive-attack warning (2026, RETA and an alignment-check evasion paper):** alignment checks collapse under adaptive attacks, and malicious instructions disguised as environment errors evade them. So per-action checks are necessary but not sufficient. https://arxiv.org/html/2510.17276v2
- **Skill-specific:** SkillGuard (arXiv 2606.03024, v1 preprint): skill manifest declares capabilities; runtime checks each action against live policy. "Skills as Verifiable Artifacts" (arXiv 2605.00424): signature proves endorsement, not behaviour; require human approval for irreversible calls unless the action is inside the verified manifest. SKILL-INJECT (arXiv 2602.20156): skill-based injection benchmark. https://arxiv.org/abs/2606.03024 , https://arxiv.org/html/2605.00424v2 , https://arxiv.org/abs/2602.20156

### What this means for us
1. The model will follow plain text. Defences must decide on the action, not on the text.
2. Strongest fit for our architecture: **capability manifests + per-task tool policy** (Progent/SkillGuard idea). A skill declares which tools/paths it needs; the gateway allows only those, default-deny. Cheap: no extra model call.
3. For high-impact actions only (network, writes outside project, secrets), add an **alignment check** (Task Shield style, one small extra call) or require approval. Cost limited to those actions.
4. MELON-style re-execution is accurate but roughly doubles cost per task; reserve it for later.
5. Be honest in claims: per-action checks reduce ASR on benchmarks but adaptive attacks remain a known weakness.
