/**
 * What the agent produced, read back off disk.
 *
 * "Outputs" was the workspace file browser, and its own blurb admitted it: the same files
 * the agent can *see*. That is a reading surface with a producing name on it. The two things
 * a run actually makes are artifacts — the evidence every cited number has to point at — and
 * the files it wrote. Both were already on disk and neither was anywhere in the panel.
 *
 * This lives outside the request handler because the one thing here that can be wrong in a
 * way nobody notices — which writes actually happened — is worth a test.
 */

import path from 'node:path';

import { readJson } from '../core/store.js';

export interface ProducedArtifact {
  id: string;
  tool: string;
  summary: string;
}

export interface ProducedRun {
  runId: string;
  request: string;
  at: string;
  ok: boolean;
  /** Workspace-relative paths of files this run actually wrote. */
  files: string[];
  artifacts: ProducedArtifact[];
}

export interface Produced {
  runs: ProducedRun[];
  /** How many run directories were read to find them. */
  scanned: number;
  /** How many are kept on disk. */
  total: number;
  /** Whether anything was left out, so the panel can say so rather than imply completeness. */
  more: boolean;
}

/** The tools that put a file on disk. Both are mutating, so both can be refused. */
const WRITERS = new Set(['write_file', 'apply_patch']);

interface Observation {
  tool?: string;
  artifactId?: string;
  summary?: string;
  ok?: boolean;
}

export async function collectOutputs(
  runsDir: string,
  opts: { scan?: number; want?: number } = {},
): Promise<Produced> {
  const scanLimit = opts.scan ?? 250;
  const want = opts.want ?? 40;

  const fsp = await import('node:fs/promises');
  const all = (await fsp.readdir(runsDir).catch(() => [] as string[])).sort().reverse();

  // Runs that produced nothing are skipped, so a fixed page of run ids can come back empty
  // while older runs did produce things. Scan further than we display, and stop at the first
  // `want` that qualify.
  const scanned = all.slice(0, scanLimit);
  const runs: ProducedRun[] = [];

  for (const id of scanned) {
    if (runs.length >= want) break;

    // One unreadable record must not take the whole panel down with it.
    const record = await readJson<Record<string, unknown> | null>(
      path.join(runsDir, id, 'run.json'),
      null,
    ).catch(() => null);
    if (!record) continue;

    const observations = (record['observations'] ?? []) as Observation[];
    const artifacts = observations
      .filter((o): o is Observation & { artifactId: string } => Boolean(o.artifactId))
      .map((o) => ({
        id: o.artifactId,
        tool: o.tool ?? '?',
        // The stored summary is prefixed with its own artifact id, because that is how the
        // model is made to cite it. The panel already shows the id in its own column, and a
        // summary is a single line there, so both the prefix and the newlines go.
        summary: (o.summary ?? '')
          .replace(/^\[art_\w+\]\s*/, '')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 160),
      }));

    // Written paths come from the artifact of the write, not from the audit trail.
    // `tool.call` is logged *before* the allowlist, the profile check, the gate and the human
    // approval (tools/executor.ts), so an audit-derived list reports files the agent was
    // stopped from writing — on a mutating tool, the usual outcome. The artifact only exists
    // if the handler returned, and its payload carries the path already resolved relative to
    // the workspace root, which is the form the file browser and /api/preview need.
    const files: string[] = [];
    for (const o of observations) {
      if (!o.artifactId || o.ok === false || !WRITERS.has(o.tool ?? '')) continue;
      const artifact = await readJson<{ payload?: { path?: unknown } } | null>(
        path.join(runsDir, id, 'artifacts', `${o.artifactId}.json`),
        null,
      ).catch(() => null);
      const written = artifact?.payload?.path;
      if (typeof written === 'string' && written && !files.includes(written)) files.push(written);
    }

    // Files only. Artifacts are *evidence* — a directory listing, a fetched page, a value
    // computed in the sandbox — and listing them here made Outputs a second copy of every
    // run's internals: a read_file sat in the same place as a deliverable, so the view
    // could not answer the question it is named after. Evidence stays in the conversation,
    // next to the citation that points at it.
    if (files.length === 0) continue;
    runs.push({
      runId: id,
      request: String(record['request'] ?? ''),
      at: String(record['startedAt'] ?? ''),
      ok: record['ok'] === true,
      files,
      artifacts,
    });
  }

  return {
    runs,
    scanned: scanned.length,
    total: all.length,
    more: runs.length >= want || scanned.length < all.length,
  };
}
