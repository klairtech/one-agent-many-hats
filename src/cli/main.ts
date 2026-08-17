#!/usr/bin/env node
/**
 * `hats` — command entry point.
 */

import path from 'node:path';
import fsp from 'node:fs/promises';

import {
  apiKeyEnvName,
  configExists,
  loadConfig,
  resolveApiKey,
  resolveTier,
  saveConfig,
  type Tier,
} from '../core/config.js';
import { isHatsError, toHatsError } from '../core/errors.js';
import { hatsHome, packDir, registryDir, sandboxRunnerPath, workspaceDir } from '../core/paths.js';
import { exists, readJson } from '../core/store.js';
import { ENFORCEMENT_POINTS, knownEnforcementPoints } from '../engine/gates.js';
import { createProvider, ProviderPool } from '../providers/index.js';
import { Registry, syncPacks } from '../registry/loader.js';
import { getProposal, listProposals, promoteProposal, setProposalStatus } from '../registry/proposals.js';
import { ALL_TOOLS } from '../tools/index.js';
import { runInit } from './init.js';
import {
  showEnforcement,
  showLessons,
  showMemory,
  showProposals,
  showRegistry,
  showRuns,
} from './inspect.js';
import { createPrompter, headlessPrompter, out, paint } from './render.js';
import { execute, runRepl } from './repl.js';
import { openSession, type SessionFlags } from './session.js';

interface Args {
  command: string;
  positional: string[];
  flags: Record<string, string | boolean>;
}

function parseArgs(argv: string[]): Args {
  const flags: Record<string, string | boolean> = {};
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i] ?? '';
    if (token.startsWith('--')) {
      const [key = '', inline] = token.slice(2).split('=');
      if (inline !== undefined) {
        flags[key] = inline;
      } else {
        const next = argv[i + 1];
        if (next && !next.startsWith('--')) {
          flags[key] = next;
          i++;
        } else {
          flags[key] = true;
        }
      }
    } else {
      positional.push(token);
    }
  }
  return { command: positional[0] ?? '', positional: positional.slice(1), flags };
}

