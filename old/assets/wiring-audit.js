'use strict';
/* ═══════════════════════════════════════════════════════════════════════
   wiring-audit.js — every control this product draws is connected

   WHY THIS EXISTS. `data-peek` was rendered in two places and never had a
   handler. It shipped, survived a review, and was found only when an
   unrelated change made the dead control start doing the WRONG thing loudly
   instead of nothing quietly. Nothing caught it, because a dead control
   throws nothing: the markup is valid, the class resolves, the page renders,
   and the button simply does not work.

   That is the same shape as the two permission defects `tier-audit.js` was
   written for, and the same shape as the empty-value dropdown. The pattern
   across all of them: **the failure is silence**. So the check is mechanical.

   Two directions, and both matter:

     · A `data-x` rendered with no `closest('[data-x]')` is a DEAD CONTROL —
       a button that looks like a button and is not one.
     · A `closest('[data-x]')` matching nothing rendered is DEAD CODE — a
       handler for a control that no longer exists, which is how a chain
       accumulates branches nobody can reach or test.

   Run:  node assets/wiring-audit.js
═══════════════════════════════════════════════════════════════════════ */

const fs = require('fs');
const path = require('path');

const rawSrc = fs.readFileSync(path.join(__dirname, 'sales.js'), 'utf8');
const rawHtml = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

const src = decomment(rawSrc);
/* `<!-- … -->` blanked the same way, and for the same reason. */
const html = rawHtml.replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, ' '));

/* Attributes we hand to the browser rather than to our own chain. `data-
   effect` is a render target, the trust/commit ones are read by the library
   or by `closest()` on an ancestor rather than matched by name. */
const NOT_OURS = new Set([
  'data-theme', 'data-trust-state', 'data-value', 'data-effect', 'data-client',
]);

/* ── METADATA IS NOT A CONTROL, and it gets a rule rather than a list ──

   v3 introduces a family of attributes that carry CONTEXT rather than
   behaviour: `data-aimy-ask` (the question handed to the canvas),
   `data-aimy-topic`, `data-aimy-item` (which card an outcome writes back
   to), `data-entry-mode` and `data-work-state`. None of them is clickable.
   `data-aimy-ask` and `data-entry-mode` ride on a button whose actual
   handler is `data-exit`; `data-aimy-item` and `data-work-state` sit on
   wrappers and spans that nothing clicks at all.

   The first instinct was to add all five to NOT_OURS. That list is
   hand-maintained and this file's own argument against hand-maintained
   things applies: it rots the moment somebody adds a sixth, and the rot is
   silent — a genuinely dead control named `data-aimy-something` would be
   waved through.

   A closed family with a naming rule does not rot, and it lets these be
   checked AS METADATA instead of not checked at all. See the two positive
   checks near the bottom of this file, which is where they moved to. */
const isMeta = (a) => /^data-aimy-/.test(a) || a === 'data-work-state' || a === 'data-entry-mode';

const camel = (s) => s.replace(/-([a-z])/g, (_, c) => c.toUpperCase());

/* PROSE IS NOT MARKUP.

   This check flagged two DEAD CONTROLs that did not exist — it had read the
   comment recording that they had been DELETED. A file that explains why a
   control was removed would fail the audit for removing it, which turns the
   check into a reason not to write the explanation down.

   So comments are stripped before scanning. Block state is carried across
   lines because every comment in this codebase is a `/* … *\/` paragraph, and
   line comments are only honoured at the start of a trimmed line so that a
   `https://` inside a string is not mistaken for one. Positions are preserved
   by blanking rather than removing, so reported line numbers stay true. */
function decomment(src) {
  let inBlock = false;
  return src.split(/\r?\n/).map((line) => {
    let out = '', i = 0;
    while (i < line.length) {
      if (inBlock) {
        const end = line.indexOf('*/', i);
        if (end === -1) { out += ' '.repeat(line.length - i); i = line.length; }
        else { out += ' '.repeat(end + 2 - i); i = end + 2; inBlock = false; }
        continue;
      }
      const open = line.indexOf('/*', i);
      const lineC = out.trim() === '' ? line.indexOf('//', i) : -1;
      if (lineC !== -1 && (open === -1 || lineC < open) && line.slice(0, lineC).trim() === '') {
        out += ' '.repeat(line.length - i); i = line.length; continue;
      }
      if (open === -1) { out += line.slice(i); i = line.length; continue; }
      out += line.slice(i, open); i = open; inBlock = true;
    }
    return out;
  }).join('\n');
}

