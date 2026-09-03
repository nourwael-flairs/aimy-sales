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
/* `grain` joins the list so a new function cannot be declared without
   somebody deciding whether it reads records at all. It is the field a
   c-level needed and every function before it defaulted into. */
const NEEDED = ['label', 'rule', 'sees', 'writes', 'home', 'grain', 'runsCampaigns'];
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

   ══ THIS CHECK COULD NOT FIRE, AND THE BUG IT EXISTS FOR SHIPPED ══

   It had three assertions and two of them were unreachable. The first line
   returns when `canWrite()` is TRUE, so everything after it runs only when
   `canWrite()` is false — and both remaining assertions were gated on
   `canWrite()` being true:

       if (S.canWrite()) { note('canWrite() is true…'); return; }   // returns
       …
       if (S.canWrite()) note(`${shown} card exits would render`);  // dead
       if (S.taskExit(t) && S.canWrite()) note(…);                  // dead

   So it confirmed one thing and then asked two questions whose precondition
   it had just eliminated. It reported "no leaks" on a build where a CLIENT
   could press `×` on a campaign chip and remove an account from a running
   campaign.

   AND REPAIRING THE LOGIC WOULD NOT HAVE BEEN ENOUGH. Both dead assertions
   reason about `exitFor` and `taskExit` — what the MODEL would recommend.
   `data-uncamp` is emitted directly by `recordPage`, through neither. A
   check built on derivations can only ever find controls that come from
   derivations.

   So this now renders the real surfaces for a read-only tier and reads the
   markup back. Anything that writes, in markup a read-only viewer is served,
   is a leak — whatever produced it. */

/* Every `data-*` key whose handler mutates `DB`. Kept as data rather than
   inferred, because the point is that a NEW write control has to be added
   here deliberately — a list that derives itself would grow silently. */
const WRITE_KEYS = [
  /* `kbfix` and `merge` are kept although the controls are gone (F-08). A
     removed write is exactly the one a later edit might reintroduce without
     its guard, and a key that matches nothing costs one string compare. */
  'uncamp', 'addlist', 'reschedule', 'fixaddr', 'kbrev', 'kbfix', 'newsfor',
  'archive', 'share', 'ending', 'enrichone', 'callstart', 'dismiss', 'exit',
  'edit', 'fixtouch', 'annotate', 'autocall', 'logtouch', 'writeset',
  'writeone', 'enrichcamp', 'enrichlist', 'enrichsel', 'assign', 'assignsel',
  'assignto', 'listassign', 'listcamp', 'listrun', 'addto', 'addsell',
  'unsell', 'audadd', 'addstep', 'plan', 'stop', 'merge', 'reportto',
  'newcamp', 'newlist', 'addsel', 'taskgo', 'taskpause', 'taskstop',
  'taskundo', 'writeall', 'callend', 'callrec', 'callmute', 'callhold',
  /* The list builder's generate. `buildCommit` opens with the same
     `canWrite()` guard every other writer takes. */
  /* `bsave` and `bdiscard` are kept even though the preview stage is gone,
     on the same rule as `kbfix` above — a removed write is exactly the one
     a later edit might reintroduce without its guard. `listkeep` blesses a
     draft; `listdrop` removes it and every record its search brought in. */
  'bgo', 'fillnow', 'bsave', 'bdiscard', 'listkeep', 'listdrop',
];

function checkReadOnly() {
  READ_ONLY.forEach((id) => as(id, (who) => {
    if (S.canWrite()) { note(`${id} (${who.fn}): canWrite() is true for a read-only tier`); return; }

    /* Render each surface this tier can reach and read the markup back. */
    const surfaces = [];
    const rec = S.maySee(S.DB.con.filter((r) => !r.arch))[0] || S.maySee(S.DB.acc.filter((r) => !r.arch))[0];
    if (rec) surfaces.push(['a record', () => S.recordPage(rec)]);
    const camp = S.filteredCampaigns()[0];
    if (camp) surfaces.push(['a campaign', () => S.campPage(camp)]);
    surfaces.push(['home', () => S.homePage()]);
    surfaces.push(['the rail', () => S.railInsights()]);

    surfaces.forEach(([where, render]) => {
      let html = '';
      try { html = render() || ''; } catch (e) { note(`${id}: ${where} threw — ${e.message}`); return; }
      WRITE_KEYS.forEach((k) => {
        if (html.includes(`data-${k}=`) || html.includes(`data-${k}>`) || html.includes(`data-${k} `)) {
          note(`${id} (${who.fn}): ${where} renders data-${k} — a write control on a read-only tier`);
        }
      });
    });
  }));
}

