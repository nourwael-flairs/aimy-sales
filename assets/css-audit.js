/* ═══════════════════════════════════════════════════════════════════════
   css-audit.js — three checks no runtime error trap can perform, because
   none of them throw.

       node assets/css-audit.js

   Adapted from AiMY Knowledge v2, which learned each of these the hard way.
   Exits non-zero on any failure.

   1 · Every class sales.js renders resolves to a rule. A missing rule is not
       a runtime error — the page still loads and the damage is only visible
       to somebody looking at the screen. A bulk CSS deletion once cost
       Knowledge 28 rules this way.
   2 · No control characters in the source. A tooling round-trip once turned
       every regex word boundary into a literal backspace: valid JavaScript,
       invisible in an editor, and the regex silently stops matching.
   3 · Every spacing value is on the scale. Uneven rhythm is invisible from
       the inside — it is chosen one component at a time.
   ═══════════════════════════════════════════════════════════════════════ */
'use strict';
const fs = require('fs');
const path = require('path');

const here = __dirname;
const js = fs.readFileSync(path.join(here, 'sales.js'), 'utf8');
const css =
  fs.readFileSync(path.join(here, 'sales.css'), 'utf8') +
  fs.readFileSync(path.join(here, 'aimy-ds.css'), 'utf8');

/* Classes written into markup by the templates. Template holes (`${…}`) are
   skipped: what they resolve to is decided at runtime and cannot be read here. */
const used = new Set();
for (const m of js.matchAll(/class="([^"$]*)"/g)) {
  for (const c of m[1].split(/\s+/)) if (c) used.add(c);
}

/* Utility and state classes deliberately styled only in combination
   (`.type-card.is-compact`), or carrying no visual weight of their own. */
const EXEMPT = new Set(['s-hidden', 's-enter', 's-row', 's-gap-2', 's-gap-3', 's-gap-4', 's-sr']);

const orphans = [...used]
  .filter((c) => !EXEMPT.has(c))
  .filter((c) => !css.includes('.' + c))
  .sort();

/* ── Control characters ── */
const ctrl = [];
js.split(/\r?\n/).forEach((line, i) => {
  for (const ch of line) {
    const c = ch.codePointAt(0);
    if (c < 9 || (c > 10 && c < 32)) {
      ctrl.push([i + 1, c, line.trim().slice(0, 70)]);
      break;
    }
  }
});

if (ctrl.length) {
  console.error('\n  ' + ctrl.length + ' line(s) hold a control character:\n');
  ctrl.forEach((r) => console.error('    sales.js:' + r[0] + '  0x' + r[1].toString(16) + '  ' + r[2]));
  console.error('\n  0x08 is almost always a word boundary that was eaten in transit.\n');
  process.exit(1);
}

/* ── Spacing ──

   The library declares a 4px scale (`--sp-1…--sp-15`) and says in its own
   documentation: "No hard-coded colors or spacing in product code."

   The scale here is the library's plus the two dense steps it does not have —
   2 and 6 — because a 4→8 jump is 100% and small controls need something
   between. The library's own components prove the need. Recorded in GAPS.md.

   Above 60, anything on an 8px grid passes: those are layout offsets, not
   rhythm — clearing a fixed input, not spacing two labels. */
const SPACE = [2, 4, 6, 8, 12, 16, 20, 24, 32, 40, 48, 60];
const ok = (n) => SPACE.includes(n) || (n > 60 && n % 8 === 0);

