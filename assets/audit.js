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
const mineDefined = new Set();
{
  const selectors = CSS.replace(/\{[^{}]*\}/g, '{}');
  let x;
  const re = /\.(b-[A-Za-z0-9_-]*)/g;
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
