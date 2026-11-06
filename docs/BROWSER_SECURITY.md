# Browser reference capture boundary

The trusted parent launches a packaged Playwright worker and installed Chromium
inside Warden. The child receives no network grants and no host-home mount.
Playwright requires the HOME environment name to initialize; no credentials are
passed. Chromium's inner sandbox is disabled, so OS isolation depends on Warden.
The current evidence covers Linux, not a general browser-sandbox security claim.

The worker creates an ephemeral context, blocks service workers, WebSockets,
downloads and non-GET requests, and sends resource requests to the parent over
JSON lines. The parent accepts only public HTTPS on approved exact hosts,
validates every IPv4 DNS answer, pins connections to a validated address and
rechecks redirects. Cookies, authentication headers and browser profiles are not
forwarded. Additional asset hosts require explicit host CLI configuration.

Capture limits include 64 resource requests, eight concurrent transfers, 2 MiB
per resource, a shared streaming 16 MiB download budget, bounded DOM/accessibility
text, and a 2 MiB screenshot. Warden applies a 45-second/2 GiB process budget.
Application byte limits can overshoot by an in-flight stream chunk before abort;
they are not exact wire-bandwidth accounting. Larger pages may fail these limits.

An independent read-only Codex review identified three concrete issues during
development: unbounded draining of rejected HTTP responses, aggregate-budget
checks after buffering, and incomplete worker/broker cancellation. Rejected and
redirect responses are now destroyed; streaming shares an abortable byte budget;
failure cancels broker work, escalates termination and waits for process close.

Reproducible evidence:

- `tests/reference-limits.test.mjs` replaces HTTPS/DNS with controlled streams to
  verify rejected/redirect bodies are destroyed, byte exhaustion aborts, and
  cancelled captures cannot start another request.
- `tests/browser.test.mjs` verifies missing-Warden failure and cancellation/forced
  termination using a controlled supervisor fixture. With
  `AI_SKILLS_BROWSER_LIVE` set to a verified Warden binary it also runs the real
  Chromium renderer, proving an inline JavaScript change, accessibility snapshot
  and PNG persistence without direct browser network grants.
- A real public-page capture completed and its PNG was visually inspected.
- Screenshot reads derive the allowed artifact path from its hash and validate
  scope, resolved path, file type/size, PNG signature and content digest.

These checks do not establish resistance to every kernel/browser escape,
side-channel or concurrent local filesystem substitution. Broader adversarial,
platform and large-SPA validation remains a launch gate. No package is published
on the strength of this document alone.