function sessionFlags(args: Args): SessionFlags {
  const f: SessionFlags = {};
  if (typeof args.flags['workspace'] === 'string') f.workspace = args.flags['workspace'];
  if (typeof args.flags['profile'] === 'string') f.profile = args.flags['profile'];
  if (typeof args.flags['provider'] === 'string') f.provider = args.flags['provider'];
  if (typeof args.flags['model'] === 'string') f.model = args.flags['model'];
  if (args.flags['network'] === true) f.network = true;
  return f;
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));

  if (args.flags['help'] === true || args.command === 'help') {
    printUsage();
    return 0;
  }
  if (args.flags['version'] === true || args.command === 'version') {
    const pkg = await readJson<{ version?: string }>(
      path.join(packDir(), '..', 'package.json'),
      {},
    );
    out.line(pkg.version ?? '0.0.0');
    return 0;
  }

  switch (args.command) {
    case 'init':
      return withPrompter((p) => runInit(p, path.resolve(String(args.flags['workspace'] ?? process.cwd()))));

    case 'doctor':
      return doctor();

    case 'verify': {
      const { verifyProvider } = await import('./verify.js');
      return verifyProvider(
        args.positional[0],
        typeof args.flags['model'] === 'string' ? args.flags['model'] : undefined,
      );
    }

    case 'models':
      return models(args.positional[0]);

    case 'run':
      return runOnce(args);

    case '':
    case 'chat':
      return chat(args);

    case 'registry': {
      const sub = args.positional[0] ?? 'ls';
      if (sub === 'sync') {
        const copied = await syncPacks(registryDir(), args.flags['force'] === true);
        out.ok(`${copied.length} file(s) synced into ${registryDir()}`);
        return 0;
      }
      if (sub === 'enforcement') {
        showEnforcement();
        return 0;
      }
      if (sub === 'show') {
        return showRegistryEntry(args.positional[1] ?? '');
      }
      const session = await openSession(sessionFlags(args));
      await showRegistry(session);
      return 0;
    }

    case 'lessons': {
      const session = await openSession(sessionFlags(args));
      const sub = args.positional[0] ?? 'ls';
      if (sub === 'disable') {
        const id = args.positional[1];
        if (!id) {
          out.fail('usage: hats lessons disable <id>');
          return 1;
        }
        const all = await session.memory.lessons.all();
        const match = all.find((l) => l.id === id || l.id.startsWith(id));
        if (!match) {
          out.fail(`no lesson matching "${id}"`);
          return 1;
        }
        await session.memory.lessons.setStatus(match.id, 'disabled', 'disabled by the user');
        out.ok(`disabled: ${match.text}`);
        return 0;
      }
      await showLessons(session);
      return 0;
    }

    case 'ui':
      return ui(args);

    case 'index': {
      const session = await openSession(sessionFlags(args));
      if (args.positional[0] === 'status') {
        const meta = await session.index.status();
        if (!meta) {
          out.dim('this workspace has not been indexed. Run `hats index`.');
          return 0;
        }
        out.heading('document index');
        out.keyValue('built', meta.builtAt);
        out.keyValue('files', String(meta.files));
        out.keyValue('passages', String(meta.chunks));
        out.keyValue(
          'search mode',
          meta.embedModel
            ? paint(`semantic + keyword (${meta.embedModel}, ${meta.dimensions}d)`, 'green')
            : paint('keyword only — no embedding model configured', 'yellow'),
        );
        return 0;
      }

      const embedder = session.pool.embedder();
      const embedModel = Object.values(session.config.providers).find((p) => p.embedModel)?.embedModel;
      out.heading(`indexing ${session.workspaceRoot}`);
      if (!embedder) {
        out.warn('no embedding model configured — the index will match wording, not meaning.');
        out.dim('  For semantic search, pull one and point a provider at it, e.g.:');
        out.dim('    ollama pull nomic-embed-text');
        out.dim('    hats config set providers.ollama.embedModel nomic-embed-text');
        out.line('');
      }

      const meta = await session.index.build({
        root: session.workspaceRoot,
        config: session.config,
        embedder,
        embedModel,
        onProgress: (m) => out.dim('  ' + m),
      });
      out.ok(
        `${meta.chunks} passages from ${meta.files} files` +
          (meta.embedModel ? ` · semantic search on (${meta.embedModel})` : ' · keyword only'),
      );
      return 0;
    }

    case 'mcp': {
      const session = await openSession(sessionFlags(args));
      if (session.mcp.serverNames.length === 0) {
        out.dim('no MCP servers configured.');
        out.line('');
        out.line('Add them to ' + paint(path.join(hatsHome(), 'config.json'), 'bold') + ' under "mcpServers",');
        out.line('in the same shape Claude Desktop uses:');
        out.line(`
  "mcpServers": {
    "playwright": { "command": "npx", "args": ["-y", "@playwright/mcp@latest"] },
    "files":      { "command": "npx", "args": ["-y", "@modelcontextprotocol/server-filesystem", "${process.cwd()}"] }
  }
`);
        out.dim('Their tools appear as mcp__<server>__<tool> and pass through the same executor.');
        return 0;
      }
      out.heading('MCP servers');
      out.table(
        session.mcp.connections.map((c) => [
          c.ok ? paint('connected', 'green') : paint('failed', 'red'),
          c.server,
          c.ok ? `${c.toolCount} tools` : '',
          c.ok ? `protocol ${c.protocolVersion ?? '?'}` : (c.error ?? ''),
        ]),
        ['state', 'server', 'tools', 'detail'],
      );
      const mcpTools = session.handlers.filter((h) => h.spec.name.startsWith('mcp__'));
      if (mcpTools.length > 0) {
        out.heading(`tools (${mcpTools.length})`);
        out.table(
          mcpTools.map((h) => [
            paint(h.spec.name, 'grey'),
            h.spec.mutating ? paint('mutating', 'yellow') : paint('read-only', 'green'),
            h.spec.minProfile,
            h.spec.description.slice(0, 60),
          ]),
          ['tool', 'kind', 'needs', 'description'],
        );
      }
      await session.mcp.close();
      return 0;
    }

    case 'stats': {
      const session = await openSession(sessionFlags(args));
      const { computeAnalytics } = await import('../analytics/index.js');
      const a = await computeAnalytics(session.slug);
      if (a.runs === 0) {
        out.dim('no runs in this workspace yet');
        return 0;
      }
      out.heading(`${a.runs} runs in ${session.workspaceRoot}`);
      out.keyValue('completed', `${a.completion.ok} of ${a.runs} (${Math.round(a.completion.rate * 100)}%)`);
      out.keyValue('steps / run', `${a.steps.mean} mean · ${a.steps.budgetExhausted} hit the budget`);
      out.keyValue('duration', `${(a.duration.meanMs / 1000).toFixed(1)}s mean · p90 ${(a.duration.p90Ms / 1000).toFixed(1)}s`);
      out.keyValue('tokens', `${a.tokens.input.toLocaleString()} in / ${a.tokens.output.toLocaleString()} out`);
      out.keyValue(
        'spend',
        `$${a.cost.usd.toFixed(4)}` +
          (a.cost.unpricedRuns > 0 ? paint(` · ${a.cost.unpricedRuns} run(s) unpriced`, 'yellow') : ''),
      );
      if (a.cost.perCompletedOutcome !== null) {
        out.keyValue('per outcome', `$${a.cost.perCompletedOutcome.toFixed(4)}`);
      }
      if (a.degradedRuns > 0) out.warn(`${a.degradedRuns} run(s) used the text tool protocol`);

      if (a.gates.length > 0) {
        out.heading('gates');
        out.table(
          a.gates.map((g) => [paint(g.ruleId, 'grey'), `${g.checks} checks`, g.failures > 0 ? paint(`${g.failures} blocked`, 'yellow') : '0 blocked']),
          ['rule', 'ran', 'stopped something'],
        );
      }
      if (a.denials.length > 0) {
        out.heading('boundaries that refused something');
        out.table(a.denials.map((d) => [paint(d.ruleId, 'grey'), `${d.count}×`]), ['rule', 'times']);
      }
      out.heading('tools');
      out.table(
        a.tools.map((t) => [paint(t.tool, 'grey'), String(t.calls), String(t.failures), String(t.denials)]),
        ['tool', 'calls', 'failed', 'denied'],
      );
      return 0;
    }

    case 'space': {
      const session = await openSession(sessionFlags(args));
      const { scanSpace, prune, formatBytes } = await import('../core/space.js');

      if (args.positional[0] === 'prune') {
        const target = args.positional[1];
        if (!target) {
          out.fail('usage: hats space prune <cache|index|artifacts|runs|memory|registry-versions> [--keep-last N] [--older-than-days N] [--yes]');
          return 1;
        }
        const dryRun = args.flags['yes'] !== true;
        const result = await prune({
          target,
          workspace: session.slug,
          ...(args.flags['keep-last'] ? { keepLast: Number(args.flags['keep-last']) } : {}),
          ...(args.flags['older-than-days'] ? { olderThanDays: Number(args.flags['older-than-days']) } : {}),
          dryRun,
        });
        if (dryRun) {
          out.warn(`dry run — would free ${formatBytes(result.bytesFreed)} across ${result.itemsRemoved} files`);
          for (const p of result.paths.slice(0, 20)) out.dim('  ' + p);
          if (result.paths.length > 20) out.dim(`  … and ${result.paths.length - 20} more`);
          out.line('');
          out.dim('add --yes to actually delete');
        } else {
          out.ok(`freed ${formatBytes(result.bytesFreed)} across ${result.itemsRemoved} files`);
        }
        return 0;
      }

      const report = await scanSpace();
      out.heading(`hats is using ${formatBytes(report.totalBytes)}`);
      out.dim(report.home);

      out.heading('shared');
      out.table(
        report.global.filter((e) => e.bytes > 0).map((e) => [e.label, formatBytes(e.bytes), e.reversibility]),
        ['what', 'size', 'deleting it'],
      );

      for (const ws of report.workspaces) {
        out.heading(
          `${ws.root ?? ws.slug}  ${paint(formatBytes(ws.bytes), 'grey')}` +
            (ws.orphaned ? paint('  (folder no longer exists)', 'yellow') : '') +
            (ws.slug === session.slug ? paint('  (this workspace)', 'green') : ''),
        );
        out.table(
          ws.entries.filter((e) => e.bytes > 0).map((e) => [e.label, formatBytes(e.bytes), e.reversibility]),
          ['what', 'size', 'deleting it'],
        );
      }
      out.line('');
      out.dim('hats space prune <target>          shows what would go');
      out.dim('hats space prune <target> --yes    actually deletes it');
      out.dim('Model weights usually dwarf all of this. Remove those from `hats ui` > Models.');
      return 0;
    }

    case 'tools':
      return toolShelf(args);

    case 'proposals':
      await showProposals();
      return 0;

    case 'promote':
      return promote(args);

    case 'reject': {
      const id = args.positional[0];
      if (!id) {
        out.fail('usage: hats reject <proposal-id>');
        return 1;
      }
      await setProposalStatus(id, 'rejected');
      out.ok(`rejected ${id}`);
      return 0;
    }

    case 'runs': {
      const session = await openSession(sessionFlags(args));
      if (args.positional[0]) return showRun(session.slug, args.positional[0]);
      await showRuns(session);
      return 0;
    }

    case 'memory': {
      const session = await openSession(sessionFlags(args));
      if (args.positional[0] === 'forget') return forget(session.slug, args.flags['yes'] === true);
      await showMemory(session);
      return 0;
    }

    case 'schedule': {
      const { scheduleCommand } = await import('./schedule.js');
      return scheduleCommand(args.positional, args.flags);
    }

    case 'grant': {
      const { grantCommand } = await import('./grant.js');
      return grantCommand(args.positional, args.flags);
    }

    case 'channel': {
      const { channelCommand } = await import('./channel.js');
      return channelCommand(args.positional, args.flags);
    }

    case 'feedback':
      return feedback(args);

    case 'config':
      return config(args);

    default:
      out.fail(`unknown command "${args.command}"`);
      printUsage();
      return 1;
  }
}

