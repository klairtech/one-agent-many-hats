/**
 * Driving a real browser, over the Chrome DevTools Protocol.
 *
 * `fetch_url` gets you HTML. That is enough for a documentation page and useless for
 * anything behind a click, a form, or JavaScript that renders the content you wanted. This
 * is the other half: open a page, read what is actually on screen, click things, type into
 * fields, and look at it.
 *
 * CDP rather than Playwright because Node 22 ships a WebSocket client, so the whole thing
 * is HTTP to `/json` plus one socket — no dependency, no browser download, and it drives
 * the Chrome already installed on the machine. The cost is that Chrome must be started
 * with `--remote-debugging-port`; this launches one on a separate profile if it has to.
 *
 * The boundary: every navigation goes through the same network guard as `fetch_url`, so an
 * allowHosts list still applies. What it cannot do is govern what the *page* then loads —
 * same caveat as an MCP browser server, and for the same reason.
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';

import { HatsError } from '../../core/errors.js';
import { assertToolNetworkAllowed } from '../../core/net.js';
import type { ToolContext, ToolHandler, ToolResult } from '../types.js';

const PORT = 9333;
const CHROME_PATHS = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
];

let session: CdpSession | null = null;

export const browserOpen: ToolHandler = {
  spec: {
    name: 'browser_open',
    description:
      'Open a URL in a real browser and return the visible text of the page. Use this instead of fetch_url when the page needs JavaScript, a login, or a click to show what you want. The browser stays open, so follow it with browser_read, browser_act or browser_shot.',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'The URL to open.' },
        wait_ms: { type: 'number', description: 'Extra settle time after load. Default 1200.' },
      },
      required: ['url'],
    },
    mutating: false,
    network: true,
    minProfile: 'read-only',
  },
  async run(args, ctx): Promise<ToolResult> {
    const url = String(args['url'] ?? '').trim();
    assertToolNetworkAllowed(ctx.config, url);
    const cdp = await ensureSession(ctx);
    await cdp.send('Page.navigate', { url });
    await cdp.settle(Number(args['wait_ms'] ?? 1200));
    const text = await cdp.pageText();
    const title = await cdp.evaluate<string>('document.title');
    return {
      summary: `${title} — ${url}\n\n${text}`,
      payload: { url, title, text },
      provenance: { url, via: 'chrome-devtools-protocol' },
    };
  },
};

export const browserRead: ToolHandler = {
  spec: {
    name: 'browser_read',
    description:
      'Read the current browser page again: its visible text, and the links and form fields you can act on. Use it after a click to see what changed.',
    parameters: {
      type: 'object',
      properties: {
        what: {
          type: 'string',
          enum: ['text', 'links', 'fields'],
          description: 'text for the readable content, links for anchors, fields for inputs.',
        },
      },
    },
    mutating: false,
    network: true,
    minProfile: 'read-only',
  },
  async run(args, ctx): Promise<ToolResult> {
    const cdp = requireSession();
    void ctx;
    const what = String(args['what'] ?? 'text');
    if (what === 'links') {
      const links = await cdp.evaluate<Array<{ text: string; href: string }>>(
        `Array.from(document.querySelectorAll('a[href]')).slice(0,120).map(a=>({text:(a.innerText||'').trim().slice(0,80),href:a.href})).filter(l=>l.text)`,
      );
      return {
        summary: links.map((l, i) => `${i + 1}. ${l.text} -> ${l.href}`).join('\n') || 'no links',
        payload: { links },
      };
    }
    if (what === 'fields') {
      const fields = await cdp.evaluate<Array<Record<string, string>>>(collectFieldsScript());
      return {
        summary:
          fields.length === 0
            ? 'no form fields found on this page'
            : `${fields.length} field(s):\n` +
              fields
                .map(
                  (f, i) =>
                    `${i + 1}. <${f['tag']}${f['type'] ? ' ' + f['type'] : ''}> ` +
                    `${describeField(f)}`,
                )
                .join('\n'),
        payload: { fields },
      };
    }
    const text = await cdp.pageText();
    const url = await cdp.evaluate<string>('location.href');
    return { summary: `${url}\n\n${text}`, payload: { url, text } };
  },
};

export const browserAct: ToolHandler = {
  spec: {
    name: 'browser_act',
    description:
      'Interact with the open page: click something, type into a field, press a key, or scroll. Target elements by their visible text or a CSS selector. Requires approval, because a click can buy, send or delete something.',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['click', 'type', 'press', 'scroll', 'back'],
          description: 'What to do.',
        },
        target: {
          type: 'string',
          description: 'Visible text of the element, or a CSS selector. Needed for click and type.',
        },
        text: { type: 'string', description: 'Text to type, or the key name to press.' },
      },
      required: ['action'],
    },
    // A click is not a read. It can submit, purchase, delete or send.
    mutating: true,
    network: true,
    minProfile: 'assisted',
  },
  /**
   * Which site is about to be clicked. The arguments say "click Submit"; only the tool
   * knows that Submit is on example.com. Without this a grant could only ever say "may
   * click anything anywhere", which is not a scope.
   */
  async scopeFacts(): Promise<Record<string, unknown>> {
    if (!session) return {};
    const url = await session.evaluate<string>('location.href').catch(() => '');
    return url ? { host: safeHost(url), url } : {};
  },

  async run(args, ctx): Promise<ToolResult> {
    const cdp = requireSession();
    const action = String(args['action'] ?? '');
    const target = String(args['target'] ?? '');
    const text = String(args['text'] ?? '');

    if (action === 'back') {
      await cdp.evaluate('history.back()');
      await cdp.settle(1000);
      return { summary: 'went back', payload: { action } };
    }
    if (action === 'scroll') {
      await cdp.evaluate(`window.scrollBy(0, ${Number(text || 600)})`);
      return { summary: `scrolled ${text || 600}px`, payload: { action } };
    }
    if (action === 'press') {
      const before = await cdp.evaluate<string>('location.href');
      await cdp.key(text || 'Enter');
      // Enter usually submits, and a search page needs longer than a keystroke to render.
      // Reading too early gave the model an empty results page and it filled the gap by
      // inventing URLs — caught by the gate, but a wasted round trip.
      await cdp.settleUntilReady(6_000);
      let url = await cdp.evaluate<string>('location.href');
      let note = '';
      if (url === before && (text || 'Enter') === 'Enter') {
        const submitted = await cdp.submitFocusedForm();
        if (submitted) {
          await cdp.settleUntilReady(6_000);
          url = await cdp.evaluate<string>('location.href');
          note = ' (Enter alone did nothing, so the form was submitted directly)';
        }
      }
      const moved = url !== before;
      return {
        summary:
          `pressed ${text || 'Enter'}${note} — ` +
          (moved ? `now at ${url}` : `the page did not navigate, still at ${url}`),
        payload: { action, key: text, url, navigated: moved },
        // Saying so lets the model try something else instead of reading an unchanged page.
        failed: !moved,
      };
    }

    const found = await cdp.evaluate<{ ok: boolean; x: number; y: number; label: string }>(
      locatorScript(target, action),
    );
    if (!found?.ok) {
      // Naming what is actually there turns two wasted steps into one. The model guessed
      // "Search or enter address" on a page whose box says "Search privately", failed,
      // had to call browser_read, then guess again. [Seen in a live run, 2026-08-14.]
      const nearby = await cdp
        .evaluate<Array<Record<string, string>>>(collectFieldsScript())
        .catch(() => []);
      const relevant =
        action === 'type'
          ? nearby.filter((f) => ['input', 'textarea', 'select'].includes(f['tag'] ?? ''))
          : nearby;
      const options = relevant.map(describeField).filter(Boolean).slice(0, 15);
      throw new HatsError(
        'TOOL_FAILED',
        `nothing on the page matches "${target}". What is actually here: ` +
          (options.length ? options.map((o) => `"${o}"`).join(', ') : 'no labelled controls') +
          '. Use one of those, or a CSS selector.',
        { target, available: options },
      );
    }

    if (action === 'click') {
      ctx.logger.warn('browser.click.pending', { target, label: found.label });
      await cdp.click(found.x, found.y);
      await cdp.settleUntilReady(6_000);
      const url = await cdp.evaluate<string>('location.href');
      return { summary: `clicked "${found.label}" — now at ${url}`, payload: { target, url } };
    }

    // type
    await cdp.click(found.x, found.y);
    await cdp.evaluate(`(()=>{const e=document.activeElement; if(e&&'value' in e) e.value='';})()`);
    await cdp.type(text);
    const where = found.label || target;
    return { summary: `typed ${text.length} characters into "${where}"`, payload: { target, chars: text.length } };
  },
};

