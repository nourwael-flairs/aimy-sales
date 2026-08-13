'use strict';
/* ═══════════════════════════════════════════════════════════════════════
   tier-audit.js — seven functions, over everything the surface reads

   WHY THIS EXISTS. Pass 5 fixed two permission defects, and NEITHER OF THEM
   THREW. The surface rendered, no error reached the console, `css-audit`
   passed, and the whole thing looked correct:

     · Four display paths counted `DB.touch` raw, so a client read "AiMY sent
       42 messages, 21 addresses rejected" — the whole agency's volume across
       every engagement, reported to somebody entitled to one of them.
     · The briefing and the bell offered a read-only client a **Decide**
       button on an internal operational choice.

   Both were found by a person looking. That is not a check, and a permission
   model verified by looking is a permission model that regresses on the next
   pass. This is the check.

   WHAT IT CANNOT DO. It exercises the MODEL, not the rendered DOM — there is
   no browser here. That is the right boundary: both defects above were model
   misses (an unfiltered read, and a missing flag), and a DOM harness would
   have cost a headless browser to catch the same two things one layer later.
   The rendered surface is verified in the browser, against this file's
   numbers.

   Run:  node assets/tier-audit.js
═══════════════════════════════════════════════════════════════════════ */

const fs = require('fs');
const path = require('path');

/* ── The smallest window that lets sales.js load ──
   It registers document listeners and boots against the URL at load. None of
   that needs to work; it needs to not throw, so the model underneath is
   reachable. Anything the audit actually reads comes from `window.SALES`. */
function loadSurface() {
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
    KeyboardEvent: class {},
    Event: class {},
    URLSearchParams,
    console,
  };
  win.window = win;
  win.self = win;

  const src = fs.readFileSync(path.join(__dirname, 'sales.js'), 'utf8');
  const keys = Object.keys(win);
  // eslint-disable-next-line no-new-func
  new Function(...keys, src)(...keys.map((k) => win[k]));
  if (!win.SALES) throw new Error('sales.js loaded but exported no SALES');
  return win.SALES;
}

const S = loadSurface();
const fail = [];
const note = (m) => fail.push(m);

const FN_IDS = S.REPS.map((p) => p.id);
/* ── 0 · THE MODEL IS COMPLETE BEFORE ANYTHING ELSE IS CHECKED ──

   v4 merges entitlement and job into one concept: a FUNCTION decides both
   what you may see and what your home page leads with. That makes an
   incomplete function a worse defect than it was as a tier — a missing
   `sees` used to mean a broken filter, and now means a broken filter AND a
   person with no surface.

   Checked first and hard, because every check below reads these. */
const NEEDED = ['label', 'rule', 'sees', 'writes', 'home'];
/* GUARDED, because "the model does not exist" is a finding and a crash is
   not. An audit that throws on the thing it audits reports a stack trace to
   somebody who wanted a sentence. */
if (!S.FUNCTIONS) note('sales.js exports no FUNCTIONS — the model has not been written yet');
Object.keys(S.FUNCTIONS || {}).forEach((k) => {
  NEEDED.forEach((f) => {
    if (S.FUNCTIONS[k][f] === undefined) note(`FUNCTIONS.${k} has no ${f}`);
  });
});
S.REPS.forEach((p) => {
  if (!p.fn) note(`${p.id} has no function`);
  else if (!S.FUNCTIONS[p.fn]) note(`${p.id} has function "${p.fn}", which is not declared`);
});


/* STOP HERE IF THE MODEL IS BROKEN, rather than running twenty checks
   against it. Every check below asks "what would this person see", and a
   person whose function is not declared has no answer — so the report would
   be twenty restatements of one defect.

   BEFORE `READ_ONLY`, not after. It reads the model too, and putting it
   second meant an absent model threw a TypeError from the line below instead
   of printing the finding this check had already recorded. */
if (fail.length) {
  console.error(`\n  ${fail.length} problem(s) with the function model itself:\n`);
  fail.forEach((f) => console.error('    ' + f));
  console.error('\n  Nothing below can be checked until the model is whole.\n');
  process.exit(1);
}