// --- commands ---------------------------------------------------------------------

async function chat(args: Args): Promise<number> {
  if (!(await configExists())) {
    out.warn('no config yet — running `hats init` first');
    out.line('');
    await withPrompter((p) => runInit(p, process.cwd()));
    out.line('');
  }
  const session = await openSession(sessionFlags(args));
  await runRepl(session);
  return 0;
}

async function runOnce(args: Args): Promise<number> {
  const request = args.positional.join(' ').trim();
  if (!request) {
    out.fail('usage: hats run "<what you want>"');
    return 1;
  }
  const session = await openSession(sessionFlags(args));
  const interactive = process.stdin.isTTY && args.flags['yes'] !== true;
  const prompter = interactive ? createPrompter() : headlessPrompter;
  try {
    const skill = typeof args.flags['skill'] === 'string' ? args.flags['skill'] : undefined;
    const result = await execute(
      session,
      request,
      [],
      prompter,
      args.flags['quiet'] !== true,
      skill,
    );
    return result.ok ? 0 : 2;
  } finally {
    prompter.close();
  }
}

async function ui(args: Args): Promise<number> {
  const session = await openSession(sessionFlags(args));
  const { startUi } = await import('../ui/server.js');
  const port = Number(args.flags['port'] ?? 4173);
  const { url } = await startUi({ session, port: Number.isFinite(port) ? port : 4173 });

  out.heading('hats ui');
  out.keyValue('workspace', session.workspaceRoot);
  out.keyValue('profile', session.profile);
  out.keyValue('bound to', '127.0.0.1 only — not reachable from your network');
  out.line('');
  out.line('  ' + paint(url, 'bold'));
  out.line('');
  out.dim('  The token in that URL is this process’s session key. Ctrl-C to stop.');

  // Hold the process open; the server is the program now.
  await new Promise<void>(() => {});
  return 0;
}

