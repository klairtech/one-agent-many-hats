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
  command: string;
  args: string[];
  /** Where the people who wrote it document it. */
  docs: string;
  /** Version that answered `initialize` when this entry was added. */
  verified: string;
}

export const MCP_CATALOGUE: CatalogueEntry[] = [
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