/* ── What the product draws ── */
const rendered = new Map();               // attr -> first line it appears on
const lines = src.split(/\r?\n/);
lines.forEach((line, i) => {
  const m = line.match(/\bdata-[a-z][a-z0-9-]*/g);
  if (!m) return;
  m.forEach((a) => {
    if (NOT_OURS.has(a) || isMeta(a)) return;
    /* Skip the ones inside a `closest()` — those are the handler side. */
    if (new RegExp(`closest\\(\\s*['"\`][^'"\`]*${a}`).test(line)) return;
    if (!rendered.has(a)) rendered.set(a, i + 1);
  });
});
/* index.html draws some too — the bell, the theme toggle, the prototype panel. */
(html.match(/\bdata-[a-z][a-z0-9-]*/g) || []).forEach((a) => {
  if (!NOT_OURS.has(a) && !isMeta(a) && !rendered.has(a)) rendered.set(a, 0);
});

/* ── What listens for them ──
   Our chain AND the library, because some of what we draw is the library's
   contract rather than ours: `data-submit-on-enter` is consumed entirely by
   `aimy-ds.js`, and a check that only read our file would call it dead. */
const ds = decomment(fs.readFileSync(path.join(__dirname, 'aimy-ds.js'), 'utf8'));
const both = src + '\n' + ds;
const handled = new Set();

/* Any attribute selector, whether it matches the bare attribute or a value:
   `[data-x]`, `[data-x="y"]`, `[data-x^="y"]`. The value form is how a
   control is found again to be repainted, which is a use like any other. */
(both.match(/\[data-[a-z0-9-]+[\]=^~|*$]/g) || [])
  .forEach((b) => handled.add(b.slice(1).replace(/[\]=^~|*$]$/, '')));

/* Both ways of reading one: `el.dataset.x`, and `'x' in el.dataset` — the
   second is how a handler tests for an attribute that carries no value. */