async function doctor(): Promise<number> {
  out.heading('hats doctor');
  out.keyValue('node', process.version);
  out.keyValue('home', hatsHome());
  out.keyValue('config', (await configExists()) ? paint('present', 'green') : paint('missing — run hats init', 'yellow'));
  out.keyValue('registry', registryDir());
  out.keyValue('sandbox runner', (await exists(sandboxRunnerPath())) ? paint('present', 'green') : paint('MISSING', 'red'));

  const config = await loadConfig();
  out.heading('profile and boundaries');
  out.keyValue('profile', config.profile);
  out.keyValue('network (tools)', config.network.enabled ? paint('ENABLED', 'yellow') : 'off');
  out.keyValue('sandbox', `${config.sandbox.runner}, ${config.sandbox.timeoutMs}ms, ${config.sandbox.memoryMb}MB`);

  out.heading('providers');
  for (const [id, provider] of Object.entries(config.providers)) {
    const envName = apiKeyEnvName(id, provider);
    const key = resolveApiKey(id, provider);
    const status = !envName ? paint('no key needed', 'green') : key ? paint(`${envName} set`, 'green') : paint(`${envName} not set`, 'yellow');
    out.keyValue(id, `${provider.baseUrl}  ${status}`);
  }

  out.heading('tiers');
  for (const tier of ['light', 'standard', 'frontier'] as Tier[]) {
    try {
      const resolved = resolveTier(config, tier);
      out.keyValue(tier, `${resolved.providerId}/${resolved.model}`);
    } catch (e) {
      out.keyValue(tier, paint(toHatsError(e).message, 'yellow'));
    }
  }

  out.heading('registry');
  try {
    const registry = await Registry.load({ knownGates: knownEnforcementPoints() });
    out.ok(`${registry.skills.length} skills, ${registry.rules.length} rules`);
    const unenforced = registry.rules.filter(
      (r) => r.strength !== 'prompt' && (!r.enforcedBy || !ENFORCEMENT_POINTS[r.enforcedBy]),
    );
    if (unenforced.length > 0) out.fail(`${unenforced.length} rule(s) name a missing enforcement point`);
    else out.ok('every gate- and code-strength rule names a real enforcement point');
  } catch (e) {
    out.fail(toHatsError(e).message);
    return 1;
  }

  out.heading('reachability');
  const pool = new ProviderPool(config);
  for (const id of Object.keys(config.providers)) {
    try {
      const list = await pool.get(id).listModels();
      out.ok(`${id}: ${list.length} model(s) — e.g. ${list.slice(0, 3).map((m) => m.id).join(', ') || 'none'}`);
    } catch (e) {
      out.warn(`${id}: ${toHatsError(e).message}`);
    }
  }

  out.heading('tools');
  out.dim(`${ALL_TOOLS.length} in the platform registry: ${ALL_TOOLS.map((t) => t.spec.name).join(', ')}`);
  return 0;
}

