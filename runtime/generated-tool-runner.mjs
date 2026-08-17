/**
 * Child entrypoint for tools the agent wrote itself (ADR-0011).
 *
 * Plain .mjs in the package for the same reason as the sandbox runner: the parent starts it
 * with `--permission`, so this file must be loadable without the child reading anything
 * else. The handler source arrives on stdin and is imported as a `data:` URL — never from
 * disk — so a tool with no filesystem grant genuinely cannot be read into the process by
 * any path, including its own.
 *
 * Protocol: one JSON request on stdin, one JSON response on stdout, nothing else on stdout
 * ever, or the parent cannot parse the reply.
 *
 * What makes this different from src/tools/builtin/*: those are trusted code whose spec is
 * a description. This is untrusted code whose spec is an *instruction to the parent* about
 * which flags to start it with. By the time execution reaches this file the decision has
 * already been enforced — the parent either passed --allow-fs-write or it did not, and
 * nothing here can undo that.
 */

// A tool that did not declare network gets no network, and the globals go before any of
// its code exists in the process. --permission does not cover egress (ADR-0004 layer 4),
// so this is the only thing standing between an undeclared tool and a POST.
if (process.env['HATS_TOOL_NETWORK'] !== '1') {
  for (const name of [
    'fetch',
    'WebSocket',
    'EventSource',
    'XMLHttpRequest',
    'Request',
    'Response',
    'Headers',
  ]) {
    try {
      delete globalThis[name];
    } catch {
      /* non-configurable in some builds; the module surface is still denied below */
    }
  }
}

/** Modules that would hand back what the globals above just took away. */
const NETWORK_MODULES = new Set([
  'net',
  'node:net',
  'tls',
  'node:tls',
  'http',
  'node:http',
  'https',
  'node:https',
  'http2',
  'node:http2',
  'dgram',
  'node:dgram',
  'dns',
  'node:dns',
  'node:dns/promises',
  'inspector',
  'node:inspector',
]);

function readStdin() {
  return new Promise((resolve) => {
    let raw = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (d) => {
      raw += d;
    });
    process.stdin.on('end', () => resolve(raw));
  });
}

function reply(value) {
  process.stdout.write(JSON.stringify(value));
}

/** Errors must cross the process boundary as data, not as an exit code and a stack. */
function failure(error, kind) {
  return { ok: false, error: String(error && error.message ? error.message : error), kind };
}

async function main() {
  let request;
  try {
    request = JSON.parse(await readStdin());
  } catch (e) {
    reply(failure(e, 'protocol'));
    return;
  }

  const { code, args, facts, network } = request;

  // Import the handler without touching the filesystem. base64 rather than encodeURIComponent
  // because handler bodies contain the full range of source punctuation and one bad escape
  // would surface as a syntax error in code the agent wrote correctly.
  let handler;
  try {
    const url = `data:text/javascript;base64,${Buffer.from(String(code), 'utf8').toString('base64')}`;
    handler = await import(url);
  } catch (e) {
    reply(failure(e, 'compile'));
    return;
  }

  if (typeof handler.run !== 'function') {
    reply(failure(new Error('the handler module must export a function named "run"'), 'contract'));
    return;
  }

  // Installation-time check: the module loaded and the contract holds, which is everything
  // that can be established without side effects. Calling run() with empty arguments would
  // mean dialling whatever service a connector connects to, and a tool must not have to be
  // reachable in order to be installable.
  if (process.env['HATS_SMOKE'] === '1') {
    reply({ ok: true, summary: 'loads and exports run()' });
    return;
  }

  // The context is plain JSON, never a host object. Anything with a prototype chain back
  // into this realm would hand the tool `constructor.constructor('return process')()`, and
  // the permission flags are worth nothing to a tool holding `process.binding`.
  const ctx = {
    ...facts,
    network: network === true,
    // Deliberately not `require`: a tool that needs a module imports it, and the import
    // itself is what the network guard below sees.
    async import(specifier) {
      const name = String(specifier);
      if (!network && NETWORK_MODULES.has(name)) {
        throw new Error(
          `this tool declared network: false, so ${name} is not available to it`,
        );
      }
      // Node builtins resolve on their own. A bare specifier cannot: this handler was
      // loaded from a data: URL, which has no directory to resolve against. So a bare name
      // is looked up on the shelf — the packages a person installed under ~/.hats/deps —
      // and resolved to an absolute path. Nothing else on the filesystem is reachable: the
      // process only holds a read grant for that one directory.
      if (name.startsWith('node:') || name.startsWith('file:') || name.startsWith('data:')) {
        return import(name);
      }
      const shelf = process.env['HATS_TOOL_DEPS'];
      if (!shelf) {
        throw new Error(
          `no package shelf is configured, so "${name}" cannot be imported. Use a node: ` +
            `builtin, or ask for the package to be installed with: hats tools add ${name}`,
        );
      }
      try {
        // Resolved the way Node itself would — through the package's own `exports` or
        // `main` — rather than by importing the directory, which ESM does not allow. This
        // reads package.json files inside the shelf, and the shelf is the only path the
        // process holds a read grant for.
        const { createRequire } = await import('node:module');
        const { pathToFileURL } = await import('node:url');
        const resolve = createRequire(shelf + '/package.json');
        return await import(pathToFileURL(resolve.resolve(name)).href);
      } catch (e) {
        throw new Error(
          `"${name}" is not on the package shelf. Installed: ${process.env['HATS_TOOL_DEPS_LIST'] || 'nothing yet'}. ` +
            `A person installs one with: hats tools add ${name}  (${e.message})`,
        );
      }
    },
  };

  try {
    const result = await handler.run(args ?? {}, ctx);
    if (!result || typeof result !== 'object') {
      reply(failure(new Error('run() must return an object with a summary'), 'contract'));
      return;
    }
    reply({
      ok: true,
      summary: String(result.summary ?? ''),
      payload: result.payload,
      failed: result.failed === true,
    });
  } catch (e) {
    reply(failure(e, 'runtime'));
  }
}

void main();
