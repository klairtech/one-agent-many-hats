/**
 * The MCP bridge: configured servers become ordinary tools.
 *
 * The honest security note, stated here rather than in a footnote: an MCP server is a
 * separate process we do not control. `rule/network-off-by-default` governs *our* tools;
 * it cannot govern what a server does once you connect it. A browser-automation server
 * reaches the internet by definition. The boundary that remains is real but different —
 * which servers you configure, which profile you run, and per-call approval — and
 * `rule/mcp-servers-are-third-party` says so at the point of use.
 *
 * Defaults follow from that: a tool an MCP server does not mark read-only is treated as
 * mutating, which makes it absent under `read-only` and approval-gated under `assisted`.
 */

import type { HatsConfig } from '../core/config.js';
import { HatsError, toHatsError } from '../core/errors.js';
import { Logger, nullLogger } from '../core/logger.js';
import { shapeText } from '../tools/artifacts.js';
import type { ToolHandler, ToolResult } from '../tools/types.js';
import { McpClient, renderMcpResult } from './client.js';
import { mcpToolName, type McpServerConfig, type McpToolDescriptor } from './types.js';

export * from './types.js';
export { McpClient, renderMcpResult, parseSseForResponse } from './client.js';

export interface McpConnection {
  server: string;
  ok: boolean;
  toolCount: number;
  error?: string;
  serverVersion?: string;
  protocolVersion?: string;
}

export class McpManager {
  private readonly clients = new Map<string, McpClient>();
  readonly connections: McpConnection[] = [];
  readonly handlers: ToolHandler[] = [];

  constructor(
    private readonly servers: Record<string, McpServerConfig>,
    private readonly logger: Logger = nullLogger,
  ) {}

  static fromConfig(config: HatsConfig, logger: Logger = nullLogger): McpManager {
    return new McpManager(config.mcpServers ?? {}, logger);
  }

  get serverNames(): string[] {
    return Object.keys(this.servers);
  }

  /**
   * Connects every enabled server and builds their tool handlers. One server failing is
   * a warning, never a failed run — a broken MCP config should cost you that server's
   * tools, not your session.
   */
  async connectAll(): Promise<McpConnection[]> {
    const entries = Object.entries(this.servers).filter(([, c]) => !c.disabled);
    await Promise.all(entries.map(([name, conf]) => this.connectOne(name, conf)));
    return this.connections;
  }

  private async connectOne(name: string, conf: McpServerConfig): Promise<void> {
    const client = new McpClient(name, conf, this.logger);
    try {
      const info = await client.connect();
      const tools = await client.listTools();
      this.clients.set(name, client);
      for (const tool of tools) {
        this.handlers.push(this.wrap(name, conf, client, tool));
      }
      this.connections.push({
        server: name,
        ok: true,
        toolCount: tools.length,
        ...(info.version ? { serverVersion: info.version } : {}),
        ...(info.protocolVersion ? { protocolVersion: info.protocolVersion } : {}),
      });
    } catch (e) {
      const err = toHatsError(e);
      this.logger.warn('mcp.connect.failed', { server: name, error: err.message });
      this.connections.push({ server: name, ok: false, toolCount: 0, error: err.message });
      await client.close();
    }
  }

  private wrap(
    server: string,
    conf: McpServerConfig,
    client: McpClient,
    tool: McpToolDescriptor,
  ): ToolHandler {
    const readOnly =
      tool.annotations?.readOnlyHint === true || (conf.trustedTools ?? []).includes(tool.name);
    const destructive = tool.annotations?.destructiveHint === true;
    const openWorld = tool.annotations?.openWorldHint === true;

    const notes: string[] = [`[from MCP server "${server}"]`];
    if (destructive) notes.push('The server marks this destructive.');
    if (openWorld) notes.push('This reaches systems outside the workspace.');

    return {
      spec: {
        name: mcpToolName(server, tool.name),
        description: `${tool.description ?? tool.name} ${notes.join(' ')}`.trim(),
        parameters: tool.inputSchema ?? { type: 'object', properties: {} },
        // Unknown until proven otherwise: anything not marked read-only is mutating.
        mutating: !readOnly,
        // Egress is the server's to make; see the module comment.
        network: false,
        minProfile: readOnly ? 'read-only' : 'assisted',
        // The server owns its schema dialect; we check required fields and pass the rest
        // through rather than rejecting valid input our subset does not model.
        passthroughInput: true,
      },
      async run(args, ctx): Promise<ToolResult> {
        const result = await client.callTool(tool.name, args);
        const rendered = renderMcpResult(result);
        const shaped = shapeText(
          rendered.text,
          ctx.config.limits.maxToolOutputChars,
          'The full server response is stored as an artifact.',
        );
        return {
          summary: shaped.summary,
          payload: rendered.payload ?? rendered.text,
          provenance: { mcpServer: server, mcpTool: tool.name },
          failed: result.isError === true,
        };
      },
    };
  }

  describe(): Array<{ server: string; tool: string; mutating: boolean; description: string }> {
    return this.handlers.map((h) => ({
      server: h.spec.name.split('__')[1] ?? '',
      tool: h.spec.name,
      mutating: h.spec.mutating,
      description: h.spec.description.slice(0, 100),
    }));
  }

  async close(): Promise<void> {
    await Promise.all([...this.clients.values()].map((c) => c.close()));
    this.clients.clear();
  }
}

/** Fail loudly on a server that is configured but unusable, when the user asked for it. */
export function assertServerConfigured(
  config: HatsConfig,
  name: string,
): McpServerConfig {
  const server = config.mcpServers?.[name];
  if (!server) {
    throw new HatsError('CONFIG_MISSING', `no MCP server "${name}" in config`, {
      known: Object.keys(config.mcpServers ?? {}),
    });
  }
  return server;
}