async function models(providerId?: string): Promise<number> {
  const config = await loadConfig();
  const ids = providerId ? [providerId] : Object.keys(config.providers);
  const pool = new ProviderPool(config);
  for (const id of ids) {
    out.heading(id);
    try {
      const list = await pool.get(id).listModels();
      out.table(list.map((m) => [m.id, m.detail ?? '']), ['model', 'detail']);
    } catch (e) {
      out.warn(toHatsError(e).message);
    }
  }
  return 0;
}

async function promote(args: Args): Promise<number> {
  const id = args.positional[0];
  if (!id) {
    await showProposals();
    return 0;
  }
  const proposal = await getProposal(id);
  out.heading(`${proposal.kind}: ${proposal.title}`);
  out.keyValue('status', proposal.status);
  out.keyValue('seen', `${proposal.occurrences} time(s)`);
  out.keyValue('rationale', proposal.rationale);
  out.heading('content');
  out.line(proposal.content);

  const prompter = process.stdin.isTTY && args.flags['yes'] !== true ? createPrompter() : headlessPrompter;
  try {
    const confirmed =
      args.flags['yes'] === true ||
      (await prompter.confirm('\npromote this into the live registry?', false));
    if (!confirmed) {
      out.dim('left as a draft');
      return 0;
    }
    const result = await promoteProposal(id);
    if (result.written) out.ok(`promoted -> ${result.written}`);
    if (result.manual) out.warn(result.manual);
    return 0;
  } finally {
    prompter.close();
  }
}

async function feedback(args: Args): Promise<number> {
  const [runId, word, ...rest] = args.positional;
  if (!runId || !word) {
    out.fail('usage: hats feedback <runId> good|bad|correct [what it should have said]');
    return 1;
  }
  const verdict =
    word === 'good' ? 'accepted' : word === 'bad' ? 'rejected' : word === 'correct' ? 'corrected' : null;
  if (!verdict) {
    out.fail('verdict must be good, bad or correct');
    return 1;
  }
  const session = await openSession(sessionFlags(args));
  const note = rest.join(' ');
  const applied = await session.memory.feedback(runId, verdict, note || undefined);
  out.ok(
    `${verdict}: ${applied.takeawaysTouched} takeaway(s), ${applied.lessonsTouched} lesson(s) reweighted` +
      (applied.lessonAdded ? `, new lesson recorded` : ''),
  );
  return 0;
}

