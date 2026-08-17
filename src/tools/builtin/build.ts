/**
 * `build_tool` — the agent writes a tool that runs (ADR-0011).
 *
 * `propose_tool` stages a *contract* and a person writes the handler. That is the right
 * shape when the tool is new capability someone must think about, and the wrong shape when
 * the agent has just discovered it cannot answer an ordinary question because no connector
 * exists. This one carries an implementation, so promotion produces something callable.
 *
 * The authority lines are declared by the agent and enforced by the runner, which is the
 * only reason this is safe to expose: a handler that declares `mutating: false` is started
 * without `--allow-fs-write` and Node refuses the write regardless of what the code tries.
 */

import { HatsError } from '../../core/errors.js';
import { generatedToolsDir } from '../../core/paths.js';
import { setProposalStatus, stageProposal } from '../../registry/proposals.js';
import { atLeast } from '../../engine/autonomy.js';
import { ALL_TOOLS } from '../index.js';
import { assertUsableName, listGeneratedTools, type GeneratedTool } from '../generated/store.js';
import { smokeTest } from '../generated/verify.js';
import { shelfPackages } from '../generated/handler.js';
import { generatedHandler } from '../generated/handler.js';
import { installGeneratedTool } from '../generated/install.js';
import type { ToolHandler, ToolResult } from '../types.js';

const PROFILES = new Set(['read-only', 'assisted', 'trusted']);

const BUILD_TOOL_DESCRIPTION =
  'Write a new tool and stage it for installation. Use this when the work needs a capability no tool in your list has — a connector to a database or an API, a format this runtime cannot read — rather than reporting that you cannot do it. You write the handler and declare what it needs: mutating for filesystem writes, network for egress. Those declarations are enforced by the process it runs in, so declare accurately: a tool that says mutating:false and then writes will fail at the write, not at review.';