export const browserShot: ToolHandler = {
  spec: {
    name: 'browser_shot',
    description:
      'Take a screenshot of the current page and store it as an artifact, so the user can look at what the agent is looking at.',
    parameters: { type: 'object', properties: {} },
    mutating: false,
    network: true,
    minProfile: 'read-only',
  },
  async run(_args, ctx): Promise<ToolResult> {
    const cdp = requireSession();
    const shot = await cdp.send<{ data: string }>('Page.captureScreenshot', { format: 'png' });
    const url = await cdp.evaluate<string>('location.href');
    const artifact = await ctx.artifacts.putBinary(
      'browser_shot',
      Buffer.from(shot.data, 'base64'),
      'png',
      { url },
    );
    return {
      summary: `screenshot of ${url}`,
      payload: { url },
      artifactId: artifact,
    };
  },
};

/**
 * Every control on the page, including inside shadow roots.
 *
 * A plain querySelectorAll misses anything a web component keeps in a shadow root, and
 * modern search pages are full of them — on DuckDuckGo it found one button and no search
 * box, which is worse than useless because it reads as "there is no search box".
 */
function collectFieldsScript(): string {
  return `(()=>{
    const out=[];
    const vis=(e)=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0;};
    const walk=(root,depth)=>{
      if(depth>6||out.length>80) return;
      let nodes=[];
      try{ nodes=[...root.querySelectorAll('input,textarea,select,button,[role=button],[role=textbox],[contenteditable=true]')]; }catch(e){}
      for(const e of nodes){
        if(!vis(e)) continue;
        out.push({tag:e.tagName.toLowerCase(),type:e.type||'',name:e.name||'',id:e.id||'',
          placeholder:e.placeholder||'',aria:e.getAttribute('aria-label')||'',
          label:(e.innerText||e.value||'').trim().slice(0,60)});
      }
      let hosts=[];
      try{ hosts=[...root.querySelectorAll('*')].filter(e=>e.shadowRoot); }catch(e){}
      for(const h of hosts) walk(h.shadowRoot,depth+1);
    };
    walk(document,0);
    return out;
  })()`;
}