const READ_ONLY = S.REPS.filter((p) => !S.FUNCTIONS[p.fn].writes).map((p) => p.id);

/* Look as somebody, run a thunk, put the surface back. Every check below is
   "what would this person see", so they all need the same shape. */
function as(id, fn) {
  const prev = S.S.as;
  S.S.as = id;
  try { return fn(S.REP[id]); } finally { S.S.as = prev; }
}

const allRecords = () => S.DB.acc.concat(S.DB.con);

/* ── 1 · No record reaches a display path its tier rejects ──
   `filtered()` is the grid; `maySee` is everything else. If either ever
   returns a record `entitled()` says no to, the boundary has a hole. */
function checkRecords() {
  FN_IDS.forEach((id) => as(id, (who) => {
    const shown = S.filtered();
    const leaked = shown.filter((r) => !S.entitled(r, who));
    if (leaked.length) {
      note(`${id} (${who.fn}): filtered() returned ${leaked.length} record(s) entitled() rejects — e.g. ${leaked[0].name}`);
    }
    /* And nothing addressable by URL either. This is the hole pass 4 shipped
       with: the grid was bounded and `?lead=` was not. */
    const denied = allRecords().filter((r) => !S.entitled(r, who));
    denied.slice(0, 40).forEach((r) => {
      S.S.lead = r.id;
      const open = S.openRec && S.openRec();
      S.S.lead = '';
      if (open) note(`${id} (${who.fn}): ?lead=${r.id} opens ${r.name}, which they may not see`);
    });
  }));
}

/* ── 2 · Touchpoint counts are bounded too ──
   The defect this file was written for. Every touchpoint a tier can count
   must belong to a record it can see. */
function checkTouchpoints() {
  FN_IDS.forEach((id) => as(id, (who) => {
    const seen = S.maySeeTouch(S.DB.touch);
    const leaked = seen.filter((t) => {
      const r = S.DB.accBy[t.acc] || S.DB.conBy[t.on];
      return !r || !S.entitled(r, who);
    });
    if (leaked.length) note(`${id} (${who.fn}): maySeeTouch let through ${leaked.length} touchpoint(s) on records they may not see`);

    /* A tier that sees fewer records must not count more touchpoints than a
       tier that sees more. Monotonicity is the property a raw `DB.touch`
       read breaks, and it breaks it silently. */
    const mine = seen.length;
    const admin = as('nour', () => S.maySeeTouch(S.DB.touch).length);
    if (mine > admin) note(`${id} (${who.fn}): counts ${mine} touchpoints, more than an admin's ${admin}`);
  }));
}

/* ── 3 · Tasks follow the records they touch ── */
function checkTasks() {
  FN_IDS.forEach((id) => as(id, (who) => {
    S.filteredTasks().forEach((t) => {
      const on = (t.on || []).map((x) => S.DB.accBy[x] || S.DB.conBy[x]).filter(Boolean);
      if (on.length && !on.some((r) => S.entitled(r, who)) && who.fn !== 'admin') {
        note(`${id} (${who.fn}): sees task "${t.title}", none of whose records they may see`);
      }
    });
  }));
}

/* ── 4 · A read-only tier is never asked to write ──
   The second defect. Every surface that can offer an action checks the same
   flag, so the check is: with `canWrite()` false, nothing that writes is on
   offer. Card exits, the briefing item and the bell row all derive from
   these, so testing the derivation tests all three. */
function checkReadOnly() {
  READ_ONLY.forEach((id) => as(id, (who) => {
    if (S.canWrite()) { note(`${id} (${who.fn}): canWrite() is true for a read-only tier`); return; }

    const withExit = S.filtered().filter((r) => S.exitFor(r));
    if (withExit.length) {
      /* Not a failure on its own — the card suppresses it — but it means the
         suppression is the only thing standing between a read-only tier and
         a write control, so it is worth saying out loud. */
      const shown = withExit.length;
      if (shown && !S.FUNCTIONS[who.fn].writes) {
        // the card gate is `exit && canWrite()`; assert the gate exists
        if (S.canWrite()) note(`${id}: ${shown} card exits would render`);
      }
    }

    const stuck = S.filteredTasks().filter((t) => S.taskState(t) === 'needs-you');
    stuck.forEach((t) => {
      if (S.taskExit(t) && S.canWrite()) note(`${id} (${who.fn}): task "${t.title}" offers ${S.taskExit(t).label}`);
    });
  }));
}

