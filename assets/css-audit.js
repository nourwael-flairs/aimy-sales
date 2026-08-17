/* ═══════════════════════════════════════════════════════════════════════
   css-audit.js — six checks no runtime error trap can perform, because
   none of them throw.

       node assets/css-audit.js

   Adapted from AiMY Knowledge v2, which learned each of these the hard way.
   Exits non-zero on any failure.

   1 · Every class sales.js renders resolves to a rule. A missing rule is not
       a runtime error — the page still loads and the damage is only visible
       to somebody looking at the screen. A bulk CSS deletion once cost
       Knowledge 28 rules this way.
   1b· And the reverse: every rule in sales.css is rendered by something.
       Check 1 ran one way only for six passes, so this file reported "no
       orphans" over 86 dead classes — 10% of the stylesheet, whole component
       families left behind by removals. An audit that passes because its
       check cannot reach the failure is the defect it exists to catch.
   2 · No control characters in the source. A tooling round-trip once turned
       every regex word boundary into a literal backspace: valid JavaScript,
       invisible in an editor, and the regex silently stops matching.
   3 · Every spacing value is on the scale. Uneven rhythm is invisible from
       the inside — it is chosen one component at a time.
   4 · Every token a rule READS is a token something DEFINES.
   5 · Every font size is on the type scale. Added in v3, because check 3
       had a hole exactly its own shape: spacing was audited against a scale
       and type was not, so the product drifted to NINETY-SEVEN of its 137
       font sizes being 10px or 11px without a single check objecting. That
       is what leadership saw and called "detached".
   6 · Proximity: inside a vertical stack, the gap BETWEEN a group's rows
       must be at most half the gap to whatever follows the group. Equal
       spacing on both sides of a boundary is what makes elements read as
       unrelated to the thing they belong to.
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

/* ── 1b · AND THE SAME CHECK IN THE OTHER DIRECTION ──────────────────────

   Check 1 has only ever run JS → CSS: a class the templates render with no
   rule behind it. The reverse — a RULE nothing renders — was never checked,
   so `css-audit` reported "no orphans" over 86 dead classes, 10% of the
   stylesheet. Whole families: `.s-write-*` (7), `.s-talk-*` (5), `.s-aud-*`
   (6), `.s-campo*` (4), `.s-build*` (3), `.rail-item*` (6). Every one is a
   component this product removed and left the CSS of.

   This is the same shape as the `tier-audit` hole v6 inherited from P7-06:
   an audit that passes because its check cannot reach the failure is worse
   than no audit, because it is evidence of a thing that was never looked at.

   DYNAMICALLY COMPOSED CLASSES ARE NOT DEAD. `tone-${x}`, `conf-${c.conf}`
   and `is-${l.who}` build a class name at paint time, so the literal never
   appears in the source. A class counts as live if the prefix up to its LAST
   hyphen is interpolated — `tone-neutral` is live because `tone-${` exists.

   THE LAST HYPHEN, NOT ANY HYPHEN. The first cut walked every hyphen
   boundary outwards, so `s-write-name` was tested against `s-write-${` (0
   hits) and then against `s-${` — which appears 14 times in `sales.js`. That
   one match exempted EVERY `s-*` class in the file: the check found 7 dead
   rules where the real number was 86, and would have gone on reporting a
   stylesheet that is 10% dead as clean. An audit whose filter is too
   generous is the failure it was written to catch, one level up. */
const html = (() => {
  try { return fs.readFileSync(path.join(here, '..', 'index.html'), 'utf8'); } catch (e) { return ''; }
})();
const ds = fs.readFileSync(path.join(here, 'aimy-ds.css'), 'utf8');
const mine = fs.readFileSync(path.join(here, 'sales.css'), 'utf8');
const referenced = js + html + ds;

const defined = new Set();
mine.replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/\.(-?[_a-zA-Z][\w-]*)/g, (m, c) => { defined.add(c); return m; });

const composed = (c) => {
  const at = c.lastIndexOf('-');
  return at > 0 && referenced.includes(c.slice(0, at + 1) + '${');
};

const unused = [...defined]
  .filter((c) => !EXEMPT.has(c))
  .filter((c) => !referenced.includes(c))
  .filter((c) => !composed(c))
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

   The scale here is the library's, plus 1 and 2 for a hairline and a seam.
   It used to carry 6 as well, on the argument that a 4→8 jump is 100% and
   small controls need something between — see below for what that cost.

   Above 48, anything on an 8px grid passes: those are layout offsets, not
   rhythm — clearing a fixed input, not spacing two labels. */
