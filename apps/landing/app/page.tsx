"use client";

import { useEffect, useState } from "react";

const installCommand = "npm install -g @prof-bilal/aiskills@beta";
const github = "https://github.com/Prof-bilal/aisskills";

const catalog = [
  { name: "Core", note: "How to work", skills: ["repo-explorer", "planner", "evidence-first", "simplify", "completion-checker"] },
  { name: "Build", note: "Write the code", skills: ["frontend-engineer", "backend-engineer", "database-architect", "ui-designer", "supabase-engineer", "payments-engineer"] },
  { name: "Think", note: "Decide what to build", skills: ["researcher", "brainstorm", "idea-validator", "architecture-review", "build-vs-buy"] },
  { name: "QA", note: "Check the work", skills: ["code-reviewer", "qa-engineer", "regression-checker", "requirements-checker"] },
  { name: "Security", note: "Find the holes", skills: ["security-reviewer", "auth-security", "secrets-review", "prompt-injection-review", "threat-model"] },
];

const faqs = [
  { q: "Is this another AI agent?", a: "No. AI Skills doesn't write code itself. It sits in front of the agent you already use and decides which skills that agent gets for the task." },
  { q: "Which agents does it work with?", a: "aiskills run works with Claude Code, Codex, OpenCode, and Gemini CLI. Interactive sessions (aiskills session) currently support Claude Code and Codex." },
  { q: "Do I have to write skills myself?", a: "No. 43 skills come built in. You can also add skill folders from GitHub or your own disk, including the common SKILL.md format." },
  { q: "Does it replace MCP servers?", a: "No, it manages them. Approved MCP tools stay switched off until a task needs them, then start behind a sandbox called Warden." },
  { q: "Is a skill from GitHub safe?", a: "Not automatically. AI Skills scans each skill without running it and waits for your approval before your agent can use it. The scan catches common red flags but can't prove a skill is safe, so read what you approve." },
  { q: "What does it cost? What do I need?", a: "It's free and MIT-licensed. You need Node.js 20 or newer and at least one supported agent installed. It's currently in public beta." },
];

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
          <a href="#what">What&apos;s a skill?</a>
          <a href="#how">How it works</a>
          <a href="#catalog">Skills</a>
          <a href="#faq">FAQ</a>
          <a href={github} target="_blank" rel="noreferrer">GitHub <Arrow /></a>
          <a className="nav-cta" href="#install">Install <Arrow /></a>
        </div>
      </nav>

      <div id="top" className="hero shell">
        <div className="hero-copy">
          <div className="eyebrow"><Spark /> FREE CLI FOR CLAUDE CODE, CODEX, OPENCODE &amp; GEMINI CLI</div>
          <h1>The right skills for every task. Nothing extra.</h1>
          <p className="hero-lede">
            A <b>skill</b> is a set of written instructions that teaches your AI coding agent one job, like securing a login flow or designing a database.
            AI Skills keeps a library of them on your machine and gives your agent <b>only the skills that match the task</b>, so the rest don&apos;t crowd its context.
          </p>
          <div className="hero-actions">
            <button className="install-chip" type="button" onClick={copyInstall} aria-label="Copy npm install command">
              <span className="prompt">$</span><code>npm i -g @prof-bilal/aiskills@beta</code><span className="copy-state" aria-live="polite">{copied ? "Copied" : "Copy"}</span>
            </button>
            <a className="button button-quiet" href="#how">See how it works <Arrow /></a>
          </div>
          <div className="hero-note"><span className="status-dot" /> Open source (MIT) · runs locally · public beta on npm</div>
        </div>

        <div className="hero-visual" aria-label="Example: AI Skills picks 7 of 43 skills for a login task">
          <div className="visual-glow" />
          <div className="simple-demo">
            <div className="demo-label">1 · YOU TYPE</div>
            <div className="demo-prompt demo-command"><span className="prompt">$</span> aiskills session --agent=claude &quot;add login to my app&quot;</div>
            <div className="demo-arrow" aria-hidden="true">↓</div>
            <div className="demo-label">2 · AI SKILLS PICKS 7 OF 43 SKILLS</div>
            <div className="demo-skills"><span>auth-security</span><span>security-reviewer</span><span>threat-model</span><span>+ 4 core</span></div>
            <div className="demo-arrow" aria-hidden="true">↓</div>
            <div className="demo-result"><span className="demo-check" aria-hidden="true">✓</span><div><b>Claude Code starts with those 7</b><small>The other 36 stay out of its way until a task needs them</small></div></div>
            <div className="demo-footnote">Example. Actual picks depend on your task and project.</div>
          </div>
        </div>
      </div>

      <div className="trust-bar shell"><span>WORKS WITH THE AGENT YOU ALREADY USE</span><div><b>CLAUDE CODE</b><b>CODEX</b><b>OPENCODE</b><b>GEMINI CLI</b></div></div>

      <section className="section shell" id="what">
        <div className="section-kicker">01 / START HERE</div>
        <div className="section-heading">
          <h2>What&apos;s a skill?</h2>
          <p>Think of it as a checklist from an expert. It tells your agent how to do one kind of job well: what to look for, which steps to follow, and when it&apos;s finished. A skill is a short file of instructions. No code required.</p>
        </div>
        <div className="explain-grid">
          <div className="code-window">
            <div className="code-tabs"><span className="tab-active">auth-security</span><span>example skill</span></div>
            <pre><code><span className="code-muted">---</span>{"\n"}<span className="code-pink">name</span>: Authentication Security{"\n"}<span className="code-pink">description</span>: Review authentication flows,{"\n"}  credential handling, sessions, tokens,{"\n"}  recovery, and identity boundaries.{"\n"}<span className="code-muted">---</span>{"\n\n"}<span className="code-green">## Check</span>{"\n"}- How passwords and tokens are stored{"\n"}- Session expiry and logout{"\n"}- Password reset can&apos;t be abused</code></pre>
          </div>
          <div className="explain-points">
            <article><b>Skills make agents better at specific jobs.</b><p>An agent with a security-review skill checks for things it might otherwise skip.</p></article>
            <article><b>But collecting them has a cost.</b><p>Most setups give every installed skill and tool to the agent at the start of every chat. The more you add, the more context gets used before work starts, and the more likely the agent picks the wrong tool.</p></article>
            <article><b>AI Skills fixes that.</b><p>Keep as many skills as you like. Each task gets only the ones it needs.</p></article>
          </div>
        </div>
      </section>

      <section className="section shell" id="why">
        <div className="section-kicker">02 / WHY IT HELPS</div>
        <div className="section-heading"><h2>More skills shouldn&apos;t mean a worse agent.</h2><p>Three problems show up as soon as you give an agent more than a handful of skills and tools.</p></div>
        <div className="problem-grid">
          <article className="problem-card problem-dark"><div className="card-index">PROBLEM 01</div><h3>Context fills up</h3><p>Instructions for jobs you aren&apos;t doing take up room in every chat. <b>With AI Skills:</b> only matched skills are loaded.</p><div className="bars" aria-hidden="true"><i /><i /><i /><i /><i /><i /></div><small>without it: every skill, every chat</small></article>
          <article className="problem-card"><div className="card-index">PROBLEM 02</div><h3>Wrong tool, wrong advice</h3><p>When dozens of options are in view, agents pick the wrong one more often. <b>With AI Skills:</b> your task and project decide what&apos;s offered.</p><div className="tool-orbit" aria-hidden="true"><span>stripe</span><span>firebase</span><span>clerk</span><span>supabase</span><b>your task</b></div></article>
          <article className="problem-card problem-accent"><div className="card-index">PROBLEM 03</div><h3>Skills from strangers</h3><p>A skill from GitHub is instructions your agent will follow. <b>With AI Skills:</b> it&apos;s scanned, pinned to a version, and blocked until you approve it.</p><div className="scan-row" aria-hidden="true"><span>SCANNED</span><b>APPROVED</b><span>PINNED</span></div></article>
        </div>
      </section>

      <section className="section section-how shell" id="how">
        <div className="section-kicker">03 / HOW IT WORKS</div>
        <div className="section-heading"><h2>Three steps. Then you just describe your task.</h2><p>AI Skills runs in your terminal next to your agent. It changes what your agent starts with, not how you work.</p></div>
        <div className="steps">
          <article className="step"><div className="step-number">STEP 01</div><div className="step-visual step-install"><span>$</span><code>npm i -g @prof-bilal/aiskills@beta</code><code>aiskills init --project</code></div><h3>Install and set up</h3><p>One global install, then one setup command in your project. All 43 built-in skills are ready to use.</p></article>
          <article className="step"><div className="step-number">STEP 02</div><div className="step-visual step-install"><span>$</span><code>aiskills session --agent=claude</code><code>&nbsp;&nbsp;&quot;add login to my app&quot;</code></div><h3>Describe the task</h3><p>AI Skills matches your words and your project (for example, Supabase in your dependencies) against your skills.</p></article>
          <article className="step"><div className="step-number">STEP 03</div><div className="step-visual step-route" aria-hidden="true"><span className="route-node">43 skills</span><i>→</i><span className="route-node route-selected">7 picked</span><i>→</i><span className="route-node">your agent</span></div><h3>Your agent gets to work</h3><p>Claude Code or Codex opens with just those skills. If the task changes, it can look up more as it goes.</p></article>
        </div>
      </section>

      <section className="section shell" id="catalog">
        <div className="section-kicker">04 / WHAT&apos;S INCLUDED</div>
        <div className="section-heading"><h2>43 skills built in. Add your own anytime.</h2><p>Skills are grouped into packs, so you can turn on a whole area at once, such as <code>aiskills packs install security</code>.</p></div>
        <div className="catalog-grid">
          {catalog.map((group) => (
            <article className="catalog-card" key={group.name}>
              <h3>{group.name}</h3>
              <small>{group.note}</small>
              <div className="demo-skills">{group.skills.map((skill) => <span key={skill}>{skill}</span>)}</div>
            </article>
          ))}
        </div>
        <a className="text-link catalog-link" href={`${github}/tree/main/packages/core/skills`} target="_blank" rel="noreferrer">See all 43 skills on GitHub <Arrow /></a>
      </section>

      <section className="build-section" id="install">
        <div className="shell build-layout">
          <div>
            <div className="section-kicker">05 / QUICKSTART</div>
            <h2>Up and running in a minute.</h2>
            <p>Needs Node.js 20+ and Claude Code, Codex, OpenCode, or Gemini CLI. Want a skill from GitHub? Install it, review it, then turn it on for your project.</p>
            <a className="text-link" href={`${github}#readme`} target="_blank" rel="noreferrer">Read the full guide <Arrow /></a>
          </div>
          <div className="code-window">
            <div className="code-tabs"><span className="tab-active">terminal</span></div>
            <pre><code><span className="code-muted"># 1. install</span>{"\n"}<span className="code-pink">npm</span> i -g @prof-bilal/aiskills@beta{"\n"}<span className="code-pink">aiskills</span> init --project{"\n\n"}<span className="code-muted"># 2. use it (built-in skills work right away)</span>{"\n"}<span className="code-pink">aiskills</span> session --agent=claude &quot;add login&quot;{"\n\n"}<span className="code-muted"># optional: add a skill from GitHub</span>{"\n"}<span className="code-pink">aiskills</span> install anthropics/skills \{"\n"}  --path=skills/frontend-design{"\n"}<span className="code-pink">aiskills</span> skills review frontend-design --yes{"\n"}<span className="code-pink">aiskills</span> skills enable frontend-design</code></pre>
          </div>
        </div>
      </section>

      <section className="section shell" id="faq">
        <div className="section-kicker">06 / QUESTIONS</div>
        <div className="section-heading"><h2>Common questions</h2><p>Still unsure? <a className="inline-link" href={`${github}/issues`} target="_blank" rel="noreferrer">Ask on GitHub</a>.</p></div>
        <div className="faq-list">
          {faqs.map((item) => (
            <details className="faq-item" key={item.q}>
              <summary>{item.q}</summary>
              <p>{item.a}</p>
            </details>
          ))}
        </div>
      </section>

      <section className="final-cta shell"><div className="final-mark"><span /><span /><span /></div><div className="eyebrow"><Spark tone="mint" /> FREE · OPEN SOURCE · RUNS LOCALLY</div><h2>Every skill.<br /><em>Only when needed.</em></h2><p>Install once and keep working the way you already do.</p><div className="hero-actions"><button className="button button-primary" type="button" onClick={copyInstall}>{copied ? "Copied install command" : "Copy install command"}</button><a className="button button-quiet" href={github} target="_blank" rel="noreferrer">View on GitHub <Arrow /></a></div></section>

      <footer className="footer shell"><a className="brand" href="#top"><span className="brand-mark"><span /><span /><span /></span><span>AI SKILLS</span></a><span>The right skills for every task.</span><div><a href={github} target="_blank" rel="noreferrer">GitHub</a><a href="https://www.npmjs.com/package/@prof-bilal/aiskills" target="_blank" rel="noreferrer">npm</a><a href="#top">Back to top ↑</a></div></footer>
    </main>
  );
}
