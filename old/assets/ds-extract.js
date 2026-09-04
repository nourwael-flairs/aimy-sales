/* ═══════════════════════════════════════════════════════════════════════
   ds-extract.js — rebuild aimy-ds.css and aimy-ds.js from the design system.

       node assets/ds-extract.js

   AiMY Knowledge v2 extracted these two files by hand, wrote the source
   line ranges into a provenance header, and asked the next person to
   drift-check against them. Nobody did: Knowledge sits on `fef41de` and the
   design system has moved 275 lines since, closing three of the gaps
   Knowledge itself reported. A manual step that has to be repeated is a
   manual step that will not be.

   So the extraction is a script. It selects by BANNER SECTION TITLE rather
   than by line number, because line numbers move on every design-system
   commit and titles do not, and it fails loudly if a title it expects has
   gone — a silent miss is how a product loses a component and finds out on
   screen.

   ── What is dropped, and why it is a short list ──────────────────────────
   Documentation-site chrome only: the page's own topbar, shell, sidebar,
   section furniture, its swatch/copy UI, its toast, and quick-find. Every
   component section is kept, including the ones whose banners say DEMO.

   NEVER DROP BY PREFIX. `.ds-tabs`, `.ds-switch`, `.ds-choice`, `.ds-range`,
   `.ds-progress`, `.ds-field`, `.ds-textarea`, `.ds-kbd` and `.ds-divider`
   are real components; a `.ds-` prefix strip deletes nine of them.

   NEVER TRUST A BANNER NAME. `NAVIGATION DEMOS` holds `.avatar`,
   `.user-pill`, `.tab`, `.tabs-strip` and `.nav-item` — five documented
   components. `FILTER TRAY DEMO` holds the filter-tray chip behaviour the
   float bar needs. The design system already carries one scar from this
   (see its COPY UI banner, where `.copy-btn` had to be moved out after a
   product dropped the section and the field broke); these are the second
   and third instances.
   ═══════════════════════════════════════════════════════════════════════ */
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const here = path.join(__dirname);
const DS_DIR = path.resolve(here, '../../design-system');
const DS = path.join(DS_DIR, 'index.html');

if (!fs.existsSync(DS)) {
  console.error(`Design system not found at ${DS}`);
  console.error('It is a dev-time dependency and is not vendored into this repo.');
  process.exit(1);
}

let commit = 'unknown';
try {
  commit = execFileSync('git', ['-C', DS_DIR, 'rev-parse', '--short', 'HEAD'], {
    encoding: 'utf8',
  }).trim();
} catch (e) {
  /* not a git checkout — the header will say so rather than claim a commit */
}

/* The whole ecosystem is CRLF — design system, Knowledge's extracted files,
   its product source. Split tolerantly, work in LF so the adaptation
   patterns below can be written the obvious way, and write CRLF back out so
   these files match every other file in the family. Matching on '\n  }\n'
   against unsplit CRLF source silently matches nothing, which reads exactly
   like a design system that was restructured. */
const EOL = '\r\n';
const src = fs.readFileSync(DS, 'utf8').split(/\r?\n/);

/* ─── Slice a <style> or <script> block into banner sections ─────────────
   A section runs from its banner to the line before the next banner. The
   title is every line between the two ═ rules, joined — banners here are
   multi-line and carry the reasoning, which is worth keeping in the
   selector so a title match is unambiguous.

   The page holds more than one block of each kind: two <script>s, of which
   the first is the eight-line pre-paint theme guard. So take the block with
   the most banners rather than the first one, which silently returned the
   guard and reported every expected section missing. */
