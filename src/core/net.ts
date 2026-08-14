/**
 * The network guard, for tools only.
 *
 * Important distinction, because getting it backwards would be a security bug dressed as
 * a feature: this guard governs *tool* egress (fetch_url). It does not govern the
 * runtime's own calls to the model provider, which are egress by definition — if you
 * point hats at api.openai.com, your prompt goes to OpenAI. The guard exists because
 * ADR-0005 treats "the model can aim a request at a URL it chose" as a different and
 * larger threat than "the runtime talks to the configured provider".
 */

import { HatsError } from './errors.js';
import type { HatsConfig } from './config.js';

const ALWAYS_DENIED_HOSTS = new Set([
  // Cloud instance metadata: the classic SSRF target.
  '169.254.169.254',
  'metadata.google.internal',
  'metadata.goog',
]);

export interface NetDecision {
  url: URL;
  host: string;
}

export function assertToolNetworkAllowed(cfg: HatsConfig, rawUrl: string): NetDecision {
  if (!cfg.network.enabled) {
    throw new HatsError(
      'NETWORK_DENIED',
      'network tools are disabled. Enable with `hats config set network.enabled true` — read docs/adr/0005 first: this is the one switch that turns a prompt injection into an exfiltration channel.',
      { url: rawUrl },
      'rule/network-off-by-default',
    );
  }

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new HatsError('NETWORK_DENIED', `not a valid URL: ${rawUrl}`, { url: rawUrl });
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new HatsError('NETWORK_DENIED', `protocol ${url.protocol} is not permitted`, {
      url: rawUrl,
    });
  }

  const host = url.hostname.toLowerCase();
  if (ALWAYS_DENIED_HOSTS.has(host) || isLinkLocal(host)) {
    throw new HatsError(
      'NETWORK_DENIED',
      `host ${host} is permanently denied (instance metadata / link-local)`,
      { url: rawUrl },
      'rule/network-off-by-default',
    );
  }

  const allow = cfg.network.allowHosts ?? [];
  if (allow.length > 0 && !allow.some((pattern) => hostMatches(host, pattern))) {
    throw new HatsError(
      'NETWORK_DENIED',
      `host ${host} is not in network.allowHosts`,
      { url: rawUrl, allowHosts: allow },
      'rule/network-off-by-default',
    );
  }

  return { url, host };
}

/** `example.com` matches itself and its subdomains; `*` matches everything. */
function hostMatches(host: string, pattern: string): boolean {
  const p = pattern.trim().toLowerCase();
  if (p === '*') return true;
  if (p.startsWith('*.')) return host === p.slice(2) || host.endsWith(p.slice(1));
  return host === p || host.endsWith('.' + p);
}

function isLinkLocal(host: string): boolean {
  return host.startsWith('169.254.') || host.startsWith('fe80:');
}
