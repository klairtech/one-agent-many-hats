/**
 * Authored context (paper §5, layer 4 — "the strongest persona layer, and it is authored,
 * not inferred").
 *
 * The system may read this. The system may not write it. Where the user has stated who
 * they are and how they work, we listen rather than guess; inference is the fallback for
 * what nobody wrote down.
 */

import path from 'node:path';

import { exists, writeTextAtomic } from '../core/store.js';
import fsp from 'node:fs/promises';

const MAX_CHARS = 8_000;

export const ORG_CONTEXT_TEMPLATE = `# Workspace context

<!-- Authored by you, read by the agent, never written by it.
     Delete the prompts you do not need — an empty section is better than a guessed one. -->

## What this project is

## Terminology and conventions
<!-- Names that mean something specific here, and what they mean. -->

## How I want work done
<!-- Verbosity, whether to ask or assume, what to always run before claiming done. -->

## Sensitivities
<!-- Files or areas that need care, things never to touch, anything that must be asked about. -->

## Standing instructions
<!-- Things that apply to every run in this workspace. -->
`;

export class OrgContext {
  constructor(private readonly file: string) {}

  static forWorkspace(workspaceDir: string): OrgContext {
    return new OrgContext(path.join(workspaceDir, 'org-context.md'));
  }

  get path(): string {
    return this.file;
  }

  async exists(): Promise<boolean> {
    return exists(this.file);
  }

  async read(): Promise<string> {
    try {
      const raw = await fsp.readFile(this.file, 'utf8');
      return stripComments(raw).slice(0, MAX_CHARS).trim();
    } catch {
      return '';
    }
  }

  /** Written by `hats init` from the user's own answers, or by the user's editor. */
  async write(content: string): Promise<void> {
    await writeTextAtomic(this.file, content);
  }

  async ensureTemplate(): Promise<boolean> {
    if (await this.exists()) return false;
    await this.write(ORG_CONTEXT_TEMPLATE);
    return true;
  }
}

/** HTML comments are authoring scaffolding; they should not spend context. */
function stripComments(raw: string): string {
  return raw.replace(/<!--[\s\S]*?-->/g, '').replace(/\n{3,}/g, '\n\n');
}
