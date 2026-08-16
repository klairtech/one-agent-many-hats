/**
 * Installing a tool the agent wrote (ADR-0011).
 *
 * The equivalent of ADR-0010's "build passes, tests pass, or revert" — but the checks are
 * different because the risk is different. A patch edits this repository, so the repository's
 * build and test suite are exactly the right gate. A generated tool lives outside the
 * repository and cannot break either one; running `npm test` here would burn a minute
 * proving something that was never in question.
 *
 * What is in question is whether the handler loads under the permissions it declared, and
 * whether it is about to shadow something. So those are the checks.
 */

import { generatedToolsDir, workspaceToolsDir } from '../../core/paths.js';
import { ALL_TOOLS } from '../index.js';
import { assertUsableName, listGeneratedTools, writeGeneratedTool, type GeneratedTool } from './store.js';
import { smokeTest } from './verify.js';

export interface InstallOutcome {
  installed: boolean;
  stage: 'name' | 'smoke' | 'write' | 'installed';
  reason: string;
  dir?: string;
}

export async function installGeneratedTool(
  implementation: { tool: GeneratedTool; code: string; scope?: 'device' | 'workspace' },
  workspaceRoot = process.cwd(),
): Promise<InstallOutcome> {
  const { tool, code } = implementation;

  // Where it is going decides nothing about what it may do — the flags come from the
  // manifest either way. It decides who else gets it: the device directory is this machine
  // only, the workspace directory is a folder in the project that goes into a commit.
  const scope = implementation.scope === 'workspace' ? 'workspace' : 'device';
  const root = scope === 'workspace' ? workspaceToolsDir(workspaceRoot) : generatedToolsDir();

  // Re-checked at install even though build_tool checked it: a proposal can sit as a draft
  // for days, and a built-in with the same name may have shipped in between. Both homes are
  // checked whichever one is being written to, because they load into the same list.
  const installed = [...(await listGeneratedTools(generatedToolsDir()))];
  if (workspaceRoot) installed.push(...(await listGeneratedTools(workspaceToolsDir(workspaceRoot))));
  const taken = [
    ...ALL_TOOLS.map((h) => h.spec.name),
    ...installed.filter((g) => g.tool.name !== tool.name).map((g) => g.tool.name),
  ];
  try {
    assertUsableName(tool.name, taken);
  } catch (e) {
    return { installed: false, stage: 'name', reason: (e as Error).message };
  }

  // Under its own flags, exactly as it will really run. The declaration is not reviewed for
  // plausibility — it is applied, and the tool either works inside it or does not.
  const smoke = await smokeTest(tool, code, workspaceRoot);
  if (!smoke.ok) {
    return { installed: false, stage: 'smoke', reason: `${smoke.stage}: ${smoke.detail}` };
  }

  try {
    const dir = await writeGeneratedTool(tool, code, root);
    return {
      installed: true,
      stage: 'installed',
      reason:
        `installed to ${dir}; loads under mutating: ${tool.mutating}, network: ${tool.network}` +
        (scope === 'workspace' ? '. It is inside the project, so it belongs in your next commit.' : ''),
      dir,
    };
  } catch (e) {
    return { installed: false, stage: 'write', reason: (e as Error).message };
  }
}
