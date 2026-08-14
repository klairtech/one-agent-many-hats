/**
 * Sandbox child entrypoint. Plain .mjs on purpose: no build step, and no package.json
 * lookup — the parent starts it with `--permission`, so the filesystem is denied and the
 * loader must not need to read anything beyond this file.
 *
 * Protocol: one JSON request on stdin, one JSON response on stdout. Nothing else is
 * written to stdout, ever, or the parent cannot parse the reply.
 *
 * The isolation argument is in docs/adr/0004. The rule this file must not break:
 * **no host object crosses into the VM context.** Inputs arrive as a JSON *string*
 * embedded in the bootstrap source and are parsed by the sandbox realm's own JSON.parse;
 * helpers are compiled from source inside the context. If a host object were handed in,
 * `hostObject.constructor.constructor('return process')()` would reach this realm.
 */

import vm from 'node:vm';

// Layer 4 (ADR-0004): --permission does not cover network. Remove the globals before any
// generated code exists in the process at all.
for (const name of [
  'fetch',
  'WebSocket',
  'EventSource',
  'XMLHttpRequest',
  'navigator',
  'Request',
  'Response',
  'Headers',
]) {
  try {
    delete globalThis[name];
  } catch {
    /* non-configurable in some builds; the VM realm does not expose it regardless */
  }
}

const BOOTSTRAP = `
  const __DATA__ = JSON.parse(__RAW_DATA__);
  const __LOGS__ = [];

  function log(...parts) {
    if (__LOGS__.length < 200) {
      __LOGS__.push(parts.map((p) => (typeof p === 'string' ? p : JSON.stringify(p))).join(' '));
    }
  }

  function load_artifact(id) {
    if (!Object.prototype.hasOwnProperty.call(__DATA__, id)) {
      throw new Error('no artifact "' + id + '" was bound to this run. Bound: ' + Object.keys(__DATA__).join(', '));
    }
    return __DATA__[id];
  }

  function artifact_ids() {
    return Object.keys(__DATA__);
  }

  function lookup(rows, match) {
    if (!Array.isArray(rows)) return undefined;
    const keys = Object.keys(match || {});
    return rows.find((row) => row && keys.every((k) => row[k] === match[k]));
  }

  function sum(values, field) {
    if (!Array.isArray(values)) return 0;
    return values.reduce((acc, v) => acc + Number(field ? (v || {})[field] : v || 0), 0);
  }
`;

function readStdin() {
  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      data += chunk;
      if (data.length > 32 * 1024 * 1024) reject(new Error('input too large'));
    });
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', reject);
  });
}

let replied = false;

function reply(payload) {
  if (replied) return;
  replied = true;
  process.stdout.write(JSON.stringify(payload));
}

// A snippet that schedules work (a dynamic import, a rejected thenable) can fault the
// child after the synchronous result was produced. Answer once, cleanly, either way.
process.on('uncaughtException', (e) => {
  reply({ ok: false, error: 'sandbox faulted: ' + String((e && e.message) || e) });
  process.exit(0);
});
process.on('unhandledRejection', (e) => {
  reply({ ok: false, error: 'sandbox rejected: ' + String((e && e.message) || e) });
  process.exit(0);
});

async function main() {
  let request;
  try {
    request = JSON.parse(await readStdin());
  } catch (e) {
    reply({ ok: false, error: 'bad request: ' + e.message });
    return;
  }

  const code = String(request.code ?? '');
  const timeoutMs = Math.min(Number(request.timeoutMs ?? 5000), 60_000);
  const maxOutputBytes = Number(request.maxOutputBytes ?? 256_000);
  const rawData = JSON.stringify(JSON.stringify(request.artifacts ?? {}));

  // Null-prototype context: no Node globals, no host realm reachable through prototypes.
  const context = vm.createContext(Object.create(null), {
    codeGeneration: { strings: false, wasm: false },
  });

  const program = `
    ${BOOTSTRAP.replace('__RAW_DATA__', rawData)}
    (function () {
      const __RESULT__ = (function () {
        ${code}
      })();
      if (__RESULT__ && typeof __RESULT__.then === 'function') {
        throw new Error('the sandbox is synchronous: return a value, not a promise (there is nothing to await — no network, no files, no timers)');
      }
      return JSON.stringify({ ok: true, result: __RESULT__ === undefined ? null : __RESULT__, logs: __LOGS__ });
    })();
  `;

  try {
    // No importModuleDynamically callback is installed, deliberately: without one, a
    // dynamic import inside the sandbox faults rather than resolving, and the
    // uncaughtException handler above turns that into a clean failure reply.
    const out = vm.runInContext(program, context, {
      timeout: timeoutMs,
      displayErrors: true,
    });
    if (typeof out !== 'string') {
      reply({ ok: false, error: 'sandbox returned a non-serialisable value' });
      return;
    }
    if (out.length > maxOutputBytes) {
      reply({
        ok: false,
        error: `output is ${out.length} bytes, over the ${maxOutputBytes} byte cap. Aggregate inside the script instead of returning raw rows.`,
      });
      return;
    }
    if (!replied) {
      replied = true;
      process.stdout.write(out);
    }
  } catch (e) {
    reply({
      ok: false,
      error: String((e && e.message) || e),
      kind: /timed out/i.test(String((e && e.message) || '')) ? 'timeout' : 'error',
    });
  }
}

main().catch((e) => reply({ ok: false, error: 'runner failure: ' + String(e && e.message) }));
