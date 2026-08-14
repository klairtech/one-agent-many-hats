/**
 * Model Context Protocol client types.
 *
 * MCP is how this runtime gets tools it did not ship with: filesystem servers, browser
 * automation, databases, issue trackers, anything with a server. The architectural point
 * is that an MCP tool is not a special case — it becomes an ordinary registry entry and
 * goes through the same executor, the same allowlist intersection, the same profile gate,
 * the same approval prompt and the same audit trail as a built-in.
 */

import type { JsonSchema } from '../providers/types.js';

export type McpTransport = 'stdio' | 'http';

export interface McpServerConfig {
  transport?: McpTransport;
  /** stdio: the executable to spawn. */
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  /** http: the endpoint. */
  url?: string;
  headers?: Record<string, string>;
  /** Skip this server without deleting its config. */
  disabled?: boolean;
  /** Seconds to wait for the handshake before giving up. */
  timeoutMs?: number;
  /**
   * Tools from this server that may run without per-call approval. Everything else from
   * an MCP server is treated as mutating, because we cannot see what it does.
   */
  trustedTools?: string[];
}

export interface McpToolAnnotations {
  title?: string;
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

export interface McpToolDescriptor {
  name: string;
  description?: string;
  inputSchema?: JsonSchema;
  annotations?: McpToolAnnotations;
}

export interface McpContentBlock {
  type: string;
  text?: string;
  data?: string;
  mimeType?: string;
  resource?: { uri?: string; text?: string; mimeType?: string };
}

export interface McpCallResult {
  content?: McpContentBlock[];
  structuredContent?: unknown;
  isError?: boolean;
}

export interface McpServerInfo {
  name: string;
  version?: string;
  protocolVersion?: string;
  instructions?: string;
}

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params?: unknown;
}

export interface JsonRpcNotification {
  jsonrpc: '2.0';
  method: string;
  params?: unknown;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

/** The protocol revision this client advertises. Servers may negotiate down. */
export const CLIENT_PROTOCOL_VERSION = '2025-06-18';

export const CLIENT_INFO = { name: 'hats', version: '0.1.0' };

/** Namespaced so an MCP tool can never shadow a built-in. */
export function mcpToolName(server: string, tool: string): string {
  return `mcp__${server}__${tool}`;
}

export function parseMcpToolName(name: string): { server: string; tool: string } | null {
  const m = /^mcp__([^_]+(?:_[^_]+)*?)__(.+)$/.exec(name);
  if (!m || !m[1] || !m[2]) return null;
  return { server: m[1], tool: m[2] };
}