/** The name a human would use for a control, in the order a model should try them. */
function describeField(f: Record<string, string>): string {
  return f['aria'] || f['placeholder'] || f['label'] || f['name'] || f['id'] || '';
}

/** Finds an element by visible text first, then as a CSS selector, and returns its centre. */
function locatorScript(target: string, action: string): string {
  const t = JSON.stringify(target);
  // Typing needs somewhere to type. Wikipedia has a <button> and an <input> both labelled
  // "Search Wikipedia"; the button matched first, the text went nowhere, Enter did nothing,
  // and the run reported success three times while achieving nothing.
  // [Seen in a live run, 2026-08-14.]
  const typable = action === 'type';
  const candidateSelector = typable
    ? 'input,textarea,select,[role=textbox],[contenteditable=true]'
    : 'a,button,input,textarea,select,[role=button],[role=link],[role=textbox],[contenteditable=true],label';
  return `(()=>{
    const want=${t}.trim().toLowerCase();
    // Rendered, but not necessarily in the viewport — this scrolls the match into view a
    // moment later, so demanding it already be on screen only made the locator reject
    // things browser_read had just offered as available. [Seen in a live run, 2026-08-14.]
    const vis=(e)=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0;};
    let el=null;
    const canType=(e)=>['input','textarea','select'].includes(e.tagName.toLowerCase())||e.isContentEditable;
    try{ const bySel=document.querySelector(${t}); if(bySel&&vis(bySel)&&(!typable||canType(bySel))) el=bySel; }catch(e){}
    if(!el){
      const cands=[];
      const SEL=${JSON.stringify(candidateSelector)};
      const walk=(root,depth)=>{
        if(depth>6) return;
        try{ cands.push(...root.querySelectorAll(SEL)); }catch(e){}
        let hosts=[];
        try{ hosts=[...root.querySelectorAll('*')].filter(e=>e.shadowRoot); }catch(e){}
        for(const h of hosts) walk(h.shadowRoot,depth+1);
      };
      walk(document,0);
      // Every name the control answers to, not the first non-empty one. A || chain stops
      // at the placeholder, so DuckDuckGo's box (placeholder "Search privately",
      // aria-label "Search with DuckDuckGo") could never be found by its aria-label — the
      // exact name browser_read had just reported. [Seen in a live run, 2026-08-14.]
      const names=(e)=>[e.innerText,e.value,e.placeholder,e.getAttribute('aria-label'),
                        e.getAttribute('title'),e.getAttribute('name'),e.id]
        .filter(Boolean).map(v=>String(v).trim().toLowerCase()).filter(Boolean);
      el=cands.find(e=>vis(e)&&names(e).some(n=>n===want))
        ||cands.find(e=>vis(e)&&names(e).some(n=>n.includes(want)));
    }
    if(!el) return {ok:false,x:0,y:0,label:''};
    el.scrollIntoView({block:'center'});
    const r=el.getBoundingClientRect();
    return {ok:true,x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2),
            label:((el.getAttribute('aria-label')||el.innerText||el.placeholder||el.value||'').trim().slice(0,60))};
  })()`;
}

