/**
 * Signing in to an MCP server.
 *
 * Run against a real authorization server rather than a mock of one: it publishes both
 * metadata documents, registers a client, verifies the PKCE challenge with its own SHA-256,
 * and refuses a code whose verifier does not match. A test double that accepts whatever we
 * send proves only that we can send it — and the whole security argument here is that the
 * *other* side checks.
 */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import test from 'node:test';

import {
  discoverAuthorizationServer,
  pkce,
  prepareSignIn,
  readTokens,
  refreshTokens,
  resourceMetadataUrl,
  usableAccessToken,
  writeTokens,
} from '../src/mcp/oauth.js';
import { resetCredentialCache } from '../src/core/credentials.js';
import { cleanup, tempHome } from './helpers.js';

interface Fake {
  origin: string;
  close: () => Promise<void>;
  /** Every code this server issued, with the challenge it was bound to. */
  issued: Map<string, { challenge: string; redirectUri: string }>;
  registrations: number;
  /** Set to drop S256 from the advertised methods. */
  advertise: { s256: boolean };
}

async function fakeProvider(): Promise<Fake> {
  const issued = new Map<string, { challenge: string; redirectUri: string }>();
  const state = { registrations: 0, advertise: { s256: true } };
  let origin = '';

  const server: Server = createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? '/', origin);
      const send = (code: number, body: unknown) => {
        res.writeHead(code, { 'content-type': 'application/json' });
        res.end(JSON.stringify(body));
      };

      if (url.pathname === '/.well-known/oauth-protected-resource') {
        return send(200, { resource: `${origin}/mcp`, authorization_servers: [origin] });
      }

      if (url.pathname === '/.well-known/oauth-authorization-server') {
        return send(200, {
          issuer: origin,
          authorization_endpoint: `${origin}/authorize`,
          token_endpoint: `${origin}/token`,
          registration_endpoint: `${origin}/register`,
          ...(state.advertise.s256 ? { code_challenge_methods_supported: ['S256'] } : { code_challenge_methods_supported: ['plain'] }),
        });
      }

      if (url.pathname === '/register') {
        state.registrations++;
        return send(201, { client_id: `client_${state.registrations}` });
      }

      if (url.pathname === '/authorize') {
        // The person approving, compressed into a redirect. Everything this server needs to
        // check later is bound to the code right here.
        const challenge = url.searchParams.get('code_challenge') ?? '';
        const redirectUri = url.searchParams.get('redirect_uri') ?? '';
        const code = `code_${issued.size + 1}`;
        issued.set(code, { challenge, redirectUri });
        const back = new URL(redirectUri);
        back.searchParams.set('code', code);
        back.searchParams.set('state', url.searchParams.get('state') ?? '');
        res.writeHead(302, { location: back.toString() });
        return res.end();
      }

      if (url.pathname === '/token') {
        const body = new URLSearchParams(await new Promise<string>((resolve) => {
          let raw = '';
          req.on('data', (d) => (raw += d));
          req.on('end', () => resolve(raw));
        }));

        if (body.get('grant_type') === 'refresh_token') {
          return body.get('refresh_token') === 'refresh_1'
            ? send(200, { access_token: 'access_2', expires_in: 3600 })
            : send(400, { error: 'invalid_grant' });
        }

        const record = issued.get(body.get('code') ?? '');
        if (!record) return send(400, { error: 'invalid_grant' });

        // The check the whole design rests on: the code is worthless without the verifier.
        const verifier = body.get('code_verifier') ?? '';
        const computed = createHash('sha256').update(verifier).digest('base64url');
        if (computed !== record.challenge) return send(400, { error: 'invalid_grant', error_description: 'PKCE mismatch' });
        if (body.get('redirect_uri') !== record.redirectUri) return send(400, { error: 'invalid_grant' });

        return send(200, { access_token: 'access_1', refresh_token: 'refresh_1', expires_in: 3600 });
      }

      res.writeHead(404).end();
    })();
  });

  const port = await new Promise<number>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const a = server.address();
      resolve(typeof a === 'object' && a ? a.port : 0);
    });
  });
  origin = `http://127.0.0.1:${port}`;

  return {
    origin,
    issued,
    get registrations() {
      return state.registrations;
    },
    advertise: state.advertise,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

test('a sign-in runs end to end and stores a token', async () => {
  const home = await tempHome();
  resetCredentialCache();
  const provider = await fakeProvider();
  try {
    const pending = await prepareSignIn({ server: 'demo', url: `${provider.origin}/mcp` });

    // The browser step, done by fetch. Following the redirect is exactly what a browser does
    // with the 302, and it is what delivers the code to our loopback listener.
    const visited = await fetch(pending.authorizeUrl, { redirect: 'follow' });
    assert.equal(visited.status, 200, 'the callback page should have rendered');

    const tokens = await pending.completed;
    assert.equal(tokens.accessToken, 'access_1');
    assert.equal(tokens.refreshToken, 'refresh_1');
    assert.equal(provider.registrations, 1, 'the client should have registered exactly once');

    // Stored, and stored under this connector's own key.
    assert.equal(readTokens('demo')?.accessToken, 'access_1');
    assert.equal(readTokens('other')?.accessToken, undefined, 'a token leaked across connectors');
    assert.equal(usableAccessToken('demo'), 'access_1');
  } finally {
    await provider.close();
    resetCredentialCache();
    await cleanup(home);
  }
});

test('the authorization request is bound by PKCE and by resource', async () => {
  const home = await tempHome();
  resetCredentialCache();
  const provider = await fakeProvider();
  try {
    const pending = await prepareSignIn({ server: 'demo', url: `${provider.origin}/mcp` });
    const url = new URL(pending.authorizeUrl);

    assert.equal(url.searchParams.get('code_challenge_method'), 'S256', 'PKCE must be S256');
    assert.ok((url.searchParams.get('code_challenge') ?? '').length >= 43, 'no challenge was sent');
    assert.ok((url.searchParams.get('state') ?? '').length >= 16, 'no state was sent');
    assert.equal(
      url.searchParams.get('resource'),
      `${provider.origin}/mcp`,
      'the token was not bound to the resource that asked for it',
    );
    assert.match(url.searchParams.get('redirect_uri') ?? '', /^http:\/\/127\.0\.0\.1:\d+\/callback$/);

    pending.cancel();
    await pending.completed.catch(() => undefined);
  } finally {
    await provider.close();
    resetCredentialCache();
    await cleanup(home);
  }
});

test('a callback with the wrong state is discarded without touching the code', async () => {
  const home = await tempHome();
  resetCredentialCache();
  const provider = await fakeProvider();
  try {
    const pending = await prepareSignIn({ server: 'demo', url: `${provider.origin}/mcp` });
    const redirect = new URL(new URL(pending.authorizeUrl).searchParams.get('redirect_uri') as string);
    redirect.searchParams.set('code', 'code_from_somewhere_else');
    redirect.searchParams.set('state', 'not-the-state-we-issued');

    // Attached before the callback is fired. The rejection happens inside the listener's
    // own request handler, so a handler attached afterwards arrives a tick too late and the
    // process sees an unhandled rejection — which is also why the panel attaches a catch the
    // moment it starts a sign-in.
    const settled = assert.rejects(pending.completed, /state did not match/);

    const res = await fetch(redirect.toString());
    assert.equal(res.status, 400, 'a mismatched callback should be refused');
    await settled;
    assert.equal(readTokens('demo'), undefined, 'a token was stored from an unsolicited callback');
  } finally {
    await provider.close();
    resetCredentialCache();
    await cleanup(home);
  }
});

test('a provider that cannot do S256 is refused rather than downgraded', async () => {
  const home = await tempHome();
  resetCredentialCache();
  const provider = await fakeProvider();
  provider.advertise.s256 = false;
  try {
    await assert.rejects(
      prepareSignIn({ server: 'demo', url: `${provider.origin}/mcp` }),
      /does not support PKCE with S256/,
    );
  } finally {
    await provider.close();
    resetCredentialCache();
    await cleanup(home);
  }
});

test('an expired token refreshes, and keeps the refresh token when none is reissued', async () => {
  const home = await tempHome();
  resetCredentialCache();
  const provider = await fakeProvider();
  try {
    await writeTokens('demo', {
      accessToken: 'access_1',
      refreshToken: 'refresh_1',
      expiresAt: Date.now() - 1_000,
      clientId: 'client_1',
      tokenEndpoint: `${provider.origin}/token`,
      resource: `${provider.origin}/mcp`,
    });
    assert.equal(usableAccessToken('demo'), undefined, 'an expired token should not be offered');

    const next = await refreshTokens('demo');
    assert.equal(next?.accessToken, 'access_2');
    // The fake reissues no refresh token, which is normal for providers that do not rotate.
    // Dropping the one we hold would make every later refresh impossible.
    assert.equal(next?.refreshToken, 'refresh_1', 'the refresh token was lost');
    assert.equal(usableAccessToken('demo'), 'access_2');
  } finally {
    await provider.close();
    resetCredentialCache();
    await cleanup(home);
  }
});

test('the metadata location comes from the header when the server gives one', () => {
  assert.equal(
    resourceMetadataUrl('Bearer realm="x", resource_metadata="https://api.example.com/.well-known/oauth-protected-resource"', 'https://api.example.com/mcp'),
    'https://api.example.com/.well-known/oauth-protected-resource',
  );
  // No header: the convention, at the origin rather than beside the path.
  assert.equal(
    resourceMetadataUrl(null, 'https://api.example.com/deep/mcp'),
    'https://api.example.com/.well-known/oauth-protected-resource',
  );
});

test('a verifier and its challenge are a matching S256 pair', () => {
  const { verifier, challenge } = pkce();
  assert.equal(createHash('sha256').update(verifier).digest('base64url'), challenge);
  assert.ok(verifier.length >= 43, 'the verifier is shorter than the spec allows');
  assert.notEqual(pkce().verifier, verifier, 'two sign-ins produced the same verifier');
});

test('discovery reports every path it tried when there is no metadata', async () => {
  const home = await tempHome();
  resetCredentialCache();
  try {
    await assert.rejects(discoverAuthorizationServer('http://127.0.0.1:1/nowhere'), /no OAuth metadata/);
  } finally {
    await cleanup(home);
  }
});

/**
 * The catalogue is a set of promises about addresses, and a promise nobody checks decays.
 * This does not reach the network — it asserts the shape, so an entry cannot be added
 * without the fields that make it honest.
 */
test('every catalogue entry says what it is, what it costs you, and what was verified', async () => {
  const { MCP_CATALOGUE, DELIBERATELY_OMITTED } = await import('../src/ui/mcp-catalogue.js');
  const ids = new Set<string>();

  for (const entry of MCP_CATALOGUE) {
    assert.ok(entry.id && !ids.has(entry.id), `duplicate or missing id: ${entry.id}`);
    ids.add(entry.id);
    assert.ok(entry.adds.length > 30, `${entry.id} does not say what it adds`);
    assert.ok(entry.caveat.length > 30, `${entry.id} has no caveat — every entry has one`);
    assert.ok(entry.verified.length > 0, `${entry.id} records no verification`);
    assert.match(entry.docs, /^https:\/\//, `${entry.id} has no documentation link`);

    // Exactly one shape: a command to run, or an endpoint to reach.
    const local = Boolean(entry.command);
    const remote = Boolean(entry.url);
    assert.notEqual(local, remote, `${entry.id} must be either local or remote, not both or neither`);
    if (remote) assert.match(entry.url as string, /^https:\/\//, `${entry.id} must be https`);
    if (entry.signIn) assert.ok(remote, `${entry.id} cannot sign in without being remote`);
  }

  for (const omitted of DELIBERATELY_OMITTED) {
    assert.ok(omitted.reason.length > 40, `${omitted.id} is omitted without a reason worth reading`);
    assert.ok(!ids.has(omitted.id), `${omitted.id} is both listed and omitted`);
  }
});