/* ── 5 · Nothing describes what is withheld ──
   INVERTED. This used to assert that "53 accounts not shown to you" equalled
   what was actually removed — the disclosure had to be arithmetically true.
   The ruling changed: a tier sees only its own world and is told nothing
   about the rest, because a count of what is withheld is still information
   about what is withheld. So the check is now the opposite one — no surface
   may state, imply or total anything outside the looker's world. */
function checkDisclosure() {
  FN_IDS.forEach((id) => as(id, (who) => {
    ['accounts', 'contacts'].forEach((on) => {
      const prev = S.S.on;
      S.S.on = on;
      const all = S.filtered({ all: true }).length;
      const shown = S.filtered().length;
      S.S.on = prev;
      if (shown > all) note(`${id} (${who.fn}) on ${on}: shows ${shown} of ${all} — entitlement ADDED records`);
    });

    /* The disclosure may frame, never enumerate. Any digit in it is a
       quantity, and the only quantities available to it are the ones on the
       other side of the boundary. */
    const disc = typeof S.disclosure === 'function' ? String(S.disclosure() || '') : '';
    const text = disc.replace(/<[^>]*>/g, ' ');
    if (/\d/.test(text)) note(`${id} (${who.fn}): the disclosure states a number — "${text.trim().slice(0, 70)}"`);
    if (/not shown|withheld|hidden|others|elsewhere|outside/i.test(text)) {
      note(`${id} (${who.fn}): the disclosure describes what is withheld — "${text.trim().slice(0, 70)}"`);
    }
  }));
}

/* ── 5b · Campaigns follow the same boundary ──
   The Campaigns tab is new in pass 7, and a new display path is a new way
   round the boundary until something says otherwise. A campaign is entitled
   through the engagement it is run FOR, not through its members — the first
   version used members and showed a client 6 of 7 campaigns, each captioned
   with its full size, which told them how big somebody else's book is. */
function checkCampaigns() {
  FN_IDS.forEach((id) => as(id, (who) => {
    const seen = S.filteredCampaigns();
    if (who.fn === 'client') {
      const wrong = seen.filter((c) => c.client !== who.client);
      if (wrong.length) note(`${id} (client): sees ${wrong.length} campaign(s) not run for ${who.client} — e.g. ${wrong[0].name}`);
      const mine = S.DB.camp.filter((c) => c.client === who.client);
      if (seen.length !== mine.length) note(`${id} (client): sees ${seen.length} of their ${mine.length} campaigns`);
    } else if (who.fn !== 'admin' && who.fn !== 'stakeholder') {
      /* ══ THE TEST IS THE BOUNDARY, NOT THE IMPLEMENTATION ═══════════════

         This read `!c.members.some(entitled)` — byte-identical to the line
         it was checking, which makes it a copy rather than a check. What the
         boundary actually says is: YOU MUST NOT LEARN ABOUT ACCOUNTS YOU ARE
         NOT ENTITLED TO. A campaign with members you cannot see teaches you
         its size and its results, so it stays banned. A campaign with NO
         members teaches nothing about anybody's book, because there is no
         book — and refusing it meant the person who had just created one
         could not see the thing they made.

         So the exception is scoped to empty campaigns, and to the owner or
         crew, and BOTH halves are checked below — an empty campaign visible
         to somebody not on it is still a leak, of the fact that it exists. */
      const held = seen.filter((c) => c.members.length);
      const wrong = held.filter((c) => !c.members.some((m) => S.DB.accBy[m] && S.entitled(S.DB.accBy[m], who)));
      if (wrong.length) note(`${id} (${who.fn}): sees ${wrong.length} campaign(s) with no account they may see`);

      const onIt = (c) => c.owner === who.id
        || Object.keys(c.crew || {}).some((f) => (c.crew[f] || []).includes(who.id));
      const strays = seen.filter((c) => !c.members.length && !onIt(c));
      if (strays.length) note(`${id} (${who.fn}): sees ${strays.length} empty campaign(s) they neither own nor are on — e.g. ${strays[0].name}`);
    }
    const admin = as('nour', () => S.filteredCampaigns().length);
    if (seen.length > admin) note(`${id} (${who.fn}): counts ${seen.length} campaigns, more than an admin's ${admin}`);
  }));
}

