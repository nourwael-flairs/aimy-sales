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
    if (NOT_OURS.has(a)) return;
    /* Skip the ones inside a `closest()` — those are the handler side. */
    if (new RegExp(`closest\\(\\s*['"\`][^'"\`]*${a}`).test(line)) return;
    if (!rendered.has(a)) rendered.set(a, i + 1);
  });
});
/* index.html draws some too — the bell, the theme toggle, the prototype panel. */
(html.match(/\bdata-[a-z][a-z0-9-]*/g) || []).forEach((a) => {
  if (!NOT_OURS.has(a) && !rendered.has(a)) rendered.set(a, 0);
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

/* A `needs:` pointing at the wrong field would leave a confirm disabled
   forever, and this is NOT the place to catch it: the class it names exists
   elsewhere in the file, so a static check passes while the surface is
   broken. Proving it needs to know which fields are in WHICH commit's body,
   which is a runtime fact. `gateCommit` handles it instead, by refusing to
   trap the person — see `sales.js`. Recorded here so the next person does
   not add the check that cannot work. */

if (problems.length) {
  console.error(`\n  ${problems.length} wiring problem(s):\n`);
  problems.forEach((p) => console.error('    ' + p));
  console.error('');
  process.exit(1);
}

console.log(`\n  wiring-audit: ${rendered.size} controls drawn, every one connected.\n`);
