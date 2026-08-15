/**
 * Reading the playbooks, so they can be revised rather than duplicated.
 *
 * The agent has always been able to *add* a skill or a rule. Revising one needed something
 * it did not have: the current text. Without it the only way to improve a playbook that was
 * nearly right was to write a new one from memory and hope the frontmatter matched — which
 * produces near-duplicates, and near-duplicates are the specific failure the paper warns
 * about, because tool and skill selection then comes out differently run to run.
 *
 * Read-only by construction. Writing happens through a proposal like everything else.
 */

import fsp from 'node:fs/promises';
import path from 'node:path';

import { HatsError } from '../../core/errors.js';
import { registryDir } from '../../core/paths.js';
import type { ToolHandler, ToolResult } from '../types.js';

export const readPlaybook: ToolHandler = {
  spec: {
    name: 'read_playbook',
    description:
      'Read the current source of a skill or rule, frontmatter included. Call it before revising one, so your revision starts from what is actually there rather than from what you remember. With no id, lists everything in the registry.',
    parameters: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description:
            'The playbook id, e.g. "outcome/answer" or "rule/no-invented-numbers". Omit to list them all.',
        },
      },
    },
    mutating: false,
    network: false,
    minProfile: 'read-only',
    maxSummaryChars: 12_000,
  },

  async run(args): Promise<ToolResult> {
    const id = typeof args['id'] === 'string' ? args['id'].trim() : '';
    const root = registryDir();
    const entries = await collect(root);

    if (!id) {
      const lines = entries.map((e) => `${e.id}  v${e.version}  (${e.kind})`);
      return {
        summary: `${entries.length} playbooks in the registry:\n${lines.join('\n')}`,
        payload: entries.map(({ raw: _raw, ...rest }) => rest),
      };
    }

    const found = entries.find((e) => e.id === id) ?? entries.find((e) => e.id.endsWith(`/${id}`));
    if (!found) {
      // Naming the near misses, because "rule/no-invented-numbers" and "no-invented-numbers"
      // are the same thing to a person and not to a lookup.
      const near = entries
        .filter((e) => e.id.includes(id.split('/').pop() ?? id))
        .map((e) => e.id)
        .slice(0, 5);
      throw new HatsError(
        'REGISTRY_NOT_FOUND',
        `no playbook with id "${id}"${near.length > 0 ? `. Did you mean: ${near.join(', ')}` : ''}`,
        { id },
      );
    }

    return {
      summary: `${found.id} v${found.version} (${found.kind}), from ${found.file}:\n\n${found.raw}`,
      payload: found,
      provenance: { id: found.id, version: found.version },
    };
  },
};

interface Entry {
  id: string;
  kind: 'skill' | 'rule';
  version: number;
  file: string;
  raw: string;
}

async function collect(root: string): Promise<Entry[]> {
  const out: Entry[] = [];
  for (const kind of ['skill', 'rule'] as const) {
    const dir = path.join(root, `${kind}s`);
    const files = await fsp.readdir(dir).catch(() => []);
    for (const name of files) {
      if (!name.endsWith('.md')) continue;
      const file = path.join(dir, name);
      const raw = await fsp.readFile(file, 'utf8').catch(() => '');
      if (!raw) continue;
      const id = /^id:\s*(.+)$/m.exec(raw)?.[1]?.trim();
      if (!id) continue;
      out.push({
        id,
        kind,
        version: Number(/^version:\s*(\d+)\s*$/m.exec(raw)?.[1] ?? 1),
        file,
        raw,
      });
    }
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}