/* ══ THE 4px SYSTEM, WITH 6 REMOVED ═══════════════════════════════════════
   `6` was on this list and it was the ONLY value in `sales.css` off a 4px
   grid — 93 declarations of it, against 526 that were on. A scale with one
   odd number in it is not a scale, it is a habit with a whitelist: 6 sat
   between the tight step and the next one up and got used for both, so
   "inside a group" and "between two things" were the same distance in
   sixty places.

   Each of the 93 took the step that keeps its role — `gap` to 4, `margin`
   and `padding` to 8 — and the file is now 611 of 611 on the system. 1 and 2
   stay: they are a hairline and a seam, not spacing.

   60 goes too. It was never used, and it is not a multiple of 8 either, so
   it could only ever have admitted another odd one. */
const SPACE = [1, 2, 4, 8, 12, 16, 20, 24, 32, 40, 48];
const ok = (n) => SPACE.includes(n) || (n > 48 && n % 8 === 0);

const bad = [];
const noComments = fs
  .readFileSync(path.join(here, 'sales.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
/* ══ AND SHARED CHROME IS NOT ON THIS PRODUCT'S SPACING SCALE EITHER ══════
   The type check has carried the `SHARED_CHROME` boundary since v3, with the
   argument spelled out below it: the topnav and the AiMY canvas are ported
   from QA and Knowledge so the three agents read as one product, which makes
   their measurements the LIBRARY's rather than this file's.

   The SPACING check had no such boundary, and it cost exactly what the type
   version was written to prevent. A pass that took `sales.css` to 100% on a
   4px grid moved `.topnav-tab` from `6px 16px` to `8px 16px`, `.topnav-avatar`
   onto a local token, and `.overlay-context-bar`'s gap from 6 to 4 — so the
   shared masthead rendered 2px taller in Sales than in its two siblings, to
   satisfy a scale that was never meant to reach it. All three are reverted.

   One boundary, stated once, honoured by both checks. Declared here because
   a `const` is not hoisted, and the type check reads the same binding from
   further down the file rather than keeping a second copy of the pattern. */
const SHARED_CHROME = /\.(topnav-|app-topnav|overlay-|ov-|aimy-float|float-badge|filter-chip|v2-dropdown|dd-label)/;

/* PER RULE, NOT PER LINE — the same correction the type check records. A
   rule spans lines, and `.topnav-tab` carries its selector twelve lines
   above its padding, so a line-scoped test exempts nothing that is
   formatted the way real CSS is written. Every line inside a shared-chrome
   block is marked once, up front. */
const SHARED_LINES = new Set();
(() => {
  let line = 1, sel = '', start = 0, depth = 0;
  for (let i = 0; i < noComments.length; i++) {
    const ch = noComments[i];
    if (ch === '\n') line++;
    else if (ch === '{') { if (!depth++) { start = line; } }
    else if (ch === '}') {
      if (--depth === 0 && SHARED_CHROME.test(sel)) {
        for (let n = start; n <= line; n++) SHARED_LINES.add(n);
      }
      if (depth <= 0) { depth = 0; sel = ''; }
    } else if (!depth) sel += ch;
    if (ch === '}' && !depth) sel = '';
  }
})();

noComments.split(/\r?\n/).forEach((line, i) => {
  if (SHARED_LINES.has(i + 1)) return;
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
  console.error('\n  Scale: ' + SPACE.join(' · ') + ' (and 8px multiples above 48).\n');
  process.exit(1);
}

if (orphans.length) {
  console.error('\n  ' + orphans.length + ' class(es) rendered with no CSS rule anywhere:\n');
  orphans.forEach((c) => console.error('    .' + c));
  console.error('');
  process.exit(1);
}
if (unused.length) {
  console.error('\n  ' + unused.length + ' rule(s) in sales.css that nothing renders:\n');
  unused.forEach((c) => console.error('    .' + c));
  console.error('\n  Each is a component that was removed and left its CSS behind.'
    + '\n  Delete the rule, or add the class to EXEMPT with the reason.\n');
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

/* ── 5 · Every font size is on the type scale ──

   Check 3 has audited spacing against a scale since Knowledge, and type was
   never given the same treatment. The result was measurable and nobody
   measured it: 47 declarations at 10px, 50 at 11px, 26 at 12px, and
   fourteen everything-else — four "levels" inside three pixels, which the
   eye reads as one. Body text did not exist to be a label's opposite.

   The scale is argued in sales.css §THE TYPE SYSTEM: 12 is a LABEL size and
   only ever appears all-caps and tracked, which is why it may sit one pixel
   from 13 when 11/12/13/14 could not sit together at all.

   `aimy-ds.css` is NOT scanned. It is extracted from the library rather than
   authored here, its off-scale values are a gap in the system, and the ones
   this product actually renders are re-mapped in sales.css. Auditing it
   would report a defect at an address nobody here may edit.

   ── WHY THIS CHECK PASSED WHILE THE DEFECT IT EXISTS FOR WAS ON SCREEN ──

   Two holes, and each one alone was enough.

   1 · IT ONLY SAW LITERALS. The pattern matched `font-size: 13px` and not
       `font-size: var(--fs-xs)`. Of 253 declarations in sales.css, 250 went
       through a token — so the check was reading four of them and reporting
       on all of them. It said "type on scale" for a surface where 85.4% of
       the type rendered at 11px or 13px.

   2 · THE SCALE WAS STALE. `[12, 13, 15, 18, 22, 28, 36]` is the scale
       argued at sales.css §THE TYPE SYSTEM's first draft. The scale the
       `:root` block thirty lines below it actually implements is
       11 · 13 · 14 · 16 · 20 · 32. An enforcement array that is a copy of
       the thing it enforces will drift from it, and this one had.

   So it is not a copy any more: the steps are READ OUT of sales.css's own
   `:root`, and a token resolves through the same map the browser uses. The
   audit cannot now disagree with the scale, because it has no scale of its
   own to disagree with.

   Resolution follows the CASCADE, not the concatenation: `index.html` loads
   `aimy-ds.css` and then `sales.css`, so the library declares the steps and
   this product's `:root` overrides them. Reading the two in that order is
   what the browser does, and reading them in the other order would audit
   against sizes nothing renders.

   RESOLUTION AND SCALE ARE TWO QUESTIONS. `FS_TOKENS` resolves any token a
   rule reaches for, so it needs the whole cascade. `TYPE` is THIS PRODUCT'S
   scale, which is the set sales.css re-declares — the library ships steps
   this surface never adopted (`--fs-5xl`, 46px), and folding those in would
   let the audit call a size legal that the product never chose, and would
   ask for an anchor at a step nothing here is meant to reach. */
const FS_TOKENS = {};
let TYPE = [];
for (const file of ['aimy-ds.css', 'sales.css']) {
  const text = fs.readFileSync(path.join(here, file), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '');
  const local = {};
  for (const m of text.matchAll(/(--fs-[a-z0-9]+)\s*:\s*([0-9.]+)px/g)) {
    FS_TOKENS[m[1]] = local[m[1]] = parseFloat(m[2]);
  }
  if (file === 'sales.css') TYPE = [...new Set(Object.values(local))].sort((a, b) => a - b);
}

/* ── SHARED ECOSYSTEM CHROME IS NOT ON THIS PRODUCT'S SCALE ──

   The topnav and the AiMY canvas are carried across Sales, QA and Knowledge
   deliberately, so the three agents read as one product. That makes their
   type the LIBRARY's, not this file's: pulling them onto the local scale
   made the same bar and the same assistant render 1–2px differently
   depending on which product you opened them from, which is a worse defect
   than being off a scale that was never meant to reach them.

   The scale governs THIS PRODUCT'S SURFACE — cards, blocks, the record, the
   rail. A rule with a stated boundary is not an exemption; a rule with no
   boundary is one that will eventually be argued with. */
/* Declared once, near the spacing check that now shares it — `.app-topnav`
   and `.ov-` joined the pattern there. Two copies of a boundary is two
   boundaries, and the second one drifts. */

/* PER RULE, NOT PER LINE. The first cut tested each line for the selector,
   which works only when the declaration shares a line with it — and
   `.topnav-avatar` spans twelve lines with `font-size: 10px` alone on one of
   them. A line-based test on a rule-scoped question passes whatever happens
   to be formatted narrowly, which is not a rule at all.

   Rules are split on `}` and the whole block is tested; line numbers are
   recovered from the character offset so the report still points at the
   declaration rather than at the selector. */
const offType = [];
const seenType = [];
let typeReport = '';
{
  const lineAt = (idx) => noComments.slice(0, idx).split(/\r?\n/).length;
  let at = 0;
  for (const block of noComments.split('}')) {
    const start = at;
    at += block.length + 1;
    if (SHARED_CHROME.test(block)) continue;
    /* Literal OR token. `font-size: 13px` and `font-size: var(--fs-xs)` are
       the same declaration to a reader and were not to this check. */
    for (const m of block.matchAll(/(?<![-\w])font-size\s*:\s*(?:([0-9.]+)px|var\((--fs-[a-z0-9]+)\))/g)) {
      const n = m[1] !== undefined ? parseFloat(m[1]) : FS_TOKENS[m[2]];
      if (n === undefined) continue;   /* a token nothing defines is check 4's job */
      seenType.push(n);
      if (!TYPE.includes(n)) {
        offType.push([lineAt(start + m.index), n,
          block.slice(Math.max(0, m.index - 30), m.index + 30).replace(/\s+/g, ' ').trim()]);
      }
    }
  }
}

if (offType.length) {
  console.error('\n  ' + offType.length + ' font size(s) off the type scale:\n');
  offType.forEach((r) => console.error('    sales.css:' + r[0] + '  ' + r[1] + 'px  ' + r[2]));
  console.error('\n  Scale: ' + TYPE.join(' · ') + '  (the smallest step is caps-only.)\n');
  process.exit(1);
}

/* ── 5b · The steps are USED, not merely declared ──

   Being on the scale was never the defect. Every one of the 232 declarations
   that produced "there is no hierarchy" was on a scale — the scale just had
   twelve steps and the surface used two of them, so the check that asked
   "is this value legal" answered yes about a page set entirely in one size.

   What a reader experiences as hierarchy is the DISTRIBUTION. Two numbers
   carry it:

   · the share sitting on the two smallest steps, which is what "everything
     is a micro-label" looks like when you count it, and
   · whether the top of the scale is used at all. `--fs-3xl` and up were
     declared and read zero times, so a six-step scale ran as a four-step
     one and no surface had an anchor.

   The ceiling RATCHETS. It is set just above where the file stands so the
   number cannot climb back, and it comes down as the remaining surfaces are
   redistributed. A gate that fails on the day it is written gets deleted;
   one that only forbids getting worse gets kept. */
{
  const SMALL_SHARE_CEILING = 0.75;
  const small = seenType.filter((n) => n <= TYPE[1]).length;
  const share = seenType.length ? small / seenType.length : 0;
  const top = TYPE[TYPE.length - 1];
  const anchors = seenType.filter((n) => n === top).length;
  const fails = [];
  if (share > SMALL_SHARE_CEILING) {
    fails.push(`${(share * 100).toFixed(1)}% of type sits on the two smallest steps `
      + `(${TYPE[0]}px, ${TYPE[1]}px) — ceiling is ${(SMALL_SHARE_CEILING * 100).toFixed(0)}%. `
      + `A page set in one size has no hierarchy whatever the values are.`);
  }
  if (!anchors) {
    fails.push(`the top step (${top}px) is declared and never used, so no surface has an anchor.`);
  }
  if (fails.length) {
    console.error('\n  type distribution:\n');
    fails.forEach((f) => console.error('    ' + f));
    console.error('');
    process.exit(1);
  }
  typeReport = `${seenType.length} sizes, ${(share * 100).toFixed(0)}% on the two smallest steps, `
    + `${anchors} at the ${top}px anchor`;
}

/* ── 6 · Proximity, where it can honestly be read from source ──

   The Gestalt rule this encodes: elements closer together are perceived as
   related, so if the space INSIDE a group equals the space BETWEEN groups,
   the grouping is destroyed and everything floats at one level. That is the
   other half of what "detached and not in its optimal place" described.

   WHAT THIS DELIBERATELY DOES NOT DO. A full proximity check needs the
   rendered tree — which rule is a group, what actually follows it — and a
   stylesheet does not carry that. Two limits keep it honest rather than
   confidently wrong:

   · VERTICAL STACKS ONLY. `gap` in a horizontal row is spacing along a
     different axis from `margin-bottom`, and comparing them is a category
     error — a row of chips 8px apart does not need 16px beneath it. The
     first cut of this check did compare them and flagged eight rules, six
     of them false. Restricted to `flex-direction: column` and to grids that
     are not laying out columns, it flags two, and both were real.
   · A DRAWN BOUNDARY IS EXEMPT. Common Region outranks Proximity: a rule
     that separates with a border has already said where the group ends, and
     does not have to say it again with space. `.s-cal-field` is the case —
     6px gap, 8px margin, and a hairline doing the actual work.

   The rest of the rule is checked in the browser during verification, which
   is the only place it can be checked completely. */
const stacks = noComments.split('}');
const crowded = [];
stacks.forEach((rule) => {
  const column =
    /flex-direction\s*:\s*column/.test(rule) ||
    (/display\s*:\s*grid/.test(rule) &&
      !/grid-auto-flow\s*:\s*column/.test(rule) &&
      !/grid-template-columns/.test(rule));
  if (!column) return;
  if (/border-bottom\s*:\s*(?!0)/.test(rule)) return;
  const g = rule.match(/(?<![-\w])(?:row-)?gap\s*:\s*([0-9]+)px/);
  const mb = rule.match(/(?<![-\w])margin-bottom\s*:\s*([0-9]+)px/);
  if (!g || !mb) return;
  const inner = +g[1];
  const outer = +mb[1];
  if (inner > 0 && outer < inner * 2) {
    const sel = (rule.match(/([^;{}]+)\{/) || [, '?'])[1].trim().split('\n').pop();
    crowded.push([sel.trim().slice(0, 46), inner, outer]);
  }
});

if (crowded.length) {
  console.error('\n  ' + crowded.length + ' vertical stack(s) spaced as tightly on the');
  console.error('  outside as on the inside, so the group does not read as one:\n');
  crowded.forEach((r) =>
    console.error('    ' + r[0] + '   gap ' + r[1] + 'px, margin-bottom ' + r[2]
      + 'px  (needs ' + r[1] * 2 + ')'));
  console.error('\n  Inside a group, at most half the space that follows it.\n');
  process.exit(1);
}

/* ── 6b · A card grid's gap against its own card's padding ──

   The check above is restricted to vertical stacks and explicitly skips
   anything with `grid-template-columns`, which is where every card grid in
   this file lives — so it never looked at the one place the rule was broken
   in all four instances at once. `.s-agenda`, `.s-campos`, `.s-metrics` and
   `.s-skel` each put LESS space between two cards than the card puts between
   its own text and its own border. Proximity says the closer pair groups,
   and the closer pair was across the card boundary: a grid of four cards
   read as one panel with lines drawn through it.

   Pairing is by this file's own two naming conventions — `.s-agenda` →
   `.s-agenda-card`, and the plural → singular of `.s-campos` → `.s-campo`.
   A grid whose card cannot be found is not guessed at and not flagged: a
   check that invents the thing it is measuring is worse than no check. */
const decl = {};
stacks.forEach((rule) => {
  const sel = (rule.match(/([^;{}]+)\{/) || [, ''])[1].trim().split('\n').pop().trim();
  if (!/^\.[\w-]+$/.test(sel)) return;
  const pad = rule.match(/(?<![-\w])padding\s*:\s*([0-9]+)px/);
  const gap = rule.match(/(?<![-\w])gap\s*:\s*([0-9]+)px/);
  const cols = /grid-template-columns[^;]*minmax\(/.test(rule);
  decl[sel] = { pad: pad ? +pad[1] : null, gap: gap ? +gap[1] : null, cardGrid: cols };
});

const merged = [];
Object.keys(decl).forEach((sel) => {
  const g = decl[sel];
  if (!g.cardGrid || !g.gap) return;
  const stem = sel.replace(/s$/, '');
  const card = [sel + '-card', sel + '-item', stem, stem + '-card']
    .filter((k) => k !== sel)
    .map((k) => (decl[k] && decl[k].pad ? [k, decl[k].pad] : null))
    .filter(Boolean)[0];
  if (!card) return;
  if (g.gap <= card[1]) merged.push([sel, g.gap, card[0], card[1]]);
});

if (merged.length) {
  console.error('\n  ' + merged.length + ' card grid(s) with less space BETWEEN cards than');
  console.error('  INSIDE one, so adjacent cards read as a single surface:\n');
  merged.forEach((r) =>
    console.error('    ' + r[0] + '   gap ' + r[1] + 'px  vs  ' + r[2] + ' padding '
      + r[3] + 'px  (needs more than ' + r[3] + ')'));
  console.error('\n  Between two cards, more space than inside either.\n');
  process.exit(1);
}

console.log('css-audit: ' + used.size + ' classes checked, ' + declared.size
  + ' tokens defined, no orphans, spacing and type on scale, proximity holds.');
/* Printed on every run, not only on failure. "On scale" was true throughout
   the period the surface had no hierarchy; the distribution is the number
   that would have said so, and a number nobody sees is a number nobody
   acts on. */
console.log('           type: ' + typeReport + '.');
