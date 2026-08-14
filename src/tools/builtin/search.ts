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
import { renderPageText, scrapeResults } from './browser.js';
import type { ToolContext, ToolHandler, ToolResult } from '../types.js';

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

    // 1. A search API, if one is configured. Cheapest, most reliable, no blocking.
    const configured = PROVIDERS.find((p) => getCredential(`search:${p}`));
    if (configured) {
      const key = getCredential(`search:${configured}`) as string;
      const hits = await run(configured, key, query, limit, ctx.signal).catch(() => []);
      if (hits.length > 0) return present(query, configured, hits, 'api');
      ctx.logger.warn('search.api.empty', { provider: configured, query });
    }

    // 2. Plain HTTP with browser-like headers. Most of what makes an engine refuse is the
    // missing User-Agent and Accept headers rather than anything clever, and the
    // lightweight endpoints (Mojeek, DuckDuckGo's HTML view) serve real results to a
    // request that looks ordinary. No browser process, nothing on screen, milliseconds.
    const viaHttp = await searchOverHttp(ctx, query, limit);
    if (viaHttp.hits.length > 0) return present(query, viaHttp.engine, viaHttp.hits, 'http');

    // 3. A real browser, headless, only when the cheap route failed. Some engines render
    // results with JavaScript and there is no HTML to parse without one.
    const viaBrowser = await searchInBrowser(ctx, query, limit);
    if (viaBrowser.hits.length > 0) return present(query, viaBrowser.engine, viaBrowser.hits, 'browser');

    // 3. Nothing worked. Say which routes were tried, so this is diagnosable rather than
    // a shrug — and so the model does not invent results to fill the gap.
    throw new HatsError(
      'TOOL_FAILED',
      `No results for "${query}".\n\nTried: ` +
        (configured ? `the ${configured} API, then ` : '') +
        `${viaHttp.tried.join(', ')} over plain HTTP, then ` +
        `${viaBrowser.tried.join(', ')} in a headless browser. ` +
        (viaBrowser.blocked.length
          ? `Blocked by: ${viaBrowser.blocked.join(', ')}. `
          : '') +
        (configured ? '' : `\n\n${SETUP}`),
      { query, tried: viaBrowser.tried, blocked: viaBrowser.blocked },
    );
  },
};

/**
 * Which route produced the results is part of the result. An API answer and a scraped one
 * deserve different confidence, and saying "scraped in a browser" when it was a plain fetch
 * is the kind of small lie that makes provenance worthless.
 */
function present(query: string, via: string, hits: SearchHit[], how: 'api' | 'http' | 'browser'): ToolResult {
  const note = { api: '', http: ' (fetched directly)', browser: ' (rendered in a headless browser)' }[how];
  return {
    summary:
      `${hits.length} result(s) for "${query}" via ${via}${note}:\n\n` +
      hits.map((h, i) => `${i + 1}. ${h.title}\n   ${h.url}\n   ${h.snippet}`).join('\n\n'),
    payload: { query, provider: via, method: how, hits },
    provenance: { provider: via, query, method: how },
  };
}

/**
 * Engines, in the order they tolerate being driven. Each names where its result rows live.
 *
 * Mojeek and Startpage first because they are independent indexes that do not fight
 * automation; DuckDuckGo's lite HTML endpoint next; Bing and Google last, because they are
 * the most likely to interrupt with a challenge and the least useful when they do.
 */
const ENGINES: Array<{
  name: string;
  url: (q: string) => string;
  sel: { row: string; title: string; link: string; snippet: string };
}> = [
  {
    name: 'mojeek',
    url: (q) => `https://www.mojeek.com/search?q=${encodeURIComponent(q)}`,
    sel: { row: 'ul.results-standard li', title: 'a.title', link: 'a.title', snippet: 'p.s' },
  },
  {
    name: 'duckduckgo',
    url: (q) => `https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`,
    sel: { row: '.result', title: '.result__a', link: '.result__a', snippet: '.result__snippet' },
  },
  {
    name: 'startpage',
    url: (q) => `https://www.startpage.com/sp/search?query=${encodeURIComponent(q)}`,
    sel: { row: '.w-gl__result', title: '.w-gl__result-title', link: 'a.w-gl__result-url, a', snippet: '.w-gl__description' },
  },
  {
    name: 'bing',
    url: (q) => `https://www.bing.com/search?q=${encodeURIComponent(q)}`,
    sel: { row: '#b_results > li.b_algo', title: 'h2', link: 'h2 a', snippet: '.b_caption p, .b_algoSlug' },
  },
  {
    name: 'google',
    url: (q) => `https://www.google.com/search?q=${encodeURIComponent(q)}`,
    sel: { row: 'div.g, div[data-hveid] > div', title: 'h3', link: 'a[href^="http"]', snippet: 'div[data-sncf], .VwiC3b' },
  },
];

