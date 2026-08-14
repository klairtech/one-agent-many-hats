/**
 * The control panel, as one self-contained document.
 *
 * The visual language is Klair's design system, taken from the reference design: the same
 * tokens, the same type scale, the same pill buttons and `[data-theme]` switching.
 *
 * One deliberate departure. The reference links Plus Jakarta Sans from Google Fonts; this
 * page does not, because the CSP here blocks every external request and that guarantee is
 * worth more than a webfont. The family is still first in the stack, so it renders exactly
 * as designed on any machine that has it installed, and falls back to system-ui otherwise.
 */

export function renderPage(token: string): string {
  return PAGE.replace('__TOKEN__', token);
}

const PAGE = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Klair Hats</title>
<link rel="icon" type="image/png" sizes="32x32" href="/brand/favicon-32.png">
<link rel="icon" type="image/png" sizes="512x512" href="/brand/favicon.png">
<link rel="apple-touch-icon" href="/brand/apple-touch-icon.png">
<style>
*,*::before,*::after{box-sizing:border-box}
html,body{margin:0;height:100%;overflow:hidden}
body{font-family:'Plus Jakarta Sans',system-ui,-apple-system,'Segoe UI',sans-serif;-webkit-font-smoothing:antialiased;
font-feature-settings:'cv05','cv11','ss01';font-size:15.5px;line-height:1.68}
a{color:var(--brand)}a:hover{color:var(--brand-strong)}
[data-theme="light"]{--canvas:#ffffff;--surface:#f0f4f9;--surface-2:#e8eef7;--surface-3:#dbe4f0;
--ink:#1f1f1f;--ink-2:#54585c;--ink-3:#6b7075;--line:#dfe4ec;
--brand:#0b57d0;--brand-strong:#0842a0;--brand-soft:#d3e3fd;--brand-tint:#eaf1fe;--on-brand:#fff;
--ok:#146c2e;--ok-soft:#e6f4ea;--warn:#8a5300;--warn-soft:#fef7e0;--dang:#b3261e;--dang-soft:#fcebe9;
--desk-bg:#e3e8ef;
--scrim:rgba(20,22,26,.45);--shadow:0 1px 2px rgba(32,33,36,.06),0 8px 24px -14px rgba(32,33,36,.22);
--shadow-lg:0 24px 64px -20px rgba(32,33,36,.35)}
[data-theme="dark"]{--canvas:#131417;--surface:#1e1f24;--surface-2:#282a30;--surface-3:#33363d;
--ink:#f8f9fc;--ink-2:#b6bcc4;--ink-3:#8b9197;--line:#2c2f35;
--brand:#a8c7fa;--brand-strong:#d3e3fd;--brand-soft:#0f3372;--brand-tint:#182236;--on-brand:#062e6f;
--ok:#6dd58c;--ok-soft:#10331c;--warn:#fdd663;--warn-soft:#332705;--dang:#f2b8b5;--dang-soft:#4e1210;
--desk-bg:#0c0d0f;
--scrim:rgba(0,0,0,.62);--shadow:0 1px 2px rgba(0,0,0,.4),0 8px 24px -14px rgba(0,0,0,.7);
--shadow-lg:0 24px 64px -20px rgba(0,0,0,.85)}
svg{display:block;flex:none}
/* .btn1/.ic set display, which outranks the [hidden] attribute's display:none. */
[hidden]{display:none!important}
.h1{font-size:25px;line-height:1.2;font-weight:600;letter-spacing:-.025em}
.h2{font-size:18px;line-height:1.3;font-weight:600;letter-spacing:-.015em}
.h3{font-size:15px;line-height:1.4;font-weight:600}
.sm{font-size:13.5px;line-height:1.55}
.xs{font-size:12.5px;line-height:1.5}
.eyebrow{font-size:11px;line-height:1.4;font-weight:600;letter-spacing:.07em;text-transform:uppercase}
.num{font-variant-numeric:tabular-nums lining-nums;letter-spacing:-.02em}
.mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12.5px}

