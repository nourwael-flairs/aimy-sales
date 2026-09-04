#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════════════════
   THE AUDIT — one script, run before every commit.

       node assets/audit.js

   The V3 build carried three of these totalling 100KB. This one is small on
   purpose: it checks the handful of things that break SILENTLY in a product
   with no build step, no types and no tests, and nothing else.

   What breaks silently here:

   1  A control that is drawn and not wired. It looks like a button, it is a
      button, and pressing it does nothing at all.
   2  A handler with nothing drawing it. Dead code that reads as a feature.
   3  A class used and never defined. The element renders unstyled, which on a
      dark ground often means invisible rather than ugly.
   4  A rule defined and never used. Ten percent of the V3 stylesheet was this.
   5  An unbalanced brace. Every rule after it silently stops applying, and the
      V3 build's CSS audit could not see it — the blind spot is why it is here.
   6  A banned pattern: a native select, an inline handler, `transition: all`.
   7  Mixed line endings in one file, which is what a careless sed leaves.

   Exit code is 1 on any failure, so this can gate a commit.
   ═══════════════════════════════════════════════════════════════════════════ */

'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

/* Comments are not markup. The shell keeps `data-page` and `data-gopage` in a
   comment as the record of a trap that was removed, and a scan of raw text
   reads those as controls nothing handles. */
