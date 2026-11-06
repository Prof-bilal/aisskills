# AI Skills landing page research

Research date: 2026-11-06

## Decision

Position AI Skills as a capability layer for coding agents, not as another
agent or MCP directory. The page should make the product's core loop legible in
the first screen: install a catalog, route only relevant capabilities, then
execute behind reviewable policies.

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

- A sharp hero promise: “Stop loading the whole toolbox.”
- A product illustration above the fold showing task routing, loaded skills,
  and Warden verification; it is intentionally illustrative, not a fake live
  session or unsupported performance claim.
- A three-step narrative: bring skills, route by intent, execute behind
  guardrails.
- A security section that explains snapshots, lockfiles, and explicit runtime
  execution without implying that untrusted code is automatically safe.
- A single install path and GitHub CTA so the page serves developers first.
- Dark, technical visual language with restrained violet/mint accents to signal
  routing and trust while keeping text contrast high.

## Constraints and follow-up

This is a static first release. It does not yet include analytics, a live
agent demo, authentication, pricing, or a waitlist form. Those should be added
only when the corresponding product flows and privacy decisions exist.