.btn1.danger{background:var(--dang);border-color:var(--dang);color:#fff}
.btn1.danger:hover{filter:brightness(1.08)}
.btn1{background:var(--brand);color:var(--on-brand);border:1px solid transparent;font-weight:600}
.btn1:hover{background:var(--brand-strong)}
.btn2{background:var(--canvas);color:var(--ink);border:1px solid var(--ink-3);font-weight:600}
.btn2:hover{background:var(--surface-2)}
.btn3{background:none;color:var(--ink-2);border:1px solid transparent;font-weight:600}
.btn3:hover{background:var(--surface-2);color:var(--ink)}
.btn1,.btn2,.btn3{font-family:inherit;font-size:13.5px;line-height:1;padding:12px 20px;border-radius:999px;cursor:pointer;min-height:44px;display:inline-flex;align-items:center;justify-content:center;gap:8px}
.btnsm{font-size:12.5px;padding:8px 14px;min-height:36px}
.btn1:disabled,.btn2:disabled,.btn3:disabled{opacity:.45;cursor:not-allowed;pointer-events:none}
.nv,.gh,.rw{transition:background .15s,color .15s,border-color .15s}
.nv:hover,.gh:hover,.rw:hover{background:var(--surface-2)}
.gh:hover{color:var(--ink)}
.nv[data-on="1"]{background:var(--brand-soft);color:var(--brand-strong);font-weight:600}
.sg[data-on="1"]{background:var(--brand-soft)!important;color:var(--brand-strong)!important;border:1px solid var(--brand)!important;font-weight:600}
.tab[data-on="1"]{background:var(--brand-soft);color:var(--brand-strong);font-weight:600}
.ic{position:relative;display:grid;place-items:center;width:38px;height:38px;border:0;border-radius:999px;background:none;color:var(--ink-3);cursor:pointer;transition:background .15s,color .15s}
.ic:hover{background:var(--surface-3);color:var(--ink)}
.fld{width:100%;border:1px solid var(--line);background:var(--canvas);color:inherit;font-family:inherit;font-size:14px;padding:11px 14px;border-radius:12px;outline:none;min-height:44px}
.fld:focus{border-color:var(--brand)}
input[type=checkbox],input[type=radio]{width:17px;height:17px;accent-color:var(--brand);flex:none;cursor:pointer;margin-top:2px}
@keyframes rise{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
@keyframes pop{from{opacity:0;transform:translateY(6px) scale(.99)}to{opacity:1;transform:none}}
@keyframes fade{from{opacity:0}to{opacity:1}}
@keyframes spin{to{transform:rotate(360deg)}}
@keyframes puls{50%{opacity:.45}}
.spin{animation:spin 1s linear infinite}
.live{animation:puls 1.6s infinite}
::-webkit-scrollbar{width:11px;height:11px}
::-webkit-scrollbar-thumb{background:var(--surface-3);border-radius:99px;border:3.5px solid transparent;background-clip:content-box}
::-webkit-scrollbar-track{background:transparent}
:where(button,a,input,textarea,select,summary,label,[tabindex]):focus-visible{outline:3px solid var(--brand);outline-offset:2px;border-radius:8px}
@media (prefers-reduced-motion:reduce){*,*::before,*::after{animation-duration:.01ms!important;transition-duration:.01ms!important}}
aside{min-height:0}
/* The wordmark comes in two inks; show whichever the current theme can see. */
.lg-l{display:block}.lg-d{display:none}
[data-theme="dark"] .lg-l{display:none}[data-theme="dark"] .lg-d{display:block}
/* section rhythm */
.sect{margin:0 0 26px}
.sect > .h3{margin:0;border-bottom:1px solid var(--line);padding-bottom:9px}
.sect > .note{margin:9px 0 0;color:var(--ink-2);max-width:74ch;text-wrap:pretty}
.rowlist{list-style:none;margin:11px 0 0;padding:0}
.rowlist li{display:flex;flex-wrap:wrap;align-items:center;gap:11px;padding:10px 0;border-top:1px solid var(--line)}
.metrics{display:grid;gap:1px;background:var(--line);border-radius:16px;overflow:hidden}
.metrics > div{background:var(--canvas);padding:15px 17px}
.metric{margin:0;font-size:27px;line-height:1.1;font-weight:600;letter-spacing:-.03em}
.callout{border-radius:12px;padding:11px 13px;max-width:74ch;text-wrap:pretty;margin:13px 0 0}
.callout.warn{background:var(--warn-soft);color:var(--warn)}
.callout.dang{background:var(--dang-soft);color:var(--dang)}
.callout.ok{background:var(--ok-soft);color:var(--ok)}
.pill{display:inline-flex;align-items:center;gap:6px;border-radius:999px;padding:3px 11px;font-weight:600}
.bar{display:block;height:6px;border-radius:999px;background:var(--surface-3);overflow:hidden}
.bar > span{display:block;height:100%}
table.grid{border-collapse:collapse;width:100%;margin-top:11px}
table.grid th{text-align:left;padding:0 0 8px;color:var(--ink-2);font-weight:600;font-size:12.5px}
table.grid td{padding:9px 0;border-top:1px solid var(--line)}
/* markdown, matched to the reference document treatment */
.md{font-size:14.5px;line-height:1.75}
.md .md-h{margin:22px 0 0;line-height:1.3;font-weight:600;letter-spacing:-.015em}
.md h1.md-h{font-size:21px}.md h2.md-h{font-size:17.5px}.md h3.md-h{font-size:15.5px}
.md p{margin:12px 0 0;text-wrap:pretty}
.md .md-list{margin:11px 0 0;padding-left:20px;display:flex;flex-direction:column;gap:6px}
.md code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12.5px;background:var(--surface);padding:1.5px 5px;border-radius:5px}
.md .md-code{margin:14px 0 0;background:var(--surface);border-radius:10px;padding:13px 15px;overflow-x:auto;line-height:1.65;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12.5px}
.md .md-code code{background:none;padding:0}
.md .md-quote{margin:14px 0 0;border-left:3px solid var(--brand);padding:2px 0 2px 15px;color:var(--ink-2)}
.md .md-quote p{margin:0}
.md .md-hr{border:0;border-top:1px solid var(--line);margin:20px 0 0}
.md .md-table{margin:14px 0 0;border-collapse:collapse;width:100%;font-size:13.5px}
.md .md-table th{text-align:left;padding:8px 10px;border-bottom:2px solid var(--ink);font-weight:600}
.md .md-table td{padding:8px 10px;border-bottom:1px solid var(--line)}
.md .md-art{font-family:ui-monospace,Menlo,monospace;font-size:11.5px;background:var(--brand-tint);color:var(--brand-strong);padding:1px 6px;border-radius:5px;white-space:nowrap}
.paper{max-width:70ch;margin:0 auto;background:var(--canvas);border-radius:6px;box-shadow:var(--shadow);padding:38px 44px}
.paper .md > *:first-child{margin-top:0}
/* A narrow window should still be usable: collapse the sidebar to its icons rather than
   letting 236px of navigation crush the content it is navigating. */
@media (max-width:820px){
  aside{width:64px!important;padding:14px 8px 10px!important}
  aside .navlabel,aside .sidefoot,aside .brandtext{display:none}
  /* The wordmark is wider than the collapsed rail and was rendering clipped as "KLA".
     Show the square mark instead — it is the same brand at a size that fits. */
  aside .lg-l,aside .lg-d{display:none!important}
  aside .mark{display:block!important;height:22px;width:22px;border-radius:6px}
  /* There is one favicon and it is a dark mark on transparency, so on the dark rail it
     vanished. A light chip behind it reads in both themes without inventing a second
     asset or inverting the brand colours. */
  [data-theme="dark"] aside .mark{background:var(--ink);padding:3px;box-sizing:content-box}
  aside nav button{justify-content:center;padding:10px 0!important}
  main > header{padding:14px 16px 12px!important}
  #view{padding:16px!important}
  .paper{padding:24px 20px}
}
@media (max-width:640px){
  .filesplit-list{width:100%!important}
}
</style>
</head>
<body>
<div id="root" data-theme="light" style="height:100vh;display:flex;flex-direction:column;background:var(--canvas);color:var(--ink);font-size:14px;overflow:hidden">

  <div style="flex:none;display:flex;flex-wrap:wrap;align-items:center;gap:9px;padding:8px 14px;background:var(--surface-2);border-bottom:1px solid var(--line)">
    <div role="radiogroup" aria-label="Execution profile" id="profile-group" style="display:flex;gap:3px;background:var(--canvas);border-radius:999px;padding:3px"></div>
    <span class="xs" id="profile-note" style="margin-left:auto;color:var(--ink-3)"></span>
    <button class="gh" id="theme-toggle" style="border:1px solid var(--line);background:var(--canvas);color:var(--ink-2);font-family:inherit;font-size:12.5px;font-weight:600;padding:8px 14px;border-radius:999px;cursor:pointer;min-height:36px">Dark</button>
  </div>

  <div style="flex:1;min-height:0;display:flex;overflow:hidden">

    <aside aria-label="Main" style="width:236px;flex:none;display:flex;flex-direction:column;background:var(--surface);padding:16px 12px 12px;overflow-y:auto">
      <div style="display:flex;align-items:center;gap:9px;flex:none;padding:0 6px 2px">
        <img class="lg-l" src="/brand/klair-logo-dark.png" alt="Klair" style="height:26px;width:auto">
        <img class="lg-d" src="/brand/klair-logo-white.png" alt="" aria-hidden="true" style="height:26px;width:auto">
        <img class="mark" src="/brand/favicon-32.png" alt="Klair" style="display:none">
        <span class="h3 brandtext" style="color:var(--ink-3);font-weight:500">Hats</span>
      </div>
      <p class="xs brandtext" style="margin:2px 0 16px;padding:0 6px;color:var(--ink-3)">One agent, many hats</p>

      <nav aria-label="Sections" id="nav" style="display:flex;flex-direction:column;gap:2px;flex:none"></nav>

      <div style="flex:1;min-height:14px"></div>
      <div class="sidefoot" style="flex:none;border-top:1px solid var(--line);padding-top:11px">
        <p class="xs" style="margin:0;color:var(--ink-3)">Workspace</p>
        <p class="sm mono" id="side-workspace" style="margin:2px 0 0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"></p>
        <p class="xs" id="side-model" style="margin:8px 0 0;display:flex;align-items:center;gap:7px;color:var(--ink-2)"></p>
        <p class="xs" id="side-bind" style="margin:9px 0 0;display:flex;align-items:center;gap:7px;color:var(--ink-3)"></p>
        <a class="xs" href="https://klairtech.com" target="_blank" rel="noreferrer noopener" style="display:block;margin:10px 0 0;color:var(--ink-3);text-decoration:none">Built on Klair Hats</a>
      </div>
    </aside>

    <main id="main" style="flex:1;min-width:0;display:flex;flex-direction:column;overflow:hidden;position:relative">
      <header style="flex:none;display:flex;flex-wrap:wrap;align-items:flex-start;gap:12px;padding:18px 24px 14px;border-bottom:1px solid var(--line)">
        <div style="min-width:0;flex:1">
          <h1 class="h1" id="view-title" style="margin:0"></h1>
          <p class="sm" id="view-blurb" style="margin:5px 0 0;color:var(--ink-2);max-width:70ch;text-wrap:pretty"></p>
        </div>
        <button class="btn1" id="view-action" style="flex:none" hidden></button>
      </header>
      <div id="view" style="flex:1;min-height:0;display:flex;flex-direction:column;overflow-y:auto;padding:20px 24px 44px"></div>
    </main>
  </div>
</div>

<div id="overlay" hidden style="position:fixed;inset:0;background:var(--scrim);z-index:60;overflow:auto;padding:26px;animation:fade .15s ease both">
  <div style="max-width:1100px;margin:0 auto;background:var(--canvas);border:1px solid var(--line);border-radius:16px;box-shadow:var(--shadow-lg);padding:18px;animation:pop .2s ease both">
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px">
      <span class="h3" id="overlay-title" style="flex:1;min-width:0"></span>
      <button class="btn2 btnsm" id="overlay-close">Close</button>
    </div>
    <div id="overlay-body"></div>
  </div>
</div>

<script>
const TOKEN = '__TOKEN__';
const $ = (s) => document.querySelector(s);
const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
const st = (n, css) => { n.setAttribute('style', css); return n; };

async function api(path, opts) {
  const res = await fetch(path, Object.assign({ headers: { 'content-type': 'application/json', 'x-hats-token': TOKEN } }, opts || {}));
  if (!res.ok) { let m = res.statusText; try { m = (await res.json()).message || m; } catch (e) {} throw new Error(m); }
  return res.json();
}
const post = (path, body) => api(path, { method: 'POST', body: JSON.stringify(body || {}) });
const fmtBytes = (b) => b >= 1073741824 ? (b / 1073741824).toFixed(2) + ' GB' : b >= 1048576 ? (b / 1048576).toFixed(1) + ' MB' : b >= 1024 ? Math.round(b / 1024) + ' KB' : b + ' B';
const num = (n) => (n || 0).toLocaleString();

// --- theme ------------------------------------------------------------------------
function applyTheme(t) {
  $('#root').setAttribute('data-theme', t);
  $('#theme-toggle').textContent = t === 'dark' ? 'Light' : 'Dark';
  try { localStorage.setItem('hats-theme', t); } catch (e) {}
}
$('#theme-toggle').onclick = () => applyTheme($('#root').getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
// Light is the default, deliberately — not the OS preference. A first run should look the
// same on every machine, and the toggle is one click away and remembered after that.
(function () {
  let saved = null;
  try { saved = localStorage.getItem('hats-theme'); } catch (e) {}
  applyTheme(saved === 'dark' || saved === 'light' ? saved : 'light');
})();

// --- views ------------------------------------------------------------------------
const ICONS = {
  run: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
  outputs: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>',
  memory: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3a4 4 0 0 0-4 4v1a3 3 0 0 0 0 6v3a4 4 0 0 0 8 0v-3a3 3 0 0 0 0-6V7a4 4 0 0 0-4-4z"/></svg>',
  proposals: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>',
  registry: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>',
  analytics: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"/><path d="M7 15l4-5 3 3 5-7"/></svg>',
  space: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14c0 1.7 4 3 9 3s9-1.3 9-3V5"/><path d="M3 12c0 1.7 4 3 9 3s9-1.3 9-3"/></svg>',
  history: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/><path d="M12 8v4l3 2"/></svg>',
  connectors: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M10 14 4.5 19.5a3 3 0 0 0 4 4L14 18"/><path d="m14 10 5.5-5.5a3 3 0 0 0-4-4L10 6"/><path d="m9 15 6-6"/></svg>',
  schedule: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  setup: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1A1.7 1.7 0 0 0 8.9 19a1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 5 8.9a1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9.6a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9.6a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
};

const VIEWS = [
  { id: 'run', label: 'Run', title: 'Run', blurb: 'One agent, one transcript. Every answer carries the evidence it was built from, and every action passed the same gates.', load: () => renderRun() },
  { id: 'outputs', label: 'Outputs', title: 'Outputs', blurb: 'The same files the agent can see, through the same path guard. Nothing here reaches further than it does.', load: () => loadFiles('.') },
  { id: 'memory', label: 'Memory', title: 'Memory', blurb: 'What it has been told, what it noticed, and what it learned from going wrong. Yours to edit or delete.', load: () => loadMemory() },
  { id: 'proposals', label: 'Proposals', title: 'Proposals', blurb: 'What it wants to add. It writes these; only you promote them, and a tool never promotes itself.', load: () => loadProposals() },
  { id: 'registry', label: 'Registry', title: 'Skills, rules and tools', blurb: 'Behaviour composed from files you can read. Every rule above prompt strength names the code that enforces it.', load: () => loadRegistry() },
  { id: 'analytics', label: 'Analytics', title: 'Analytics', blurb: 'Read back from the run records already on your disk. Nothing is collected and nothing is sent.', load: () => loadAnalytics() },
  { id: 'space', label: 'Storage', title: 'Storage', blurb: 'What each part costs in megabytes, and what deleting it costs you. Those are different questions.', load: () => loadSpace() },
  { id: 'history', label: 'Conversations', title: 'Past conversations', blurb: 'Every run is already written to disk with its transcript and audit trail. This reads them back.', load: () => loadHistory() },
  { id: 'connectors', label: 'Connectors', title: 'Connectors and setup', blurb: 'What the tools need before they can work \u2014 search keys, hosts, mail \u2014 and MCP servers, whose tools go through the same executor as the built-in ones.', load: () => loadConnectors() },
  { id: 'schedule', label: 'Schedule', title: 'Runs without you', blurb: 'Work that fires on a timetable, and messages that arrive from off this machine. Neither can approve itself.', load: () => loadSchedules() },
  { id: 'setup', label: 'Setup', title: 'Models and providers', blurb: 'Connect a model, see live prices, install one locally. Keys are read from your environment or stored 0600, never in config.json.', load: () => loadSetup() },
];

let STATE = null;
let current = 'run';
let badges = {};

function renderNav() {
  const nav = $('#nav');
  nav.innerHTML = '';
  VIEWS.forEach((v) => {
    const b = el('button', 'nv');
    b.setAttribute('data-on', v.id === current ? '1' : '0');
    st(b, 'display:flex;align-items:center;gap:11px;width:100%;text-align:left;padding:10px 12px;font-size:14px;border:0;border-radius:999px;background:none;color:var(--ink-2);cursor:pointer;font-family:inherit');
    const icon = el('span');
    icon.innerHTML = ICONS[v.id] || '';
    st(icon, 'flex:none;display:grid;place-items:center');
    b.appendChild(icon);
    // Below 820px the labels are hidden and every item is an unlabelled glyph — which is
    // how "History" became impossible to find. [Reported, 2026-08-15.]
    b.title = v.label + ' — ' + v.title;
    b.setAttribute('aria-label', v.label);
    b.appendChild(st(el('span', 'navlabel', v.label), 'min-width:0;flex:1'));
    if (badges[v.id]) {
      b.appendChild(st(el('span', 'num xs', String(badges[v.id])), 'flex:none;background:var(--warn);color:var(--canvas);border-radius:999px;min-width:17px;height:17px;display:grid;place-items:center;font-weight:700;padding:0 4px'));
    }
    b.onclick = () => go(v.id);
    nav.appendChild(b);
  });
}

/**
 * The URL tracks the view and sub-tab, so a page can be linked, bookmarked, reloaded, and
 * walked with the browser's own back button. The token stays in the query string — the
 * hash is the only part that changes.
 */
function syncUrl() {
  const tab = subTabState[current];
  const hash = '#' + current + (tab ? '/' + tab : '');
  // window.history explicitly. This page had its own history array for the conversation,
  // which shadowed the global and made pushState undefined — the URL never changed and a
  // deep link was ignored. The array is now chatHistory, but the explicit window. stays as
  // the belt to that braces. [Found by clicking through the panel, 2026-08-14.]
  if (location.hash !== hash) window.history.pushState({ view: current, tab }, '', hash);
}

function readUrl() {
  const raw = (location.hash || '').replace(/^#/, '');
  if (!raw) return null;
  const [view, tab] = raw.split('/');
  if (!VIEWS.some((v) => v.id === view)) return null;
  return { view, tab: tab || null };
}

function go(id, opts) {
  current = id;
  const v = VIEWS.find((x) => x.id === id);
  $('#view-title').textContent = v.title;
  $('#view-blurb').textContent = v.blurb;
  $('#view-action').hidden = true;
  $('#view').innerHTML = '';
  $('#view').setAttribute('style', id === 'outputs'
    ? 'flex:1;min-height:0;display:flex;overflow:hidden;padding:0'
    : 'flex:1;min-height:0;display:flex;flex-direction:column;overflow-y:auto;padding:20px 24px 44px');
  renderNav();
  if (!opts || opts.push !== false) syncUrl();
  v.load();
}

// Back and forward move between views rather than leaving the panel.
window.addEventListener('popstate', () => {
  const target = readUrl();
  if (!target) return;
  if (target.tab) subTabState[target.view] = target.tab;
  go(target.view, { push: false });
});

/**
 * Sub-tabs within a view, using the reference design's tablist: a pill group on a surface
 * track. A view with four unrelated sections is four things, not one long scroll.
 * Remembers the last tab per view so switching away and back lands where you were.
 */
const subTabState = {};

function subTabs(host, viewId, tabs) {
  const bar = st(el('div'), 'display:flex;gap:3px;background:var(--surface);border-radius:999px;padding:3px;align-self:flex-start;max-width:100%;overflow-x:auto;flex:none');
  bar.setAttribute('role', 'tablist');
  const body = st(el('div'), 'margin-top:20px');
  host.appendChild(bar);
  host.appendChild(body);

  const activate = (id) => {
    subTabState[viewId] = id;
    [...bar.children].forEach((b) => b.setAttribute('data-on', b.dataset.tabid === id ? '1' : '0'));
    body.innerHTML = '';
    const tab = tabs.find((t) => t.id === id) || tabs[0];
    tab.render(body);
  };

  tabs.forEach((t) => {
    const b = el('button', 'sg', t.label);
    b.dataset.tabid = t.id;
    b.setAttribute('role', 'tab');
    st(b, 'border:1px solid transparent;background:none;color:var(--ink-2);font-family:inherit;font-size:12.5px;padding:7px 14px;border-radius:999px;cursor:pointer;min-height:34px;white-space:nowrap');
    b.onclick = () => {
      activate(t.id);
      // The sub-tab is part of the address, so #setup/models is linkable.
      if (viewId === current) syncUrl();
    };
    bar.appendChild(b);
  });

  const remembered = tabs.some((t) => t.id === subTabState[viewId]) ? subTabState[viewId] : tabs[0].id;
  activate(remembered);
  return { activate };
}

function headAction(label, fn) {
  const b = $('#view-action');
  b.hidden = false;
  b.textContent = label;
  b.onclick = fn;
}

// --- state ------------------------------------------------------------------------
const PROFILES = [
  ['read-only', 'Read-only', 'The worst case is a wrong answer that shows its work.'],
  ['assisted', 'Assisted', 'Writes and commands, each approved by you as it happens.'],
  ['trusted', 'Trusted', 'Approval pre-granted for this session. Everything is still audited.'],
];

async function loadState() {
  STATE = await api('/api/state');
  const group = $('#profile-group');
  group.innerHTML = '';
  PROFILES.forEach(([id, label, note]) => {
    const b = el('button', 'sg', label);
    b.setAttribute('role', 'radio');
    b.setAttribute('data-on', STATE.profile === id ? '1' : '0');
    b.setAttribute('aria-checked', String(STATE.profile === id));
    st(b, 'border:1px solid transparent;background:none;color:var(--ink-2);font-family:inherit;font-size:12.5px;padding:7px 12px;border-radius:999px;cursor:pointer;min-height:34px');
    // Re-render the current view: the run screen states the worst case in words, and a
    // profile change makes that sentence wrong until it is redrawn.
    b.onclick = async () => { await post('/api/config', { profile: id }); await loadState(); go(current); };
    group.appendChild(b);
  });
  const p = PROFILES.find((x) => x[0] === STATE.profile);
  $('#profile-note').textContent = (p ? p[2] : '') + (STATE.network ? '  ·  tool network egress is ON' : '');

  $('#side-workspace').textContent = STATE.workspace;
  $('#side-workspace').title = STATE.workspace;

  const bound = STATE.tiers.standard || STATE.tiers.light || STATE.tiers.frontier;
  const dot = st(el('span'), 'width:7px;height:7px;border-radius:999px;flex:none;background:' + (bound ? 'var(--ok)' : 'var(--warn)'));
  $('#side-model').innerHTML = '';
  $('#side-model').appendChild(dot);
  $('#side-model').appendChild(el('span', null, bound || 'no model bound — see Setup'));

  $('#side-bind').innerHTML = '';
  $('#side-bind').appendChild(st(el('span', null, '\\u{1F512}'), 'flex:none;color:var(--ok)'));
  $('#side-bind').appendChild(el('span', 'mono', location.host));

  try { const p2 = await api('/api/proposals'); badges.proposals = p2.proposals.filter((x) => x.status === 'draft').length || 0; } catch (e) {}
  renderNav();
}

// --- run --------------------------------------------------------------------------
let chatHistory = [];
let source = null;
let busy = false;

function renderRun() {
  const v = $('#view');
  v.setAttribute('style', 'flex:1;min-height:0;display:flex;flex-direction:column;overflow:hidden;padding:0');

  const thread = st(el('div'), 'flex:1;min-height:0;overflow-y:auto;padding:22px 24px 8px');
  const inner = st(el('div'), 'max-width:760px;margin:0 auto');
  inner.id = 'thread';
  thread.appendChild(inner);
  v.appendChild(thread);

  const composer = st(el('div'), 'flex:none;border-top:1px solid var(--line);padding:12px 24px 16px');
  const chips = st(el('div'), 'max-width:760px;margin:0 auto 8px;display:none;flex-wrap:wrap;gap:6px');
  chips.id = 'attachments';
  composer.appendChild(chips);
  const wrap = st(el('div'), 'max-width:760px;margin:0 auto;display:flex;gap:9px;align-items:center');
  const attach = el('button', 'btn3 btnsm', '+ Files');
  attach.title = 'Point the run at files in this workspace';
  attach.onclick = openAttach;
  const input = el('input', 'fld');
  input.id = 'prompt';
  input.placeholder = 'Ask about this workspace…';
  st(input, 'flex:1;border-radius:999px;padding:13px 18px');
  const send = el('button', 'btn1', 'Send');
  send.id = 'send';
  const fresh = el('button', 'btn3 btnsm', 'New');
  fresh.title = 'Clear the conversation. Memory is untouched.';
  const past = el('button', 'btn3 btnsm', 'Past');
  past.title = 'Older conversations — every run is kept with its full transcript';
  past.onclick = () => go('history');
  wrap.appendChild(attach); wrap.appendChild(input); wrap.appendChild(send); wrap.appendChild(fresh); wrap.appendChild(past);
  composer.appendChild(wrap);
  v.appendChild(composer);
  paintAttachments();

  send.onclick = doSend;
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') doSend(); });
  fresh.onclick = () => { chatHistory = []; inner.innerHTML = ''; renderIdle(); };

  const bound = STATE && (STATE.tiers.standard || STATE.tiers.light || STATE.tiers.frontier);
  send.disabled = !bound;
  if (!bound) input.placeholder = 'Connect a model first — see Setup';
  renderIdle();
}

const EXAMPLES = [
  ['How is this project laid out?', 'reads and cites'],
  ['What does the newest run record say happened?', 'uses its own audit trail'],
  ['Which declared dependencies are actually imported?', 'searches, then counts with a tool'],
];

function renderIdle() {
  const t = $('#thread');
  if (!t || t.children.length) return;
  const bound = STATE && (STATE.tiers.standard || STATE.tiers.light || STATE.tiers.frontier);
  const box = st(el('div'), 'padding:6vh 0 0;animation:rise .2s ease both');
  box.appendChild(st(el('h2', 'h1', bound ? 'What do you want to know?' : 'Connect a model to begin'), 'margin:0;letter-spacing:-.03em'));
  // The worst case depends entirely on the profile, so this line must follow it. Telling
  // someone in trusted mode that the worst case is a wrong answer would be false
  // reassurance about the one thing this whole design is careful about.
  // (No backticks in this file's comments — it lives inside a template literal.)
  const PROFILE_BLURB = {
    'read-only': 'It reads, searches and computes. The worst it can do is be wrong in a way you can check.',
    assisted: 'It reads and computes, and can write files or run commands — asking you first, with the diff, every time.',
    trusted: 'Approval is pre-granted for this session: it can write files and run commands without asking. Every call is still written to the audit log before it runs.',
  };
  box.appendChild(st(el('p', 'sm', bound
    ? (PROFILE_BLURB[STATE.profile] || PROFILE_BLURB['read-only'])
    : 'Open Setup, choose a provider and bind a model. Local models need no key.'),
    'margin:8px 0 0;color:var(--ink-2);max-width:60ch;text-wrap:pretty'));

  if (bound) {
    const list = st(el('div'), 'display:flex;flex-direction:column;gap:2px;margin-top:22px');
    EXAMPLES.forEach(([label, hint]) => {
      const b = el('button', 'rw');
      st(b, 'display:flex;align-items:center;gap:11px;width:100%;text-align:left;border:0;border-radius:14px;background:none;color:inherit;font-family:inherit;font-size:14px;padding:12px 14px;cursor:pointer');
      b.appendChild(st(el('span', null, '\\u203A'), 'flex:none;color:var(--ink-3)'));
      b.appendChild(st(el('span', null, label), 'min-width:0;flex:1'));
      b.appendChild(st(el('span', 'xs', hint), 'flex:none;color:var(--ink-3)'));
      b.onclick = () => { $('#prompt').value = label; doSend(); };
      list.appendChild(b);
    });
    box.appendChild(list);
  } else {
    const b = el('button', 'btn1', 'Open Setup');
    st(b, 'margin-top:20px');
    b.onclick = () => go('setup');
    box.appendChild(b);
  }
  t.appendChild(box);
}

function agentBlock() {
  const row = st(el('div'), 'display:flex;gap:12px;align-items:flex-start;margin-top:24px;animation:rise .2s ease both');
  const avatar = st(el('span'), 'width:28px;height:28px;flex:none;margin-top:2px;border-radius:999px;background:var(--brand-tint);display:grid;place-items:center');
  avatar.innerHTML = '<svg width="16" height="16" viewBox="0 0 48 48"><g fill="none" stroke="var(--brand)" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"><path d="M24 5 38 13v22L24 43 10 35V13z"/><path d="M17 24 24 5M17 24 38 13M17 24 38 35M17 24 24 43"/></g></svg>';
  const body = st(el('div'), 'min-width:0;flex:1');
  row.appendChild(avatar); row.appendChild(body);
  return { row, body };
}

/**
 * Modals, because a browser alert is a different application interrupting yours. It cannot
 * be styled, it blocks the whole page, it says "127.0.0.1:4173 says", and on a confirm the
 * destructive option is indistinguishable from the safe one. Everything here is one dialog
 * shape: a title, a body, and the buttons the situation actually needs.
 */
function modal(opts) {
  return new Promise((resolve) => {
    const shade = st(el('div'), 'position:fixed;inset:0;background:rgba(12,14,20,.55);backdrop-filter:blur(2px);display:grid;place-items:center;z-index:120;animation:fade .12s ease both');
    const box = st(el('div'), 'background:var(--canvas);border:1px solid var(--line);border-radius:16px;padding:22px 24px;width:min(480px,92vw);max-height:80vh;overflow-y:auto;box-shadow:0 24px 60px rgba(0,0,0,.28);animation:rise .16s ease both');

    box.appendChild(st(el('p', 'h3', opts.title), 'margin:0 0 8px'));
    if (opts.body) {
      const b = st(el('p', 'sm'), 'margin:0;color:var(--ink-2);text-wrap:pretty;white-space:pre-wrap');
      b.textContent = opts.body;
      box.appendChild(b);
    }
    if (opts.detail) {
      const pre = st(el('pre', 'mono xs'), 'margin:12px 0 0;background:var(--surface);border-radius:10px;padding:12px 14px;overflow:auto;max-height:280px;line-height:1.55');
      pre.textContent = opts.detail;
      box.appendChild(pre);
    }

    const row = st(el('div'), 'display:flex;gap:8px;justify-content:flex-end;margin-top:18px;flex-wrap:wrap');
    const close = (value) => { document.removeEventListener('keydown', onKey); shade.remove(); resolve(value); };
    (opts.buttons || [{ label: 'OK', value: true, kind: 'btn1' }]).forEach((b) => {
      const btn = el('button', (b.kind || 'btn3') + ' btnsm', b.label);
      btn.onclick = () => close(b.value);
      row.appendChild(btn);
    });
    box.appendChild(row);

    const onKey = (e) => {
      if (e.key === 'Escape') close(opts.cancelValue === undefined ? false : opts.cancelValue);
    };
    document.addEventListener('keydown', onKey);
    shade.onclick = (e) => { if (e.target === shade) close(opts.cancelValue === undefined ? false : opts.cancelValue); };
    shade.appendChild(box);
    // Inside #root, not body: the theme tokens are defined on [data-theme], which is the
    // #root element. A modal appended to body inherits none of them, so var(--canvas)
    // resolved to nothing and the box rendered with no background at all.
    // [Seen in a screenshot, 2026-08-15.]
    (document.getElementById('root') || document.body).appendChild(shade);
    const first = row.querySelector('button');
    if (first) first.focus();
  });
}

function say(title, body, detail) {
  return modal({ title, body, detail, buttons: [{ label: 'Close', value: true, kind: 'btn2' }] });
}

function ask(title, body, confirmLabel, danger) {
  return modal({
    title,
    body,
    cancelValue: false,
    buttons: [
      { label: 'Cancel', value: false, kind: 'btn3' },
      { label: confirmLabel || 'Confirm', value: true, kind: danger ? 'btn1 danger' : 'btn1' },
    ],
  });
}

function statusPill(text, tone) {
  const map = { ok: ['var(--ok-soft)', 'var(--ok)'], warn: ['var(--warn-soft)', 'var(--warn)'], dang: ['var(--dang-soft)', 'var(--dang)'], idle: ['var(--surface-2)', 'var(--ink-2)'] };
  const c = map[tone] || map.idle;
  return st(el('span', 'xs pill' + (tone === 'idle' ? ' live' : ''), text), 'background:' + c[0] + ';color:' + c[1]);
}

/**
 * Attachments are workspace paths, not uploads. The agent reads through the path guard
 * either way, so naming a file points it at one instead of handing over bytes that would
 * arrive with no path, no guard and nothing for a citation to refer back to.
 */
let ATTACHED = [];

function paintAttachments() {
  const host = $('#attachments');
  if (!host) return;
  host.innerHTML = '';
  host.style.display = ATTACHED.length ? 'flex' : 'none';
  ATTACHED.forEach((p, i) => {
    const chip = st(el('span', 'xs mono'), 'display:inline-flex;align-items:center;gap:6px;background:var(--surface-2);border-radius:999px;padding:4px 6px 4px 11px');
    chip.appendChild(document.createTextNode(p));
    const x = el('button', '', '×');
    st(x, 'border:0;background:none;color:var(--ink-2);cursor:pointer;font-size:15px;line-height:1;padding:0 4px');
    x.title = 'Remove';
    x.onclick = () => { ATTACHED.splice(i, 1); paintAttachments(); };
    chip.appendChild(x);
    host.appendChild(chip);
  });
}

async function openAttach(dir) {
  const at = typeof dir === 'string' ? dir : '.';
  let d;
  try { d = await api('/api/files?path=' + encodeURIComponent(at)); }
  catch (e) { say('Could not list files', e.message); return; }

  const back = document.querySelector('#attach-modal');
  if (back) back.remove();
  const shade = st(el('div'), 'position:fixed;inset:0;background:rgba(0,0,0,.4);display:grid;place-items:center;z-index:50');
  shade.id = 'attach-modal';
  const box = st(el('div'), 'background:var(--canvas);border-radius:16px;padding:18px 20px;width:min(560px,92vw);max-height:70vh;display:flex;flex-direction:column;gap:10px');
  box.appendChild(st(el('p', 'h3', 'Attach from this workspace'), 'margin:0'));
  box.appendChild(st(el('p', 'xs mono', d.path || '.'), 'margin:0;color:var(--ink-3)'));

  const list = st(el('div'), 'overflow-y:auto;display:flex;flex-direction:column;gap:2px;flex:1');
  if (d.path && d.path !== '.') {
    const up = el('button', 'btn3 btnsm', '.. up');
    up.onclick = () => openAttach(d.parent || '.');
    list.appendChild(st(up, 'align-self:flex-start'));
  }
  (d.entries || []).forEach((e) => {
    const row = el('button', '');
    st(row, 'display:flex;gap:9px;align-items:center;text-align:left;border:0;background:none;color:inherit;font-family:inherit;font-size:13.5px;padding:7px 9px;border-radius:9px;cursor:pointer;width:100%');
    row.onmouseenter = () => { row.style.background = 'var(--surface)'; };
    row.onmouseleave = () => { row.style.background = 'none'; };
    row.appendChild(st(el('span', 'xs', e.isDir ? 'dir' : 'file'), 'color:var(--ink-3);min-width:26px'));
    row.appendChild(st(el('span', 'mono', e.name), 'flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis'));
    if (!e.isDir && ATTACHED.includes(e.relPath)) row.appendChild(st(el('span', 'xs', 'attached'), 'color:var(--ok)'));
    row.onclick = () => {
      if (e.isDir) { openAttach(e.relPath); return; }
      if (!ATTACHED.includes(e.relPath)) ATTACHED.push(e.relPath);
      paintAttachments();
      shade.remove();
    };
    list.appendChild(row);
  });
  box.appendChild(list);

  const close = el('button', 'btn3 btnsm', 'Done');
  close.onclick = () => shade.remove();
  box.appendChild(st(close, 'align-self:flex-end'));
  shade.onclick = (ev) => { if (ev.target === shade) shade.remove(); };
  shade.appendChild(box);
  (document.getElementById('root') || document.body).appendChild(shade);
}

async function doSend() {
  const input = $('#prompt');
  const request = (input.value || '').trim();
  if (!request || busy) return;
  input.value = '';
  busy = true;
  $('#send').disabled = true;

  const t = $('#thread');
  if (t.querySelector('h2')) t.innerHTML = '';

  const you = st(el('div'), 'display:flex;flex-direction:column;align-items:flex-end;animation:rise .2s ease both');
  you.appendChild(st(el('p', null, request), 'margin:0;font-size:15px;line-height:1.6;background:var(--surface-2);border-radius:22px 22px 6px 22px;padding:13px 19px;max-width:82%;text-wrap:pretty'));
  t.appendChild(you);

  const { row, body } = agentBlock();
  t.appendChild(row);

  const head = st(el('div'), 'display:flex;flex-wrap:wrap;align-items:center;gap:9px');
  const status = statusPill('working', 'idle');
  const meta = st(el('span', 'xs num'), 'color:var(--ink-3)');
  head.appendChild(status); head.appendChild(meta);
  body.appendChild(head);

  const stages = st(el('ol'), 'list-style:none;display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin:13px 0 0;padding:0');
  body.appendChild(stages);
  const seenStages = new Set();
  const addStage = (name, tone) => {
    if (seenStages.has(name)) return;
    seenStages.add(name);
    const li = st(el('li'), 'display:flex;align-items:center;gap:6px');
    if (stages.children.length) li.appendChild(st(el('span'), 'width:12px;height:1px;background:var(--line)'));
    const c = tone === 'ok' ? ['var(--ok-soft)', 'var(--ok)'] : ['var(--surface-2)', 'var(--ink-2)'];
    li.appendChild(st(el('span', 'xs pill', name), 'background:' + c[0] + ';color:' + c[1]));
    stages.appendChild(li);
  };

  const trace = st(el('div'), 'margin:14px 0 0;display:none;flex-direction:column;gap:3px');
  const traceBtn = el('button', 'btn3 btnsm', 'Show trace');
  st(traceBtn, 'flex:none;padding:4px 10px;min-height:28px;font-size:12px');
  let traceOpen = false;
  traceBtn.onclick = () => { traceOpen = !traceOpen; trace.style.display = traceOpen ? 'flex' : 'none'; traceBtn.textContent = traceOpen ? 'Hide trace' : 'Show trace'; };
  head.appendChild(traceBtn);
  body.appendChild(trace);

  const answer = st(el('div', 'md'), 'margin:16px 0 0');
  body.appendChild(answer);
  scrollThread();

  let runId;
  const attached = ATTACHED.slice();
  ATTACHED = [];
  paintAttachments();
  try { runId = (await post('/api/run', { request, attach: attached })).runId; }
  catch (e) { answer.textContent = 'failed: ' + e.message; busy = false; $('#send').disabled = false; return; }

  if (source) source.close();
  source = new EventSource('/api/events?token=' + TOKEN + '&runId=' + encodeURIComponent(runId));

  source.addEventListener('event', (m) => {
    const ev = JSON.parse(m.data);
    if (ev.type === 'stage') { const to = String(ev.message).split('->').pop().trim(); addStage(to, 'idle'); }
    if (ev.type === 'step') { const s = String(ev.message).split('·')[1]; if (s) addStage(s.trim(), 'idle'); status.textContent = String(ev.message).split('·')[0].trim(); }
    if (ev.type === 'gate') { status.textContent = 'gate blocked'; }
    const line = st(el('div', 'xs'), 'display:flex;gap:9px;color:var(--ink-3);padding:1px 0');
    line.appendChild(st(el('span', 'mono', ev.type), 'flex:none;min-width:52px;color:var(--ink-3)'));
    line.appendChild(st(el('span', null, ev.message), 'min-width:0;flex:1'));
    trace.appendChild(line);
  });

  source.addEventListener('ask', (m) => renderAsk(runId, JSON.parse(m.data), body));

  source.addEventListener('done', (m) => {
    const data = JSON.parse(m.data);
    source.close(); source = null;
    busy = false;
    $('#send').disabled = false;
    if (data.error) { status.replaceWith(statusPill('failed', 'dang')); answer.textContent = data.error; return; }
    const r = data.result;
    if (!r) { answer.textContent = 'no answer'; return; }
    status.replaceWith(statusPill(r.ok ? 'delivered' : 'partial', r.ok ? 'ok' : 'warn'));
    meta.textContent = r.steps + '/' + r.stepBudget + ' steps · ' + r.outcomeId + ' · ' + r.artifactCount + ' artifacts · ' + (r.modelsUsed || []).join(', ');
    if (r.answerHtml) answer.innerHTML = r.answerHtml; else answer.textContent = r.answer;
    if (r.protocolDowngraded) {
      answer.appendChild(st(el('p', 'xs callout warn', 'This model has no native tool calling, so hats used the prompt-described protocol. Tool selection is noticeably less reliable that way.'), ''));
    }
    const failed = (r.gateFindings || []).filter((g) => !g.passed);
    if (failed.length) {
      answer.appendChild(st(el('p', 'xs callout warn', 'Delivered with gaps: ' + failed.map((g) => g.detail).join('; ')), ''));
    }
    body.appendChild(feedbackBar(r.runId));
    chatHistory = r.messages || chatHistory;
    scrollThread();
  });
}

function scrollThread() {
  const t = $('#thread');
  if (t && t.parentElement) t.parentElement.scrollTop = t.parentElement.scrollHeight;
}

function feedbackBar(runId) {
  const bar = st(el('div'), 'display:flex;flex-wrap:wrap;align-items:center;gap:7px;margin:16px 0 0');
  const said = st(el('span', 'xs'), 'color:var(--ink-3)');
  const mk = (label, verdict, needsNote) => {
    const b = el('button', 'btn3 btnsm', label);
    b.onclick = async () => {
      let note;
      if (needsNote) { note = prompt('What should it have said? This becomes a high-confidence lesson.'); if (!note) return; }
      await post('/api/feedback', { runId, verdict, note });
      said.textContent = verdict === 'accepted' ? 'recorded — this strengthens what it used here'
        : verdict === 'rejected' ? 'recorded — that answer will not come back'
        : 'recorded as a correction';
      loadState();
    };
    return b;
  };
  bar.appendChild(mk('Good', 'accepted'));
  bar.appendChild(mk('Wrong', 'rejected'));
  bar.appendChild(mk('Correct it…', 'corrected', true));
  bar.appendChild(said);
  return bar;
}

function renderAsk(runId, ask, body) {
  const box = st(el('div'), 'margin:16px 0 0;border:1px solid var(--warn);border-radius:14px;padding:14px;background:var(--warn-soft);animation:pop .2s ease both');
  if (ask.kind === 'approval') {
    box.appendChild(st(el('p', 'h3', 'Approval needed: ' + ask.tool), 'margin:0'));
    box.appendChild(st(el('p', 'sm', ask.headline || ''), 'margin:4px 0 0;color:var(--ink-2)'));
    const pre = st(el('pre', 'mono'), 'margin:10px 0 0;background:var(--canvas);border-radius:10px;padding:11px 13px;overflow:auto;max-height:260px');
    pre.textContent = ask.detail || '';
    box.appendChild(pre);
    const row = st(el('div'), 'display:flex;gap:8px;margin-top:11px');
    const yes = el('button', 'btn1 btnsm', 'Run it');
    const no = el('button', 'btn2 btnsm', 'Decline');
    yes.onclick = async () => { box.remove(); await post('/api/answer', { runId, id: ask.id, answer: 'yes' }); };
    no.onclick = async () => { box.remove(); await post('/api/answer', { runId, id: ask.id, answer: 'no' }); };
    row.appendChild(yes); row.appendChild(no);
    box.appendChild(row);
  } else {
    box.appendChild(st(el('p', 'h3', ask.question || 'A question'), 'margin:0'));
    const row = st(el('div'), 'display:flex;flex-wrap:wrap;gap:8px;margin-top:11px');
    (ask.options || []).forEach((o) => {
      const b = el('button', 'btn2 btnsm', o);
      b.onclick = async () => { box.remove(); await post('/api/answer', { runId, id: ask.id, answer: o }); };
      row.appendChild(b);
    });
    const free = el('input', 'fld');
    free.placeholder = 'or answer in your own words';
    st(free, 'flex:1;min-width:220px;min-height:36px;padding:8px 12px');
    const go2 = el('button', 'btn1 btnsm', 'Answer');
    go2.onclick = async () => { box.remove(); await post('/api/answer', { runId, id: ask.id, answer: free.value }); };
    row.appendChild(free); row.appendChild(go2);
    box.appendChild(row);
  }
  body.appendChild(box);
  scrollThread();
}

// --- outputs ----------------------------------------------------------------------
const EXT_TONE = { markdown: ['var(--brand-tint)', 'var(--brand)'], image: ['var(--ok-soft)', 'var(--ok)'], pdf: ['var(--dang-soft)', 'var(--dang)'], html: ['var(--warn-soft)', 'var(--warn)'], office: ['var(--surface-2)', 'var(--ink-2)'], code: ['var(--surface-2)', 'var(--ink-2)'], text: ['var(--surface-2)', 'var(--ink-2)'], binary: ['var(--surface-2)', 'var(--ink-3)'] };

function extBadge(kind, name, size) {
  const tone = EXT_TONE[kind] || EXT_TONE.binary;
  const ext = (name.includes('.') ? name.split('.').pop() : (kind === 'text' ? 'dir' : kind)).slice(0, 4).toUpperCase();
  return st(el('span', null, ext), 'flex:none;display:grid;place-items:center;width:' + (size || 32) + 'px;height:' + (size || 32) + 'px;border-radius:9px;background:' + tone[0] + ';color:' + tone[1] + ';font-size:8.5px;font-weight:700');
}

async function loadFiles(dirPath) {
  const v = $('#view');
  v.innerHTML = '';
  const listCol = st(el('div', 'filesplit-list'), 'width:300px;flex:none;display:flex;flex-direction:column;min-height:0;border-right:1px solid var(--line)');
  const previewCol = st(el('div'), 'flex:1;min-width:0;display:flex;flex-direction:column;min-height:0');
  previewCol.id = 'preview-col';
  v.appendChild(listCol); v.appendChild(previewCol);
  previewCol.appendChild(st(el('p', 'sm', 'Select a file.'), 'margin:0;padding:22px 24px;color:var(--ink-2)'));

  const head = st(el('div'), 'flex:none;padding:14px 16px 10px');
  const crumb = st(el('p', 'xs mono'), 'margin:0 0 9px;color:var(--ink-3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap');
  head.appendChild(crumb);
  const search = el('input', 'fld');
  search.placeholder = 'Filter';
  st(search, 'border-radius:999px;min-height:38px;padding:9px 14px;font-size:13px');
  head.appendChild(search);
  listCol.appendChild(head);

  const ul = st(el('ul'), 'flex:1;min-height:0;overflow-y:auto;list-style:none;margin:0;padding:0 8px 14px');
  listCol.appendChild(ul);

  let data;
  try { data = await api('/api/files?path=' + encodeURIComponent(dirPath)); }
  catch (e) { ul.appendChild(st(el('li', 'sm', e.message), 'padding:14px 10px;color:var(--dang)')); return; }

  crumb.textContent = data.path === '.' ? 'workspace root' : data.path;

  const paint = (filter) => {
    ul.innerHTML = '';
    if (data.parent !== null) {
      const li = el('li');
      const b = el('button', 'rw');
      st(b, 'display:flex;align-items:center;gap:11px;width:100%;text-align:left;border:0;border-radius:12px;background:none;color:inherit;font-family:inherit;padding:9px 10px;cursor:pointer');
      b.appendChild(extBadge('text', 'up'));
      b.appendChild(st(el('span', 'sm', 'up one level'), 'min-width:0;flex:1;color:var(--ink-2)'));
      b.onclick = () => loadFiles(data.parent);
      li.appendChild(b); ul.appendChild(li);
    }
    const shown = data.entries.filter((e) => !filter || e.name.toLowerCase().includes(filter));
    shown.forEach((e) => {
      const li = el('li');
      const b = el('button', 'rw');
      st(b, 'display:flex;align-items:center;gap:11px;width:100%;text-align:left;border:0;border-radius:12px;background:none;color:inherit;font-family:inherit;padding:9px 10px;cursor:pointer');
      b.appendChild(extBadge(e.isDir ? 'text' : e.kind, e.isDir ? 'dir' : e.name));
      const mid = st(el('span'), 'min-width:0;flex:1');
      mid.appendChild(st(el('span', 'sm', e.name), 'display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap'));
      mid.appendChild(st(el('span', 'xs', e.isDir ? 'folder' : fmtBytes(e.bytes)), 'display:block;color:var(--ink-3)'));
      b.appendChild(mid);
      b.onclick = () => (e.isDir ? loadFiles(e.relPath) : showPreview(e.relPath));
      li.appendChild(b); ul.appendChild(li);
    });
    if (shown.length === 0) ul.appendChild(st(el('li', 'sm', 'nothing here'), 'padding:14px 10px;color:var(--ink-2)'));
  };
  paint('');
  search.oninput = () => paint(search.value.trim().toLowerCase());
}

const rawUrl = (rel) => '/api/raw?token=' + TOKEN + '&path=' + encodeURIComponent(rel);

async function showPreview(rel, intoOverlay) {
  const box = intoOverlay ? $('#overlay-body') : $('#preview-col');
  box.innerHTML = '';
  let p;
  try { p = await api('/api/preview?path=' + encodeURIComponent(rel)); }
  catch (e) { box.appendChild(st(el('p', 'sm', e.message), 'padding:20px;color:var(--dang)')); return; }

  const name = rel.split('/').pop();
  if (!intoOverlay) {
    const header = st(el('header'), 'flex:none;display:flex;flex-wrap:wrap;align-items:center;gap:10px;padding:13px 20px;border-bottom:1px solid var(--line)');
    header.appendChild(extBadge(p.kind, name, 30));
    const mid = st(el('span'), 'min-width:120px;flex:1');
    mid.appendChild(st(el('span', 'h3', name), 'display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap'));
    mid.appendChild(st(el('span', 'xs mono', rel), 'display:block;color:var(--ink-3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap'));
    header.appendChild(mid);

    const full = el('button', 'ic'); full.title = 'Full view'; full.setAttribute('aria-label', 'Full view');
    full.innerHTML = '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></svg>';
    full.onclick = () => { $('#overlay').hidden = false; $('#overlay-title').textContent = name; showPreview(rel, true); };
    const rev = el('button', 'ic'); rev.title = 'Show in folder'; rev.setAttribute('aria-label', 'Show in folder');
    rev.innerHTML = '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>';
    rev.onclick = async () => { try { await post('/api/reveal', { path: rel }); } catch (e) { say('Could not reveal it', e.message); } };
    const open = el('a', 'ic'); open.href = rawUrl(rel); open.target = '_blank'; open.rel = 'noreferrer noopener'; open.title = 'Open raw';
    open.innerHTML = '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><path d="M15 3h6v6M10 14 21 3"/></svg>';
    header.appendChild(full); header.appendChild(rev); header.appendChild(open);
    box.appendChild(header);
  }

  const canvasBg = (p.kind === 'markdown' || p.kind === 'pdf' || p.kind === 'image') ? 'var(--desk-bg)' : 'var(--canvas)';
  const pane = st(el('div'), 'flex:1;min-height:0;overflow-y:auto;background:' + canvasBg + ';padding:' + (p.kind === 'markdown' ? '26px 24px' : '18px 20px'));

  if (p.kind === 'image') {
    const img = el('img'); img.src = rawUrl(rel);
    st(img, 'max-width:100%;display:block;margin:0 auto;border-radius:8px;box-shadow:var(--shadow)');
    pane.appendChild(img);
  } else if (p.kind === 'pdf') {
    const f = el('iframe'); f.src = rawUrl(rel);
    st(f, 'width:100%;height:' + (intoOverlay ? '78vh' : '100%') + ';min-height:520px;border:0;border-radius:8px;box-shadow:var(--shadow);background:#fff');
    pane.appendChild(f);
  } else if (p.kind === 'html') {
    const f = el('iframe'); f.src = rawUrl(rel); f.setAttribute('sandbox', '');
    st(f, 'width:100%;height:' + (intoOverlay ? '78vh' : '100%') + ';min-height:520px;border:1px solid var(--line);border-radius:8px;background:#fff');
    pane.appendChild(f);
    pane.appendChild(st(el('p', 'xs'), 'margin:9px 0 0;color:var(--ink-3)')).textContent = 'Rendered with scripts disabled and no access to this page.';
  } else if (p.kind === 'markdown' && p.html) {
    const article = el('article', 'paper');
    const md = el('div', 'md');
    md.innerHTML = p.html;
    article.appendChild(md);
    pane.appendChild(article);
  } else if (p.text != null) {
    const pre = st(el('pre', 'mono'), 'margin:0;background:var(--surface);border-radius:10px;padding:14px 16px;overflow:auto;line-height:1.65;max-height:' + (intoOverlay ? '78vh' : 'none'));
    pre.textContent = p.text;
    pane.appendChild(pre);
    if (p.truncated) pane.appendChild(st(el('p', 'xs', 'Truncated for preview. Use the open-raw button for the whole file.'), 'margin:9px 0 0;color:var(--ink-3)'));
  } else {
    const empty = st(el('div'), 'display:grid;place-items:center;padding:8vh 0;text-align:center');
    empty.appendChild(extBadge(p.kind, name, 48));
    empty.appendChild(st(el('p', 'sm', p.note || 'Nothing to show inline.'), 'margin:14px auto 0;max-width:46ch;color:var(--ink-2);text-wrap:pretty'));
    pane.appendChild(empty);
  }
  box.appendChild(pane);
}

$('#overlay-close').onclick = () => { $('#overlay').hidden = true; };
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') $('#overlay').hidden = true; });

// --- memory -----------------------------------------------------------------------
async function loadMemory() {
  const v = $('#view');
  v.innerHTML = '<p class="sm" style="color:var(--ink-2)">Loading…</p>';
  const m = await api('/api/memory');
  v.innerHTML = '';

  const ctx = el('section', 'sect');
  ctx.appendChild(el('p', 'h3', 'Workspace context'));
  ctx.appendChild(el('p', 'xs note', 'Authored by you, read by the agent, never written by it. Where you have said who you are, it listens instead of guessing.'));
  const ta = el('textarea', 'fld');
  st(ta, 'margin-top:11px;min-height:200px;font-family:ui-monospace,Menlo,monospace;font-size:12.5px;line-height:1.6');
  ta.value = m.org || '';
  ctx.appendChild(ta);
  const save = el('button', 'btn1 btnsm', 'Save');
  st(save, 'margin-top:10px');
  save.onclick = async () => { await post('/api/org', { content: ta.value }); save.textContent = 'Saved'; setTimeout(() => { save.textContent = 'Save'; }, 1400); };
  ctx.appendChild(save);
  ctx.appendChild(st(el('p', 'xs mono', m.orgPath), 'margin:8px 0 0;color:var(--ink-3)'));

  const per = el('section', 'sect');
  per.appendChild(el('p', 'h3', 'Persona'));
  per.appendChild(el('p', 'xs note', 'Inferred, size-bounded, and deliberately modest — useful when right and harmless when stale.'));
  per.appendChild(st(el('p', 'sm', m.persona.summary || 'Nothing inferred yet.'), 'margin:11px 0 0;color:' + (m.persona.summary ? 'var(--ink)' : 'var(--ink-3)')));

  const les = el('section', 'sect');
  les.appendChild(el('p', 'h3', 'Lessons'));
  les.appendChild(el('p', 'xs note', 'Learned from going wrong. A lesson can change how it works; it can never change what it may touch.'));
  const lul = el('ul', 'rowlist');
  m.lessons.forEach((l) => {
    const li = el('li');
    const tone = l.status === 'active' ? 'ok' : l.status === 'canary' ? 'warn' : l.status === 'disabled' ? 'dang' : 'idle';
    li.appendChild(statusPill(l.status, tone));
    li.appendChild(st(el('span', 'sm', l.text), 'min-width:200px;flex:1;text-wrap:pretty'));
    li.appendChild(st(el('span', 'xs num', l.confidence.toFixed(2)), 'flex:none;color:var(--ink-3)'));
    if (l.status !== 'disabled') {
      const d = el('button', 'btn3 btnsm', 'Disable');
      d.onclick = async () => { await post('/api/lesson', { id: l.id, status: 'disabled' }); loadMemory(); };
      li.appendChild(d);
    }
    lul.appendChild(li);
  });
  if (!m.lessons.length) lul.appendChild(st(el('li', 'sm', 'Nothing learned here yet. Feedback is what creates lessons.'), 'color:var(--ink-2);border:0'));
  les.appendChild(lul);

  const tak = el('section', 'sect');
  tak.appendChild(el('p', 'h3', 'Takeaways'));
  tak.appendChild(el('p', 'xs note', 'Rejected answers never return. Corrected ones return corrected.'));
  const tul = el('ul', 'rowlist');
  m.takeaways.forEach((t) => {
    const li = el('li');
    const tone = t.feedback === 'accepted' ? 'ok' : t.feedback === 'rejected' ? 'dang' : t.feedback === 'corrected' ? 'warn' : 'idle';
    li.appendChild(statusPill(t.feedback, tone));
    li.appendChild(st(el('span', 'sm', t.question), 'min-width:200px;flex:1'));
    tul.appendChild(li);
  });
  if (!m.takeaways.length) tul.appendChild(st(el('li', 'sm', 'No takeaways yet.'), 'color:var(--ink-2);border:0'));
  tak.appendChild(tul);

  subTabs(v, 'memory', [
    { id: 'context', label: 'Workspace context', render: (b) => b.appendChild(ctx) },
    { id: 'lessons', label: 'Lessons (' + m.lessons.filter((l) => l.status !== 'disabled').length + ')', render: (b) => b.appendChild(les) },
    { id: 'takeaways', label: 'Takeaways (' + m.takeaways.length + ')', render: (b) => b.appendChild(tak) },
    { id: 'persona', label: 'Persona', render: (b) => b.appendChild(per) },
  ]);
}

// --- proposals --------------------------------------------------------------------
/**
 * Schedules and inbound channels. The copy here carries the ADR-0007 reasoning rather than
 * hiding it: a profile picker that silently omits "trusted" invites the question later, so
 * the view says why it is not there.
 */
async function loadSchedules() {
  const v = $('#view');
  v.innerHTML = '<p class="sm" style="color:var(--ink-2)">Loading…</p>';
  const d = await api('/api/schedules');
  v.innerHTML = '';
  const wrap = st(el('div'), 'max-width:900px;display:flex;flex-direction:column;gap:16px');

  if (!d.schedulerRunning) {
    wrap.appendChild(el('p', 'sm callout warn')).textContent =
      'The panel is not firing schedules — another scheduler holds the lock, which is normal if you have hats schedule daemon running. Two would fire everything twice.';
  }

  // --- new schedule ---
  const form = st(el('section'), 'background:var(--surface);border-radius:14px;padding:16px 18px;display:flex;flex-direction:column;gap:10px');
  form.appendChild(st(el('p', 'h3', 'Run something on a timetable'), 'margin:0'));
  const req = el('input', 'fld');
  req.placeholder = 'What should it do? e.g. summarise what changed in this repo today';
  const when = el('input', 'fld');
  when.placeholder = 'When? 0 7 * * 1-5  ·  @daily  ·  @every 30m';
  const prof = el('select', 'fld');
  [['read-only', 'read-only — reports, changes nothing'], ['assisted', 'assisted — may use the tools you name below']].forEach((o) => {
    const opt = el('option', '', o[1]);
    opt.value = o[0];
    prof.appendChild(opt);
  });
  const tools = el('input', 'fld');
  tools.placeholder = 'Tools allowed to run with nobody watching, comma separated (assisted only)';
  tools.disabled = true;
  prof.onchange = () => { tools.disabled = prof.value !== 'assisted'; };
  [req, when, prof, tools].forEach((f) => form.appendChild(f));

  form.appendChild(st(el('p', 'xs', 'There is no trusted option. Trusted means approval pre-granted for a session, and a schedule has no session and nobody to grant it. Anything not named above is denied when it fires, and the run reports what it would have done.'), 'margin:0;color:var(--ink-3);text-wrap:pretty'));

  const addRow = st(el('div'), 'display:flex;gap:8px;align-items:center');
  const add = el('button', 'btn1 btnsm', 'Schedule it');
  const addMsg = st(el('span', 'xs'), 'color:var(--ink-3)');
  add.onclick = async () => {
    addMsg.textContent = '';
    try {
      await post('/api/schedule', {
        action: 'add',
        request: req.value,
        at: when.value,
        profile: prof.value,
        allowTools: tools.disabled ? [] : (tools.value || '').split(',').map((s) => s.trim()).filter(Boolean),
      });
      req.value = ''; when.value = ''; tools.value = '';
      loadSchedules();
    } catch (e) { addMsg.textContent = 'Refused: ' + e.message; addMsg.style.color = 'var(--dang)'; }
  };
  addRow.appendChild(add);
  addRow.appendChild(addMsg);
  form.appendChild(addRow);
  wrap.appendChild(form);

  // --- existing schedules ---
  if (!d.schedules.length) {
    wrap.appendChild(st(el('p', 'sm', 'Nothing scheduled yet.'), 'color:var(--ink-2)'));
  }
  d.schedules.forEach((s) => {
    const card = st(el('section'), 'background:var(--surface);border-radius:14px;padding:16px 18px');
    const top = st(el('div'), 'display:flex;flex-wrap:wrap;align-items:center;gap:9px');
    top.appendChild(statusPill(s.when, s.enabled ? 'ok' : 'idle'));
    top.appendChild(st(el('span', 'h3', s.request), 'min-width:200px;flex:1'));
    top.appendChild(statusPill(s.profile, s.profile === 'read-only' ? 'idle' : 'warn'));
    card.appendChild(top);

    const meta = st(el('p', 'xs'), 'margin:8px 0 0;color:var(--ink-3)');
    meta.textContent =
      (s.enabled && s.next ? 'next ' + new Date(s.next).toLocaleString() : 'disabled') +
      ' · created by ' + s.author +
      (s.allowTools.length ? ' · may run unattended: ' + s.allowTools.join(', ') : ' · changes nothing');
    card.appendChild(meta);

    if (s.lastRunAt) {
      const last = st(el('p', 'sm'), 'margin:8px 0 0;color:var(--ink-2);text-wrap:pretty');
      last.textContent = 'Last run ' + new Date(s.lastRunAt).toLocaleString() + ' — ' + (s.lastStatus || '?') + (s.lastSummary ? ': ' + s.lastSummary : '');
      card.appendChild(last);
    }
    if (s.missedRuns) {
      card.appendChild(el('p', 'xs callout warn')).textContent =
        s.missedRuns + ' firing(s) were missed while nothing was running. They were not replayed.';
    }

    const row = st(el('div'), 'display:flex;flex-wrap:wrap;gap:8px;margin-top:12px');
    const runNow = el('button', 'btn2 btnsm', 'Run now');
    runNow.onclick = async () => {
      runNow.disabled = true; runNow.textContent = 'Running…';
      try {
        const r = await post('/api/schedule', { id: s.id, action: 'run' });
        if (r.error) await say('That run did not finish', r.error);
        else await say('Run finished', '', r.answer);
      } catch (e) { await say('That run did not finish', e.message); }
      loadSchedules();
    };
    const toggle = el('button', 'btn3 btnsm', s.enabled ? 'Disable' : 'Enable');
    toggle.onclick = async () => {
      await post('/api/schedule', { id: s.id, action: s.enabled ? 'disable' : 'enable' });
      loadSchedules();
    };
    const rm = el('button', 'btn3 btnsm', 'Remove');
    rm.onclick = async () => {
      if (!(await ask('Remove this schedule?', s.request, 'Remove', true))) return;
      await post('/api/schedule', { id: s.id, action: 'rm' });
      loadSchedules();
    };
    [runNow, toggle, rm].forEach((b) => row.appendChild(b));
    card.appendChild(row);
    wrap.appendChild(card);
  });

  // --- Telegram, set up in the page rather than by hand-editing config.json ---
  wrap.appendChild(await telegramCard());

  // --- channels ---
  const ch = st(el('section'), 'background:var(--surface);border-radius:14px;padding:16px 18px');
  ch.appendChild(st(el('p', 'h3', 'Messages from off this machine'), 'margin:0'));
  if (!d.channels.length) {
    ch.appendChild(st(el('p', 'sm', 'No channels configured yet.'), 'margin:8px 0 0;color:var(--ink-2);text-wrap:pretty'));
  } else {
    d.channels.forEach((c) => {
      const row = st(el('div'), 'display:flex;flex-wrap:wrap;align-items:center;gap:9px;margin-top:10px');
      row.appendChild(statusPill(c.kind, c.enabled ? 'ok' : 'idle'));
      row.appendChild(st(el('span', 'sm', c.id), 'flex:1;min-width:120px'));
      row.appendChild(st(el('span', 'xs', c.senders + ' allowed sender(s)'), 'color:var(--ink-3)'));
      row.appendChild(statusPill(c.profile, c.profile === 'read-only' ? 'idle' : 'warn'));
      ch.appendChild(row);
    });
    ch.appendChild(el('p', 'xs callout warn')).textContent =
      'Anyone on a channel allowlist can start a run on this machine. There is no wildcard, and a message is an unattended run: it cannot approve its own mutations.';
  }
  wrap.appendChild(ch);
  v.appendChild(wrap);
}

async function loadHistory() {
  const v = $('#view');
  v.innerHTML = '<p class="sm" style="color:var(--ink-2)">Loading…</p>';
  const d = await api('/api/runs');
  v.innerHTML = '';
  if (!d.runs.length) {
    v.appendChild(st(el('p', 'sm', 'No runs in this workspace yet.'), 'color:var(--ink-2)'));
    return;
  }
  const wrap = st(el('div'), 'max-width:900px;display:flex;flex-direction:column;gap:10px');
  d.runs.forEach((r) => {
    const card = st(el('section'), 'background:var(--surface);border-radius:14px;padding:14px 16px');
    const top = st(el('div'), 'display:flex;flex-wrap:wrap;align-items:center;gap:9px;cursor:pointer');
    top.appendChild(statusPill(r.ok ? 'ok' : 'incomplete', r.ok ? 'ok' : 'warn'));
    top.appendChild(st(el('span', 'sm', r.request || '(no request)'), 'flex:1;min-width:200px'));
    if (r.trigger) top.appendChild(statusPill(r.trigger.kind, 'idle'));
    top.appendChild(st(el('span', 'xs num', new Date(r.startedAt).toLocaleString()), 'color:var(--ink-3)'));
    card.appendChild(top);

    const meta = st(el('p', 'xs'), 'margin:6px 0 0;color:var(--ink-3)');
    meta.textContent = [
      r.outcomeId, r.profile,
      (r.steps || 0) + '/' + (r.stepBudget || 0) + ' steps',
      r.trigger ? 'started by ' + r.trigger.actor : null,
    ].filter(Boolean).join(' · ');
    card.appendChild(meta);

    const body = st(el('div'), 'display:none;margin-top:12px;border-top:1px solid var(--line);padding-top:12px');
    card.appendChild(body);
    let loaded = false;
    top.onclick = async () => {
      if (body.style.display === 'block') { body.style.display = 'none'; return; }
      body.style.display = 'block';
      if (loaded) return;
      loaded = true;
      body.innerHTML = '<p class="sm" style="color:var(--ink-2)">Loading transcript…</p>';
      let t;
      try { t = await api('/api/transcript?runId=' + encodeURIComponent(r.runId)); }
      catch (e) { body.innerHTML = ''; body.appendChild(st(el('p', 'sm', e.message), 'color:var(--dang)')); return; }
      body.innerHTML = '';
      t.turns.forEach((turn) => {
        const line = st(el('div'), 'margin-bottom:10px');
        const who = turn.role === 'assistant' ? 'agent' : turn.role;
        line.appendChild(st(el('span', 'xs'), 'color:var(--ink-3)')).textContent = who;
        if (turn.tools.length) {
          line.appendChild(st(el('span', 'xs mono'), 'color:var(--brand-strong);margin-left:8px')).textContent = turn.tools.join(', ');
        }
        if (turn.html) {
          const md = st(el('div', 'md'), 'margin-top:4px');
          md.innerHTML = turn.html;
          line.appendChild(md);
        } else if (turn.content) {
          line.appendChild(st(el('p', 'sm'), 'margin:4px 0 0;white-space:pre-wrap;text-wrap:pretty')).textContent = turn.content.slice(0, 4000);
        }
        body.appendChild(line);
      });
      if (!t.turns.length) body.appendChild(st(el('p', 'sm', 'No transcript was kept for this run.'), 'color:var(--ink-2)'));
    };
    wrap.appendChild(card);
  });
  v.appendChild(wrap);
}

/**
 * Configuration for the tools that need something before they work. These are the ones the
 * Tools view flags as "needs setup", and until now the only way to set them was to hand-edit
 * config.json — which is not a reasonable thing to ask of anyone.
 */
async function paintIntegrations(host) {
  host.innerHTML = '<p class="sm" style="color:var(--ink-2)">Loading…</p>';
  const d = await api('/api/integrations');
  host.innerHTML = '';
  const wrap = st(el('div'), 'display:flex;flex-direction:column;gap:14px');

  const card = (title, note) => {
    const c = st(el('section'), 'background:var(--surface);border-radius:14px;padding:16px 18px;display:flex;flex-direction:column;gap:10px');
    c.appendChild(st(el('p', 'h3', title), 'margin:0'));
    if (note) c.appendChild(st(el('p', 'xs', note), 'margin:0;color:var(--ink-3);text-wrap:pretty'));
    wrap.appendChild(c);
    return c;
  };
  const field = (parent, placeholder, value, type) => {
    const i = el('input', 'fld');
    i.placeholder = placeholder;
    if (value !== undefined && value !== null) i.value = value;
    if (type) i.type = type;
    parent.appendChild(i);
    return i;
  };
  const note = (parent) => st(parent.appendChild(el('p', 'xs')), 'margin:0;color:var(--ink-3)');

  // --- web search ---
  const configured = d.search.providers.find((p) => p.hint);
  const sc = card(
    'Web search',
    configured
      ? 'A search API is configured, so searches use it. Without one it falls back to fetching a lightweight search endpoint directly, then to a headless browser.'
      : 'No key set. Search still works by fetching a lightweight endpoint directly, but an API is faster, more reliable and returns better results. Brave gives 2,000 queries a month free.',
  );
  const srow = st(el('div'), 'display:flex;flex-wrap:wrap;gap:8px;align-items:center');
  const sprov = el('select', 'fld');
  st(sprov, 'max-width:150px');
  d.search.providers.forEach((p) => {
    const o = el('option', '', p.id + (p.hint ? ' · set' : ''));
    o.value = p.id;
    sprov.appendChild(o);
  });
  const skey = field(srow, 'API key — stored 0600, never in config.json', '', 'password');
  st(skey, 'flex:1;min-width:200px');
  srow.insertBefore(sprov, skey);
  const ssave = el('button', 'btn1 btnsm', 'Save key');
  srow.appendChild(ssave);
  sc.appendChild(srow);
  const smsg = note(sc);
  ssave.onclick = async () => {
    try {
      await post('/api/integrations', { kind: 'search-key', provider: sprov.value, secret: skey.value });
      skey.value = '';
      smsg.textContent = 'Saved.'; smsg.style.color = 'var(--ok)';
      paintIntegrations(host);
    } catch (e) { smsg.textContent = e.message; smsg.style.color = 'var(--dang)'; }
  };

  // --- remote hosts ---
  const rc = card('Remote hosts', 'Machines ssh_run may reach. The agent can never name a host that is not listed here. Key-based auth only — no password is read or stored.');
  if (d.remote.length) {
    const list = st(el('div'), 'display:flex;flex-direction:column;gap:6px');
    d.remote.forEach((h) => {
      const row = st(el('div'), 'display:flex;align-items:center;gap:9px');
      row.appendChild(statusPill(h.alias, 'ok'));
      row.appendChild(st(el('span', 'xs mono', (h.user ? h.user + '@' : '') + h.hostname + (h.port !== 22 ? ':' + h.port : '')), 'flex:1;color:var(--ink-2)'));
      const rm = el('button', 'btn3 btnsm', 'Remove');
      rm.onclick = async () => {
        if (!(await ask('Remove host ' + h.alias + '?', 'ssh_run will no longer be able to reach it.', 'Remove', true))) return;
        await post('/api/integrations', { kind: 'remote-host', alias: h.alias, host: null });
        paintIntegrations(host);
      };
      row.appendChild(rm);
      list.appendChild(row);
    });
    rc.appendChild(list);
  }
  const halias = field(rc, 'alias, e.g. web1');
  const hname = field(rc, 'hostname or IP');
  const huser = field(rc, 'user (optional)');
  const hkey = field(rc, 'identity file (optional), e.g. ~/.ssh/id_ed25519');
  const hmsg = note(rc);
  const hadd = el('button', 'btn1 btnsm', 'Add host');
  hadd.onclick = async () => {
    try {
      await post('/api/integrations', {
        kind: 'remote-host',
        alias: halias.value,
        host: { hostname: hname.value, user: huser.value, identityFile: hkey.value },
      });
      paintIntegrations(host);
    } catch (e) { hmsg.textContent = e.message; hmsg.style.color = 'var(--dang)'; }
  };
  rc.appendChild(st(hadd, 'align-self:flex-start'));

  // --- email ---
  const ec = card('Outgoing mail', 'Where send_email sends from, and the only addresses it may send to. There is no wildcard: choosing who the agent writes to on your behalf is your decision, not the model\u2019s.');
  const ehost = field(ec, 'SMTP host, e.g. smtp.gmail.com', d.email.host);
  const eport = field(ec, 'port (587 STARTTLS, 465 TLS)', d.email.port);
  const efrom = field(ec, 'from address', d.email.from);
  const euser = field(ec, 'username (defaults to the from address)', d.email.user);
  const epass = field(ec, d.email.passwordHint ? 'password set (' + d.email.passwordHint + ') — type to replace' : 'password or app password', '', 'password');
  const eto = field(ec, 'allowed recipients, comma separated', (d.email.allowRecipients || []).join(', '));
  const emsg = note(ec);
  const esave = el('button', 'btn1 btnsm', 'Save');
  esave.onclick = async () => {
    try {
      await post('/api/integrations', {
        kind: 'email',
        secret: epass.value,
        email: { host: ehost.value, port: eport.value, from: efrom.value, user: euser.value, allowRecipients: eto.value },
      });
      epass.value = '';
      emsg.textContent = 'Saved.'; emsg.style.color = 'var(--ok)';
      paintIntegrations(host);
    } catch (e) { emsg.textContent = e.message; emsg.style.color = 'var(--dang)'; }
  };
  ec.appendChild(st(esave, 'align-self:flex-start'));

  // --- browser ---
  const bc = card('Browser', 'The built-in browser runs headless so nothing appears on screen while the agent works. Turn this on to watch it.');
  const brow = st(el('label'), 'display:flex;align-items:center;gap:9px;cursor:pointer');
  const bchk = el('input');
  bchk.type = 'checkbox';
  bchk.checked = d.browser.headful;
  bchk.onchange = async () => {
    await post('/api/integrations', { kind: 'browser', headful: bchk.checked });
  };
  brow.appendChild(bchk);
  brow.appendChild(st(el('span', 'sm', 'Show the browser window'), ''));
  bc.appendChild(brow);

  host.appendChild(wrap);
}

async function loadConnectors() {
  const v = $('#view');
  v.innerHTML = '';
  const shell = st(el('div'), 'max-width:900px;display:flex;flex-direction:column;min-height:0');
  subTabs(shell, 'connectors', [
    { id: 'setup', label: 'Configuration', render: (b) => paintIntegrations(b) },
    { id: 'mcp', label: 'MCP servers', render: (b) => paintMcp(b) },
  ]);
  v.appendChild(shell);
}

async function paintMcp(v) {
  v.innerHTML = '<p class="sm" style="color:var(--ink-2)">Loading…</p>';
  const d = await api('/api/connectors');
  v.innerHTML = '';
  const wrap = st(el('div'), 'display:flex;flex-direction:column;gap:14px');

  const form = st(el('section'), 'background:var(--surface);border-radius:14px;padding:16px 18px;display:flex;flex-direction:column;gap:10px');
  form.appendChild(st(el('p', 'h3', 'Add a connector'), 'margin:0'));
  const idIn = el('input', 'fld'); idIn.placeholder = 'name, e.g. github or playwright';
  const kind = el('select', 'fld');
  [['url', 'Cloud / remote — a streamable HTTP endpoint'], ['cmd', 'Local — a command this machine runs']].forEach((o) => {
    const opt = el('option', '', o[1]); opt.value = o[0]; kind.appendChild(opt);
  });
  const target = el('input', 'fld'); target.placeholder = 'https://mcp.example.com/sse';
  const argsIn = el('input', 'fld'); argsIn.placeholder = 'arguments, space separated'; argsIn.style.display = 'none';
  kind.onchange = () => {
    const remote = kind.value === 'url';
    target.placeholder = remote ? 'https://mcp.example.com/sse' : 'npx';
    argsIn.style.display = remote ? 'none' : '';
  };
  [idIn, kind, target, argsIn].forEach((f) => form.appendChild(f));
  const msg = st(el('p', 'xs'), 'margin:0;color:var(--ink-3)');
  const addBtn = el('button', 'btn1 btnsm', 'Add');
  addBtn.onclick = async () => {
    msg.textContent = ''; addBtn.disabled = true;
    try {
      const payload = { action: 'add', id: idIn.value.trim() };
      if (kind.value === 'url') payload.url = target.value.trim();
      else { payload.command = target.value.trim(); payload.args = argsIn.value.trim(); }
      await post('/api/connector', payload);
      idIn.value = ''; target.value = ''; argsIn.value = '';
      paintMcp(v);
    } catch (e) { msg.textContent = 'Refused: ' + e.message; msg.style.color = 'var(--dang)'; }
    addBtn.disabled = false;
  };
  const row = st(el('div'), 'display:flex;gap:8px;align-items:center');
  row.appendChild(addBtn); row.appendChild(msg);
  form.appendChild(row);
  form.appendChild(st(el('p', 'xs', 'A connector is configured here and connects when the runtime next starts. Restart the panel to pick up a change.'), 'margin:0;color:var(--ink-3)'));
  wrap.appendChild(form);

  if (!d.networkEnabled) {
    wrap.appendChild(el('p', 'sm callout warn')).textContent =
      'Tool network egress is off, so a remote connector cannot be reached. Turn it on in Setup if you want cloud MCP servers.';
  }

  if (!d.servers.length) {
    wrap.appendChild(st(el('p', 'sm', 'No connectors configured.'), 'color:var(--ink-2)'));
  }
  d.servers.forEach((srv) => {
    const card = st(el('section'), 'background:var(--surface);border-radius:14px;padding:14px 16px');
    const top = st(el('div'), 'display:flex;flex-wrap:wrap;align-items:center;gap:9px');
    top.appendChild(statusPill(srv.disabled ? 'off' : srv.connected ? 'connected' : 'not connected', srv.disabled ? 'idle' : srv.connected ? 'ok' : 'warn'));
    top.appendChild(st(el('span', 'h3', srv.id), 'flex:1;min-width:120px'));
    top.appendChild(statusPill(srv.transport, 'idle'));
    card.appendChild(top);
    card.appendChild(st(el('p', 'xs mono', srv.target), 'margin:6px 0 0;color:var(--ink-3);overflow-wrap:anywhere'));
    if (srv.error) card.appendChild(st(el('p', 'xs', srv.error), 'margin:6px 0 0;color:var(--dang)'));
    if (srv.tools.length) {
      card.appendChild(st(el('p', 'xs', srv.tools.join(', ')), 'margin:8px 0 0;color:var(--ink-2);overflow-wrap:anywhere'));
    }
    const acts = st(el('div'), 'display:flex;gap:8px;margin-top:12px');
    const toggle = el('button', 'btn3 btnsm', srv.disabled ? 'Enable' : 'Disable');
    toggle.onclick = async () => { await post('/api/connector', { action: 'toggle', id: srv.id }); paintMcp(v); };
    const rm = el('button', 'btn3 btnsm', 'Remove');
    rm.onclick = async () => {
      if (!(await ask('Remove this connector?', srv.id + ' — ' + srv.target, 'Remove', true))) return;
      await post('/api/connector', { action: 'remove', id: srv.id });
      paintMcp(v);
    };
    acts.appendChild(toggle); acts.appendChild(rm);
    card.appendChild(acts);
    wrap.appendChild(card);
  });

  wrap.appendChild(el('p', 'xs callout warn')).textContent =
    'A connector is someone else’s code. Its tools inherit the profile, the allowlist and per-call approval, but the network guard governs our tools and cannot govern a process we did not write. A tool the server does not mark read-only is treated as able to change things.';
  v.appendChild(wrap);
}

/**
 * Telegram setup. The instructions are on the page because every step of this happens in
 * another app — BotFather for the token, @userinfobot for the numeric id — and sending
 * someone to a README to find that out is how a setup gets abandoned half-done.
 */
async function telegramCard() {
  const t = await api('/api/telegram').catch(() => ({ tokenHint: null, allowFrom: [], profile: 'read-only', configured: false, listening: false }));
  const card = st(el('section'), 'background:var(--surface);border-radius:14px;padding:16px 18px;display:flex;flex-direction:column;gap:10px');

  const head = st(el('div'), 'display:flex;flex-wrap:wrap;align-items:center;gap:9px');
  head.appendChild(st(el('p', 'h3', 'Chat with it from Telegram'), 'margin:0;flex:1;min-width:180px'));
  head.appendChild(statusPill(
    t.configured ? (t.listening ? 'listening' : 'configured') : 'not set up',
    t.listening ? 'ok' : t.configured ? 'warn' : 'idle'));
  card.appendChild(head);

  const steps = st(el('ol'), 'margin:0;padding-left:20px;display:flex;flex-direction:column;gap:6px');
  [
    'In Telegram, message @BotFather and send /newbot. Give it a name, then a username ending in "bot".',
    'BotFather replies with a token that looks like 123456789:AAF... Paste it below.',
    'Message @userinfobot and it replies with your numeric user id. Paste that below too.',
    'Save, then message your own bot. Only the ids you list here can make it do anything.',
  ].forEach((line) => {
    const li = el('li');
    li.appendChild(st(el('span', 'sm'), 'text-wrap:pretty')).textContent = line;
    steps.appendChild(li);
  });
  card.appendChild(steps);

  const tok = el('input', 'fld');
  tok.type = 'password';
  tok.placeholder = t.tokenHint ? 'token stored (' + t.tokenHint + ') — type to replace' : 'bot token from BotFather';
  const ids = el('input', 'fld');
  ids.placeholder = 'your Telegram user id, e.g. 123456789 (comma separated for more)';
  ids.value = (t.allowFrom || []).join(', ');
  const prof = el('select', 'fld');
  [['read-only', 'read-only — it answers and reports, changes nothing'], ['assisted', 'assisted — mutations still denied unless pre-authorised']].forEach((o) => {
    const opt = el('option', '', o[1]); opt.value = o[0];
    if (o[0] === t.profile) opt.selected = true;
    prof.appendChild(opt);
  });
  [tok, ids, prof].forEach((f) => card.appendChild(f));

  const msg = st(el('p', 'xs'), 'margin:0;color:var(--ink-3);text-wrap:pretty');
  const acts = st(el('div'), 'display:flex;flex-wrap:wrap;gap:8px;align-items:center');
  const save = el('button', 'btn1 btnsm', t.configured ? 'Update' : 'Save and listen');
  save.onclick = async () => {
    save.disabled = true; msg.style.color = 'var(--ink-3)'; msg.textContent = 'Saving…';
    try {
      const r = await post('/api/telegram', { action: 'save', token: tok.value.trim(), allowFrom: ids.value, profile: prof.value });
      tok.value = '';
      msg.style.color = 'var(--ok)';
      msg.textContent = r.listening ? 'Saved. It is listening — message your bot.' : 'Saved, but not listening yet. Restart the panel, or run: hats channel serve';
      loadSchedules();
    } catch (e) { msg.style.color = 'var(--dang)'; msg.textContent = e.message; }
    save.disabled = false;
  };
  const check = el('button', 'btn3 btnsm', 'Test token');
  check.onclick = async () => {
    msg.style.color = 'var(--ink-3)'; msg.textContent = 'Asking Telegram…';
    const r = await post('/api/telegram', { action: 'check' }).catch((e) => ({ ok: false, error: e.message }));
    msg.style.color = r.ok ? 'var(--ok)' : 'var(--dang)';
    msg.textContent = r.ok ? 'Telegram accepted the token.' : 'Telegram refused it: ' + r.error;
  };
  const forget = el('button', 'btn3 btnsm', 'Forget');
  forget.onclick = async () => {
    if (!(await ask('Forget the Telegram token?', 'The bot stops listening. The token is deleted from credentials.json and cannot be recovered here.', 'Forget it', true))) return;
    await post('/api/telegram', { action: 'forget' });
    loadSchedules();
  };
  acts.appendChild(save); acts.appendChild(check);
  if (t.configured || t.tokenHint) acts.appendChild(forget);
  card.appendChild(acts);
  card.appendChild(msg);

  card.appendChild(st(el('p', 'xs', 'The token is written to credentials.json at mode 0600 and never into config.json, never logged, and never returned by this page. Whoever is on the id list can start a run on this machine — a message is an unattended run, so it cannot approve its own mutations.'), 'margin:0;color:var(--ink-3);text-wrap:pretty'));
  return card;
}

async function loadProposals() {
  const v = $('#view');
  v.innerHTML = '<p class="sm" style="color:var(--ink-2)">Loading…</p>';
  const p = await api('/api/proposals');
  v.innerHTML = '';

  if (!p.proposals.length) {
    v.appendChild(st(el('p', 'sm', 'Nothing proposed yet. Proposals appear when the same gap turns up more than once.'), 'color:var(--ink-2)'));
    return;
  }

  const pending = p.proposals.filter((x) => x.status === 'draft');
  const decided = p.proposals.filter((x) => x.status !== 'draft');
  const host = st(el('div'), 'max-width:900px;display:flex;flex-direction:column;min-height:0');

  // Waiting on you is the only tab with anything to do, so it leads and carries the count.
  subTabs(host, 'proposals', [
    {
      id: 'pending',
      label: 'Waiting on you' + (pending.length ? ' · ' + pending.length : ''),
      render: (body) => paintProposals(body, pending, true),
    },
    { id: 'decided', label: 'Decided' + (decided.length ? ' · ' + decided.length : ''), render: (body) => paintProposals(body, decided, false) },
  ]);
  v.appendChild(host);
}

/**
 * A list, not a wall of cards. Each row is one line until you open it — the rationale, the
 * evidence and the full document were previously all expanded at once, which made three
 * proposals unreadable and ten impossible.
 */
function paintProposals(host, items, actionable) {
  host.innerHTML = '';
  if (!items.length) {
    host.appendChild(st(el('p', 'sm', actionable ? 'Nothing waiting. Proposals arrive when the same gap turns up more than once.' : 'Nothing decided yet.'), 'color:var(--ink-2)'));
    return;
  }

  const list = st(el('div'), 'display:flex;flex-direction:column;gap:1px;background:var(--line);border-radius:14px;overflow:hidden');
  items.forEach((x) => {
    const row = st(el('div'), 'background:var(--canvas);padding:0');

    const head = st(el('button'), 'display:flex;align-items:center;gap:11px;width:100%;text-align:left;border:0;background:none;color:inherit;font-family:inherit;padding:13px 16px;cursor:pointer');
    head.appendChild(statusPill(x.kind, x.kind === 'tool' ? 'warn' : 'idle'));
    head.appendChild(st(el('span', 'sm', x.title), 'flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap'));
    if (x.occurrences > 1) head.appendChild(st(el('span', 'xs num', x.occurrences + '×'), 'color:var(--ink-3);flex:none'));
    if (!actionable) head.appendChild(statusPill(x.status, x.status === 'promoted' ? 'ok' : 'dang'));
    const chev = st(el('span', 'xs'), 'color:var(--ink-3);flex:none');
    chev.textContent = '›';
    head.appendChild(chev);
    row.appendChild(head);

    const detail = st(el('div'), 'display:none;padding:0 16px 16px;border-top:1px solid var(--line)');
    head.onclick = () => {
      const open = detail.style.display === 'block';
      detail.style.display = open ? 'none' : 'block';
      chev.textContent = open ? '›' : '⌄';
      if (!open && !detail.dataset.built) buildProposalDetail(detail, x, actionable);
    };
    row.appendChild(detail);
    list.appendChild(row);
  });
  host.appendChild(list);
}

function buildProposalDetail(host, x, actionable) {
  host.dataset.built = '1';
  host.appendChild(st(el('p', 'sm', x.rationale), 'margin:14px 0 0;color:var(--ink-2);text-wrap:pretty'));

  if (x.kind === 'tool') {
    host.appendChild(el('p', 'xs callout warn')).textContent =
      'A tool never promotes itself at any autonomy level. Promoting a contract prints it for a human to implement; a patch is applied only after the build and the whole test suite pass.';
  }

  const pre = st(el('pre', 'mono xs'), 'margin:12px 0 0;background:var(--surface);border-radius:10px;padding:13px 15px;overflow:auto;max-height:320px;line-height:1.6');
  pre.textContent = x.content;
  host.appendChild(pre);

  if (!actionable) return;
  const row = st(el('div'), 'display:flex;flex-wrap:wrap;gap:8px;margin-top:14px');
  const prom = el('button', 'btn1 btnsm', 'Promote');
  prom.onclick = async () => {
    prom.disabled = true;
    try {
      const r = await post('/api/proposal', { id: x.id, action: 'promote' });
      await say(r.written ? 'Promoted' : 'Not promoted', r.manual || ('written to ' + r.written));
    } catch (e) { await say('Refused', e.message); }
    loadProposals(); loadState();
  };
  const rej = el('button', 'btn3 btnsm', 'Reject');
  rej.onclick = async () => {
    if (!(await ask('Reject this proposal?', x.title, 'Reject', true))) return;
    await post('/api/proposal', { id: x.id, action: 'reject' });
    loadProposals(); loadState();
  };
  row.appendChild(prom); row.appendChild(rej);
  host.appendChild(row);
}

// --- registry ---------------------------------------------------------------------
async function loadRegistry() {
  const v = $('#view');
  v.innerHTML = '<p class="sm" style="color:var(--ink-2)">Loading…</p>';
  const r = await api('/api/registry');
  v.innerHTML = '';
  const wrap = st(el('div'), 'max-width:920px');

  const sk = el('section', 'sect');
  sk.appendChild(el('p', 'h3', 'Skills'));
  sk.appendChild(el('p', 'xs note', 'Versioned playbooks. The header is contract — the allowlist, the step budget, the review requirement — and the prose is what the model reads.'));
  const stab = el('table', 'grid');
  stab.innerHTML = '<thead><tr><th>Skill</th><th>Ver</th><th>Kind</th><th>Role</th><th>Review</th><th style="text-align:right">Tools</th></tr></thead>';
  const sb = el('tbody');
  r.skills.forEach((s) => {
    const tr = el('tr');
    tr.appendChild(st(el('td', 'sm mono', s.id), 'padding:9px 0;border-top:1px solid var(--line)'));
    tr.appendChild(st(el('td', 'xs num', 'v' + s.version), 'padding:9px 0;border-top:1px solid var(--line);color:var(--ink-3)'));
    tr.appendChild(st(el('td', 'xs', s.kind), 'padding:9px 0;border-top:1px solid var(--line);color:var(--ink-2)'));
    tr.appendChild(st(el('td', 'xs', s.role || '—'), 'padding:9px 0;border-top:1px solid var(--line);color:var(--ink-2)'));
    tr.appendChild(st(el('td', 'xs', s.review), 'padding:9px 0;border-top:1px solid var(--line);color:var(--ink-2)'));
    tr.appendChild(st(el('td', 'xs num', String(s.tools.length)), 'padding:9px 0;border-top:1px solid var(--line);text-align:right;color:var(--ink-3)'));
    sb.appendChild(tr);
  });
  stab.appendChild(sb); sk.appendChild(stab);

  const ru = el('section', 'sect');
  ru.appendChild(el('p', 'h3', 'Rules'));
  ru.appendChild(el('p', 'xs note', 'Each declares its own enforcement strength. Anything above prompt strength must name the code path that holds it, and the registry refuses to start if that path does not exist.'));
  const rul = el('ul', 'rowlist');
  r.rules.forEach((x) => {
    const li = el('li');
    const tone = x.strength === 'code' ? 'ok' : x.strength === 'gate' ? 'warn' : 'idle';
    li.appendChild(statusPill(x.strength, tone));
    const mid = st(el('span'), 'min-width:200px;flex:1');
    mid.appendChild(st(el('span', 'sm mono', x.id), 'display:block'));
    mid.appendChild(st(el('span', 'xs', x.statement), 'display:block;color:var(--ink-3);text-wrap:pretty'));
    li.appendChild(mid);
    li.appendChild(st(el('span', 'xs mono', x.enforcedBy || '—'), 'flex:none;color:var(--ink-2)'));
    rul.appendChild(li);
  });
  ru.appendChild(rul);

  const to = el('section', 'sect');
  to.appendChild(el('p', 'h3', 'Tools'));
  to.appendChild(el('p', 'xs note', 'The entire action surface. Everything passes one executor, which checks the registry, the allowlist, the profile, the schema, the gates and your approval before anything runs.'));

  // Anything that needs setting up and has not been comes first. A tool that is present but
  // unusable looks identical to a working one in a plain list, which is how "why did it not
  // search the web" turns into a mystery.
  const notReady = r.tools.filter((t) => !t.ready.ok);
  if (notReady.length) {
    to.appendChild(el('p', 'xs callout warn')).textContent =
      notReady.length + ' tool(s) are present but cannot do anything yet: ' +
      notReady.map((t) => t.name + ' (' + t.ready.why + ')').join('; ');
  }

  const tul = st(el('div'), 'display:flex;flex-direction:column;gap:1px;background:var(--line);border-radius:14px;overflow:hidden;margin-top:12px');
  r.tools
    .slice()
    .sort((a, b) => Number(a.ready.ok) - Number(b.ready.ok) || a.name.localeCompare(b.name))
    .forEach((t) => {
      const row = st(el('div'), 'background:var(--canvas)');
      const head = st(el('button'), 'display:flex;align-items:center;gap:10px;width:100%;text-align:left;border:0;background:none;color:inherit;font-family:inherit;padding:11px 15px;cursor:pointer');
      head.appendChild(statusPill(t.mutating ? 'writes' : 'reads', t.mutating ? 'warn' : 'ok'));
      head.appendChild(st(el('span', 'sm mono', t.name), 'flex:1;min-width:0'));
      if (!t.ready.ok) head.appendChild(statusPill('needs setup', 'dang'));
      if (t.source !== 'built-in') head.appendChild(statusPill(t.source, 'idle'));
      const chev = st(el('span', 'xs'), 'color:var(--ink-3)');
      chev.textContent = '›';
      head.appendChild(chev);
      row.appendChild(head);

      const body = st(el('div'), 'display:none;padding:0 15px 15px;border-top:1px solid var(--line)');
      head.onclick = () => {
        const open = body.style.display === 'block';
        body.style.display = open ? 'none' : 'block';
        chev.textContent = open ? '›' : '⌄';
        if (open || body.dataset.built) return;
        body.dataset.built = '1';
        body.appendChild(st(el('p', 'sm', t.description), 'margin:12px 0 0;color:var(--ink-2);text-wrap:pretty'));
        const facts = st(el('div'), 'display:grid;grid-template-columns:auto 1fr;gap:5px 14px;margin-top:12px');
        const fact = (k, val) => {
          facts.appendChild(st(el('span', 'xs', k), 'color:var(--ink-3)'));
          facts.appendChild(st(el('span', 'xs'), 'color:var(--ink-2)')).textContent = val;
        };
        fact('profile', 'needs ' + t.minProfile);
        fact('network', t.network ? 'reaches off this machine' : 'local only');
        fact('approval', t.mutating ? 'asked for, unless a grant covers it' : 'not needed');
        fact('available in', t.usedBy.length ? t.usedBy.join(', ') : 'no skill lists it — it can never run');
        if (t.ready.why) fact('status', t.ready.why);
        body.appendChild(facts);
      };
      row.appendChild(body);
      tul.appendChild(row);
    });
  to.appendChild(tul);

  const mc = el('section', 'sect');
  mc.appendChild(el('p', 'h3', 'MCP servers'));
  mc.appendChild(el('p', 'xs note', 'Configure these in config.json under "mcpServers". Their tools arrive as mcp__server__tool and pass through the same executor — but a server is a process we did not write, so anything it does not mark read-only is treated as able to change things.'));
  if (!r.mcp.length) {
    const none = st(el('div'), 'margin:11px 0 0');
    none.appendChild(st(el('p', 'sm', 'No MCP servers connected, so no mcp__ tools exist. That is the default — nothing is missing.'), 'margin:0;color:var(--ink-2);text-wrap:pretty'));
    // Deliberately not named go: that shadows the router function of the same name, and
    // the click would then try to call the button element.
    const jump = el('button', 'btn2 btnsm', 'Add a connector');
    jump.onclick = () => go('connectors');
    none.appendChild(st(jump, 'margin-top:11px'));
    mc.appendChild(none);
  }
  else {
    const mul = el('ul', 'rowlist');
    r.mcp.forEach((c) => {
      const li = el('li');
      li.appendChild(statusPill(c.ok ? 'connected' : 'failed', c.ok ? 'ok' : 'dang'));
      li.appendChild(st(el('span', 'sm', c.server), 'min-width:150px;flex:1;font-weight:600'));
      li.appendChild(st(el('span', 'xs', c.ok ? c.toolCount + ' tools · protocol ' + (c.protocolVersion || '?') : c.error), 'color:var(--ink-3)'));
      mul.appendChild(li);
    });
    mc.appendChild(mul);
  }

  subTabs(wrap, 'registry', [
    { id: 'skills', label: 'Skills (' + r.skills.length + ')', render: (b) => b.appendChild(sk) },
    { id: 'rules', label: 'Rules (' + r.rules.length + ')', render: (b) => b.appendChild(ru) },
    { id: 'tools', label: 'Tools (' + r.tools.length + ')', render: (b) => b.appendChild(to) },
    { id: 'mcp', label: 'MCP (' + r.mcp.length + ')', render: (b) => b.appendChild(mc) },
  ]);
  v.appendChild(wrap);
}

// --- analytics --------------------------------------------------------------------
async function loadAnalytics() {
  const v = $('#view');
  v.innerHTML = '<p class="sm" style="color:var(--ink-2)">Loading…</p>';
  const a = await api('/api/analytics');
  v.innerHTML = '';
  if (a.runs === 0) {
    v.appendChild(st(el('p', 'sm', 'No runs in this workspace yet. Ask it something and come back.'), 'color:var(--ink-2)'));
    return;
  }
  const wrap = st(el('div'), 'max-width:900px;display:flex;flex-direction:column;gap:26px');

  const tiles = [
    [String(a.runs), 'Runs', a.completion.ok + ' completed, ' + a.completion.partial + ' partial'],
    [Math.round(a.completion.rate * 100) + '%', 'Completed', a.steps.budgetExhausted + ' hit the step budget'],
    [String(a.steps.mean), 'Steps a run', num(a.steps.total) + ' in total'],
    [(a.duration.meanMs / 1000).toFixed(1) + 's', 'Mean run', 'p90 ' + (a.duration.p90Ms / 1000).toFixed(1) + 's'],
  ];
  const grid = el('section', 'metrics');
  st(grid, 'grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:1px;background:var(--line);border-radius:16px;overflow:hidden');
  tiles.forEach(([value, label, sub]) => {
    const d = el('div');
    d.appendChild(el('p', 'metric num', value));
    d.appendChild(st(el('p', 'xs', label), 'margin:3px 0 0;font-weight:600'));
    d.appendChild(st(el('p', 'xs', sub), 'margin:2px 0 0;color:var(--ink-3);text-wrap:pretty'));
    grid.appendChild(d);
  });
  wrap.appendChild(grid);

  if (a.daily.length > 1) {
    const s = el('section');
    s.appendChild(st(el('p', 'h3', 'Runs a day'), 'margin:0'));
    const chart = st(el('div'), 'display:flex;align-items:flex-end;gap:5px;height:64px;margin-top:12px');
    const max = Math.max.apply(null, a.daily.map((d) => d.runs));
    a.daily.forEach((d) => {
      const cell = st(el('span'), 'display:flex;flex:1;height:100%;align-items:flex-end');
      cell.title = d.day + ': ' + d.runs + ' runs, ' + num(d.tokens) + ' tokens';
      cell.appendChild(st(el('span'), 'display:block;width:100%;height:' + Math.max(4, Math.round((d.runs / max) * 100)) + '%;border-radius:3px 3px 0 0;background:var(--brand)'));
      chart.appendChild(cell);
    });
    s.appendChild(chart);
    const ends = st(el('div', 'xs'), 'display:flex;justify-content:space-between;margin-top:6px;color:var(--ink-3)');
    ends.appendChild(el('span', null, a.daily[0].day));
    ends.appendChild(el('span', null, a.daily[a.daily.length - 1].day));
    s.appendChild(ends);
    wrap.appendChild(s);
  }

  const cost = el('section');
  const ch = st(el('div'), 'display:flex;flex-wrap:wrap;align-items:baseline;gap:10px;border-bottom:1px solid var(--line);padding-bottom:9px');
  ch.appendChild(st(el('p', 'h3', 'Tokens and cost'), 'margin:0;flex:1;min-width:130px'));
  ch.appendChild(st(el('span', 'sm num', '$' + a.cost.usd.toFixed(4)), 'font-weight:600'));
  cost.appendChild(ch);
  const two = st(el('div'), 'display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:13px;margin-top:13px');
  [
    ['In', num(a.tokens.input)],
    ['Out', num(a.tokens.output)],
    ['Cache read', num(a.tokens.cacheRead)],
    ['Cache written', num(a.tokens.cacheWrite)],
    ['Per completed outcome', a.cost.perCompletedOutcome === null ? 'not priced' : '$' + a.cost.perCompletedOutcome.toFixed(4)],
  ].forEach(([l, val]) => {
    const d = el('div');
    d.appendChild(st(el('p', 'xs', l), 'margin:0;color:var(--ink-2)'));
    d.appendChild(st(el('p', 'num', val), 'margin:2px 0 0;font-size:19px;font-weight:600'));
    two.appendChild(d);
  });
  cost.appendChild(two);
  if (a.tokens.cacheRead > 0) {
    const saved = a.tokens.cacheRead;
    cost.appendChild(el('p', 'xs callout ok')).textContent =
      num(saved) + ' tokens were served from the prompt cache rather than re-sent, billed at roughly a tenth of the input rate. '
      + 'The skills, rules and memory in the system prompt are identical across the steps of a run, so they are sent once.';
  } else if (a.tokens.input > 50000) {
    cost.appendChild(el('p', 'xs callout warn')).textContent =
      'No cache hits reported. Anthropic, OpenAI, DeepSeek and Gemini all report cache usage and it would be counted here, so on those this means the cache genuinely was not hit. '
      + 'Ollama and other local runners reuse their KV cache internally but expose no number for it, so a local run shows nothing here even when it is reusing work.';
  }
  if (a.cost.unpricedRuns > 0) {
    cost.appendChild(el('p', 'xs callout warn')).textContent =
      a.cost.unpricedRuns + ' run(s) could not be priced' + (a.cost.unpricedModels.length ? ' (' + a.cost.unpricedModels.join(', ') + ')' : '') +
      '. Their tokens are counted; their money is left out rather than folded in as zero.';
  }
  const mul = el('ul', 'rowlist');
  a.models.forEach((m) => {
    const li = el('li');
    li.appendChild(st(el('span', 'sm mono', m.model), 'min-width:150px;flex:1;font-weight:600'));
    li.appendChild(st(el('span', 'xs num', m.runs + ' runs'), 'flex:none;min-width:70px;text-align:right;color:var(--ink-2)'));
    li.appendChild(st(el('span', 'xs num', num(m.tokensIn + m.tokensOut)), 'flex:none;min-width:90px;text-align:right;color:var(--ink-3)'));
    li.appendChild(st(el('span', 'sm num', m.usd === null ? 'not priced' : '$' + m.usd.toFixed(4)), 'flex:none;min-width:86px;text-align:right;font-weight:600;color:' + (m.usd === null ? 'var(--ink-3)' : 'var(--ink)')));
    mul.appendChild(li);
  });
  cost.appendChild(mul);
  wrap.appendChild(cost);

  if (a.gates.length) {
    const s = el('section');
    s.appendChild(st(el('p', 'h3', 'Gates'), 'margin:0;border-bottom:1px solid var(--line);padding-bottom:9px'));
    s.appendChild(st(el('p', 'xs', 'How often each coded check ran, and how often it caught something. A gate that never fails is either unnecessary or not reaching what it was written for.'), 'margin:9px 0 0;color:var(--ink-2);max-width:74ch'));
    const ul = el('ul', 'rowlist');
    a.gates.forEach((g) => {
      const li = el('li');
      const fg = g.failures > 0 ? 'var(--warn)' : 'var(--ok)';
      li.appendChild(st(el('span', 'sm mono', g.ruleId), 'min-width:180px;flex:1'));
      li.appendChild(st(el('span', 'xs num', g.checks + ' ran'), 'flex:none;min-width:74px;text-align:right;color:var(--ink-3)'));
      li.appendChild(st(el('span', 'xs num', g.failures + ' caught'), 'flex:none;min-width:96px;text-align:right;color:' + fg + ';font-weight:600'));
      const barWrap = st(el('span'), 'flex:none;width:70px');
      const bar = el('span', 'bar');
      bar.appendChild(st(el('span'), 'width:' + Math.round((g.failures / Math.max(1, g.checks)) * 100) + '%;background:' + fg));
      barWrap.appendChild(bar);
      li.appendChild(barWrap);
      ul.appendChild(li);
    });
    s.appendChild(ul);
    wrap.appendChild(s);
  }

  if (a.denials.length) {
    const s = el('section');
    s.appendChild(st(el('p', 'h3', 'Refused by the executor'), 'margin:0;border-bottom:1px solid var(--line);padding-bottom:9px'));
    s.appendChild(st(el('p', 'xs', 'Calls that never ran. Each names the rule that stopped it, which is how error attribution stays a lookup rather than an investigation.'), 'margin:9px 0 0;color:var(--ink-2);max-width:74ch'));
    const ul = el('ul', 'rowlist');
    a.denials.forEach((d) => {
      const li = el('li');
      li.appendChild(st(el('span', 'sm mono', d.ruleId), 'min-width:180px;flex:1'));
      li.appendChild(st(el('span', 'sm num', String(d.count)), 'flex:none;font-weight:600;color:var(--dang)'));
      ul.appendChild(li);
    });
    s.appendChild(ul);
    wrap.appendChild(s);
  }

  const ts = el('section');
  ts.appendChild(st(el('p', 'h3', 'Tools'), 'margin:0;border-bottom:1px solid var(--line);padding-bottom:9px'));
  const table = el('table', 'grid');
  table.innerHTML = '<thead><tr><th>Tool</th><th style="text-align:right">Calls</th><th style="text-align:right">Failed</th><th style="text-align:right">Denied</th></tr></thead>';
  const tb = el('tbody');
  a.tools.forEach((t) => {
    const tr = el('tr');
    tr.appendChild(st(el('td', 'sm mono', t.tool), 'padding:9px 0;border-top:1px solid var(--line)'));
    tr.appendChild(st(el('td', 'sm num', String(t.calls)), 'padding:9px 0;border-top:1px solid var(--line);text-align:right'));
    tr.appendChild(st(el('td', 'xs num', String(t.failures)), 'padding:9px 0;border-top:1px solid var(--line);text-align:right;color:' + (t.failures ? 'var(--warn)' : 'var(--ink-3)')));
    tr.appendChild(st(el('td', 'xs num', String(t.denials)), 'padding:9px 0;border-top:1px solid var(--line);text-align:right;color:' + (t.denials ? 'var(--dang)' : 'var(--ink-3)') + ';font-weight:' + (t.denials ? '700' : '400')));
    tb.appendChild(tr);
  });
  table.appendChild(tb); ts.appendChild(table);
  wrap.appendChild(ts);

  if (a.degradedRuns > 0) {
    wrap.appendChild(el('p', 'xs callout warn')).textContent = a.degradedRuns + ' run(s) fell back to the prompt-described tool protocol. That model has no native tool calling and will be noticeably worse at choosing tools.';
  }
  wrap.appendChild(st(el('p', 'xs', 'All of this is read back from the run records on your disk. Nothing is collected, and turning it off would only mean not reading your own files.'), 'margin:0;color:var(--ink-3);max-width:80ch;text-wrap:pretty'));
  v.appendChild(wrap);
}

// --- storage ----------------------------------------------------------------------
const REV = { free: ['safe to delete', 'ok'], rebuildable: ['rebuildable', 'ok'], lossy: ['loses evidence', 'warn'], permanent: ['permanent loss', 'dang'] };

async function loadSpace() {
  const v = $('#view');
  v.innerHTML = '<p class="sm" style="color:var(--ink-2)">Measuring…</p>';
  const s = await api('/api/space');
  v.innerHTML = '';
  const wrap = st(el('div'), 'max-width:900px;display:flex;flex-direction:column;gap:22px');

  const top = st(el('section'), 'background:var(--surface);border-radius:16px;padding:16px 18px');
  top.appendChild(st(el('p', 'metric num', fmtBytes(s.totalBytes)), 'margin:0'));
  top.appendChild(st(el('p', 'xs mono', s.home), 'margin:4px 0 0;color:var(--ink-3)'));
  if (s.models.count > 0) {
    top.appendChild(st(el('p', 'sm', 'Separately, ' + s.models.count + ' local models take ' + fmtBytes(s.models.bytes) + ' — usually far more than anything here. Remove those from Setup.'), 'margin:10px 0 0;color:var(--ink-2);text-wrap:pretty'));
  }
  wrap.appendChild(top);

  const doDelete = async (entry, workspace) => {
    const lead = entry.reversibility === 'permanent' ? 'This cannot be undone.' : '';
    if (!(await ask('Delete ' + entry.label.toLowerCase() + '?', fmtBytes(entry.bytes) + ' — ' + lead + '\\n\\n' + entry.cost, 'Delete', true))) return;
    const r = await post('/api/space/prune', Object.assign({ target: entry.key }, workspace ? { workspace } : {}));
    await say('Freed ' + fmtBytes(r.bytesFreed), r.itemsRemoved + ' files removed.');
    loadSpace();
  };

  const rows = (title, entries, workspace, sub) => {
    const sec = el('section');
    sec.appendChild(st(el('p', 'h3', title), 'margin:0;border-bottom:1px solid var(--line);padding-bottom:9px'));
    if (sub) sec.appendChild(st(el('p', 'xs', sub), 'margin:9px 0 0;color:var(--ink-3)'));
    const ul = el('ul', 'rowlist');
    entries.filter((e) => e.bytes > 0).forEach((e) => {
      const li = el('li');
      const tag = REV[e.reversibility] || ['', 'idle'];
      const mid = st(el('span'), 'min-width:200px;flex:1');
      mid.appendChild(st(el('span', 'sm', e.label), 'display:block;font-weight:600'));
      mid.appendChild(st(el('span', 'xs', e.cost), 'display:block;color:var(--ink-3);text-wrap:pretty'));
      li.appendChild(mid);
      li.appendChild(statusPill(tag[0], tag[1]));
      li.appendChild(st(el('span', 'sm num', fmtBytes(e.bytes)), 'flex:none;min-width:80px;text-align:right;font-weight:600'));
      const del = el('button', 'btn3 btnsm', 'Delete');
      del.onclick = () => doDelete(e, workspace);
      li.appendChild(del);
      ul.appendChild(li);
    });
    if (!entries.some((e) => e.bytes > 0)) ul.appendChild(st(el('li', 'sm', 'nothing stored yet'), 'color:var(--ink-2);border:0'));
    sec.appendChild(ul);
    return sec;
  };

  wrap.appendChild(rows('Shared', s.global, null));
  s.workspaces.forEach((w) => {
    const label = (w.root || w.slug) + (w.slug === s.currentWorkspace ? '  ·  this workspace' : '') + (w.orphaned ? '  ·  folder no longer exists' : '');
    wrap.appendChild(rows(label, w.entries, w.slug, w.orphaned ? 'The directory this refers to is gone, so nothing here will be used again.' : null));
  });
  v.appendChild(wrap);
}

// --- setup ------------------------------------------------------------------------
const SOURCE_LABEL = { stored: 'saved here', env: 'from your environment', config: 'in config.json — move it' };

async function loadSetup() {
  const v = $('#view');
  v.innerHTML = '';
  const wrap = st(el('div'), 'max-width:920px;display:flex;flex-direction:column;gap:26px');
  v.appendChild(wrap);

  // Choosing a provider is not the same as binding a model, and the difference is not
  // obvious — "Ollama, no key needed" reads like "connected". Say what is actually
  // missing, and offer the one click that fixes it.
  const connect = st(el('section'), 'display:none;background:var(--brand-tint);border:1px solid var(--brand-soft);border-radius:16px;padding:16px 18px');
  wrap.appendChild(connect);

  const paintConnect = (models, providerId, isLocal) => {
    const bound = STATE.tiers.light || STATE.tiers.standard || STATE.tiers.frontier;
    if (bound) { connect.style.display = 'none'; return; }
    connect.style.display = 'block';
    connect.innerHTML = '';
    connect.appendChild(st(el('p', 'h3', 'No model is bound yet'), 'margin:0'));
    connect.appendChild(st(el('p', 'sm',
      'The provider below is reachable, but a provider is not a model. Every step runs against a tier — light, standard or frontier — and none of them point anywhere yet.'),
      'margin:6px 0 0;color:var(--ink-2);max-width:70ch;text-wrap:pretty'));

    if (!models || !models.length) {
      connect.appendChild(st(el('p', 'sm', isLocal
        ? 'This provider has no models installed. Pull one below, then bind it.'
        : 'No models came back from this provider. Check the key, or type an exact model id below.'),
        'margin:8px 0 0;color:var(--ink-2)'));
      return;
    }

    // Prefer something known to emit tool calls reliably; that predicts how this feels
    // far more than size does.
    const preferred = ['qwen2.5:14b', 'qwen2.5:7b', 'llama3.1:8b', 'mistral-nemo', 'qwen2.5:3b'];
    const pick = models.find((m) => preferred.includes(m.id))
      || models.find((m) => !/embed/i.test(m.id))
      || models[0];

    const row = st(el('div'), 'display:flex;flex-wrap:wrap;align-items:center;gap:10px;margin-top:12px');
    const b = el('button', 'btn1', 'Use ' + pick.id + ' for all three tiers');
    b.onclick = async () => {
      b.disabled = true;
      await post('/api/config', { provider: providerId, tiers: { light: providerId + '/' + pick.id, standard: providerId + '/' + pick.id, frontier: providerId + '/' + pick.id } });
      STATE = await api('/api/state');
      paintTiers(); loadState();
      connect.style.display = 'none';
    };
    row.appendChild(b);
    row.appendChild(st(el('span', 'xs', 'You can split them across different models afterwards.'), 'color:var(--ink-2)'));
    connect.appendChild(row);
  };

  // provider + key
  const prov = el('section');
  prov.appendChild(st(el('p', 'h3', 'Provider'), 'margin:0;border-bottom:1px solid var(--line);padding-bottom:9px'));
  prov.appendChild(st(el('p', 'xs', 'Keys are read from your environment, or stored in credentials.json at mode 0600 — deliberately not in config.json, which is the file people screenshot.'), 'margin:9px 0 0;color:var(--ink-2);max-width:74ch'));
  const prow = st(el('div'), 'display:flex;flex-wrap:wrap;gap:9px;align-items:center;margin-top:12px');
  const sel = el('select', 'fld');
  st(sel, 'max-width:320px;min-height:40px;padding:9px 12px');
  STATE.presets.forEach((p) => {
    const o = el('option', null, p.label);
    o.value = p.id;
    sel.appendChild(o);
  });
  sel.value = STATE.defaultProvider;
  prow.appendChild(sel);
  const keyState = st(el('span', 'xs pill'), '');
  prow.appendChild(keyState);
  const refresh = el('button', 'btn3 btnsm', 'Refresh models');
  prow.appendChild(refresh);
  prov.appendChild(prow);

  const keyRow = st(el('div'), 'display:flex;flex-wrap:wrap;gap:9px;align-items:center;margin-top:10px');
  const keyInput = el('input', 'fld');
  keyInput.type = 'password'; keyInput.autocomplete = 'off';
  st(keyInput, 'max-width:380px;min-height:40px;padding:9px 12px');
  const keySave = el('button', 'btn1 btnsm', 'Save key');
  const keyClear = el('button', 'btn3 btnsm', 'Remove');
  keyRow.appendChild(keyInput); keyRow.appendChild(keySave); keyRow.appendChild(keyClear);
  prov.appendChild(keyRow);
  const keyNote = st(el('p', 'xs'), 'margin:8px 0 0;color:var(--ink-3);max-width:74ch;text-wrap:pretty');
  prov.appendChild(keyNote);

  // tiers
  const tiers = el('section');
  tiers.appendChild(st(el('p', 'h3', 'Tiers'), 'margin:0;border-bottom:1px solid var(--line);padding-bottom:9px'));
  tiers.appendChild(st(el('p', 'xs', 'A step is bound to a tier, never to a model: light for extraction, standard for ordinary work, frontier for judgement. One model in all three is a perfectly good answer.'), 'margin:9px 0 0;color:var(--ink-2);max-width:74ch'));
  const tierRows = el('ul', 'rowlist');
  tiers.appendChild(tierRows);

  // View by default, edit in place. Previously this was read-only text and the only way to
  // change a binding was to scroll to the model table below and press L/S/F on a row —
  // which is a different mental model from the thing you are looking at.
  const tierEditRow = st(el('div'), 'display:none;flex-wrap:wrap;gap:8px;margin-top:12px;align-items:center');
  tiers.appendChild(tierEditRow);
  const tierMsg = st(el('p', 'xs'), 'margin:8px 0 0;color:var(--ink-3)');
  tiers.appendChild(tierMsg);
  let tierEditing = false;
  let tierOptions = [];

  const paintTiers = () => {
    tierRows.innerHTML = '';
    tierEditRow.innerHTML = '';
    tierEditRow.style.display = tierEditing ? 'flex' : 'none';
    tierRows.style.display = tierEditing ? 'none' : '';

    if (!tierEditing) {
      ['light', 'standard', 'frontier'].forEach((t) => {
        const li = el('li');
        li.appendChild(st(el('span', 'sm', t), 'min-width:90px;font-weight:600'));
        li.appendChild(st(el('span', 'sm mono', STATE.tiers[t] || 'not set'), 'min-width:160px;flex:1;color:' + (STATE.tiers[t] ? 'var(--ink)' : 'var(--ink-3)')));
        tierRows.appendChild(li);
      });
      const li = el('li');
      const edit = el('button', 'btn3 btnsm', STATE.tiers.standard ? 'Change' : 'Set them');
      edit.onclick = () => { tierEditing = true; paintTiers(); void fillTierOptions(); };
      li.appendChild(edit);
      tierRows.appendChild(li);
      return;
    }

    const selects = {};
    const grid = st(el('div'), 'display:grid;grid-template-columns:auto 1fr;gap:8px 12px;align-items:center;width:100%;max-width:560px');
    ['light', 'standard', 'frontier'].forEach((t) => {
      grid.appendChild(st(el('span', 'sm', t), 'font-weight:600'));
      const sel2 = el('select', 'fld');
      st(sel2, 'min-height:38px;padding:8px 11px');
      const current = STATE.tiers[t] || '';
      const opts = tierOptions.length ? tierOptions : (current ? [current] : []);
      if (!opts.length) {
        const o = el('option', '', 'loading models…');
        sel2.appendChild(o);
        sel2.disabled = true;
      }
      opts.forEach((id) => {
        const o = el('option', '', id);
        o.value = id;
        if (id === current) o.selected = true;
        sel2.appendChild(o);
      });
      selects[t] = sel2;
      grid.appendChild(sel2);
    });
    tierEditRow.appendChild(grid);

    const buttons = st(el('div'), 'display:flex;gap:8px;width:100%;margin-top:4px');
    const apply = el('button', 'btn1 btnsm', 'Apply');
    apply.onclick = async () => {
      apply.disabled = true; tierMsg.textContent = 'Saving…'; tierMsg.style.color = 'var(--ink-3)';
      try {
        const next = {};
        ['light', 'standard', 'frontier'].forEach((t) => { if (selects[t].value) next[t] = selects[t].value; });
        STATE = await post('/api/config', { tiers: next });
        tierEditing = false; paintTiers(); loadState();
        tierMsg.textContent = 'Saved.'; tierMsg.style.color = 'var(--ok)';
      } catch (e) { tierMsg.textContent = 'Could not save: ' + e.message; tierMsg.style.color = 'var(--dang)'; }
      apply.disabled = false;
    };
    const same = el('button', 'btn3 btnsm', 'Use one model for all three');
    same.onclick = () => {
      const v = selects.standard.value || selects.light.value || selects.frontier.value;
      ['light', 'standard', 'frontier'].forEach((t) => { selects[t].value = v; });
    };
    const cancel = el('button', 'btn3 btnsm', 'Cancel');
    cancel.onclick = () => { tierEditing = false; tierMsg.textContent = ''; paintTiers(); };
    [apply, same, cancel].forEach((b) => buttons.appendChild(b));
    tierEditRow.appendChild(buttons);
  };

  /**
   * Options come from every configured provider, not just the selected one, because a tier
   * binding is provider/model and mixing providers across tiers is a legitimate setup.
   */
  async function fillTierOptions() {
    const ids = new Set();
    ['light', 'standard', 'frontier'].forEach((t) => { if (STATE.tiers[t]) ids.add(STATE.tiers[t]); });
    for (const p of STATE.providers) {
      try {
        const d = await api('/api/models?provider=' + encodeURIComponent(p.id));
        (d.models || []).forEach((m) => ids.add(p.id + '/' + m.id));
      } catch (e) { void e; }
    }
    tierOptions = [...ids].sort();
    if (tierEditing) paintTiers();
  }

  paintTiers();

  // models list
  const models = el('section');
  models.appendChild(st(el('p', 'h3', 'Models'), 'margin:0;border-bottom:1px solid var(--line);padding-bottom:9px'));
  models.appendChild(st(el('p', 'xs', 'Fetched live from the provider, never a bundled list. Prices come from OpenRouter’s public catalogue in dollars per million tokens — exact on OpenRouter, a cross-reference elsewhere.'), 'margin:9px 0 0;color:var(--ink-2);max-width:74ch'));
  const customRow = st(el('div'), 'display:flex;flex-wrap:wrap;gap:8px;margin-top:12px');
  const custom = el('input', 'fld');
  custom.placeholder = 'or type an exact model id';
  st(custom, 'max-width:340px;min-height:38px;padding:9px 12px');
  customRow.appendChild(custom);
  ['light', 'standard', 'frontier'].forEach((t) => {
    const b = el('button', 'btn2 btnsm', 'Set ' + t);
    b.onclick = () => { if (custom.value.trim()) assign(t, sel.value, custom.value.trim()); };
    customRow.appendChild(b);
  });
  models.appendChild(customRow);
  const modelsOut = st(el('div'), 'margin-top:12px');
  models.appendChild(modelsOut);

  // local models
  const local = el('section');
  local.appendChild(st(el('p', 'h3', 'Models on this machine'), 'margin:0;border-bottom:1px solid var(--line);padding-bottom:9px'));
  local.appendChild(st(el('p', 'xs', 'Install and remove are real Ollama calls. Ollama publishes no search API for its own library, so below is a shortlist plus a box that accepts any name — and Hugging Face search, which is a genuine API.'), 'margin:9px 0 0;color:var(--ink-2);max-width:74ch'));
  const localOut = st(el('div'), 'margin-top:12px');
  local.appendChild(localOut);

  subTabs(wrap, 'setup', [
    { id: 'provider', label: 'Provider and key', render: (b) => { b.appendChild(prov); b.appendChild(tiers); } },
    { id: 'models', label: 'Models', render: (b) => b.appendChild(models) },
    { id: 'local', label: 'On this machine', render: (b) => b.appendChild(local) },
  ]);

  async function assign(tier, provider, model) {
    const t = {}; t[tier] = provider + '/' + model;
    await post('/api/config', { provider, tiers: t });
    STATE = await api('/api/state');
    paintTiers(); loadState();
    if (STATE.tiers.light || STATE.tiers.standard || STATE.tiers.frontier) connect.style.display = 'none';
  }

  function paintKey() {
    const preset = STATE.presets.find((p) => p.id === sel.value) || {};
    keyInput.value = '';
    if (!preset.keyNeeded) {
      keyState.textContent = 'no key needed';
      st(keyState, 'background:var(--ok-soft);color:var(--ok)');
      keyRow.style.display = 'none';
      keyNote.textContent = 'This provider runs locally and needs no credential.';
      return;
    }
    keyRow.style.display = 'flex';
    if (preset.keySet) {
      keyState.textContent = 'key ' + (preset.keyHint || 'set');
      st(keyState, 'background:var(--ok-soft);color:var(--ok)');
      keyNote.textContent = 'Key is ' + (SOURCE_LABEL[preset.keySource] || 'set') + '.' +
        (preset.keySource === 'stored' ? ' Stored at ' + STATE.credentialsPath + ', mode 0600, never shown again.' :
         preset.keySource === 'env' ? ' Saving one here would take precedence over ' + preset.keyEnv + '.' : '');
      keyInput.placeholder = 'paste a new key to replace it';
    } else {
      keyState.textContent = 'no key';
      st(keyState, 'background:var(--warn-soft);color:var(--warn)');
      keyNote.textContent = 'Paste the key to store it at ' + STATE.credentialsPath + ' with 0600 permissions' + (preset.keyEnv ? ', or export ' + preset.keyEnv + ' in your shell instead.' : '.');
      keyInput.placeholder = 'paste the API key';
    }
  }

  keySave.onclick = async () => {
    if (!keyInput.value.trim()) return;
    keySave.disabled = true;
    try { STATE = await post('/api/credential', { provider: sel.value, key: keyInput.value.trim() }); paintKey(); paintModels(); loadState(); }
    catch (e) { keyNote.textContent = 'could not save: ' + e.message; }
    keySave.disabled = false;
  };
  keyClear.onclick = async () => { STATE = await post('/api/credential', { provider: sel.value, clear: true }); paintKey(); paintModels(); loadState(); };

  async function paintModels() {
    modelsOut.innerHTML = '<p class="sm" style="color:var(--ink-2)">Loading…</p>';
    let d;
    try { d = await api('/api/models?provider=' + encodeURIComponent(sel.value)); }
    catch (e) { modelsOut.innerHTML = ''; modelsOut.appendChild(st(el('p', 'sm', e.message), 'color:var(--dang)')); return; }
    modelsOut.innerHTML = '';
    if (d.error) { modelsOut.appendChild(st(el('p', 'sm', 'Could not list models: ' + d.error + '. You can still type an exact id above.'), 'color:var(--ink-2)')); paintConnect([], sel.value, false); return; }
    if (!d.models.length) { modelsOut.appendChild(st(el('p', 'sm', 'The provider returned no models.'), 'color:var(--ink-2)')); paintConnect([], d.provider, d.local); return; }

    const table = el('table', 'grid');
    table.innerHTML = '<thead><tr><th>Model</th><th style="text-align:right">Context</th><th style="text-align:right">$/M in</th><th style="text-align:right">$/M out</th><th></th></tr></thead>';
    const tb = el('tbody');
    d.models.forEach((m) => {
      const tr = el('tr');
      tr.appendChild(st(el('td', 'sm mono', m.id), 'padding:9px 0;border-top:1px solid var(--line)'));
      const p = m.price;
      tr.appendChild(st(el('td', 'xs num', p && p.contextLength ? Math.round(p.contextLength / 1000) + 'k' : '—'), 'padding:9px 0;border-top:1px solid var(--line);text-align:right;color:var(--ink-3)'));
      tr.appendChild(st(el('td', 'xs num', p && p.promptPerM != null ? '$' + p.promptPerM : (d.local ? 'local' : '—')), 'padding:9px 0;border-top:1px solid var(--line);text-align:right'));
      const c4 = st(el('td', 'xs num', p && p.completionPerM != null ? '$' + p.completionPerM : (d.local ? 'local' : '—')), 'padding:9px 0;border-top:1px solid var(--line);text-align:right');
      if (p && p.basis === 'cross-reference') c4.title = 'OpenRouter price for ' + p.matchedId + ', shown as a cross-reference';
      tr.appendChild(c4);
      const c5 = st(el('td'), 'padding:9px 0;border-top:1px solid var(--line);text-align:right;white-space:nowrap');
      ['light', 'standard', 'frontier'].forEach((t) => {
        const b = el('button', 'btn3 btnsm', t[0].toUpperCase());
        b.title = 'bind ' + t + ' to ' + m.id;
        st(b, 'padding:4px 9px;min-height:28px;margin-left:3px');
        b.onclick = () => assign(t, d.provider, m.id);
        c5.appendChild(b);
      });
      tr.appendChild(c5);
      tb.appendChild(tr);
    });
    table.appendChild(tb);
    modelsOut.appendChild(table);
    modelsOut.appendChild(st(el('p', 'xs', d.local ? 'Local models have no per-token price.' : 'Prices refresh every six hours from OpenRouter.'), 'margin:10px 0 0;color:var(--ink-3)'));
    paintConnect(d.models, d.provider, d.local);
  }

  function capPill(cap) {
    const tone = cap === 'tools' ? 'ok' : cap === 'vision' ? 'warn' : 'idle';
    return statusPill(cap, tone);
  }

  async function paintLocal() {
    localOut.innerHTML = '<p class="sm" style="color:var(--ink-2)">Loading…</p>';
    let d;
    try { d = await api('/api/local-models'); }
    catch (e) { localOut.innerHTML = ''; localOut.appendChild(st(el('p', 'sm', e.message), 'color:var(--dang)')); return; }
    localOut.innerHTML = '';
    if (!d.reachable) {
      localOut.appendChild(st(el('p', 'sm', 'Ollama is not running at ' + d.baseUrl + '. Start it, or use a hosted provider above.'), 'color:var(--ink-2)'));
      return;
    }

    const have = new Set(d.installed.map((m) => m.name));

    const pull = (n, statusNode, btn) => {
      if (!n) return;
      if (btn) btn.disabled = true;
      if (statusNode) statusNode.textContent = 'starting…';
      const src = new EventSource('/api/local-models/pull?token=' + TOKEN + '&model=' + encodeURIComponent(n));
      src.addEventListener('progress', (m) => {
        const p = JSON.parse(m.data);
        if (statusNode) statusNode.textContent = p.status + (p.percent != null ? ' ' + p.percent + '%' : '');
      });
      src.addEventListener('done', () => { src.close(); if (btn) btn.disabled = false; if (statusNode) statusNode.textContent = 'installed'; paintLocal(); loadState(); });
      src.addEventListener('failed', (m) => { src.close(); if (btn) btn.disabled = false; if (statusNode) statusNode.textContent = 'failed: ' + JSON.parse(m.data).message; });
    };

    // --- installed, with what Ollama actually reports about each one ---
    localOut.appendChild(st(el('p', 'h3', 'Installed (' + d.installed.length + ')'), 'margin:0 0 2px'));
    const ul = el('ul', 'rowlist');
    d.installed.forEach((m) => {
      const li = el('li');
      const mid = st(el('span'), 'min-width:220px;flex:1');
      mid.appendChild(st(el('span', 'sm mono', m.name), 'display:block;font-weight:600'));
      const facts = [];
      if (m.parameterSize) facts.push(m.parameterSize);
      if (m.quantization) facts.push(m.quantization);
      if (m.contextLength) facts.push(Math.round(m.contextLength / 1024) + 'k context');
      if (m.family) facts.push(m.family);
      mid.appendChild(st(el('span', 'xs', facts.join(' · ')), 'display:block;color:var(--ink-3)'));
      li.appendChild(mid);

      (m.capabilities || []).filter((c) => c !== 'completion').forEach((c) => li.appendChild(capPill(c)));
      if ((m.capabilities || []).length && !(m.capabilities || []).includes('tools')) {
        li.appendChild(statusPill('no tools', 'dang'));
      }

      li.appendChild(st(el('span', 'sm num', fmtBytes(m.sizeBytes)), 'flex:none;min-width:76px;text-align:right;color:var(--ink-2)'));
      ['light', 'standard', 'frontier'].forEach((t) => {
        const b = el('button', 'btn3 btnsm', t[0].toUpperCase());
        st(b, 'padding:4px 9px;min-height:28px');
        b.title = 'bind ' + t + ' to ' + m.name;
        b.onclick = () => assign(t, 'ollama', m.name);
        li.appendChild(b);
      });
      const rm = el('button', 'btn3 btnsm', 'Remove');
      rm.onclick = async () => {
      if (!(await ask('Delete ' + m.name + '?', 'Frees ' + fmtBytes(m.sizeBytes) + ' from disk. You can pull it again later.', 'Delete', true))) return;
      await post('/api/local-models/delete', { model: m.name });
      paintLocal(); loadState();
    };
      li.appendChild(rm);
      ul.appendChild(li);
    });
    if (!d.installed.length) ul.appendChild(st(el('li', 'sm', 'Nothing installed yet. Pick something from the library below.'), 'color:var(--ink-2);border:0'));
    localOut.appendChild(ul);

    // --- install anything by name ---
    const row = st(el('div'), 'display:flex;flex-wrap:wrap;gap:8px;margin-top:16px;align-items:center');
    const name = el('input', 'fld');
    name.placeholder = 'any model name, e.g. qwen2.5:32b or hf.co/user/repo';
    st(name, 'max-width:360px;min-height:38px;padding:9px 12px');
    const go2 = el('button', 'btn2 btnsm', 'Install');
    const prog = st(el('span', 'xs'), 'color:var(--ink-3)');
    go2.onclick = () => pull(name.value.trim(), prog, go2);
    row.appendChild(name); row.appendChild(go2); row.appendChild(prog);
    localOut.appendChild(row);

    // --- the library ---
    const lib = st(el('div'), 'margin-top:26px');
    lib.appendChild(st(el('p', 'h3', 'Library'), 'margin:0;border-bottom:1px solid var(--line);padding-bottom:9px'));
    const libNote = st(el('p', 'xs'), 'margin:9px 0 0;color:var(--ink-2);max-width:74ch;text-wrap:pretty');
    lib.appendChild(libNote);
    const libBody = st(el('div'), 'margin-top:6px');
    lib.appendChild(libBody);
    localOut.appendChild(lib);

    libBody.innerHTML = '<p class="sm" style="color:var(--ink-2)">Loading sizes…</p>';
    let cat;
    try { cat = await api('/api/model-library'); }
    catch (e) { libBody.innerHTML = ''; libBody.appendChild(st(el('p', 'sm', e.message), 'color:var(--dang)')); return; }

    libNote.textContent = cat.note
      || 'Ollama publishes no endpoint that lists its library, so these names are a curated selection rather than everything that exists — you can install any other name with the box above. Download sizes are live from the registry, and once a model is installed its context length and capabilities come from Ollama itself.';

    libBody.innerHTML = '';
    cat.families.forEach((f) => {
      const sec = st(el('div'), 'padding:12px 0;border-top:1px solid var(--line)');
      const head = st(el('div'), 'display:flex;flex-wrap:wrap;align-items:center;gap:9px');
      head.appendChild(st(el('span', 'sm', f.family), 'font-weight:600'));
      head.appendChild(st(el('span', 'xs', f.publisher), 'color:var(--ink-3)'));
      if (f.tools === 'yes') head.appendChild(statusPill('tool calling', 'ok'));
      else if (f.tools === 'no') head.appendChild(statusPill('no tool calling', 'dang'));
      else head.appendChild(statusPill('tool support unconfirmed', 'idle'));
      if (f.role === 'embedding') head.appendChild(statusPill('embeddings', 'idle'));
      if (f.role === 'vision') head.appendChild(statusPill('vision', 'warn'));
      if (f.role === 'reasoning') head.appendChild(statusPill('reasoning', 'warn'));
      sec.appendChild(head);
      sec.appendChild(st(el('p', 'xs', f.note), 'margin:3px 0 0;color:var(--ink-3);text-wrap:pretty'));

      const vrow = st(el('div'), 'display:flex;flex-wrap:wrap;gap:7px;margin-top:9px');
      f.variants.forEach((v) => {
        const installed = have.has(v.name);
        const chip = st(el('div'), 'display:flex;align-items:center;gap:8px;border:1px solid ' + (installed ? 'var(--ok)' : 'var(--line)') + ';border-radius:999px;padding:5px 6px 5px 12px');
        chip.appendChild(st(el('span', 'xs mono'), 'font-weight:600')).textContent = v.name;
        chip.appendChild(st(el('span', 'xs num'), 'color:var(--ink-3)')).textContent =
          v.sizeBytes ? fmtBytes(v.sizeBytes) : (cat.sized ? 'size unknown' : '—');
        const b = el('button', installed ? 'btn3 btnsm' : 'btn2 btnsm', installed ? 'installed' : 'install');
        st(b, 'padding:4px 12px;min-height:28px');
        b.disabled = installed;
        const status = st(el('span', 'xs'), 'color:var(--ink-3)');
        b.onclick = () => pull(v.name, status, b);
        chip.appendChild(b);
        chip.appendChild(status);
        vrow.appendChild(chip);
      });
      sec.appendChild(vrow);
      libBody.appendChild(sec);
    });

    // --- hugging face ---
    const hfRow = st(el('div'), 'display:flex;flex-wrap:wrap;gap:8px;margin-top:24px;align-items:center');
    hfRow.appendChild(st(el('p', 'h3', 'Hugging Face'), 'margin:0;width:100%;border-bottom:1px solid var(--line);padding-bottom:9px'));
    const hfq = el('input', 'fld');
    hfq.placeholder = 'search GGUF models';
    st(hfq, 'max-width:300px;min-height:38px;padding:9px 12px');
    const hfb = el('button', 'btn2 btnsm', 'Search');
    const hfn = st(el('span', 'xs'), 'color:var(--ink-3)');
    hfRow.appendChild(hfq); hfRow.appendChild(hfb); hfRow.appendChild(hfn);
    localOut.appendChild(hfRow);
    const hfOut = el('div');
    localOut.appendChild(hfOut);
    if (!d.networkEnabled) hfn.textContent = 'needs tool network egress, which is off';
    hfb.onclick = async () => {
      hfOut.innerHTML = ''; hfn.textContent = 'searching…';
      try {
        const r = await api('/api/hf-search?q=' + encodeURIComponent(hfq.value.trim()));
        hfn.textContent = r.error ? r.error : r.models.length + ' results';
        const hul = el('ul', 'rowlist');
        r.models.forEach((m) => {
          const li = el('li');
          const status = st(el('span', 'xs'), 'color:var(--ink-3)');
          const b = el('button', 'btn3 btnsm', 'install');
          b.onclick = () => pull(m.pullHint, status, b);
          li.appendChild(b);
          li.appendChild(st(el('span', 'sm mono', m.id), 'min-width:200px;flex:1'));
          li.appendChild(st(el('span', 'xs num', num(m.downloads) + ' downloads'), 'color:var(--ink-3)'));
          li.appendChild(status);
          hul.appendChild(li);
        });
        hfOut.appendChild(hul);
        if (r.models.length) hfOut.appendChild(st(el('p', 'xs', 'Ollama pulls these as hf.co/user/repo. A repo with several quantisations may need one appended, e.g. :Q4_K_M.'), 'margin:9px 0 0;color:var(--ink-3)'));
      } catch (e) { hfn.textContent = e.message; }
    };
  }

  sel.onchange = () => { paintKey(); paintModels(); };
  refresh.onclick = () => paintModels();
  paintKey(); paintModels(); paintLocal();
}

// --- boot -------------------------------------------------------------------------
loadState().then(() => {
  // A link into a view wins over the default. Someone who bookmarked #analytics wants
  // analytics, even on a fresh install.
  const linked = readUrl();
  if (linked) {
    if (linked.tab) subTabState[linked.view] = linked.tab;
    go(linked.view, { push: false });
    return;
  }
  const bound = STATE.tiers.light || STATE.tiers.standard || STATE.tiers.frontier;
  go(bound ? 'run' : 'setup');
}).catch((e) => {
  document.body.innerHTML = '<main style="padding:40px"><h2 class="h1">Could not load</h2><p class="sm" style="color:var(--ink-2)">' + e.message + '</p></main>';
});
</script>
</body>
</html>`;