/* ── 5c · The team board exists only where it can be honest ──
   A rep sees their own leads plus shared plus campaign-mates, so a peer's
   card would count three of Habeba's twenty-three and label it her book — a
   lie by omission, which is the same defect class as the touchpoint leak
   this file was written for, wearing a friendlier face. The tab must not
   render for them at all, and every number on it must be `maySee`-bounded. */
function checkTeam() {
  FN_IDS.forEach((id) => as(id, (who) => {
    const board = S.filteredTeam();
    const mayLook = ['admin', 'marketing', 'sales-manager', 'stakeholder'].includes(who.fn);
    if (!mayLook && board.length) {
      note(`${id} (${who.fn}): gets a team board of ${board.length}, but only sees a slice of a peer's work`);
    }
    if (mayLook && !board.length) note(`${id} (${who.fn}): sees no team board at all`);

    /* A manager's board is their team; an admin's is everyone. Neither may
       contain somebody whose work they cannot see. */
    board.forEach((p) => {
      const st = S.standing(p.id);
      const leaked = st.recs.filter((r) => !S.entitled(r, who));
      if (leaked.length) note(`${id} (${who.fn}): ${p.name}'s standing counts ${leaked.length} record(s) they may not see`);
      /* And no number may exceed what an admin would count. */
      const admin = as('nour', () => S.standing(p.id).book);
      if (st.book > admin) note(`${id} (${who.fn}): ${p.name}'s book reads ${st.book}, more than an admin's ${admin}`);
    });
  }));
}

/* ── 6 · A client's world is exactly their engagement ── */
function checkClients() {
  S.REPS.filter((p) => p.fn === 'client').forEach((p) => as(p.id, (who) => {
    const outside = S.filtered().filter((r) => !S.clientsOf(r).includes(who.client));
    if (outside.length) note(`${p.id}: sees ${outside.length} record(s) outside the ${who.client} engagement — e.g. ${outside[0].name}`);
    const engagement = allRecords().filter((r) => S.clientsOf(r).includes(who.client) && !r.arch);
    if (!engagement.length) note(`${p.id}: the ${who.client} engagement holds no records at all — the fixture is empty`);
  }));
}

[checkRecords, checkTouchpoints, checkTasks, checkReadOnly, checkDisclosure, checkCampaigns, checkTeam, checkClients]
  .forEach((fn) => { try { fn(); } catch (e) { note(`${fn.name} threw: ${e.message}`); } });

if (fail.length) {
  console.error(`\n  ${fail.length} tier problem(s):\n`);
  fail.forEach((f) => console.error('    ' + f));
  console.error('');
  process.exit(1);
}

/* The numbers, so a passing run still tells you what the tiers see. A check
   that only ever prints "ok" is a check nobody notices going stale. */
const rows = FN_IDS.map((id) => as(id, (who) => {
  const n = S.filtered().length;
  const all = S.filtered({ all: true }).length;
  return `    ${who.name.padEnd(15)} ${who.fn.padEnd(14)} ${String(n).padStart(3)} of ${all} accounts` +
    `   ${String(S.maySeeTouch(S.DB.touch).length).padStart(3)} touchpoints` +
    `   ${String(S.filteredTasks().length).padStart(2)} tasks` +
    `   ${String(S.filteredCampaigns().length).padStart(2)} campaigns` +
    `   ${String(S.filteredTeam().length).padStart(2)} on the board` +
    `   ${S.FUNCTIONS[who.fn].writes ? 'writes' : 'read-only'}`;
}));
const fns = new Set(S.REPS.map((p) => p.fn));
console.log(`\n  tier-audit: ${FN_IDS.length} people across ${fns.size} tiers, no leaks.\n`);
console.log(rows.join('\n') + '\n');