export const buildTool: ToolHandler = {
  spec: {
    name: 'build_tool',
    // A getter, because the shelf changes while the runtime is running: someone installs a
    // driver and the very next request should offer it. A string fixed at module load would
    // tell the model the shelf was empty for the rest of the session.
    get description(): string {
      const shelf = shelfPackages();
      return (
        BUILD_TOOL_DESCRIPTION +
        (shelf.length
          ? ` Packages available to import with ctx.import(): ${shelf.join(', ')}.`
          : ' The package shelf is empty, so only node: builtins can be imported — if a package would make the tool possible, name it and say that `hats tools add <name>` installs it.')
      );
    },
    parameters: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'snake_case, verb-first, and specific to the system it talks to — <system>_query, not data_helper.',
        },
        description: {
          type: 'string',
          description:
            'What a future run reads when deciding whether to call it. Say what it does and when to reach for it.',
        },
        parameters: {
          type: 'object',
          description:
            'JSON Schema for the arguments: {"type":"object","properties":{...},"required":[...]}.',
        },
        code: {
          type: 'string',
          description:
            'An ES module exporting `export async function run(args, ctx)` and returning {summary, payload}. ctx gives you workspaceRoot, profile, credentials (an object keyed by the names you list below) and ctx.import(specifier) for node builtins. Packages: `await ctx.import("pg")` works for anything on the shelf, and the shelf is listed for you below — a name that is not on it cannot be installed by you and by anything else in this run, so use a node: builtin or say which package a person should add. No import from this repository, and no top-level await on anything slow. For an API, call its HTTP endpoint with fetch and sign the request yourself. Keep comments to the ones that explain a decision a reader could not infer; narrating what the next line does costs tokens on every retry and tells nobody anything.',
        },
        mutating: {
          type: 'boolean',
          description: 'True if it writes to the filesystem. Grants --allow-fs-write for the workspace only.',
        },
        network: { type: 'boolean', description: 'True if it makes network requests.' },
        minProfile: {
          type: 'string',
          enum: ['read-only', 'assisted', 'trusted'],
          description: 'Lowest profile allowed to call it. Read-only tools should say read-only.',
        },
        credentials: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Names of stored credentials this tool reads. These must match, character for character, the `name` you used on the ask_user secret field that collected them — if you asked for `api_key`, declare `api_key`, not `orders_api_key`. A mismatch makes the tool permanently uncallable. Values reach the tool process and never you.',
        },
        retain: {
          type: 'string',
          enum: ['workspace', 'device', 'conversation'],
          description:
            'Where it lives afterwards. "workspace" writes it into a hats-tools folder inside the project, where it can be committed and arrives working for everyone who clones — right when the tool is part of how this project works. "device" keeps it for every workspace on this machine and nowhere else, which is right for a connector holding your own credentials. "conversation" makes it work now and vanish when the run ends, leaving nothing behind. Choose conversation for a one-off; if it is genuinely unclear between the other two, ask with ask_user rather than deciding for them.',
        },
        rationale: {
          type: 'string',
          description: 'What happened in this run that this tool would have solved.',
        },
      },
      required: ['name', 'description', 'parameters', 'code', 'rationale'],
    },
    // Writing a tool changes the machine, so it is not a read-only act.
    //
    // `mutating` stays false because this handler writes nothing itself — the install goes
    // through installGeneratedTool, and the *built* tool's own declaration decides what its
    // process may touch. But at self-extending this installs immediately, and a profile
    // whose promise is "the worst case is a wrong answer" cannot also mean "a permanent
    // tool appeared on your device". propose_tool is still read-only: staging a contract
    // changes nothing, which is the honest read-only version of this.
    mutating: false,
    network: false,
    minProfile: 'assisted',
    // `parameters` is an arbitrary JSON Schema authored by the model, and our validator
    // models a subset of JSON Schema. Validating it emptied it to `{}` — the tool installed
    // with no schema, and the next provider call died on
    // `tools.17.custom.input_schema.type: Field required`, taking the whole run with it.
    // Same reasoning as an MCP server owning its own dialect: check required fields, then
    // do not touch what we did not author.
    passthroughInput: true,
  },

  async run(args, ctx): Promise<ToolResult> {
    const name = String(args['name'] ?? '').trim();
    const code = String(args['code'] ?? '');
    const rationale = String(args['rationale'] ?? '').trim();
    const retain =
      args['retain'] === 'conversation' ? 'conversation' : args['retain'] === 'workspace' ? 'workspace' : 'device';

    const taken = [
      ...ALL_TOOLS.map((h) => h.spec.name),
      ...(await listGeneratedTools(generatedToolsDir())).map((g) => g.tool.name),
    ];
    assertUsableName(name, taken);

    if (!code.includes('export')) {
      throw new HatsError(
        'TOOL_INPUT_INVALID',
        'the code must be an ES module exporting `run` — no export statement found',
        { name },
      );
    }

    const minProfile = String(args['minProfile'] ?? 'read-only');
    if (!PROFILES.has(minProfile)) {
      throw new HatsError('TOOL_INPUT_INVALID', `minProfile must be one of ${[...PROFILES].join(', ')}`, {});
    }

    const tool: GeneratedTool = {
      name,
      description: String(args['description'] ?? '').trim(),
      parameters: asObjectSchema(args['parameters']),
      mutating: args['mutating'] === true,
      network: args['network'] === true,
      minProfile: minProfile as GeneratedTool['minProfile'],
      credentials: Array.isArray(args['credentials']) ? (args['credentials'] as unknown[]).map(String) : [],
      rationale,
      writtenBy: { runId: ctx.runId, at: new Date().toISOString() },
    };

    // Compile and load it now, under exactly the permissions it asked for. A tool that
    // cannot even be imported should fail here, in a step the agent can still recover from,
    // rather than at promotion where the only signal is a line in a log.
    const smoke = await smokeTest(tool, code, ctx.workspaceRoot);
    if (!smoke.ok) {
      return {
        summary:
          `${name} did not load: ${smoke.detail}. Nothing was staged. Fix the handler and call ` +
          `build_tool again — note that it runs in its own process and cannot import from this repository.`,
        failed: true,
        provenance: { name, stage: smoke.stage },
      };
    }

    const proposal = await stageProposal({
      kind: 'tool',
      title: name,
      rationale,
      evidence: [`run:${ctx.runId}`],
      content: describe(tool),
      createdByRun: ctx.runId,
      implementation: { tool, code, ...(retain === 'workspace' ? { scope: 'workspace' as const } : {}) },
      ...(retain === 'conversation' ? { ephemeral: true } : {}),
    });

    // Conversation-scoped: callable immediately, never written to disk. A tool built to
    // answer one question should not join the workspace's permanent list, where a later run
    // finds it and has to work out whether it is still trustworthy.
    if (retain === 'conversation' && ctx.installTool) {
      ctx.installTool(generatedHandler(tool, code));
      return {
        summary:
          `built ${name} and it is callable now, for this conversation only — nothing was ` +
          `installed on the device, and it is gone when this run ends. Declared mutating: ` +
          `${tool.mutating}, network: ${tool.network}. Say so when you deliver, and offer to ` +
          `keep it if they will want it again.`,
        payload: { id: proposal.id, tool, retained: 'conversation' },
        provenance: { name, generated: true, retained: 'conversation' },
      };
    }

    // At self-extending, install now rather than after the run. The first live run of this
    // feature built athena_query, called it, and got "no tool named athena_query exists" —
    // the gap was found, the fix was written, and the run still could not answer the
    // question. A tool that arrives after the run that needed it has not closed any loop.
    if (atLeast(ctx.config.autonomy.level, 'self-extending') && ctx.installTool) {
      const outcome = await installGeneratedTool(
        { tool, code, ...(retain === 'workspace' ? { scope: 'workspace' as const } : {}) },
        ctx.workspaceRoot,
      );
      if (outcome.installed) {
        await setProposalStatus(proposal.id, 'promoted');
        ctx.installTool(generatedHandler(tool, code));
        return {
          summary:
            `built and installed ${name} to ${outcome.dir}. ` +
            (retain === 'workspace'
              ? 'It is inside the project, so it goes into your next commit and works for anyone who clones. '
              : 'It is kept on this device, so every later run in any workspace can reuse it. ') +
            `Callable now. Declared ` +
            `mutating: ${tool.mutating}, network: ${tool.network} — those are the permissions ` +
            `its process actually gets, so a call that needs more will fail rather than escalate.`,
          payload: { id: proposal.id, tool, installed: true },
          provenance: { name, generated: true, installed: true },
        };
      }
      return {
        summary: `${name} was staged as ${proposal.id} but did not install: ${outcome.reason}`,
        failed: true,
        payload: { id: proposal.id, stage: outcome.stage },
      };
    }

    return {
      summary:
        `built ${name} and staged it as ${proposal.id}. It loaded cleanly under its declared ` +
        `permissions (mutating: ${tool.mutating}, network: ${tool.network}). It is not callable ` +
        `yet — autonomy level ${ctx.config.autonomy.level} installs it after review rather than now.`,
      payload: { id: proposal.id, tool },
      provenance: { name, generated: true },
    };
  },
};

/**
 * Every provider rejects a tool whose input schema has no `type`, and one malformed
 * generated tool is enough to fail the request for *every* tool in the list. So this
 * never returns something a provider will refuse, whatever the model sent.
 */
function asObjectSchema(raw: unknown): GeneratedTool['parameters'] {
  const schema = (raw && typeof raw === 'object' ? { ...(raw as Record<string, unknown>) } : {}) as Record<
    string,
    unknown
  >;
  if (schema['type'] !== 'object') schema['type'] = 'object';
  if (!schema['properties'] || typeof schema['properties'] !== 'object') schema['properties'] = {};
  return schema as GeneratedTool['parameters'];
}

/** The human-readable face of the manifest, for the proposal list and the panel. */
function describe(tool: GeneratedTool): string {
  return [
    `# ${tool.name}`,
    '',
    tool.description,
    '',
    '## Declared authority',
    `- mutating: ${tool.mutating}`,
    `- network: ${tool.network}`,
    `- minProfile: ${tool.minProfile}`,
    tool.credentials.length > 0 ? `- credentials: ${tool.credentials.join(', ')}` : '- credentials: none',
    '',
    '## Why',
    tool.rationale,
  ].join('\n');
}
