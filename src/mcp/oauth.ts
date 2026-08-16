/**
 * Signing in to an MCP server (OAuth 2.1, as the MCP authorization spec requires).
 *
 * Until now a connector could carry a static header and nothing else, so every server worth
 * connecting to — the ones holding issues, documents, error reports — was unreachable. They
 * all authenticate the same way, and it is not a header: the person signs in at their own
 * provider, and we are handed a token that was never typed into this application.
 *
 * That property is the point, and it shapes every decision here:
 *
 *   - **We never see a password.** The browser goes to the provider. This process learns
 *     only the authorization code that comes back, which is worthless without the verifier.
 *   - **PKCE always**, S256, no exceptions and no downgrade. The code arrives over a
 *     loopback redirect that any local process could race for; the verifier is what makes
 *     winning that race useless.
 *   - **`state` is checked** before the code is touched, so a callback we did not initiate
 *     cannot inject one.
 *   - **The redirect is 127.0.0.1**, never a wildcard, on a port we opened for this one
 *     exchange and close immediately afterwards.
 *   - **Tokens go to the credential store** at 0600, never to config.json, never to a log.
 *   - **`resource` is sent** (RFC 8707) so the token the provider issues is bound to the
 *     server we asked about, and a token leaked from one connector is not a token for
 *     another.
 *
 * The flow is: 401 tells us where the metadata is, the metadata tells us where the
 * authorization server is, the authorization server tells us where to send the person, and
 * dynamic client registration means none of it needs an application to have been registered
 * by hand first.
 */

import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';

import { HatsError } from '../core/errors.js';
import { getCredential, setCredential } from '../core/credentials.js';

export interface AuthorizationServerMetadata {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  registration_endpoint?: string;
  code_challenge_methods_supported?: string[];
  scopes_supported?: string[];
}

export interface ProtectedResourceMetadata {
  resource?: string;
  authorization_servers?: string[];
  scopes_supported?: string[];
}

export interface StoredTokens {
  accessToken: string;
  refreshToken?: string;
  /** Epoch milliseconds. Absent when the provider did not say. */
  expiresAt?: number;
  clientId: string;
  tokenEndpoint: string;
  resource: string;
}

/** One credential key per connector, so revoking one does not touch the others. */
export function tokenKey(server: string): string {
  return `mcp:${server}`;
}

export function readTokens(server: string): StoredTokens | undefined {
  const raw = getCredential(tokenKey(server));
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as StoredTokens;
  } catch {
    // A corrupted entry must not wedge the connector permanently: treat it as absent and
    // let the flow run again.
    return undefined;
  }
}

export async function writeTokens(server: string, tokens: StoredTokens): Promise<void> {
  await setCredential(tokenKey(server), JSON.stringify(tokens));
}

/**
 * A token we hold and believe is still good.
 *
 * Sixty seconds of slack, because the alternative is presenting a token that expires while
 * in flight and getting a 401 that looks like a permissions problem.
 */
export function usableAccessToken(server: string): string | undefined {
  const tokens = readTokens(server);
  if (!tokens) return undefined;
  if (tokens.expiresAt && tokens.expiresAt - 60_000 < Date.now()) return undefined;
  return tokens.accessToken;
}

/**
 * Where the server says its metadata lives.
 *
 * The header is authoritative and takes precedence over the well-known path, because a
 * server behind a path prefix may host its metadata somewhere the convention would miss.
 */
export function resourceMetadataUrl(wwwAuthenticate: string | null, requestUrl: string): string {
  const declared = /resource_metadata\s*=\s*"([^"]+)"/i.exec(wwwAuthenticate ?? '')?.[1];
  if (declared) return declared;
  const url = new URL(requestUrl);
  return `${url.origin}/.well-known/oauth-protected-resource`;
}

async function getJson<T>(url: string, timeoutMs = 15_000): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers: { accept: 'application/json' }, signal: controller.signal });
    if (!res.ok) throw new HatsError('TOOL_FAILED', `${url} returned HTTP ${res.status}`, { url });
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Find the authorization server for a resource.
 *
 * Both well-known paths are tried because deployments disagree about which they publish:
 * RFC 8414 puts the issuer's path *after* the well-known segment, and OpenID Connect puts
 * it before. A server that answers either is a server we can use.
 */