// --- the protocol client -------------------------------------------------------------

class CdpSession {
  private ws: WebSocket | null = null;
  private nextId = 1;
  private readonly waiting = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();

  constructor(private readonly wsUrl: string) {}

  async connect(): Promise<void> {
    this.ws = new WebSocket(this.wsUrl);
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('the browser did not accept a connection')), 15_000);
      this.ws!.addEventListener('open', () => {
        clearTimeout(t);
        resolve();
      });
      this.ws!.addEventListener('error', () => {
        clearTimeout(t);
        reject(new Error('could not connect to the browser'));
      });
    });
    this.ws.addEventListener('message', (ev: MessageEvent) => {
      const msg = JSON.parse(String(ev.data)) as { id?: number; result?: unknown; error?: { message: string } };
      if (msg.id === undefined) return;
      const pending = this.waiting.get(msg.id);
      if (!pending) return;
      this.waiting.delete(msg.id);
      if (msg.error) pending.reject(new Error(msg.error.message));
      else pending.resolve(msg.result);
    });
    await this.send('Page.enable', {});
    await this.send('Runtime.enable', {});
  }

  send<T = Record<string, unknown>>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    if (!this.ws) throw new HatsError('TOOL_FAILED', 'the browser session is closed', {});
    const id = this.nextId++;
    const done = new Promise<T>((resolve, reject) => {
      this.waiting.set(id, { resolve: resolve as (v: unknown) => void, reject });
      setTimeout(() => {
        if (this.waiting.delete(id)) reject(new Error(`${method} timed out`));
      }, 45_000);
    });
    this.ws.send(JSON.stringify({ id, method, params }));
    return done;
  }

  async evaluate<T>(expression: string): Promise<T> {
    const res = await this.send<{ result?: { value?: T }; exceptionDetails?: { text: string } }>(
      'Runtime.evaluate',
      { expression, returnByValue: true, awaitPromise: true },
    );
    if (res.exceptionDetails) {
      throw new HatsError('TOOL_FAILED', `page script failed: ${res.exceptionDetails.text}`, {});
    }
    return res.result?.value as T;
  }

  /** The readable text, with script/style/nav noise dropped and whitespace collapsed. */
  async pageText(): Promise<string> {
    const text = await this.evaluate<string>(`(()=>{
      const drop=['script','style','noscript','svg'];
      const clone=document.body.cloneNode(true);
      drop.forEach(t=>clone.querySelectorAll(t).forEach(e=>e.remove()));
      return (clone.innerText||'').replace(/\\n{3,}/g,'\\n\\n').trim().slice(0, 12000);
    })()`);
    return text || '(the page rendered no readable text)';
  }

  async click(x: number, y: number): Promise<void> {
    for (const type of ['mousePressed', 'mouseReleased']) {
      await this.send('Input.dispatchMouseEvent', {
        type,
        x,
        y,
        button: 'left',
        clickCount: 1,
      });
    }
  }

  async type(text: string): Promise<void> {
    for (const ch of text) {
      await this.send('Input.dispatchKeyEvent', { type: 'char', text: ch });
    }
  }

  /**
   * A full key sequence: rawKeyDown, char, keyUp.
   *
   * keyDown+keyUp alone is not enough. Plenty of pages listen for `keypress`, which Chrome
   * only synthesises from a `char` event — Wikipedia's search box accepted the text, showed
   * a suggestion dropdown, and then ignored Enter three times in a row while the tool
   * cheerfully reported success. [Seen in a live run, 2026-08-14.]
   */
  async key(name: string): Promise<void> {
    const map: Record<string, { key: string; code: string; keyCode: number; text?: string }> = {
      Enter: { key: 'Enter', code: 'Enter', keyCode: 13, text: '\r' },
      Tab: { key: 'Tab', code: 'Tab', keyCode: 9 },
      Escape: { key: 'Escape', code: 'Escape', keyCode: 27 },
      ArrowDown: { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40 },
    };
    const k = map[name] ?? map['Enter']!;
    const base = {
      key: k.key,
      code: k.code,
      windowsVirtualKeyCode: k.keyCode,
      nativeVirtualKeyCode: k.keyCode,
    };
    await this.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...base });
    if (k.text) await this.send('Input.dispatchKeyEvent', { type: 'char', text: k.text, ...base });
    await this.send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
  }

  /**
   * Last resort when Enter did nothing: submit the form the focused field belongs to.
   * Some search boxes only respond to a real submit, and reporting "pressed Enter" while
   * the page sits unchanged is the least useful possible outcome.
   */
  async submitFocusedForm(): Promise<boolean> {
    return this.evaluate<boolean>(`(()=>{
      const e=document.activeElement;
      const f=e&&e.closest?e.closest('form'):null;
      if(!f) return false;
      if(f.requestSubmit) f.requestSubmit(); else f.submit();
      return true;
    })()`).catch(() => false);
  }

  /**
   * Waits for the document to finish loading and for the DOM to stop changing, up to a
   * cap. A fixed sleep is either too short for a search page or wasted on a static one.
   */
  async settleUntilReady(maxMs: number): Promise<void> {
    const deadline = Date.now() + maxMs;
    let lastSize = -1;
    let stable = 0;
    while (Date.now() < deadline) {
      await this.settle(400);
      const state = await this.evaluate<{ ready: string; size: number }>(
        `({ready: document.readyState, size: document.body ? document.body.innerHTML.length : 0})`,
      ).catch(() => null);
      if (!state) continue;
      if (state.ready !== 'complete') continue;
      // Two consecutive identical sizes is enough: the page has stopped rendering.
      if (state.size === lastSize) {
        if (++stable >= 2) return;
      } else {
        stable = 0;
        lastSize = state.size;
      }
    }
  }

  async settle(ms: number): Promise<void> {
    await new Promise((r) => setTimeout(r, Math.max(0, Math.min(ms, 15_000))));
  }

  close(): void {
    this.ws?.close();
    this.ws = null;
  }
}