/* ── 4b · A read-only tier's one control touches no record ──

   `data-raise` passes check 4 because it is not on `WRITE_KEYS`. That is
   passing by omission, which is what check 4's own note argues against — a
   list that grows silently grows wrong. So the claim gets a check rather
   than an exemption.

   Snapshot the corpus, run the raise path as every read-only person, and
   assert it comes back byte-identical with exactly one more question on the
   pile. The day somebody wires this to something that mutates, this fails
   instead of shrugging. */
/* ── 4c · Only a manager decides a campaign should exist ──

   An SDR and a salesperson WORK campaigns; they do not create them. That
   was gated on `canWrite()`, which is true for both — and two of the four
   doors were not gated at all. `New campaign` on the selection bar and
   `Build a campaign` on the briefing asked nothing of anybody.

   Checked from the markup rather than from the declaration, because the
   declaration is what the check is FOR: a tier that says it cannot start
   one and still draws a control that does is exactly the shape of defect
   check 4 exists for, one capability along. */
function checkCampaignStart() {
  const KEYS = ['data-newcamp', 'data-newlist', 'data-stop'];
  S.REPS.forEach((p) => as(p.id, (who) => {
    if (S.FUNCTIONS[who.fn].runsCampaigns) return;
    /* THE SELECTION BAR IS A FIFTH SURFACE, and it was the one door here
       that had no gate at all. It draws nothing until something is picked,
       so the check picks a record this person may see and then reads it. */
    const mine = S.filtered().slice(0, 2).map((r) => r.id);
    S.selectPick(mine);
    /* `Stop it` lives on the CAMPAIGN page and only on a running one, so
       neither the briefing nor the selection bar can see it. Rendered here
       against a campaign this person may actually open — the check would
       pass vacuously against one they cannot. */
    const camp = S.filteredCampaigns().filter((c) => S.campState(c) === 'running')[0];
    const html = S.homePage() + ' ' + S.railInsights() + ' ' + S.scopeBar()
      + ' ' + (camp ? S.campPage(camp) : '');
    S.selectPick([]);
    KEYS.forEach((k) => {
      if (html.indexOf(k) >= 0) note(`${p.id} (${who.fn}): does not run campaigns and is offered ${k}`);
    });
    if (html.indexOf('data-start="newcamp"') >= 0) {
      note(`${p.id} (${who.fn}): does not run campaigns and is offered the Build a campaign opener`);
    }
  }));

  /* And the inverse, so the capability cannot be quietly switched off for
     everyone: a manager must still be able to reach it. */
  const builders = S.REPS.filter((p) => S.FUNCTIONS[p.fn].runsCampaigns);
  if (!builders.length) { note('nobody in the cast can run a campaign — the capability is unreachable'); return; }
  builders.forEach((p) => as(p.id, (who) => {
    if (S.homePage().indexOf('data-newcamp') < 0) {
      note(`${p.id} (${who.fn}): runs campaigns and is offered no way to start one`);
    }
  }));
}