export async function discoverAuthorizationServer(
  issuerUrl: string,
): Promise<AuthorizationServerMetadata> {
  const issuer = new URL(issuerUrl);
  const path = issuer.pathname.replace(/\/$/, '');
  const candidates = [
    `${issuer.origin}/.well-known/oauth-authorization-server${path}`,
    `${issuer.origin}${path}/.well-known/oauth-authorization-server`,
    `${issuer.origin}/.well-known/openid-configuration${path}`,
    `${issuer.origin}${path}/.well-known/openid-configuration`,
  ];

  const failures: string[] = [];
  for (const candidate of candidates) {
    try {
      const meta = await getJson<AuthorizationServerMetadata>(candidate);
      if (meta.authorization_endpoint && meta.token_endpoint) return meta;
      failures.push(`${candidate}: no authorization_endpoint`);
    } catch (e) {
      failures.push(`${candidate}: ${(e as Error).message}`);
    }
  }
  throw new HatsError(
    'CONFIG_INVALID',
    `no OAuth metadata at ${issuerUrl}. Tried:\n${failures.join('\n')}`,
    { issuer: issuerUrl },
  );
}

/**
 * Register this installation as a client (RFC 7591).
 *
 * Without it every user would have to create an application at every provider and paste a
 * client id in, which is the friction that stops people connecting anything at all. A
 * server that does not offer registration is not a failure — it means a client id was
 * issued out of band, and the error says so.
 */
export async function registerClient(
  meta: AuthorizationServerMetadata,
  redirectUri: string,
): Promise<{ client_id: string; client_secret?: string }> {
  if (!meta.registration_endpoint) {
    throw new HatsError(
      'CONFIG_INVALID',
      `${meta.issuer} does not support dynamic client registration, so it needs a client id ` +
        `issued by hand. Register an application there with redirect URI ${redirectUri}, and ` +
        `put the id in the connector's config as oauthClientId.`,
      {},
    );
  }

  const res = await fetch(meta.registration_endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      client_name: 'hats',
      redirect_uris: [redirectUri],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      // A public client: this runs on the person's own machine, where nothing can be kept
      // secret from whoever is at the keyboard. Saying so is honest, and PKCE is what
      // actually secures the exchange.
      token_endpoint_auth_method: 'none',
    }),
  });
  if (!res.ok) {
    throw new HatsError(
      'TOOL_FAILED',
      `client registration at ${meta.registration_endpoint} failed: HTTP ${res.status} ${await res.text()}`,
      {},
    );
  }
  return (await res.json()) as { client_id: string; client_secret?: string };
}

export interface PkcePair {
  verifier: string;
  challenge: string;
}

/** S256 only. `plain` is in the spec and is worth nothing on a loopback redirect. */
export function pkce(): PkcePair {
  const verifier = randomBytes(32).toString('base64url');
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
}

export interface PendingAuthorization {
  /** Where to send the person. */
  authorizeUrl: string;
  /** Resolves with the tokens once the browser comes back, or rejects on timeout. */
  completed: Promise<StoredTokens>;
  /** Give up and close the listener. */
  cancel: () => void;
}

/**
 * Open a one-shot loopback listener and build the URL the person should visit.
 *
 * The listener answers exactly one request and closes. It is not a server in any meaningful
 * sense and must not become one: it exists for the seconds between the person pressing
 * approve and the provider redirecting back.
 */
