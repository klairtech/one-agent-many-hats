/**
 * A short list of MCP servers that are known to work with this client.
 *
 * Two things this is not. It is not a directory — there are hundreds of servers and a list
 * nobody maintains is worse than no list, because a stale entry looks like a recommendation.
 * And nothing here is connected for you: adding one is a click you make, because an MCP
 * server is someone else's code running on your machine and that is not a decision to
 * inherit from a default.
 *
 * Every entry was started on a real machine and completed an `initialize` handshake before
 * it went in; `verified` records the version that answered. Anything that could not be made
 * to handshake is absent rather than listed hopefully.
 *
 * **On the servers you sign into.** The obvious candidates — GitHub, Linear, Notion,
 * Sentry — authenticate with OAuth, which this client now speaks: press Sign in on a remote
 * connector and it discovers the provider, registers itself, and sends you there to approve.
 * They are still absent from the list below, for a duller reason than being impossible.
 * Their endpoint URLs move, and an entry here is a promise that the address was checked on
 * a real machine. Add one by URL and sign in; a verified entry can follow.
 */

export interface CatalogueEntry {
  id: string;
  label: string;
  /** What it adds that this runtime cannot already do. */
  adds: string;
  /** The honest caveat. Every entry has one; an entry without one is not being examined. */
  caveat: string;
  /** Local servers: the command to run. */
  command?: string;
  args?: string[];
  /** Remote servers: the endpoint. Signing in happens on the connector card afterwards. */
  url?: string;
  /** True when the endpoint answers 401 and expects an OAuth sign-in. */
  signIn?: boolean;
  /** Where the people who wrote it document it. */
  docs: string;
  /** What was observed when this entry was added. */
  verified: string;
}