const bad = [];
const noComments = fs
  .readFileSync(path.join(here, 'sales.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
noComments.split(/\r?\n/).forEach((line, i) => {
  /* Every declaration on the line, not just the first — one-line rules are
     common here and a guard that stops at the first is a guard with a hole. */
  for (const m of line.matchAll(
    /(?<![-\w])(padding|margin|gap|row-gap|column-gap)(-top|-right|-bottom|-left)?\s*:([^;{}]+);/g
  )) {
    /* Negative values are optical corrections, not rhythm. Each one is a
       judgment about a specific glyph and does not belong to a scale. */
    (m[3].match(/(?<!-)\b\d+(?:\.\d+)?px/g) || []).forEach((v) => {
      const n = parseFloat(v);
      if (n > 0 && !ok(n)) bad.push([i + 1, n, line.trim().slice(0, 62)]);
    });
  }
});

if (bad.length) {
  console.error('\n  ' + bad.length + ' spacing value(s) off the scale:\n');
  bad.forEach((r) => console.error('    sales.css:' + r[0] + '  ' + r[1] + 'px  ' + r[2]));
  console.error('\n  Scale: ' + SPACE.join(' · ') + ' (and 8px multiples above 60).\n');
  process.exit(1);
}

if (orphans.length) {
  console.error('\n  ' + orphans.length + ' class(es) rendered with no CSS rule anywhere:\n');
  orphans.forEach((c) => console.error('    .' + c));
  console.error('');
  process.exit(1);
}
/* ── 4 · Every token a rule READS is a token something DEFINES ──

   WHY THIS EXISTS. `.s-aud { padding: var(--s3) var(--s4) }` — the scale is
   `--sp-1 … --sp-15`, and nothing anywhere defines `--s3`. A `var()` with no
   definition and no fallback is invalid at computed-value time, so the
   declaration falls back to the property's initial value: padding 0, gap 0,
   margin 0. The rule is right there in the file, spelled correctly, doing
   nothing.

   Twenty-four of them shipped. Fourteen were spacing written in a scale that
   does not exist; the other ten were `--lh-normal` (x8), `--lh-loose` and
   `--fw-normal`, which had been silently dropping body text to the browser's
   default line-height for many passes. Reported repeatedly as "spacing
   issues" and never found, because reading the stylesheet shows nothing wrong.

   And check 3 above passed all of it — it validates hard-coded px against the
   scale, so a stylesheet whose spacing is never applied reads as "spacing on
   scale". The same failure this project keeps meeting: nothing throws. */
/* Comments out before scanning: a token named in prose is not a definition,
   and a `var()` quoted in a comment is not a usage. Line numbers are read
   back off the raw file, so blanking without preserving offsets is fine. */
const cssCode = css.replace(/\/\*[\s\S]*?\*\//g, ' ');

const declared = new Set([...cssCode.matchAll(/(--[a-z0-9-]+)\s*:/gi)].map((m) => m[1]));

/* Some are set at RUNTIME — `style="--i:${i}"` on a card, the two bar-fill
   properties — so they are declared by the product, just not in a stylesheet.
   Read out of the `style="…"` attributes themselves rather than kept in an
   allowlist, because an allowlist rots the moment somebody adds another one,
   and scanning the whole file would count every token named in a COMMENT,
   which would make this check pass the very bug it was written for. */
for (const attr of js.matchAll(/style="([^"]*)"/g)) {
  for (const d of attr[1].matchAll(/(--[a-z0-9-]+)\s*:/g)) declared.add(d[1]);
}

const undef = new Map();
for (const m of cssCode.matchAll(/var\(\s*(--[a-z0-9-]+)\s*([,)])/gi)) {
  /* `var(--x, 12px)` carries its own fallback and is not a defect. */
  if (m[2] === ',') continue;
  if (!declared.has(m[1])) undef.set(m[1], (undef.get(m[1]) || 0) + 1);
}

if (undef.size) {
  const total = [...undef.values()].reduce((a, b) => a + b, 0);
  console.error('\n  ' + total + ' declaration(s) read a token nothing defines,');
  console.error('  so each one falls back to its initial value and does nothing:\n');
  const lines = css.split(/\r?\n/);
  [...undef.keys()].sort().forEach((tok) => {
    console.error('    ' + tok + '  x' + undef.get(tok));
    lines.forEach((line, i) => {
      if (line.includes('var(' + tok + ')') || line.includes('var( ' + tok)) {
        console.error('        css:' + (i + 1) + '  ' + line.trim().slice(0, 66));
      }
    });
  });
  console.error('');
  process.exit(1);
}

console.log('css-audit: ' + used.size + ' classes checked, ' + declared.size
  + ' tokens defined, no orphans, spacing on scale.');