async function config(args: Args): Promise<number> {
  const sub = args.positional[0] ?? 'show';
  const cfg = await loadConfig();
  if (sub === 'path') {
    out.line(path.join(hatsHome(), 'config.json'));
    return 0;
  }
  if (sub === 'set') {
    const key = args.positional[1];
    const raw = args.positional.slice(2).join(' ');
    if (!key) {
      out.fail('usage: hats config set <dotted.key> <value>');
      return 1;
    }
    const value = raw === 'true' ? true : raw === 'false' ? false : /^-?\d+$/.test(raw) ? Number(raw) : raw;
    setDotted(cfg as unknown as Record<string, unknown>, key, value);
    await saveConfig(cfg);
    out.ok(`${key} = ${String(value)}`);
    if (key === 'network.enabled' && value === true) {
      out.warn('tool egress is now enabled — read docs/adr/0005 for what that changes');
    }
    return 0;
  }
  out.line(JSON.stringify(cfg, null, 2));
  return 0;
}

async function showRun(slug: string, runId: string): Promise<number> {
  const file = path.join(workspaceDir(slug), 'runs', runId, 'run.json');
  const record = await readJson<Record<string, unknown> | null>(file, null);
  if (!record) {
    out.fail(`no run ${runId} in this workspace`);
    return 1;
  }
  out.line(JSON.stringify(record, null, 2));
  out.dim(`\naudit trail: ${path.join(path.dirname(file), 'audit.jsonl')}`);
  return 0;
}

async function showRegistryEntry(id: string): Promise<number> {
  const registry = await Registry.load({ knownGates: knownEnforcementPoints() });
  const skill = registry.find(id);
  const rule = registry.rule(id);
  const source = skill?.source ?? rule?.source;
  if (!source) {
    out.fail(`no skill or rule "${id}"`);
    return 1;
  }
  out.line(await fsp.readFile(source, 'utf8'));
  out.dim(`\n${source}`);
  return 0;
}

async function forget(slug: string, yes: boolean): Promise<number> {
  const dir = path.join(workspaceDir(slug), 'memory');
  const prompter = yes ? headlessPrompter : createPrompter();
  try {
    const confirmed = yes || (await prompter.confirm(`delete every memory layer under ${dir}?`, false));
    if (!confirmed) {
      out.dim('kept');
      return 0;
    }
    await fsp.rm(dir, { recursive: true, force: true });
    out.ok('memory cleared (run records and their audit trails are kept)');
    return 0;
  } finally {
    prompter.close();
  }
}

// --- helpers ----------------------------------------------------------------------

async function withPrompter(fn: (p: ReturnType<typeof createPrompter>) => Promise<void>): Promise<number> {
  const prompter = createPrompter();
  try {
    await fn(prompter);
    return 0;
  } finally {
    prompter.close();
  }
}

function setDotted(target: Record<string, unknown>, dotted: string, value: unknown): void {
  const keys = dotted.split('.');
  let node = target;
  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i] as string;
    if (typeof node[key] !== 'object' || node[key] === null) node[key] = {};
    node = node[key] as Record<string, unknown>;
  }
  node[keys[keys.length - 1] as string] = value;
}

