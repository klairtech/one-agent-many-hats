/**
 * Ambient correlation context.
 *
 * The correlation identifier existed before this module, but only where it was passed by
 * hand. `runId` reached anything holding the run's Logger and stopped there — the HTTP
 * layer, which is where retries and timeouts actually happen, had no idea which run it was
 * serving, so a retry could not be attributed and a slow provider call could not be tied
 * to the step that was waiting on it. That is the classic async-boundary break: the trail
 * is intact right up to the point where the interesting thing goes wrong.
 *
 * `AsyncLocalStorage` carries it instead. Anything running inside `withContext` sees the
 * same identifiers however deep the call stack goes and however many awaits it crosses,
 * without every intermediate function growing a parameter it does not use.
 *
 * The Logger merges this into every record, so the fields below are the ones that are
 * present on *all* telemetry rather than only where someone remembered:
 *  - `runId` — follows one request across steps, tools, providers and retries
 *  - `workspace` — the local analogue of a tenant. Before this it existed only as a
 *    directory name, which is lost the moment records are read together.
 *  - `actor` — who caused this. A scheduled run and a message from a person are not the
 *    same event, and "who did this" is unanswerable from a runId alone.
 *  - `step` / `stage` — where in the flow, so a provider call can be placed in the chain.
 *
 * Explicit fields on a log call always win over the ambient ones; the context is a
 * default, not an override.
 */

import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Structural, not an import of `Logger`, so this module stays free of a cycle with
 * `logger.ts` — which imports this one to merge the context into every record.
 */
export interface EventSink {
  debug(event: string, fields?: Record<string, unknown>): void;
  info(event: string, fields?: Record<string, unknown>): void;
  warn(event: string, fields?: Record<string, unknown>): void;
  error(event: string, fields?: Record<string, unknown>): void;
}

export interface TelemetryContext {
  runId?: string;
  workspace?: string;
  /** Channel identity, `local` for a person at the CLI, or `scheduler` for a timer. */
  actor?: string;
  /** Where the work came in: `cli`, `panel`, `channel:<id>`, `scheduler`. */
  source?: string;
  step?: number;
  stage?: string;
  /**
   * Where records emitted deep in the stack should land.
   *
   * Carrying the sink, not just the identifiers, is what keeps a retry in the same file as
   * the step that provoked it. The HTTP layer has no route to the run's logger, and a
   * reader asking "was this retried" should not have to join two files to find out.
   */
  sink?: EventSink;
}

const storage = new AsyncLocalStorage<TelemetryContext>();

/** Runs `fn` with these identifiers visible to every record emitted inside it. */
export function withContext<T>(ctx: TelemetryContext, fn: () => T): T {
  const merged = { ...(storage.getStore() ?? {}), ...ctx };
  return storage.run(merged, fn);
}

export function currentContext(): TelemetryContext {
  const { sink: _sink, ...fields } = storage.getStore() ?? {};
  return fields;
}

/** The sink for records emitted below the layer that owns a logger, if a run set one. */
export function currentSink(): EventSink | undefined {
  return storage.getStore()?.sink;
}

/**
 * Narrows the ambient context in place for the remainder of the current scope.
 *
 * Used for values that change many times inside one run — `step` and `stage` advance on
 * every iteration of the engine loop, and wrapping each iteration in another `withContext`
 * would nest a new store per step for no benefit.
 */
export function setContext(patch: TelemetryContext): void {
  const store = storage.getStore();
  if (store) Object.assign(store, patch);
}