const strip = (s) => s.replace(/<!--[\s\S]*?-->/g, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ');
const JS = strip(read('assets/bdr.js'));
const CSS = read('assets/bdr.css');
const HTML = strip(read('index.html'));
const DS = read('assets/aimy-ds.css');
const SALES = read('assets/sales.css');

const fails = [];
const notes = [];
const fail = (check, msg) => fails.push(check + ': ' + msg);

/* Attributes that are markers rather than verbs — read by something other
   than the click router, or by the browser itself. Each one needs a reason. */
const MARKERS = {
  'theme': 'the html element attribute the design system themes on',
  'submit-on-enter': 'read by a keydown listener, not by a click',
  'i': 'the row index a windowed list writes for its own bookkeeping',
  'work-state': 'the canonical value the design system reads off a work-state chip',
  'tocamp': 'the second half of data-addlist, read off the same element by its handler',
  'card': 'which person a queue card is about, read by the keyboard cursor, not by a click',
};

/* ── 1 & 2. CONTROLS AND HANDLERS, BOTH DIRECTIONS ───────────────────────── */
const handlers = new Set();
let m;
const HANDLER_RE = /closest\('\[data-([a-z0-9-]+)\]'\)/g;
while ((m = HANDLER_RE.exec(JS))) handlers.add(m[1]);

const drawn = new Set();
const DRAWN_RE = /\bdata-([a-z0-9-]+)\s*(?==|["'\s>])/g;
[HTML, JS].forEach((src) => {
  let x;
  const re = new RegExp(DRAWN_RE.source, 'g');
  while ((x = re.exec(src))) drawn.add(x[1]);
});

drawn.forEach((v) => {
  if (handlers.has(v) || MARKERS[v]) return;
  fail('1 drawn-not-wired', 'data-' + v + ' is rendered and nothing handles it');
});
handlers.forEach((v) => {
  if (drawn.has(v)) return;
  fail('2 wired-not-drawn', 'the router handles data-' + v + ' and nothing renders it');
});

/* ── 3. EVERY CLASS USED IS A CLASS DEFINED ──────────────────────────────── */
const defined = new Set();
const SEL_RE = /\.(-?[A-Za-z_][A-Za-z0-9_-]*)/g;
[CSS, DS, SALES].forEach((src) => {
  /* Selectors only: strip declaration blocks first, or `.5s` and decimal
     values in `transform: scale(.98)` register as class names. */
  const selectors = src.replace(/\{[^{}]*\}/g, '{}');
  let x;
  const re = new RegExp(SEL_RE.source, 'g');
  while ((x = re.exec(selectors))) defined.add(x[1]);
});

const used = new Map();
let skipped = 0;
const CLASS_RE = /class="([^"]*)"/g;
[['index.html', HTML], ['assets/bdr.js', JS]].forEach((pair) => {
  let x;
  const re = new RegExp(CLASS_RE.source, 'g');
  while ((x = re.exec(pair[1]))) {
    /* A class list built by concatenation — `class="' + cls + '"` — is not a
       list of class names, and splitting it on whitespace yields fragments of
       the expression. `cls`, `k` and `0` were all reported as undefined
       classes on the first run of this check. The whole attribute is skipped
       and counted, so the report says how much it could not see rather than
       inventing findings out of the parts it misread. */
    if (/['"`+]|\$\{/.test(x[1])) { skipped++; continue; }
    x[1].split(/\s+/).forEach((c) => {
      if (!c || /[^A-Za-z0-9_-]/.test(c)) return;
      if (!used.has(c)) used.set(c, pair[0]);
    });
  }
});
used.forEach((where, c) => {
  if (defined.has(c)) return;
  fail('3 class-undefined', '.' + c + ' is used in ' + where + ' and defined nowhere');
});

/* ── 4. EVERY RULE THIS BUILD DEFINES IS A RULE IT USES ──────────────────── */
/* EVERY rule in bdr.css, not just the `b-` prefixed ones. The first cut only
   looked at `.b-*`, so six `.rail-nav*` rules — named to sit with the shell's
   own `.rail-*` family — were defined, never checked, and would have gone on
   being unused without a word. This file is small and entirely this build's:
   if a rule is in it and nothing renders it, that is a finding whatever it is
   called. The library overrides pass because the shell renders them. */
const mineDefined = new Set();
{
  /* Comments out FIRST. This file explains itself by naming the rules it is
     not duplicating — `.s-queue`, `.s-camp-row` — and a scan that reads prose
     as selectors reports those as unused rules that were never rules. */
  const selectors = CSS.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\{[^{}]*\}/g, '{}');
  let x;
  const re = /\.([A-Za-z][A-Za-z0-9_-]*)/g;
  while ((x = re.exec(selectors))) mineDefined.add(x[1]);
}
mineDefined.forEach((c) => {
  if (HTML.indexOf(c) >= 0 || JS.indexOf(c) >= 0) return;
  fail('4 rule-unused', '.' + c + ' is defined in bdr.css and rendered nowhere');
});

/* ── 5. BRACES BALANCE ───────────────────────────────────────────────────
   A stray closing brace ends the stylesheet's outermost block early, and
   every rule after it is silently discarded. The V3 build's CSS audit never
   checked this and reported green through exactly that. Counted outside
   strings and comments, and reported with the line the imbalance reaches. */
{
  const stripped = CSS.replace(/\/\*[\s\S]*?\*\//g, (s) => s.replace(/[^\n]/g, ' '));
  let depth = 0, line = 1, worstLine = 0;
  for (let i = 0; i < stripped.length; i++) {
    const ch = stripped[i];
    if (ch === '\n') line++;
    else if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth < 0 && !worstLine) worstLine = line; }
  }
  if (depth !== 0) {
    fail('5 braces', 'bdr.css is ' + Math.abs(depth) + ' brace(s) ' +
      (depth > 0 ? 'short of closing' : 'over-closed, first at line ' + worstLine));
  }
}

/* ── 6. BANNED PATTERNS ──────────────────────────────────────────────────
   Each one is a rule from the design system with a reason attached, and each
   is invisible in review once it is one line among a thousand. */
const BANNED = [
  [/<select\b/i, 'a native <select> — the design system has one select control and this is not it'],
  [/\son[a-z]+\s*=\s*["']/i, 'an inline event handler attribute — blocked under a strict CSP, and unfindable'],
  [/transition:\s*all\b/i, 'transition: all — it animates properties nobody chose, including layout ones'],
  [/\bdraggable\s*=/i, 'drag and drop — not an interaction this product offers'],
];
[['index.html', HTML], ['assets/bdr.js', JS], ['assets/bdr.css', CSS]].forEach((pair) => {
  BANNED.forEach((b) => {
    if (b[0].test(pair[1])) fail('6 banned', pair[0] + ' contains ' + b[1]);
  });
});

/* ── 7. LINE ENDINGS ARE UNIFORM PER FILE ────────────────────────────────
   Not a style question. This repo checks out CRLF, and a tool that rewrites
   part of a file with LF leaves a mix that git normalises away on commit — so
   the diff is clean and the file on disk is not. Uniform either way passes;
   mixed does not. */
['index.html', 'assets/bdr.js', 'assets/bdr.css', 'assets/audit.js'].forEach((p) => {
  const s = read(p);
  const crlf = (s.match(/\r\n/g) || []).length;
  const lf = (s.match(/\n/g) || []).length - crlf;
  if (crlf && lf) fail('7 line-endings', p + ' mixes ' + crlf + ' CRLF and ' + lf + ' LF endings');
});

/* ── 8. EVERY FIXTURE TRANSCRIPT STILL READS BACK TO ITS OWN FATE ────────
   The five call scripts are written against the reader's lexicons, and the
   two live in the same file with nothing tying them together. Reword a line
   and the panel starts proposing the wrong outcome on that call — which is
   not an error, not a crash, and not visible unless somebody happens to walk
   that fixture and read the suggestion carefully.

   The reader is pure and depends on nothing but its own lexicons, so it can
   be lifted out of the source and run here. */
{
  const raw = read('assets/bdr.js');
  const grab = (name, kind) => {
    const at = raw.indexOf('  ' + kind + ' ' + name);
    if (at < 0) return null;
    /* Each of these ends at the first line that is exactly two spaces and a
       closing brace or bracket — the file's own indentation contract. */
    const end = raw.indexOf(kind === 'function' ? '\n  }\n' : '\n  ];\n', at);
    return end < 0 ? null : raw.slice(at, end + 4);
  };
  const parts = [
    grab('READ_DISP', 'const'), grab('READ_PROP', 'const'), grab('READ_OBJ', 'const'),
    grab('READ_OPP', 'const'), grab('READ_FRAME', 'const'),
  ];
  if (parts.some((p) => !p)) {
    fail('8 fixtures', 'could not lift the reader out of bdr.js to test it');
  } else {
    const saidPhrase = (s) => {
      const w = String(s || '').trim().replace(/\s+/g, ' ').split(' ');
      if (w.length < 2) return null;
      return (w.slice(0, 6).join(' ') + (w.length > 6 ? '…' : '')).replace(/^./, (c) => c.toUpperCase());
    };
    let READ_DISP;
    const scope = {};
    try {
      // eslint-disable-next-line no-new-func
      const load = new Function('saidPhrase', parts.join('\n') + '\n return { READ_DISP };');
      READ_DISP = load(saidPhrase).READ_DISP;
    } catch (e) {
      fail('8 fixtures', 'the lifted lexicons did not parse: ' + e.message);
    }
    if (READ_DISP) {
      const scripts = raw.slice(raw.indexOf('const CALL_SCRIPTS'), raw.indexOf('function scriptFor'));
      const fates = ['reached', 'gatekeeper', 'no-answer', 'callback', 'not-interested'];
      fates.forEach((f) => {
        const key = new RegExp("(?:^|\\n)\\s*'?" + f + "'?:\\s*\\[", 'm');
        const at = scripts.search(key);
        if (at < 0) { fail('8 fixtures', 'no call script for the fate ' + f); return; }
        const block = scripts.slice(at, scripts.indexOf('\n    ],', at));
        const text = (block.match(/'([^']*)'/g) || []).join(' ').toLowerCase();
        const hit = READ_DISP.filter((r) => r[0].test(text))[0];
        const got = hit ? hit[1] : null;
        if (got !== f) {
          fail('8 fixtures', 'the ' + f + ' call script reads as ' +
            (got || 'nothing') + ', so the panel would propose the wrong outcome');
        }
      });
      notes.push('call fixtures checked: ' + fates.length);
    }
  }
}

/* ── Report ──────────────────────────────────────────────────────────────── */
notes.push('handlers ' + handlers.size + ' · controls ' + drawn.size +
  ' · classes used ' + used.size + ' · rules this build defines ' + mineDefined.size);

if (fails.length) {
  console.error('AUDIT FAILED — ' + fails.length + '\n');
  fails.forEach((f) => console.error('  ' + f));
  console.error('\n' + notes.join('\n'));
  process.exit(1);
}
console.log('audit green — ' + notes.join(' · '));
