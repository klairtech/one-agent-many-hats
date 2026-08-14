/**
 * Web search, through a search API rather than by scraping a search engine.
 *
 * Observed in a live run: Google redirected with no content, DuckDuckGo served a CAPTCHA
 * after two queries, and Bing returned results about Windows 11 for a question about a
 * thalassemia charity. That is not a bug to fix — search engines detect and block
 * automated fetches on purpose, and any workaround stops working the week someone notices.
 *
 * So `fetch_url` on a search page is the wrong tool and always was. This is a real search
 * API with a key, in the same shape as a model provider: the key lives in credentials.json
 * at mode 0600, and the tool says plainly when none is configured instead of falling back
 * to scraping and producing confident nonsense.
 */

import { HatsError } from '../../core/errors.js';
import { getCredential } from '../../core/credentials.js';
import { requestJson } from '../../providers/http.js';
import type { ToolHandler, ToolResult } from '../types.js';

export interface SearchHit {
  title: string;
  url: string;
  snippet: string;
}

/**
 * The providers worth supporting, in the order they are tried. All have a free tier; none
 * of them ban automated use, which is the entire point.
 */
const PROVIDERS = ['brave', 'tavily', 'serper'] as const;
type SearchProvider = (typeof PROVIDERS)[number];

const SETUP = [
  'No search provider is configured, so there is no way to search the web.',
  '',
  'Scraping Google, Bing or DuckDuckGo does not work — they block automated fetches, and a',
  'run that tries gets redirects, CAPTCHAs and results about the wrong subject entirely.',
  '',
  'Pick one and store the key (it is written to credentials.json at mode 0600, never to',
  'config.json):',
  '',
  '  Brave   — 2,000 queries/month free   https://brave.com/search/api',
  '            hats channel token search:brave',
  '  Tavily  — built for agents, free tier  https://tavily.com',
  '            hats channel token search:tavily',
  '  Serper  — Google results, 2,500 free   https://serper.dev',
  '            hats channel token search:serper',
].join('\n');

export const webSearch: ToolHandler = {
  spec: {
    name: 'web_search',
    description:
      'Search the web and get back titles, URLs and snippets. Use this to find pages — then fetch_url or browser_open to read them. Never fetch a search engine URL directly: they block automated requests and return CAPTCHAs or unrelated results.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'What to search for.' },
        limit: { type: 'number', description: 'How many results. Default 8, max 20.' },
      },
      required: ['query'],
    },
    mutating: false,
    network: true,
    minProfile: 'read-only',
  },

  async run(args, ctx): Promise<ToolResult> {
    if (!ctx.config.network.enabled) {
      throw new HatsError(
        'NETWORK_DENIED',
        'web_search needs tool network egress, which is off',
        {},
        'rule/network-off-by-default',
      );
    }
    const query = String(args['query'] ?? '').trim();
    if (!query) throw new HatsError('TOOL_INPUT_INVALID', 'web_search needs a query', {});
    const limit = Math.min(Math.max(Number(args['limit'] ?? 8), 1), 20);

    const configured = PROVIDERS.find((p) => getCredential(`search:${p}`));
    if (!configured) {
      // A clear dead end beats a plausible wrong answer. The model should report this
      // rather than try to scrape its way around it.
      throw new HatsError('CONFIG_MISSING', SETUP, { providers: [...PROVIDERS] });
    }

    const key = getCredential(`search:${configured}`) as string;
    const hits = await run(configured, key, query, limit, ctx.signal);
    if (hits.length === 0) {
      return {
        summary: `No results for "${query}" from ${configured}.`,
        payload: { query, provider: configured, hits: [] },
        failed: true,
      };
    }

    return {
      summary:
        `${hits.length} result(s) for "${query}" via ${configured}:\n\n` +
        hits
          .map((h, i) => `${i + 1}. ${h.title}\n   ${h.url}\n   ${h.snippet}`)
          .join('\n\n'),
      payload: { query, provider: configured, hits },
      provenance: { provider: configured, query },
    };
  },
};

async function run(
  provider: SearchProvider,
  key: string,
  query: string,
  limit: number,
  signal?: AbortSignal,
): Promise<SearchHit[]> {
  const id = `search:${provider}`;
  if (provider === 'brave') {
    const res = await requestJson<{ web?: { results?: Array<Record<string, string>> } }>(
      `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${limit}`,
      {
        method: 'GET',
        headers: { accept: 'application/json', 'x-subscription-token': key },
        providerId: id,
        retries: 1,
        ...(signal ? { signal } : {}),
      },
    );
    return (res.web?.results ?? []).map((r) => ({
      title: strip(r['title'] ?? ''),
      url: r['url'] ?? '',
      snippet: strip(r['description'] ?? ''),
    }));
  }

  if (provider === 'tavily') {
    const res = await requestJson<{ results?: Array<Record<string, string>> }>(
      'https://api.tavily.com/search',
      {
        body: { api_key: key, query, max_results: limit, search_depth: 'basic' },
        providerId: id,
        retries: 1,
        ...(signal ? { signal } : {}),
      },
    );
    return (res.results ?? []).map((r) => ({
      title: strip(r['title'] ?? ''),
      url: r['url'] ?? '',
      snippet: strip(r['content'] ?? ''),
    }));
  }

  const res = await requestJson<{ organic?: Array<Record<string, string>> }>(
    'https://google.serper.dev/search',
    {
      headers: { 'x-api-key': key },
      body: { q: query, num: limit },
      providerId: id,
      retries: 1,
      ...(signal ? { signal } : {}),
    },
  );
  return (res.organic ?? []).map((r) => ({
    title: strip(r['title'] ?? ''),
    url: r['link'] ?? '',
    snippet: strip(r['snippet'] ?? ''),
  }));
}

/** Providers return highlight markup in titles and snippets; it is noise to the model. */
function strip(text: string): string {
  return text.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().slice(0, 300);
}

export const searchTools: ToolHandler[] = [webSearch];