function safeHost(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
}

function requireSession(): CdpSession {
  if (!session) {
    throw new HatsError(
      'TOOL_FAILED',
      'no page is open — call browser_open with a URL first',
      {},
    );
  }
  return session;
}

async function ensureSession(ctx: ToolContext): Promise<CdpSession> {
  if (session) return session;
  if (!ctx.config.network.enabled) {
    throw new HatsError(
      'NETWORK_DENIED',
      'the browser needs tool network egress, which is off',
      {},
      'rule/network-off-by-default',
    );
  }

  let target = await findTarget();
  if (!target) {
    await launchChrome(ctx);
    for (let i = 0; i < 20 && !target; i++) {
      await new Promise((r) => setTimeout(r, 500));
      target = await findTarget();
    }
  }
  if (!target) {
    throw new HatsError(
      'TOOL_FAILED',
      `could not start a browser. Install Chrome, or start it yourself with: --remote-debugging-port=${PORT}`,
      { tried: CHROME_PATHS.filter((p) => existsSync(p)) },
    );
  }
  const cdp = new CdpSession(target);
  await cdp.connect();
  session = cdp;
  return cdp;
}

async function findTarget(): Promise<string | null> {
  try {
    const res = await fetch(`http://127.0.0.1:${PORT}/json/list`, {
      signal: AbortSignal.timeout(1500),
    });
    const list = (await res.json()) as Array<{ type: string; webSocketDebuggerUrl?: string }>;
    return list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl)?.webSocketDebuggerUrl ?? null;
  } catch {
    return null;
  }
}

