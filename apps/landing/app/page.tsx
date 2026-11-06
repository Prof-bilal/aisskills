"use client";

import { useEffect, useState } from "react";

const installCommand = "npm install -g @prof-bilal/aiskills@beta";

function Arrow() {
  return <span aria-hidden="true">↗</span>;
}

function Spark({ tone = "violet" }: { tone?: "violet" | "mint" | "amber" }) {
  return <span aria-hidden="true" className={`spark spark-${tone}`} />;
}

function NpmDownloads() {
  const [downloads, setDownloads] = useState<number | null>(null);

  useEffect(() => {
    let active = true;
    fetch("/api/npm-downloads")
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { downloads?: number } | null) => {
        if (active && typeof data?.downloads === "number") setDownloads(data.downloads);
      })
      .catch(() => undefined);

    return () => {
      active = false;
    };
  }, []);

  return (
    <a className="npm-stat" href="https://www.npmjs.com/package/@prof-bilal/aiskills" target="_blank" rel="noreferrer">
      <span className="npm-badge">npm</span>
      <span><b>{downloads === null ? "—" : new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(downloads)}</b> all-time</span>
    </a>
  );
}

export default function Home() {
  const [copied, setCopied] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  async function copyInstall() {
    await navigator.clipboard.writeText(installCommand);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  return (
    <main id="main-content">
      <a className="skip-link" href="#main-content">Skip to content</a>
      <nav className="nav shell" aria-label="Primary navigation">
        <a className="brand" href="#top" aria-label="AI Skills home">
          <span className="brand-mark"><span /><span /><span /></span>
          <span>AI SKILLS</span>
        </a>
        <NpmDownloads />
        <button className="menu-toggle" type="button" aria-expanded={menuOpen} aria-controls="nav-links" onClick={() => setMenuOpen(!menuOpen)}>
          <span className="sr-only">Toggle navigation</span>
          <span /><span />
        </button>
        <div id="nav-links" className={`nav-links ${menuOpen ? "nav-links-open" : ""}`}>
          <a href="#why">Why AI Skills</a>
          <a href="#how">How it works</a>
          <a href="#security">Security</a>
          <a href="https://github.com/Prof-bilal/aisskills" target="_blank" rel="noreferrer">GitHub <Arrow /></a>
          <a className="nav-cta" href="#install">Install <Arrow /></a>
        </div>
      </nav>

      <div id="top" className="hero shell">
        <div className="hero-copy">
          <div className="eyebrow"><Spark /> THE CAPABILITY LAYER FOR AI AGENTS</div>
          <h1>Stop loading the whole toolbox.</h1>
          <p className="hero-lede">AI Skills gives Claude Code, Codex, and your own agents the right skills and tools at the right moment—so every task starts focused, secure, and ready to ship.</p>
          <div className="hero-actions" id="install">
            <a className="button button-primary" href="https://github.com/Prof-bilal/aisskills" target="_blank" rel="noreferrer">Explore the project <Arrow /></a>
            <button className="install-chip" type="button" onClick={copyInstall} aria-label="Copy npm install command">
              <span className="prompt">$</span><code>npm i -g @prof-bilal/aiskills@beta</code><span className="copy-state">{copied ? "Copied" : "Copy"}</span>
            </button>
          </div>
          <div className="hero-note"><span className="status-dot" /> Open source · local-first · beta on npm</div>
        </div>

        <div className="hero-visual" aria-label="AI Skills capability routing preview">
          <div className="visual-glow" />
          <div className="agent-window">
            <div className="window-bar"><span className="window-dots"><i /><i /><i /></span><span className="window-title">aiskills / session</span><span className="window-live">● live</span></div>
            <div className="window-body">
              <div className="task-line"><span className="task-icon">✦</span><span>Build a secure Supabase auth flow</span><span className="task-time">just now</span></div>
              <div className="route-label">ROUTED CAPABILITIES <span>4 selected · 28 available</span></div>
              <div className="capability-list">
                <div className="capability active"><span className="cap-icon icon-violet">⌘</span><div><b>supabase-engineer</b><small>database · auth · RLS</small></div><em>loaded</em></div>
                <div className="capability active"><span className="cap-icon icon-mint">⌁</span><div><b>secrets-review</b><small>credentials · environment</small></div><em>loaded</em></div>
                <div className="capability active"><span className="cap-icon icon-amber">◈</span><div><b>playwright</b><small>browser verification</small></div><em>ready</em></div>
              </div>
              <div className="window-divider" />
              <div className="guard-row"><span className="shield">◇</span><span>Warden checked package snapshots</span><strong>PASS</strong></div>
              <div className="terminal-line"><span>agent</span><span className="terminal-caret">›</span><span>load_skill("supabase-engineer")</span><span className="terminal-ok">✓</span></div>
            </div>
            <div className="window-footer"><span>context used <b>3.1k</b> / 16k</span><span>policy <b>locked</b></span></div>
          </div>
          <div className="float-card float-top"><Spark tone="mint" /><span>Only what the task needs</span></div>
          <div className="float-card float-bottom"><span className="mini-lock">⌑</span><span>Untrusted tools stay behind a gate</span></div>
        </div>
      </div>

      <div className="trust-bar shell"><span>BUILT FOR THE AGENTS YOU ALREADY USE</span><div><b>CLAUDE CODE</b><b>CODEX</b><b>CURSOR</b><b>OPEN CODE</b></div></div>

      <section className="section shell" id="why">
        <div className="section-kicker">01 / THE PROBLEM</div>
        <div className="section-heading"><h2>Your agent is smart. Its startup context is not.</h2><p>Every always-on skill, plugin, and MCP server adds noise, cost, and another trust boundary. AI Skills turns a sprawling catalog into a small, reviewable capability surface.</p></div>
        <div className="problem-grid">
          <article className="problem-card problem-dark"><div className="card-index">01</div><h3>Context bloat</h3><p>Keep the catalog installed without forcing every instruction into every conversation.</p><div className="bars"><i /><i /><i /><i /><i /><i /></div><small>all capabilities loaded</small></article>
          <article className="problem-card"><div className="card-index">02</div><h3>Tool sprawl</h3><p>Make discovery intentional. Agents search a compact gateway before an executable tool ever connects.</p><div className="tool-orbit"><span>git</span><span>mcp</span><span>web</span><span>db</span><b>route</b></div></article>
          <article className="problem-card problem-accent"><div className="card-index">03</div><h3>Trust gaps</h3><p>Scan, snapshot, review, and lock external skills before they become part of a project.</p><div className="scan-row"><span>WARDEN</span><b>VERIFIED</b><span>LOCKFILE</span></div></article>
        </div>
      </section>

      <section className="section section-how shell" id="how">
        <div className="section-kicker">02 / THE LOOP</div>
        <div className="section-heading"><h2>Install once. Route every task.</h2><p>Your capabilities live locally. The agent gets a precise view of them only when its work calls for it.</p></div>
        <div className="steps">
          <article className="step"><div className="step-number">01</div><div className="step-visual step-install"><span>$</span><code>aiskills install github:team/skill</code><i>✓ snapshot created</i></div><h3>Bring your own skills</h3><p>Add a local folder or a GitHub repository. AI Skills snapshots and scans it before activation.</p></article>
          <article className="step"><div className="step-number">02</div><div className="step-visual step-route"><span className="route-node">intent</span><i>→</i><span className="route-node route-selected">4 skills</span><i>→</i><span className="route-node">agent</span></div><h3>Route by intent</h3><p>Match the task to relevant skills, tools, packs, and workflows instead of exposing the entire catalog.</p></article>
          <article className="step"><div className="step-number">03</div><div className="step-visual step-lock"><span>W</span><b>policy locked</b><i>tool call approved</i></div><h3>Execute behind guardrails</h3><p>Warden checks snapshots, policies, environment names, and result boundaries while the task runs.</p></article>
        </div>
      </section>

      <section className="section shell" id="security">
        <div className="section-kicker">03 / BUILT FOR REAL WORK</div>
        <div className="section-heading"><h2>A smaller context window. A stronger control plane.</h2><p>Designed for the messy middle between a clever prompt and a production change.</p></div>
        <div className="feature-grid">
          <article className="feature feature-large"><div className="feature-art art-context"><div className="context-ring"><span>task</span><i>+</i><span>skills</span><i>+</i><span>tools</span></div><b>focused context</b></div><div><h3>Progressive disclosure</h3><p>Discover metadata first. Load instructions second. Connect executable tools last.</p></div></article>
          <article className="feature"><div className="feature-icon"><span>◌</span></div><h3>Local-first memory</h3><p>Keep references, project context, and learned preferences in a local SQLite store.</p><a href="https://github.com/Prof-bilal/aisskills" target="_blank" rel="noreferrer">See the architecture <Arrow /></a></article>
          <article className="feature"><div className="feature-icon feature-icon-mint"><span>⌁</span></div><h3>Provider-ready</h3><p>Supabase, Firebase, Clerk, payments, frontend, backend, security—and the skills you bring.</p><a href="https://github.com/Prof-bilal/aisskills/tree/main/packages/core/skills" target="_blank" rel="noreferrer">Browse the skills <Arrow /></a></article>
          <article className="feature feature-wide"><div className="feature-art art-lock"><div className="lock-shape">⌑</div><div><b>reviewed source</b><span>immutable snapshot</span><span>project lockfile</span></div></div><div><h3>Security is part of the install</h3><p>Untrusted repositories are treated as data until scanned, reviewed, and approved. Runtime execution is explicit.</p></div></article>
        </div>
      </section>

      <section className="build-section">
        <div className="shell build-layout"><div><div className="section-kicker">04 / SHIP WITH IT</div><h2>One command to make your agent more capable.</h2><p>Use AI Skills from the CLI, wire it into a session, or embed the SDK in your own agent runtime.</p><a className="text-link" href="https://github.com/Prof-bilal/aisskills#readme" target="_blank" rel="noreferrer">Read the docs <Arrow /></a></div><div className="code-window"><div className="code-tabs"><span className="tab-active">terminal</span><span>session</span><span>sdk</span></div><pre><code><span className="code-muted"># install the runtime</span>{"\n"}<span className="code-pink">npm</span> i -g @prof-bilal/aiskills@beta{"\n\n"}<span className="code-muted"># add a capability</span>{"\n"}<span className="code-pink">aiskills</span> install github:your-team/skill{"\n"}<span className="code-muted"># review, approve, and enable</span>{"\n"}<span className="code-pink">aiskills</span> skills review skill-name{"\n"}<span className="code-pink">aiskills</span> skills enable skill-name{"\n\n"}<span className="code-green">✓ ready</span> 4 capabilities routed</code></pre></div></div>
      </section>

      <section className="final-cta shell"><div className="final-mark"><span /><span /><span /></div><div className="eyebrow"><Spark tone="mint" /> OPEN SOURCE · LOCAL-FIRST · AGENT-READY</div><h2>Make capability<br /><em>intentional.</em></h2><p>Give your agents a catalog they can actually use—and a control plane you can trust.</p><div className="hero-actions"><a className="button button-primary" href="https://github.com/Prof-bilal/aisskills" target="_blank" rel="noreferrer">Get AI Skills <Arrow /></a><button className="button button-quiet" type="button" onClick={copyInstall}>{copied ? "Copied install command" : "Copy install command"}</button></div></section>

      <footer className="footer shell"><a className="brand" href="#top"><span className="brand-mark"><span /><span /><span /></span><span>AI SKILLS</span></a><span>Capability routing for the agent era.</span><div><a href="https://github.com/Prof-bilal/aisskills" target="_blank" rel="noreferrer">GitHub</a><a href="https://www.npmjs.com/package/@prof-bilal/aiskills" target="_blank" rel="noreferrer">npm</a><a href="#top">Back to top ↑</a></div></footer>
    </main>
  );
}
