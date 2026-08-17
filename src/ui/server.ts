/**
 * `hats ui` — a local control panel.
 *
 * Security posture, because this is the one component that opens a port on a tool with
 * filesystem access:
 *   - binds 127.0.0.1 only, never 0.0.0.0
 *   - every request carries a per-process random token; without it, 401
 *   - no external assets at all, enforced by a restrictive CSP, so a compromised page
 *     cannot phone anything home
 *   - the UI is a client of the same engine as the CLI: same executor, same allowlist,
 *     same profile gate, same audit trail. It adds no capability, only a surface.
 *   - approvals and clarifications round-trip to the human here exactly as they do in the
 *     terminal — the UI cannot auto-approve, and there is no code path that does.
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import fsp from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import path from 'node:path';

import { apiKeyEnvName, loadConfig, resolveApiKeyWithSource, saveConfig, type Profile, type Tier } from '../core/config.js';
import { clearCredential, credentialHint, credentialsPath, getCredential, setCredential } from '../core/credentials.js';
import { toHatsError } from '../core/errors.js';
import { PathGuard, generatedToolsDir, hatsHome, packageRoot, workspaceDir, workspaceToolsDir } from '../core/paths.js';
import { PRESETS } from '../core/presets.js';
import { prune, scanSpace } from '../core/space.js';
import { readJson } from '../core/store.js';
import { computeAnalytics } from '../analytics/index.js';
import { describePromotion, runAutoPromotion } from '../engine/autonomy.js';
import { mineProposals } from '../engine/mine.js';
import { runAgent, type RunEvent, type RunResult } from '../engine/run.js';
import { ProviderPool } from '../providers/index.js';
import type { Message } from '../providers/types.js';
import { getProposal, listProposals, noteRepairStarted, promoteProposal, setProposalStatus } from '../registry/proposals.js';
import type { ApprovalRequest, ClarificationRequest } from '../tools/types.js';
import type { Session } from '../cli/session.js';
import { listDirectory, preview, readRaw, revealInFolder } from './files.js';
import { renderMarkdown } from './markdown.js';
import { CATALOGUE, OllamaAdmin, SUGGESTED, catalogueWithSizes, searchHuggingFace } from './models.js';
import { collectOutputs } from './outputs.js';
import { listGeneratedTools } from '../tools/generated/store.js';
import { DELIBERATELY_OMITTED, MCP_CATALOGUE } from './mcp-catalogue.js';
import { prepareSignIn, readTokens, tokenKey, type PendingAuthorization } from '../mcp/oauth.js';
import { renderPage } from './page.js';
import { catalogue, quote } from './pricing.js';

/**
 * A run id, as `newRunId` writes it: a compact UTC stamp, a hyphen, six hex characters.
 * Every endpoint that joins one onto a path checks it here rather than carrying its own
 * pattern, because the pattern three of them carried allowed a dot — and a dot allows `..`,
 * which is a path segment. Nothing on disk needs one.
 */
const RUN_ID = /^[\w-]+$/;

/**
 * Settings this panel session owns and should keep across a re-read: the ones a flag set
 * for this invocation only. Everything else comes from disk, so a change made elsewhere
 * wins over whatever this process happened to load at startup.
 */
function pickLocalOverrides(
  current: import('../core/config.js').HatsConfig,
  onDisk: import('../core/config.js').HatsConfig,
): Partial<import('../core/config.js').HatsConfig> {
  const out: Partial<import('../core/config.js').HatsConfig> = {};
  // --network on the command line must not be undone by a stale file.
  if (current.network.enabled && !onDisk.network.enabled) out.network = current.network;
  return out;
}

/**
 * Whether a tool can actually do anything right now. A tool that is present but has no
 * credential, host or server configured looks identical to a working one in a plain list,
 * which is how "why did it not search the web" becomes a mystery.
 */
function toolReadiness(name: string, session: Session): { ok: boolean; why: string } {
  const cfg = session.config;
  const needsNet = ['fetch_url', 'web_search', 'browser_open', 'browser_read', 'browser_act', 'browser_shot', 'ssh_run', 'send_email'];
  if (needsNet.includes(name) && !cfg.network.enabled) {
    return { ok: false, why: 'tool network egress is off' };
  }
  if (name === 'web_search') {
    const has = ['brave', 'tavily', 'serper'].some((p) => getCredential(`search:${p}`));
    return has ? { ok: true, why: 'search provider configured' } : { ok: false, why: 'no search provider key — searching the web will fail' };
  }
  if (name === 'ssh_run') {
    const hosts = Object.keys(cfg.remote?.hosts ?? {}).length;
    return hosts ? { ok: true, why: `${hosts} host(s) configured` } : { ok: false, why: 'no hosts configured' };
  }
  if (name === 'send_email') {
    if (!cfg.email?.host) return { ok: false, why: 'no mail server configured' };
    const to = cfg.email.allowRecipients?.length ?? 0;
    return to ? { ok: true, why: `${to} allowed recipient(s)` } : { ok: false, why: 'no allowed recipients' };
  }
  if (name === 'transcribe_audio') {
    return { ok: true, why: 'uses a local whisper binary, or a provider endpoint' };
  }
  return { ok: true, why: '' };
}

/**
 * What a repair run is asked to do. One text, whether a person pressed the button or the
 * autonomy level decided — two wordings would drift, and the difference would be invisible
 * until one of them started producing worse patches than the other.
 */
function repairRequest(tool: string, evidence: string): string {
  return [
    `The tool \`${tool}\` keeps failing the same way and it is costing every run that uses it.`,
    '',
    'Read its handler under src/tools/builtin/, work out why, and call propose_patch with a fix.',
    'You may change what the tool does; you may not change what it is allowed to do, and an',
    'attempt to edit mutating, network or minProfile is refused. The patch applies only if the',
    'build and the entire test suite pass, so propose the fix you believe in.',
    '',
    'If the handler looks correct and the model keeps misusing it, the defect is the tool',
    'description — patch that instead, and say so.',
    '',
    '## The evidence',
    '',
    evidence,
  ].join('\n');
}

/**
 * A message list is only safe to open on if it does not begin mid tool-call.
 *
 * A `tool` role message is a result; its `tool_use` lives in the assistant message before
 * it. Slicing to the last N messages can cut that pairing exactly at the boundary, and the
 * provider refuses the whole request rather than the one turn. Everything after index 0 is
 * left alone — an assistant message that *opens* a tool call is fine to lead with, because
 * trimming only ever removes from the front, so its own results are still behind it.
 */
export function dropOrphanedToolResults(messages: Message[]): Message[] {
  let start = 0;
  while (start < messages.length && messages[start]?.role === 'tool') start++;
  return messages.slice(start);
}

/** The only files /brand/ will ever serve. A fixed list, not a path lookup. */
const BRAND_FILES = [
  'klair-logo-dark.png',
  'klair-logo-white.png',
  'favicon-32.png',
  'favicon.png',
  'apple-touch-icon.png',
];

interface PendingAsk {
  id: string;
  kind: 'approval' | 'clarification';
  payload: ApprovalRequest | ClarificationRequest;
  resolve: (answer: string) => void;
}

interface LiveRun {
  runId: string;
  events: RunEvent[];
  listeners: Set<ServerResponse>;
  done: boolean;
  result?: RunResult;
  error?: string;
  pending?: PendingAsk;
}