const CHALLENGE = /captcha|unusual traffic|are you a robot|verify you are human|automated queries|access denied/i;

/**
 * Headers an ordinary browser sends. Most refusals are a missing User-Agent rather than
 * anything sophisticated, and sending real ones is the difference between a redirect and
 * a page of results.
 */
const BROWSERISH = {
  'user-agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'accept-language': 'en-GB,en;q=0.9',
};

/** Engines whose results survive a plain fetch, with the pattern that pulls rows out. */
const HTTP_ENGINES: Array<{ name: string; url: (q: string) => string; parse: (html: string) => SearchHit[] }> = [
  {
    name: 'mojeek',
    url: (q) => `https://www.mojeek.com/search?q=${encodeURIComponent(q)}`,
    parse: (html) => matchAll(html, /<a[^>]+class="title"[^>]+href="([^"]+)"[^>]*>(.*?)<\/a>[\s\S]{0,400}?<p class="s">([\s\S]*?)<\/p>/g),
  },
  {
    name: 'duckduckgo',
    url: (q) => `https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`,
    parse: (html) =>
      matchAll(
        html,
        /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]{0,800}?class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g,
      ),
  },
];

function matchAll(html: string, re: RegExp): SearchHit[] {
  const out: SearchHit[] = [];
  for (const m of html.matchAll(re)) {
    const url = decodeRedirect(m[1] ?? '');
    const title = strip(m[2] ?? '');
    if (!url.startsWith('http') || !title) continue;
    out.push({ title, url, snippet: strip(m[3] ?? '') });
  }
  return out;
}

/** DuckDuckGo wraps every result in its own redirect; the real URL is a query parameter. */
function decodeRedirect(href: string): string {
  const raw = href.startsWith('//') ? `https:${href}` : href;
  try {
    const u = new URL(raw);
    const target = u.searchParams.get('uddg');
    return target ? decodeURIComponent(target) : raw;
  } catch {
    return raw;
  }
}

async function searchOverHttp(
  ctx: ToolContext,
  query: string,
  limit: number,
): Promise<{ engine: string; hits: SearchHit[]; tried: string[] }> {
  const tried: string[] = [];
  for (const engine of HTTP_ENGINES) {
    tried.push(engine.name);
    try {
      const res = await fetch(engine.url(query), {
        headers: BROWSERISH,
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) continue;
      const html = await res.text();
      if (CHALLENGE.test(html.slice(0, 4_000))) {
        ctx.logger.warn('search.http.blocked', { engine: engine.name });
        continue;
      }
      const hits = engine.parse(html).slice(0, limit);
      if (hits.length > 0) return { engine: engine.name, hits, tried };
    } catch (e) {
      ctx.logger.warn('search.http.failed', { engine: engine.name, error: (e as Error).message });
    }
  }
  return { engine: '', hits: [], tried };
}

async function searchInBrowser(
  ctx: ToolContext,
  query: string,
  limit: number,
): Promise<{ engine: string; hits: SearchHit[]; tried: string[]; blocked: string[] }> {
  const tried: string[] = [];
  const blocked: string[] = [];

  for (const engine of ENGINES) {
    tried.push(engine.name);
    try {
      const page = await renderPageText(ctx, engine.url(query));
      if (CHALLENGE.test(page.text.slice(0, 3_000))) {
        // A challenge page is not a failure to retry — it is that engine saying no.
        blocked.push(engine.name);
        ctx.logger.warn('search.blocked', { engine: engine.name });
        continue;
      }
      const rows = await scrapeResults(ctx, engine.sel);
      const hits = rows
        .filter((r) => r.url && !r.url.includes(new URL(engine.url('x')).hostname))
        .slice(0, limit);
      if (hits.length > 0) return { engine: engine.name, hits, tried, blocked };
    } catch (e) {
      ctx.logger.warn('search.engine.failed', { engine: engine.name, error: (e as Error).message });
    }
  }
  return { engine: '', hits: [], tried, blocked };
}

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