async function launchChrome(ctx: ToolContext): Promise<void> {
  const bin = CHROME_PATHS.find((p) => existsSync(p));
  if (!bin) return;
  // A separate profile directory, deliberately: attaching to the user's everyday Chrome
  // would hand the agent every logged-in session they have. This one starts empty.
  const profile = path.join(tmpdir(), 'hats-browser-profile');
  ctx.logger.warn('browser.launch', { bin, port: PORT, profile });
  // Headless unless the user asked to watch. A window stealing focus every time the agent
  // looks something up makes background work unusable; `--headless=new` renders the same
  // pages over the same protocol, it simply does not appear.
  const headful = ctx.config.browser?.headful === true;
  const child = spawn(
    bin,
    [
      `--remote-debugging-port=${PORT}`,
      `--user-data-dir=${profile}`,
      ...(headful ? [] : ['--headless=new', '--disable-gpu']),
      '--window-size=1280,900',
      '--no-first-run',
      '--no-default-browser-check',
      'about:blank',
    ],
    { detached: true, stdio: 'ignore' },
  );
  child.unref();
}

/**
 * Opens a page in the shared browser and returns what it rendered. Used by `web_search`,
 * which needs a real Chrome rather than `fetch_url`: search engines serve a redirect or a
 * CAPTCHA to anything that does not look like a browser, and a browser is the one thing
 * that does.
 */
export async function renderPageText(
  ctx: ToolContext,
  url: string,
  settleMs = 2_500,
): Promise<{ url: string; title: string; text: string; html: string }> {
  const cdp = await ensureSession(ctx);
  await cdp.send('Page.navigate', { url });
  await cdp.settleUntilReady(settleMs);
  const [title, finalUrl, text, html] = await Promise.all([
    cdp.evaluate<string>('document.title').catch(() => ''),
    cdp.evaluate<string>('location.href').catch(() => url),
    cdp.pageText().catch(() => ''),
    cdp.evaluate<string>('document.documentElement.outerHTML.slice(0, 400000)').catch(() => ''),
  ]);
  return { url: finalUrl, title, text, html };
}

/** Extracts result rows from whatever search page is currently open. */
export async function scrapeResults(
  ctx: ToolContext,
  selectors: { row: string; title: string; link: string; snippet: string },
): Promise<Array<{ title: string; url: string; snippet: string }>> {
  const cdp = await ensureSession(ctx);
  const script = `(()=>{
    const out=[];
    document.querySelectorAll(${JSON.stringify(selectors.row)}).forEach((row)=>{
      const a=row.querySelector(${JSON.stringify(selectors.link)});
      const t=row.querySelector(${JSON.stringify(selectors.title)});
      const s=row.querySelector(${JSON.stringify(selectors.snippet)});
      const href=a&&a.href;
      if(!href||href.startsWith('javascript')) return;
      const title=((t&&t.innerText)||(a&&a.innerText)||'').trim();
      if(!title) return;
      out.push({title:title.slice(0,200),url:href,snippet:((s&&s.innerText)||'').trim().slice(0,300)});
    });
    return out.slice(0,25);
  })()`;
  return cdp.evaluate<Array<{ title: string; url: string; snippet: string }>>(script).catch(() => []);
}

export const browserTools: ToolHandler[] = [browserOpen, browserRead, browserAct, browserShot];
