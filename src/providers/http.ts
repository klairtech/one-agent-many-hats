/**
 * Shared HTTP for provider adapters: timeout, bounded retry, uniform error mapping.
 * Zero dependencies — Node's global fetch (>= 18) is the client.
 */

import { HatsError } from '../core/errors.js';
import { currentSink } from '../core/context.js';
import { runtimeLogger } from '../core/logger.js';

/**
 * Retries used to be invisible. This layer backs off up to twice on 429s, 5xxs and network
 * failures, and emitted nothing at all — so a call that succeeded on its third attempt was
 * indistinguishable from one that succeeded immediately, and a run that was slow because a
 * provider was rate-limiting looked simply slow. Both are questions the reconstruction test
 * asks directly.
 *
 * Records go to the run's own sink when there is one (so the retry sits beside the step
 * that provoked it), and to the runtime log otherwise — a scheduler tick has no run.
 */
let fallbackSink: ReturnType<typeof runtimeLogger> | undefined;
function sink() {
  return currentSink() ?? (fallbackSink ??= runtimeLogger('http'));
}

export interface HttpOptions {
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  body?: unknown;
  timeoutMs?: number;
  signal?: AbortSignal;
  /** Retries on 408/409/429/5xx and network errors. */
  retries?: number;
  providerId: string;
}

const RETRYABLE = new Set([408, 409, 425, 429, 500, 502, 503, 504]);

export async function requestJson<T>(url: string, opts: HttpOptions): Promise<T> {
  const retries = opts.retries ?? 2;
  const timeoutMs = opts.timeoutMs ?? 120_000;
  let lastError: HatsError | undefined;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const onAbort = () => controller.abort();
    opts.signal?.addEventListener('abort', onAbort, { once: true });

    try {
      const res = await fetch(url, {
        method: opts.method ?? 'POST',
        headers: { 'content-type': 'application/json', ...(opts.headers ?? {}) },
        body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
        signal: controller.signal,
      });

      if (!res.ok) {
        const text = await safeText(res);
        const err = mapHttpError(opts.providerId, res.status, text, url);
        if (RETRYABLE.has(res.status) && attempt < retries) {
          lastError = err;
          const waitMs = await backoff(attempt, res.headers.get('retry-after'));
          sink().warn('http.retry', {
            providerId: opts.providerId,
            url: safeUrl(url),
            attempt: attempt + 1,
            of: retries,
            status: res.status,
            reason: 'retryable status',
            waitMs,
          });
          continue;
        }
        throw err;
      }
      if (attempt > 0) {
        // Say so explicitly: "it worked in the end, after N attempts" is a different fact
        // from "it worked", and only one of them explains the latency.
        sink().info('http.retry.recovered', {
          providerId: opts.providerId,
          url: safeUrl(url),
          attempts: attempt + 1,
        });
      }
      return (await res.json()) as T;
    } catch (e) {
      if (e instanceof HatsError) throw e;
      const aborted = (e as Error)?.name === 'AbortError';
      if (aborted && opts.signal?.aborted) {
        throw new HatsError('INTERRUPTED', 'request cancelled', { url });
      }
      const err = new HatsError(
        'PROVIDER_ERROR',
        aborted
          ? `${opts.providerId}: request timed out after ${timeoutMs}ms`
          : `${opts.providerId}: ${(e as Error).message}`,
        { url, attempt },
      );
      if (attempt < retries) {
        lastError = err;
        const waitMs = await backoff(attempt, null);
        sink().warn('http.retry', {
          providerId: opts.providerId,
          url: safeUrl(url),
          attempt: attempt + 1,
          of: retries,
          reason: aborted ? 'timeout' : 'network error',
          error: (e as Error).message,
          waitMs,
        });
        continue;
      }
      throw err;
    } finally {
      clearTimeout(timer);
      opts.signal?.removeEventListener('abort', onAbort);
    }
  }
  throw lastError ?? new HatsError('PROVIDER_ERROR', `${opts.providerId}: request failed`, { url });
}

async function safeText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 2_000);
  } catch {
    return '';
  }
}

/** Returns how long it actually waited, so the retry record can explain the latency. */
async function backoff(attempt: number, retryAfter: string | null): Promise<number> {
  const headerMs = retryAfter ? Number(retryAfter) * 1000 : NaN;
  const ms = Number.isFinite(headerMs)
    ? Math.min(headerMs, 20_000)
    : Math.min(500 * 2 ** attempt, 8_000) + Math.floor(Math.random() * 250);
  await new Promise((r) => setTimeout(r, ms));
  return ms;
}

/**
 * A provider URL can carry a key in its query string — Gemini's does. The generic redactor
 * would catch the known parameter names, but stripping the query here means the value never
 * reaches the record in the first place, which is the weaker assumption and the safer one.
 */
function safeUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.origin}${u.pathname}`;
  } catch {
    return url.split('?')[0] ?? url;
  }
}

function mapHttpError(providerId: string, status: number, body: string, url: string): HatsError {
  const detail = extractMessage(body);
  if (status === 401 || status === 403) {
    return new HatsError(
      'PROVIDER_UNAUTHORIZED',
      `${providerId}: ${status} — check the API key (${detail || 'no detail'})`,
      { status, url, body: body.slice(0, 400) },
    );
  }
  if (status === 400 && looksLikeNoToolSupport(body)) {
    return new HatsError(
      'PROVIDER_NO_TOOL_SUPPORT',
      `${providerId}: this model does not support native tool calling (${detail})`,
      { status, url },
    );
  }
  return new HatsError('PROVIDER_ERROR', `${providerId}: HTTP ${status} — ${detail || body.slice(0, 200)}`, {
    status,
    url,
    body: body.slice(0, 800),
  });
}

/**
 * Vendors disagree on how they say "this model has no tools". Matching on the message is
 * unavoidable; the cost of a false positive is one wasted retry in text protocol, so the
 * matcher is deliberately broad.
 */
export function looksLikeNoToolSupport(body: string): boolean {
  const b = body.toLowerCase();
  return (
    (b.includes('tool') || b.includes('function')) &&
    (b.includes('not support') ||
      b.includes("doesn't support") ||
      b.includes('does not support') ||
      b.includes('unsupported') ||
      b.includes('not available') ||
      b.includes('no tool support') ||
      b.includes('not enabled'))
  );
}

function extractMessage(body: string): string {
  try {
    const parsed = JSON.parse(body) as Record<string, unknown>;
    const err = parsed['error'];
    if (typeof err === 'string') return err;
    if (err && typeof err === 'object') {
      const m = (err as Record<string, unknown>)['message'];
      if (typeof m === 'string') return m;
    }
    const m = parsed['message'];
    if (typeof m === 'string') return m;
  } catch {
    /* not JSON */
  }
  return body.slice(0, 200);
}