export interface UiOptions {
  session: Session;
  port?: number;
  open?: boolean;
}

export async function startUi(
  opts: UiOptions,
): Promise<{ url: string; schedulerRunning: boolean; close: () => void }> {
  const { session } = opts;
  const token = randomBytes(24).toString('hex');
  const runs = new Map<string, LiveRun>();
  let history: Message[] = [];
  let current: LiveRun | undefined;
  // Started after the socket is listening, so the handler needs a forward reference.
  let scheduler: import('../schedule/runner.js').Scheduler | undefined;
  const schedulerRunning = () => scheduler !== undefined;
  let channels: import('../channels/index.js').ChannelManager | undefined;
  let channelLoop: NodeJS.Timeout | undefined;
  /** Sign-ins waiting on a browser, so a second click does not open a second listener. */
  const signIns = new Map<string, PendingAuthorization>();
  const channelsRunning = () => channels !== undefined;

  const server = createServer(async (req, res) => {
    try {
      await handle(req, res);
    } catch (e) {
      const err = toHatsError(e);
      json(res, 500, { error: err.code, message: err.message });
    }
  });

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const authed =
      url.searchParams.get('token') === token || req.headers['x-hats-token'] === token;

    if (url.pathname === '/' ) {
      if (!authed) {
        res.writeHead(401, { 'content-type': 'text/plain' });
        res.end('hats ui: open the URL printed in your terminal — it carries the session token.');
        return;
      }
      res.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        // No external anything. If this page is ever tampered with, it still cannot call out.
        // img/frame/object 'self' are needed to preview workspace files. Previewed HTML
        // is served into a sandboxed iframe with neither scripts nor same-origin access,
        // so a page the agent wrote cannot reach this page or its token.
        'content-security-policy':
          "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; media-src 'self'; frame-src 'self'; object-src 'self'; form-action 'none'; base-uri 'none'",
        'referrer-policy': 'no-referrer',
        'x-content-type-options': 'nosniff',
      });
      res.end(renderPage(token));
      return;
    }

    // Brand images are served without the token, deliberately. A <link rel="icon"> and an
    // <img> cannot carry a header, and these are public brand files with no user data in
    // them. The filename is matched against a fixed list rather than resolved as a path,
    // so this cannot become a way to read the disk.
    if (url.pathname.startsWith('/brand/')) {
      const file = BRAND_FILES.find((f) => `/brand/${f}` === url.pathname);
      if (!file) {
        json(res, 404, { error: 'NOT_FOUND' });
        return;
      }
      const bytes = await fsp.readFile(path.join(packageRoot(), 'assets', 'brand', file));
      res.writeHead(200, {
        'content-type': 'image/png',
        'content-length': String(bytes.length),
        'cache-control': 'public, max-age=86400',
        'x-content-type-options': 'nosniff',
      });
      res.end(bytes);
      return;
    }

    if (!authed) {
      json(res, 401, { error: 'UNAUTHORIZED', message: 'missing or wrong session token' });
      return;
    }

    switch (`${req.method} ${url.pathname}`) {
      case 'GET /api/state':
        return json(res, 200, await state(session));

      case 'GET /api/models':
        return json(res, 200, await models(session, url.searchParams.get('provider') ?? ''));

      case 'POST /api/config': {
        const body = (await readBody(req)) as {
          provider?: string;
          tiers?: Partial<Record<Tier, string>>;
          profile?: string;
          network?: boolean;
        };
        // Re-read from disk before merging. The panel holds config in memory from
        // startup, so saving after any CLI change (hats config set, another panel) wrote
        // the stale copy back and silently reverted it — the frontier tier went back to
        // haiku hours after being pointed at sonnet, with nothing to show why.
        // [Seen in a live run, 2026-08-15.]
        // Mutated in place, never reassigned. ProviderPool holds a reference to this
        // object and reads it live on every resolve, so replacing it silently detaches the
        // pool — the panel saved a new tier binding to disk and kept using the old model,
        // with nothing in the UI to show why. [Seen in a live run, 2026-08-15.]
        const onDisk = await loadConfig();
        const keep = pickLocalOverrides(session.config, onDisk);
        Object.assign(session.config, onDisk, keep);

        if (body.provider) session.config.defaultProvider = body.provider;
        if (body.tiers) session.config.tiers = { ...session.config.tiers, ...body.tiers };
        if (body.profile === 'read-only' || body.profile === 'assisted' || body.profile === 'trusted') {
          session.config.profile = body.profile;
          session.profile = body.profile;
        }
        if (typeof body.network === 'boolean') {
          session.config.network = { ...session.config.network, enabled: body.network };
        }
        await saveConfig(session.config);
        return json(res, 200, await state(session));
      }

      case 'GET /api/files':
        return json(
          res,
          200,
          await listDirectory(session.workspaceRoot, url.searchParams.get('path') ?? '.'),
        );

      case 'GET /api/preview': {
        const payload = await preview(session.workspaceRoot, url.searchParams.get('path') ?? '');
        return json(res, 200, {
          ...payload,
          ...(payload.kind === 'markdown' && payload.text
            ? { html: renderMarkdown(payload.text) }
            : {}),
        });
      }

      case 'GET /api/raw': {
        const rel = url.searchParams.get('path') ?? '';
        const { buffer, mime } = await readRaw(session.workspaceRoot, rel);
        const headers: Record<string, string> = {
          'content-type': mime,
          'content-length': String(buffer.length),
          'cache-control': 'no-store',
          'x-content-type-options': 'nosniff',
        };
        // Anything that could execute is served as a download or into a sandbox, never
        // rendered as a same-origin document.
        if (mime === 'text/html' || mime === 'image/svg+xml') {
          headers['content-security-policy'] = "default-src 'none'; style-src 'unsafe-inline'; img-src data:";
        }
        res.writeHead(200, headers);
        res.end(buffer);
        return;
      }

      case 'POST /api/reveal': {
        const body = (await readBody(req)) as { path?: string };
        const revealed = await revealInFolder(session.workspaceRoot, String(body.path ?? ''));
        return json(res, 200, { revealed });
      }

      case 'GET /api/analytics':
        return json(res, 200, await computeAnalytics(session.slug));

      case 'GET /api/space': {
        const report = await scanSpace();
        // Model weights usually dwarf everything hats stores, so show them side by side
        // rather than letting someone delete their audit trail to save 4 MB.
        const admin = new OllamaAdmin(ollamaBaseUrl(session));
        const models = (await admin.reachable()) ? await admin.installed() : [];
        return json(res, 200, {
          ...report,
          currentWorkspace: session.slug,
          models: {
            count: models.length,
            bytes: models.reduce((a, m) => a + m.sizeBytes, 0),
          },
        });
      }

      case 'POST /api/space/prune': {
        const body = (await readBody(req)) as {
          target?: string;
          workspace?: string;
          keepLast?: number;
          olderThanDays?: number;
          dryRun?: boolean;
        };
        const result = await prune({
          target: String(body.target ?? ''),
          ...(body.workspace ? { workspace: body.workspace } : {}),
          ...(typeof body.keepLast === 'number' ? { keepLast: body.keepLast } : {}),
          ...(typeof body.olderThanDays === 'number' ? { olderThanDays: body.olderThanDays } : {}),
          ...(body.dryRun ? { dryRun: true } : {}),
        });
        return json(res, 200, result);
      }

      case 'GET /api/local-models': {
        const admin = new OllamaAdmin(ollamaBaseUrl(session));
        const reachable = await admin.reachable();
        return json(res, 200, {
          reachable,
          baseUrl: ollamaBaseUrl(session),
          installed: reachable ? await admin.installedDetailed() : [],
          suggested: SUGGESTED,
          networkEnabled: session.config.network.enabled,
        });
      }

      case 'GET /api/model-library': {
        // Sizes come from the registry, which is an outbound request. Without egress we
        // still show the library, just without the numbers, and say why.
        if (!session.config.network.enabled) {
          return json(res, 200, {
            families: CATALOGUE,
            sized: false,
            note: 'Download sizes come from the Ollama registry, which is an outbound request. Turn on tool network egress to see them. Installing a model always works — that talks to your local Ollama.',
          });
        }
        return json(res, 200, { families: await catalogueWithSizes(), sized: true, note: null });
      }

      case 'GET /api/local-models/pull': {
        const model = url.searchParams.get('model') ?? '';
        if (!model) return json(res, 400, { error: 'NO_MODEL' });
        res.writeHead(200, {
          'content-type': 'text/event-stream',
          'cache-control': 'no-cache',
          connection: 'keep-alive',
        });
        const admin = new OllamaAdmin(ollamaBaseUrl(session));
        try {
          await admin.pull(model, (p) => sse(res, 'progress', p));
          sse(res, 'done', { model });
        } catch (e) {
          sse(res, 'failed', { message: toHatsError(e).message });
        }
        res.end();
        return;
      }

      case 'POST /api/local-models/delete': {
        const body = (await readBody(req)) as { model?: string };
        const admin = new OllamaAdmin(ollamaBaseUrl(session));
        await admin.remove(String(body.model ?? ''));
        return json(res, 200, { installed: await admin.installed() });
      }

      case 'GET /api/hf-search': {
        if (!session.config.network.enabled) {
          return json(res, 403, {
            error: 'NETWORK_DISABLED',
            message:
              'Searching Hugging Face is an outbound request to a third party. Turn on tool network egress on the Models tab first.',
          });
        }
        const q = url.searchParams.get('q') ?? '';
        if (!q.trim()) return json(res, 400, { error: 'EMPTY_QUERY' });
        try {
          return json(res, 200, { models: await searchHuggingFace(q) });
        } catch (e) {
          return json(res, 200, { models: [], error: toHatsError(e).message });
        }
      }

      case 'POST /api/credential': {
        const body = (await readBody(req)) as { provider?: string; key?: string; clear?: boolean };
        const id = String(body.provider ?? '');
        if (!id) return json(res, 400, { error: 'NO_PROVIDER' });

        if (body.clear) await clearCredential(id);
        else await setCredential(id, String(body.key ?? ''));

        // A provider the user just gave a key to should exist in config from now on.
        if (!session.config.providers[id] && PRESETS[id]) {
          const preset = PRESETS[id]!;
          session.config.providers[id] = {
            kind: preset.kind,
            baseUrl: preset.baseUrl,
            toolProtocol: 'auto',
            ...(preset.modelsPath ? { modelsPath: preset.modelsPath } : {}),
            ...(preset.apiKeyEnv ? { apiKeyEnv: preset.apiKeyEnv } : {}),
          };
          await saveConfig(session.config);
        }
        // The response carries state, which by construction never includes a key.
        return json(res, 200, await state(session));
      }

      case 'POST /api/run': {
        const body = (await readBody(req)) as {
          request?: string;
          fresh?: boolean;
          attach?: string[];
        };
        // Checked before the empty-request rejection below. A "start fresh" click sends an
        // empty request purely to reset this server's history, and the check used to run
        // second — so the request 400'd on emptiness and the reset code was never reached.
        // The conversation the client called "new" kept talking with the old one's history,
        // including raw tool messages, and the next real send could open on an orphaned
        // tool_result with no tool_use in front of it: exactly the 400 Anthropic gives back.
        if (body.fresh) {
          history = [];
          if (!(body.request ?? '').trim()) return json(res, 200, { ok: true, reset: true });
        }

        let request = (body.request ?? '').trim();
        if (!request) return json(res, 400, { error: 'EMPTY', message: 'nothing to run' });

        // Attachments are workspace paths, not uploads. The agent already reads through
        // the path guard, so naming a file points it at one rather than handing it bytes
        // that would bypass the guard entirely — and the citation still refers to a real
        // path the user can open.
        const attach = (body.attach ?? []).filter((p) => typeof p === 'string' && p.trim()).slice(0, 20);
        if (attach.length) {
          const guard = new PathGuard([session.workspaceRoot]);
          const named: string[] = [];
          for (const rel of attach) {
            try {
              const abs = guard.resolve(rel, session.workspaceRoot);
              named.push(path.relative(session.workspaceRoot, abs) || rel);
            } catch (e) {
              return json(res, 400, { error: 'SCOPE_DENIED', message: toHatsError(e).message });
            }
          }
          request +=
            `\n\nAttached from this workspace — read these first:\n` +
            named.map((n) => `- ${n}`).join('\n');
        }

        const live = startRun(request);
        return json(res, 200, { runId: live.runId });
      }

      case 'GET /api/events': {
        const runId = url.searchParams.get('runId') ?? '';
        const live = runs.get(runId);
        if (!live) return json(res, 404, { error: 'NO_RUN' });
        res.writeHead(200, {
          'content-type': 'text/event-stream',
          'cache-control': 'no-cache',
          connection: 'keep-alive',
        });
        for (const e of live.events) sse(res, 'event', e);
        if (live.pending) sse(res, 'ask', { id: live.pending.id, kind: live.pending.kind, ...live.pending.payload });
        if (live.done) {
          sse(res, 'done', { result: summarise(live), error: live.error });
          res.end();
          return;
        }
        live.listeners.add(res);
        req.on('close', () => live.listeners.delete(res));
        return;
      }

      case 'POST /api/answer': {
        const body = (await readBody(req)) as {
          runId?: string;
          id?: string;
          answer?: string;
          values?: Record<string, string>;
        };
        const live = runs.get(body.runId ?? '');
        if (!live?.pending || live.pending.id !== body.id) {
          return json(res, 409, { error: 'STALE', message: 'that prompt is no longer open' });
        }
        const pending = live.pending;
        live.pending = undefined as unknown as PendingAsk;

        // A form answer. Secret fields are diverted into credentials.json here, at the
        // boundary — before the value can reach the transcript, an artifact, or the next
        // prompt. The model gets the last four characters and the name it is stored under,
        // which is enough to reason about and useless to leak.
        if (body.values && pending.kind === 'clarification') {
          const fields = (pending.payload as ClarificationRequest).fields ?? [];
          const parts: string[] = [];
          for (const field of fields) {
            const raw = String(body.values[field.name] ?? '').trim();
            if (!raw) continue;
            if (field.type === 'secret') {
              await setCredential(field.name, raw);
              parts.push(`${field.name}: stored securely (${credentialHint(raw)})`);
            } else {
              parts.push(`${field.name}: ${raw}`);
            }
          }
          pending.resolve(parts.length ? parts.join('\n') : '(nothing filled in)');
          return json(res, 200, { ok: true });
        }

        pending.resolve(String(body.answer ?? ''));
        return json(res, 200, { ok: true });
      }

      case 'POST /api/feedback': {
        const body = (await readBody(req)) as { runId?: string; verdict?: string; note?: string };
        const verdict = body.verdict;
        if (verdict !== 'accepted' && verdict !== 'rejected' && verdict !== 'corrected') {
          return json(res, 400, { error: 'BAD_VERDICT' });
        }
        const applied = await session.memory.feedback(body.runId ?? '', verdict, body.note);
        return json(res, 200, applied);
      }

      case 'GET /api/memory': {
        const [persona, takeaways, lessons, org] = await Promise.all([
          session.memory.persona.get(),
          session.memory.takeaways.all(),
          session.memory.lessons.all(),
          session.memory.org.read(),
        ]);
        return json(res, 200, {
          persona,
          org,
          takeaways: takeaways.slice(-40).reverse(),
          lessons: lessons.sort((a, b) => b.confidence - a.confidence),
          orgPath: session.memory.org.path,
          personaPath: session.memory.persona.path,
        });
      }

      case 'POST /api/persona/forget': {
        const body = (await readBody(req)) as { fact?: string };
        const persona = await session.memory.persona.forgetFact(String(body.fact ?? ''));
        return json(res, 200, persona);
      }

      case 'POST /api/org': {
        const body = (await readBody(req)) as { content?: string };
        await session.memory.org.write(String(body.content ?? ''));
        return json(res, 200, { ok: true });
      }

      case 'POST /api/lesson': {
        const body = (await readBody(req)) as { id?: string; status?: string };
        if (body.status === 'disabled' && body.id) {
          await session.memory.lessons.setStatus(body.id, 'disabled', 'disabled from the UI');
        }
        return json(res, 200, { ok: true });
      }

      case 'GET /api/outputs': {
        // What the agent produced, per conversation. The reading is in ui/outputs.ts.
        const produced = await collectOutputs(path.join(workspaceDir(session.slug), 'runs'));
        return json(res, 200, { ...produced, root: session.workspaceRoot });
      }

      case 'GET /api/artifact': {
        const runId = url.searchParams.get('runId') ?? '';
        const id = url.searchParams.get('id') ?? '';
        // An artifact id is `art_<hex>`, so \w alone covers it.
        if (!RUN_ID.test(runId) || !/^\w+$/.test(id)) return json(res, 400, { error: 'bad id' });
        const file = path.join(workspaceDir(session.slug), 'runs', runId, 'artifacts', `${id}.json`);
        const artifact = await readJson<Record<string, unknown> | null>(file, null).catch(() => null);
        if (!artifact) return json(res, 404, { error: 'NOT_FOUND' });

        // A payload is deliberately unbounded on disk — that is the point of an artifact —
        // so it is bounded here rather than shipped whole and cut in the browser. The cut is
        // reported with the path to the whole thing, the same bargain shapeText makes with
        // the model.
        const LIMIT = 40_000;
        const whole = JSON.stringify(artifact['payload'] ?? null, null, 2) ?? 'null';
        return json(res, 200, {
          id: artifact['id'] ?? id,
          tool: artifact['tool'] ?? '?',
          kind: artifact['kind'] ?? '?',
          createdAt: artifact['createdAt'] ?? '',
          summary: artifact['summary'] ?? '',
          provenance: artifact['provenance'] ?? {},
          payload: whole.slice(0, LIMIT),
          payloadChars: whole.length,
          truncated: whole.length > LIMIT,
          file,
        });
      }

      case 'GET /api/proposals': {
        // The body of a proposal is a markdown document — a skill, a rule, or a defect
        // report — and the panel was showing it as preformatted text, so the reader got
        // literal hashes and asterisks in the one place they are being asked to judge a
        // document on its merits. Rendered here because the renderer already lives here.
        const proposals = (await listProposals()).map((p) => ({ ...p, html: renderMarkdown(p.content) }));
        return json(res, 200, { proposals });
      }

      case 'POST /api/proposal': {
        const body = (await readBody(req)) as { id?: string; action?: string };
        if (!body.id) return json(res, 400, { error: 'NO_ID' });
        if (body.action === 'promote') {
          const result = await promoteProposal(body.id, { workspaceRoot: session.workspaceRoot });
          session.registry = await reloadRegistry();
          return json(res, 200, { written: result.written, manual: result.manual });
        }
        if (body.action === 'reject') {
          await setProposalStatus(body.id, 'rejected');
          return json(res, 200, { ok: true });
        }

        // Attempt a repair. The miner can spot a tool failing the same way and gather the
        // evidence; it cannot read a handler or write a fix, because it has no model. So
        // the report becomes the *request* for an ordinary run, which does have both —
        // and whose patch is gated by the build and the whole test suite like any other.
        if (body.action === 'repair') {
          const proposal = await getProposal(body.id);
          const tool = proposal.defect?.tool;
          if (!tool) return json(res, 400, { error: 'NOT_A_DEFECT', message: 'that proposal is not a tool defect' });
          const request = repairRequest(tool, proposal.content);
          // The panel attaches to this run and streams it into the conversation, so the
          // request goes back with the id — the transcript should say what was asked.
          const live = startRun(request, true);
          // Recorded now, not when the run finishes: the press of the button is what makes
          // this report stop asking for a decision, whatever the run goes on to conclude.
          await noteRepairStarted(proposal.id, live.runId);
          return json(res, 200, { runId: live.runId, request });
        }
        return json(res, 200, { proposal: await getProposal(body.id) });
      }

      case 'GET /api/registry': {
        // Read per request rather than cached: a tool installed a minute ago should say
        // where it lives, and this list is small.
        const generatedSources = new Map<string, string>();
        for (const { tool } of await listGeneratedTools(workspaceToolsDir(session.workspaceRoot))) {
          generatedSources.set(tool.name, 'workspace');
        }
        for (const { tool } of await listGeneratedTools(generatedToolsDir())) {
          if (!generatedSources.has(tool.name)) generatedSources.set(tool.name, 'device');
        }
        return json(res, 200, {
          skills: session.registry.skills.map((s) => ({
            id: s.id,
            version: s.version,
            kind: s.kind,
            role: s.role ?? null,
            review: s.review,
            tools: s.tools,
            description: s.description,
          })),
          rules: session.registry.rules.map((r) => ({
            id: r.id,
            strength: r.strength,
            enforcedBy: r.enforcedBy ?? null,
            statement: r.statement,
          })),
          mcp: session.mcp.connections,
          tools: session.handlers.map((h) => {
            const name = h.spec.name;
            const mcp = name.startsWith('mcp__') ? name.split('__')[1] : null;
            return {
              name,
              mutating: h.spec.mutating,
              network: h.spec.network === true,
              minProfile: h.spec.minProfile,
              description: h.spec.description,
              // Where it comes from, so a connector's tools are not mixed in with built-ins
              // and a tool the agent wrote is never presented as one that shipped.
              source: mcp ? `mcp:${mcp}` : (generatedSources.get(name) ?? 'built-in'),
              // Which skills may call it — the allowlist is an intersection, so a tool
              // nothing names can never run, and that is worth being able to see.
              usedBy: session.registry
                .outcomes()
                .filter((sk) =>
                  sk.tools.some((t) => (t.endsWith('*') ? name.startsWith(t.slice(0, -1)) : t === name)),
                )
                .map((sk) => sk.id.replace('outcome/', '')),
              // Whether the thing it needs is actually set up.
              ready: toolReadiness(name, session),
            };
          }),
        });
      }

      case 'GET /api/schedules': {
        const { listSchedules, nextFireFor, describeRecord } = await import('../schedule/store.js');
        const all = await listSchedules();
        return json(res, 200, {
          schedulerRunning: schedulerRunning(),
          channels: Object.entries(session.config.channels ?? {}).map(([id, c]) => ({
            id,
            kind: c.kind,
            senders: c.allowFrom?.length ?? 0,
            profile: c.profile ?? 'read-only',
            enabled: c.enabled !== false,
          })),
          schedules: all.map((s) => ({
            id: s.id,
            request: s.request,
            when: describeRecord(s),
            next: nextFireFor(s)?.toISOString() ?? null,
            profile: s.profile,
            allowTools: s.allowTools,
            enabled: s.enabled,
            author: s.author,
            lastRunAt: s.lastRunAt ?? null,
            lastStatus: s.lastStatus ?? null,
            lastSummary: s.lastSummary ?? null,
            lastRunId: s.lastRunId ?? null,
            missedRuns: s.missedRuns ?? 0,
          })),
        });
      }

      case 'POST /api/schedule': {
        const body = (await readBody(req)) as {
          action?: string;
          id?: string;
          request?: string;
          at?: string;
          profile?: string;
          allowTools?: string[];
        };
        const store = await import('../schedule/store.js');

        if (body.action === 'add') {
          // createSchedule refuses trusted, a bad expression and a pointless allow list.
          // The panel does not pre-validate: one rejection path, not two.
          const rec = await store.createSchedule({
            request: body.request ?? '',
            expression: body.at ?? '',
            workspace: session.workspaceRoot,
            ...(body.profile ? { profile: body.profile as Profile } : {}),
            allowTools: body.allowTools ?? [],
          });
          return json(res, 200, { ok: true, id: rec.id });
        }
        if (!body.id) return json(res, 400, { error: 'id is required' });

        if (body.action === 'rm') {
          await store.deleteSchedule(body.id);
          return json(res, 200, { ok: true });
        }
        if (body.action === 'enable' || body.action === 'disable') {
          const rec = await store.getSchedule(body.id);
          await store.saveSchedule({ ...rec, enabled: body.action === 'enable' });
          return json(res, 200, { ok: true });
        }
        if (body.action === 'run') {
          const { Scheduler } = await import('../schedule/runner.js');
          const outcome = await new Scheduler().runNow(body.id);
          return json(res, 200, {
            ok: outcome.ok,
            answer: outcome.answer,
            error: outcome.error ?? null,
            decisions: outcome.decisions,
          });
        }
        return json(res, 400, { error: `unknown action "${body.action}"` });
      }

      case 'GET /api/runs': {
        const dir = path.join(workspaceDir(session.slug), 'runs');
        const fsp = await import('node:fs/promises');
        let ids: string[] = [];
        try {
          ids = (await fsp.readdir(dir)).sort().reverse().slice(0, 25);
        } catch {
          ids = [];
        }
        const records = [];
        for (const id of ids) {
          const record = await readJson<Record<string, unknown> | null>(
            path.join(dir, id, 'run.json'),
            null,
          );
          if (record) records.push(record);
        }
        return json(res, 200, { runs: records });
      }

      case 'GET /api/transcript': {
        // Past conversations. The transcript is already on disk for the audit trail; there
        // was simply no way to read one back without opening the JSONL by hand.
        const id = url.searchParams.get('runId') ?? '';
        if (!RUN_ID.test(id)) return json(res, 400, { error: 'bad runId' });
        const dir = path.join(workspaceDir(session.slug), 'runs', id);
        const record = await readJson<Record<string, unknown> | null>(
          path.join(dir, 'run.json'),
          null,
        );
        if (!record) return json(res, 404, { error: 'NOT_FOUND' });
        const fsp = await import('node:fs/promises');
        const raw = await fsp.readFile(path.join(dir, 'transcript.jsonl'), 'utf8').catch(() => '');
        const turns = raw
          .split('\n')
          .filter(Boolean)
          .map((line) => {
            try {
              return JSON.parse(line) as Record<string, unknown>;
            } catch {
              return null;
            }
          })
          .filter(Boolean)
          .map((m) => {
            const msg = m as { role?: string; content?: string; toolCalls?: Array<{ name?: string }> };
            return {
              role: msg.role ?? '?',
              content: msg.content ?? '',
              html: msg.role === 'assistant' && msg.content ? renderMarkdown(msg.content) : null,
              tools: (msg.toolCalls ?? []).map((c) => c.name ?? '?'),
            };
          });
        return json(res, 200, { record, turns });
      }

      case 'POST /api/resume': {
        // Open a past conversation and carry on talking in it.
        //
        // The transcript was already readable, but only as a record: you could see what was
        // said and not say the next thing. Resuming means the *server's* history is what
        // gets replaced, because that is what reaches the model — painting the old turns in
        // the browser alone would look resumed and behave like a fresh conversation.
        const body = (await readBody(req)) as { runId?: string };
        const id = String(body.runId ?? '');
        if (!RUN_ID.test(id)) return json(res, 400, { error: 'bad runId' });

        const dir = path.join(workspaceDir(session.slug), 'runs', id);
        const record = await readJson<Record<string, unknown> | null>(path.join(dir, 'run.json'), null);
        if (!record) return json(res, 404, { error: 'NOT_FOUND' });

        const fsp = await import('node:fs/promises');
        const raw = await fsp.readFile(path.join(dir, 'transcript.jsonl'), 'utf8').catch(() => '');
        const lines = raw
          .split('\n')
          .filter(Boolean)
          .map((line) => {
            try {
              return JSON.parse(line) as {
              role?: string;
              content?: string;
              toolCalls?: unknown[];
              internal?: boolean;
            };
            } catch {
              return null;
            }
          })
          .filter(
            (m): m is { role?: string; content?: string; toolCalls?: unknown[]; internal?: boolean } =>
              m !== null,
          )
          // The loop steers itself with synthetic user turns — a review handshake, gate
          // feedback, a stall warning. They belong in the audit trail and not in a
          // conversation someone reopened, where they read as things the person said.
          .filter((m) => m.internal !== true);

        // Only the spoken turns. A transcript also holds tool calls and their results, and
        // replaying those into a new run is how you get a provider rejecting the request for
        // tool_use blocks with no matching tool_result — the conversation is what the person
        // wants back, not the machinery underneath it.
        history = lines
          .filter((m) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
          .map((m) => ({ role: m.role as 'user' | 'assistant', content: String(m.content) }))
          .slice(-40);

        const turns = lines.map((m) => ({
          role: m.role ?? '?',
          content: m.content ?? '',
          // Each line was stamped when it was written; a reopened conversation should say
          // when things were said rather than when it happened to be reopened.
          ts: (m as { ts?: string }).ts ?? null,
          html: m.role === 'assistant' && m.content ? renderMarkdown(m.content) : null,
          tools: ((m.toolCalls ?? []) as Array<{ name?: string }>).map((c) => c.name ?? '?'),
        }));

        return json(res, 200, { record, turns, resumed: history.length });
      }

      case 'GET /api/connectors': {
        const configured = session.config.mcpServers ?? {};
        const live = session.mcp.connections;
        return json(res, 200, {
          networkEnabled: session.config.network.enabled,
          // Only what is not already set up. A catalogue that keeps offering you a server
          // you added ten minutes ago is a list you stop reading.
          catalogue: MCP_CATALOGUE.filter((c) => !(c.id in configured)),
          omitted: DELIBERATELY_OMITTED,
          servers: Object.entries(configured).map(([id, cfg]) => {
            const conn = live.find((c) => c.server === id);
            return {
              id,
              transport: cfg.transport ?? (cfg.url ? 'http' : 'stdio'),
              target: cfg.url ?? [cfg.command, ...(cfg.args ?? [])].filter(Boolean).join(' '),
              disabled: cfg.disabled === true,
              trustedTools: cfg.trustedTools ?? [],
              connected: Boolean(conn?.ok),
              remote: Boolean(cfg.url),
              signedIn: Boolean(readTokens(id)),
              error: conn?.error ?? null,
              toolCount: conn?.toolCount ?? 0,
              tools: session.handlers
                .filter((h) => h.spec.name.startsWith('mcp__' + id + '__'))
                .map((h) => h.spec.name),
            };
          }),
        });
      }

      case 'POST /api/connector': {
        const body = (await readBody(req)) as {
          action?: string;
          id?: string;
          url?: string;
          command?: string;
          args?: string;
          headers?: Record<string, string>;
        };
        const id = (body.id ?? '').trim();
        if (!/^[\w-]{1,40}$/.test(id)) {
          return json(res, 400, { error: 'a connector id is letters, numbers, dash or underscore' });
        }
        const servers = { ...(session.config.mcpServers ?? {}) };

        if (body.action === 'remove') {
          delete servers[id];
          // A connector that is gone must not leave a usable token behind it.
          await setCredential(tokenKey(id), '');
        } else if (body.action === 'toggle') {
          const cur = servers[id];
          if (!cur) return json(res, 404, { error: 'no such connector' });
          servers[id] = { ...cur, disabled: !cur.disabled };
        } else if (body.action === 'signin') {
          const cfg = (session.config.mcpServers ?? {})[id];
          if (!cfg?.url) {
            return json(res, 400, { error: 'only a remote connector can sign in — a local one runs as your own user' });
          }
          // The panel never sees a code, a verifier or a token. It gets a URL to open and a
          // promise that settles when the provider redirects back to the loopback listener.
          // A provider without dynamic registration needs a client id created by hand. Passing
          // it here is the difference between "this cannot work" and "this needs one setting".
          const pending = await prepareSignIn({
            server: id,
            url: cfg.url,
            ...(cfg.oauthClientId ? { clientId: cfg.oauthClientId } : {}),
          });
          signIns.set(id, pending);
          void pending.completed
            .then(() => signIns.delete(id))
            .catch(() => signIns.delete(id));
          return json(res, 200, { authorizeUrl: pending.authorizeUrl, issuer: pending.issuer });
        } else if (body.action === 'signin-status') {
          const tokens = readTokens(id);
          return json(res, 200, {
            signedIn: Boolean(tokens),
            waiting: signIns.has(id),
            expiresAt: tokens?.expiresAt ?? null,
          });
        } else if (body.action === 'signout') {
          await setCredential(tokenKey(id), '');
          signIns.get(id)?.cancel();
          signIns.delete(id);
          return json(res, 200, { ok: true, signedOut: true });
        } else if (body.action === 'catalogue') {
          const entry = MCP_CATALOGUE.find((c) => c.id === id);
          if (!entry) return json(res, 404, { error: 'no catalogue entry with that id' });
          if (servers[id]) return json(res, 409, { error: `a connector called ${id} already exists` });
          servers[id] = entry.url
            ? { transport: 'http', url: entry.url }
            : { transport: 'stdio', command: entry.command as string, args: entry.args ?? [] };
        } else if (body.action === 'add') {
          if (body.url) {
            // A remote connector is a third party with a network endpoint. Recorded as
            // configured; it still connects only when the runtime starts.
            if (!/^https?:\/\//i.test(body.url)) {
              return json(res, 400, { error: 'the URL must start with http:// or https://' });
            }
            servers[id] = {
              transport: 'http',
              url: body.url,
              ...(body.headers ? { headers: body.headers } : {}),
            };
          } else if (body.command) {
            servers[id] = {
              transport: 'stdio',
              command: body.command,
              args: (body.args ?? '').split(/\s+/).filter(Boolean),
            };
          } else {
            return json(res, 400, { error: 'give either a URL or a command' });
          }
        } else {
          return json(res, 400, { error: `unknown action "${body.action}"` });
        }

        session.config.mcpServers = servers;
        await saveConfig(session.config);
        return json(res, 200, { ok: true, restartRequired: true });
      }

      case 'GET /api/integrations': {
        // Everything a tool needs configured before it can do anything, in one place.
        return json(res, 200, {
          search: {
            providers: ['brave', 'tavily', 'serper'].map((p) => ({
              id: p,
              hint: credentialHint(getCredential(`search:${p}`)),
            })),
          },
          remote: Object.entries(session.config.remote?.hosts ?? {}).map(([alias, h]) => ({
            alias,
            hostname: h.hostname,
            user: h.user ?? '',
            port: h.port ?? 22,
            identityFile: h.identityFile ?? '',
          })),
          email: {
            host: session.config.email?.host ?? '',
            port: session.config.email?.port ?? 587,
            user: session.config.email?.user ?? '',
            from: session.config.email?.from ?? '',
            fromName: session.config.email?.fromName ?? '',
            allowRecipients: session.config.email?.allowRecipients ?? [],
            passwordHint: credentialHint(getCredential('email')),
          },
          browser: { headful: session.config.browser?.headful === true },
        });
      }

      case 'POST /api/integrations': {
        const body = (await readBody(req)) as {
          kind?: string;
          secret?: string;
          provider?: string;
          host?: Record<string, string | number>;
          alias?: string;
          email?: Record<string, unknown>;
          headful?: boolean;
        };

        if (body.kind === 'search-key') {
          if (!['brave', 'tavily', 'serper'].includes(body.provider ?? '')) {
            return json(res, 400, { error: 'unknown search provider' });
          }
          if (body.secret) await setCredential(`search:${body.provider}`, body.secret.trim());
          else await clearCredential(`search:${body.provider}`);
          return json(res, 200, { ok: true });
        }

        if (body.kind === 'remote-host') {
          const alias = (body.alias ?? '').trim();
          if (!/^[\w.-]{1,40}$/.test(alias)) return json(res, 400, { error: 'bad host alias' });
          const hosts = { ...(session.config.remote?.hosts ?? {}) };
          if (body.host === null || body.host === undefined) delete hosts[alias];
          else {
            const hostname = String(body.host['hostname'] ?? '').trim();
            if (!hostname) return json(res, 400, { error: 'a hostname is required' });
            hosts[alias] = {
              hostname,
              ...(body.host['user'] ? { user: String(body.host['user']) } : {}),
              ...(body.host['port'] ? { port: Number(body.host['port']) } : {}),
              ...(body.host['identityFile'] ? { identityFile: String(body.host['identityFile']) } : {}),
            };
          }
          session.config.remote = { hosts };
          await saveConfig(session.config);
          return json(res, 200, { ok: true });
        }

        if (body.kind === 'email') {
          const e = body.email ?? {};
          const recipients = String(e['allowRecipients'] ?? '')
            .split(/[\s,;]+/)
            .map((x) => x.trim())
            .filter(Boolean);
          // No wildcard: choosing who the agent may write to is the user's decision.
          if (recipients.some((r) => !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(r))) {
            return json(res, 400, { error: 'one of those is not an email address' });
          }
          if (body.secret) await setCredential('email', body.secret.trim());
          session.config.email = {
            host: String(e['host'] ?? '').trim(),
            port: Number(e['port'] ?? 587),
            ...(e['user'] ? { user: String(e['user']) } : {}),
            from: String(e['from'] ?? '').trim(),
            ...(e['fromName'] ? { fromName: String(e['fromName']) } : {}),
            allowRecipients: recipients,
          };
          await saveConfig(session.config);
          return json(res, 200, { ok: true });
        }

        if (body.kind === 'browser') {
          session.config.browser = { headful: body.headful === true };
          await saveConfig(session.config);
          return json(res, 200, { ok: true });
        }
        return json(res, 400, { error: `unknown integration "${body.kind}"` });
      }

      case 'POST /api/telegram': {
        const body = (await readBody(req)) as {
          action?: string;
          token?: string;
          allowFrom?: string;
          profile?: string;
        };
        const channels = { ...(session.config.channels ?? {}) };

        if (body.action === 'save') {
          const senders = (body.allowFrom ?? '')
            .split(/[\s,]+/)
            .map((s) => s.trim())
            .filter(Boolean);
          // No wildcard, ever. An empty list would start a bot that answers nobody, which
          // reads as broken; refusing here says why.
          if (senders.length === 0) {
            return json(res, 400, {
              error:
                'at least one Telegram user id is required — there is no wildcard, because this ' +
                'lets whoever is listed start a run on this machine',
            });
          }
          if (senders.some((s) => !/^\d+$/.test(s))) {
            return json(res, 400, {
              error: 'a Telegram user id is all digits. Ask @userinfobot for yours.',
            });
          }
          if (body.token) {
            // Straight into credentials.json at 0600, never config.json.
            await setCredential('channel:telegram', body.token.trim());
          }
          if (!getCredential('channel:telegram')) {
            return json(res, 400, { error: 'a bot token is needed before this can listen' });
          }
          const profile = body.profile === 'assisted' ? 'assisted' : 'read-only';
          channels['telegram'] = {
            kind: 'telegram',
            allowFrom: senders,
            profile,
            workspace: session.workspaceRoot,
            allowTools: [],
          };
          session.config.channels = channels;
          await saveConfig(session.config);
          const listening = await startChannels().catch(() => false);
          return json(res, 200, { ok: true, listening });
        }

        if (body.action === 'check') {
          const token = getCredential('channel:telegram');
          if (!token) return json(res, 200, { ok: false, error: 'no token stored yet' });
          const { TelegramChannel } = await import('../channels/telegram.js');
          try {
            await new TelegramChannel('telegram', token).check();
            return json(res, 200, { ok: true });
          } catch (e) {
            return json(res, 200, { ok: false, error: toHatsError(e).message });
          }
        }

        if (body.action === 'forget') {
          await clearCredential('channel:telegram');
          delete channels['telegram'];
          session.config.channels = channels;
          await saveConfig(session.config);
          return json(res, 200, { ok: true });
        }
        return json(res, 400, { error: `unknown action "${body.action}"` });
      }

      case 'GET /api/telegram': {
        const cfg = (session.config.channels ?? {})['telegram'];
        return json(res, 200, {
          tokenHint: credentialHint(getCredential('channel:telegram')),
          allowFrom: cfg?.allowFrom ?? [],
          profile: cfg?.profile ?? 'read-only',
          configured: Boolean(cfg),
          listening: channelsRunning(),
        });
      }

      default:
        return json(res, 404, { error: 'NOT_FOUND', path: url.pathname });
    }
  }

  /**
   * @param isRepair  A repair run must not queue more repairs when it finishes. Without
   *                  this the first broken tool starts a run, whose own failures stage a
   *                  defect, which starts another run — a loop that costs money and never
   *                  reaches a person.
   */
  function startRun(request: string, isRepair = false): LiveRun {
    const live: LiveRun = {
      runId: `pending_${randomBytes(6).toString('hex')}`,
      events: [],
      listeners: new Set(),
      done: false,
    };
    current = live;
    runs.set(live.runId, live);

    const emit = (event: RunEvent) => {
      live.events.push(event);
      for (const l of live.listeners) sse(l, 'event', event);
    };

    const askHuman = (kind: 'approval' | 'clarification', payload: ApprovalRequest | ClarificationRequest) =>
      new Promise<string>((resolve) => {
        const ask: PendingAsk = { id: randomBytes(6).toString('hex'), kind, payload, resolve };
        live.pending = ask;
        for (const l of live.listeners) sse(l, 'ask', { id: ask.id, kind, ...payload });
      });

    void (async () => {
      try {
        const result = await runAgent({
          request,
          workspaceRoot: session.workspaceRoot,
          config: session.config,
          registry: session.registry,
          pool: session.pool,
          memory: session.memory,
          documents: session.documents,
          profile: session.profile,
          handlers: session.handlers,
          history,
          onEvent: emit,
          ask: (r) => askHuman('clarification', r),
          approve: async (r) => (await askHuman('approval', r)) === 'yes',
        });
        // Re-keyed under the real run id so feedback and the run log line up — but the old
        // key is *kept* pointing at the same run. A client is handed the pending id when the
        // run starts and subscribes a moment later; deleting the key made that subscription
        // 404 for anything that finished first, and the page then sat on "working" forever
        // because the stream it was waiting for never existed. Both ids resolve now.
        const pendingId = live.runId;
        live.runId = result.runId;
        runs.set(pendingId, live);
        live.result = result;
        runs.set(result.runId, live);
        // Trimmed to the tail, then walked forward past any leading tool_result — a slice
        // that starts mid tool-call sends the provider a tool_result with no matching
        // tool_use in front of it, which is refused outright. Everything after position 0 is
        // untouched, so a message that opens a tool call still carries its own results.
        history = dropOrphanedToolResults(result.messages.slice(-40));

        await session.memory
          .distill({
            runId: result.runId,
            question: request,
            answer: result.answer,
            signals: {
              ok: result.ok,
              deniedTools: result.observations.filter((o) => o.ruleId).map((o) => o.tool),
              failedTools: result.observations.filter((o) => !o.ok && !o.ruleId).map((o) => o.tool),
              gateFailures: result.gateFindings.filter((g) => !g.passed).map((g) => g.ruleId),
              steps: result.steps,
              stepBudget: result.stepBudget,
              sandboxDescriptors: result.sandboxDescriptors,
            },
          })
          .catch(() => undefined);

        // ADR-0006: announce, never silent. Only skills and rules, only on `adaptive`.
        const mined = await mineProposals(session.slug, session.config, session.logger).catch(() => []);
        for (const m of mined) {
          emit({ type: 'note', message: `noticed a pattern across ${m.occurrences} runs — staged a ${m.kind} proposal: ${m.title}` });
        }
        const promotion = await runAutoPromotion(session.config, session.logger).catch(() => null);
        const announcement = promotion ? describePromotion(promotion) : '';
        if (announcement) {
          session.registry = await reloadRegistry();
          emit({ type: 'note', message: announcement });
        }

        // The agent decides to repair a tool nobody asked it to repair.
        //
        // One at a time, and never from inside a repair: the autonomy level says whether to
        // do this at all, `repairStartedAt` makes each report a one-shot, and the patch it
        // produces still only lands if the build and the entire test suite pass.
        const nextRepair = !isRepair ? promotion?.repairs?.[0] : undefined;
        if (nextRepair?.defect) {
          const repair = startRun(repairRequest(nextRepair.defect.tool, nextRepair.content), true);
          await noteRepairStarted(nextRepair.id, repair.runId);
          emit({
            type: 'note',
            message: `started repairing ${nextRepair.defect.tool} on its own — watch it in Chat, or in Conversations if this one has closed`,
          });
        }
      } catch (e) {
        live.error = toHatsError(e).message;
      } finally {
        live.done = true;
        for (const l of live.listeners) {
          sse(l, 'done', { result: summarise(live), error: live.error });
          l.end();
        }
        live.listeners.clear();
      }
    })();

    return live;
  }

  async function reloadRegistry() {
    const { Registry } = await import('../registry/loader.js');
    const { knownEnforcementPoints } = await import('../engine/gates.js');
    return Registry.load({ knownGates: knownEnforcementPoints() });
  }

  const port = opts.port ?? 4173;
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    // 127.0.0.1, never 0.0.0.0: this must not be reachable from the network.
    server.listen(port, '127.0.0.1', resolve);
  });

  const address = server.address();
  const actualPort = typeof address === 'object' && address ? address.port : port;
  const url = `http://127.0.0.1:${actualPort}/?token=${token}`;
  void current;

  // The panel is how most people run this, so schedules have to fire here too — otherwise
  // `hats schedule add` from the panel would create something that never runs. The lock
  // means a separate `hats schedule daemon` refuses rather than doubling every firing.
  try {
    const { Scheduler } = await import('../schedule/runner.js');
    scheduler = new Scheduler();
    await scheduler.start();
  } catch (e) {
    // A daemon already holding the lock is normal, not fatal: the panel still works, and
    // the schedules are being fired by that daemon.
    scheduler = undefined;
    session.logger.info('panel is not running the scheduler', { reason: toHatsError(e).message });
  }

  // Inbound channels, if any are configured. Polled on a timer rather than a blocking
  // loop so the panel's own request handling is never waiting on Telegram.
  async function startChannels(): Promise<boolean> {
    if (channels) return true;
    const { ChannelManager } = await import('../channels/index.js');
    const manager = new ChannelManager(session.config, session.workspaceRoot);
    const started = await manager.start();
    if (started.length === 0) return false;
    channels = manager;
    const tick = () => {
      void manager.tick().catch(() => undefined).then(() => {
        if (channels) channelLoop = setTimeout(tick, 3_000);
      });
    };
    tick();
    return true;
  }
  await startChannels().catch(() => false);

  return {
    url,
    schedulerRunning: scheduler !== undefined,
    close: () => {
      for (const live of runs.values()) for (const l of live.listeners) l.end();
      void scheduler?.stop();
      if (channelLoop) clearTimeout(channelLoop);
      channels = undefined;
      server.close();
    },
  };
}

