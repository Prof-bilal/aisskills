import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { openPackageCatalog, planPackageActivation, capabilityLaunches } from 'aiskills-core';

const LIMIT = 256 * 1024;
const TIMEOUT = 15000;

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

  async search(task: string, signal?: AbortSignal) {
    signal?.throwIfAborted();
    const catalog = await openPackageCatalog();
    let entries: { id: string; entry: string }[];
    try {
      const plan = await planPackageActivation(catalog, this.project, task, {agent:this.agent});
      entries = [];
      for (const id of plan.selectedPackages) {
        if (catalog.get(id).kind === 'declarative-skill') continue;
        for (const [entry, launch] of Object.entries(await capabilityLaunches(catalog, id))) {
          if (launch.args[0] === 'connect') entries.push({ id, entry });
        }
      }
    } finally { catalog.close(); }
    const tools: unknown[] = [];
    const errors: { id: string; entry: string; error: string }[] = [];
    let truncated = entries.length > 8;
    // Bound both processes launched and tool schemas entering model context.
    for (const { id, entry } of entries.slice(0, 8)) {
      signal?.throwIfAborted();
      try {
        const list = await this.upstream(id, entry, signal, client => client.listTools({}, { timeout: TIMEOUT, signal }));
        if(list.nextCursor || list.tools.length>32)truncated=true;
        for (const tool of list.tools.slice(0, 32)) {
          const item = { id, entry, tool: tool.name, description: tool.description, inputSchema: tool.inputSchema };
          if (Buffer.byteLength(JSON.stringify([...tools, item])) > 64000) {truncated=true;break;}
          tools.push(item);
        }
      } catch (error) { errors.push({ id, entry, error: error instanceof Error ? error.message.slice(0, 500) : 'Capability unavailable' }); }
    }
    return { tools, errors, truncated, untrusted: true };
  }

  async call(id: string, entry: string, tool: string, args: Record<string, unknown>, signal?: AbortSignal) {
    if (Buffer.byteLength(JSON.stringify(args)) > 64000) throw new Error('Capability arguments exceed limit');
    return this.upstream(id, entry, signal, async client => {
      // Warden independently enforces the reviewed allowlist on tools/call.
      const list = await client.listTools({}, { timeout: TIMEOUT, signal });
      if (!list.tools.some(t => t.name === tool)) throw new Error('Tool is not advertised by the approved gateway');
      return client.callTool({ name: tool, arguments: args }, undefined, { timeout: 60000, signal });
    });
  }
}
