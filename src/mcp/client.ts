/**
 * A minimal MCP client: JSON-RPC 2.0 over stdio or streamable HTTP.
 *
 * Zero dependencies (ADR-0003), so this speaks the wire protocol directly. It implements
 * the part of MCP this runtime needs — initialize, tools/list, tools/call — and nothing
 * else. Resources, prompts and sampling are deliberately absent: sampling in particular
 * would let a server drive the model, which is exactly the kind of authority this
 * architecture keeps out of observed content.
 */

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';

import { HatsError } from '../core/errors.js';
import { readTokens, refreshTokens, usableAccessToken } from './oauth.js';
import { Logger, nullLogger } from '../core/logger.js';
import {
  CLIENT_INFO,
  CLIENT_PROTOCOL_VERSION,
  type JsonRpcResponse,
  type McpCallResult,
  type McpServerConfig,
  type McpServerInfo,
  type McpToolDescriptor,
} from './types.js';

const DEFAULT_TIMEOUT_MS = 30_000;

export class McpClient {
  private child?: ChildProcessWithoutNullStreams;
  private buffer = '';
  private nextId = 1;
  private readonly pending = new Map<
    number,
    { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }
  >();
  private closed = false;
  private sessionId?: string;

  info?: McpServerInfo;

  constructor(
    readonly name: string,
    private readonly config: McpServerConfig,
    private readonly logger: Logger = nullLogger,
  ) {}

  get transport(): 'stdio' | 'http' {
    return this.config.transport ?? (this.config.url ? 'http' : 'stdio');
  }