// --- helpers ------------------------------------------------------------------------

function ollamaBaseUrl(session: Session): string {
  const ollama = Object.entries(session.config.providers).find(([, p]) => p.kind === 'ollama');
  return ollama?.[1].baseUrl ?? PRESETS['ollama']!.baseUrl;
}

async function state(session: Session) {
  /** Never returns a key — only whether one resolved, from where, and its last four. */
  const keyFacts = (id: string, p: { apiKeyEnv?: string; kind?: string; baseUrl?: string }) => {
    const conf = session.config.providers[id] ?? {
      kind: (PRESETS[id]?.kind ?? 'openai-compat') as never,
      baseUrl: PRESETS[id]?.baseUrl ?? '',
      ...(p.apiKeyEnv ? { apiKeyEnv: p.apiKeyEnv } : {}),
    };
    const { key, source } = resolveApiKeyWithSource(id, conf);
    return {
      keyEnv: apiKeyEnvName(id, conf) ?? null,
      keySet: Boolean(key),
      keySource: source,
      keyHint: credentialHint(key),
      keyNeeded: Boolean(PRESETS[id]?.apiKeyEnv),
    };
  };

  const providers = Object.entries(session.config.providers).map(([id, p]) => ({
    id,
    kind: p.kind,
    baseUrl: p.baseUrl,
    label: PRESETS[id]?.label ?? id,
    note: PRESETS[id]?.note ?? null,
    ...keyFacts(id, p),
  }));
  return {
    workspace: session.workspaceRoot,
    home: hatsHome(),
    profile: session.config.profile,
    network: session.config.network.enabled,
    autonomy: session.config.autonomy,
    defaultProvider: session.config.defaultProvider,
    tiers: session.config.tiers,
    providers,
    presets: Object.values(PRESETS)
      .filter((p) => p.kind !== 'mock')
      .map((p) => ({
        id: p.id,
        label: p.label,
        baseUrl: p.baseUrl,
        note: p.note ?? null,
        ...keyFacts(p.id, p),
      })),
    credentialsPath: credentialsPath(),
    mcp: session.mcp.connections,
    toolCount: session.handlers.length,
  };
}