function sections(open, close) {
  const blocks = [];
  for (let i = 0; i < src.length; i++) {
    if (!new RegExp(`^\\s*${open}\\s*$`).test(src[i])) continue;
    const e = src.findIndex((l, j) => j > i && new RegExp(`^\\s*${close}\\s*$`).test(l));
    if (e < 0) break;

    const marks = [];
    for (let k = i + 1; k < e; k++) {
      if (/^\s*\/\* ═+\s*$/.test(src[k])) {
        const title = [];
        let j = k + 1;
        while (j < e && !/^\s*═+ \*\/\s*$/.test(src[j])) title.push(src[j].trim()), j++;
        marks.push({ at: k, title: title.join(' ') });
        k = j;
      }
    }
    blocks.push({ start: i, end: e, marks });
    i = e;
  }
  if (!blocks.length) throw new Error(`Could not find ${open} … ${close}`);

  const b = blocks.reduce((a, c) => (c.marks.length > a.marks.length ? c : a));
  return b.marks.map((m, i) => ({
    title: m.title,
    /* first section also owns whatever preceded it — the reset lives there */
    from: i === 0 ? b.start + 1 : m.at,
    to: i + 1 < b.marks.length ? b.marks[i + 1].at - 1 : b.end - 1,
  }));
}

/* Drop a section by the opening words of its banner. Every one of these is
   this page's own furniture and has no product meaning. */
function drop(list, titles) {
  const kept = [];
  const seen = new Set();
  for (const sec of list) {
    const hit = titles.find((t) => sec.title.startsWith(t));
    if (hit) seen.add(hit);
    else kept.push(sec);
  }
  const missing = titles.filter((t) => !seen.has(t));
  if (missing.length) {
    console.error('Expected sections not found in the design system:');
    missing.forEach((t) => console.error(`  · ${t}`));
    console.error('The design system was restructured. Re-read it before trusting this output.');
    process.exit(1);
  }
  return kept;
}

const text = (sec) => src.slice(sec.from, sec.to + 1).join('\n');

/* ═══════════════════════════════════════════════
   CSS
═══════════════════════════════════════════════ */
const cssAll = sections('<style>', '</style>');
const cssKept = drop(cssAll, [
  'TOPBAR',
  'SHELL LAYOUT',
  'SIDEBAR',
  'MAIN CONTENT',
  'SECTION STRUCTURE',
  'COPY UI — documentation chrome only',
  'TOAST NOTIFICATION',
  'QUICK FIND MODAL',
]);

/* `.ds-theme-toggle` is defined under TOPBAR but it is product chrome, not
   documentation: every AiMY surface carries the theme toggle. Lift just its
   rules out of the section being dropped rather than keeping the section. */
const topbar = cssAll.find((s) => s.title.startsWith('TOPBAR'));
const themeToggle = [];
{
  const lines = src.slice(topbar.from, topbar.to + 1);
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*\.ds-theme-toggle/.test(lines[i])) {
      let j = i;
      while (j < lines.length && !/}\s*$/.test(lines[j])) j++;
      themeToggle.push(lines.slice(i, j + 1).join('\n'));
      i = j;
    }
  }
}
if (!themeToggle.length) {
  console.error('.ds-theme-toggle was not found under TOPBAR. It moved — find it before shipping.');
  process.exit(1);
}

/* ─── Prune light-theme overrides for chrome we just dropped ─────────────
   The LIGHT THEME section is a flat list of token and selector overrides,
   and some of them target documentation chrome — `.ds-copy-btn`,
   `.ds-nav-link`, `.ds-topbar-sep`. Their base rules are gone, so these are
   dead: they will never match anything the product renders. `css-audit.js`
   cannot find them either, because it checks the other direction (a class
   the product renders must resolve to a rule), so nothing else would.

   Conservative on purpose: a class is chrome only if EVERY definition of it
   lives in a dropped section, and only whole single-line rules are removed.
   What went is printed rather than silently disappeared. */