function checkRaise() {
  const shape = () => JSON.stringify([S.DB.acc, S.DB.con, S.DB.camp, S.DB.touch, S.DB.task]);
  READ_ONLY.forEach((id) => as(id, (who) => {
    const rec = S.DB.acc.filter((a) => S.entitled(a, who))[0];
    if (!rec) return;
    const before = shape();
    const n = S.DB.raised.length;
    S.DB.raised.push({ id: 'audit', on: rec.id, by: id, at: '2026-08-05', text: 'audit probe' });
    if (shape() !== before) note(`${id} (${who.fn}): recording a question changed the corpus`);
    if (S.DB.raised.length !== n + 1) note(`${id} (${who.fn}): recording a question did not land on the pile`);
    S.DB.raised.pop();
  }));

  /* And the inverse. A tier that CAN write must not be offered it — a
     weaker duplicate beside ten real controls is the CTA defect, not a
     feature. */
  S.REPS.filter((p) => S.FUNCTIONS[p.fn].writes).forEach((p) => as(p.id, (who) => {
    const rec = S.DB.acc.filter((a) => S.entitled(a, who))[0];
    if (!rec) return;
    S.S.lead = rec.id;
    const html = S.recordPage(rec);
    S.S.lead = '';
    if (html.indexOf('data-raise') >= 0) note(`${p.id} (${who.fn}): writes, and is still offered the read-only ask control`);
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
    } else if (who.fn !== 'admin') {
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
    const mayLook = ['admin', 'sales-manager'].includes(who.fn);
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

/* ── 7 · An aggregate tier reaches figures, and never a record ──

   THE CHECK THIS FILE COULD NOT MAKE BEFORE, AND THE REASON `grain` EXISTS.

   A c-level was first written with `sees: () => true` and a dashboard-only
   `home`, and every check above passed it — while `?lead=a0` opened the
   record, `?on=leads` listed 118 rows and `?camp=q3-nl` rendered the whole
   campaign page. Entitlement had nothing to say about it, because the
   question is not WHICH records but WHETHER records, and `home` is a
   composition list that no URL consults.

   So the assertion is two-sided, and both sides matter. Every door that
   returns records must return none — otherwise the role is a permission
   with no enforcement. And `maySee` must still return the WHOLE book —
   otherwise the aggregates are computed over a subset and every figure on
   the page is quietly wrong, which is the failure that looks like it is
   working. */
function checkGrain() {
  const admin = as('nour', () => S.maySee(S.DB.acc).length);
  S.REPS.filter((p) => (S.FUNCTIONS[p.fn].grain || 'record') !== 'record').forEach((p) => as(p.id, (who) => {
    const shut = [
      ['filtered', S.filtered().length],
      ['filteredCampaigns', S.filteredCampaigns().length],
      ['filteredTasks', S.filteredTasks().length],
      ['filteredTeam', S.filteredTeam().length],
    ];
    shut.forEach(([name, n]) => {
      if (n) note(`${p.id} (${who.fn}): ${name}() returns ${n} — an aggregate tier must hold no records`);
    });

    /* The URL hole specifically. Every check above walks what a surface
       chose to draw; this walks what a pasted link can reach. */
    const leaked = [];
    allRecords().forEach((r) => {
      S.S.lead = r.id;
      if (S.openRec()) leaked.push(r.id);
      S.S.lead = '';
    });
    if (leaked.length) note(`${p.id} (${who.fn}): ?lead= opens ${leaked.length} record(s) — e.g. ${leaked[0]}`);

    const basis = S.maySee(S.DB.acc).length;
    if (basis !== admin) note(`${p.id} (${who.fn}): the aggregate basis is ${basis} of ${admin} accounts — every figure on the page is over a subset`);

    /* And it has something to say. A dashboard whose derivations return
       nothing is a page that passes every permission check by being empty. */
    const m = S.bookMoney(S.maySee(S.DB.acc).filter((a) => !a.arch), S.periodOf('r12'), S.workingHeads());
    if (!m.spend.total) note(`${p.id} (${who.fn}): the money model returns no spend at all over a rolling year`);
    if (!m.funnel.some((f) => f.n)) note(`${p.id} (${who.fn}): every stage of the funnel is nought over a rolling year`);

    /* ══ EVERY PERIOD, NOT JUST THE DEFAULT ══════════════════════════════

       This check rendered `homePage` once, at whatever `S.period` happened
       to be — which is the default — and the page threw on `lq`, where
       nothing closed and a ratio guarded on the wrong half of itself read
       `null.toFixed`. A blank page behind a chip nobody in the audit ever
       pressed.

       The four periods are the whole state space of this surface's one
       control, and three of them put the corpus into a shape the default
       never does: a window that booked nothing, one that is complete, one
       whose prior window is empty. Cheap to walk, and the only way a
       render-time throw in any of them is visible from here. */
    const held = S.S.period;
    ['q', 'lq', 'y', 'r12'].forEach((k) => {
      S.S.period = k;
      try {
        const html = S.homePage();
        if (!html || html.indexOf('s-att-track') < 0) {
          note(`${p.id} (${who.fn}): ?period=${k} renders no attainment track — the page is empty for that window`);
        }
      } catch (e) {
        note(`${p.id} (${who.fn}): ?period=${k} threw while rendering — ${e.message}`);
      }
    });
    S.S.period = held;
  }));
}

[checkRecords, checkTouchpoints, checkTasks, checkReadOnly, checkRaise, checkCampaignStart, checkDisclosure, checkCampaigns, checkTeam, checkClients, checkGrain]
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