async function models(session: Session, providerId: string) {
  const id = providerId || session.config.defaultProvider;
  const conf = session.config.providers[id] ?? {
    kind: PRESETS[id]?.kind ?? 'openai-compat',
    baseUrl: PRESETS[id]?.baseUrl ?? '',
    ...(PRESETS[id]?.modelsPath ? { modelsPath: PRESETS[id]?.modelsPath } : {}),
    ...(PRESETS[id]?.apiKeyEnv ? { apiKeyEnv: PRESETS[id]?.apiKeyEnv } : {}),
  };

  const pool = new ProviderPool({ ...session.config, providers: { ...session.config.providers, [id]: conf } });
  const entries = await catalogue();

  try {
    const list = await pool.get(id).listModels();
    return {
      provider: id,
      local: conf.kind === 'ollama' || /127\.0\.0\.1|localhost/.test(conf.baseUrl),
      models: list.map((m) => ({ id: m.id, detail: m.detail ?? null, price: quote(entries, id, m.id) })),
    };
  } catch (e) {
    return { provider: id, models: [], error: toHatsError(e).message };
  }
}

function summarise(live: LiveRun) {
  if (!live.result) return null;
  const r = live.result;
  return {
    runId: r.runId,
    ok: r.ok,
    answer: r.answer,
    // Rendered server-side so there is one markdown implementation and one place where
    // escaping happens, rather than a second renderer living in the page.
    answerHtml: renderMarkdown(r.answer),
    steps: r.steps,
    stepBudget: r.stepBudget,
    outcomeId: r.outcomeId,
    profile: r.profile,
    artifactCount: r.artifactCount,
    modelsUsed: r.modelsUsed,
    protocolDowngraded: r.protocolDowngraded,
    gateFindings: r.gateFindings,
    pendingQuestion: r.pendingQuestion ?? null,
  };
}

function json(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(payload);
}

function sse(res: ServerResponse, event: string, data: unknown): void {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > 2 * 1024 * 1024) throw new Error('request body too large');
    chunks.push(chunk as Buffer);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw.trim()) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}