const classesIn = (secs) => {
  const set = new Set();
  for (const sec of secs)
    for (const m of text(sec).matchAll(/(?:^|[\s,>+~(])\.(-?[A-Za-z_][A-Za-z0-9_-]*)/g))
      set.add(m[1]);
  return set;
};
const dropped = cssAll.filter((s) => !cssKept.includes(s));
/* The light-theme section is where the dead overrides live, so it cannot
   also be the evidence that a class is still alive — counting it made every
   class chrome-free and pruned nothing. Judge liveness by the real
   component sections only, plus whatever is lifted out of a dropped section
   after the fact: TOPBAR is dropped but `.ds-theme-toggle` survives it, and
   its light overrides have to survive with it. */
const LIFTED = ['ds-theme-toggle', 'icon-sun', 'icon-moon'];
const live = classesIn(cssKept.filter((s) => !s.title.startsWith('LIGHT THEME')));
const chrome = [...classesIn(dropped)].filter((c) => !live.has(c) && !LIFTED.includes(c));

const pruned = [];
for (const sec of cssKept) {
  const lines = src.slice(sec.from, sec.to + 1);
  for (let i = 0; i < lines.length; i++) {
    const sel = lines[i].split('{')[0];
    if (!/\{.*\}\s*$/.test(lines[i])) continue;
    if (!chrome.some((c) => new RegExp(`\\.${c}(?![A-Za-z0-9_-])`).test(sel))) continue;
    pruned.push(lines[i].trim());
    lines[i] = null;
  }
  sec.pruned = lines.filter((l) => l !== null);
}

const cssHeader = `/* ═══════════════════════════════════════════════════════════════════════
   aimy-ds.css — AiMY Design System, product-consumable layer
   ───────────────────────────────────────────────────────────────────────
   EXTRACTED, NOT AUTHORED. Do not edit this file to change a component —
   edit the design system and re-extract, or the product forks the system.

       node assets/ds-extract.js

   Source   design-system/index.html <style> block, commit ${commit}
   Kept     tokens · light-theme overrides · base · every component section,
            including the .ds-prefixed components (.ds-tabs, .ds-switch,
            .ds-choice, .ds-range, .ds-progress, .ds-field, .ds-textarea,
            .ds-kbd, .ds-divider), the AiMY Canvas, the Doctrine Primitives
            and the Knowledge v2 Primitives, plus the reduced-motion block.
            NAVIGATION DEMOS is kept: despite the banner it holds .avatar,
            .user-pill, .tab, .tabs-strip and .nav-item.
   Dropped  documentation-site chrome only — the page's topbar, shell,
            sidebar, main, section furniture, its swatch/copy UI, #ds-toast,
            and the quick-find modal.
   Lifted   .ds-theme-toggle out of the dropped TOPBAR section: it is
            product chrome and every AiMY surface carries it.
   Pruned   light-theme overrides for dropped chrome. Their base rules are
            gone, so they can never match; css-audit.js cannot see them
            because it checks the other direction.

   The drop list is by banner section, never by ".ds-" prefix: nine real
   components carry that prefix and a prefix strip deletes them.
   ═══════════════════════════════════════════════════════════════════════ */
`;

const css =
  cssHeader +
  cssKept.map((s) => s.pruned.join('\n')).join('\n\n') +
  '\n\n    /* ═══════════════════════════════════════════════\n' +
  '       THEME TOGGLE — lifted from the design system\'s TOPBAR section,\n' +
  '       which is otherwise documentation chrome and is dropped.\n' +
  '    ═══════════════════════════════════════════════ */\n' +
  themeToggle.join('\n') +
  '\n';

fs.writeFileSync(path.join(here, 'aimy-ds.css'), css.split('\n').join(EOL));

/* ═══════════════════════════════════════════════
   JS
═══════════════════════════════════════════════ */
const jsAll = sections('<script>', '</script>');

const jsKept = drop(jsAll, [
  'COPY ENGINE',
  'ACTIVE NAV',
  'QUICK FIND',
  'BCARD EXTENDED DEMOS',
  'FRICTION FEED DEMO',
  'KPI FEED DEMO',
  'CANVAS OVERLAY DEMO',
  'DISPUTES DEMOS',
  'SCORECARD DEMOS',
]);

let js = jsKept.map(text).join('\n\n');

/* ─── Three adaptations, stated rather than smuggled in ──────────────────

   1. The delegated router dispatches [data-copy-color] and [data-copy-code]
      into copyColor()/copyCode(), which live in the dropped COPY ENGINE.
      Left in, the first click on anything throws a ReferenceError and every
      later branch in that listener dies with it.
   2. It also dispatches the canvas-overlay demo branches into demoAddMsg()
      and demoSendOverlay(), dropped for the same reason.
   3. [data-submit-on-enter] called demoSendOverlay() directly. It now
      dispatches a bubbling 'aimy:submit' CustomEvent, so the product owns
      what submitting means without this file knowing.                      */

const before = js;
js = js.replace(
  /\n  \/\* ── Copy engine \(documentation\) ── \*\/\n\s*if \(\(el = t\.closest\('\[data-copy-color\]'\)\)\) \{[\s\S]*?\n  \}\n\s*if \(\(el = t\.closest\('\[data-copy-code\]'\)\)\) \{[\s\S]*?\n  \}\n/,
  '\n  /* Copy engine branches dropped with the COPY ENGINE section. */\n'
);
js = js.replace(
  /\n  \/\* ── Canvas overlay demos ── \*\/[\s\S]*?demoSendOverlay\(\);\s*return; }\n/,
  '\n  /* Canvas overlay demo branches dropped with their section. */\n'
);
js = js.replace(/\n(\s*)demoSendOverlay\(\);/g, (m, indent) =>
  `\n${indent}ta.dispatchEvent(new CustomEvent('aimy:submit', { bubbles: true, detail: { value: ta.value } }));`
);

