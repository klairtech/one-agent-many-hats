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
/* On a phone the header was taller than the first answer: the title, a subtitle that wrapped
   to two lines, and an icon row that wrapped to a third. The subtitle explains a view you
   have already chosen, so it is the first thing to go, and the profile keeps its glyph
   without its label. */
@media (max-width:560px){
  header{padding:11px 14px 9px!important;flex-wrap:nowrap!important;gap:8px!important}
  #view-blurb{display:none}
  #view-title{font-size:20px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  #view-icons,#shell-icons{gap:3px!important}
  #shell-icons .proflabel,#shell-icons .egress{display:none}
  /* The example rows put the question and its caption side by side, which at this width
     left the question three words wide and the caption sitting on top of it. The caption
     describes what the example demonstrates; the example is the point. */
  .rw .exhint{display:none}
  /* Send is the one control that can afford to shrink: the input is what you are aiming at.
     The composer's desktop gutters were taking 48px of a 390px screen off the field. */
  #prompt{min-width:0}
  #send{padding-left:15px;padding-right:15px}
  .composer{padding-left:12px!important;padding-right:12px!important}
}
@media (max-width:820px){
  aside{width:64px!important;padding:14px 8px 10px!important}
  aside .navlabel,aside .sidefoot,aside .brandtext{display:none}
  /* The collapsed rail is one column of glyphs, and a count rendered inline pushed its own
     icon out of that column — so the one row carrying a badge sat left of every other row.
     Lift it out of the flow and pin it to the corner. */
  aside .nv{justify-content:center;position:relative}
  /* The mark sat against the left edge while every nav glyph below it centred on the rail,
     so the one thing at the top of the column was the one thing out of line with it. */
  aside .brandrow{justify-content:center;padding-left:0!important;padding-right:0!important}
  aside .nv .nvbadge{position:absolute;top:3px;right:5px;min-width:15px;height:15px;font-size:10px}
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
  /* Two columns do not fit side by side here. Widening the list alone left the preview
     rendered 0px wide, so on a phone the browser was a list of files that did nothing when
     you tapped one. Stack them instead. !important because the split sets its own inline
     layout. [Measured at 375px, 2026-08-16.] */
  .filesplit{flex-direction:column!important;overflow-y:auto!important}
  .filesplit-list{width:100%!important;flex:none;max-height:40vh;border-right:0!important;border-bottom:1px solid var(--line)}
  /* !important: the split sets min-height:0 inline on this column so it can shrink beside
     the list. Stacked, that collapses it to the height of one paragraph. */
  #preview-col{min-height:55vh!important}
}
</style>
</head>
<body>
<div id="root" data-theme="light" style="height:100vh;display:flex;flex-direction:column;background:var(--canvas);color:var(--ink);font-size:14px;overflow:hidden">

  <div style="flex:1;min-height:0;display:flex;overflow:hidden">

    <aside aria-label="Main" style="width:236px;flex:none;display:flex;flex-direction:column;background:var(--surface);padding:16px 12px 12px;overflow-y:auto">
      <div class="brandrow" style="display:flex;align-items:center;gap:9px;flex:none;padding:0 6px 2px">
        <img class="lg-l" src="/brand/klair-logo-dark.png" alt="Klair" style="height:26px;width:auto">
        <img class="lg-d" src="/brand/klair-logo-white.png" alt="" aria-hidden="true" style="height:26px;width:auto">
        <img class="mark" src="/brand/favicon-32.png" alt="Klair" style="display:none">
        <span class="h3 brandtext" style="color:var(--ink-3);font-weight:500">Hats</span>
      </div>
      <p class="xs brandtext" style="margin:2px 0 16px;padding:0 6px;color:var(--ink-3)">One agent, many hats</p>

      <nav aria-label="Sections" id="nav" style="display:flex;flex-direction:column;gap:2px;flex:none"></nav>

      <div style="flex:1;min-height:14px"></div>
      <div class="sidefoot" style="flex:none;border-top:1px solid var(--line);padding-top:11px">
        <p class="xs" id="side-model" style="margin:0;display:flex;align-items:center;gap:7px;color:var(--ink-2)"></p>
        <p class="xs" id="side-bind" style="margin:9px 0 0;display:flex;align-items:center;gap:7px;color:var(--ink-3)"></p>
        <a class="xs" href="https://klairtech.com" target="_blank" rel="noreferrer noopener" style="display:block;margin:10px 0 0;color:var(--ink-3);text-decoration:none">Built by KlairTech</a>
      </div>
    </aside>

    <main id="main" style="flex:1;min-width:0;display:flex;flex-direction:column;overflow:hidden;position:relative">
      <header style="flex:none;display:flex;flex-wrap:wrap;align-items:flex-start;gap:12px;padding:18px 24px 14px;border-bottom:1px solid var(--line)">
        <div style="min-width:0;flex:1">
          <h1 class="h1" id="view-title" style="margin:0"></h1>
          <p class="sm" id="view-blurb" style="margin:5px 0 0;color:var(--ink-2);max-width:70ch;text-wrap:pretty"></p>
        </div>
        <div id="view-icons" style="flex:none;display:flex;gap:6px;align-items:center"></div>
        <div id="shell-icons" style="flex:none;display:flex;gap:6px;align-items:center"></div>
        <button class="btn1" id="view-action" style="flex:none" hidden></button>
      </header>
      <div id="view" style="flex:1;min-height:0;display:flex;flex-direction:column;overflow-y:auto;padding:20px 24px 44px"></div>
    </main>
  </div>

  <!-- Inside #root, for the same reason modal() appends itself there: every colour token is
       defined on [data-theme], which is #root. Outside it, var(--scrim) and var(--canvas)
       resolve to nothing, and the full-view overlay opened as unreadable text painted
       straight over the page behind it. [Seen in the panel, 2026-08-16.] -->
  <div id="overlay" hidden style="position:fixed;inset:0;background:var(--scrim);z-index:60;overflow:auto;padding:26px;animation:fade .15s ease both">
    <div style="max-width:1100px;margin:0 auto;background:var(--canvas);border:1px solid var(--line);border-radius:16px;box-shadow:var(--shadow-lg);padding:18px;animation:pop .2s ease both">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px">
        <span class="h3" id="overlay-title" style="flex:1;min-width:0"></span>
        <button class="btn2 btnsm" id="overlay-close">Close</button>
      </div>
      <div id="overlay-body"></div>
    </div>
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
  try { localStorage.setItem('hats-theme', t); } catch (e) {}
}
function toggleTheme() {
  applyTheme($('#root').getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
}
// Light is the default, deliberately — not the OS preference. A first run should look the
// same on every machine, and the toggle is one click away and remembered after that.
(function () {
  let saved = null;
  try { saved = localStorage.getItem('hats-theme'); } catch (e) {}
  applyTheme(saved === 'dark' || saved === 'light' ? saved : 'light');
})();

// --- views ------------------------------------------------------------------------
const ICONS = {
  up: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M7 11v9H4a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1z"/><path d="M7 11l4.2-8.1a2 2 0 0 1 3.7 1.3L14 9h4.6a2 2 0 0 1 2 2.4l-1.4 7A2 2 0 0 1 17.2 20H7"/></svg>',
  down: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M17 13V4h3a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1z"/><path d="M17 13l-4.2 8.1a2 2 0 0 1-3.7-1.3L10 15H5.4a2 2 0 0 1-2-2.4l1.4-7A2 2 0 0 1 6.8 4H17"/></svg>',
  pencil: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>',
  copy: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>',
  tick: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m20 6-11 11-5-5"/></svg>',
  filter: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6h16"/><path d="M7 12h10"/><path d="M10 18h4"/></svg>',
  clip: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21.4 11.1 12.3 20.2a5.5 5.5 0 0 1-7.8-7.8l9.2-9.1a3.7 3.7 0 0 1 5.2 5.2l-9.2 9.1a1.8 1.8 0 0 1-2.6-2.6l8.5-8.4"/></svg>',
  moon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8"/></svg>',
  sun: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
  compose: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14"/><path d="M5 12h14"/></svg>',
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
  { id: 'run', label: 'Chat', title: 'Chat', blurb: 'One transcript. Every claim cites its evidence.', load: () => renderRun() },
  { id: 'outputs', label: 'Outputs', title: 'Outputs', blurb: 'Files it wrote. What it only read stays in the chat.', load: () => loadOutputs() },
  { id: 'memory', label: 'Memory', title: 'Memory', blurb: 'What it was told, noticed and learned. Yours to edit.', load: () => loadMemory() },
  { id: 'proposals', label: 'Proposals', title: 'Proposals', blurb: 'What it wants to add. Anything blocked says why.', load: () => loadProposals() },
  { id: 'registry', label: 'Registry', title: 'Skills, rules and tools', blurb: 'Behaviour composed from files you can read.', load: () => loadRegistry() },
  { id: 'analytics', label: 'Analytics', title: 'Analytics', blurb: 'Read from run records on your disk. Nothing is sent.', load: () => loadAnalytics() },
  { id: 'space', label: 'Storage', title: 'Storage', blurb: 'What each part costs, and what deleting it costs you.', load: () => loadSpace() },
  { id: 'history', label: 'Conversations', title: 'Past conversations', blurb: 'Open one and carry on where it stopped.', load: () => loadHistory() },
  { id: 'connectors', label: 'Connectors', title: 'Connectors and setup', blurb: 'What tools need before they work, and MCP servers.', load: () => loadConnectors() },
  { id: 'schedule', label: 'Schedule', title: 'Runs without you', blurb: 'Work that fires on a timetable. Nothing approves itself.', load: () => loadSchedules() },
  { id: 'setup', label: 'Setup', title: 'Models and providers', blurb: 'Connect a model. Keys are stored 0600, never in config.', load: () => loadSetup() },
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
      b.appendChild(st(el('span', 'num xs nvbadge', String(badges[v.id])), 'flex:none;background:var(--warn);color:var(--canvas);border-radius:999px;min-width:17px;height:17px;display:grid;place-items:center;font-weight:700;padding:0 4px'));
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
  $('#view-icons').innerHTML = '';
  $('#view').innerHTML = '';
  $('#view').setAttribute('style', 'flex:1;min-height:0;display:flex;flex-direction:column;overflow-y:auto;padding:20px 24px 44px');
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

/** Can a person do anything with this proposal beyond reading or rejecting it? */
function actionable(x) {
  return Boolean(x.defect) || Boolean(x.patch) || Boolean(x.implementation) || x.kind !== 'tool';
}

function subTabs(host, viewId, tabs) {
  const bar = st(el('div'), 'display:flex;gap:3px;background:var(--surface);border-radius:999px;padding:3px;align-self:flex-start;max-width:100%;overflow-x:auto;flex:none');
  bar.setAttribute('role', 'tablist');
  // Only the file browser wants a body that fills its parent and manages its own scroll.
  // Applying that everywhere pinned every tabbed view to the viewport height, so Proposals
  // stopped scrolling and simply cut off at the fold with six rows and no way to reach them.
  const BODY_STYLE =
    viewId === 'outputs'
      ? 'margin-top:20px;flex:1;min-height:0;display:flex;flex-direction:column'
      : 'margin-top:20px';
  const body = st(el('div'), BODY_STYLE);
  host.appendChild(bar);
  host.appendChild(body);

  const activate = (id) => {
    subTabState[viewId] = id;
    [...bar.children].forEach((b) => {
      const on = b.dataset.tabid === id;
      b.setAttribute('data-on', on ? '1' : '0');
      // Which tab is current is carried by colour alone otherwise, which says nothing to a
      // screen reader and nothing to anyone who cannot see the difference.
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    body.innerHTML = '';
    // The style goes back too, not just the contents. A tab that lays out its own container
    // — the file browser sets the body to a bordered two-column flex row — otherwise leaves
    // that behind for whichever tab is opened next, which then renders its cards sideways
    // inside a stray box. Emptying a container it does not own is half the job.
    body.setAttribute('style', BODY_STYLE);
    // Classes are part of that container too — the file browser marks the body .filesplit so
    // the small breakpoint can stack its columns, and that must not follow it to the next tab.
    body.className = '';
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

/**
 * An icon button in the header, to the right of the title.
 *
 * Used for actions that belong to the view rather than to the thing you are typing.
 * New and Past used to sit in the composer row, where they crowded the input and read as
 * though they did something to the message you were about to send.
 */
/**
 * The profile and the theme, in the header rather than in a bar of their own.
 *
 * The profile decides what the agent may do, so it has to be reachable and legible from
 * anywhere — but a permanent strip across the top spent a whole row on three words that
 * change once a session. It is a control, not a status line. The current profile stays
 * visible as the icon's label so nobody has to open the menu to know where they stand.
 */
function paintShellIcons() {
  const host = $('#shell-icons');
  if (!host) return;
  host.innerHTML = '';

  const current = PROFILES.find((x) => x[0] === STATE.profile) || PROFILES[0];
  const prof = el('button', 'btn3 btnsm');
  prof.innerHTML = ICONS.filter;
  prof.appendChild(st(el('span', 'xs proflabel', current[1]), 'margin-left:7px;font-weight:600'));
  prof.title = current[2];
  prof.setAttribute('aria-label', 'Execution profile: ' + current[1]);
  st(prof, 'display:inline-flex;align-items:center;padding:7px 11px;line-height:0');
  prof.onclick = pickProfile;
  host.appendChild(prof);

  if (STATE.network) {
    const net = st(el('span', 'xs egress', 'egress ON'), 'color:var(--warn);font-weight:600;align-self:center');
    net.title = 'Tools may reach the network. Turn it off in Setup.';
    host.appendChild(net);
  }

  const dark = document.querySelector('#root').getAttribute('data-theme') === 'dark';
  const theme = el('button', 'btn3 btnsm');
  theme.innerHTML = dark ? ICONS.sun : ICONS.moon;
  theme.title = dark ? 'Light' : 'Dark';
  theme.setAttribute('aria-label', theme.title);
  st(theme, 'display:inline-flex;align-items:center;justify-content:center;padding:7px;line-height:0');
  theme.onclick = () => { toggleTheme(); paintShellIcons(); };
  host.appendChild(theme);
}

/**
 * Choosing a profile. Each option carries its worst case, because that is the only thing
 * that actually differs between them and the names alone do not say it.
 */
async function pickProfile() {
  const chosen = await modal({
    title: 'What is the agent allowed to do?',
    body: 'This is enforced by the executor, not by the prompt. No skill, lesson or file it reads can change it.',
    buttons: PROFILES.map(([id, label, note]) => ({
      label: (STATE.profile === id ? '\u2713 ' : '') + label + ' — ' + note,
      value: id,
      kind: STATE.profile === id ? 'btn1' : 'btn3',
    })).concat([{ label: 'Cancel', value: null, kind: 'btn3' }]),
    cancelValue: null,
  });
  if (!chosen || chosen === STATE.profile) return;
  await post('/api/config', { profile: chosen });
  await loadState();
  // The chat screen states the worst case in words, and a profile change makes that
  // sentence wrong until it is redrawn.
  go(current);
}

function headIcon(svg, title, fn) {
  const b = el('button', 'btn3 btnsm');
  b.innerHTML = svg;
  b.title = title;
  b.setAttribute('aria-label', title);
  st(b, 'display:inline-flex;align-items:center;justify-content:center;padding:7px;line-height:0');
  b.onclick = fn;
  $('#view-icons').appendChild(b);
  return b;
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
  paintShellIcons();
  // The workspace path was two lines of the sidebar restating something the window title
  // and every citation already carry. It stays as the tooltip on the model line, which is
  // where someone actually wonders which project they are pointed at.
  const foot = document.querySelector('.sidefoot');
  if (foot) foot.title = STATE.workspace;

  const bound = STATE.tiers.standard || STATE.tiers.light || STATE.tiers.frontier;
  const dot = st(el('span'), 'width:7px;height:7px;border-radius:999px;flex:none;background:' + (bound ? 'var(--ok)' : 'var(--warn)'));
  $('#side-model').innerHTML = '';
  $('#side-model').appendChild(dot);
  $('#side-model').appendChild(el('span', null, bound || 'no model bound — see Setup'));

  $('#side-bind').innerHTML = '';
  $('#side-bind').appendChild(st(el('span', null, '\\u{1F512}'), 'flex:none;color:var(--ok)'));
  $('#side-bind').appendChild(el('span', 'mono', location.host));

  try {
    // The same test the Ready tab uses. Counting every draft put 6 on the badge and 3 on the
    // page, and the three it was counting were ones with nothing to do — a number that sends
    // you to a screen that disagrees with it is worse than no number.
    const p2 = await api('/api/proposals');
    badges.proposals = p2.proposals.filter((x) => x.status === 'draft' && actionable(x)).length || 0;
  } catch (e) {}
  renderNav();
}

// --- run --------------------------------------------------------------------------
let chatHistory = [];
/** Set when the thread on screen was opened from Past, so New knows it has something to clear. */
let resumedRun = null;
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

  const composer = st(el('div', 'composer'), 'flex:none;border-top:1px solid var(--line);padding:12px 24px 16px');
  const chips = st(el('div'), 'max-width:760px;margin:0 auto 8px;display:none;flex-wrap:wrap;gap:6px');
  chips.id = 'attachments';
  composer.appendChild(chips);
  const wrap = st(el('div'), 'max-width:760px;margin:0 auto;display:flex;gap:9px;align-items:center');
  const attach = el('button', 'btn3 btnsm');
  attach.innerHTML = ICONS.clip;
  attach.title = 'Attach files from this workspace';
  attach.setAttribute('aria-label', 'Attach files from this workspace');
  st(attach, 'display:inline-flex;align-items:center;justify-content:center;padding:11px;line-height:0;border-radius:999px');
  attach.onclick = openAttach;
  // A textarea rather than an input, because Shift-Enter has to be able to make a line —
  // an input cannot hold one. It starts one line tall and grows with the content, so the
  // common case still looks like a single-line box.
  const input = el('textarea', 'fld');
  input.id = 'prompt';
  input.rows = 1;
  input.placeholder = ASK_DEFAULT;
  st(input, 'flex:1;border-radius:22px;padding:13px 18px;resize:none;font-family:inherit;font-size:14px;line-height:1.5;max-height:9em;overflow-y:auto');
  const grow = () => {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 144) + 'px';
  };
  input.addEventListener('input', grow);
  const send = el('button', 'btn1', 'Send');
  send.id = 'send';
  wrap.appendChild(attach); wrap.appendChild(input); wrap.appendChild(send);
  composer.appendChild(wrap);
  v.appendChild(composer);
  paintAttachments();

  send.onclick = doSend;
  input.addEventListener('keydown', (e) => {
    // Tab completes the suggested follow-up into the box rather than sending it. It arrives
    // as text you can read, edit or delete — sending something the person never wrote would
    // be a surprise once and a trap every time after.
    if (e.key === 'Tab' && suggestion && !input.value.trim()) {
      e.preventDefault();
      input.value = suggestion;
      grow();
      return;
    }
    if (e.key !== 'Enter') return;
    if (e.shiftKey) return; // a new line, which is why this is a textarea
    e.preventDefault();
    doSend();
  });

  // Conversation-level actions live in the header, not next to the input.
  headIcon(ICONS.history, 'Past conversations — open one to read it and carry on', () => go('history'));
  headIcon(ICONS.compose, 'New conversation. Memory is untouched.', () => {
    chatHistory = [];
    resumedRun = null;
    suggestion = '';
    input.placeholder = ASK_DEFAULT;
    inner.innerHTML = '';
    renderIdle();
  });

  const bound = STATE && (STATE.tiers.standard || STATE.tiers.light || STATE.tiers.frontier);
  send.disabled = !bound;
  if (!bound) input.placeholder = 'Connect a model first — see Setup';
  renderIdle();
}

const ASK_DEFAULT = 'Ask what I should do for you';

/** The follow-up currently offered in the composer, or '' when there is none. */
let suggestion = '';

/**
 * What to ask next, from what actually happened.
 *
 * Deliberately derived rather than generated. A second model call per run would produce a
 * smoother sentence and cost a request every time, and the useful follow-ups after a run
 * are not really open-ended: something was disclosed, something was built, something was
 * counted. Each of these points at a thing the run itself did, so none of them can suggest
 * work the agent has no basis for.
 */
function suggestFollowUp(r) {
  if (!r) return '';

  // A declared gap is the most useful thing to pull on, and the easiest to forget.
  const gap = (r.gateFindings || []).find((g) => !g.passed);
  if (gap) return 'Close the gap you flagged';

  if (r.ok === false) return 'What stopped you finishing?';

  const answer = String(r.answer || '');

  // No regular expressions in this file. It is one long template literal, so a backslash-d
  // arrives as a plain d and a backslash-b as a backspace, and the pattern then matches
  // nothing at all while looking perfectly correct. Plain string work cannot be eaten.
  // Built from code points: an escape here would be eaten by the template literal.
  const STOP = ' ,.;:)"' + String.fromCharCode(39) + String.fromCharCode(9) + String.fromCharCode(10);
  const after = (marker) => {
    const at = answer.toLowerCase().indexOf(marker);
    if (at < 0) return '';
    const rest = answer.slice(at + marker.length).trim();
    let end = 0;
    while (end < rest.length && STOP.indexOf(rest[end]) < 0) end++;
    return rest.slice(0, end);
  };

  // A tool it wrote is worth using again while the context is still here.
  const built = after('built and installed ');
  if (built) return 'Use ' + built + ' again for something else';

  const wrote = after('wrote to ') || after('saved to ');
  if (wrote) return 'Show me what you put in ' + wrote;

  if (r.outcomeId === 'outcome/research') return 'Turn this into a one-page brief';
  if (r.outcomeId === 'outcome/change') return 'Show me exactly what changed';
  if (r.outcomeId === 'outcome/investigate') return 'What would you check next?';

  // The first bolded figure is the claim most worth pulling on in an ordinary answer.
  if (r.artifactCount) {
    const open = answer.indexOf('**');
    const close = open >= 0 ? answer.indexOf('**', open + 2) : -1;
    if (close > open) {
      const bold = answer.slice(open + 2, close).trim();
      if (bold && bold.length < 40 && /[0-9]/.test(bold)) return 'How did you arrive at ' + bold + '?';
    }
  }

  return 'What else should I look at?';
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
      b.appendChild(st(el('span', 'xs exhint', hint), 'flex:none;color:var(--ink-3)'));
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

/**
 * Inline markdown for the trace.
 *
 * The trace prints event messages verbatim, and one of those events is the answer itself —
 * so a delivered answer showed up as literal asterisks around the number it had just spent
 * four steps establishing. Inline only: bold, italic and code. A trace line is one line,
 * and promoting it to block markdown would put headings and lists inside a log.
 *
 * Escaped before it is matched, because tool output reaches here and is not ours.
 */
function inlineMd(text) {
  const esc = String(text == null ? '' : text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return esc
    .replace(/\\*\\*([^*]+)\\*\\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\\*([^*\\n]+)\\*/g, '$1<em>$2</em>')
    .replace(/\u0060([^\u0060]+)\u0060/g, '<code style="font-family:ui-monospace,monospace;font-size:.94em">$1</code>');
}

/**
 * Syntax highlighting for the sandbox, in about twenty lines and no dependency.
 *
 * The code is escaped first and matched second, so a string containing an angle bracket
 * cannot become markup. Order in the alternation is the whole algorithm: comments before
 * strings before keywords, because a keyword inside a comment is a comment and a comment
 * marker inside a string is a string.
 *
 * Every backslash here is doubled and the backtick is written as a unicode escape,
 * because this file is
 * one long template literal: a lone \n would become a real newline in the emitted regex and
 * a lone backtick would end the page.
 */
function highlightJs(code) {
  const esc = String(code)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  const RE = /(\\/\\/[^\\n]*|\\/\\*[\\s\\S]*?\\*\\/)|('(?:\\\\.|[^'\\\\])*'|"(?:\\\\.|[^"\\\\])*"|\u0060(?:\\\\.|[^\u0060\\\\])*\u0060)|\\b(const|let|var|function|return|if|else|for|while|do|of|in|new|await|async|try|catch|finally|throw|typeof|instanceof|class|extends|import|export|from|null|undefined|true|false)\\b|\\b(\\d+(?:\\.\\d+)?)\\b|([A-Za-z_$][\\w$]*)(?=\\s*\\()/g;
  const paint = (colour, text) => '<span style="color:' + colour + '">' + text + '</span>';
  return esc.replace(RE, (m, comment, str, kw, numeric, call) => {
    if (comment) return paint('#6b7684', m);
    if (str) return paint('#e3c08d', m);
    if (kw) return paint('#87a9f5', m);
    if (numeric) return paint('#d7a8ff', m);
    if (call) return paint('#6fd2c9', m);
    return m;
  });
}

/**
 * The sandbox card: the code on the way in, the result on the way back.
 *
 * Two halves because that is how it happens — the code is known before the run and the
 * output only after, and showing the code immediately means you can read it while the
 * thing executes rather than waiting to find out what it did.
 */
function openSandboxCard(host, code, before) {
  const source = String(code).trim();

  // Dark in both themes, on purpose: this is a code surface, and the syntax colours are
  // chosen against a dark ground. Following the page theme would leave them washed out on
  // a pale block half the time.
  const card = st(el('section'), 'margin:14px 0;border-radius:14px;overflow:hidden;background:#232a35;box-shadow:0 10px 26px rgba(15,20,30,.16);animation:rise .2s ease both');

  const head = st(el('div'), 'display:flex;align-items:center;gap:10px;padding:9px 14px;background:#1c222c');
  head.appendChild(st(el('span', 'xs'), 'color:#8b97a8;font-weight:600')).textContent = 'sandbox';
  head.appendChild(st(el('span', 'xs mono'), 'color:#5f6b7c')).textContent = 'javascript';

  const state = st(el('span', 'xs'), 'margin-left:auto;color:#8b97a8');
  state.textContent = 'running';
  head.appendChild(state);

  const pre = st(el('pre', 'mono'), 'margin:0;padding:15px 17px;overflow-x:auto;line-height:1.62;font-size:12.5px;color:#cdd6e4');
  pre.innerHTML = highlightJs(source);

  const copy = el('button', 'xs');
  copy.textContent = 'Copy code';
  st(copy, 'border:0;background:none;color:#8b97a8;font-family:inherit;font-size:11.5px;cursor:pointer;padding:3px 2px');
  copy.onclick = async () => {
    try {
      await navigator.clipboard.writeText(source);
      copy.textContent = 'Copied';
    } catch (e) {
      // The clipboard API is refused in some contexts. Telling someone to press Cmd-C
      // without selecting anything for them to copy is worse than not offering the button,
      // so select the code and let the keystroke do what it was going to do anyway.
      const range = document.createRange();
      range.selectNodeContents(pre);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      copy.textContent = 'selected — press Cmd-C';
    }
    setTimeout(() => { copy.textContent = 'Copy code'; }, 1800);
  };
  head.appendChild(copy);
  card.appendChild(head);
  const folder = collapsible(pre, source.split('\\n').length, 'lines of code');
  card.appendChild(folder.node || folder);

  // Inserted above the answer rather than appended, because the answer element is created
  // empty at the start and filled at the end: appending would put every piece of working
  // below the conclusion it produced.
  if (before && before.parentElement === host) host.insertBefore(card, before);
  else host.appendChild(card);
  return { card, state, fold: folder.fold };
}

/**
 * Long blocks fold to a preview with a toggle.
 *
 * A run that reaches for the sandbox four times used to produce four full screens of code
 * and four of output, so the answer they were all working towards sat somewhere below the
 * fold and the thread became unreadable. The content is all still here — folded, not cut,
 * which is the difference between a summary and a truncation.
 */
function collapsible(inner, count, noun, foldOver = 14) {
  const baseStyle = inner.getAttribute('style') || '';
  const toggle = el('button', 'xs');
  st(toggle, 'display:block;width:100%;border:0;border-top:1px solid #333c4a;background:#1c222c;color:#8b97a8;font-family:inherit;font-size:11.5px;padding:7px;cursor:pointer');

  const box = st(el('div'), 'position:relative');
  box.appendChild(inner);
  const fade = st(el('div'), 'position:absolute;left:0;right:0;bottom:0;height:56px;pointer-events:none;background:linear-gradient(rgba(35,42,53,0),#232a35)');
  box.appendChild(fade);

  const wrap = st(el('div'), '');
  wrap.appendChild(box);
  wrap.appendChild(toggle);

  let folded = false;
  const paint = () => {
    inner.setAttribute('style', baseStyle + (folded ? ';max-height:230px;overflow:hidden' : ''));
    fade.style.display = folded ? 'block' : 'none';
    toggle.textContent = folded ? 'Show all ' + count + ' ' + noun : 'Show less';
  };
  const fold = () => { folded = true; paint(); };
  toggle.onclick = () => { folded = !folded; paint(); };

  // Long by default folds; short stays open until something folds it deliberately.
  folded = count > foldOver;
  paint();
  return { node: wrap, fold };
}

async function closeSandboxCard(handle, data, runId) {
  const ok = data.ok !== false;
  handle.state.textContent = '';
  handle.state.appendChild(statusPill(ok ? 'returned' : 'rejected', ok ? 'ok' : 'idle'));

  // A rejected attempt leaves the conversation entirely.
  //
  // It is the agent correcting itself, it usually takes two or three goes, and every one of
  // them is a near-copy of the next. Folded they were still four headers between a question
  // and its answer. The attempt is not lost — it is in the trace, in the run record and in
  // the audit log, which is where the machinery belongs. The chat keeps the code that ran.
  if (!ok) {
    handle.card.remove();
    return;
  }

  // The whole result, not the bounded one.
  //
  // shapeText trims the observation the *model* sees, for context and cost, and that is a
  // real constraint. It is not this reader's constraint: the artifact on disk holds the
  // payload in full, so the panel was cutting off something it already had — and cutting it
  // mid-token, which reads as the tool having failed halfway.
  let text = String(data.output || '').trim();
  if (ok && data.artifactId && runId) {
    try {
      const a = await api('/api/artifact?runId=' + encodeURIComponent(runId) + '&id=' + encodeURIComponent(data.artifactId));
      if (a.payload && a.payload !== 'null') {
        text = a.payload + (a.truncated ? '\\n\\n[' + a.payloadChars + ' characters in total; the rest is in ' + a.file + ']' : '');
      }
    } catch (e) {
      /* the bounded summary is a fair fallback */
    }
  }
  if (!text) return;

  const wrap = st(el('div'), 'border-top:1px solid #333c4a;background:#1c222c');
  wrap.appendChild(st(el('p', 'xs', ok ? 'returned' : 'rejected'), 'margin:0;padding:9px 17px 0;color:#8b97a8;font-weight:600'));
  const pre = st(el('pre', 'mono'), 'margin:0;padding:5px 17px 14px;overflow-x:auto;line-height:1.6;font-size:12.5px;color:' + (ok ? '#a9dcc8' : '#e9a8a8') + ';text-wrap:wrap;word-break:break-word');
  pre.textContent = text;
  wrap.appendChild(collapsible(pre, text.split('\\n').length, 'lines').node);
  handle.card.appendChild(wrap);
}

/** One shape for a message you sent, whether it is being typed now or read back later. */
function bubbleUser(text, at) {
  const you = st(el('div'), 'display:flex;flex-direction:column;align-items:flex-end;animation:rise .2s ease both;margin-bottom:18px');
  you.appendChild(st(el('p', null, text), 'margin:0;font-size:15px;line-height:1.6;background:var(--surface-2);border-radius:22px 22px 6px 22px;padding:13px 19px;max-width:82%;text-wrap:pretty'));
  you.appendChild(messageFooter({ text, at, align: 'flex-end' }));
  return you;
}

/**
 * The quiet line under a message: when it was said, and a way to take it with you.
 *
 * Deliberately low contrast and deliberately below. Every scrap of run metadata used to sit
 * *above* the answer, between the question and the thing that answered it, where it was
 * read once and then scrolled past forever. What is worth keeping — the time, the model,
 * a way into the trace — belongs after the content, at the weight of a caption.
 */
function messageFooter(opts) {
  const bar = st(el('div'), 'display:flex;align-items:center;gap:9px;margin:7px 0 0;justify-content:' + (opts.align || 'flex-start'));

  if (opts.label) bar.appendChild(statusPill(opts.label, opts.tone || 'idle'));

  const when = new Date(opts.at || Date.now());
  const stamp = st(el('span', 'xs num'), 'color:var(--ink-3)');
  stamp.textContent = when.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  stamp.title = when.toLocaleString();
  bar.appendChild(stamp);

  if (opts.model) bar.appendChild(st(el('span', 'xs', shortModel(opts.model)), 'color:var(--ink-3)'));
  if (opts.detail) bar.appendChild(st(el('span', 'xs', opts.detail), 'color:var(--ink-3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0'));

  const copy = el('button', 'xs');
  copy.innerHTML = ICONS.copy;
  copy.title = 'Copy this message';
  copy.setAttribute('aria-label', 'Copy this message');
  st(copy, 'border:0;background:none;color:var(--ink-3);cursor:pointer;padding:2px;line-height:0;display:inline-flex;align-items:center');
  copy.onclick = async () => {
    try {
      await navigator.clipboard.writeText(String(opts.text || ''));
      copy.innerHTML = ICONS.tick;
    } catch (e) {
      copy.innerHTML = '';
      copy.textContent = 'select and press Cmd-C';
    }
    setTimeout(() => { copy.innerHTML = ICONS.copy; }, 1600);
  };
  bar.appendChild(copy);

  if (opts.trace) {
    const t = el('button', 'xs', 'trace');
    st(t, 'border:0;background:none;color:var(--ink-3);cursor:pointer;padding:2px 3px;font-family:inherit');
    let open = false;
    t.onclick = () => {
      open = !open;
      opts.trace.style.display = open ? 'flex' : 'none';
      t.textContent = open ? 'hide trace' : 'trace';
    };
    bar.appendChild(t);
  }
  return bar;
}

/** anthropic/claude-haiku-4-5-20251001 is a mouthful for a caption. */
function shortModel(id) {
  let tail = String(id).split('/').pop() || '';
  if (tail.startsWith('claude-')) tail = tail.slice(7);
  // Trailing -YYYYMMDD, without a regex for the reason above.
  const cut = tail.lastIndexOf('-');
  const suffix = cut >= 0 ? tail.slice(cut + 1) : '';
  if (suffix.length === 8 && !Number.isNaN(Number(suffix))) tail = tail.slice(0, cut);
  return tail;
}

/**
 * Every art_... in a delivered answer becomes something you can open.
 *
 * The whole design turns on claims being traceable to evidence, and the citation was a
 * fifteen-character opaque string you could read and not follow. The artifact was always
 * one API call away; nothing pointed at it.
 */
function linkArtifacts(host, runId) {
  if (!host || !runId) return;
  // The renderer already marks them: it wraps every art_... in span.md-art on its way to
  // HTML. Matching the markup beats re-finding them with a regex — and a regex here would
  // have to survive this file being one long template literal, where a lone backslash-b
  // becomes a backspace character and quietly matches nothing at all.
  host.querySelectorAll('.md-art').forEach((span) => {
    const id = (span.textContent || '').trim();
    if (!id) return;
    const b = el('button', 'xs mono');
    b.textContent = id;
    st(b, 'border:0;background:none;color:var(--brand-strong);font-family:ui-monospace,monospace;font-size:.94em;cursor:pointer;padding:0;text-decoration:underline;text-underline-offset:2px');
    b.title = 'Open this evidence';
    b.onclick = () => openArtifact(runId, id);
    span.replaceWith(b);
  });
}

async function openArtifact(runId, id) {
  try {
    // The endpoint returns the artifact flat, with the payload already stringified and
    // bounded at 40k — it says so with truncated, and names the file holding the rest.
    const a = await api('/api/artifact?runId=' + encodeURIComponent(runId) + '&id=' + encodeURIComponent(id));
    const NL = String.fromCharCode(10);

    // Summary first, payload second, and the payload only when it adds something.
    //
    // A search that found nothing has a payload of exactly [] and showing that alone is how
    // a citation opens onto an empty box: the reader clicks the evidence behind "no matches"
    // and is shown two brackets. The sentence saying what found nothing is the summary, and
    // for several tools it is the whole of the evidence.
    const payload = String(a.payload == null ? '' : a.payload).trim();
    const thin = !payload || payload === 'null' || payload === '[]' || payload === '{}';
    const parts = [];
    if (a.summary) parts.push(a.summary);
    if (!thin) parts.push((a.summary ? NL + NL : '') + payload);
    if (!parts.length) parts.push('This artifact recorded no detail beyond the fact that the call happened.');
    if (a.truncated) parts.push(NL + NL + '[' + a.payloadChars + ' characters in total. The whole thing is at ' + a.file + ']');

    await say(id + (a.tool ? '  ·  ' + a.tool : ''), parts.join(''));
  } catch (e) {
    await say('Could not open ' + id, e.message);
  }
}

async function doSend() {
  const input = $('#prompt');
  const request = (input.value || '').trim();
  if (!request || busy) return;
  input.value = '';
  input.style.height = 'auto';
  suggestion = '';
  input.placeholder = ASK_DEFAULT;
  busy = true;
  $('#send').disabled = true;

  const t = $('#thread');
  if (t.querySelector('h2')) t.innerHTML = '';

  t.appendChild(bubbleUser(request));

  let sandboxCard = null;
  const { row, body } = agentBlock();
  t.appendChild(row);

  // One quiet line while it works, and nothing else above the answer.
  //
  // This used to be a status pill, a step counter, and a rail of stage chips that grew as
  // the run progressed — intake, discover, plan, act. It is the kind of display that looks
  // informative and is mostly motion: the stages are the same four almost every time, the
  // step count means nothing without the budget it is out of, and all of it sits between
  // the question and the answer, which is the one thing anybody scrolled here to read.
  // What is genuinely worth knowing after the fact lives in the footer, and the detail is
  // one click away in the trace.
  const status = st(el('span', 'xs'), 'color:var(--ink-3)');
  status.textContent = 'working';
  body.appendChild(status);

  const trace = st(el('div'), 'margin:10px 0 0;display:none;flex-direction:column;gap:3px');
  const answer = st(el('div', 'md'), 'margin:10px 0 0');
  body.appendChild(answer);
  body.appendChild(trace);
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

    // Code the agent wrote and ran gets a card in the conversation, not a line in the
    // trace. It is the one tool whose *input* is the interesting part: everything else
    // reports what it found, and this one reports what it computed, which is only worth
    // anything if you can see the computation.
    if (ev.type === 'tool' && ev.data && ev.data.tool === 'sandbox_run') {
      if (ev.data.code) sandboxCard = openSandboxCard(body, ev.data.code, answer);
      else if (sandboxCard) { closeSandboxCard(sandboxCard, ev.data, runId); sandboxCard = null; }
    }

    const line = st(el('div', 'xs'), 'display:flex;gap:9px;color:var(--ink-3);padding:1px 0');
    line.appendChild(st(el('span', 'mono', ev.type), 'flex:none;min-width:52px;color:var(--ink-3)'));
    const msg = st(el('span'), 'min-width:0;flex:1');
    msg.innerHTML = inlineMd(ev.message);
    line.appendChild(msg);
    trace.appendChild(line);
  });

  source.addEventListener('ask', (m) => renderAsk(runId, JSON.parse(m.data), body));

  source.addEventListener('done', (m) => {
    const data = JSON.parse(m.data);
    source.close(); source = null;
    busy = false;
    $('#send').disabled = false;
    if (data.error) {
      status.remove();
      answer.textContent = data.error;
      answer.appendChild(messageFooter({ text: data.error, tone: 'dang', label: 'failed' }));
      return;
    }
    const r = data.result;
    if (!r) { answer.textContent = 'no answer'; return; }
    status.remove();
    if (r.answerHtml) answer.innerHTML = r.answerHtml; else answer.textContent = r.answer;
    linkArtifacts(answer, r.runId);
    if (r.protocolDowngraded) {
      answer.appendChild(st(el('p', 'xs callout warn', 'This model has no native tool calling, so hats used the prompt-described protocol. Tool selection is noticeably less reliable that way.'), ''));
    }
    const failed = (r.gateFindings || []).filter((g) => !g.passed);
    if (failed.length) {
      answer.appendChild(st(el('p', 'xs callout warn', 'Delivered with gaps: ' + failed.map((g) => g.detail).join('; ')), ''));
    }
    body.appendChild(
      messageFooter({
        text: r.answer || '',
        model: (r.modelsUsed || [])[0],
        detail: r.outcomeId + (r.artifactCount ? ' · ' + r.artifactCount + (r.artifactCount === 1 ? ' artifact' : ' artifacts') : ''),
        ...(r.ok ? {} : { tone: 'warn', label: 'partial' }),
        trace,
      }),
    );
    suggestion = suggestFollowUp(r);
    const box = $('#prompt');
    if (box && !box.value.trim()) {
      box.placeholder = suggestion ? suggestion + '   (Tab)' : ASK_DEFAULT;
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
  const bar = st(el('div'), 'display:flex;flex-wrap:wrap;align-items:center;gap:3px;margin:6px 0 0');
  const said = st(el('span', 'xs'), 'color:var(--ink-3);margin-left:5px');
  const mk = (label, verdict, needsNote, icon) => {
    // Icons, at the weight of the rest of the footer. Three filled buttons under every
    // answer read as the main thing to do next, which they are not — most answers are
    // simply read and moved on from, and feedback is the exception worth having available
    // rather than the action being asked for.
    const b = el('button', 'xs');
    b.innerHTML = icon;
    b.title = label;
    b.setAttribute('aria-label', label);
    st(b, 'border:0;background:none;color:var(--ink-3);cursor:pointer;padding:3px;line-height:0;display:inline-flex;align-items:center;border-radius:7px');
    b.onmouseenter = () => { b.style.color = 'var(--ink)'; b.style.background = 'var(--surface)'; };
    b.onmouseleave = () => { b.style.color = 'var(--ink-3)'; b.style.background = 'none'; };
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
  bar.appendChild(mk('Good answer', 'accepted', false, ICONS.up));
  bar.appendChild(mk('Wrong answer', 'rejected', false, ICONS.down));
  bar.appendChild(mk('Correct it', 'corrected', true, ICONS.pencil));
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
  } else if ((ask.fields || []).length) {
    // A form, inline in the conversation. Asking for six things one round trip at a time
    // is the difference between a setup that takes a minute and one nobody finishes.
    box.appendChild(st(el('p', 'h3', ask.question || 'A few details'), 'margin:0'));
    const form = st(el('div'), 'display:flex;flex-direction:column;gap:10px;margin-top:12px');
    const inputs = {};

    ask.fields.forEach((f) => {
      const cell = st(el('div'), 'display:flex;flex-direction:column;gap:4px');
      const label = st(el('span', 'xs'), 'color:var(--ink-2)');
      label.textContent = f.label + (f.required ? ' *' : '');
      cell.appendChild(label);

      let input;
      if (f.type === 'select') {
        input = el('select', 'fld');
        (f.options || []).forEach((o) => {
          const opt = el('option', '', o);
          opt.value = o;
          input.appendChild(opt);
        });
      } else if (f.type === 'boolean') {
        input = el('select', 'fld');
        ['yes', 'no'].forEach((o) => {
          const opt = el('option', '', o);
          opt.value = o;
          input.appendChild(opt);
        });
      } else {
        input = el('input', 'fld');
        if (f.type === 'secret') input.type = 'password';
        if (f.type === 'number') input.type = 'number';
        if (f.placeholder) input.placeholder = f.placeholder;
      }
      st(input, 'min-height:38px;padding:9px 12px');
      inputs[f.name] = input;
      cell.appendChild(input);

      if (f.type === 'secret') {
        // Said at the point of entry, because trusting a chat box with a key is a
        // reasonable thing to hesitate over.
        cell.appendChild(st(el('span', 'xs'), 'color:var(--ink-3)')).textContent =
          'Stored in credentials.json at mode 0600. The agent is told only the last four characters, never the value.';
      }
      form.appendChild(cell);
    });
    box.appendChild(form);

    const msg = st(el('p', 'xs'), 'margin:8px 0 0;color:var(--dang)');
    const actions = st(el('div'), 'display:flex;gap:8px;margin-top:11px');
    const submit = el('button', 'btn1 btnsm', 'Send');
    submit.onclick = async () => {
      const values = {};
      const missing = [];
      ask.fields.forEach((f) => {
        const val = (inputs[f.name].value || '').trim();
        if (f.required && !val) missing.push(f.label);
        values[f.name] = val;
      });
      if (missing.length) { msg.textContent = 'Still needed: ' + missing.join(', '); return; }
      box.remove();
      await post('/api/answer', { runId, id: ask.id, values });
    };
    const skip = el('button', 'btn3 btnsm', 'Skip');
    skip.onclick = async () => { box.remove(); await post('/api/answer', { runId, id: ask.id, answer: 'The human skipped this form.' }); };
    actions.appendChild(submit); actions.appendChild(skip);
    box.appendChild(actions);
    box.appendChild(msg);
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
    const send = el('button', 'btn1 btnsm', 'Answer');
    send.onclick = async () => { box.remove(); await post('/api/answer', { runId, id: ask.id, answer: free.value }); };
    row.appendChild(free); row.appendChild(send);
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

async function loadFiles(dirPath, host) {
  // The browser used to own the whole view. It is now one tab inside Outputs, so it renders
  // into whatever it is given and keeps its own two-column layout there.
  const v = host || FILES_HOST || $('#view');
  FILES_HOST = v;
  v.classList.add('filesplit');
  v.setAttribute('style', 'flex:1;min-height:0;display:flex;overflow:hidden;padding:0;border:1px solid var(--line);border-radius:14px');
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
  ctx.appendChild(el('p', 'xs note', 'Written by you, read by the agent, never written by it.'));
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
  per.appendChild(el('p', 'xs note', 'Inferred from how you work. Every line is in every prompt, so a wrong one steers it quietly.'));
  // One row per fact rather than the joined summary. They were technically on screen before,
  // concatenated into a single paragraph, which is the same as not being on screen: nobody
  // reads a wall of inferences about themselves, and there was no way to drop just the wrong one.
  if (!m.persona.facts || m.persona.facts.length === 0) {
    per.appendChild(st(el('p', 'sm', 'Nothing inferred yet.'), 'margin:11px 0 0;color:var(--ink-3)'));
  } else {
    const pul = el('ul', 'rowlist');
    m.persona.facts.forEach((f) => {
      const li = el('li');
      li.appendChild(st(el('span', 'sm', f), 'min-width:200px;flex:1;text-wrap:pretty'));
      const drop = el('button', 'btn3 btnsm', 'Forget');
      drop.onclick = async () => { await post('/api/persona/forget', { fact: f }); loadMemory(); };
      li.appendChild(drop);
      pul.appendChild(li);
    });
    per.appendChild(pul);
  }
  per.appendChild(st(el('p', 'xs mono', m.personaPath || ''), 'margin:8px 0 0;color:var(--ink-3)'));

  const les = el('section', 'sect');
  les.appendChild(el('p', 'h3', 'Lessons'));
  les.appendChild(el('p', 'xs note', 'Learned from going wrong. Never changes what it may touch.'));
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
    v.appendChild(st(el('p', 'sm', 'No conversations in this workspace yet.'), 'color:var(--ink-2)'));
    return;
  }

  // A list you pick from, not a set of drawers you unfold. Reading a transcript inline was
  // the wrong shape: what you almost always want after finding an old conversation is to
  // say the next thing in it, and an expander cannot offer that.
  const wrap = st(el('div'), 'max-width:900px;display:flex;flex-direction:column;gap:8px');
  d.runs.forEach((r) => {
    const card = st(el('button'), 'display:block;width:100%;text-align:left;background:var(--surface);border:1px solid transparent;border-radius:14px;padding:13px 16px;cursor:pointer;transition:border-color .12s,background .12s');
    card.onmouseenter = () => { card.style.borderColor = 'var(--line)'; };
    card.onmouseleave = () => { card.style.borderColor = 'transparent'; };

    const top = st(el('div'), 'display:flex;flex-wrap:wrap;align-items:center;gap:9px');
    top.appendChild(statusPill(r.ok ? 'ok' : 'incomplete', r.ok ? 'ok' : 'warn'));
    top.appendChild(st(el('span', 'sm', r.request || '(no request)'), 'flex:1;min-width:200px;text-wrap:pretty'));
    if (r.trigger && r.trigger.kind !== 'human') top.appendChild(statusPill(r.trigger.kind, 'idle'));
    top.appendChild(st(el('span', 'xs num', relativeTime(r.startedAt)), 'color:var(--ink-3);flex:none'));
    card.appendChild(top);

    const meta = st(el('p', 'xs'), 'margin:5px 0 0;color:var(--ink-3)');
    meta.textContent = [
      r.outcomeId,
      r.profile,
      (r.steps || 0) + ' steps',
      r.trigger && r.trigger.actor !== 'you' ? 'started by ' + r.trigger.actor : null,
    ].filter(Boolean).join(' · ');
    card.appendChild(meta);

    card.onclick = () => openConversation(r);
    wrap.appendChild(card);
  });
  v.appendChild(wrap);
}

/** "3 minutes ago" reads better than a timestamp in a list you are scanning. */
function relativeTime(iso) {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return '';
  const mins = Math.round((Date.now() - then) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return mins + (mins === 1 ? ' minute ago' : ' minutes ago');
  const hours = Math.round(mins / 60);
  if (hours < 24) return hours + (hours === 1 ? ' hour ago' : ' hours ago');
  const days = Math.round(hours / 24);
  if (days < 7) return days + (days === 1 ? ' day ago' : ' days ago');
  return new Date(iso).toLocaleDateString();
}

/**
 * Open a past conversation in the chat and let the user carry on.
 *
 * The server call is the part that matters: it replaces the history that reaches the model.
 * Painting the old turns here without it would look resumed and behave like a fresh start,
 * which is worse than not offering it.
 */
async function openConversation(run) {
  go('run');
  const thread = $('#thread');
  thread.innerHTML = '';
  thread.appendChild(st(el('p', 'sm', 'Opening…'), 'color:var(--ink-2)'));

  let d;
  try {
    d = await post('/api/resume', { runId: run.runId });
  } catch (e) {
    thread.innerHTML = '';
    thread.appendChild(st(el('p', 'sm', 'Could not open that conversation: ' + e.message), 'color:var(--dang)'));
    return;
  }

  resumedRun = run.runId;
  chatHistory = [];
  thread.innerHTML = '';

  const banner = st(el('div'), 'margin:0 0 16px;padding:9px 13px;border-radius:11px;background:var(--surface);display:flex;flex-wrap:wrap;gap:9px;align-items:center');
  banner.appendChild(st(el('span', 'xs', 'Continuing a conversation from ' + relativeTime(run.startedAt)), 'color:var(--ink-2)'));
  const leave = el('button', 'btn3 btnsm', 'Start fresh instead');
  leave.onclick = async () => {
    await post('/api/run', { request: '', fresh: true }).catch(() => {});
    resumedRun = null;
    chatHistory = [];
    thread.innerHTML = '';
    renderIdle();
  };
  banner.appendChild(leave);
  thread.appendChild(banner);

  d.turns.forEach((turn) => {
    if (turn.role === 'user') {
      thread.appendChild(bubbleUser(turn.content, turn.ts));
      return;
    }
    if (turn.role !== 'assistant') return;
    if (!turn.content && !(turn.tools || []).length) return;
    const box = st(el('div'), 'margin:0 0 18px');
    if ((turn.tools || []).length) {
      box.appendChild(st(el('p', 'xs mono', turn.tools.join(', ')), 'margin:0 0 5px;color:var(--brand-strong)'));
    }
    if (turn.html) {
      const md = st(el('div', 'md'), 'margin:0');
      md.innerHTML = turn.html;
      box.appendChild(md);
      linkArtifacts(md, run.runId);
    } else if (turn.content) {
      box.appendChild(st(el('p', 'sm'), 'margin:0;white-space:pre-wrap;text-wrap:pretty')).textContent = turn.content;
    }
    if (turn.content) box.appendChild(messageFooter({ text: turn.content, at: turn.ts }));
    thread.appendChild(box);
  });

  if (!d.turns.length) {
    thread.appendChild(st(el('p', 'sm', 'No transcript was kept for this conversation, so there is nothing to carry forward.'), 'color:var(--ink-2)'));
  }
  thread.scrollTop = thread.scrollHeight;
  const input = $('#prompt');
  if (input) { input.placeholder = 'Carry on…'; input.focus(); }
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

/**
 * What the agent produced, grouped by the conversation that produced it.
 *
 * This view used to be the workspace file browser, and its own blurb admitted it: "the same
 * files the agent can see". That is a reading surface with a producing name on it. The
 * things it actually makes are artifacts — the evidence every cited number comes from — and
 * the files it wrote, and neither was anywhere in the panel.
 *
 * The browser survives as a second tab, because pointing a run at a file is a real job.
 */
let FILES_HOST = null;
let OUTPUT_TABS = null;
/** Where the browser tab should open next time it paints. Consumed once, then back to root. */
let FILES_START = '.';

/** The workspace browser, as a tab. */
function paintFileBrowser(host) {
  FILES_HOST = host;
  const start = FILES_START;
  FILES_START = '.';
  loadFiles(start, host);
}

/**
 * Open one file in the browser tab, from a link elsewhere.
 *
 * Switching tab by finding the button and clicking it, then sleeping long enough for the
 * repaint, is a guess about someone else's timing. subTabs hands back the switch, and the
 * browser builds its two columns before it awaits anything, so the preview pane is there by
 * the time activate returns. No timers.
 */
function openFile(relPath) {
  const slash = relPath.lastIndexOf('/');
  FILES_START = slash > 0 ? relPath.slice(0, slash) : '.';
  if (OUTPUT_TABS) OUTPUT_TABS.activate('files');
  return showPreview(relPath);
}

function loadOutputs() {
  const v = $('#view');
  v.innerHTML = '';
  const host = st(el('div'), 'max-width:1000px;flex:1;min-height:0;display:flex;flex-direction:column');
  OUTPUT_TABS = subTabs(host, 'outputs', [
    { id: 'produced', label: 'Produced', render: (body) => paintProduced(body) },
    { id: 'files', label: 'Workspace files', render: (body) => paintFileBrowser(body) },
  ]);
  v.appendChild(host);
}

const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many);

async function paintProduced(host) {
  host.innerHTML = '<p class="sm" style="color:var(--ink-2)">Loading…</p>';
  let d;
  try {
    d = await api('/api/outputs');
  } catch (e) {
    // A view that fails silently reads as a view with nothing in it, which is a different
    // and much worse claim than "this did not load".
    host.innerHTML = '';
    const box = st(el('div'), 'display:flex;flex-direction:column;align-items:flex-start;gap:10px');
    box.appendChild(st(el('p', 'sm', 'Could not read what was produced: ' + e.message), 'margin:0;color:var(--dang);text-wrap:pretty'));
    const again = el('button', 'btn2 btnsm', 'Try again');
    again.onclick = () => paintProduced(host);
    box.appendChild(again);
    host.appendChild(box);
    return;
  }

  host.innerHTML = '';
  const runs = d.runs || [];
  if (!runs.length) {
    // "Nothing yet" and "nothing recently" are different facts, and only one of them is
    // reassuring.
    const text = (d.total || 0) === 0
      ? 'Nothing produced yet. Artifacts appear as soon as a run reads or computes anything — they are what its citations point at.'
      : plural(d.scanned || 0, 'conversation', 'conversations') + ' searched, none of which wrote a file or recorded an artifact.';
    host.appendChild(st(el('p', 'sm', text), 'color:var(--ink-2);text-wrap:pretty'));
    return;
  }

  const wrap = st(el('div'), 'display:flex;flex-direction:column;gap:10px');
  runs.forEach((r, i) => {
    const card = st(el('section'), 'background:var(--surface);border-radius:14px;overflow:hidden');

    const body = st(el('div'), 'display:none;padding:0 16px 14px');
    body.id = 'produced-' + i;

    // flex-wrap, because at 375px the request, the counts and the time do not fit on one
    // line and the request is the part that gets squeezed to nothing.
    const head = st(el('button'), 'display:flex;flex-wrap:wrap;align-items:center;gap:6px 10px;width:100%;text-align:left;border:0;background:none;color:inherit;font-family:inherit;padding:13px 16px;cursor:pointer;min-height:44px');
    head.setAttribute('aria-expanded', 'false');
    head.setAttribute('aria-controls', body.id);

    // inline-block, or the rotation is silently dropped: transform does not apply to an
    // inline non-replaced element, so the only signal that the row expands never moves.
    const chevron = st(el('span', 'xs', '▸'), 'display:inline-block;color:var(--ink-3);flex:none;transition:transform .12s ease');
    head.appendChild(chevron);
    head.appendChild(statusPill(r.ok ? 'ok' : 'incomplete', r.ok ? 'ok' : 'warn'));
    head.appendChild(st(el('span', 'sm', r.request || '(no request)'), 'flex:1;min-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap'));
    if (r.files.length) head.appendChild(st(el('span', 'xs', plural(r.files.length, 'file', 'files')), 'color:var(--ok);font-weight:600;flex:none'));
    head.appendChild(st(el('span', 'xs num', plural(r.artifacts.length, 'artifact', 'artifacts')), 'color:var(--ink-3);flex:none'));
    const when = st(el('span', 'xs num', relativeTime(r.at)), 'color:var(--ink-3);flex:none');
    if (r.at) when.title = new Date(r.at).toLocaleString();
    head.appendChild(when);
    card.appendChild(head);

    head.onclick = () => {
      const open = body.style.display === 'block';
      body.style.display = open ? 'none' : 'block';
      head.setAttribute('aria-expanded', open ? 'false' : 'true');
      chevron.style.transform = open ? 'none' : 'rotate(90deg)';
      if (!open && !body.dataset.built) buildOutputDetail(body, r);
    };
    card.appendChild(body);
    wrap.appendChild(card);
  });
  host.appendChild(wrap);

  // A capped list that does not say it is capped reads as the whole history.
  if (d.more) {
    host.appendChild(st(
      el('p', 'xs', 'Showing ' + runs.length + ' of ' + plural(d.total || runs.length, 'conversation', 'conversations') + ' on disk, newest first. The rest are still in the run directory.'),
      'margin:14px 0 0;color:var(--ink-3);text-wrap:pretty',
    ));
  }
}

function buildOutputDetail(host, r) {
  host.dataset.built = '1';

  // Files first: they are the part that outlives the run.
  if (r.files.length) {
    host.appendChild(st(el('p', 'xs', 'files written'), 'margin:8px 0 0;color:var(--ink-3);font-weight:600'));
    const list = st(el('div'), 'display:flex;flex-direction:column;gap:2px;margin-top:5px;align-items:flex-start');
    r.files.forEach((f) => {
      const b = st(el('button', 'xs mono'), 'text-align:left;border:0;background:none;color:var(--brand-strong);font-family:ui-monospace,monospace;cursor:pointer;padding:6px 0;min-height:32px');
      b.textContent = f;
      b.onclick = () => openFile(f);
      list.appendChild(b);
    });
    host.appendChild(list);
  }

  host.appendChild(st(el('p', 'xs', 'artifacts — what its citations point at'), 'margin:12px 0 0;color:var(--ink-3);font-weight:600'));
  if (!r.artifacts.length) {
    host.appendChild(st(el('p', 'xs', 'None. This conversation wrote a file without recording evidence for it.'), 'margin:5px 0 0;color:var(--ink-2)'));
  } else {
    const list = st(el('div'), 'display:flex;flex-direction:column;gap:1px;margin-top:6px;background:var(--line);border-radius:10px;overflow:hidden');
    r.artifacts.forEach((a) => {
      const row = st(el('button'), 'display:flex;flex-wrap:wrap;gap:4px 9px;align-items:baseline;width:100%;text-align:left;border:0;background:var(--canvas);color:inherit;font-family:inherit;padding:9px 11px;cursor:pointer;min-height:36px');
      row.appendChild(st(el('span', 'xs mono', a.id), 'color:var(--brand-strong);flex:none'));
      row.appendChild(st(el('span', 'xs', a.tool), 'color:var(--ink-3);flex:none'));
      row.appendChild(st(el('span', 'xs', a.summary), 'flex:1;min-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--ink-2)'));
      row.onclick = () => showArtifact(r.runId, a);
      list.appendChild(row);
    });
    host.appendChild(list);
  }

  // The run that produced this is the context for all of it, and it was two views away.
  const back = el('button', 'btn3 btnsm', 'Open this conversation');
  back.onclick = () => openConversation({ runId: r.runId, startedAt: r.at });
  const foot = st(el('div'), 'margin-top:12px');
  foot.appendChild(back);
  host.appendChild(foot);
}

/**
 * One artifact, in full: what the model was shown, where the value came from, and the whole
 * stored payload. Provenance is the reason artifacts exist — a number in an answer is either
 * in one of these or it was invented — so a viewer that showed only the payload was hiding
 * the half that settles the question.
 */
async function showArtifact(runId, a) {
  let d;
  try {
    d = await api('/api/artifact?runId=' + encodeURIComponent(runId) + '&id=' + encodeURIComponent(a.id));
  } catch (e) {
    await say('Could not open that artifact', e.message);
    return;
  }

  const box = $('#overlay-body');
  box.innerHTML = '';
  const meta = [d.tool, d.kind, d.createdAt ? relativeTime(d.createdAt) : ''].filter(Boolean).join(' · ');
  box.appendChild(st(el('p', 'xs', meta), 'margin:0 0 10px;color:var(--ink-3)'));

  const block = (label, text) => {
    box.appendChild(st(el('p', 'xs', label), 'margin:14px 0 5px;color:var(--ink-3);font-weight:600'));
    const pre = st(el('pre', 'mono xs'), 'margin:0;background:var(--surface);border-radius:10px;padding:12px 14px;overflow:auto;max-height:40vh;line-height:1.55;white-space:pre-wrap;word-break:break-word');
    pre.textContent = text;
    box.appendChild(pre);
  };

  if (d.summary) block('what the model saw', d.summary);
  block('provenance — inputs, formula, source', JSON.stringify(d.provenance || {}, null, 2));
  // The label has to match what is underneath it. Calling a cut payload "the whole stored
  // result" is a small lie in the one place built for checking whether a number is real.
  block(d.truncated ? 'payload — the start of the stored result' : 'payload — the whole stored result', d.payload);
  if (d.truncated) {
    box.appendChild(st(
      el('p', 'xs', 'Showing the first ' + num(d.payload.length) + ' of ' + num(d.payloadChars) + ' characters. The whole artifact is at ' + d.file + '.'),
      'margin:9px 0 0;color:var(--ink-3);text-wrap:pretty',
    ));
  }

  $('#overlay-title').textContent = d.id;
  $('#overlay').hidden = false;
  const close = $('#overlay-close');
  if (close) close.focus();
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

  const drafts = p.proposals.filter((x) => x.status === 'draft');
  const decided = p.proposals.filter((x) => x.status !== 'draft');

  // "Waiting on you" has to mean there is something you can do.
  //
  // It was every draft, and most drafts are tool *contracts* — a note that some computation
  // recurred, with no handler behind it. Promoting one records a decision and produces
  // nothing, so the tab was mostly a list of things with no button that does anything,
  // under a heading asking for a decision. Splitting on capability rather than status.
  const pending = drafts.filter(actionable);
  const noted = drafts.filter((x) => !actionable(x));
  const host = st(el('div'), 'max-width:900px;display:flex;flex-direction:column;min-height:0');

  // Waiting on you is the only tab with anything to do, so it leads and carries the count.
  subTabs(host, 'proposals', [
    {
      id: 'pending',
      label: 'Ready to apply' + (pending.length ? ' · ' + pending.length : ''),
      render: (body) => paintProposals(body, pending, true),
    },
    {
      id: 'noted',
      label: 'Noted' + (noted.length ? ' · ' + noted.length : ''),
      render: (body) => {
        body.appendChild(
          st(
            el('p', 'sm', 'Things that recurred often enough to be worth recording, with nothing to approve: each describes a tool but carries no handler, so promoting one records a decision and produces nothing. build_tool is what writes one that installs.'),
            'margin:0 0 14px;color:var(--ink-3);text-wrap:pretty;max-width:70ch',
          ),
        );
        paintProposals(body, noted, true);
      },
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
    host.appendChild(st(el('p', 'sm', actionable ? 'Nothing to apply. Proposals arrive when the same gap turns up more than once.' : 'Nothing decided yet.'), 'color:var(--ink-2)'));
    return;
  }

  const list = st(el('div'), 'display:flex;flex-direction:column;gap:1px;background:var(--line);border-radius:14px;overflow:hidden');
  items.forEach((x) => {
    const row = st(el('div'), 'background:var(--canvas);padding:0');

    const head = st(el('button'), 'display:flex;align-items:center;gap:11px;width:100%;text-align:left;border:0;background:none;color:inherit;font-family:inherit;padding:13px 16px;cursor:pointer');
    head.appendChild(statusPill(x.kind, x.kind === 'tool' ? 'warn' : 'idle'));
    head.appendChild(st(el('span', 'sm', x.title), 'flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap'));
    if (x.occurrences > 1) head.appendChild(st(el('span', 'xs num', x.occurrences + '×'), 'color:var(--ink-3);flex:none'));
    // The primary action sits on the row.
    //
    // "needs you" with a chevron and nothing else reads as a status, so the buttons — which
    // only existed once the row was expanded — may as well not have been there. Naming the
    // action on the row says what is possible without opening anything.
    if (actionable) {
      const verb = x.defect ? 'Repair' : x.patch ? 'Apply' : x.implementation ? 'Install' : 'Promote';
      const go = el('button', 'btn1 btnsm', verb);
      st(go, 'flex:none;padding:4px 12px;min-height:28px;font-size:12px');
      go.onclick = async (e) => {
        e.stopPropagation();
        go.disabled = true;
        await applyProposal(x, go);
      };
      head.appendChild(go);
    }
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

/**
 * One implementation behind the row button and the expanded detail, so the two cannot drift
 * apart. A defect is the only kind whose primary action is not promotion — there is nothing
 * to write until a run has produced a patch.
 */
async function applyProposal(x, btn) {
  if (x.defect) return repairProposal(x, btn);
  return promoteProposal(x, btn);
}

async function promoteProposal(x, btn) {
  if (btn) btn.disabled = true;
  try {
    const r = await post('/api/proposal', { id: x.id, action: 'promote' });
    await say(r.written ? 'Promoted' : 'Not promoted', r.manual || ('written to ' + r.written));
  } catch (e) { await say('Refused', e.message); }
  loadProposals(); loadState();
}

async function repairProposal(x, btn) {
  if (btn) btn.disabled = true;
  try {
    await post('/api/proposal', { id: x.id, action: 'repair' });
    await say('Repairing ' + x.defect.tool, 'A run is reading the handler now. Watch it in Chat — the patch applies only if the build and the whole test suite pass.');
    go('run');
  } catch (e) {
    if (btn) btn.disabled = false;
    await say('Could not start the repair', e.message);
  }
}

function buildProposalDetail(host, x, actionable) {
  host.dataset.built = '1';
  host.appendChild(st(el('p', 'sm', x.rationale), 'margin:14px 0 0;color:var(--ink-2);text-wrap:pretty'));

  // Why automation left it alone. Without this a blocked proposal looked identical to one
  // nobody had got to yet, and the difference is the whole reason it is still sitting here.
  if (x.blockedBecause) {
    const why = st(el('div'), 'margin:12px 0 0;padding:10px 13px;border-radius:11px;background:var(--surface);border-left:3px solid var(--warn)');
    why.appendChild(st(el('p', 'xs', 'not promoted automatically'), 'margin:0;color:var(--ink-3);font-weight:600'));
    why.appendChild(st(el('p', 'sm'), 'margin:4px 0 0;color:var(--ink-2);text-wrap:pretty')).textContent = x.blockedBecause.reason;
    host.appendChild(why);
  }

  // What happens if you press the button, per kind. The old text said a tool never promotes
  // itself at any level, which stopped being true at ADR-0011 and was the most load-bearing
  // sentence on the page.
  const note =
    x.defect
      ? 'A tool that keeps failing the same way. Repairing it starts a run that reads the handler and proposes a patch — applied only if the build and the whole test suite pass, reverted otherwise.'
      : x.patch
        ? 'A repair to an existing tool. Applied only after the build and the entire test suite pass; reverted on either failure.'
        : x.implementation
          ? 'Carries a working handler' + (x.ephemeral ? ', built for one conversation and kept only so you can adopt it deliberately.' : '. Promoting installs it, under the permissions it declared.')
          : x.kind === 'tool'
            ? 'Describes a tool but carries no handler, so promotion can only record the contract. build_tool writes one that installs.'
            : '';
  if (note) host.appendChild(el('p', 'xs callout warn')).textContent = note;

  const doc = st(el('div', 'md'), 'margin:12px 0 0;background:var(--surface);border-radius:10px;padding:13px 16px;overflow:auto;max-height:340px');
  if (x.html) doc.innerHTML = x.html;
  else doc.appendChild(st(el('pre', 'mono xs'), 'margin:0;white-space:pre-wrap')).textContent = x.content;
  host.appendChild(doc);

  if (!actionable) return;
  const row = st(el('div'), 'display:flex;flex-wrap:wrap;gap:8px;margin-top:14px');
  const prom = el('button', 'btn1 btnsm', 'Promote');
  prom.onclick = () => promoteProposal(x, prom);
  if (x.defect) {
    const fix = el('button', 'btn1 btnsm', 'Attempt a repair');
    fix.title = 'Start a run that reads the handler and proposes a patch';
    fix.onclick = () => repairProposal(x, fix);
    row.appendChild(fix);
  }

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
  sk.appendChild(el('p', 'xs note', 'Versioned playbooks. The header is contract, the prose is what the model reads.'));
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
  ru.appendChild(el('p', 'xs note', 'Each declares its enforcement strength, and must name the code that holds it.'));
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
  to.appendChild(el('p', 'xs note', 'The entire action surface. Everything passes one executor.'));

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
  mc.appendChild(el('p', 'xs note', 'Set these in config.json under "mcpServers". A server is a process we did not write, so anything unmarked is treated as able to change things.'));
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
