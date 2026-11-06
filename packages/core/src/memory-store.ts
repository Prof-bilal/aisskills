import Database from "better-sqlite3";
import { mkdir, readFile, lstat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createHash,randomUUID } from "node:crypto";

export type MemoryCategory = "preference" | "verified-fact" | "decision" | "observation" | "candidate-learning";
export type MemoryScope = "project" | "user";

export interface StoredMemoryRecord {
  id: string;
  category: MemoryCategory;
  content: string;
  evidence?: string[];
  createdAt: string;
}

export interface ReferenceInput {
  url: string;
  scope?: MemoryScope;
  scopeId?: string;
  sourceType?: "design" | "backend" | "general";
  title?: string;
}

export interface StoredReference {
  id: string;
  url: string;
  canonicalUrl: string;
  scope: MemoryScope;
  scopeId: string;
  sourceType: string;
  title: string | null;
  status: string;
  createdAt: string;
  lastSeenAt: string;
}

export interface PreferenceSignalInput {
  projectId: string;
  category: string;
  signal: string;
  confidence?: number;
  evidenceReferenceId?: string;
  source?: "explicit-user" | "accepted-output" | "rejected-output" | "inferred";
}

export interface StoredPreferenceSignal extends PreferenceSignalInput {
  id: string;
  confidence: number;
  source: "explicit-user" | "accepted-output" | "rejected-output" | "inferred";
  status: "candidate" | "promoted" | "rejected";
  createdAt: string;
}

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS memory_records (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL,
  scope_id TEXT NOT NULL,
  category TEXT NOT NULL,
  content TEXT NOT NULL,
  evidence_json TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS "references" (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL,
  scope_id TEXT NOT NULL,
  url TEXT NOT NULL,
  canonical_url TEXT NOT NULL,
  source_type TEXT NOT NULL,
  title TEXT,
  status TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  UNIQUE(scope, scope_id, canonical_url)
);
CREATE TABLE IF NOT EXISTS reference_artifacts (
  id TEXT PRIMARY KEY,
  reference_id TEXT NOT NULL REFERENCES "references"(id) ON DELETE CASCADE,
  artifact_type TEXT NOT NULL,
  local_path TEXT,
  extracted_json TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS preference_signals (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  category TEXT NOT NULL,
  signal TEXT NOT NULL,
  confidence REAL NOT NULL,
  evidence_reference_id TEXT REFERENCES "references"(id) ON DELETE SET NULL,
  source TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS skill_feedback (
  id TEXT PRIMARY KEY,
  skill_id TEXT NOT NULL,
  task_id TEXT,
  outcome TEXT NOT NULL,
  feedback TEXT,
  evidence TEXT,
  created_at TEXT NOT NULL
);
CREATE VIRTUAL TABLE IF NOT EXISTS memory_search USING fts5(id UNINDEXED, scope, scope_id, category, content);
`;

function now(): string { return new Date().toISOString(); }
function id(prefix: string, value: string): string { return `${prefix}-${createHash("sha256").update(value).digest("hex").slice(0, 20)}`; }

export function canonicalizeReferenceUrl(raw: string): URL {
  let parsed: URL;
  try { parsed = new URL(raw); } catch { throw new Error("Reference URL must be a valid absolute URL"); }
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error("Reference URL must use http or https");
  if(parsed.username||parsed.password)throw new Error('Reference URL cannot contain credentials');
  const host = parsed.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host === 'metadata.google.internal' || /^127\.|^10\.|^192\.168\.|^169\.254\.|^172\.(1[6-9]|2\d|3[0-1])\./.test(host)) {
    throw new Error("Reference URL cannot target local or private network addresses");
  }
  parsed.hash = "";
  return parsed;
}

export function databasePath(root = process.cwd(), scope: MemoryScope = "project"): string {
  return scope === "user" ? join(root, "aiskills.db") : join(root, ".ai", "aiskills.db");
}

export class MemoryStore {
  readonly db: Database.Database;
  private readonly scope: MemoryScope;
  private readonly scopeId: string;

  constructor(readonly path: string, scope: MemoryScope = "project", scopeId = path) {
    this.scope = scope;
    this.scopeId = scopeId;
    this.db = new Database(path);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.db.exec(SCHEMA);
  }

  close(): void { this.db.close(); }

  async migrateLegacyMemory(root: string): Promise<number> {
    const file = join(root, ".ai", "memory.json");
    let records: StoredMemoryRecord[];
    try { records = JSON.parse(await readFile(file, "utf8")) as StoredMemoryRecord[]; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return 0; throw error; }
    if (this.db.prepare("SELECT 1 FROM schema_migrations WHERE version = 1").get()) return 0;
    const insert = this.db.prepare("INSERT OR IGNORE INTO memory_records (id, scope, scope_id, category, content, evidence_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)");
    const transaction = this.db.transaction(() => {
      for (const record of records) {
        insert.run(record.id, this.scope, this.scopeId, record.category, record.content, JSON.stringify(record.evidence ?? []), record.createdAt);
        this.db.prepare("INSERT OR REPLACE INTO memory_search (id, scope, scope_id, category, content) VALUES (?, ?, ?, ?, ?)").run(record.id, this.scope, this.scopeId, record.category, record.content);
      }
      this.db.prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (1, ?)").run(now());
    });
    transaction();
    return records.length;
  }

  listMemory(): StoredMemoryRecord[] {
    const rows = this.db.prepare("SELECT id, category, content, evidence_json, created_at FROM memory_records WHERE scope = ? AND scope_id = ? ORDER BY created_at ASC").all(this.scope, this.scopeId) as Array<Record<string, string>>;
    return rows.map(row => ({ id: row.id, category: row.category as MemoryCategory, content: row.content, evidence: JSON.parse(row.evidence_json || "[]") as string[], createdAt: row.created_at }));
  }

  appendMemory(record: StoredMemoryRecord): void {
    this.db.prepare("INSERT OR REPLACE INTO memory_records (id, scope, scope_id, category, content, evidence_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run(record.id, this.scope, this.scopeId, record.category, record.content, JSON.stringify(record.evidence ?? []), record.createdAt);
    this.db.prepare("DELETE FROM memory_search WHERE id = ?").run(record.id);
    this.db.prepare("INSERT INTO memory_search (id, scope, scope_id, category, content) VALUES (?, ?, ?, ?, ?)").run(record.id, this.scope, this.scopeId, record.category, record.content);
  }

  addReference(input: ReferenceInput): StoredReference {
    const url = canonicalizeReferenceUrl(input.url);
    const canonicalUrl = url.toString();
    const scope = input.scope ?? this.scope;
    const scopeId = input.scopeId ?? this.scopeId;
    const timestamp = now();
    const referenceId = id("reference", `${scope}:${scopeId}:${canonicalUrl}`);
    this.db.prepare(`INSERT INTO "references" (id, scope, scope_id, url, canonical_url, source_type, title, status, content_hash, created_at, last_seen_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?, ?)
      ON CONFLICT(scope, scope_id, canonical_url) DO UPDATE SET last_seen_at = excluded.last_seen_at, title = COALESCE(excluded.title, "references".title)`).run(referenceId, scope, scopeId, input.url, canonicalUrl, input.sourceType ?? "general", input.title ?? null, createHash("sha256").update(canonicalUrl).digest("hex"), timestamp, timestamp);
    return this.getReference(referenceId) ?? (() => { throw new Error("Reference was not stored"); })();
  }

  getReference(referenceId: string): StoredReference | null {
    const row = this.db.prepare("SELECT id, url, canonical_url, scope, scope_id, source_type, title, status, created_at, last_seen_at FROM \"references\" WHERE id = ? AND scope = ? AND scope_id = ?").get(referenceId,this.scope,this.scopeId) as Record<string, string> | undefined;
    return row ? { id: row.id, url: row.url, canonicalUrl: row.canonical_url, scope: row.scope as MemoryScope, scopeId: row.scope_id, sourceType: row.source_type, title: row.title ?? null, status: row.status, createdAt: row.created_at, lastSeenAt: row.last_seen_at } : null;
  }

  listReferences(scope = this.scope, scopeId = this.scopeId): StoredReference[] {
    const rows = this.db.prepare("SELECT id FROM \"references\" WHERE scope = ? AND scope_id = ? ORDER BY last_seen_at DESC").all(scope, scopeId) as Array<{ id: string }>;
    return rows.map(row => this.getReference(row.id)!).filter(Boolean);
  }
  setReferenceStatus(referenceId:string,status:'acquired'|'review-required'|'failed'):void {
    if(!this.getReference(referenceId))throw new Error('Reference not found in current scope');
    this.db.prepare('UPDATE "references" SET status=? WHERE id=?').run(status,referenceId);
  }
  saveReferenceArtifact(referenceId:string,artifact:{contentHash:string;title:string;screenshotPath?:string},status:'acquired'|'review-required'):void {
    if(!this.getReference(referenceId))throw new Error('Reference not found in current scope');
    this.db.transaction(()=>{
      this.db.prepare('INSERT INTO reference_artifacts (id,reference_id,artifact_type,extracted_json,created_at) VALUES (?,?,?,?,?)').run(`artifact-${randomUUID()}`,referenceId,artifact.screenshotPath?'browser-capture':'html-extraction',JSON.stringify(artifact),now());
      this.db.prepare('UPDATE "references" SET content_hash=?,title=?,status=? WHERE id=?').run(artifact.contentHash,artifact.title,status,referenceId);
    })();
  }
  referenceArtifacts(referenceId:string):unknown[] {
    if(!this.getReference(referenceId))throw new Error('Reference not found in current scope');
    return (this.db.prepare('SELECT extracted_json FROM reference_artifacts WHERE reference_id=? ORDER BY created_at DESC LIMIT 5').all(referenceId) as {extracted_json:string}[]).map(row=>JSON.parse(row.extracted_json));
  }

  searchReferences(query: string, scope = this.scope, scopeId = this.scopeId): StoredReference[] {
    const term = `%${query.trim()}%`;
    const rows = this.db.prepare("SELECT id FROM \"references\" WHERE scope = ? AND scope_id = ? AND (canonical_url LIKE ? OR title LIKE ? OR source_type LIKE ?) ORDER BY last_seen_at DESC").all(scope, scopeId, term, term, term) as Array<{ id: string }>;
    return rows.map(row => this.getReference(row.id)!).filter(Boolean);
  }

  addPreferenceSignal(input: PreferenceSignalInput): StoredPreferenceSignal {
    const createdAt = now();
    const signal = { ...input, id: id("preference", `${input.projectId}:${input.category}:${input.signal}:${createdAt}`), confidence: Math.max(0, Math.min(1, input.confidence ?? 0.5)), source: input.source ?? "inferred", status: "candidate" as const, createdAt };
    this.db.prepare("INSERT INTO preference_signals (id, project_id, category, signal, confidence, evidence_reference_id, source, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").run(signal.id, signal.projectId, signal.category, signal.signal, signal.confidence, signal.evidenceReferenceId ?? null, signal.source, signal.status, signal.createdAt);
    return signal;
  }

  listPreferenceSignals(projectId: string, status?: StoredPreferenceSignal["status"]): StoredPreferenceSignal[] {
    const rows = this.db.prepare(`SELECT id, project_id, category, signal, confidence, evidence_reference_id, source, status, created_at FROM preference_signals WHERE project_id = ? ${status ? "AND status = ?" : ""} ORDER BY created_at DESC`).all(...(status ? [projectId, status] : [projectId])) as Array<Record<string, string | number | null>>;
    return rows.map(row => ({ id: String(row.id), projectId: String(row.project_id), category: String(row.category), signal: String(row.signal), confidence: Number(row.confidence), evidenceReferenceId: row.evidence_reference_id ? String(row.evidence_reference_id) : undefined, source: String(row.source) as StoredPreferenceSignal["source"], status: String(row.status) as StoredPreferenceSignal["status"], createdAt: String(row.created_at) }));
  }

  setPreferenceStatus(idValue: string, status: "promoted" | "rejected"): void { this.db.prepare("UPDATE preference_signals SET status = ? WHERE id = ?").run(status, idValue); }
}

export function openProjectMemoryStore(root = process.cwd()): MemoryStore {
  const path = databasePath(root, "project");
  return new MemoryStore(path, "project", root);
}

export async function ensureProjectMemoryStore(root = process.cwd()): Promise<MemoryStore> {
  const file=databasePath(root,'project');const directory=dirname(file);
  await mkdir(directory, { recursive: true });
  if((await lstat(directory)).isSymbolicLink())throw new Error('Project memory directory must not be a symlink');
  try{if((await lstat(file)).isSymbolicLink())throw new Error('Project memory database must not be a symlink');}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
  const store = openProjectMemoryStore(root);
  await store.migrateLegacyMemory(root);
  return store;
}

export async function ensureUserMemoryStore(root: string): Promise<MemoryStore> {
  await mkdir(root, { recursive: true });
  return new MemoryStore(databasePath(root, "user"), "user", root);
}

/** Only explicit, confirmed preferences influence prompts; inferred signals remain candidates. */
export async function confirmedPreferenceContext(root:string,task:string):Promise<Array<{id:string;category:string;signal:string}>> {
  const path=databasePath(root);try{if((await lstat(dirname(path))).isSymbolicLink())throw new Error('Preference directory must not be a symlink');const st=await lstat(path);if(!st.isFile()||st.isSymbolicLink())throw new Error('Preference database must be a regular file');}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return [];throw error;}
  const store=openProjectMemoryStore(root);
  try {
    const words=new Set(task.toLowerCase().split(/\W+/));
    const ui=['ui','frontend','design','layout','css','component','components'].some(w=>words.has(w));
    const backend=['backend','database','auth','authentication','server','api'].some(w=>words.has(w));
    let size=0;
    return store.listPreferenceSignals(root,'promoted').filter(p=>p.source==='explicit-user'&&(p.category==='general'||words.has(p.category.toLowerCase())||(ui&&['style','design','frontend','ui'].includes(p.category))||(backend&&['backend','database','auth'].includes(p.category)))).slice(0,8).filter(p=>{size+=p.signal.length;return p.signal.length<=1000&&size<=4000;}).map(({id,category,signal})=>({id,category,signal}));
  }finally{store.close();}
}