  private get timeoutMs(): number {
    return this.config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async connect(): Promise<McpServerInfo> {
    if (this.transport === 'stdio') await this.startChild();

    const result = (await this.request('initialize', {
      protocolVersion: CLIENT_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: CLIENT_INFO,
    })) as {
      protocolVersion?: string;
      serverInfo?: { name?: string; version?: string };
      instructions?: string;
    };

    this.info = {
      name: result.serverInfo?.name ?? this.name,
      ...(result.serverInfo?.version ? { version: result.serverInfo.version } : {}),
      ...(result.protocolVersion ? { protocolVersion: result.protocolVersion } : {}),
      ...(result.instructions ? { instructions: result.instructions } : {}),
    };

    // The spec requires this notification before normal operation.
    await this.notify('notifications/initialized', {});
    this.logger.info('mcp.connected', {
      server: this.name,
      transport: this.transport,
      protocolVersion: this.info.protocolVersion,
      serverVersion: this.info.version,
    });
    return this.info;
  }

  async listTools(): Promise<McpToolDescriptor[]> {
    const out: McpToolDescriptor[] = [];
    let cursor: string | undefined;
    do {
      const page = (await this.request('tools/list', cursor ? { cursor } : {})) as {
        tools?: McpToolDescriptor[];
        nextCursor?: string;
      };
      out.push(...(page.tools ?? []));
      cursor = page.nextCursor;
    } while (cursor && out.length < 500);
    return out;
  }

  async callTool(tool: string, args: Record<string, unknown>): Promise<McpCallResult> {
    return (await this.request('tools/call', { name: tool, arguments: args })) as McpCallResult;
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    for (const [, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(new HatsError('TOOL_FAILED', `mcp server ${this.name} closed`, {}));
    }
    this.pending.clear();
    this.child?.kill();
  }

  // --- transport ------------------------------------------------------------------

  private async startChild(): Promise<void> {
    const command = this.config.command;
    if (!command) {
      throw new HatsError('CONFIG_INVALID', `mcp server "${this.name}" has no command`, {
        server: this.name,
      });
    }
    const child = spawn(command, this.config.args ?? [], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...(this.config.env ?? {}) },
    });
    this.child = child;

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => this.onStdout(chunk));
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      // Servers log to stderr; it is diagnostics, never protocol.
      this.logger.debug('mcp.stderr', { server: this.name, text: chunk.trim().slice(0, 500) });
    });
    child.on('error', (e) => {
      this.failAll(new HatsError('TOOL_FAILED', `mcp server ${this.name}: ${e.message}`, {}));
    });
    child.on('close', (code) => {
      this.failAll(
        new HatsError('TOOL_FAILED', `mcp server ${this.name} exited with code ${code}`, {}),
      );
    });
  }

  /** stdio framing is newline-delimited JSON, one message per line. */
  private onStdout(chunk: string): void {
    this.buffer += chunk;
    let index: number;
    while ((index = this.buffer.indexOf('\n')) !== -1) {
      const line = this.buffer.slice(0, index).trim();
      this.buffer = this.buffer.slice(index + 1);
      if (!line) continue;
      try {
        this.dispatch(JSON.parse(line) as JsonRpcResponse);
      } catch {
        this.logger.debug('mcp.unparseable', { server: this.name, line: line.slice(0, 200) });
      }
    }
  }

  private dispatch(message: JsonRpcResponse): void {
    if (typeof message.id !== 'number') return; // a server-initiated notification; ignored
    const pending = this.pending.get(message.id);
    if (!pending) return;
    this.pending.delete(message.id);
    clearTimeout(pending.timer);
    if (message.error) {
      pending.reject(
        new HatsError('TOOL_FAILED', `${this.name}: ${message.error.message}`, {
          code: message.error.code,
          data: message.error.data,
        }),
      );
      return;
    }
    pending.resolve(message.result);
  }

  private failAll(error: Error): void {
    for (const [, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(error);
    }
    this.pending.clear();
  }

  private async request(method: string, params: unknown): Promise<unknown> {
    if (this.transport === 'http') return this.httpRequest(method, params);

    const id = this.nextId++;
    const payload = JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n';
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(
          new HatsError('TOOL_TIMEOUT', `mcp ${this.name}.${method} timed out after ${this.timeoutMs}ms`, {
            server: this.name,
            method,
          }),
        );
      }, this.timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      if (!this.child?.stdin.writable) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(new HatsError('TOOL_FAILED', `mcp server ${this.name} is not running`, {}));
        return;
      }
      this.child.stdin.write(payload);
    });
  }

  private async notify(method: string, params: unknown): Promise<void> {
    if (this.transport === 'http') {
      await this.httpSend({ jsonrpc: '2.0', method, params });
      return;
    }
    this.child?.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');
  }

  private async httpRequest(method: string, params: unknown): Promise<unknown> {
    const id = this.nextId++;
    const body = await this.httpSend({ jsonrpc: '2.0', id, method, params });
    if (!body) {
      throw new HatsError('TOOL_FAILED', `mcp ${this.name}.${method} returned no body`, {});
    }
    if (body.error) {
      throw new HatsError('TOOL_FAILED', `${this.name}: ${body.error.message}`, {
        code: body.error.code,
      });
    }
    return body.result;
  }

  private async httpSend(message: unknown): Promise<JsonRpcResponse | null> {
    const url = this.config.url;
    if (!url) throw new HatsError('CONFIG_INVALID', `mcp server "${this.name}" has no url`, {});

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const headers: Record<string, string> = {
        'content-type': 'application/json',
        // Streamable HTTP servers may reply with either JSON or an SSE stream.
        accept: 'application/json, text/event-stream',
        ...(this.config.headers ?? {}),
      };
      if (this.sessionId) headers['mcp-session-id'] = this.sessionId;
      // A token we already hold. An explicit Authorization header in the config wins, so a
      // server using a personal access token keeps working exactly as it did.
      const bearer = usableAccessToken(this.name);
      if (bearer && !headers['authorization']) headers['authorization'] = `Bearer ${bearer}`;

      let res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(message),
        signal: controller.signal,
      });

      // One silent refresh, then one retry. An access token that expired mid-session is the
      // ordinary case and should not surface as a failed tool call; a refresh that does not
      // work means the grant is gone, and that is a person's problem to fix.
      if (res.status === 401 && readTokens(this.name)?.refreshToken) {
        const refreshed = await refreshTokens(this.name);
        if (refreshed) {
          headers['authorization'] = `Bearer ${refreshed.accessToken}`;
          res = await fetch(url, {
            method: 'POST',
            headers,
            body: JSON.stringify(message),
            signal: controller.signal,
          });
        }
      }

      if (res.status === 401) {
        throw new HatsError(
          'MCP_SIGNIN_REQUIRED',
          `mcp ${this.name} needs you to sign in. Open Connectors and press Sign in — it opens ` +
            `the provider in your browser, and no password comes anywhere near this process.`,
          {
            server: this.name,
            url,
            wwwAuthenticate: res.headers.get('www-authenticate') ?? null,
          },
        );
      }

      const session = res.headers.get('mcp-session-id');
      if (session) this.sessionId = session;

      if (!res.ok) {
        throw new HatsError('TOOL_FAILED', `mcp ${this.name}: HTTP ${res.status}`, {
          status: res.status,
        });
      }
      if (res.status === 202) return null; // accepted notification

      const text = await res.text();
      if (!text.trim()) return null;
      const contentType = res.headers.get('content-type') ?? '';
      return contentType.includes('text/event-stream')
        ? parseSseForResponse(text)
        : (JSON.parse(text) as JsonRpcResponse);
    } finally {
      clearTimeout(timer);
    }
  }
}

/** Streamable HTTP may frame the reply as SSE; take the last `data:` payload that parses. */
export function parseSseForResponse(text: string): JsonRpcResponse | null {
  let last: JsonRpcResponse | null = null;
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) continue;
    const payload = trimmed.slice(5).trim();
    if (!payload || payload === '[DONE]') continue;
    try {
      last = JSON.parse(payload) as JsonRpcResponse;
    } catch {
      /* keep scanning */
    }
  }
  return last;
}

/** Flatten MCP content blocks into the text observation the loop consumes. */
export function renderMcpResult(result: McpCallResult): { text: string; payload: unknown } {
  const parts: string[] = [];
  for (const block of result.content ?? []) {
    if (block.type === 'text' && block.text) parts.push(block.text);
    else if (block.type === 'resource' && block.resource?.text) {
      parts.push(`[${block.resource.uri ?? 'resource'}]\n${block.resource.text}`);
    } else if (block.type === 'image') {
      parts.push(`[image: ${block.mimeType ?? 'unknown type'}, not rendered]`);
    } else {
      parts.push(`[${block.type} content]`);
    }
  }
  if (result.structuredContent !== undefined) {
    parts.push(JSON.stringify(result.structuredContent, null, 2));
  }
  return {
    text: parts.join('\n').trim() || '(the server returned no content)',
    payload: result.structuredContent ?? result.content ?? null,
  };
}