export async function beginAuthorization(opts: {
  server: string;
  meta: AuthorizationServerMetadata;
  /**
   * Given the redirect URI of the listener that is already open, produce the client to use.
   * Registration has to state the redirect URI, and the URI contains a port that does not
   * exist until something binds it — so the listener comes first and the client is decided
   * against it. Binding a port, closing it, registering, and rebinding would leave a window
   * where another process takes the port and the redirect no longer matches.
   */
  client: (redirectUri: string) => Promise<{ clientId: string; clientSecret?: string }>;
  resource: string;
  scopes?: string[];
  timeoutMs?: number;
}): Promise<PendingAuthorization> {
  const { verifier, challenge } = pkce();
  const state = randomBytes(16).toString('base64url');

  let settle: (t: StoredTokens) => void = () => {};
  let fail: (e: Error) => void = () => {};
  const completed = new Promise<StoredTokens>((resolve, reject) => {
    settle = resolve;
    fail = reject;
  });

  const http = createServer();
  const port = await new Promise<number>((resolve, reject) => {
    http.once('error', reject);
    // Port 0: the OS picks a free one. A fixed port is a port something else may hold, and
    // a redirect URI that does not match exactly is refused by the provider.
    http.listen(0, '127.0.0.1', () => {
      const address = http.address();
      resolve(typeof address === 'object' && address ? address.port : 0);
    });
  });
  const redirectUri = `http://127.0.0.1:${port}/callback`;

  let client: { clientId: string; clientSecret?: string };
  try {
    client = await opts.client(redirectUri);
  } catch (e) {
    http.close();
    throw e;
  }

  const timer = setTimeout(
    () => {
      http.close();
      fail(new HatsError('TOOL_FAILED', 'the sign-in was not completed in time', {}));
    },
    opts.timeoutMs ?? 300_000,
  );

  const done = (res: import('node:http').ServerResponse, status: number, message: string) => {
    res.writeHead(status, { 'content-type': 'text/html; charset=utf-8' });
    res.end(
      `<!doctype html><meta charset="utf-8"><title>hats</title>` +
        `<body style="font:15px/1.6 system-ui;margin:60px auto;max-width:34em;color:#111">` +
        `<p>${message}</p><p style="color:#666">You can close this tab and go back to hats.</p>`,
    );
    clearTimeout(timer);
    http.close();
  };

  http.on('request', (req, res) => {
    void (async () => {
      const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`);
      if (url.pathname !== '/callback') {
        res.writeHead(404).end();
        return;
      }

      // Checked before the code is read, let alone used: a callback we did not start is a
      // callback whose code belongs to someone else's session.
      if (url.searchParams.get('state') !== state) {
        done(res, 400, 'That sign-in did not match the one this app started, so it was ignored.');
        fail(new HatsError('TOOL_FAILED', 'the callback state did not match — the sign-in was discarded', {}));
        return;
      }

      const error = url.searchParams.get('error');
      if (error) {
        const description = url.searchParams.get('error_description') ?? '';
        done(res, 400, `The provider refused: ${error}. ${description}`);
        fail(new HatsError('TOOL_FAILED', `authorization refused: ${error} ${description}`, {}));
        return;
      }

      const code = url.searchParams.get('code');
      if (!code) {
        done(res, 400, 'The provider sent no authorization code.');
        fail(new HatsError('TOOL_FAILED', 'the callback carried no code', {}));
        return;
      }

      try {
        const tokens = await exchangeCode({
          meta: opts.meta,
          code,
          verifier,
          redirectUri,
          clientId: client.clientId,
          ...(client.clientSecret ? { clientSecret: client.clientSecret } : {}),
          resource: opts.resource,
        });
        await writeTokens(opts.server, tokens);
        done(res, 200, `Connected to <strong>${opts.server}</strong>.`);
        settle(tokens);
      } catch (e) {
        done(res, 500, `The token exchange failed: ${(e as Error).message}`);
        fail(e as Error);
      }
    })();
  });

  const authorizeUrl = new URL(opts.meta.authorization_endpoint);
  authorizeUrl.searchParams.set('response_type', 'code');
  authorizeUrl.searchParams.set('client_id', client.clientId);
  authorizeUrl.searchParams.set('redirect_uri', redirectUri);
  authorizeUrl.searchParams.set('state', state);
  authorizeUrl.searchParams.set('code_challenge', challenge);
  authorizeUrl.searchParams.set('code_challenge_method', 'S256');
  // Binds the token to this server. Without it a provider may issue something that works
  // against every resource it knows, which is a far larger grant than was asked for.
  authorizeUrl.searchParams.set('resource', opts.resource);
  if (opts.scopes?.length) authorizeUrl.searchParams.set('scope', opts.scopes.join(' '));

  return {
    authorizeUrl: authorizeUrl.toString(),
    completed,
    cancel: () => {
      clearTimeout(timer);
      http.close();
      fail(new HatsError('TOOL_FAILED', 'the sign-in was cancelled', {}));
    },
  };
}

async function exchangeCode(opts: {
  meta: AuthorizationServerMetadata;
  code: string;
  verifier: string;
  redirectUri: string;
  clientId: string;
  clientSecret?: string;
  resource: string;
}): Promise<StoredTokens> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: opts.code,
    redirect_uri: opts.redirectUri,
    client_id: opts.clientId,
    code_verifier: opts.verifier,
    resource: opts.resource,
  });
  if (opts.clientSecret) body.set('client_secret', opts.clientSecret);

  const res = await fetch(opts.meta.token_endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body,
  });
  if (!res.ok) {
    // The body of a token error names the cause — invalid_grant, invalid_client — and is
    // worth far more than the status. It contains no token by definition: the request failed.
    throw new HatsError('TOOL_FAILED', `token exchange failed: HTTP ${res.status} ${await res.text()}`, {});
  }
  return toStored(
    (await res.json()) as Record<string, unknown>,
    opts.clientId,
    opts.meta.token_endpoint,
    opts.resource,
  );
}

/**
 * Trade a refresh token for a new access token.
 *
 * Returns undefined rather than throwing when there is nothing to refresh with, because the
 * caller's next move is the same either way: start the sign-in again.
 */
export async function refreshTokens(server: string): Promise<StoredTokens | undefined> {
  const current = readTokens(server);
  if (!current?.refreshToken) return undefined;

  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: current.refreshToken,
    client_id: current.clientId,
    resource: current.resource,
  });

  const res = await fetch(current.tokenEndpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body,
  });
  if (!res.ok) return undefined;

  const next = toStored(
    (await res.json()) as Record<string, unknown>,
    current.clientId,
    current.tokenEndpoint,
    current.resource,
  );
  // Rotation is optional, and a provider that does not rotate sends no refresh_token at
  // all. Dropping the one we hold in that case would make the next refresh impossible.
  if (!next.refreshToken && current.refreshToken) next.refreshToken = current.refreshToken;
  await writeTokens(server, next);
  return next;
}

function toStored(
  payload: Record<string, unknown>,
  clientId: string,
  tokenEndpoint: string,
  resource: string,
): StoredTokens {
  const accessToken = String(payload['access_token'] ?? '');
  if (!accessToken) {
    throw new HatsError('TOOL_FAILED', 'the provider returned no access_token', {});
  }
  const expiresIn = Number(payload['expires_in']);
  return {
    accessToken,
    ...(payload['refresh_token'] ? { refreshToken: String(payload['refresh_token']) } : {}),
    ...(Number.isFinite(expiresIn) ? { expiresAt: Date.now() + expiresIn * 1_000 } : {}),
    clientId,
    tokenEndpoint,
    resource,
  };
}

/**
 * Everything between "this server wants a sign-in" and "here is where to send the person".
 *
 * Kept here rather than in the panel so the CLI and the panel cannot drift into two
 * differently-secured versions of the same exchange. The caller's only job is to show the
 * URL and wait — it never handles a code, a verifier or a token.
 */
export async function prepareSignIn(opts: {
  server: string;
  url: string;
  wwwAuthenticate?: string | null;
  clientId?: string;
}): Promise<PendingAuthorization & { issuer: string; resource: string }> {
  const metadataUrl = resourceMetadataUrl(opts.wwwAuthenticate ?? null, opts.url);

  // The resource metadata is optional in practice: plenty of servers 401 without it. When it
  // is missing, the server's own origin is the best guess at both the issuer and the
  // resource, and it is right more often than not.
  let resourceMeta: ProtectedResourceMetadata = {};
  try {
    resourceMeta = await getJson<ProtectedResourceMetadata>(metadataUrl);
  } catch {
    resourceMeta = {};
  }

  const origin = new URL(opts.url).origin;
  const issuer = resourceMeta.authorization_servers?.[0] ?? origin;
  const resource = resourceMeta.resource ?? opts.url;

  const meta = await discoverAuthorizationServer(issuer);

  // Refuse a downgrade rather than proceed without proof of possession. A server that
  // advertises its methods and omits S256 is telling us it cannot do this safely.
  const methods = meta.code_challenge_methods_supported;
  if (methods && !methods.includes('S256')) {
    throw new HatsError(
      'CONFIG_INVALID',
      `${issuer} does not support PKCE with S256, and this will not fall back to a weaker ` +
        `method — the authorization code travels over a loopback redirect that any local ` +
        `process can reach, and the verifier is the only thing protecting it.`,
      { issuer },
    );
  }

  const pending = await beginAuthorization({
    server: opts.server,
    meta,
    // Registered against the port that is already listening. A client id issued for one
    // redirect URI is refused at another, so this cannot be decided any earlier.
    client: async (redirectUri) => {
      if (opts.clientId) return { clientId: opts.clientId };
      const registered = await registerClient(meta, redirectUri);
      return {
        clientId: registered.client_id,
        ...(registered.client_secret ? { clientSecret: registered.client_secret } : {}),
      };
    },
    resource,
    ...(resourceMeta.scopes_supported?.length ? { scopes: resourceMeta.scopes_supported } : {}),
  });
  return { ...pending, issuer, resource };
}