export const MCP_CATALOGUE: CatalogueEntry[] = [
  // The sign-in servers. Each address was sent an `initialize` from this machine and
  // answered 401 with a WWW-Authenticate header; the discovery chain was then run with the
  // shipped code, and each reached an authorization server offering dynamic registration and
  // S256. Nothing here was signed into on anyone's behalf — the last step is yours, which is
  // the entire point of the flow.
  {
    id: 'linear',
    label: 'Linear — issues and projects',
    adds: 'Read and update issues, projects and cycles in your Linear workspace.',
    caveat:
      'It can change things: an agent with this connected can move and edit issues your team ' +
      'is working from. Per-call approval still applies, and a tool the server does not mark ' +
      'read-only is treated as able to change things.',
    url: 'https://mcp.linear.app/mcp',
    signIn: true,
    docs: 'https://linear.app/docs/mcp',
    verified: '401 + OAuth discovery, dynamic registration, S256',
  },
  {
    id: 'notion',
    label: 'Notion — pages and databases',
    adds: 'Search, read and write the pages and databases you can already reach in Notion.',
    caveat:
      'The grant covers what your own account can see, which in most workspaces is a great ' +
      'deal. Sign in with the account whose access you actually want the agent to have.',
    url: 'https://mcp.notion.com/mcp',
    signIn: true,
    docs: 'https://developers.notion.com/docs/mcp',
    verified: '401 + OAuth discovery, dynamic registration, S256',
  },
  {
    id: 'sentry',
    label: 'Sentry — errors and traces',
    adds:
      'The stack trace, the frequency and the release for a production error, without leaving ' +
      'the conversation that is trying to fix it.',
    caveat: 'Issue data includes whatever your application put in it, which is often user data.',
    url: 'https://mcp.sentry.dev/mcp',
    signIn: true,
    docs: 'https://docs.sentry.io/product/sentry-mcp/',
    verified: '401 + OAuth discovery, dynamic registration, S256',
  },
  {
    id: 'asana',
    label: 'Asana — tasks and projects',
    adds: 'Read and update tasks, projects and portfolios in your Asana workspace.',
    caveat: 'It can create and complete tasks other people are relying on.',
    url: 'https://mcp.asana.com/sse',
    signIn: true,
    docs: 'https://developers.asana.com/docs/mcp-server',
    verified: '401 + OAuth discovery, dynamic registration, S256',
  },
  {
    id: 'atlassian',
    label: 'Jira and Confluence',
    adds: 'Issues in Jira and pages in Confluence, from the same conversation.',
    caveat:
      'Its metadata is not at the path the header implies, so discovery falls back to the ' +
      'origin. That works, and is worth knowing if a sign-in ever fails oddly.',
    url: 'https://mcp.atlassian.com/v1/sse',
    signIn: true,
    docs: 'https://support.atlassian.com/atlassian-rovo-mcp-server/',
    verified: '401 + OAuth discovery via origin fallback, dynamic registration, S256',
  },

  {
    id: 'context7',
    label: 'Context7 — library documentation',
    adds:
      'Current documentation and examples for a named library, fetched at call time. The ' +
      'model’s own knowledge of a fast-moving package is as old as its training data, and ' +
      'this is the gap that produces confident code against an API that changed.',
    caveat:
      'It calls a hosted service, so the library you ask about leaves this machine. Free, ' +
      'and no account needed.',
    command: 'npx',
    args: ['-y', '@upstash/context7-mcp'],
    docs: 'https://context7.com',
    verified: '4.0.2',
  },
  {
    id: 'playwright',
    label: 'Playwright — a real browser',
    adds:
      'Full browser automation: a real page tree, form filling, waiting for elements, ' +
      'multiple tabs. More capable than the built-in browser tools by a wide margin.',
    caveat:
      'It overlaps browser_open, browser_read and browser_act, and it is a second browser ' +
      'with its own profile. Prefer the built-ins for anything they can already do — they go ' +
      'through the network guard, and a connector cannot.',
    command: 'npx',
    args: ['-y', '@playwright/mcp@latest', '--headless'],
    docs: 'https://github.com/microsoft/playwright-mcp',
    verified: '1.63.0',
  },
  {
    id: 'everything',
    label: 'Everything — the reference server',
    adds:
      'The protocol’s own test server: tools, prompts and resources that exercise every ' +
      'part of the handshake. Add it when a connector will not connect and you need to know ' +
      'whether the problem is your setup or their server.',
    caveat:
      'It does nothing useful on its own. Remove it once you have your answer, or it sits ' +
      'in the tool list adding noise to every prompt.',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-everything'],
    docs: 'https://github.com/modelcontextprotocol/servers',
    verified: '2.0.0',
  },
];

/**
 * Servers that were tested, work, and are deliberately absent. Recorded because "why is
 * the filesystem server not on the list" is a fair question with a specific answer, and an
 * unexplained omission reads as an oversight.
 */
export const DELIBERATELY_OMITTED = [
  {
    id: 'github',
    reason:
      'Its endpoint is live and its authorization server supports S256, but it does not offer ' +
      'dynamic client registration — so it needs a client id you create by hand. Add it by ' +
      'URL (https://api.githubcopilot.com/mcp/) and set oauthClientId on the connector, and ' +
      'the sign-in works; there is no one-click version to list.',
  },
  {
    id: 'paypal',
    reason:
      'It works, and it moves money. A payments API is not something to suggest from a list ' +
      'of conveniences — add it deliberately if you want it.',
  },

  {
    id: 'filesystem',
    reason:
      'It reads and writes files, and it is not governed by the path guard — that guard ' +
      'covers our tools, and cannot cover a process we did not write. Adding it would put a ' +
      'second, unbounded filesystem path next to the one that is bounded, which is a ' +
      'downgrade wearing the clothes of a convenience.',
  },
  {
    id: 'memory',
    reason:
      'This runtime has its own memory layers, with lessons, takeaways and a distillation ' +
      'pass. A second store the agent can also write to means two answers to "what does it ' +
      'remember", and no way to tell which one was used.',
  },
];
