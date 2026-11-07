# AI Skills landing page research

Research date: 2026-11-06

## Decision

Revised 2026-11-07. The first version ("capability layer", "Stop loading the
whole toolbox") assumed visitors already knew what an agent skill is, never
showed the command a user types, and implied an installed GitHub skill was
immediately usable. The page now explains the product in plain language for
people who use Claude Code, Codex, OpenCode or Gemini CLI but have not heard of
skill routing.

## Source ledger

| Source | Publisher | Relevant observation |
| --- | --- | --- |
| [Next.js App Router installation](https://nextjs.org/docs/app/getting-started/installation) | Next.js | The current recommended setup uses TypeScript, App Router, and a file-system `app` route. The landing page follows that structure. |
| [Next.js deploying](https://nextjs.org/docs/app/getting-started/deploying) | Next.js | Next supports Node.js deployment and static export, keeping this static marketing page easy to deploy independently of the runtime packages. |
| [Linear homepage](https://linear.app/) | Linear | The page leads with one product promise, then shows an interface in motion and explains the workflow through focused sections. |
| [Cursor homepage](https://cursor.com/) | Cursor | The page leads with a concise coding-agent promise and puts an interactive agent workspace immediately after the hero. |
| [Vercel homepage](https://vercel.com/) | Vercel | “Agent Stack” is used as a clear product category, with an explicit developer entry point and grouped capabilities. |
| [npm download counts API](https://github.com/npm/registry/blob/main/docs/download-counts.md) | npm | The public point endpoint provides aggregate package counts but limits historical queries to 18 months, so the navbar counter sums bounded windows from the package creation date. |

## Applied design decisions

- The hero says what it is (a free CLI), who it is for (the four supported
  agents), and defines "skill" in the first sentence.
- The hero example shows the real command (`aiskills session --agent=claude`)
  and is labelled as an example, not a live session.
- Order: what is a skill → three concrete problems → three steps with real
  commands → built-in catalog by pack → quickstart → FAQ.
- The quickstart shows the true path for GitHub skills: install, review, enable.
- Supported agents match the CLI: `run` supports all four; `session` supports
  Claude Code and Codex. Cursor is not listed because it is not supported.
- No context-reduction percentage: the only measured figure comes from an
  8-skill regression fixture, not real workloads.
- Security copy stays within the README: skills are scanned, pinned and
  approved, and the scanner cannot prove a skill is safe.

## Constraints and follow-up

This is a static first release. It does not yet include analytics, a live
agent demo, authentication, pricing, or a waitlist form. Those should be added
only when the corresponding product flows and privacy decisions exist.