const keys = new Set();
(both.match(/\.dataset\.([a-zA-Z0-9]+)/g) || []).forEach((d) => keys.add(d.split('.')[2]));
(both.match(/['"]([a-zA-Z0-9]+)['"]\s+in\s+[\w.]*dataset\b/g) || [])
  .forEach((d) => keys.add(d.match(/['"]([a-zA-Z0-9]+)['"]/)[1]));
rendered.forEach((_, a) => { if (keys.has(camel(a.slice(5)))) handled.add(a); });

/* ── The two directions ──
   Dead controls are checked against BOTH files, because the library handles
   some of what we draw. Dead handlers are checked against OURS only: the
   library ships listeners for every component in its catalogue — tabs,
   steppers, copy buttons, password toggles — and this product uses a
   fraction of them. An unused library listener is a library that is bigger
   than one consumer, not a defect in the consumer. */
const ourHandled = new Set();
(src.match(/\[data-[a-z0-9-]+[\]=^~|*$]/g) || [])
  .forEach((b) => ourHandled.add(b.slice(1).replace(/[\]=^~|*$]$/, '')));
const ourKeys = new Set();
(src.match(/\.dataset\.([a-zA-Z0-9]+)/g) || []).forEach((d) => ourKeys.add(d.split('.')[2]));
(src.match(/['"]([a-zA-Z0-9]+)['"]\s+in\s+[\w.]*dataset\b/g) || [])
  .forEach((d) => ourKeys.add(d.match(/['"]([a-zA-Z0-9]+)['"]/)[1]));

const dead = [...rendered.keys()].filter((a) => !handled.has(a)).sort();
const orphanHandlers = [...ourHandled]
  .filter((a) => !rendered.has(a) && !ourKeys.has(camel(a.slice(5))) && !NOT_OURS.has(a))
  .sort();

const problems = [];
dead.forEach((a) => {
  const where = rendered.get(a);
  problems.push(`DEAD CONTROL   ${a}  — drawn ${where ? `at sales.js:${where}` : 'in index.html'}, no handler matches it`);
});
orphanHandlers.forEach((a) => {
  problems.push(`DEAD HANDLER   ${a}  — the chain listens for it, nothing draws it`);
});

/* ── A state marker wearing a handler's name ──
   TWICE NOW. `<body data-page="workbench">` made every unhandled click
   navigate to `?page=workbench`; then `stage.dataset.camp = k` made every
   click inside a campaign page resolve to "open this campaign" before
   reaching its own control, so Add contacts silently did nothing.

   Both are the same mistake: `el.dataset.x = v` written as a marker, where
   `[data-x]` is also something the click chain matches. `closest()` walks
   upward, so a marker on an ancestor captures every control beneath it.

   The rule: if the chain listens for `[data-x]`, nothing may assign
   `dataset.x` imperatively — markers get their own names. */

/* Only `closest()` matters. `querySelector('[data-effect]')` finds a render
   target and walks nothing; `closest()` walks ANCESTORS, which is what turns
   a marker into a trap for every control beneath it. And an assignment is
   `=` not `==` — `+b.dataset.when === n` is a comparison, and counting it
   flagged a control that was working correctly. */
const clickMatched = new Set();
(src.match(/closest\(\s*['"`][^'"`]*\[data-[a-z0-9-]+\][^'"`]*['"`]/g) || [])
  .forEach((c) => (c.match(/\[data-[a-z0-9-]+\]/g) || []).forEach((b) => clickMatched.add(b.slice(1, -1))));

const assigned = new Set();
(src.match(/\.dataset\.([a-zA-Z0-9]+)\s*=(?!=)/g) || [])
  .forEach((m) => assigned.add(m.match(/\.dataset\.([a-zA-Z0-9]+)/)[1]));
assigned.forEach((key) => {
  const attr = 'data-' + key.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase());
  if (clickMatched.has(attr)) {
    problems.push(`MARKER COLLIDES  dataset.${key}  — the chain does closest('[${attr}]'), so this marker captures every click beneath the element it is set on`);
  }
});

/* ── A live handler given a dead argument ──
   `data-quick="mine=1"` sat in the float tray for four passes doing nothing.
   The attribute was wired, the handler ran, the click was consumed — and
   `mine` had been removed as a state key back when `?scope=` replaced it, so
   `go({ mine: ['1'] })` wrote to a key `qs()` does not serialise and `parse()`
   does not read. Silent, again: no error, no dead-control finding, because
   the CONTROL was connected. Only its argument was not.

   Every `data-quick` / `data-quick2` names state keys, and every one of them
   must be in MULTI or SCALAR. */
const stateKeys = new Set();
['MULTI', 'SCALAR'].forEach((name) => {
  const at = src.indexOf('const ' + name + ' = [');
  if (at < 0) return;
  const body = src.slice(at, src.indexOf('];', at));
  (body.match(/'([a-z0-9]+)'/g) || []).forEach((k) => stateKeys.add(k.slice(1, -1)));
});
if (stateKeys.size) {
  [...src.matchAll(/data-quick2?="([^"$]+)"/g), ...html.matchAll(/data-quick2?="([^"]+)"/g)]
    .forEach((m) => {
      m[1].split('&').forEach((pair) => {
        const key = pair.split('=')[0];
        if (key && !stateKeys.has(key)) {
          problems.push(`DEAD ARGUMENT  data-quick="${m[1]}"  — "${key}" is not a state key, so this control is consumed and does nothing`);
        }
      });
    });
}

/* ── A LIVE HANDLER, A REAL KEY, AND A SURFACE THAT EXISTS ──

   The check above proves the KEY is real. It cannot prove the VALUE is, and
   `on` is the one key where a wrong value is invisible: `parse()` stores
   whatever it is given, every `onX()` test returns false, and the surface
   falls through to whatever was showing before. So `data-quick="…&on=accounts"`
   navigated, changed the URL, repainted — and left you where you already
   were. Three controls shipped like that: two in the campaign page and one
   in the task sheet, all of them writing surfaces that were never values.

   The surfaces are declared as `const onX = () => S.on === '…'`, so the list
   is read from the code rather than restated here — a surface added without
   one of those is not a surface. The empty string is legal: it means the
   default, and `qs()` omits it. */
const surfaces = new Set(['']);
[...src.matchAll(/S\.on === '([a-z]+)'/g)].forEach((m) => surfaces.add(m[1]));

/* NOT SCANNED THROUGH THE ATTRIBUTE. The check above matches
   `data-quick="([^"$]+)"` — no `$` — because a key it cannot read whole is a
   key it should not guess at. Almost every query in this file is built as
   `data-quick="${esc('on=leads&…')}"`, so that guard skips the ones that
   matter: the first cut of this check passed while three broken surfaces sat
   in the file, which is the "bad test" this project has already been caught
   by once.

   A query string is recognisable wherever it is written, so the scan is for
   the VALUE rather than for the attribute: `on=` opening a query (`?on=`,
   `'on=`) or joined into one (`&on=`). That reaches the literal attributes,
   the `esc(…)` ones, and the query strings assembled in helpers. */
if (surfaces.size > 1) {
  [...src.matchAll(/[?&'"`]on=([a-z]*)/g), ...html.matchAll(/[?&"]on=([a-z]*)/g)]
    .forEach((m) => {
      if (!surfaces.has(m[1])) {
        problems.push(`NO SUCH SURFACE  "on=${m[1]}" is not a surface — a control writing it repaints whatever was already showing`);
      }
    });
}

/* ── EVERY PAGE SURFACE HAS EXACTLY ONE WAY BACK ──

   Two ways out sitting level with each other is a defect this codebase has
   already fixed twice: the campaign sheet carried a `.s-back` AND a
   `.modal-close`, and the record carried a Back beside an Archive that also
   left the page. A second exit does not add a way out — it makes you choose
   between two, and the choice has no right answer because they do the same
   thing.

   Checked per RENDER FUNCTION rather than per file: `recordPage`, `campPage`
   and `taskSheet` each return one page, and one page gets one Back. */
const BACK_MARK = /class="s-back"|class="modal-close"/g;
['recordPage', 'campPage', 'taskSheet', 'buildPage'].forEach((fn) => {
  const at = src.indexOf('function ' + fn + '(');
  if (at < 0) { problems.push(`NO SUCH PAGE   ${fn}() is gone — the Back check cannot see it`); return; }
  /* To the next top-level `function` at two-space indent, which is how every
     render function in this file is declared. */
  const end = src.indexOf('\n  function ', at + 1);
  const body = src.slice(at, end < 0 ? src.length : end);
  const backs = (body.match(BACK_MARK) || []).length;
  if (backs === 0) problems.push(`NO WAY OUT     ${fn}() renders no Back — the only exit is the browser's`);
  if (backs > 1) problems.push(`TWO WAYS OUT   ${fn}() renders ${backs} exits at page level — one page, one Back`);
});

/* ── The metadata family, checked as metadata ──

   These are not click targets, so "does a handler match it" is the wrong
   question. The right ones are about the CONTRACT the doctrine's context
   handoff (§4) sets: context is passed, never reconstructed.

   AiMY QA's gap register records the failure mode for the second of these
   twice — a card rendered without `data-aimy-item` means the write-back
   finds no element to walk up from, so accepting the thing in the canvas
   SILENTLY DOES NOTHING. Same shape as every other check in this file. */

/* 1 · An entry mode must be one of the four the doctrine declares. A typo
       here renders a button with no treatment and no routing, which looks
       like a plain link and behaves like one. */
const MODES = new Set(['direct', 'investigate', 'prompt', 'review']);
[...src.matchAll(/data-entry-mode="([^"]*)"/g)].forEach((m) => {
  const v = m[1];
  if (v.includes('${')) return;            /* computed — cannot be read here */
  if (!MODES.has(v)) {
    problems.push(`BAD ENTRY MODE  data-entry-mode="${v}"  — not one of ${[...MODES].join(' · ')}`);
  }
});

/* 2 · A staged question must actually contain one. An empty `data-aimy-ask`
       hands the canvas nothing and makes the user retype what the surface
       already knew, which is the exact thing the attribute exists to stop. */
[...src.matchAll(/data-aimy-ask="([^"]*)"/g)].forEach((m) => {
  const v = m[1].trim();
  if (!v) problems.push('EMPTY ASK      data-aimy-ask=""  — the canvas would open with no question in it');
});

/* 2b · AND SOMETHING HAS TO READ IT.

       THE EXEMPTION AT THE TOP OF THIS FILE WAS A HOLE, AND NINETEEN
       CONTROLS FELL THROUGH IT. `isMeta()` waves the whole `data-aimy-*`
       family past the dead-control scan on one stated assumption:
       "`data-aimy-ask` and `data-entry-mode` ride on a button whose actual
       handler is `data-exit`". That is true of `insightBlock` and of nothing
       else. Every campaign card's primary action, the campaign page's own
       primary, all four home-page opener actions, all five initiative
       alternates and both trail tools carried a complete, well-written
       question and NO HANDLER AT ALL. Clicking them did nothing — no error,
       no navigation, no canvas. The silence this whole file exists for.

       The exemption is right in kind and wrong in scope: an ask IS metadata
       when it rides on a live control, and IS the control when it does not.
       So the question is not "is this attribute handled" but "does the
       ELEMENT carrying it do anything".

       AND THE RULE OUTLIVES THE FIX. Once `[data-aimy-ask]` has a handler,
       "is it read" can never fail again — a check that cannot fail is worse
       than no check, because it reads like cover. What it becomes is the
       question the fix raised: that handler STAGES A QUESTION. It types the
       sentence into the box and waits for you to press send, which is the
       doctrine's `em-prompt` and is not `em-review` or `em-investigate` —
       those two mean AiMY has already done the work and is showing it.

       So: an element whose only live attribute is the ask stages a question,
       and must say so. A button declaring `review` over a handler that
       stages is a mode that lies about what pressing it does — and that lie
       is exactly what let nineteen navigations be written as questions
       nobody had to answer.

       A COMPUTED MODE FAILS TOO. `data-entry-mode="${said.mode}"` cannot be
       read here, so it cannot be shown to be `prompt`; a staged question is
       the one case where the mode is knowable at author time, so leaving it
       computed is leaving it unverifiable.

       Read per-tag rather than per-line, because these buttons are four
       lines of template each. `tagAround` walks back to the tag's `<` and
       forward to its own `>`, tracking `${…}` depth so an arrow function
       inside an interpolation does not end the tag early. */
function tagAround(text, at) {
  let open = text.lastIndexOf('<', at);
  if (open < 0) return '';
  let i = open, depth = 0;
  while (i < text.length) {
    if (text[i] === '$' && text[i + 1] === '{') { depth++; i += 2; continue; }
    if (text[i] === '}' && depth) { depth--; i++; continue; }
    if (text[i] === '>' && !depth) return text.slice(open, i + 1);
    i++;
  }
  return text.slice(open, at + 200);
}

[...src.matchAll(/data-aimy-ask=/g)].forEach((m) => {
  const tag = tagAround(src, m.index);
  const attrs = (tag.match(/\bdata-[a-z][a-z0-9-]*/g) || []).filter((a) => !isMeta(a));
  /* `handled`, not `rendered` — an attribute nothing listens for is already
     reported by the dead-control check above, and saying it twice would make
     one defect look like two. */
  if (attrs.some((a) => handled.has(a))) return;   /* it does something else */

  const line = src.slice(0, m.index).split('\n').length;
  /* The label is almost always `${esc(…)}`, so name the function that draws
     it instead — which is the thing somebody has to go and fix. */
  const before = src.slice(0, m.index);
  const fn = (before.match(/function\s+([A-Za-z0-9_$]+)\s*\(/g) || []).pop();
  const who = fn ? fn.replace(/function\s+/, '').replace(/\s*\($/, '') : '?';

  const mode = (tag.match(/data-entry-mode="([^"]*)"/) || [, ''])[1];
  if (mode === 'prompt') return;                   /* stages, and says so */
  problems.push(mode.includes('${')
    ? `UNVERIFIABLE MODE  ${who}()  sales.js:${line}  — its only action is to stage a question, so its mode must be the literal "prompt"; a computed one cannot be checked`
    : `MODE LIES      ${who}()  sales.js:${line}  — declares "${mode || 'nothing'}" but its only action is to stage a question, which is "prompt". Either give it a handler that does the work, or say what it does.`);
});

/* 3 · EVERY FLAG THAT OPENS A CONVERSATION HAS ONE COMPOSED.

       The markup cannot answer this. `data-entry-mode="${…}"` and the ask
       beside it are both computed from `TAX`, so a scan of the templates
       sees two holes and learns nothing — the first cut of this check
       skipped exactly the cases it was written for and passed while proving
       nothing, which is worse than not having it.

       The contract is in the DATA, so check the data: any obstacle or
       opportunity whose exit is `em-review` or `em-investigate` opens the
       canvas, and a canvas opened with no question is the user retyping
       what the surface already knew. `em-direct` completes in place and
       opens nothing, so it has nothing to hand over — the doctrine's own
       distinction (§3), not an exemption granted here. */
/* Keys of a `const NAME = { … }` map, at one indent level inside it. */
function mapKeys(name) {
  const out = new Set();
  const at = src.indexOf('const ' + name + ' = {');
  if (at < 0) return out;
  const body = src.slice(at, src.indexOf('\n  };', at));
  (body.match(/^\s{4}'?([a-z-]+)'?:/gm) || [])
    .forEach((k) => out.add(k.trim().replace(/[':]/g, '')));
  return out;
}

/* Rows of one TAX axis, as [key, entry-mode]. */
function axisRows(axis) {
  const at = src.indexOf('    ' + axis + ': [');
  if (at < 0) return [];
  const body = src.slice(at, src.indexOf('\n    ],', at));
  return [...body.matchAll(/\{\s*k:\s*'([a-z-]+)'[^}]*mode:\s*'(em-[a-z]+)'/g)]
    .map((m) => [m[1], m[2]]);
}

const askKeys = mapKeys('FLAG_ASK');
/* FLAG_SAY IS CHECKED TOO, AND IT WAS THE REAL HOLE.

   This check was written for FLAG_ASK and tested by deleting a key from
   FLAG_SAY — which passed, because nothing was looking at FLAG_SAY at all.
   The bad test found a missing check rather than a working one.

   It matters more than the ask does. `insightBlock` opens with
   `if (!ex || !FLAG_SAY[ex.k]) return ''`, so a flag with no sentence
   renders NOTHING: no insight, no action, no error — the card simply goes
   quiet about the one thing worth saying, on every record carrying that
   flag. Exactly the silence every other check in this file exists for. */
const sayKeys = mapKeys('FLAG_SAY');

['obstacle', 'opportunity'].forEach((axis) => {
  axisRows(axis).forEach(([k, mode]) => {
    if (!sayKeys.has(k)) {
      problems.push(`SILENT FLAG    ${axis} "${k}" has no FLAG_SAY entry — its insight block renders as nothing`);
    }
    if (mode === 'em-direct') return;
    if (!askKeys.has(k)) {
      problems.push(`UNPASSED CONTEXT  ${axis} "${k}" is ${mode} — it opens the canvas, and FLAG_ASK has no question for it`);
    }
  });
});

/* A `needs:` pointing at the wrong field would leave a confirm disabled
   forever, and this is NOT the place to catch it: the class it names exists
   elsewhere in the file, so a static check passes while the surface is
   broken. Proving it needs to know which fields are in WHICH commit's body,
   which is a runtime fact. `gateCommit` handles it instead, by refusing to
   trap the person — see `sales.js`. Recorded here so the next person does
   not add the check that cannot work. */

/* ══ EVERY QUESTION THIS PRODUCT ASKS ITSELF MUST BE ANSWERABLE ═══════════

   v6 proved those buttons had a handler. It could not prove the handler led
   anywhere, and it did not: all fourteen composed asks fell out of the
   router before `answer` was called, because `ASK_RE` demanded a trailing
   `?` and every one of them ends in a full stop. They navigated to a
   filtered list instead, and — since the staged text had already been
   cleared — the question vanished without being asked.

   That is the same failure the whole file exists for, one layer along: no
   error, no dead control, and nothing on screen wrong enough to report.

   SO THE CHECK RUNS THE REAL ROUTER. It loads `sales.js` the way
   `tier-audit` does and walks each composed question through the same
   regexes and the same `SHAPES` list the surface uses. A regex re-written
   here would agree with the router right up until one of them changed,
   which is the class of bug this is meant to catch. */
function loadForAsks() {
  const els = new Proxy({}, {
    get(t, k) {
      if (k === 'classList') return { add() {}, remove() {}, toggle() {}, contains: () => false };
      if (k === 'dataset') return {};
      if (k === 'style') return {};
      if (k === 'children') return [];
      if (k === 'innerHTML' || k === 'textContent' || k === 'value' || k === 'placeholder') return '';
      if (typeof k === 'symbol') return undefined;
      return () => els;
    },
    set() { return true; },
  });
  const doc = {
    addEventListener() {}, removeEventListener() {},
    querySelector: () => null, querySelectorAll: () => [],
    createElement: () => els, createEvent: () => els,
    documentElement: els, body: els, head: els,
  };
  const win = {
    document: doc,
    location: { search: '', pathname: '/', href: 'http://localhost/' },
    history: { pushState() {}, replaceState() {} },
    localStorage: { getItem: () => null, setItem() {} },
    addEventListener() {}, removeEventListener() {},
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    requestAnimationFrame: (fn) => fn(),
    getComputedStyle: () => ({}),
    CustomEvent: class { constructor(t, o) { this.type = t; Object.assign(this, o); } },
    KeyboardEvent: class {}, Event: class {}, URLSearchParams, console,
  };
  win.window = win; win.self = win;
  const keys = Object.keys(win);
  // eslint-disable-next-line no-new-func
  new Function(...keys, rawSrc)(...keys.map((k) => win[k]));
  return win.SALES;
}

try {
  const API = loadForAsks();

  /* ══ EVERY STAGE IS SOMEBODY'S ═════════════════════════════════════════

       The process this product draws is a relay: Marketing sets up, a BDR
       finds and fills in, Marketing writes, Sales reaches, a manager
       measures. A stage that declares no function is a step in that relay
       with nobody's name on it — and the failure is silent, because the
       strip renders identically whether the owner is busy or does not
       exist. v7 shipped five stages, none of which declared one, for a
       whole version.

       The second rule is the one with teeth on a live corpus: a stage
       holding leads whose crew slot is empty means work has stopped between
       two functions, and the product must SAY so rather than draw a count
       with no name under it. */
  if (API && API.CAMP_STAGE) {
    API.CAMP_STAGE.forEach((st) => {
      if (!st.fn) {
        problems.push(`UNOWNED STAGE  ${st.k} declares no function — nobody's move, so the relay has a step with no name on it`);
        return;
      }
      if (!API.FUNCTIONS[st.fn]) {
        problems.push(`NO SUCH FUNCTION  ${st.k} is owned by "${st.fn}", which is not one of the seven functions`);
      }
      if (!st.scope) problems.push(`UNSCOPED STAGE ${st.k} declares no scope — the strip cannot tell a campaign-level stage from a per-lead one`);
    });

    /* ══ A STALL MUST NOT BE SILENT ══════════════════════════════════════

         A stage holding leads whose crew slot is empty is work stopped
         between two functions — the commonest way a campaign goes quiet,
         and invisible by nature, since the count renders the same whether
         its owner is busy or does not exist.

         READ AS A VIEWER WHO OWNS NOTHING. The first cut asked the campaign
         OWNER, and missed every case: an owner who is on a crew gets their
         own stage as the headline, so the empty stage was never the one the
         sentence was about and the rule passed by looking somewhere else. A
         viewer on no crew always takes the fallback path, which is the one
         that has to name the gap. */
    const NOBODY = '__audit-viewer-on-no-crew__';
    (API.DB.camp || []).forEach((c) => {
      const h = API.campHeadline(c, NOBODY);
      if (h.blank || !h.n) return;
      if (h.crew.length) return;
      const said = API.campWaitSay(c, NOBODY);
      if (!/nobody/i.test(said)) {
        problems.push(`SILENT STALL   ${c.k} has ${h.n} lead(s) at "${h.stage}" and nobody from ${API.STAGE_BY[h.stage].fn} on it, but the row says "${said}"`);
      }
    });
  }

  if (API && API.SHAPES) {
    /* Every question the surface composes, from the two places that write
       them, plus the campaign insight's ask for each campaign. */
    const asks = [];
    (API.DB.camp || []).forEach((c) => {
      const said = API.campSay(c);
      if (said && said.ask) asks.push([`campSay(${c.k})`, said.ask]);
    });
    /* An initiative whose primary has its own handler never SENDS its ask —
       `[data-init]` claims the click and returns. Checking those would be
       checking a string nothing can reach, which is a different defect and
       one this file should not confuse with an unanswerable question. */
    const DIRECT = new Set(['draft-campaign', 'find-lookalikes', 'enrich', 'keep-list']);
    (API.initiatives() || []).forEach((it) => {
      if (it.ask && !DIRECT.has(it.k)) asks.push([`initiative ${it.k}`, it.ask]);
      if (it.altAsk) asks.push([`initiative ${it.k} (alt)`, it.altAsk]);
    });

    asks.forEach(([where, ask]) => {
      const t = ask.trim().toLowerCase();
      /* The router's own order. A question routed to a WRITE or a DO verb is
         fine — it does something — so only the ones that fall all the way
         through to `answer` need a shape. */
      if (API.DO_RE.test(t) || API.WRITE_RE.test(t) || API.BUILD_CAMP_RE.test(t)) return;
      if (!API.ASK_RE.test(t)) {
        problems.push(`UNASKED        ${where} — the router does not read this as a question, so it navigates instead and the question is lost`);
        return;
      }
      if (!API.SHAPES.some((s) => s.test(t))) {
        problems.push(`UNANSWERED     ${where} — reaches the canvas and matches no shape, so it lands on "Not something this surface knows"`);
      }
    });
  }
} catch (err) {
  problems.push(`ASK CHECK FAILED  ${err.message} — the composed questions could not be walked through the router`);
}

/* ══ MARKUP NOBODY MOUNTS ═════════════════════════════════════════════════

     Twice now a renderer has been complete, correct, and unreachable.
     `taskSheet()` built the run page and handed it to a caller that dropped
     the return value, so the page had never once appeared. `campHistory()`
     built the two sections that were asked for by name — what it has been
     doing, how it got here, each row saying who — and the restructure that
     rewrote the campaign page took its only call site with it.

     Neither was caught, because every check here reads what the product
     DRAWS: a function that draws nothing contributes no controls, no asks
     and no classes, so it is invisible to an audit built on output. The
     absence of evidence looked exactly like the absence of a problem.

     So this one reads the source instead. A function whose body returns
     markup, and whose name appears nowhere else, is dead — and the failure
     mode is not a crash but a feature that is quietly missing, which is the
     hardest kind to notice and the easiest kind to promise. */
/* ══ AND A RENDERER IS NOT ALWAYS A `function` ═════════════════════════════

   This read `function name(` only, and half the renderers on this surface
   are `const name = (o) => \`<div…\``. Measured: `tile()` drew every card on
   the executive page, its last call site was deleted with the bento, and
   this check walked straight past it — while `css-audit` did flag the rules
   underneath it. An audit that catches a dead component's STYLES and not
   the component is an audit that reports the smaller half of the defect.

   The arrow form also breaks the `return` test, because a concise body has
   no `return` in it at all — the template follows the arrow directly. So
   the markup test runs against the body INCLUDING its opening, and matches
   either shape.

   Both kinds are gathered first and share everything after, so the next
   declaration form somebody uses is one regex rather than a third copy of
   the logic. */
{
  const decls = [];
  [...src.matchAll(/\n([ \t]*)function\s+([A-Za-z_$][\w$]*)\s*\(/g)].forEach((m) => {
    decls.push({ name: m[2], indent: m[1], at: m.index, from: m.index + m[0].length, kind: 'function' });
  });
  /* `const x = (a, b) => …` and `const x = a => …`. A parenthesised list may
     hold a destructure or a default with its own parens, so the arrow is
     found by scanning rather than by a nested-paren regex. */
  [...src.matchAll(/\n([ \t]*)const\s+([A-Za-z_$][\w$]*)\s*=\s*(?=[(A-Za-z_$])/g)].forEach((m) => {
    const head = src.slice(m.index + m[0].length, m.index + m[0].length + 400);
    const arrow = head.indexOf('=>');
    if (arrow < 0) return;
    /* Anything before the arrow that cannot be a parameter list means this
       is an assignment, not a function — `const a = b.c` or a call. */
    if (/[;{}`]|\breturn\b/.test(head.slice(0, arrow))) return;
    decls.push({ name: m[2], indent: m[1], at: m.index, from: m.index + m[0].length + arrow + 2, kind: 'arrow' });
  });

  /* Reported in source order. They are gathered by declaration KIND, and a
     report that lists every `function` before every `const` reads as two
     unrelated lists rather than one walk down the file. */
  decls.sort((x, y) => x.at - y.at).forEach((d) => {
    /* Where the body ends: the next declaration at the same indentation.
       Crude, and it only has to be good enough to see the markup. Erring
       short can only cause a miss, never a false accusation. */
    const ends = ['function ', 'const ', 'let ']
      .map((k) => src.indexOf(`\n${d.indent}${k}`, d.from))
      .filter((i) => i >= 0);
    const body = src.slice(d.from, ends.length ? Math.min.apply(null, ends) : src.length);

    /* A concise arrow returns its template with no `return` in front of it,
       so the opening of the body counts as a return position. */
    const draws = /^\s*`\s*<|^\s*`[^`]*<\w|return\s+`\s*<|return\s+`[^`]*<\w/.test(body);
    if (!draws) return;

    /* Called, referenced, or handed somewhere — any mention that is not the
       declaration itself counts, because a renderer passed by name is still
       reachable. `metricCard` is reached only as `const card = metricCard`,
       and that is a real mount. */
    const uses = [...src.matchAll(new RegExp(`\\b${d.name}\\b`, 'g'))].length;
    if (uses <= 1) {
      const line = src.slice(0, d.at).split(/\r?\n/).length + 1;
      problems.push(`UNMOUNTED      ${d.name}() at sales.js:${line} returns markup and is never called — the surface it draws cannot be reached`);
    }
  });
}

if (problems.length) {
  console.error(`\n  ${problems.length} wiring problem(s):\n`);
  problems.forEach((p) => console.error('    ' + p));
  console.error('');
  process.exit(1);
}

console.log(`\n  wiring-audit: ${rendered.size} controls drawn, every one connected.\n`);
