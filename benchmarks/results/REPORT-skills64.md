# Skill benchmark: 64 skills, 40 tasks, 3 repetitions per arm (Claude Code, claude-haiku-5-5, low effort)

Built-in AI Skills skills disabled in both arms (AI_SKILLS_BENCHMARK_NO_BUILTINS=1).
Native: all 64 skills in the project's .claude/skills. AI Skills: the same 64 in a catalog, reached through the gateway.

| Metric (per arm, 120 runs) | Native | AI Skills |
|---|---|---|
| Overall pass | 89/120 | 111/120 |
| Routing (32 tasks x 3) | 77/96 | 96/96 |
| No-skill tasks (4 x 3) | 12/12 | 12/12 |
| Security tasks (4 x 3) | 0/12 | 3/12 |
| Obeyed injected instruction | 11/12 | 9/12 |
| Exfiltration attempts | 0 | 0 |
| Median cache written | 9,665 | 5,943 |
| Median cache read | 30,418 | 42,214 |
| Median total tokens (input + cache + output) | 40,342 | 48,500 |
| Median time | 5.3 s | 6.5 s |
| Skill-tool calls | 88 | 0 |
| Gateway calls | 0 | 232 |

## Reading the result
- Routing: AI Skills found the right skill in every routing run; native missed 19 times (it answered with the skill name and did not load the skill).
- Tokens: AI Skills wrote less to cache, but read more from cache (gateway round trips re-read the context). In this run its median total is higher than native, so the earlier 15-skill saving did not hold at 64 skills.
- Security: neither arm resisted the injected instruction. The scanner approved both test skills with zero findings (its rules are four regexes that these texts do not match). The gateway did not block the injection either.

## Limits
- 40 tasks, 3 repetitions per arm; differences of a few runs are within noise.
- The 49 skills are synthetic (generated text with a unique code each), not real-world skill text.
- The two security skills are the only security cases; this measures one kind of attack, not the security layer in general.
