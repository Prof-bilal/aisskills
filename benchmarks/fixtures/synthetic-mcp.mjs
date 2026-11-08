#!/usr/bin/env node
// Deterministic stdio MCP server with N realistic tools, for scaling benchmarks.
// Tool count comes from --tools=N or SYN_TOOLS. `widget_dump` returns `bytes` characters.
import readline from 'node:readline';

const count = Number(process.argv.find(a => a.startsWith('--tools='))?.slice(8) ?? process.env.SYN_TOOLS ?? 50);
const verbs = ['list', 'get', 'create', 'update', 'delete', 'search', 'export', 'sync'];
const nouns = ['issue', 'project', 'user', 'invoice', 'deployment', 'branch', 'ticket', 'report', 'webhook', 'dataset', 'cluster', 'secret', 'workflow'];

export function syntheticTools(n) {
  const tools = [{ name: 'widget_dump', description: 'Return a large widget inventory payload of the requested size.', inputSchema: { type: 'object', properties: { bytes: { type: 'integer', minimum: 1, maximum: 400000, description: 'Number of characters to return.' } }, required: ['bytes'] } }];
  for (let i = 1; tools.length < n; i++) {
    const verb = verbs[i % verbs.length], noun = nouns[i % nouns.length];
    tools.push({
      name: `${noun}_${verb}_${i}`,
      description: `${verb[0].toUpperCase() + verb.slice(1)} ${noun} records in the connected workspace. Supports pagination, filtering by owner and status, and returns structured JSON with identifiers, timestamps and audit metadata.`,
      inputSchema: {
        type: 'object',
        properties: {
          workspace: { type: 'string', description: 'Workspace slug or identifier.' },
          [`${noun}_id`]: { type: 'string', description: `Identifier of the ${noun}.` },
          status: { type: 'string', enum: ['open', 'closed', 'archived', 'draft'], description: 'Filter by lifecycle status.' },
          owner: { type: 'string', description: 'Filter by owner login or email.' },
          limit: { type: 'integer', minimum: 1, maximum: 100, default: 25, description: 'Maximum results per page.' },
          cursor: { type: 'string', description: 'Opaque pagination cursor from a previous response.' },
        },
        required: ['workspace'],
      },
    });
  }
  return tools;
}

if (import.meta.url === `file://${process.argv[1]}` || process.env.SYN_SERVE) {
  const tools = syntheticTools(count);
  readline.createInterface({ input: process.stdin }).on('line', line => {
    const r = JSON.parse(line);
    if (r.id === undefined) return;
    let result = {};
    if (r.method === 'initialize') result = { protocolVersion: '2025-11-25', capabilities: { tools: {} }, serverInfo: { name: `synthetic-${count}`, version: '1' } };
    if (r.method === 'tools/list') result = { tools };
    if (r.method === 'tools/call') result = { content: [{ type: 'text', text: r.params.name === 'widget_dump' ? 'w'.repeat(r.params.arguments?.bytes ?? 10) : '{"ok":true}' }] };
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: r.id, result }) + '\n');
  });
}
