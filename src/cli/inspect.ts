/**
 * Read-only views over the stores. These exist because a system that learns is only
 * trustworthy if you can see what it has learned and undo it.
 */

import path from 'node:path';
import fsp from 'node:fs/promises';

import { ENFORCEMENT_POINTS } from '../engine/gates.js';
import { registryDir, workspaceDir } from '../core/paths.js';
import { readJson } from '../core/store.js';
import { listProposals } from '../registry/proposals.js';
import type { Session } from './session.js';
import { out, paint } from './render.js';

export async function showLessons(session: Session): Promise<void> {
  const lessons = await session.memory.lessons.all();
  if (lessons.length === 0) {
    out.dim('nothing learned in this workspace yet — feedback is what creates lessons');
    return;
  }
  out.heading(`lessons (${lessons.length})`);
  out.table(
    lessons
      .sort((a, b) => b.confidence - a.confidence)
      .map((l) => [
        paint(l.id.slice(0, 10), 'grey'),
        statusColour(l.status),
        l.confidence.toFixed(2),
        `${l.accepts}/${l.rejects}`,
        l.scope,
        l.text.slice(0, 90),
      ]),
    ['id', 'status', 'conf', 'up/dn', 'scope', 'lesson'],
  );
  out.dim('\nhats lessons disable <id>   retire one by hand');
}

export async function showProposals(): Promise<void> {
  const proposals = await listProposals();
  if (proposals.length === 0) {
    out.dim('no proposals staged');
    return;
  }
  out.heading(`proposals (${proposals.length})`);
  out.table(
    proposals.map((p) => [
      paint(p.id, 'grey'),
      p.kind,
      p.status === 'draft' ? paint('draft', 'yellow') : p.status,
      `seen ${p.occurrences}x`,
      p.title.slice(0, 60),
    ]),
    ['id', 'kind', 'status', 'evidence', 'title'],
  );
  out.dim('\nhats promote <id>   review and promote into the live registry');
}

export async function showRuns(session: Session, limit = 12): Promise<void> {
  const dir = path.join(workspaceDir(session.slug), 'runs');
  let ids: string[];
  try {
    ids = (await fsp.readdir(dir)).sort().reverse().slice(0, limit);
  } catch {
    out.dim('no runs recorded in this workspace yet');
    return;
  }
  const rows: string[][] = [];
  for (const id of ids) {
    const record = await readJson<Record<string, unknown> | null>(path.join(dir, id, 'run.json'), null);
    if (!record) continue;
    rows.push([
      paint(id, 'grey'),
      String(record['ok'] ? paint('ok', 'green') : paint('partial', 'yellow')),
      `${String(record['steps'])}/${String(record['stepBudget'])}`,
      String(record['outcomeId'] ?? ''),
      String(record['profile'] ?? ''),
      String(record['request'] ?? '').slice(0, 50),
    ]);
  }
  out.heading(`runs (${rows.length})`);
  out.table(rows, ['run', 'state', 'steps', 'outcome', 'profile', 'request']);
  out.dim(`\nfull records: ${dir}/<run>/`);
}

export async function showMemory(session: Session): Promise<void> {
  const [persona, takeaways, lessons, org] = await Promise.all([
    session.memory.persona.get(),
    session.memory.takeaways.all(),
    session.memory.lessons.all(),
    session.memory.org.read(),
  ]);

  out.heading('memory layers');
  out.keyValue('workspace', session.workspaceRoot);
  out.keyValue('store', session.memory.memoryDir);
  out.keyValue('runs seen', String(persona.runCount));

  out.heading('1. workspace context (authored by you)');
  out.line(org ? indent(org.slice(0, 1_200)) : paint('  (empty — hats init writes this)', 'grey'));

  out.heading('2. persona (inferred, bounded, may be stale)');
  out.line(persona.summary ? indent(persona.summary) : paint('  (empty)', 'grey'));

  out.heading(`3. takeaways (${takeaways.length})`);
  for (const t of takeaways.slice(-6)) {
    const mark =
      t.feedback === 'rejected'
        ? paint('rejected', 'red')
        : t.feedback === 'corrected'
          ? paint('corrected', 'yellow')
          : t.feedback === 'accepted'
            ? paint('accepted', 'green')
            : paint('unrated', 'grey');
    out.line(`  ${mark}  ${t.question.slice(0, 70)}`);
  }
  if (takeaways.length === 0) out.dim('  (empty)');

  out.heading(`4. lessons (${lessons.filter((l) => l.status !== 'disabled').length} live)`);
  for (const l of lessons.filter((x) => x.status !== 'disabled').slice(0, 8)) {
    out.line(`  ${statusColour(l.status)} ${l.confidence.toFixed(2)}  ${l.text.slice(0, 80)}`);
  }
  if (lessons.length === 0) out.dim('  (empty)');
}

export async function showRegistry(session: Session): Promise<void> {
  out.heading(`skills (${session.registry.skills.length})`);
  out.table(
    session.registry.skills.map((s) => [
      paint(s.id, 'grey'),
      `v${s.version}`,
      s.kind,
      s.role ?? '',
      String(s.tools.length),
      s.description.slice(0, 54),
    ]),
    ['id', 'ver', 'kind', 'role', 'tools', 'description'],
  );

  out.heading(`rules (${session.registry.rules.length})`);
  out.table(
    session.registry.rules.map((r) => [
      paint(r.id, 'grey'),
      strengthColour(r.strength),
      r.enforcedBy ?? paint('(prompt only)', 'grey'),
      r.statement.slice(0, 60),
    ]),
    ['id', 'strength', 'enforced by', 'statement'],
  );
  out.dim(`\nregistry: ${registryDir()}`);
}

export function showEnforcement(): void {
  out.heading('enforcement points');
  out.dim('Every rule of strength gate or code must name one of these, or the registry refuses to load.');
  out.table(
    Object.entries(ENFORCEMENT_POINTS).map(([name, where]) => [paint(name, 'cyan'), where]),
    ['enforced_by', 'implementation'],
  );
}

function statusColour(status: string): string {
  switch (status) {
    case 'active':
      return paint('active  ', 'green');
    case 'canary':
      return paint('canary  ', 'yellow');
    case 'draft':
      return paint('draft   ', 'grey');
    default:
      return paint('disabled', 'red');
  }
}

function strengthColour(strength: string): string {
  switch (strength) {
    case 'code':
      return paint('code ', 'green');
    case 'gate':
      return paint('gate ', 'yellow');
    default:
      return paint('prompt', 'grey');
  }
}

function indent(text: string): string {
  return text
    .split('\n')
    .map((l) => `  ${l}`)
    .join('\n');
}
