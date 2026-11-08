import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { createHash } from 'node:crypto';
import { mkdir, realpath, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { openPackageCatalog, planPackageActivation, capabilityLaunches } from 'aiskills-core';

const LIMIT = 256 * 1024;
const TIMEOUT = 15000;
const INLINE = 16 * 1024;
export type ToolRef = { id: string; entry: string; tool: string };

/** No persistent upstream cache: every request observes current host approvals. */
export class CapabilityBroker {
  private running = 0;
  constructor(private readonly project: string, private readonly agent?: 'codex'|'claude', private readonly allowExecution = false) {}

  private async upstream<T>(id: string, entry: string, signal: AbortSignal | undefined, action: (client: Client) => Promise<T>): Promise<T> {
    signal?.throwIfAborted();
    if(!this.allowExecution)throw new Error('Host must grant shell.execute for MCP execution; task sessions require --write');
    if (this.running >= 4) throw new Error('Capability concurrency limit reached');
    this.running++;
    const catalog = await openPackageCatalog().catch(error => { this.running--; throw error; });
    const client = new Client({ name: 'aiskills-broker', version: '1' });
    let transport: StdioClientTransport | undefined;
    try {
      const p = (await catalog.active(this.project)).find(p => p.id === id);
      if (!p || p.kind === 'declarative-skill') throw new Error('Executable capability is not approved and enabled in this project');
      if(this.agent && p.manifest.compatible_agents.length && !p.manifest.compatible_agents.includes(this.agent))throw new Error('Capability is incompatible with the session agent');
      const launch = (await capabilityLaunches(catalog, id))[entry];
      if (!launch || launch.args[0] !== 'connect') throw new Error('Entry is not an approved MCP runtime');
      signal?.throwIfAborted();
      // Preserve host-granted environment names for Warden's own filtering.
      // stderr cannot enter the MCP response or block an undrained pipe.
      transport = new StdioClientTransport({ ...launch, cwd: this.project,
        env: Object.fromEntries(Object.entries(process.env).filter((e): e is [string, string] => typeof e[1] === 'string')),
        stderr: 'ignore', maxBufferSize: LIMIT });
      signal?.throwIfAborted();
      await client.connect(transport, { timeout: TIMEOUT, signal });
      const result = await action(client);
      if (Buffer.byteLength(JSON.stringify(result)) > LIMIT) throw new Error('Capability response exceeds context limit');
      return result;
    } finally {
      try { await client.close(); } finally {
        try { await transport?.close(); } finally { catalog.close(); this.running--; }
      }
    }
  }

  /** Without `select`: ranked names and short descriptions only. With `select`: full schemas for those tools. */
  async search(task: string, signal?: AbortSignal, select?: ToolRef[]) {
    signal?.throwIfAborted();
    const catalog = await openPackageCatalog();
    let entries: { id: string; entry: string }[];
    try {
      const plan = await planPackageActivation(catalog, this.project, task, {agent:this.agent});
      entries = [];
      for (const id of plan.selectedPackages) {
        if (catalog.get(id).kind === 'declarative-skill') continue;
        for (const [entry, launch] of Object.entries(await capabilityLaunches(catalog, id))) {
          if (launch.args[0] === 'connect' && (!select || select.some(s => s.id === id && s.entry === entry))) entries.push({ id, entry });
        }
      }
    } finally { catalog.close(); }
    const words = new Set(task.toLowerCase().split(/\W+/).filter(w => w.length > 2));
    const found: { item: Record<string, unknown>; score: number }[] = [];
    const errors: { id: string; entry: string; error: string }[] = [];
    let truncated = entries.length > 8;
    let bytes = 0;
    // Bound both processes launched and tool schemas entering model context.
    for (const { id, entry } of entries.slice(0, 8)) {
      signal?.throwIfAborted();
      try {
        const list = await this.upstream(id, entry, signal, client => client.listTools({}, { timeout: TIMEOUT, signal }));
        if(list.nextCursor || list.tools.length>32)truncated=true;
        for (const tool of list.tools.slice(0, 32)) {
          if (select && !select.some(s => s.id === id && s.entry === entry && s.tool === tool.name)) continue;
          const description = select ? tool.description : tool.description?.slice(0, 200);
          const item = select ? { id, entry, tool: tool.name, description, inputSchema: tool.inputSchema } : { id, entry, tool: tool.name, description };
          const size = Buffer.byteLength(JSON.stringify(item));
          if (bytes + size > 64000) {truncated=true;break;}
          bytes += size;
          const text = `${tool.name} ${tool.description ?? ''}`.toLowerCase().split(/\W+/);
          found.push({ item, score: text.filter(w => words.has(w)).length });
        }
      } catch (error) { errors.push({ id, entry, error: error instanceof Error ? error.message.slice(0, 500) : 'Capability unavailable' }); }
    }
    found.sort((a, b) => b.score - a.score);
    if (!select && found.length > 20) truncated = true;
    const tools = (select ? found : found.slice(0, 20)).map(f => f.item);
    return { tools, errors, truncated, untrusted: true, ...(select ? {} : { next: 'Call search_tools again with select=[{id,entry,tool}] to get input schemas before call_capability.' }) };
  }

  async call(id: string, entry: string, tool: string, args: Record<string, unknown>, signal?: AbortSignal) {
    if (Buffer.byteLength(JSON.stringify(args)) > 64000) throw new Error('Capability arguments exceed limit');
    const result = await this.upstream(id, entry, signal, async client => {
      // Warden independently enforces the reviewed allowlist on tools/call.
      const list = await client.listTools({}, { timeout: TIMEOUT, signal });
      if (!list.tools.some(t => t.name === tool)) throw new Error('Tool is not advertised by the approved gateway');
      return client.callTool({ name: tool, arguments: args }, undefined, { timeout: 60000, signal });
    });
    const json = JSON.stringify(result);
    if (Buffer.byteLength(json) <= INLINE) return result;
    // Large results stay out of model context: save them and return a preview the agent can follow up on.
    const directory = join(this.project, '.ai', 'results');
    await mkdir(directory, { recursive: true, mode: 0o700 });
    // A repository could make .ai or .ai/results a symlink; never write outside the project.
    if (await realpath(directory) !== join(await realpath(this.project), '.ai', 'results')) throw new Error('Result directory must not be a symlink');
    await writeFile(join(directory, '.gitignore'), '*\n', { flag: 'wx' }).catch(error => { if (error.code !== 'EEXIST') throw error; });
    const path = join(directory, `${createHash('sha256').update(json).digest('hex').slice(0, 16)}.json`);
    await writeFile(path, json, { mode: 0o600 });
    const content = Array.isArray(result.content) ? result.content : [];
    const text = content.map(c => (c as { type?: string; text?: string }).type === 'text' ? (c as { text: string }).text : '').join('\n');
    return { content: [{ type: 'text', text: JSON.stringify({ untrusted: true, saved: path, bytes: Buffer.byteLength(json), preview: text.slice(0, 2048) }) }], isError: result.isError === true };
  }
}