function printUsage(): void {
  out.line(`
${paint('hats', 'bold')} — one agent, many hats. A local agent runtime with skills, rules, tools,
       a sandbox, layered memory and supervised self-extension.

${paint('usage', 'bold')}
  hats                            interactive session in the current directory
  hats ui                         local control panel: models, pricing, memory, proposals
  hats run "<request>"            one shot, then exit
  hats init                       connect a model and describe this workspace
  hats mcp                        MCP servers and the tools they contribute
  hats tools [list|add <pkg>|remove <pkg>]   packages a tool the agent writes may import

${paint('inspect', 'bold')}
  hats doctor                     config, providers, tiers, registry, reachability
  hats verify [provider]          live round-trip: key, model list, chat, tool calling
  hats models [provider]          live model list from a provider
  hats registry [ls|show <id>|sync|enforcement]
  hats memory [forget]            what it remembers here
  hats lessons [disable <id>]     what it has learned, and how confident it is
  hats runs [<runId>]             run records and audit trails

${paint('run it without you', 'bold')}
  hats schedule add "<request>" --at "0 7 * * 1-5"    07:00 on weekdays
  hats schedule list|run <id>|rm <id>|enable <id>|disable <id>
  hats schedule daemon            keep firing schedules until interrupted
  hats channel list|serve         inbound messages: Telegram, or files on disk
  hats channel token <id>         store a bot token (never printed, never in config)
  hats grant add|list|revoke      scoped, expiring permission for unattended work
  ${paint('unattended runs are read-only by default and cannot use --profile trusted (ADR-0007)', 'grey')}

${paint('teach it', 'bold')}
  hats feedback <runId> good|bad|correct [note]
  hats proposals                  what it has proposed for review
  hats promote <id>               promote a proposal into the live registry
  hats reject <id>

${paint('flags', 'bold')}
  --profile read-only|assisted|trusted   default read-only: worst case is a wrong answer
  --provider <id> --model <id>           override the model for this invocation
  --skill <id>                           force an outcome skill instead of routing
  --workspace <dir>                      run against another directory
  --network                              allow tool egress for this invocation
  --quiet                                hide step-by-step output
  --yes                                  do not prompt (non-interactive)
`);
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((e) => {
    const err = toHatsError(e);
    out.fail(`${err.code}: ${err.message}`);
    if (isHatsError(e) && Object.keys(err.context).length > 0 && process.env['HATS_DEBUG']) {
      out.dim(JSON.stringify(err.context, null, 2));
    }
    process.exitCode = 1;
  });


/**
 * The package shelf: what a tool the agent writes is allowed to import.
 *
 * Installing is a person's job, deliberately. `npm install` runs arbitrary code from the
 * registry at install time, so an agent that could install its own dependencies would have
 * a way to execute anything at all — which is the single thing this design exists to
 * prevent. The agent may read the shelf and ask for something; you decide.
 */
async function toolShelf(args: Args): Promise<number> {
  const { toolDepsDir } = await import('../core/paths.js');
  const { shelfPackages } = await import('../tools/generated/handler.js');
  const dir = toolDepsDir();
  const action = args.positional[0] ?? 'list';

  if (action === 'list') {
    const installed = shelfPackages();
    out.heading('packages a generated tool may import');
    if (installed.length === 0) {
      out.dim(`nothing installed. ${dir}`);
      out.dim('add one with: hats tools add pg');
      return 0;
    }
    for (const name of installed) out.line(`  ${name}`);
    out.dim(dir);
    return 0;
  }

  if (action !== 'add' && action !== 'remove') {
    out.fail(`unknown: hats tools ${action}. Use list, add <package> or remove <package>.`);
    return 1;
  }

  const names = args.positional.slice(1);
  if (names.length === 0) {
    out.fail(`hats tools ${action} needs at least one package name`);
    return 1;
  }

  const { mkdir, writeFile } = await import('node:fs/promises');
  const { existsSync } = await import('node:fs');
  const path = await import('node:path');
  await mkdir(dir, { recursive: true });
  // A package.json so npm treats this as a project rather than walking up and installing
  // into whatever happens to be above it.
  if (!existsSync(path.join(dir, 'package.json'))) {
    await writeFile(
      path.join(dir, 'package.json'),
      `${JSON.stringify({ name: 'hats-tool-deps', private: true, description: 'Packages agent-written tools may import.' }, null, 2)}\n`,
    );
  }

  const { spawn } = await import('node:child_process');
  out.dim(`npm ${action === 'add' ? 'install' : 'uninstall'} ${names.join(' ')}  (in ${dir})`);
  const code = await new Promise<number>((resolve) => {
    const child = spawn('npm', [action === 'add' ? 'install' : 'uninstall', '--no-audit', '--no-fund', ...names], {
      cwd: dir,
      stdio: 'inherit',
    });
    child.on('close', (c) => resolve(c ?? 1));
    child.on('error', () => resolve(1));
  });
  if (code !== 0) {
    out.fail(`npm exited ${code}`);
    return code;
  }
  out.ok(`shelf now holds: ${shelfPackages().join(', ') || 'nothing'}`);
  return 0;
}