for (const [what, re] of [
  ['copy-engine branches', /data-copy-color/],
  ['canvas-overlay demo branches', /data-demo-add-msg/],
  ['demoSendOverlay calls', /demoSendOverlay\(/],
]) {
  if (re.test(js)) {
    console.error(`Adaptation failed: ${what} still present. The router was restructured.`);
    process.exit(1);
  }
}
if (js === before) {
  console.error('No adaptation applied — the delegated router did not match. Re-read it.');
  process.exit(1);
}

const jsHeader = `/* ═══════════════════════════════════════════════════════════════════════
   aimy-ds.js — AiMY Design System behaviour, product-consumable layer
   ───────────────────────────────────────────────────────────────────────
   EXTRACTED, NOT AUTHORED.  Regenerate with:  node assets/ds-extract.js

   Source   design-system/index.html <script> block, commit ${commit}
   Kept     theme toggle · tab switcher · outside-click/Escape closers ·
            filter-tray chips · the .copy-field handler · the delegated
            data-* click router · the Enter-to-submit handler · the whole
            .v2-dropdown controller (keyboard model, typeahead, ARIA
            normalisation, hidden input).
   Dropped  the copy engine, sidebar scrollspy, quick-find, and every demo*
            function — documentation-page behaviour with no product use.

   THREE ADAPTATIONS, applied by the extractor and stated here:
     1 · the router's [data-copy-color] / [data-copy-code] branches are
         removed — they call into the dropped copy engine, and left in they
         throw on the first click anywhere and kill every branch after them.
     2 · the canvas-overlay demo branches are removed for the same reason.
     3 · [data-submit-on-enter] dispatched demoSendOverlay(); it now
         dispatches a bubbling 'aimy:submit' CustomEvent, so the product
         owns what submitting means without this file knowing.

   The pre-paint theme script is NOT here — it must run before first paint
   and is inlined in each page's <head>.
   ═══════════════════════════════════════════════════════════════════════ */

`;

fs.writeFileSync(path.join(here, 'aimy-ds.js'), (jsHeader + js + '\n').split('\n').join(EOL));

const kb = (p) => (fs.statSync(path.join(here, p)).size / 1024).toFixed(0);
console.log(`design-system @ ${commit}`);
console.log(`  aimy-ds.css  ${cssKept.length}/${cssAll.length} sections  ${kb('aimy-ds.css')}KB`);
console.log(`  aimy-ds.js   ${jsKept.length}/${jsAll.length} sections  ${kb('aimy-ds.js')}KB`);
if (pruned.length) {
  console.log(`\n  pruned ${pruned.length} dead light-theme override(s) for dropped chrome:`);
  pruned.forEach((l) => console.log(`    ${l.slice(0, 96)}`));
}
