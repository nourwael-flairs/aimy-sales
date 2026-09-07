/* ═══════════════════════════════════════════════════════════════════════════
   AiMY SALES — THE BDR BUILD

   One role. A BDR opens this to see two things: people to call, and the
   campaigns they are on. Everything else was cut and comes back when a role
   needs it.

   ── HOW THIS FILE IS ORGANISED ──────────────────────────────────────────────
    1  Helpers            esc, rng, dates
    2  Vocabulary         the ladder, call outcomes, what we sell
    3  The corpus         pools and seed()
    4  The store          seed + delta, localStorage, reset
    5  Derivations        rank, due, callable, counts
    6  The URL            parse / qs / go
    7  Painting           paint, rail, proto, toast
    8  The router         one delegated listener over data-* verbs
    9  Boot

   ── TWO RULES THAT ARE EASY TO BREAK SILENTLY ──────────────────────────────
   THE CHECKPOINT IS STORED. The V3 build derived every status from the
   touchpoints, which made status uncontradictable and unsettable. A BDR ladder
   cannot work that way: "showed up" and "interested" are things a person
   observed, not things a call record implies. So `contact.checkpoint` is a
   field, moved only by `moveFor` (a call) or `setCheckpoint` (a one-press
   control), and every count reads the field.

   THE STORE HOLDS THE DELTA, NOT THE CORPUS. Six thousand contacts and twenty
   thousand calls serialise to several megabytes, past what localStorage will
   take. So the corpus is regenerated from a fixed seed on every load and only
   what you CHANGED is persisted. That is also what makes Reset one line.
   ═══════════════════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  /* ══ 1. HELPERS ═════════════════════════════════════════════════════════ */

  const esc = (s) =>
    String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));

  const $ = (sel, root) => (root || document).querySelector(sel);

  /* The stamp this script was actually loaded under, read off its own tag.
     A build that reports a number it is not is worse than one that reports
     nothing. */
  const BUILD = (function () {
    const t = document.currentScript || document.querySelector("script[src*=bdr.js]");
    const m = t && /[?&]v=([^&]+)/.exec(t.getAttribute("src") || "");
    return m ? "v" + m[1] : "unstamped";
  })();
  const byId = (id) => document.getElementById(id);

  /* Deterministic PRNG (mulberry32), carried over from the V3 build.
     Math.random would give a different corpus every reload, and then no
     count on any surface could be checked twice. */
  function rng(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const pick = (r, arr) => arr[Math.floor(r() * arr.length)];
  const between = (r, lo, hi) => lo + Math.floor(r() * (hi - lo + 1));
  const chance = (r, p) => r() < p;

  /* ── Dates ──
     TODAY is the real clock at load, floored to the day. The corpus is built
     relative to it, so a link opened next month still shows callbacks due
     today rather than a hundred days of overdue. Ids are built from indices
     and never from dates, which is what lets a stored delta survive the
     corpus being regenerated on a different day. */
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const TODAY = (() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; })();
  const DAY_MS = 86400000;

  const dayOf = (n) => new Date(TODAY.getTime() + n * DAY_MS);
  const isoDay = (d) => {
    const p = (x) => String(x).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  };
  const dayAdd = (n) => isoDay(dayOf(n));
  const isoAdd = (iso, n) => isoDay(new Date(new Date(iso + 'T00:00:00').getTime() + n * DAY_MS));
  const TODAY_ISO = isoDay(TODAY);
  const daysBetween = (isoA, isoB) =>
    Math.round((new Date(isoB + 'T00:00:00') - new Date(isoA + 'T00:00:00')) / DAY_MS);

  /* "12 Mar" / "12 Mar 2026" — never numeric. A numeric date is ambiguous
     across regions and slower to read, and this corpus spans EMEA. */
  /* "August 2026" — a heading over a run of days. */
  const monthName = (iso) => {
    const d = new Date(iso.slice(0, 10) + 'T00:00:00');
    const full = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
      'August', 'September', 'October', 'November', 'December'];
    return full[d.getMonth()] + (d.getFullYear() === TODAY.getFullYear() ? '' : ' ' + d.getFullYear());
  };
  const sayDay = (iso) => {
    if (!iso) return '';
    const d = new Date(iso.slice(0, 10) + 'T00:00:00');
    const s = d.getDate() + ' ' + MONTHS[d.getMonth()];
    return d.getFullYear() === TODAY.getFullYear() ? s : s + ' ' + d.getFullYear();
  };
  /* Relative where relative is what a caller means, absolute otherwise. */
  const sayWhen = (iso) => {
    const n = daysBetween(TODAY_ISO, iso.slice(0, 10));
    if (n === 0) return 'today';
    if (n === 1) return 'tomorrow';
    if (n === -1) return 'yesterday';
    if (n < 0 && n > -7) return Math.abs(n) + ' days ago';
    if (n > 0 && n < 7) return 'in ' + n + ' days';
    return sayDay(iso);
  };
  /* HOW LONG AGO, ALWAYS RELATIVE. `sayWhen` falls back to the date past a
     week, which is right inside a sentence and wrong in a column beside the
     date itself: the call history printed "16 Aug · Omar Fathy · Callback ·
     16 Aug" — the same fact twice with three hundred pixels between the
     copies. Weeks rather than days past a fortnight, because "37 days ago" is
     a number you have to convert before it means anything. */
  const sayAgo = (iso) => {
    const n = -daysBetween(TODAY_ISO, iso.slice(0, 10));
    if (n <= 0) return 'today';
    if (n === 1) return 'yesterday';
    if (n < 7) return n + ' days ago';
    if (n < 14) return 'last week';
    if (n < 60) return Math.round(n / 7) + ' weeks ago';
    return Math.round(n / 30) + ' months ago';
  };

  /* ══ WRITTEN WITHOUT A REGEX, AND ON PURPOSE ═══════════════════════════
     This was `replace(/\B(?=(\d{3})+(?!\d))/g, ',')` and the shell on this
     machine ate the backslashes out of it — twice, through a quoted heredoc
     that is supposed to pass text through untouched. What was left,
     `/B(?=(d{3})+(?!d))/`, is a VALID regular expression that matches nothing,
     so every number in the product silently lost its separators and no check
     could see it. Same family as the sed trap: an edit tool that rewrites a
     file through a shell is an edit tool that can quietly change what the
     file says. A loop has nothing to lose. */
  const commas = (n) => {
    const s = String(n);
    let out = '';
    for (let i = 0; i < s.length; i++) {
      out += s[i];
      const left = s.length - 1 - i;
      if (left > 0 && left % 3 === 0) out += ',';
    }
    return out;
  };

  /* The irregulars live here rather than at the call sites. `plural` takes a
     second word for the plural, and every place that says "person" has to
     remember to pass it — which is one place forgetting away from "105
     persons", and that is exactly what the first cut of the briefing said. */
  const IRREGULAR = { person: 'people', is: 'are', has: 'have', it: 'they', this: 'these' };
  const plural = (n, one, many) =>
    commas(n) + ' ' + (n === 1 ? one : (many || IRREGULAR[one] || one + 's'));
  /* The verb alone, for a sentence that already carries its own number. */
  const verbFor = (n, one) => (n === 1 ? one : IRREGULAR[one] || one + 's');

  /* ══ 2. VOCABULARY ══════════════════════════════════════════════════════ */

  /* ══ THE LADDER — where one lead stands with this BDR ══════════════════
     Eight rungs and three exits, taken straight off the BDR process diagram:
     you call, they answer or they do not, a meeting gets set, they show up,
     they are interested, and you hand them to the director. Past the handover
     it is not a BDR's lead any more, which is why the ladder stops there.

     ORDER IS MEANING. `rank` is the index, and everything that decides
     whether a call moves a lead compares indices. Insert a rung in the middle
     and every stored checkpoint below it keeps its NAME and changes its
     POSITION — so add at the end, or renumber deliberately. */
  const LADDER = [
    { k: 'not-called',  label: 'Not called',   tone: 'neutral', say: 'nobody has rung them yet' },
    { k: 'no-answer',   label: 'No answer',    tone: 'neutral', say: 'rung, nobody picked up' },
    { k: 'callback',    label: 'Callback',     tone: 'warn',    say: 'they asked to be rung back' },
    { k: 'answered',    label: 'Answered',     tone: 'ok',      say: 'you got them on the phone' },
    { k: 'meeting-set', label: 'Meeting set',  tone: 'ok',      say: 'time in a diary' },
    { k: 'showed-up',   label: 'Showed up',    tone: 'ok',      say: 'they came to the meeting' },
    { k: 'interested',  label: 'Interested',   tone: 'ok',      say: 'they want to go further' },
    { k: 'handed-over', label: 'Handed over',  tone: 'ok',      say: 'with the director' },
  ];
  /* The ways out. Not rungs: a lead does not climb to "declined", it leaves. */
  const EXITS = [
    { k: 'declined',     label: 'Declined',      tone: 'neutral', say: 'they said no' },
    { k: 'wrong-number', label: 'Wrong number',  tone: 'warn',    say: 'the number is not theirs' },
    { k: 'do-not-call',  label: 'Do not call',   tone: 'err',     say: 'they opted out' },
  ];
  const RUNG = Object.create(null);
  LADDER.forEach((x, i) => (RUNG[x.k] = Object.assign({ n: i }, x)));
  EXITS.forEach((x) => (RUNG[x.k] = Object.assign({ n: -1 }, x)));
  const rank = (k) => (RUNG[k] ? RUNG[k].n : 0);
  const isExit = (k) => rank(k) < 0;
  const rungLabel = (k) => (RUNG[k] ? RUNG[k].label : k);

  /* ══ WHAT HAPPENED ON A CALL ═══════════════════════════════════════════
     Seven, and the keys are the V3 build's so every ported lexicon still
     reads. `writes` says whether it counts as having reached them: ringing
     out is not contact, and counting it would move a lead for a call nobody
     answered. Voicemail is deliberately absent — the reader folds voicemail,
     answerphone and rang-out into no-answer, so writing "left a voicemail"
     ticks Not connected without anybody choosing an eighth button. */
  const OUTCOMES = [
    { k: 'reached',        label: 'Connected',      key: '1', tone: 'ok',      writes: true },
    { k: 'callback',       label: 'Callback',       key: '2', tone: 'ok',      writes: true },
    { k: 'no-answer',      label: 'No answer',      key: '3', tone: 'neutral', writes: false },
    { k: 'gatekeeper',     label: 'Gatekeeper',     key: '4', tone: 'warn',    writes: true },
    { k: 'not-interested', label: 'Not interested', key: '5', tone: 'neutral', writes: true },
    { k: 'wrong-number',   label: 'Wrong number',   key: '6', tone: 'warn',    writes: true },
    { k: 'do-not-call',    label: 'Do not call',    key: '7', tone: 'err',     writes: true },
  ];
  const OUTCOME = Object.create(null);
  OUTCOMES.forEach((o) => (OUTCOME[o.k] = o));

  /* What you asked for. The one thing on a call the next person cannot
     reconstruct: whether anybody actually asked for the meeting exists
     nowhere unless the person who asked writes it down. `next` names the
     follow-up it implies, so the surface can offer to book what you proposed. */
  const PROPOSALS = [
    { k: 'meeting',  label: 'A meeting',           next: 'Meeting with them' },
    { k: 'demo',     label: 'A demo',              next: 'Demo for them' },
    { k: 'proposal', label: 'A proposal',          next: 'Proposal to them' },
    { k: 'info',     label: 'Send them something', next: 'Send what was promised' },
    { k: 'callback', label: 'Another call',        next: 'Call them back' },
    { k: 'other',    label: 'Something else',      next: 'Do what you said you would' },
  ];
  const PROPOSAL = Object.create(null);
  PROPOSALS.forEach((p) => (PROPOSAL[p.k] = p));

  const OBJECTIONS = [
    { k: 'feature', label: 'Features', blurb: 'It does not do something they need.' },
    { k: 'service', label: 'Services', blurb: 'We do not offer something they need.' },
    { k: 'pricing', label: 'Pricing',  blurb: 'It costs more than it is worth to them.' },
    { k: 'timing',  label: 'Timing',   blurb: 'Right thing, wrong quarter.' },
    { k: 'other',   label: 'Something else', blurb: 'Recorded, and not one of the above.' },
  ];
  const OBJECTION = Object.create(null);
  OBJECTIONS.forEach((o) => (OBJECTION[o.k] = o));

  const OPENINGS = [
    { k: 'funded',       label: 'Just funded' },
    { k: 'job-change',   label: 'Champion moved' },
    { k: 'promotion',    label: 'Champion promoted' },
    { k: 'new-hire',     label: 'New decision-maker' },
    { k: 'hiring',       label: 'Hiring into it' },
    { k: 'visited-site', label: 'On our site' },
    { k: 'renewal-near', label: 'Renewal near' },
    { k: 'other',        label: 'Something opened' },
  ];
  /* ══ NOT EVERY TOUCHPOINT IS A CALL ════════════════════════════════════
     Two of them are not: a rung somebody settled by hand, and the company
     profile going out after a call that went nowhere. Both are written to
     the record as touchpoints because that is what they are, and both need
     a name — without one the history printed the raw key, `sent`, in the
     slot where every other row says how a call went. */
  const KINDS = { checkpoint: 'Moved by hand', sent: 'Profile sent' };

  /* ══ WHAT IS IN THE CORPUS, AND WHEN IT GOES OUT ══════════════════════
     Four kinds of document sit behind a campaign. The name says which one
     it is; this says what it is for, which is the part a caller has to
     decide in the second before they offer it. */
  const RES_KIND = {
    deck: { label: 'One pager', is: 'What it is, what it costs them today, and what changes.',
      use: 'The thing to offer on a first call that went well but not to a meeting.' },
    pricing: { label: 'Pricing', is: 'What it costs, and what it is measured against.',
      use: 'Send it when price is the thing in the way — never before it comes up.' },
    case: { label: 'Case study', is: 'Somebody in their sector who did this, and what it did for them.',
      use: 'Send it when they want proof more than detail.' },
    faq: { label: 'Questions', is: 'The questions this audience asks, answered plainly.',
      use: 'Send it when the objection was a question wearing an objection’s clothes.' },
  };
  const docOut = () => '<svg class="b-doc-out" viewBox="0 0 24 24" width="12" height="12" fill="none" ' +
    'stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M14 4h6v6"/><path d="M20 4l-8.5 8.5"/><path d="M18 14.5V19a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h4.5"/></svg>';
  /* One chip, wherever a document is offered. */
  function docChip(campId, i, r) {
    return '<button class="b-doc" type="button" data-doc="' + esc(campId + ':' + i) + '">' +
      esc(r.name) + docOut() + '</button>';
  }
  /* ══ AFTER THE HAND-OVER, THE DIRECTOR'S FOUR MEETINGS ═════════════════
     Discovery, proof, commercial, resolution — the flowchart's second half.
     None of them is the BDR's to run; all of them happen to a lead the BDR
     produced. The record carries each as a touchpoint by the director, so
     the person who handed them over can watch the story close. */
  const PHASES = [
    { k: 'discovery',  label: 'Discovery meeting',  did: 'went deeper into what needs developing' },
    { k: 'proof',      label: 'Proof meeting',      did: 'showed the solution and how we can help' },
    { k: 'commercial', label: 'Commercial meeting', did: 'put the proposal and the prices on the table' },
    { k: 'resolution', label: 'Resolution',         did: 'took the final decision' },
  ];
  const PHASE = Object.create(null);
  PHASES.forEach((x) => (PHASE[x.k] = x));

  /* ══ THE STAGES ARE THOSE MEETINGS, PLUS THE TWO ENDS ═══════════════════
     Not a second ladder — the same four meetings, named as the places a deal
     stands between them, with Qualification for a lead that has been handed
     over and not yet spoken to, and the resolution split into its two
     answers because an outcome is not a stage you pass through.

     THE LIVE STAGES ARE ALL NEUTRAL. Every CRM gives each stage its own
     hue, and five colours mean nothing until they have been learnt; the tone
     is spent on the two things that are already a good or a bad outcome
     everywhere else in this product. */
  const DEAL_STAGES = [
    { k: 'qual',       label: 'Qualification', tone: 'neutral' },
    { k: 'discovery',  label: 'Discovery',     tone: 'neutral' },
    { k: 'proof',      label: 'Proof',         tone: 'neutral' },
    { k: 'commercial', label: 'Commercial',    tone: 'neutral' },
    { k: 'won',        label: 'Won',           tone: 'ok' },
    { k: 'lost',       label: 'Lost',          tone: 'err' },
  ];
  const DEAL_STAGE = Object.create(null);
  DEAL_STAGES.forEach((x, i) => { DEAL_STAGE[x.k] = x; x.n = i; });
  const stageRank = (k) => (DEAL_STAGE[k] ? DEAL_STAGE[k].n : 0);

  /* What a deal is worth, from what the campaign sells and how big they are.
     Stated as modelled wherever it is shown: nobody has typed a number on
     these records, and a figure with no basis is the invention this build
     refuses everywhere else. Off the id, so it is the same on every
     machine and never moves under a repaint. */
  const PRICE = {
    voice: [18000, 42000, 90000], qa: [15000, 36000, 78000],
    know: [12000, 30000, 66000],  support: [24000, 60000, 132000],
    test: [21000, 48000, 105000], eng: [36000, 84000, 180000],
    data: [15000, 39000, 84000],  back: [18000, 45000, 96000],
  };
  const priceBand = (n) => (n < 200 ? 0 : n < 1000 ? 1 : 2);
  /* Thousands to a whole number, millions to one decimal. A book worth two
     and a quarter million read as €2256k, which is a figure you have to
     count the digits of to take in. */
  const euro = (n) => '€' + (n >= 1000000 ? (Math.round(n / 100000) / 10) + 'm'
    : n >= 1000 ? Math.round(n / 1000) + 'k' : String(n));
  const kindLabel = (t) => (OUTCOME[t.outcome] ? OUTCOME[t.outcome].label
    : t.outcome === 'phase' ? ((PHASE[t.phase] || {}).label || t.phase)
    : KINDS[t.outcome] || (t.moved ? rungLabel(t.moved[1]) : t.outcome));

  const OPENING = Object.create(null);
  OPENINGS.forEach((o) => (OPENING[o.k] = o));
  const openLabel = (k) => (OPENING[k] ? OPENING[k].label : k);

  /* What we sell. Eight offerings; a campaign carries one or two. */
  /* A caller is asked what this is on nearly every connected call, and
     "a product or a service?" is the form the question takes. It was not
     written down anywhere, so the answer came out different every time. */
  const SELLS = [
    { k: 'voice',   name: 'AiMY Voice',              kind: 'product',
      blurb: 'an AI voice agent that answers, qualifies and books' },
    { k: 'qa',      name: 'AiMY QA',                 kind: 'product',
      blurb: 'quality scored on every conversation, not on a sample' },
    { k: 'know',    name: 'AiMY Knowledge',          kind: 'product',
      blurb: 'one answer surface over documentation nobody can find' },
    { k: 'support', name: 'Managed customer support', kind: 'service',
      blurb: 'a support team we run for you, in your tone of voice' },
    { k: 'test',    name: 'QA and test automation',  kind: 'service',
      blurb: 'a test suite, and the engineers who keep it green' },
    { k: 'eng',     name: 'Engineering teams',       kind: 'service',
      blurb: 'engineers embedded in your team, on EU hours' },
    { k: 'data',    name: 'Data annotation',         kind: 'service',
      blurb: 'labelled data at volume, with an accuracy guarantee' },
    { k: 'back',    name: 'Finance and back office', kind: 'service',
      blurb: 'invoicing, reconciliation and reporting, run for you' },
  ];
  const SELL = Object.create(null);
  SELLS.forEach((s) => (SELL[s.k] = s));

  /* ══ WHOSE BOOK THIS IS ═════════════════════════════════════════════════
     Most of these campaigns are ours. Some are run for somebody who pays us
     to open a market they cannot reach — and on those the caller is not
     speaking for AiMY, which changes the first sentence out of their mouth
     and everything they can promise. The page never said which was which.
     A client brings its own offer; the AiMY-branded products are our book. */
  const CLIENTS = [
    { k: 'norvant', name: 'Norvant Data', sells: ['data'],
      what: 'training-data operations. We find the teams still labelling by hand' },
    { k: 'harlow', name: 'Harlow Delivery', sells: ['back'],
      what: 'back-office delivery. Their offer, our callers, their diary' },
    { k: 'peregrin', name: 'Peregrin Labs', sells: ['test', 'eng'],
      what: 'engineering and test capacity. We source and qualify; they take it from the meeting' },
    { k: 'ostend', name: 'Ostend Care', sells: ['support'],
      what: 'outsourced customer support. We open the market and hand every meeting over' },
  ];
  const CLIENT = Object.create(null);
  CLIENTS.forEach((c) => (CLIENT[c.k] = c));

  /* ══ WHO WE ASK FOR, AND WHY THEY WOULD TAKE THE CALL ═══════════════════
     The one thing every caller has to know before dialling and the one thing
     the campaign page never carried: the job title to ask reception for, and
     the state of affairs that makes this worth their eight minutes. */
  const ASK_OF = {
    voice: 'whoever owns the contact centre',
    qa: 'whoever owns quality',
    know: 'whoever owns internal documentation',
    support: 'the head of customer support',
    test: 'the head of engineering',
    eng: 'the VP of engineering',
    data: 'whoever owns the model pipeline',
    back: 'the finance director',
  };
  const WHY_NOW = {
    voice: 'the queue is longer than the team answering it, and they are hiring to fix that',
    qa: 'they listen to a handful of calls a week and call that quality',
    know: 'the same question gets three different answers from three people',
    support: 'support is covered by people whose actual job is something else',
    test: 'they are shipping on a cadence they cannot staff',
    eng: 'they are hiring engineers faster than they can onboard them',
    data: 'labelling is being done by the team that is meant to be modelling',
    back: 'month-end takes a week and nobody can say why',
  };

  const INDUSTRIES = [
    { k: 'software',    label: 'Software' },
    { k: 'banking',     label: 'Banking & finance' },
    { k: 'logistics',   label: 'Logistics' },
    { k: 'health',      label: 'Healthcare' },
    { k: 'retail',      label: 'Retail' },
    { k: 'energy',      label: 'Energy & utilities' },
    { k: 'public',      label: 'Public & education' },
    { k: 'telecom',     label: 'Telecom' },
    { k: 'industry',    label: 'Manufacturing' },
    { k: 'hospitality', label: 'Hotels & hospitality' },
  ];
  const INDUSTRY = Object.create(null);
  INDUSTRIES.forEach((i) => (INDUSTRY[i.k] = i));

  const REGIONS = [
    { k: 'nl',     label: 'Netherlands',  cc: ['NL'] },
    { k: 'be',     label: 'Belgium',      cc: ['BE'] },
    { k: 'dach',   label: 'DACH',         cc: ['DE', 'AT', 'CH'] },
    { k: 'nordic', label: 'Nordics',      cc: ['DK', 'SE', 'NO', 'FI'] },
    { k: 'fr',     label: 'France',       cc: ['FR'] },
    { k: 'ie',     label: 'Ireland',      cc: ['IE'] },
    { k: 'iberia', label: 'Iberia',       cc: ['ES', 'PT'] },
    { k: 'it',     label: 'Italy',        cc: ['IT'] },
    { k: 'cee',    label: 'Central Europe', cc: ['PL', 'CZ'] },
  ];
  const REGION = Object.create(null);
  REGIONS.forEach((x) => (REGION[x.k] = x));

  /* The cast: one caller and one manager, the two desks a lead passes
     between. Every draw below stays a draw whatever the length of what it
     draws from — the generator is a single cursor, and a call skipped here
     moves every account, contact and touchpoint after it. */
  const REPS = [
    { id: 'engy',   name: 'Engy Saleh',    initials: 'ES', fn: 'bdr' },
    { id: 'lina',   name: 'Lina Haddad',   initials: 'LH', fn: 'sales-manager' },
  ];
  const REP = Object.create(null);
  REPS.forEach((r) => (REP[r.id] = r));
  const BDRS = REPS.filter((r) => r.fn === 'bdr');
  const MANAGERS = REPS.filter((r) => r.fn === 'sales-manager');
  const DEFAULT_ME = 'engy';
  const me = () => REP[S.as] || REP[DEFAULT_ME];
  /* Two jobs work this product and they want opposite halves of it: a caller
     works a queue of people nobody has spoken to, a manager works the leads
     that queue has already produced. One predicate, read everywhere, so no
     surface has to be told twice which desk it is being read from. */
  const isMgr = () => me().fn === 'sales-manager';

  const AIMY = { id: 'aimy', name: 'AiMY', initials: 'AI' };
  const actor = (id) => REP[id] || (id === 'aimy' ? AIMY : { id: id, name: id, initials: '?' });

  /* ══ A FACE, NOT A MONOGRAM ═════════════════════════════════════════════
     Four surfaces drew a person as two letters in a coloured circle — the
     masthead, the hand-over menu, the note somebody left, and your own turn
     in the canvas. Nobody's colleague is "LH". Two letters are what a
     product draws when it has no picture and has not decided to get one.

     Drawn rather than fetched: a ground, shoulders, a head and a hair shape,
     every part picked off the person's own id, so the same person wears the
     same face on every surface and the set needs no network to render. A
     photograph would be one request per avatar for a build that runs from a
     folder, and a broken image is worse than a drawn one. */
  /* Skin and hair are picked as a PAIR, never independently: two of the
     thirty-six free combinations put ash hair on the palest skin, and that
     face had no hair at all on screen. */
  const AV_LOOK = [
    { skin: '#f2cdaa', hair: '#4a3520' }, { skin: '#e8b68f', hair: '#191512' },
    { skin: '#cd8d60', hair: '#2e2419' }, { skin: '#aa6e47', hair: '#191512' },
    { skin: '#8d5a3b', hair: '#2e2419' }, { skin: '#6b4229', hair: '#120f0d' },
    { skin: '#f2cdaa', hair: '#a35f27' }, { skin: '#e8b68f', hair: '#9c938b' },
  ];
  const AV_WEAR = ['#41608e', '#4b6b55', '#7c4a58', '#4b4a60', '#8a6b3c', '#31606c'];
  const AV_LAND = ['#c6d8ec', '#cfe0d3', '#eed7db', '#dcdbe6', '#ecdfca', '#cbe0e6'];
  /* Seven heads of hair. The silhouette is the whole of it — anything finer
     than a millimetre is mush at twenty-four pixels — so the set varies where
     the outline goes rather than what is inside it: a crop, a dome, hair past
     the shoulders, a bun that breaks the circle, a bob, a parting, a cap. */
  const AV_TOP = [
    'M7.3 10.4a4.7 4.7 0 0 1 9.4 0c.1-2-1.9-3.1-4.7-3.1s-4.8 1.1-4.7 3.1z',
    'M6.2 10.9a5.8 5.8 0 0 1 11.6 0c0-2.1-2.6-3.3-5.8-3.3s-5.8 1.2-5.8 3.3z',
    'M6.8 19.2V10a5.2 5.2 0 0 1 10.4 0v9.2h-2.1V9.9c0-1.4-1.4-2.3-3.1-2.3S8.9 8.5 8.9 9.9v9.3z',
    'M7.3 10.4a4.7 4.7 0 0 1 9.4 0c.1-2-1.9-3.1-4.7-3.1s-4.8 1.1-4.7 3.1zM16.7 7.4a1.9 1.9 0 1 0 0-3.8 1.9 1.9 0 0 0 0 3.8z',
    'M7 14.1V10a5 5 0 0 1 10 0v4.1h-1.9V9.9c0-1.3-1.4-2.2-3.1-2.2S8.9 8.6 8.9 9.9v4.2z',
    'M7.3 10.7c0-3.1 2.1-4.9 4.7-4.9 2.3 0 4.2 1.3 4.7 3.5-1.5-1.3-3.6-1.8-5.7-1.5-1.8.3-3.1 1.2-3.7 2.9z',
    'M7.3 10.4a4.7 4.7 0 0 1 9.4 0c0-2.8-2.1-4.3-4.7-4.3s-4.7 1.5-4.7 4.3z',
  ];
  /* ══ THE PHOTOGRAPH ════════════════════════════════════════════════════
     One picture per person on the team, fixed by hand rather than drawn
     from a hash: there are nine of them and a name carries an expectation
     that a coin flip does not meet. Anyone the map does not name falls back
     to the hash, which is what a corpus of six thousand leads needs.

     The drawing stays underneath. A photograph is a request over the
     network, and this build runs out of a folder — when the request fails
     the image collapses and the face that was always there shows through,
     rather than nine broken-image marks across the masthead. */
  const AV_PIC = {
    engy: 'women/44', lina: 'women/65',
  };
  function faceOf(id, px) {
    const h = Math.abs(hash(String(id) + ':face'));
    const look = AV_LOOK[h % AV_LOOK.length];
    const wear = AV_WEAR[(h >> 3) % AV_WEAR.length];
    const land = AV_LAND[(h >> 6) % AV_LAND.length];
    const top = AV_TOP[(h >> 9) % AV_TOP.length];
    const pic = AV_PIC[id] || ((h & 1 ? 'men/' : 'women/') + (h % 90));
    return '<span class="b-face" style="width:' + px + 'px;height:' + px + 'px">' +
      '<svg viewBox="0 0 24 24" width="100%" height="100%" ' +
      'aria-hidden="true" focusable="false">' +
      '<circle cx="12" cy="12" r="12" fill="' + land + '"/>' +
      '<path d="M10.4 12.4h3.2v3.6h-3.2z" fill="' + look.skin + '"/>' +
      '<path d="M4.4 21.3a12 12 0 0 0 15.2 0c-.7-3.7-3.9-6.5-7.6-6.5s-6.9 2.8-7.6 6.5z" ' +
        'fill="' + wear + '"/>' +
      /* The collar is what makes the mound below the head read as a shirt
         rather than as the shoulders of a stock user glyph. */
      '<path d="M12 18.1l-2.1-2.9 2.1-.5 2.1.5z" fill="#fff" opacity="0.22"/>' +
      '<circle cx="12" cy="10.2" r="4.6" fill="' + look.skin + '"/>' +
      '<circle cx="10.3" cy="10.3" r="0.62" fill="#241a13" opacity="0.72"/>' +
      '<circle cx="13.7" cy="10.3" r="0.62" fill="#241a13" opacity="0.72"/>' +
      '<path d="' + top + '" fill="' + look.hair + '"/>' +
    '</svg>' +
    '<img class="b-face-img" src="https://randomuser.me/api/portraits/' + pic + '.jpg" ' +
      'alt="" loading="lazy" width="' + px + '" height="' + px + '">' +
    '</span>';
  }

  /* WHO DID IT. `by` is who pressed the button; a call AiMY placed is
     AiMY's, as the run says it will be, and the record reads that way. */
  const whoDid = (t) => (t.auto ? AIMY : actor(t.by));

  /* ── Two names the ported reader expects ──
     The V3 build calls these `shift` and `iso`; this one calls them `dayOf`
     and `isoDay`. Adapters rather than edits: the reader is ported verbatim
     so it can be diffed against its original, and a rename inside it is the
     first step towards two readers that quietly disagree. */
  const shift = (d, n) => new Date(d.getTime() + n * DAY_MS);
  const iso = (d) => isoDay(d);

  /* How a call reads at a glance, on the four-value axis the V3 build used
     for every channel. This build stores the call's own disposition and does
     not carry that second axis as a field — but the reader returns it, and a
     sentence that says "booked a demo" without naming a disposition is the
     one case where it is the only thing that knows the call went well. */
  const callToOutcome = (k) =>
    k === 'reached' || k === 'callback' ? 'positive'
      : k === 'no-answer' ? 'no-answer'
      : k === 'not-interested' || k === 'do-not-call' ? 'negative' : 'neutral';

  /* ══ THE READING — one sentence in, four axes out ═════════════════════

     Ported from the V3 build unchanged, lexicons and all. It turns what a
     caller types — "reception would not put me through, pricing came up" —
     into a disposition, what was asked for, what was pushed back on and
     what opened up. It is the reason logging a call is a sentence rather
     than a form: AiMY reads it and shows what it read, and you agree in a
     word or correct it in another sentence.

     ORDER IS THE RANKING inside each lexicon — first match wins — so the
     specific phrasings sit above the general ones. That is also why a
     correction is read ALONE rather than appended to the transcript: read
     together, a gatekeeper heard on the call would beat "actually I spoke
     to her" for ever, and the more you insisted the less it would listen.
  ══════════════════════════════════════════════════════════════════════ */
  /* ORDERED, AND THE ORDER IS THE RANKING — first match wins, so the
     specific phrasings sit above the general ones. "Spoke to reception" is a
     gatekeeper and not a conversation; "do not call again" is not merely
     disinterest; a wrong number is not a call nobody picked up. Same rule
     `TAX` states about its own lists, and for the same reason: a ranking has
     to live somewhere, and a lexicon sorted by accident ranks by accident. */
  const READ_DISP = [
    [/\b(do not call|do not ring|do not contact|take me off|take us off|remove me|remove us|stop calling|never call|opted out|opt out)\b/, 'do-not-call'],
    [/\b(wrong number|wrong extension|number is wrong|not her number|not his number|not their number|no longer in service|dead line)\b/, 'wrong-number'],
    [/\b(gatekeeper|reception|receptionist|switchboard|front desk|secretary|assistant|pa|screened|not put me through|get past|take a message|who is calling|put you through|she is in|he is in|in workshops|in meetings all)\b/, 'gatekeeper'],
    [/\b(no answer|no one answered|nobody answered|nobody picked up|did not answer|did not pick up|voicemail|voice mail|answerphone|answering machine|rang out|busy tone|engaged tone|left a message|no show|no-show|did not show)\b/, 'no-answer'],
    [/\b(call back|called back|callback|call me back|ring back|call again|try again|another call|call her back|call him back|call them back|asked me to call)\b/, 'callback'],
    [/\b(not interested|no thanks|not for us|not a fit|declined|hung up|brushed me off|no appetite)\b/, 'not-interested'],
    [/\b(spoke|talked|chatted|got through|reached her|reached him|reached them|good|good chat|good conversation|went well|positive|keen|interested|promising|receptive|open to)\b/, 'reached'],
  ];

  /* IN `TAX.proposal`'s OWN ORDER, because the FIRST proposal is the one that
     names the next step — so the order this reads in is the order that
     decides what lands on the record, and a second ranking invented here
     would schedule a different follow-up than the chips imply. */
  /* ══ THESE READ TWO VOICES NOW, AND THEY WERE WRITTEN FOR ONE ═════════════

     Every pattern below was tuned for a REP'S NOTE — the reporting voice.
     "She would not put me through." "Call her back Thursday." "We do not
     offer that." Then `Read the call` started handing them a TRANSCRIPT,
     which is the speaking voice and says the same things differently: a
     gatekeeper does not report being a gatekeeper, she says *"Can I take a
     message?"*; nobody on a call says "send them the deck", they say *"send
     me that"*.

     So each lexicon gains the spoken form of what it already looks for.
     Nothing new is recognised — the same five proposals, the same five
     obstacles — they are simply recognised when said out loud as well as
     when written down. The alternative was a fixture written to match the
     patterns, which is teaching to the test. */
  const READ_PROP = [
    [/\b(meeting|meet|sit down|in the diary|book a time|coffee|half an hour|half hour|thirty minutes)\b/, 'meeting'],
    [/\b(demo|demonstration|walkthrough|walk through|show them|see it working)\b/, 'demo'],
    [/\b(proposal|quote|quotation|statement of work|sow|rate card)\b/, 'proposal'],
    [/\b(deck|case study|one pager|one-pager|brochure|price list|pricing page|materials|send the|send her|send him|send them|send it|send over|email over|forward it|send me|send us|email me|email us)\b/, 'info'],
    [/\b(call back|callback|ring back|call again|another call|try again|call her back|call him back|call them back|try her back|try him back|try me back)\b/, 'callback'],
  ];

  const READ_OBJ = [
    [/\b(feature|features|does not do|cannot do|can not do|no api|does not support|not able to|functionality|integration)\b/, 'feature'],
    [/\b(we do not offer|we do not provide|out of scope|not something we do|no capacity|we cannot cover)\b/, 'service'],
    [/\b(price|prices|pricing|cost|costs|expensive|budget|too much|cheaper|day rate|rates)\b/, 'pricing'],
    [/\b(timing|not now|next quarter|next year|later in the year|too early|busy period|revisit|already committed|freeze|q1|q2|q3|q4)\b/, 'timing'],
    [/\b(pushed back|objected|not convinced|reservations|hesitant)\b/, 'other'],
  ];

  const READ_OPP = [
    [/\b(raised|funding|funded|series a|series b|series c|series d|investment round|new investor|closed a round)\b/, 'funded'],
    [/\b(moved to|new role|left for|joining|changed jobs|has moved|starts at)\b/, 'job-change'],
    [/\b(promoted|promotion|stepped up|now heads|took over as)\b/, 'promotion'],
    [/\b(new cto|new cio|new coo|new head of|new director|new vp|new manager|just hired|joined last month)\b/, 'new-hire'],
    [/\b(hiring|recruiting|vacancy|vacancies|job ad|growing the team|headcount|taking on)\b/, 'hiring'],
    [/\b(on our site|visited our|our website|downloaded|looked at our|read our)\b/, 'visited-site'],
    [/\b(renewal|renew|contract ends|contract is up|notice period|up for renewal)\b/, 'renewal-near'],
  ];


  /* ══ WHEN NOTHING ON THE LIST FITS, THE LIST GROWS ═════════════════════

     The lexicons above read a sentence for values this product already has a
     name for. Real calls produce things it does not: their legal team wants
     to see a DPA first, they asked for a reference from a bank the same size,
     the blocker is an internal system nobody has heard of. All of that used
     to land nowhere — the reading came back empty on that axis, the chips sat
     untouched, and the only trace was the note.

     THESE READ THE FRAME, NOT THE VALUE. A lexicon asks "does the sentence
     contain 'pricing'". These ask "does the sentence say somebody pushed back
     on SOMETHING", and take the something. That is what makes it a reading
     rather than a guess: the sentence itself says which axis it is talking
     about — "pushed back on X" is an obstacle whatever X turns out to be, and
     "asked me for X" is a proposal. Nothing is inferred from a bare phrase,
     because a bare phrase does not say which axis it belongs to and inventing
     one would be exactly the guess this reader refuses everywhere else.

     They fire ONLY where the axis came back empty. A sentence that says
     "pushed back on the price" has already been read as Pricing; adding a
     second chip saying "the price" would be the same fact twice, once in a
     shape nothing can count.

     WHERE THE WORDS GO. Each axis has a "Something else" chip — obstacle
     always did, proposal and opportunity now do — and the chip takes the
     words as its label. So the filters and the counts see a real axis value
     they can add up, and the rep sees what was actually said. A free-text key
     on an axis would have given the second and destroyed the first. */
  const READ_FRAME = [
    ['objection', /\b(?:pushed back on|push back on|objected to|worried about|concerned about|nervous about|stuck on|blocked by|the (?:problem|issue|blocker|sticking point|hold ?up) (?:is|was)|not happy (?:with|about))\s+([^.,;—–]+)/i],
    ['proposal', /\b(?:asked (?:me )?(?:for|to)|asked whether we could|wants us to|wanted us to|would like us to|requested|i offered to|offered to|promised to|agreed to)\s+([^.,;—–]+)/i],
    /* Tighter than the other two, and deliberately. "They are" and "they just"
       open a good-news clause and a bad-news one equally well, so only the
       cues that cannot be anything but news are here. The guard below does
       the rest. */
    ['opportunity', /\b(?:good news[:,]?|worth knowing[:,]?|they (?:have )?just|they are about to|they told me they(?:'| a)re)\s+([^.,;—–]+)/i],
  ];

  /* A phrase only becomes a chip if it is short enough to BE one and long
     enough to mean something. Four words is where a captured clause stops
     being a label and starts being a sentence somebody has to read twice, so
     it is trimmed there and the whole of it stays in the note either way. */
  const saidPhrase = (s) => {
    const w = String(s || '').trim().replace(/\s+/g, ' ').split(' ');
    if (w.length < 2) return null;
    const cut = w.slice(0, 6);
    return (cut.join(' ') + (w.length > 6 ? '…' : '')).replace(/^./, (c) => c.toUpperCase());
  };
  /* THE READING, AND IT IS THE ONLY ONE IN THIS FILE. `readTouch` — the float
     bar's reader, which has turned a sentence into a touchpoint since v3 — is
     now a projection of this rather than a second lexicon beside it. Two
     parsers over one language is two parsers that drift, and the drift is
     invisible: the same sentence logged through two doors would quietly
     produce two different records. */
  function readCall(text) {
    /* Contractions are expanded before anything is matched, so "wouldn't put
       me through" and "would not put me through" are the same sentence. A
       lexicon carrying both spellings of every negation is a lexicon that
       will one day carry only one of them. */
    const t = ' ' + String(text || '').toLowerCase()
      .replace(/[’‘]/g, "'")
      .replace(/n't\b/g, ' not')
      .replace(/\s+/g, ' ') + ' ';

    const first = (lex) => { const hit = lex.filter(([re]) => re.test(t))[0]; return hit ? hit[1] : null; };
    const all = (lex) => lex.filter(([re]) => re.test(t)).map(([, k]) => k);

    const disp = first(READ_DISP);
    const props = all(READ_PROP);
    const opps = all(READ_OPP);
    let objs = all(READ_OBJ);
    /* `other` is the fallback and behaves like one — it means an obstacle
       that is none of the four above, so it only stands when none of them
       did. "Pushed back on pricing" is pricing, once. */
    if (objs.length > 1) objs = objs.filter((k) => k !== 'other');

    /* TWO DISPOSITIONS CANNOT HAVE PRODUCED A PROPOSAL, and both of them
       contain the words that name one. "Do not call again" carries "call
       again"; a wrong number is a call that never reached anybody to ask
       anything of. Read literally, the first was recording that the rep had
       proposed another call to somebody who had just told them never to ring
       back — a chip that contradicts the disposition beside it, ticked by the
       same sentence that set it. */
    if (disp === 'do-not-call' || disp === 'wrong-number') props.length = 0;

    /* ══ THE TWO FIELDS THAT RETURN WORDS, NOT KEYS ═══════════════════════

       Everything above resolves to a KEY, and a key read out of a lowercased
       sentence is the same key. The next step and the line to remember are
       different in kind: they are WORDS, and they go on the record for the
       next person to read — "call marije in the hague" is what the lowercased
       copy produces, and `remember` in particular is read back at the top of
       the next brief. So both are matched case-insensitively against the
       original sentence, and only the day-of-the-week test is handed the
       lowercase form, because `readWhen` compares against lowercase names. */
    const raw = ' ' + String(text || '').replace(/[’‘]/g, "'").replace(/n't\b/gi, ' not').replace(/\s+/g, ' ') + ' ';

    /* The next step, read exactly as the float bar has always read it. */
    const m = raw.match(/next step(?: is)?[: ]+([^.,;—–]+)/i) || raw.match(/\b(?:then|follow up with|send)\b[: ]+([^.,;—–]+)/i);
    /* THE DATE COMES OUT OF THE CLAUSE THAT NAMES THE NEXT STEP, and out of
       nowhere else. "She is back Thursday" is a fact about her; reading a day
       out of it and scheduling our follow-up on it would be the surface
       inventing an appointment from a sentence about somebody's diary.
       `readWhen` answers 7 for anything it cannot place, which is a sensible
       default and a useless signal — so whether a day was NAMED is tested
       separately from which day it was. */
    const when = m && /\b(monday|tuesday|wednesday|thursday|friday|next week|next month|tomorrow)\b/i.test(m[1])
      ? readWhen(m[1].toLowerCase()) : null;
    /* THE DAY CAN ALSO RIDE ON THE REQUEST. "Call back next week" names the
       follow-up and its day in one clause, and the read-back was putting it
       down for tomorrow. Only the clause that asks — a call back, a
       meeting, a demo — is read for a day, never a fact about her diary. */
    const ask = when == null && raw.match(/\b(?:call(?:ing)?|ring|phone)\s+(?:her|him|them|me)?\s*back\b[^.,;—–]*|\bcallback\b[^.,;—–]*|\b(?:meeting|demo)\b[^.,;—–]*/i);
    const whenAsk = ask && /\b(monday|tuesday|wednesday|thursday|friday|next week|next month|tomorrow)\b/i.test(ask[0])
      ? readWhen(ask[0].toLowerCase()) : null;
    let next = null;
    if (m) {
      const what = m[1].trim();
      next = {
        what: what
          .replace(/\b(on|next|this)?\s*(monday|tuesday|wednesday|thursday|friday|week|month)\b/gi, '')
          /* Drop the leading article. "Next step: a demo" is how somebody
             writes it and "A demo" is not how a next step is named. */
          .replace(/^\s*(a|an|the)\s+/i, '')
          .trim()
          .replace(/^./, (c) => c.toUpperCase()) || 'Follow up',
        due: iso(shift(TODAY, when == null ? readWhen(what.toLowerCase()) : when)),
        by: me().id,
      };
    }

    /* ON AN EXPLICIT CUE ONLY. `remember` is the one field AiMY writes WORDS
       into rather than ticking, and it goes on the RECORD rather than on the
       call — it outlives everything else on this form. So it is read when
       somebody says "remember: …" and never inferred from an ordinary
       sentence: a durable fact nobody meant to state is a durable fact nobody
       will think to correct. */
    const rm = raw.match(/\b(?:remember|note that|worth knowing|for next time)\b[:, ]+([^.;]+)/i);
    const remember = rm ? rm[1].trim().replace(/^./, (c) => c.toUpperCase()) : null;

    /* ── And what the sentence said that no list has a name for ──

       Only where the axis came back empty, and only where the frame that
       fired belongs on that axis at all. Two guards beyond that:

       · A PHRASE THAT IS ALREADY A KNOWN VALUE IS DROPPED. "They just told me
         they are not interested" trips the news frame and the phrase reads
         back as a disposition — recording it as an opening would be the
         reading contradicting itself in the same breath.

       · NOTHING OPENS ON A CALL THAT REACHED NOBODY, and nothing is asked for
         on one that ended in "never ring again". Both are the same rule the
         proposal guard above states: a chip that contradicts the disposition
         beside it is worse than an empty axis. */
    const said = {};
    const known = (phrase) => {
      const p = ' ' + phrase.toLowerCase() + ' ';
      return [READ_DISP, READ_PROP, READ_OBJ, READ_OPP].some((lex) => lex.some(([re]) => re.test(p)));
    };
    const spoke = !disp || disp === 'reached' || disp === 'callback' || disp === 'gatekeeper';
    const asked = disp !== 'do-not-call' && disp !== 'wrong-number';
    const empty = { objection: !objs.length, proposal: !props.length, opportunity: !opps.length };
    for (const [axis, re] of READ_FRAME) {
      if (!empty[axis]) continue;
      if (axis === 'opportunity' && !spoke) continue;
      if (axis === 'proposal' && !asked) continue;
      const hit = raw.match(re);
      if (!hit) continue;
      const phrase = saidPhrase(hit[1]);
      if (!phrase || known(phrase)) continue;
      said[axis] = phrase;
    }
    /* The axis value is `other` — a real value the filters and the counts can
       add up — and the words ride beside it. A free-text key on the axis
       would have shown the rep what was said and made it uncountable. */
    if (said.objection) objs.push('other');
    if (said.proposal) props.push('other');
    if (said.opportunity) opps.push('other');

    /* THE FOUR-VALUE AXIS, PROJECTED HERE ONCE. `callToOutcome` already maps
       the seven a caller picks onto the four every channel shares; two
       readings fall outside it and are read on their own terms. A meeting
       AGREED is an outcome no disposition carries — "spoke to them" and
       "booked a demo" are the same disposition and very different news — and
       a sentence can be plainly sour without the call having ended badly
       ("they liked it, no budget until Q3"). */
    const booked = /\b(booked|scheduled|agreed to meet|set up a call|set up a demo|set up a meeting|in the diary)\b/.test(t);
    const sour = /\b(negative|no budget|pushed back|declined|went badly)\b/.test(t);
    const outcome = booked ? 'meeting-booked'
      : disp ? callToOutcome(disp)
      : sour ? 'negative' : 'neutral';

    return { disp, props, objs, opps, next, when: when == null ? whenAsk : when, remember, outcome, said };
  }

  function readWhen(s) {
    const days = { monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5 };
    for (const d of Object.keys(days)) {
      if (s.includes(d)) {
        const delta = (days[d] - TODAY.getDay() + 7) % 7;
        return delta === 0 ? 7 : delta;
      }
    }
    if (/next week/.test(s)) return 7;
    if (/next month/.test(s)) return 30;
    if (/tomorrow/.test(s)) return 1;
    return 7;
  }


  /* ══ 3. THE CORPUS ══════════════════════════════════════════════════════ */

  const SEED = 20260904;

  const CITIES = [
    ['Amsterdam', 'NL'], ['Rotterdam', 'NL'], ['Utrecht', 'NL'], ['Eindhoven', 'NL'],
    ['The Hague', 'NL'], ['Groningen', 'NL'], ['Tilburg', 'NL'], ['Breda', 'NL'],
    ['Nijmegen', 'NL'], ['Almere', 'NL'], ['Haarlem', 'NL'], ['Arnhem', 'NL'], ['Delft', 'NL'],
    ['Antwerp', 'BE'], ['Brussels', 'BE'], ['Ghent', 'BE'], ['Leuven', 'BE'],
    ['Berlin', 'DE'], ['Munich', 'DE'], ['Hamburg', 'DE'], ['Cologne', 'DE'],
    ['Frankfurt', 'DE'], ['Stuttgart', 'DE'], ['Vienna', 'AT'], ['Zurich', 'CH'], ['Geneva', 'CH'],
    ['Copenhagen', 'DK'], ['Aarhus', 'DK'], ['Stockholm', 'SE'], ['Gothenburg', 'SE'],
    ['Oslo', 'NO'], ['Helsinki', 'FI'],
    ['Paris', 'FR'], ['Lyon', 'FR'], ['Toulouse', 'FR'], ['Nantes', 'FR'],
    ['Dublin', 'IE'], ['Cork', 'IE'],
    ['Madrid', 'ES'], ['Barcelona', 'ES'], ['Valencia', 'ES'], ['Lisbon', 'PT'], ['Porto', 'PT'],
    ['Milan', 'IT'], ['Rome', 'IT'], ['Turin', 'IT'],
    ['Warsaw', 'PL'], ['Krakow', 'PL'], ['Prague', 'CZ'],
  ];
  const CC_REGION = Object.create(null);
  REGIONS.forEach((r) => r.cc.forEach((c) => (CC_REGION[c] = r.k)));

  const STEM_A = ['Nor', 'Vel', 'Kir', 'Mar', 'Ald', 'Bry', 'Cas', 'Del', 'Elm', 'Fen',
    'Gild', 'Hav', 'Ivo', 'Jorn', 'Kel', 'Lun', 'Mor', 'Nel', 'Ost', 'Per',
    'Quin', 'Ras', 'Sten', 'Tal', 'Ulv', 'Vard', 'Wes', 'Yrs', 'Zen', 'Brek'];
  const STEM_B = ['dal', 'mark', 'stad', 'borg', 'vik', 'haven', 'field', 'ridge',
    'gate', 'port', 'lund', 'berg', 'holt', 'wold', 'bury', 'crest'];
  const SUFFIX = {
    software: ['Systems', 'Labs', 'Digital', 'Technologies', 'Software'],
    banking: ['Capital', 'Financial', 'Trust', 'Partners', 'Bank'],
    logistics: ['Logistics', 'Freight', 'Transport', 'Supply', 'Shipping'],
    health: ['Health', 'Care', 'Medical', 'Clinics', 'Diagnostics'],
    retail: ['Retail', 'Stores', 'Trading', 'Group', 'Markets'],
    energy: ['Energy', 'Power', 'Utilities', 'Grid', 'Renewables'],
    public: ['University', 'Institute', 'Council', 'Academy', 'Authority'],
    telecom: ['Telecom', 'Networks', 'Communications', 'Connect', 'Mobile'],
    industry: ['Industries', 'Manufacturing', 'Works', 'Engineering', 'Fabrication'],
    hospitality: ['Hotels', 'Hospitality', 'Resorts', 'Group', 'Collection'],
  };

  const FIRST = ['James', 'Emma', 'Oliver', 'Charlotte', 'Harry', 'Amelia', 'George',
    'Isla', 'Noah', 'Ava', 'Jack', 'Mia', 'Leo', 'Grace', 'Henry', 'Freya',
    'Thomas', 'Sophie', 'Alexander', 'Ella', 'William', 'Lily', 'Daniel', 'Chloe',
    'Samuel', 'Ruby', 'Benjamin', 'Alice', 'Edward', 'Poppy', 'Joseph', 'Evie',
    'Matthew', 'Daisy', 'Charles', 'Rose', 'Nathan', 'Hannah', 'Peter', 'Lucy',
    'Andrew', 'Kate', 'Michael', 'Sarah'];
  const LAST = ['Smith', 'Jones', 'Taylor', 'Brown', 'Williams', 'Wilson', 'Johnson',
    'Davies', 'Robinson', 'Wright', 'Thompson', 'Evans', 'Walker', 'White',
    'Roberts', 'Green', 'Hall', 'Wood', 'Jackson', 'Clarke', 'Harris', 'Lewis',
    'Turner', 'Cooper', 'Ward', 'Morris', 'Baker', 'Cook', 'Bailey', 'Bell',
    'Murphy', 'Kelly', 'Price', 'Hughes', 'Foster', 'Gray', 'Watson', 'Marshall',
    'Palmer', 'Reid'];

  /* One line saying what a company in this sector actually does, so a row
     about somebody you have never contacted says something before you open
     it. Two per sector, drawn per row. */
  const NET_ABOUT = {
    software: ['Builds scheduling software for field teams.', 'Sells a billing platform to mid-market lenders.'],
    banking: ['Regional lender, mortgages and small business.', 'Payments processor for online merchants.'],
    logistics: ['Moves freight across the North Sea corridor.', 'Runs last-mile delivery for grocery chains.'],
    health: ['Operates outpatient clinics across the region.', 'Supplies diagnostics to hospital groups.'],
    retail: ['Runs a chain of homeware stores.', 'Online grocer with its own delivery fleet.'],
    energy: ['Sells renewable power to households.', 'Maintains grid infrastructure under contract.'],
    public: ['A university with twelve thousand students.', 'Municipal authority for a metropolitan area.'],
    telecom: ['Fibre operator with a consumer and business arm.', 'Wholesale carrier reselling capacity.'],
    industry: ['Precision components for the automotive trade.', 'Contract manufacturing for medical devices.'],
    hospitality: ['Runs eleven hotels across three countries.', 'Restaurant group with a central kitchen.'],
  };

  /* Who a BDR selling operations services actually rings. */
  const TITLES = [
    'Head of Customer Support', 'Support Operations Manager', 'Customer Service Director',
    'Head of Quality', 'QA Manager', 'Head of Contact Centre', 'Service Delivery Manager',
    'IT Director', 'Chief Technology Officer', 'Chief Operating Officer',
    'VP Engineering', 'Head of Customer Experience', 'Operations Director',
    'Head of Shared Services', 'Head of Digital', 'Chief Information Officer',
    'Head of Back Office', 'Customer Care Lead', 'Head of Technology', 'Engineering Manager',
  ];

  /* The agreed answer to each objection, per offering. What a BDR is supposed
     to say, written down once so the campaign page and the pre-call brief
     quote the same words. */
  const ANSWERS = {
    pricing: 'Price it against the headcount it replaces, not against a licence. Ask what one unfilled seat costs them a month.',
    timing: 'Agree the quarter, book the meeting inside it. A date in the diary survives a budget freeze; a promise to call back does not.',
    feature: 'Ask which one thing is missing, then say plainly whether we do it. A maybe here costs the meeting two calls later.',
    service: 'Name what we do not do before they find it. The list of what we do run is longer than they expect.',
    other: 'Write down what they actually said and read it back. Half of these are not objections, they are questions.',
  };

  /* ── seed() — the whole corpus, from one number ─────────────────────────
     Deterministic and rebuilt on every load, which is what lets the store
     persist only what changed. Everything here is fixture: no network, no
     telephony, no external data. */
  function seed() {
    const r = rng(SEED);
    const camp = [];
    const acc = [];
    const con = [];
    const touch = [];

    /* ── Campaigns ── 40, and 14 of them are mine. */
    const CAMP_N = 10;
    const usedNames = Object.create(null);
    for (let i = 0; i < CAMP_N; i++) {
      const ind = pick(r, INDUSTRIES);
      const reg = pick(r, REGIONS);
      /* Two in five are run for a client, and those sell the client's offer
         rather than ours — a campaign cannot be for Norvant and pitch AiMY
         Voice, which is what a free draw from the whole catalogue produced. */
      const forClient = chance(r, 0.4) ? pick(r, CLIENTS) : null;
      const sells = [forClient ? SELL[pick(r, forClient.sells)] : pick(r, SELLS)];
      if (forClient) {
        const other = forClient.sells.filter((x) => x !== sells[0].k);
        if (other.length && chance(r, 0.45)) sells.push(SELL[other[0]]);
      } else if (chance(r, 0.35)) {
        const second = pick(r, SELLS);
        if (second.k !== sells[0].k) sells.push(second);
      }
      let name = pick(r, [
        sells[0].name + ' — ' + reg.label,
        ind.label + ', ' + reg.label,
        reg.label + ' ' + ind.label.toLowerCase(),
        sells[0].name + ' — ' + ind.label,
      ]);
      while (usedNames[name]) name = name + ' II';
      usedNames[name] = 1;

      /* Two or three objections this audience actually raises, each with the
         answer the team agreed. A campaign that lists an objection and not
         the answer has told a caller what is coming and nothing else. */
      const objs = [];
      const objPool = OBJECTIONS.slice();
      const objN = between(r, 2, 3);
      for (let j = 0; j < objN; j++) {
        const o = objPool.splice(Math.floor(r() * objPool.length), 1)[0];
        objs.push({ k: o.k, say: ANSWERS[o.k] });
      }

      const res = [
        { name: sells[0].name + ' — one pager', kind: 'deck' },
        { name: 'What it costs, and against what', kind: 'pricing' },
      ];
      if (chance(r, 0.7)) res.push({ name: ind.label + ' case study', kind: 'case' });
      if (chance(r, 0.5)) res.push({ name: 'Questions we get asked', kind: 'faq' });

      /* Most of a book's campaigns are live. A finished one is a real state —
         it is what makes "your campaigns" a shorter list than "campaigns" —
         but at a coin flip it stops being the exception and starts being half
         the corpus, which is what a first cut of this seed did. */
      const done = chance(r, 0.18);
      const startAgo = done ? between(r, 120, 260) : between(r, 5, 90);
      const runFor = done ? between(r, 40, 90) : between(r, 60, 200);
      const state = done ? 'done' : 'running';

      /* Crew is assigned after every campaign exists, so the fourteen that
         are mine can be drawn from the ones still running. Picking them by
         index here put half of mine in the finished pile. */
      const crew = [];

      /* ══ THE GOAL IS THE ASK; THE NUMBER IS THE MEASURE ═══════════════
         "Book 19 first meetings with logistics operations leads" was doing
         both jobs and neither well. It read as a quota in a run of unlabelled
         facts, and the page had to find the 19 by running a regular
         expression over its own prose to know what to measure against — so
         renaming an industry could silently change the target.

         The ask is the goal. The number is `target`, and where it stands
         against that number is the insight sixty pixels below. */
      const askFor = ASK_OF[sells[0].k];
      const target = { n: between(r, 8, 30), noun: chance(r, 0.72) ? 'meeting' : 'conversation' };
      camp.push({
        id: 'c' + i,
        name: name,
        client: forClient ? forClient.k : null,
        target: target,
        persona: {
          who: askFor,
          at: ind.label.toLowerCase() + ' companies with more than ' +
            commas(pick(r, [200, 500, 1000, 2000])) + ' staff in ' + reg.label,
          why: WHY_NOW[sells[0].k],
        },
        /* Three ways to ask for each, or every campaign selling the same
           thing prints the same goal and the surface reads as a template. */
        goal: target.noun === 'meeting'
          ? pick(r, [
            'A first meeting with ' + askFor + ' — in the diary, not a promise to send something',
            'Thirty minutes with ' + askFor + ', booked while you are still on the call',
            'A scoping call with ' + askFor + ', with somebody in the room who can sign',
          ])
          : pick(r, [
            'A real conversation with ' + askFor + ' about what this is costing them today',
            'To hear from ' + askFor + ' how they run this now, and what it takes',
            'A straight answer from ' + askFor + ' on whether this is worth their money',
          ]),
        pitch: 'They are in ' + reg.label + ', and they are running this with people rather than with a system. ' +
          sells[0].name + ' is ' + sells[0].blurb + '. Open on what it costs them today, not on what we do.',
        sells: sells.map((s) => s.k),
        objections: objs,
        resources: res,
        from: dayAdd(-startAgo),
        to: dayAdd(runFor - startAgo),
        owner: pick(r, MANAGERS).id,
        crew: crew,
        state: state,
        industry: ind.k,
        region: reg.k,
      });
    }

    /* ── Who is on what ── I am on fourteen, and they are running ones,
       because a finished campaign is not work. The rest exist so the product
       has to answer what happens when you open one you are not on. */
    const running = camp.filter((c) => c.state === 'running');
    /* With one caller there is nobody else to add, so every draw below picks
       her — but it still DRAWS. `others` empty would throw on `pick`, and
       guarding by skipping the call instead would shift the cursor and
       reshuffle the whole corpus behind it. */
    const others = BDRS.filter((b) => b.id !== DEFAULT_ME);
    const pool = others.length ? others : BDRS;
    running.slice(0, 14).forEach((c) => c.crew.push(DEFAULT_ME));
    camp.forEach((c) => {
      const extra = between(r, 0, 2);
      for (let j = 0; j < extra; j++) {
        const b = pick(r, pool);
        if (c.crew.indexOf(b.id) < 0) c.crew.push(b.id);
      }
      if (!c.crew.length) c.crew.push(pick(r, pool).id);
    });

    /* ── Accounts ── */
    const ACC_N = 200;
    const usedCo = Object.create(null);
    for (let i = 0; i < ACC_N; i++) {
      const ind = pick(r, INDUSTRIES);
      const city = pick(r, CITIES);
      let nm = pick(r, STEM_A) + pick(r, STEM_B) + ' ' + pick(r, SUFFIX[ind.k]);
      let guard = 0;
      while (usedCo[nm] && guard++ < 12) nm = pick(r, STEM_A) + pick(r, STEM_B) + ' ' + pick(r, SUFFIX[ind.k]);
      if (usedCo[nm]) nm = nm + ' ' + city[0];
      usedCo[nm] = 1;
      acc.push({
        id: 'a' + i,
        name: nm,
        domain: nm.toLowerCase().replace(/[^a-z]+/g, '') + pick(r, ['.com', '.nl', '.eu', '.io', '.de']),
        industry: ind.k,
        city: city[0],
        country: city[1],
        region: CC_REGION[city[1]],
        size: pick(r, [40, 80, 140, 260, 480, 900, 1600, 3200, 6000]),
      });
    }

    /* ── Contacts ── people, spread over the accounts. */
    const CON_N = 560;
    for (let i = 0; i < CON_N; i++) {
      const a = acc[Math.floor(r() * ACC_N)];
      /* Reachability is not universal, and that is the point of enrichment:
         a contact with no number cannot be called however good the fit. */
      const hasPhone = chance(r, 0.82);
      con.push({
        id: 'p' + i,
        acc: a.id,
        name: pick(r, FIRST) + ' ' + pick(r, LAST),
        title: pick(r, TITLES),
        phone: hasPhone
          ? '+' + pick(r, ['31 6 ', '32 4 ', '49 1', '46 7', '353 8', '33 6 ']) +
            String(between(r, 1000000, 9999999))
          : null,
        email: null,               // filled below, once the name is known
        camps: [],
        owner: null,
        checkpoint: 'not-called',
        checkpointAt: null,
        attempts: 0,
        lastCallAt: null,
        next: null,
        remember: null,
        dnc: false,
        fate: null,
        enrichedAt: null,
        manager: null,
      });
      const c = con[con.length - 1];
      c.email = chance(r, 0.74)
        ? c.name.toLowerCase().replace(/[^a-z ]/g, '').split(' ').slice(0, 2).join('.') + '@' + a.domain
        : null;
    }

    /* ── Membership ── every campaign gets a slice of the book. A contact can
       be on two campaigns; the queue de-duplicates by person, not by row. */
    /* ══ MEMBERSHIP HONOURS THE NAME ═══════════════════════════════════
       "Ireland logistics" had eleven people in Ireland out of 229, and its
       pitch said "they are logistics in Ireland" over a roster from Ghent
       and Utrecht. A campaign draws from its own region: the cell of people
       at companies in its sector and region first, then the rest of the
       region. The draw count is unchanged, so nothing before or after it in
       the corpus moves. */
    const byRegion = Object.create(null);
    const byCell = Object.create(null);
    con.forEach((p) => {
      const a = acc[Number(p.acc.slice(1))];
      (byRegion[a.region] || (byRegion[a.region] = [])).push(p);
      const cell = a.region + '|' + a.industry;
      (byCell[cell] || (byCell[cell] = [])).push(p);
    });
    camp.forEach((c) => {
      const want = between(r, 30, 70);
      const cell = byCell[c.region + '|' + c.industry] || [];
      const region = byRegion[c.region] || con;
      for (let j = 0; j < want; j++) {
        const idx = Math.floor(r() * CON_N);
        const pool = j < cell.length ? cell : region;
        const p = pool[idx % pool.length];
        if (p.camps.indexOf(c.id) < 0) {
          p.camps.push(c.id);
          if (!p.owner) p.owner = pick(r, c.crew);
        }
      }
    });
    /* Anybody on no campaign is owned by nobody, which is exactly right: they
       are in the book and not in anybody's queue until a list puts them there. */

    /* ── History ── where each contact stands, and the calls that got them
       there. The shares are what a real book looks like after a quarter: most
       of it has never been rung. */
    /* THESE SHARES ARE OF THE REACHABLE BOOK, NOT OF EVERYBODY. Contacts on
       no campaign, and most contacts with no number, never get here at all —
       so a 0.50 not-called share reads as 0.64 of all six thousand once those
       are counted in. Measured, and tuned against the measurement. */
    /* ══ TWO DESKS BOTH NEED SOMETHING TO WORK ═════════════════════════
       These shares were a real book's, where a hand-over is one lead in a
       hundred — fine across six thousand people, and across three hundred it
       leaves the manager with three deals and no board worth opening. The
       book is a demo's size now, so the hand-over share is what a demo
       needs: a hundred or so still to ring on one desk, forty-odd deals on
       the other. */
    const START = [
      ['not-called', 0.33],
      ['no-answer', 0.20],
      ['callback', 0.06],
      ['answered', 0.10],
      ['meeting-set', 0.06],
      ['showed-up', 0.03],
      ['interested', 0.02],
      ['handed-over', 0.13],
      ['declined', 0.04],
      ['wrong-number', 0.02],
      ['do-not-call', 0.01],
    ];
    /* ══ NORMALISED, BECAUSE THE FIRST CUT WAS NOT AND IT HID A CHANGE ══════
       These weights are written by hand and did not sum to one. The roll fell
       through the loop for the missing 14% and returned the first row as a
       fallback — so lowering `not-called` from 0.50 to 0.36 moved the count
       by fifty out of six thousand, and looked like the share was not the
       thing driving it. A weight list that silently donates its remainder to
       one row is a list where editing any row edits that one too. */
    const TOTAL = START.reduce((s, x) => s + x[1], 0);
    const rollRung = () => {
      let x = r() * TOTAL;
      for (let i = 0; i < START.length; i++) {
        x -= START[i][1];
        if (x <= 0) return START[i][0];
      }
      return START[START.length - 1][0];
    };
    /* Which fixture transcript a person gets. Fixed per contact, so the call,
       the transcript and AiMY's reading of it always agree — and so a demo
       walked twice tells the same story twice. */
    const FATES = SCENARIOS.map((x) => x.k);

    let tId = 0;
    const NOTE = {
      reached: ['Good conversation, they want a demo.', 'Spoke to them, keen but the price came up.',
        'Talked it through. They asked me to send the case study.', 'Got through. Timing is the problem, not the fit.'],
      callback: ['Asked me to call back next week.', 'Bad moment, ring back Thursday.', 'Call them back after the board meeting.'],
      gatekeeper: ['Reception would not put me through.', 'Screened. Assistant took a message.', 'Front desk again, they are in workshops all week.'],
      'no-answer': ['No answer.', 'Rang out.', 'Left a voicemail.', 'Straight to answerphone.'],
      'not-interested': ['Not interested, they have just signed with someone.', 'No appetite this year.', 'Brushed me off.'],
      'wrong-number': ['Wrong number, they left last year.', 'Number is not in service.'],
      'do-not-call': ['Asked to be taken off the list.', 'Do not call again.'],
    };

    con.forEach((c) => {
      c.fate = FATES[Math.abs(hash(c.id)) % FATES.length];
      if (!c.camps.length) return;              // not on a campaign, never rung
      if (!c.phone && chance(r, 0.8)) return;   // no number, mostly untouched
      const rung = rollRung();
      if (rung === 'not-called') return;

      c.checkpoint = rung;
      const climbed = isExit(rung) ? between(r, 1, 4) : rank(rung);
      /* Further up the ladder means more calls behind it. A meeting is not
         set on the first ring, and a cold number is rung five or six times
         before anybody gives up on it. */
      const n = Math.max(1, between(r, 2 + climbed, 6 + climbed * 2));
      const camps = c.camps;
      let last = null;
      for (let j = 0; j < n; j++) {
        const daysAgo = between(r, 1, 120) + (n - j) * 2;
        const at = dayOf(-daysAgo);
        at.setHours(between(r, 9, 17), between(r, 0, 59), 0, 0);
        const oc = j === n - 1 && isExit(rung)
          ? (rung === 'declined' ? 'not-interested' : rung)
          : pick(r, ['no-answer', 'no-answer', 'gatekeeper', 'reached', 'callback']);
        const props = [];
        const objs = [];
        const opps = [];
        /* ══ A REASON IS RECORDED WHERE A REASON IS GIVEN ═══════════════
           Only connected calls carried one, at a coin flip, so a campaign
           with two hundred and ninety calls held three reasons in total and
           anything reading them back had a sample of three to work from.
           The outcome that most obviously comes with a reason — somebody
           saying no — carried none at all, which is the one place a caller
           always asks why. */
        if (oc === 'reached') {
          if (chance(r, 0.55)) props.push(pick(r, PROPOSALS).k);
          if (chance(r, 0.72)) objs.push(pick(r, OBJECTIONS).k);
          if (chance(r, 0.15)) opps.push(pick(r, OPENINGS).k);
        }
        if (oc === 'not-interested') objs.push(pick(r, OBJECTIONS).k);
        const t = {
          id: 't' + tId++,
          con: c.id,
          camp: camps[Math.floor(r() * camps.length)],
          by: c.owner || pick(r, BDRS).id,
          at: at.toISOString(),
          secs: oc === 'reached' ? between(r, 90, 600) : between(r, 8, 45),
          outcome: oc,
          proposals: props,
          objections: objs,
          openings: opps,
          note: pick(r, NOTE[oc] || ['Logged.']),
          lines: [],
          next: null,
          moved: null,
        };
        touch.push(t);
        if (!last || t.at > last) last = t.at;
      }
      /* ══ THE HISTORY RECORDS THE CLIMB ═════════════════════════════════
         Every touchpoint was written with moved: null, so a person at
         Meeting set had a history that ended "no rung climbed yet" and a
         callback that said "stays at Meeting set". The rungs somebody
         stands on were reached by particular calls, and those calls say so
         now, wearing an outcome that could have done it: a meeting is set
         on a connected call that asked for one; showed up, interested and
         handed over are settled by hand. Which calls: the last one reaches
         the rung they stand on, the earlier rungs are spread back through
         the history in order. Positions come off the id's hash, not the
         generator, so nothing else in the corpus moves. */
      const mineT = touch.slice(-n).sort((x, y) => (x.at < y.at ? -1 : 1));
      const hc = Math.abs(hash(c.id + ':climb'));
      const steps = isExit(rung)
        ? LADDER.slice(1, 1 + climbed).map((x) => x.k).concat([rung])
        : LADDER.slice(1, 1 + rank(rung)).map((x) => x.k);
      const use = steps.slice(Math.max(0, steps.length - n));
      const top = isExit(rung) ? rank(use[use.length - 2] || 'not-called') : rank(rung);
      /* A history that never got past no-answer holds no connected call,
         and one that never got past no-answer holds no callback either. */
      mineT.forEach((t, i) => {
        let oc = t.outcome;
        if (oc === 'reached' && top < rank('answered')) oc = i % 2 ? 'gatekeeper' : 'no-answer';
        if (oc === 'callback' && top < rank('callback')) oc = 'no-answer';
        if (oc !== t.outcome) {
          t.outcome = oc;
          t.note = NOTE[oc][(hc + i) % NOTE[oc].length];
          t.secs = 8 + (hc + i) % 38;
        }
        if (t.outcome !== 'reached') { t.proposals = []; t.objections = []; t.openings = []; }
        else t.proposals = t.proposals.filter((x) => x !== 'meeting' && x !== 'demo');
      });
      const idx = [];
      for (let si = 0; si < use.length - 1; si++) {
        const base = Math.floor(((si + 1) * (n - 1)) / use.length);
        const lo = idx.length ? idx[idx.length - 1] + 1 : 0;
        const hi = (n - 1) - (use.length - 1 - si);
        idx.push(Math.max(lo, Math.min(hi, base)));
      }
      idx.push(n - 1);
      let prevRung = 'not-called';
      use.forEach((k, si) => {
        const t = mineT[idx[si]];
        t.moved = [prevRung, k];
        prevRung = k;
        if (k === 'no-answer') {
          t.outcome = 'no-answer'; t.proposals = []; t.objections = []; t.openings = [];
          t.note = NOTE['no-answer'][(hc + si) % NOTE['no-answer'].length];
        } else if (k === 'callback') {
          t.outcome = 'callback'; t.proposals = []; t.objections = []; t.openings = [];
          t.note = NOTE.callback[(hc + si) % NOTE.callback.length]; t.secs = 20 + hc % 25;
        } else if (k === 'answered') {
          t.outcome = 'reached';
          t.proposals = t.proposals.filter((x) => x !== 'meeting' && x !== 'demo');
          if (!t.proposals.length) t.proposals = [['info', 'callback', 'other'][hc % 3]];
          t.note = NOTE.reached[(hc + si) % NOTE.reached.length]; t.secs = 90 + hc % 400;
        } else if (k === 'meeting-set') {
          /* the proposal is settled once c.next says meeting or demo */
          t.outcome = 'reached'; t.proposals = ['meeting']; t.secs = 120 + hc % 480;
          t.note = 'Got through. They will take a meeting.';
        } else if (k === 'showed-up' || k === 'interested' || k === 'handed-over') {
          t.outcome = 'checkpoint'; t.secs = 0; t.proposals = []; t.objections = []; t.openings = [];
          t.note = k === 'showed-up' ? 'They showed up.' : k === 'interested' ? 'They are interested.' : 'Handed to the director.';
        }
        /* an exit: the last touchpoint already wears the outcome */
      });
      /* nobody is "connected" before the call that first reached them */
      const firstReach = idx[use.indexOf('answered')];
      if (firstReach != null) mineT.forEach((t, i) => {
        if (i < firstReach && t.outcome === 'reached') {
          t.outcome = i % 2 ? 'gatekeeper' : 'no-answer';
          t.note = NOTE[t.outcome][(hc + i) % NOTE[t.outcome].length];
          t.secs = 8 + (hc + i) % 38; t.proposals = []; t.objections = []; t.openings = [];
        }
      });
      /* the rung each touchpoint left them on, for "stays at" */
      prevRung = 'not-called';
      mineT.forEach((t) => { if (t.moved) prevRung = t.moved[1]; t.rung = prevRung; });
      const calls = mineT.filter((t) => t.outcome !== 'checkpoint');
      c.attempts = calls.length;
      c.lastCallAt = calls.length ? calls[calls.length - 1].at : last;
      c.checkpointAt = mineT[n - 1].at;
      if (rung === 'do-not-call') c.dnc = true;
      /* ══ WHAT THE DIRECTOR HAS DONE WITH IT SINCE ═══════════════════════
         A handed-over lead's history ended at the hand-over. The director's
         meetings land on the record as touchpoints by the director, dated
         off the hand-over up to today; a resolution carries the decision.
         Off the hash, so the generator is untouched. */
      if (rung === 'handed-over') {
        const kk = camp.filter((x) => x.id === camps[0])[0];
        const dirId = kk && kk.owner ? kk.owner : MANAGERS[0].id;
        mineT[n - 1].note = 'Handed to ' + REP[dirId].name + '.';
        const hp = Math.abs(hash(c.id + ':phase'));
        let when = new Date(mineT[n - 1].at);
        for (let pi = 0; pi < PHASES.length; pi++) {
          when = new Date(when.getTime() + (pi === 0 ? 3 + hp % 8 : 6 + ((hp >> (3 * pi)) % 9)) * DAY_MS);
          if (when.getTime() > TODAY.getTime()) break;
          const ph = PHASES[pi];
          const decision = ph.k === 'resolution' ? (((hp >> 12) % 3) === 0 ? 'lost' : 'won') : null;
          touch.push({
            id: 't' + tId++, con: c.id, camp: camps[0], by: dirId, at: when.toISOString(), secs: 0,
            outcome: 'phase', phase: ph.k, decision: decision,
            proposals: [], objections: [], openings: [],
            note: decision === 'won' ? 'They signed on the terms agreed.'
              : decision === 'lost' ? 'They decided against it.'
              : ph.label + ' held. ' + REP[dirId].name.split(' ')[0] + ' ' + ph.did + '.',
            lines: [], next: null, moved: null, rung: 'handed-over',
          });
        }
      }

      /* What is owed next, and when. Only the rungs that owe something. */
      if (rung === 'callback') {
        c.next = { what: 'Call them back', due: dayAdd(between(r, -9, 6)) };
      } else if (rung === 'meeting-set') {
        c.next = { what: pick(r, ['Meeting with them', 'Demo for them']), due: dayAdd(between(r, -6, 14)) };
        /* the call that set it asked for the thing in the diary */
        const setBy = mineT[n - 1];
        if (/Demo/.test(c.next.what)) { setBy.proposals = ['demo']; setBy.note = 'Got through. They will take a demo.'; }
      } else if (rung === 'answered' && chance(r, 0.45)) {
        c.next = { what: pick(r, ['Send what was promised', 'Call them back']), due: dayAdd(between(r, -8, 9)) };
      } else if (rung === 'showed-up') {
        /* ONE NEXT STEP PER RUNG. Showed up owes the interest question; the
           hand-over is owed by Interested. The page said both at once. */
        c.next = { what: 'Say whether they are interested', due: dayAdd(between(r, -3, 8)) };
      } else if (rung === 'interested') {
        c.next = { what: 'Hand to the director', due: dayAdd(between(r, -3, 8)) };
      }
      if (chance(r, 0.18)) {
        c.remember = {
          text: pick(r, [
            'Only takes calls before 10.',
            'Do not go through reception, use the mobile.',
            'Her budget year starts in April.',
            'They moved off a competitor last year and it went badly.',
            'Asked us never to email, phone only.',
          ]),
          by: c.owner || DEFAULT_ME,
          at: c.lastCallAt,
        };
      }
      /* AiMY worked overnight on some of them. This is what the briefing
         reports as done rather than recommended. */
      if (!c.phone && chance(r, 0.1)) { c.phone = '+31 6 ' + between(r, 1000000, 9999999); c.enrichedAt = dayAdd(-1); }
    });

    /* ══ SIGNALS: WHAT CHANGED AT A COMPANY WHILE YOU WERE RINGING IT ═════
       The notes' two examples: budget came up and then they raised a round;
       they were not hiring and then a role went up. A signal sits on the
       account, dated, with where it was seen. About one company in twelve
       has one from the last three weeks (one in twenty-four; sixty-nine on
       one caller's queue read as noise, not news) — off the id's hash, so the corpus
       is unmoved. The kinds are the openings lexicon's own. */
    const SIGNAL_TEXT = {
      'funded':       ['raised a Series A', 'raised a Series B', 'closed a funding round', 'took growth funding'],
      'hiring':       ['posted three QA engineer roles', 'is hiring a Head of Support', 'put up five support desk roles', 'is hiring test automation engineers'],
      'new-hire':     ['has a new CTO', 'has a new Head of Operations', 'appointed a new COO', 'has a new Head of Customer Experience'],
      'renewal-near': ['renews its current supplier next quarter', 'has a contract renewal due in October'],
      'visited-site': ['visited the pricing page twice this week', 'downloaded the case study'],
    };
    const SIGNAL_SRC = { 'funded': 'the news', 'hiring': 'LinkedIn', 'new-hire': 'LinkedIn', 'renewal-near': 'their filings', 'visited-site': 'our site' };
    const SIGNAL_KINDS = Object.keys(SIGNAL_TEXT);
    acc.forEach((a) => {
      const h = Math.abs(hash(a.id + ':signal'));
      a.signal = null;
      if (h % 24 !== 0) return;
      const k = SIGNAL_KINDS[(h >> 4) % SIGNAL_KINDS.length];
      const texts = SIGNAL_TEXT[k];
      a.signal = { k: k, text: texts[(h >> 8) % texts.length], src: SIGNAL_SRC[k], at: dayAdd(-((h >> 12) % 21)) };
    });

    /* ── What the sources can find ──
       The book is what you have; this is what is out there. Three thousand
       rows a search runs against, generated from the same pools so a result
       looks like the book it will join. About an eighth of them are already
       yours — which is the whole reason "not already in the book" is a
       criterion rather than a promise. */
    const net = [];
    /* TWELVE THOUSAND, BECAUSE A REAL DESCRIPTION NARROWS HARD. One sector of
       ten, one country of nine, one size band of four and one job family of
       five is about a thousandth of the index — and three thousand rows
       answered "QA managers at software companies in the Netherlands with 200
       to 1,000 staff" with exactly one. A builder whose Generate button says
       1 has not been demonstrated, it has been apologised for. */
    for (let i = 0; i < 2000; i++) {
      const ind = pick(r, INDUSTRIES);
      const city = pick(r, CITIES);
      const known = chance(r, 0.12);
      const mirror = known ? acc[Math.floor(r() * ACC_N)] : null;
      net.push({
        id: 'n' + i,
        co: mirror ? mirror.name : pick(r, STEM_A) + pick(r, STEM_B) + ' ' + pick(r, SUFFIX[ind.k]),
        domain: mirror ? mirror.domain : null,
        industry: mirror ? mirror.industry : ind.k,
        city: mirror ? mirror.city : city[0],
        country: mirror ? mirror.country : city[1],
        size: mirror ? mirror.size : pick(r, [40, 80, 140, 260, 480, 900, 1600, 3200, 6000]),
        name: pick(r, FIRST) + ' ' + pick(r, LAST),
        title: pick(r, TITLES),
        known: !!mirror,
        /* ── WHAT A ROW NEEDS TO BE READ RATHER THAN SCANNED ──
           The V3 row's own note: a supplier returns name, location,
           description, industry, size, type and a link, and a row carrying
           four of the seven is a row you skim. The three that were missing
           are the three that decide anything — what the company DOES, what
           shape it is, and a way to go and look at it. */
        founded: between(r, 1968, 2022),
        about: NET_ABOUT[ind.k][Math.floor(r() * NET_ABOUT[ind.k].length)],
        type: pick(r, ['Private', 'Private', 'Private', 'Listed', 'Non-profit', 'Public body']),
        rev: chance(r, 0.62) ? pick(r, [2, 5, 9, 14, 22, 38, 60, 95, 150, 240, 400]) : null,
        /* Reachability is what the suppliers actually differ on, so it is
           rolled here and re-rolled by which supplier you pick. */
        seedPhone: r(),
        seedEmail: r(),
      });
      const n = net[net.length - 1];
      if (!n.domain) n.domain = n.co.toLowerCase().replace(/[^a-z]+/g, '') + pick(r, ['.com', '.nl', '.eu', '.io', '.de']);
    }

    /* ══ THE LISTS ALREADY BUILT ═══════════════════════════════════════
       The lists surface rendered a heading, a sentence and nothing else on
       a fresh load, because the seed made no lists — so the third of the
       three switcher surfaces was empty, and the page a list opens could
       not be reached at all without first building one. A caller three
       months into a book has lists; a corpus that gives them 6,000 people,
       21,000 calls and no lists is telling one story about how long they
       have been here and another about how the people arrived.

       Built out of contacts that already exist rather than minting new
       ones: a list is a saved SELECTION, and the people on these came in
       through the same door everybody else did. Two are on a campaign and
       two are not, because both states of the card have to be reachable. */
    const list = [];
    {
      const byInd = Object.create(null);
      con.forEach((c) => {
        const a = acc[Number(c.acc.slice(1))];
        if (!a) return;
        (byInd[a.industry] || (byInd[a.industry] = [])).push(c);
      });
      const mineCamps = camp.filter((k) => k.crew.indexOf(DEFAULT_ME) >= 0);
      const SPEC = [
        { ind: 'software',   band: '200 to 1,000',  who: 'QA managers',        via: 'Apollo',        ago: 46, on: 0 },
        { ind: 'industry', band: '1,000+',     who: 'Heads of support',   via: 'ZoomInfo',      ago: 31, on: 1 },
        { ind: 'banking',    band: '200 to 1,000',  who: 'Operations leads',   via: 'Apollo',        ago: 17, on: -1 },
        { ind: 'logistics',  band: '1,000+',        who: 'Support directors',  via: 'Exa / Serper',  ago: 6,  on: -1 },
      ];
      SPEC.forEach((x, i) => {
        const pool = byInd[x.ind] || [];
        if (!pool.length) return;
        /* A slice rather than a filter over every axis: the criteria line
           says what was asked for, and the roster is what a supplier
           actually returned — which never matches the ask exactly. */
        const take = pool.slice(i * 40, i * 40 + between(rng(SEED + 900 + i), 24, 60));
        if (take.length < 5) return;
        const k = x.on >= 0 ? mineCamps[x.on % mineCamps.length] : null;
        if (k) take.forEach((c) => { if (c.camps.indexOf(k.id) < 0) c.camps.push(k.id); });
        list.push({
          id: 'ls' + i,
          name: x.who + ' · ' + (INDUSTRY[x.ind] ? INDUSTRY[x.ind].label : x.ind),
          kind: 'con', terms: '',
          crit: x.who + ' at ' + (INDUSTRY[x.ind] ? INDUSTRY[x.ind].label.toLowerCase() : x.ind) +
            ' companies, ' + x.band + ' staff',
          has: take.map((c) => c.id), by: DEFAULT_ME, at: dayAdd(-x.ago),
          for: k ? k.id : null, via: x.via, found: take.length,
        });
      });
    }

    /* ══ THE DOCUMENTS ARE NAMED THE WAY DOCUMENTS ARE NAMED ═════════════
       "Data annotation — one pager" is a slot, not a title. A shared drive
       holds "What Data annotation costs, and against what" and "Norgate
       Health — how they did it": the kind, the context, and for a case
       study a real company from the sector it is meant to persuade.
       Written after the accounts exist, because one of them borrows a
       name from them. */
    camp.forEach((k) => {
      const sell = SELL[k.sells[0]];
      const ind = INDUSTRY[k.industry];
      const reg = REGION[k.region];
      const pool = acc.filter((a) => a.industry === k.industry && a.region === k.region);
      const ref = (pool.length ? pool : acc)[Math.abs(hash(k.id + ':ref')) % (pool.length || acc.length)];
      const named = {
        deck: sell.name + ' in ' + ind.label.toLowerCase() + ' — the one pager',
        pricing: 'What ' + sell.name + ' costs, and against what',
        case: ref.name + ' — how they did it',
        faq: 'What ' + ind.label.toLowerCase() + ' teams ask us',
      };
      k.resources.forEach((x) => { x.name = named[x.kind] || x.name; });
    });

    return { camp: camp, acc: acc, con: con, touch: touch, net: net, list: list };
  }

  /* A stable small hash, used to pick a contact's fate without spending the
     shared PRNG (which would move every draw after it). */
  function hash(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h | 0;
  }

  /* ══ 4. THE STORE ═══════════════════════════════════════════════════════
     The corpus is regenerated; the delta is persisted. Serialising the whole
     corpus would be six to eight megabytes against a five-megabyte quota, so
     it is not a preference — a full save would fail, and fail late. */

  const KEY_DB = 'aimy-sales-bdr:db:v1';
  const KEY_UI = 'aimy-sales-bdr:ui';

  const DB = {
    camp: [], acc: [], con: [], touch: [], list: [], session: [],
    /* What the sources can find, as opposed to what the book holds. Read
       only by the list builder; never indexed, because nothing here is a
       record until somebody saves it. */
    net: [],
    byCamp: Object.create(null),
    byAcc: Object.create(null),
    byCon: Object.create(null),
    byList: Object.create(null),
    touchesOf: Object.create(null),
    membersOf: Object.create(null),
    byMgr: Object.create(null),
    call: null,
  };

  /* What a load applies over the seed. Anything not in here came from the
     seed and is identical on every machine. */
  let DELTA = { v: 1, con: Object.create(null), touch: [], list: [], session: [],
    dismissed: [], read: [], made: [] };

  let saveTimer = null;
  /* A write flags the next paint, so the figures it changed can tick. */
  let FIG_TICK = false;
  function save() {
    FIG_TICK = true;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, 250);
  }
  function saveNow() {
    saveTimer = null;
    try { localStorage.setItem(KEY_DB, JSON.stringify(DELTA)); }
    catch (e) { /* quota or a private window: the session still works, it just
                   will not survive a reload. Never break the product for it. */ }
  }
  /* A patch, not a copy. `store.patch(contact, {checkpoint:'answered'})`
     applies it and records it, so there is exactly one way a contact changes
     and no way to change one without it being persisted. */
  function patchCon(c, fields) {
    Object.assign(c, fields);
    const p = DELTA.con[c.id] || (DELTA.con[c.id] = {});
    Object.assign(p, fields);
    save();
  }
  function addTouch(t) {
    DB.touch.push(t);
    DELTA.touch.push(t);
    (DB.touchesOf[t.con] || (DB.touchesOf[t.con] = [])).unshift(t.id);
    indexTouch(t);
    save();
  }
  function dropTouch(id) {
    const i = DB.touch.findIndex((t) => t.id === id);
    if (i < 0) return;
    const t = DB.touch[i];
    DB.touch.splice(i, 1);
    const j = DELTA.touch.findIndex((x) => x.id === id);
    if (j >= 0) DELTA.touch.splice(j, 1);
    const arr = DB.touchesOf[t.con] || [];
    const k = arr.indexOf(id);
    if (k >= 0) arr.splice(k, 1);
    delete TOUCH[id];
    save();
  }

  const TOUCH = Object.create(null);
  function indexTouch(t) { TOUCH[t.id] = t; }

  function reindex() {
    DB.byCamp = Object.create(null);
    DB.byAcc = Object.create(null);
    DB.byCon = Object.create(null);
    DB.byList = Object.create(null);
    DB.touchesOf = Object.create(null);
    DB.membersOf = Object.create(null);
    DB.consOf = Object.create(null);
    DB.byMgr = Object.create(null);
    DB.camp.forEach((c) => { DB.byCamp[c.id] = c; DB.membersOf[c.id] = []; });
    DB.acc.forEach((a) => (DB.byAcc[a.id] = a));
    DB.list.forEach((l) => (DB.byList[l.id] = l));
    DB.con.forEach((c) => {
      DB.byCon[c.id] = c;
      (DB.consOf[c.acc] || (DB.consOf[c.acc] = [])).push(c.id);
      c.camps.forEach((k) => DB.membersOf[k] && DB.membersOf[k].push(c.id));
      /* Whose desk it landed on. Only handed-over leads are on one — before
         that the lead is the caller's and no manager has it yet. */
      if (c.checkpoint === 'handed-over') {
        const m = mgrOf(c);
        (DB.byMgr[m] || (DB.byMgr[m] = [])).push(c.id);
      }
    });
    DB.touch.forEach((t) => {
      indexTouch(t);
      (DB.touchesOf[t.con] || (DB.touchesOf[t.con] = [])).push(t.id);
    });
    /* Newest first, once, so no surface has to sort a person's history. */
    Object.keys(DB.touchesOf).forEach((k) => {
      DB.touchesOf[k].sort((a, b) => (TOUCH[b].at > TOUCH[a].at ? 1 : -1));
    });
  }

  function load() {
    const s = seed();
    DB.camp = s.camp; DB.acc = s.acc; DB.con = s.con; DB.touch = s.touch; DB.net = s.net;
    /* Seeded first, then yours. `DELTA.list` is only what this browser has
       built, so overwriting rather than concatenating would have hidden
       the seeded four the moment you saved your first. */
    DB.list = s.list.slice(); DB.session = [];
    let raw = null;
    try { raw = localStorage.getItem(KEY_DB); } catch (e) {}
    if (raw) {
      try {
        const d = JSON.parse(raw);
        if (d && d.v === 1) {
          DELTA = Object.assign({ v: 1, con: {}, touch: [], list: [], session: [],
            dismissed: [], read: [], made: [] }, d);
          /* The accounts and people a saved list minted come back before the
             contact patches are applied, or a patch would have nothing to
             land on and the list would open on an empty roster. */
          (DELTA.made || []).forEach((m) => {
            DB.acc = DB.acc.concat(m.acc);
            DB.con = DB.con.concat(m.con);
          });
          const byId = Object.create(null);
          DB.con.forEach((c) => (byId[c.id] = c));
          Object.keys(DELTA.con).forEach((id) => {
            if (byId[id]) Object.assign(byId[id], DELTA.con[id]);
          });
          DELTA.touch.forEach((t) => DB.touch.push(t));
          DB.list = s.list.concat(DELTA.list);
          DB.session = DELTA.session.slice();
        }
      } catch (e) { /* a delta we cannot read is a delta we do not apply. */ }
    }
    reindex();
  }

  function reset() {
    try {
      localStorage.removeItem(KEY_DB);
      localStorage.removeItem(KEY_UI);
    } catch (e) {}
    location.reload();
  }

  /* Small persisted preferences that are not corpus: theme is its own key
     because it is read before this script exists. */
  let UI = { cap: 0 };
  function loadUI() {
    try { UI = Object.assign(UI, JSON.parse(localStorage.getItem(KEY_UI) || '{}')); } catch (e) {}
  }
  function saveUI() {
    try { localStorage.setItem(KEY_UI, JSON.stringify(UI)); } catch (e) {}
  }

  /* ══ 5. DERIVATIONS ═════════════════════════════════════════════════════
     Facts about a contact that follow from its fields. None of these is
     stored, so none of them can contradict the field it reads. */

  const accOf = (c) => DB.byAcc[c.acc];
  /* EVERYBODY AT ONE COMPANY, which is the fact the queue can never show
     you: it ranks people, so four ways into one account arrive on four
     different pages days apart, and the second caller has no idea the
     first one rang. */
  const consAt = (accId) => (DB.consOf[accId] || []).map((id) => DB.byCon[id]).filter(Boolean);
  /* And every call anybody has made into it, newest first. */
  const touchesAt = (accId) => {
    const out = [];
    consAt(accId).forEach((c) =>
      (DB.touchesOf[c.id] || []).forEach((id) => { if (TOUCH[id]) out.push(TOUCH[id]); }));
    return out.sort((a, b) => (a.at > b.at ? -1 : 1));
  };
  const campsOf = (c) => c.camps.map((k) => DB.byCamp[k]).filter(Boolean);
  /* A BDR is on a campaign; a manager owns it. The same word, because it is
     the same question — is this mine to work — and every surface that asks it
     (the switcher's count, the campaign list, the guard on a campaign page,
     the tag a queue card carries) gets the right answer without knowing who
     is asking. */
  const mine = (c) => (isMgr() ? c.owner === me().id : c.crew.indexOf(me().id) >= 0);
  const myCampaigns = () => DB.camp.filter((c) => mine(c) && c.state !== 'done');
  /* ══ PAST ITS END DATE IS CLOSED ═══════════════════════════════════════
     Whatever its state says — the seed's dates drift as real days pass. A
     closed campaign stays yours to read, and stops feeding your queue: the
     surface said "past its end date" over a card that said "Work it" and
     84 people to ring. */
  const campOpen = (k) => k.state !== 'done' && k.to >= TODAY_ISO;
  const membersOf = (campId) => (DB.membersOf[campId] || []).map((id) => DB.byCon[id]);

  /* A follow-up that has come due. `overdue` and `dueToday` were separate and
     the difference decided a bucket; there is no such bucket now, so there is
     one predicate and it means "the date has arrived". */
  const dueToday = (c) => !!(c.next && c.next.due <= TODAY_ISO);
  const untouched = (c) => c.checkpoint === 'not-called';
  /* `stale`, `daysSinceCall` and `awaitingDecision` were here and are gone
     with the buckets that were their only readers. A derivation nothing calls
     is a claim nothing checks. */

  /* Who a BDR may ring: a number, not opted out, and still on the part of
     the ladder that is rung. ONCE A MEETING IS BOOKED THEY LEAVE THE QUEUE —
     the BDR's part is done until it happens, and a caller working a list
     does not want the people they have already closed in it. A callback with
     a date in the future is parked until that date. */
  const callable = (c) =>
    !!c.phone && !c.dnc && !isExit(c.checkpoint) && rank(c.checkpoint) <= 3 &&
    !(c.next && c.next.due > TODAY_ISO);

  /* ══ A MEETING THAT HAS PASSED IS A QUESTION ═══════════════════════════
     Once a meeting is booked they leave the queue; once its day has gone
     by, the flowchart asks whether they turned up, and nothing in the
     product did but the bell. This is that cut. */
  const afterMeeting = (c) => c.checkpoint === 'meeting-set' && !!c.next && c.next.due < TODAY_ISO;

  /* ══ 6. THE URL IS THE STATE ════════════════════════════════════════════
     One object mirrors the query string, one function writes it, one function
     repaints. A surface that is not in the URL is a surface you cannot send
     anybody. */
  /* ══ ONE SURFACE AT A TIME ══════════════════════════════════════════════
     `on` names the top-level surface and there are three of them: the calls,
     the campaigns, the lists. They were stacked on one page and the result
     was a single scroll holding three unrelated jobs — you could not get to
     the campaigns without going past a thousand people, and the lists had no
     door at all.

     Under those sit the three records: one campaign, one person, one list. */
  const SCALAR = ['on', 'con', 'acc', 'camp', 'list', 'build', 'bk', 'bt', 'q', 'p', 'find', 'chat', 'as'];
  const DEFAULTS = { q: 'all', on: 'calls' };
  const S = Object.create(null);

  function parse() {
    const p = new URLSearchParams(location.search);
    SCALAR.forEach((k) => (S[k] = p.get(k) || DEFAULTS[k] || ''));
  }
  function qs(over) {
    const next = Object.assign(Object.create(null), S, over || {});
    const parts = [];
    SCALAR.forEach((k) => {
      const v = next[k];
      if (v && v !== DEFAULTS[k]) parts.push(k + '=' + encodeURIComponent(v));
    });
    return parts.length ? '?' + parts.join('&') : location.pathname;
  }
  /* Every key back to its default. Home is this and nothing laid over it. */
  function cleared() {
    const over = Object.create(null);
    SCALAR.forEach((k) => { if (k !== 'as') over[k] = ''; });
    return over;
  }
  /* ══ THE GATE ON LEAVING AN UNSAVED RESULT ═════════════════════════════
     V3 guarded a drafted list with its decision surface — the list's name,
     how many are in it, and the two ways out — after trying a browser
     `beforeunload` prompt and throwing it out: the browser draws that one,
     so it cannot say what it is about, and it only ever offers leave or
     stay when the decision has three answers.

     Ours is that decision, drawn INLINE at the top of the result rather
     than as a modal: a press that would leave the builder with a result
     nobody has saved does not navigate; it paints the gate, which names
     the count and offers Save, Save onto a campaign, Discard, Stay. Only
     a door out of the builder trips it — changing the criteria or the
     supplier stays inside and is not a decision about the result. */
  let LEAVE = null;
  let LEAVE_OK = false;
  function leavingResult(over) {
    if (LEAVE_OK || S.build !== 'done' || !DRAFT || !(DRAFT.rows || []).length) return false;
    const next = Object.assign(Object.create(null), S, over || {});
    return !next.build;
  }
  function goFree(over, replace) { LEAVE_OK = true; try { go(over, replace); } finally { LEAVE_OK = false; } }

  /* ══ AND THE BROWSER'S BACK BUTTON ═══════════════════════════════════════
     A door in the product can be intercepted; the browser's Back cannot be
     refused, only answered. So while an unsaved result is on screen the
     history carries one extra entry — the same URL, marked — and Back lands
     on the entry beneath it, which is still the result. The popstate handler
     sees the mark is gone, puts it back, and paints the gate. Stay leaves
     the guard standing; Save and Discard move on through goFree. */
  let BACK_GUARD = false;
  function guardBack() {
    const want = S.build === 'done' && DRAFT && (DRAFT.rows || []).length > 0;
    if (want && !BACK_GUARD) { history.pushState({ aimyGuard: 1 }, '', location.href); BACK_GUARD = true; }
    if (!want) BACK_GUARD = false;
  }

  function go(over, replace) {
    if (leavingResult(over)) {
      LEAVE = { over: over, replace: !!replace };
      paint();
      byId('pageScroll').scrollTop = 0;
      return;
    }
    const wasOn = S.con + '|' + S.camp;
    const wasSurface = [S.on, S.con, S.acc, S.camp, S.list, S.build].join('|');
    const url = qs(over);
    if (replace) history.replaceState(null, '', url);
    else history.pushState(null, '', url);
    parse();
    paint();
    /* ══ A NEW SURFACE ARRIVES; A REPAINT DOES NOT ═════════════════════════
       The page is rebuilt from a string, so opening a person from the queue
       was a hard cut: one frame the queue, the next frame their record, with
       nothing between to say one became the other — while a toast, a menu
       and a turn in the canvas all arrive. The surface arrives now, 200ms up
       through six pixels, and ONLY when the surface changed. A write repaints
       the page it is on, and a page of the queue turning is the same list
       under your hands; animating either would charge attention on the two
       things a caller does most. */
    if (wasSurface !== [S.on, S.con, S.acc, S.camp, S.list, S.build].join('|')) arrive();
    /* A NEW SURFACE STARTS AT ITS TOP; A NEW PAGE OF ONE DOES NOT.
       Opening a person from row eleven of the queue landed on their record
       eleven rows down it — the header, the ladder and the whole reason you
       opened it were above the fold. Moving through the queue's pages is the
       opposite case: you are working a list, the rows change underneath you,
       and being thrown to the top of the document each time is what makes a
       pager worse than a scroll. */
    if (wasOn !== S.con + '|' + S.camp) byId('pageScroll').scrollTop = 0;
  }

  function arrive() {
    const host = byId('wbStage');
    if (!host) return;
    host.classList.remove('is-arriving');
    void host.offsetWidth;
    host.classList.add('is-arriving');
    /* Taken off again once it has run. Left on, the next repaint's fresh
       surface would match the rule and arrive too — which is every write and
       every page of the queue, the two things this must never animate. */
    clearTimeout(arrive.t);
    arrive.t = setTimeout(() => host.classList.remove('is-arriving'), 260);
  }

  /* ══ 7. PAINTING ════════════════════════════════════════════════════════ */

  /* The shell is `sales.css`'s and this does not repaint it: it fills the
     hosts the document already has. `#wbStage` is the surface, `#appRail` is
     the reading beside it, and the topnav's identity is written once.

     THE OTHER THREE HOSTS ARE EMPTIED, NOT LEFT. `#navBar`, `#filterBar` and
     `#chipBar` belong to a workbench this build does not have — a filter row
     standing above a queue that reads no filters is a control that lies
     about what it does. */
  /* ══ WHAT THE LAST PAINT LEFT BEHIND ═══════════════════════════════════
     The page is rebuilt from a string, so nothing on it knows where it was
     a frame ago. Two things want to: the rule under Calls · Campaigns ·
     Lists, which slides from the surface you left to the one you chose, and
     the figures a write just changed, which tick once. Both are read before
     the rebuild and settled after it (bdr.css §32). */
  function prePaint() {
    const out = { bar: null, figs: null };
    const on = document.querySelector('.b-switch-btn.is-on');
    if (on) out.bar = { x: on.offsetLeft, w: on.offsetWidth };
    if (FIG_TICK) {
      out.figs = Object.create(null);
      document.querySelectorAll('[data-fig]').forEach((el) => { out.figs[el.getAttribute('data-fig')] = el.textContent; });
    }
    FIG_TICK = false;
    return out;
  }
  /* FLIP: put the bar where it was, let the browser see it there, then
     send it where it goes. No previous place, no motion. */
  function placeSwitchBar(from) {
    const bar = document.querySelector('.b-switch-bar');
    const on = document.querySelector('.b-switch-btn.is-on');
    if (!bar || !on) return;
    if (from && (from.x !== on.offsetLeft || from.w !== on.offsetWidth)) {
      bar.style.transition = 'none';
      bar.style.transform = 'translateX(' + from.x + 'px) scaleX(' + from.w + ')';
      void bar.offsetWidth;
      bar.style.transition = '';
    }
    bar.style.transform = 'translateX(' + on.offsetLeft + 'px) scaleX(' + on.offsetWidth + ')';
  }
  function postPaint(pre) {
    placeSwitchBar(pre.bar);
    if (!pre.figs) return;
    document.querySelectorAll('[data-fig]').forEach((el) => {
      const was = pre.figs[el.getAttribute('data-fig')];
      if (was === undefined || was === el.textContent) return;
      el.innerHTML = '<span class="b-tick">' + el.innerHTML + '</span>';
    });
  }
  function paint() {
    const pre = prePaint();
    SAID_SIGNAL = null;
    dropLists();
    GRID_AT = -1;
    byId('navBar').innerHTML = '';
    byId('filterBar').innerHTML = '';
    byId('chipBar').innerHTML = '';
    paintWho();
    byId('wbStage').innerHTML = S.con ? contactPage()
      : S.acc ? accPage()
      : S.camp ? campPage()
      /* A LIST URL IS A LIST, WHICHEVER DOOR IT CAME THROUGH. Save and the old
         row door navigated to ?list=<id> without on=lists, and the dispatch only
         reached the lists surface through on — so saving a list landed on the
         queue with the new list nowhere in sight. */
      : (S.on === 'lists' || S.list || S.build) ? listsPage()
      : S.on === 'deals' ? dealsPage()
      : S.on === 'camps' ? campsPage()
      : homePage();
    mountLists();
    paintRail();
    refreshTasks();
    paintProto();
    guardBack();
    postPaint(pre);
    if (byId('aimyOverlay').classList.contains('open')) { paintBasis(); paintChats(); }
  }

  /* The lists a surface declares, mounted after its markup exists. Kept apart
     from the page's string because a windowed list cannot be one: it has to
     measure where it landed before it knows which rows to draw. */
  function mountLists() {
    const nl = byId('netList');
    if (nl) {
      vlist({ host: nl, items: paged((DRAFT && DRAFT.rows) || []).rows, rowH: 132,
        rowClass: 's-brow', key: (n) => n.id, row: netRow,
        empty: 'Nothing matches those criteria.' });
    }
  }

  /* ══ ONE PERSON, AS A CARD ══════════════════════════════════════════════
     A row had space for a name, a line and a button, which is enough to be
     ranked by and not enough to prepare with — so every call started by
     opening the record to find out who this was. A card holds what a caller
     wants before the phone rings: who and where they sit, how big the
     company is, which campaign this is, what happened last time in the
     words it was written in, and the number itself.

     The card is the design system's `type-card`, in the shell's own grid.
     Nothing new is drawn; the only thing this build adds is the three-column
     shape, because a card of this height at full width would be one call per
     screen. */
  function qcard(c, i) {
    const a = accOf(c);
    const camp = DB.byCamp[c.camps.filter((k) => DB.byCamp[k] && mine(DB.byCamp[k]))[0] || c.camps[0]];
    /* At the caller's desk the tag is the rung; at the manager's it is the
       stage, because the rung stopped moving at the hand-over. */
    const r = isMgr() ? DEAL_STAGE[stageOf(c)] : (RUNG[c.checkpoint] || RUNG['not-called']);
    const last = (DB.touchesOf[c.id] || []).map((id) => TOUCH[id]).filter(Boolean)[0];
    /* THE CARD CARRIES ITS PLACE. Only the arrival reads it — cards settle
       in order, 30ms apart, capped at the eighth so the last of fifteen is
       not made to wait a quarter of a second — and a repaint never runs the
       arrival, so the number is inert the rest of the time. */
    return '<article class="type-card s-card b-qcard" data-card="' + esc(c.id) + '" ' +
      'style="--i:' + Math.min(i || 0, 8) + '" ' +
      'data-open="con:' + esc(c.id) + '">' +
      '<div class="tc-head">' +
        '<span class="tag tag-' + esc(r.tone) + '">' + esc(r.label) + '</span>' +
        (camp ? '<span class="tc-type">' + esc(camp.name) + '</span>' : '') +
      '</div>' +
      '<button class="tc-title s-card-title" type="button" data-con="' + esc(c.id) + '">' +
        esc(c.name) + '</button>' +
      /* Two elements, not one with a break in it. Who they are and where they
         work are different ranks — the role is the thing you open on, the
         company is context you read once — and one paragraph holding both
         forced them to the same size, weight and ink. */
      '<p class="tc-summary b-qcard-role">' + esc(c.title) + '</p>' +
      (a ? '<p class="b-qcard-where">' + esc(a.name) + ' · ' +
        esc(INDUSTRY[a.industry].label) + ' · ' + esc(a.city) +
        ' · ' + commas(a.size) + ' staff</p>' : '') +
      '<div class="b-qcard-why">' + (isMgr() ? dealWhy(c) : whyLine(c)) + '</div>' +
      /* What was actually said, in the words it was written in. A caller
         opening cold on somebody they rang last week is the thing this card
         exists to stop. */
      (last && last.note
        ? '<p class="tc-quote b-qcard-note">' + esc(last.note) + '</p>'
        : '') +
      aimyBlock(aimySays(c)) +
      '<div class="tc-gov b-qcard-foot">' +
        /* What it is worth, where the number to ring sits on the caller's
           card: the one figure a manager scans a list of deals for. */
        '<span class="b-qcard-num">' +
          (isMgr() ? esc(euro(amountOf(c))) : c.phone ? esc(c.phone) : 'No number') + '</span>' +
        /* Only the first card is filled. Fifteen identical primaries is
           fifteen recommendations, which is none — the list is already
           ranked, so the top card is the recommendation and says so by being
           the only filled thing on the surface. */
        (isMgr()
          ? '<button class="s-insight-lnk' + (i === 0 ? ' primary' : '') +
            '" type="button" data-con="' + esc(c.id) + '">Open</button>'
          : afterMeeting(c)
          /* the decision, inline, on the card: the meeting is the fact, the
             two answers are the whole of the job on this cut */
          ? '<span class="b-qcard-decide">' +
              '<button class="s-insight-lnk" type="button" data-decide="showed-up" data-for="' + esc(c.id) + '">They showed up</button>' +
              '<button class="s-inline-btn" type="button" data-decide="no-show" data-for="' + esc(c.id) + '">Did not show</button>' +
            '</span>'
          : callable(c)
            ? '<button class="s-insight-lnk' + (i === 0 ? ' primary' : '') +
              '" type="button" data-call="' + esc(c.id) + '">' + rowVerb() + '</button>'
            /* NO CALL ON SOMEBODY YOU CANNOT RING. A do-not-call, a hand-over, a
               person with no number — the card offered Call on all of them. */
            : !c.phone && !c.dnc && !isExit(c.checkpoint)
              ? '<button class="s-inline-btn" type="button" data-enrichcon="' + esc(c.id) + '">Find a number</button>'
              : '<button class="s-inline-btn" type="button" data-con="' + esc(c.id) + '">Open</button>') +
      '</div>' +
    '</article>';
  }

  /* The queue's own renderer. Not `vlist`: that positions rows by arithmetic
     down one column, and a grid's geometry is the browser's job. A page is
     fifteen cards, so there is nothing to window. */
  /* AN EMPTY GRID HAS TO SAY WHICH EMPTINESS IT IS. "Nobody on this rung"
     is true of a cut with nobody in it and false of a search that found
     nothing — and the second is the one you reach by typing, where the
     answer you need is your own words back and a way out of them. */
  function qgrid(rows, emptyText) {
    if (!rows.length) {
      if (emptyText) return '<p class="b-vfoot">' + esc(emptyText) + '</p>';
      return S.find
        ? '<p class="b-vfoot">Nobody here matches “' + esc(S.find) + '”. ' +
          '<button class="s-inline-btn" type="button" data-findclear>Clear it</button></p>'
        : '<p class="b-vfoot">Nobody on this rung.' +
          /* A cut with nobody in it is one press from the cut with
             everybody. An empty state that only says it is empty leaves
             the caller to work out that the chip row above is the way out. */
          (S.q && S.q !== 'all'
            ? ' <button class="s-inline-btn" type="button" data-q="all">Show everyone</button>'
            : '') + '</p>';
    }
    return '<div class="b-grid">' + rows.map(qcard).join('') + '</div>';
  }

  /* ══ WHAT AiMY KNOWS ABOUT THIS ONE ═════════════════════════════════════
     One line per card, and every one of them is read off the corpus rather
     than composed. That is the whole discipline here: a line under the AiMY
     mark is a claim the product is making, and a caller who finds one of
     them wrong stops reading all of them.

     So each branch names the record it came from. Ranked by how much it
     changes the next sixty seconds — something a person wrote down beats
     something the pattern noticed. */
  /* ══ A SIGNAL IS FRESH FOR THREE WEEKS ═════════════════════════════════
     After that it is history, and history is what the calls already say. */
  const SIGNAL_FRESH_DAYS = 21;
  /* The company whose page is being drawn: its lead says the signal, so
     its cards say the next thing they know instead. */
  let SAID_SIGNAL = null;
  const signalOf = (a) => (a && a.signal && daysBetween(a.signal.at, TODAY_ISO) <= SIGNAL_FRESH_DAYS ? a.signal : null);
  /* What the signal does to what they said. The notes' example: the budget
     came up, then they raised a round — the objection has moved. */
  function signalMeans(sig, hist) {
    const objs = [];
    (hist || []).forEach((t) => (t.objections || []).forEach((o) => { if (objs.indexOf(o) < 0) objs.push(o); }));
    const had = (k) => objs.indexOf(k) >= 0;
    if (sig.k === 'funded') {
      if (had('pricing')) return 'Pricing came up before. The budget has just moved.';
      if (had('timing')) return 'Timing came up before. A round changes the quarter.';
      return 'Money just arrived; open on what they will spend it on.';
    }
    if (sig.k === 'hiring') {
      if (had('feature') || had('service')) return 'They said it did not do enough; they are hiring people to do it by hand.';
      return 'They are hiring into the work we sell. Open on the roles.';
    }
    if (sig.k === 'new-hire') {
      if (objs.length) return esc(OBJECTION[objs[0]].label) + ' came up with the last person. This is a new one.';
      return 'A new decision-maker; the old no does not bind them.';
    }
    if (sig.k === 'renewal-near') return 'A renewal is the one moment they compare. Open on it.';
    return 'They came to us. Open on what they looked at.';
  }
  function signalReading(a, sig, hist) {
    return {
      text: esc(a.name) + ' ' + esc(sig.text) + ' · seen ' + esc(sayWhen(sig.at)) + '. ' + signalMeans(sig, hist),
      from: 'a signal from ' + sig.src,
    };
  }

  /* ══ FOUR TOUCHES BEFORE YOU LET GO ════════════════════════════════════
     The notes' rule. Somebody rung or reached, under four touchpoints,
     quiet for a week, nothing owed: the rule says touch them again. Returns
     the touches so far when the rule applies, otherwise nothing. */
  const TOUCH_RULE = 4;
  const QUIET_DAYS = 7;
  function quietUnderFour(c) {
    if (isExit(c.checkpoint) || rank(c.checkpoint) < 1 || rank(c.checkpoint) > 3) return 0;
    const ids = DB.touchesOf[c.id] || [];
    if (!ids.length || ids.length >= TOUCH_RULE) return 0;
    if (c.next && c.next.due > TODAY_ISO) return 0;
    const last = TOUCH[ids[0]];
    return last && daysBetween(last.at.slice(0, 10), TODAY_ISO) >= QUIET_DAYS ? ids.length : 0;
  }
  const quietSay = (n, c) => {
    const last = TOUCH[(DB.touchesOf[c.id] || [])[0]];
    return plural(n, 'touch', 'touches') + ', then ' + (last ? plural(daysBetween(last.at.slice(0, 10), TODAY_ISO), 'day') : 'a while') +
      ' of nothing. The rule is ' + TOUCH_RULE + ' before you let go.';
  };

  function aimySays(c, onRecord) {
    const camp = DB.byCamp[campFor(c)];
    const hist = (DB.touchesOf[c.id] || []).map((id) => TOUCH[id]).filter(Boolean);
    const last = hist[0];
    const a = accOf(c);

    /* A WAY OUT READS AS WHAT IT IS. The hour reading and "ring the mobile"
       were being offered on a number that is not theirs. */
    if (c.checkpoint === 'wrong-number') {
      return { text: 'The number is not theirs. Nothing on it counts until somebody finds one that is.',
        from: 'the last call' };
    }
    if (c.dnc || c.checkpoint === 'do-not-call') return null;

    /* ══ SOMETHING CHANGED AT THE COMPANY ═══════════════════════════════
       Fresh news outranks the last call: it is the one thing that can
       turn a no into a different conversation, and it is paired with
       what they said. */
    const sig = signalOf(a);
    if (sig && !(a && a.id === SAID_SIGNAL)) return signalReading(a, sig, hist);

    /* Somebody wrote this down about them, on purpose. On the record it
       already has a home — the stand section prints it — so the reading
       moves on to the next thing it knows rather than saying it twice on
       one screen. */
    if (c.remember && !onRecord) {
      return { text: esc(c.remember.text), from: actor(c.remember.by).name + ' noted it' };
    }
    /* They pushed back, and the campaign has an agreed answer to it. */
    if (last && last.objections.length && camp) {
      const k = last.objections[0];
      const agreed = camp.objections.filter((o) => o.k === k)[0];
      return {
        text: esc(OBJECTION[k].label) + ' came up last time. ' +
          esc(agreed ? agreed.say : OBJECTION[k].blurb),
        from: agreed ? 'the campaign’s answer to it' : 'the call before this one',
      };
    }
    /* An opening a monitor picked up. */
    if (last && last.openings.length) {
      return { text: esc(openLabel(last.openings[0])) + ' — worth opening on.',
        from: 'a signal on the account' };
    }
    /* Screened. The hour is measured, not guessed. */
    if (last && last.outcome === 'gatekeeper') {
      const h = bestHour();
      return {
        text: 'Reception took it last time' + (h ? '. This book gets through most around ' +
          h.hour + ':00 — ' + h.pct + '% of ' + commas(h.n) + ' calls' : '.'),
        from: h ? 'every call on the record' : 'the call before this one',
      };
    }
    /* Rung and rung and nothing. That is a fact about the number. */
    if (c.attempts >= 3 && c.checkpoint === 'no-answer') {
      return { text: plural(c.attempts, 'attempt') + ' and nobody has picked up. ' +
        'The number may not be the one they answer.', from: 'this record’s own history' };
    }
    /* Under four touches and gone quiet: the rule says touch them again. */
    const quiet = quietUnderFour(c);
    if (quiet) return { text: quietSay(quiet, c), from: 'the four-touch rule' };
    /* Nothing has happened yet, so the useful thing is who they are. */
    if (!hist.length && a && camp) {
      return {
        text: esc(INDUSTRY[a.industry].label) + ' at ' + commas(a.size) + ' staff, and this ' +
          'campaign sells ' + esc(SELL[camp.sells[0]].name) + ' on ' +
          esc(SELL[camp.sells[0]].blurb) + '.',
        from: 'the account and the campaign',
      };
    }
    if (last) {
      /* `kindLabel`, not `OUTCOME[...]`. The newest touchpoint stopped being
         guaranteed to be a call the moment a rung could be settled by hand
         and a profile could be sent, and this read `undefined.label` on both
         — a throw inside the page's own string, so the whole record failed to
         render and the surface simply kept showing the version before the
         write. A write that appears not to have happened. */
      return { text: 'Last was ' + esc(kindLabel(last).toLowerCase()) + ', ' +
        esc(sayWhen(last.at)) + '.', from: 'the touchpoint before this one' };
    }
    return null;
  }

  /* The hour this book actually gets through, with the count behind it. Null
     until there are enough calls in an hour for the rate to mean anything. */
  let HOUR_CACHE = null;
  function bestHour() {
    if (HOUR_CACHE !== null) return HOUR_CACHE;
    const hours = Object.create(null);
    DB.touch.forEach((t) => {
      const h = new Date(t.at).getHours();
      if (h < 7 || h > 19) return;
      const b = hours[h] || (hours[h] = { n: 0, got: 0 });
      b.n++;
      if (t.outcome === 'reached') b.got++;
    });
    const best = Object.keys(hours).filter((h) => hours[h].n >= 40)
      .sort((x, y) => hours[y].got / hours[y].n - hours[x].got / hours[x].n)[0];
    HOUR_CACHE = best
      ? { hour: Number(best), n: hours[best].n, pct: Math.round((hours[best].got / hours[best].n) * 100) }
      : false;
    return HOUR_CACHE;
  }

  /* The AiMY block on a card. The mark, the line, and where the line came
     from — because an insight that cannot say its basis is an assertion. */
  function aimyBlock(said) {
    if (!said) return '';
    /* THE SIZE IS AN ATTRIBUTE, NOT ONLY A RULE. An `<svg>` with no width or
       height attribute and no CSS reaching it falls back to the replaced
       element default and fills its container — measured here as a mark six
       hundred pixels tall, one per card, with the card's own content pushed
       off the screen. It happened because the stylesheet was a version behind
       in the browser, which is a thing that will happen again; the markup
       carrying its own size means a stale sheet is a plain card rather than
       an unusable one. */
    return '<div class="b-aimy">' +
      '<svg class="b-aimy-mark" width="13" height="15" viewBox="0 0 18 20" aria-hidden="true">' +
        '<use href="#aimy-logo-small"/></svg>' +
      '<span class="b-aimy-say">' + said.text +
        '<span class="b-aimy-from">' + esc(said.from) + '</span>' +
      '</span>' +
    '</div>';
  }

  /* ══ A CAMPAIGN, AS THE SAME CARD ═══════════════════════════════════════
     Same anatomy as a person: what it is across the top, the name, the
     context under it, the numbers that decide whether to open it, what AiMY
     makes of it, and one way in at the foot. Two card designs for two lists
     on the same product is two things to learn for one job. */
  function ccard(k, i) {
    const q = queue(k.id);
    const back = q.filter((c) => c.checkpoint === 'callback').length;
    const fresh = q.filter((c) => c.checkpoint === 'not-called').length;
    const left = daysBetween(TODAY_ISO, k.to);
    const members = membersOf(k.id);
    return '<article class="type-card s-card b-qcard" data-open="camp:' + esc(k.id) + '" ' +
      'style="--i:' + Math.min(i || 0, 8) + '">' +
      '<div class="tc-head">' +
        '<span class="tag tag-' + (left > 0 && left < 21 ? 'warn' : 'neutral') + '">' +
          (left > 0 ? esc(plural(left, 'day')) + ' left' : 'closed ' + esc(sayWhen(k.to))) + '</span>' +
        '<span class="tc-type">' + esc(SELL[k.sells[0]].name) + '</span>' +
      '</div>' +
      '<button class="tc-title s-card-title" type="button" data-camp="' + esc(k.id) + '">' +
        esc(k.name) + '</button>' +
      '<p class="tc-summary">' + esc(k.goal) + '.</p>' +
      (campOpen(k)
        ? '<div class="b-qcard-why"><b>' + commas(q.length) + '</b> of its ' +
          plural(members.length, 'person') + ' to ring' +
          (back ? ', <b>' + back + '</b> ' + verbFor(back, 'callback') : '') +
          (fresh ? ', <b>' + commas(fresh) + '</b> never rung' : '') + '</div>'
        : '<div class="b-qcard-why"><b>' + commas(members.filter((c) => c.checkpoint === 'not-called').length) +
          '</b> of its ' + plural(members.length, 'person') + ' never rung when it closed</div>') +
      aimyBlock(campSays(k, q, back, fresh, left)) +
      '<div class="tc-gov b-qcard-foot">' +
        '<span class="b-qcard-num">' + esc(actor(k.owner).name) + '</span>' +
        '<button class="s-insight-lnk' + (i === 0 && campOpen(k) ? ' primary' : '') +
          '" type="button" data-camp="' + esc(k.id) + '">' + (campOpen(k) ? 'Work it' : 'Open') + '</button>' +
      '</div>' +
    '</article>';
  }
  function cgrid(rows) {
    if (!rows.length) return '<p class="b-vfoot">You are on no campaign.</p>';
    return '<div class="b-grid">' + rows.map(ccard).join('') + '</div>';
  }

  /* What AiMY makes of a campaign, off its own calls. Ranked by what would
     change what you do with it this morning. */
  function campSays(k, q, back, fresh, left) {
    const mine2 = DB.touch.filter((t) => t.camp === k.id);
    /* closed: the one fact is how it closed */
    if (left <= 0) {
      const st = campStand(k);
      return { text: 'It closed ' + esc(sayWhen(k.to)) +
        (st.target ? (st.need ? ', <b>' + commas(st.need) + '</b> short of its goal.' : ', past its goal.') : '.'),
        from: 'the window and the goal' };
    }
    /* ══ IT MUST NOT REPEAT THE LINE ABOVE IT ═══════════════════════════
       This led with the callback count, and the callback count is already
       on the numbers line six pixels up — so every card said the same thing
       twice, and across a page of fourteen campaigns AiMY said the identical
       sentence fourteen times. A block that restates the figure beside it is
       not an insight, it is a second copy, and a reader who sees it be
       redundant once stops reading it everywhere.

       So it says what the numbers cannot: what this audience pushes back on,
       whether the window is about to close on people nobody has rung, and
       how often the calls here actually connect. */

    /* What this audience actually pushes back on, counted. */
    const objs = Object.create(null);
    mine2.forEach((t) => t.objections.forEach((o) => (objs[o] = (objs[o] || 0) + 1)));
    const top = Object.keys(objs).sort((a, b) => objs[b] - objs[a])[0];
    if (top && objs[top] >= 3) {
      const agreed = k.objections.filter((o) => o.k === top)[0];
      return {
        text: esc(OBJECTION[top].label) + ' came up on <b>' + objs[top] + '</b> calls here. ' +
          esc(agreed ? agreed.say : OBJECTION[top].blurb),
        from: commas(mine2.length) + ' calls on this campaign',
      };
    }
    if (left > 0 && left < 21 && fresh) {
      return { text: '<b>' + commas(fresh) + '</b> have never been rung and it closes in ' +
        plural(left, 'day') + '.', from: 'the window and the roster' };
    }
    const got = mine2.filter((t) => t.outcome === 'reached').length;
    if (mine2.length >= 20) {
      return { text: '<b>' + Math.round((got / mine2.length) * 100) + '%</b> of the ' +
        commas(mine2.length) + ' calls here got through.', from: 'every call on this campaign' };
    }
    return null;
  }

  /* ══ A LIST, AS THE SAME CARD ═══════════════════════════════════════════ */
  function lcard(l, i) {
    const camp = l.for && DB.byCamp[l.for];
    const people = l.has.map((id) => DB.byCon[id]).filter(Boolean);
    const ring = people.filter(callable).length;
    return '<article class="type-card s-card b-qcard" data-open="list:' + esc(l.id) + '">' +
      '<div class="tc-head">' +
        /* The tag says WHICH campaign. "On a campaign" told you the state
           and made you open the card to learn the one fact that matters. */
        '<span class="tag tag-' + (camp ? 'ok' : 'warn') + '">' +
          (camp ? 'On ' + esc(camp.name) : 'Not on a campaign') + '</span>' +
        '<span class="tc-type">' + esc(l.via) + '</span>' +
      '</div>' +
      '<button class="tc-title s-card-title" type="button" data-list="' + esc(l.id) + '">' +
        esc(l.name) + '</button>' +
      '<p class="tc-summary">' + esc(l.crit) + '.</p>' +
      '<div class="b-qcard-why"><b>' + commas(people.length) + '</b> people, <b>' +
        commas(ring) + '</b> of them ringable</div>' +
      aimyBlock(listSays(l, people, ring, camp)) +
      '<div class="tc-gov b-qcard-foot">' +
        '<span class="b-qcard-num">built ' + esc(sayWhen(l.at)) + '</span>' +
        '<button class="s-insight-lnk' + (i === 0 ? ' primary' : '') +
          '" type="button" data-list="' + esc(l.id) + '">Open</button>' +
      '</div>' +
    '</article>';
  }
  function lgrid(rows) {
    if (!rows.length) {
      return '<p class="b-vfoot">You have not built one yet. ' +
        '<button class="s-inline-btn" type="button" data-bopen>Find leads</button></p>';
    }
    return '<div class="b-grid">' + rows.map(lcard).join('') + '</div>';
  }

  function listSays(l, people, ring, camp) {
    if (!camp) {
      /* the facts above say "7 on AiMY Knowledge"; the lead cannot then say
         nobody is in the queue */
      const on = people.filter((c) => c.camps.some((k) => DB.byCamp[k] && mine(DB.byCamp[k]))).length;
      if (on) {
        return { text: '<b>' + commas(people.length - on) + '</b> of the ' + commas(people.length) +
          ' are on no campaign, so they are not in your queue. The ' + commas(on) + ' already on one of yours are.',
          from: 'the list having no campaign' };
      }
      return { text: 'Nobody on this list is in your queue until it is on a campaign.',
        from: 'the list having no campaign' };
    }
    /* WHAT IT SAYS IS WHAT IT COUNTS. This was people minus the callable,
       which folds in parked callbacks and exits — a list of 38 with 7 missing
       numbers read "13 came back without a number". */
    const gap = people.filter((c) => !c.phone).length;
    if (gap) {
      return { text: '<b>' + commas(gap) + '</b> of them came back without a number, so they ' +
        'cannot be rung.', from: l.via + ' filled the rest' };
    }
    const done = people.filter((c) => c.checkpoint !== 'not-called').length;
    return { text: '<b>' + commas(done) + '</b> of ' + commas(people.length) + ' have been rung.',
      from: 'their own records' };
  }


  /* The same call, seen from the campaign rather than from the person — so
     the name leads, because on this surface WHO is the thing you do not
     already know. */
  function campFeedItems(campId) {
    return DB.touch.filter((t) => t.camp === campId).sort((a, b) => (a.at > b.at ? -1 : 1));
  }

  /* ══ THE LAST EIGHT, UNDER THE DAY THEY HAPPENED ═══════════════════════
     A windowed list for eight rows was machinery with nothing to window,
     and it cost the one thing a caller back from a run wants: to see at a
     glance what happened TODAY. A plain list, a heading where the day
     changes, the count of what it is the last eight of. */
  const dayLabel = (iso) => {
    const n = daysBetween(iso.slice(0, 10), TODAY_ISO);
    return n === 0 ? 'Today' : n === 1 ? 'Yesterday' : sayDay(iso);
  };
  function feedBlock(items, emptyHtml) {
    if (!items.length) {
      return '<p class="b-vfoot">' + (emptyHtml || 'Nothing has happened on this campaign yet.') + '</p>';
    }
    const pg = peek(items);
    let day = '';
    return '<div class="b-feed">' + pg.rows.map((t) => {
      const d = t.at.slice(0, 10);
      const head = d !== day ? '<h3 class="b-month">' + esc(dayLabel(t.at)) + '</h3>' : '';
      day = d;
      return head + '<div class="s-qrow b-feed-row">' + campTouchRow(t, true) + '</div>';
    /* the feed carries hand-moves, profiles and the director's meetings */
    }).join('') + '</div>' + peekFoot(pg, 'touchpoint');
  }

  const timeOf = (iso) => {
    const d = new Date(iso);
    const p2 = (x) => String(x).padStart(2, '0');
    return p2(d.getHours()) + ':' + p2(d.getMinutes());
  };
  function campTouchRow(t, underDay) {
    const c = DB.byCon[t.con];
    const o = OUTCOME[t.outcome];
    const head = kindLabel(t);
    return '<div class="s-qrow-id">' +
        '<button class="s-qrow-name" type="button" data-con="' + esc(t.con) + '">' +
          esc(c ? c.name : 'Somebody') + '</button>' +
        '<span class="s-qrow-sub">' + esc(head) + ' · ' + esc(whoDid(t).name) +
          ' · ' + esc(underDay ? timeOf(t.at) : sayWhen(t.at)) + '</span>' +
      '</div>' +
      '<div class="s-qrow-why"><span class="s-qrow-because">' + esc(t.note) + '</span></div>';
  }


  /* ── THE RAIL — one reading, in the shell's own card ──
     Same anatomy the V3 rail uses: a scope line, then a briefing card of
     conclusion, evidence and one named action. What it reads is scoped to
     whatever is open, because a reading about the whole book beside one
     person is a reading about something else. */
  const WS_LABEL = {
    detected: 'Found', recommended: 'Suggested', drafted: 'Drafted',
    staged: 'Awaiting you', completed: 'Done', failed: 'Stopped', reading: 'Reading',
  };

  function railReading() {
    const c = S.con && DB.byCon[S.con];
    if (c) {
      const n = (DB.touchesOf[c.id] || []).length;
      const r = RUNG[c.checkpoint];
      return {
        eyebrow: 'This person', subject: c.name,
        card: {
          state: 'reading',
          /* CALLS ARE CALLS. A hand-over settled by hand and the director's
             meetings are touchpoints, not rings; "Rung 19 times" over a
             ladder that said 12 attempts was the same record disagreeing
             with itself. */
          text: c.attempts
            ? 'Rung <b>' + plural(c.attempts, 'time') + '</b> and standing at <b>' + esc(r.label) +
              '</b> — ' + esc(r.say) + '.'
            : n
              ? '<b>' + plural(n, 'touchpoint') + '</b> and no call yet, standing at <b>' + esc(r.label) +
                '</b> — ' + esc(r.say) + '.'
              : 'Nobody has rung them yet. The campaign is the only thing that knows anything about them.',
          evidence: [{ val: c.attempts, cap: c.attempts === 1 ? 'call' : 'calls' },
            { val: n !== c.attempts ? n : 0, cap: n === 1 ? 'touchpoint' : 'touchpoints' }].filter((e) => e.val),
          act: c.next ? esc(c.next.what) + ' ' + esc(sayWhen(c.next.due)) : null,
        },
      };
    }
    const k = S.camp && DB.byCamp[S.camp];
    if (k && mine(k) && !campOpen(k)) {
      const members = membersOf(k.id);
      return {
        eyebrow: 'This campaign', subject: k.name,
        card: {
          state: 'completed',
          text: 'It closed <b>' + esc(sayWhen(k.to)) + '</b>. Nothing on it is dialled now.',
          evidence: [{ val: commas(members.length), cap: 'on it' },
            { val: commas(members.filter((c) => c.checkpoint === 'not-called').length), cap: 'never rung' }],
          act: null, q: null,
        },
      };
    }
    if (k && mine(k)) {
      const cq = queue(k.id);
      const cback = cq.filter((x) => x.checkpoint === 'callback').length;
      return {
        eyebrow: 'This campaign', subject: k.name,
        card: {
          state: cback ? 'staged' : 'detected',
          text: cback
            ? '<b>' + plural(cback, 'person') + '</b> on this campaign asked to be rung back.'
            : '<b>' + commas(cq.length) + '</b> people here are waiting to be rung.',
          evidence: [{ val: commas(cq.length), cap: 'to call' },
            { val: commas(membersOf(k.id).length), cap: 'on it' }],
          act: cback ? 'Show the ' + cback : null,
          q: cback ? 'callback' : null,
        },
      };
    }
    /* THE SIDEBAR READS THE PAGE IT IS BESIDE. A person got "This person"
       and a campaign "This campaign"; a company and a list got the whole
       book's callbacks, which is a card about somewhere else. */
    const a = S.acc && DB.byAcc[S.acc];
    if (a) {
      const people = consAt(a.id);
      const ring = people.filter(callable);
      const sig = signalOf(a);
      return {
        eyebrow: 'This company', subject: a.name,
        card: {
          state: sig ? 'detected' : 'reading',
          text: sig
            ? '<b>' + esc(a.name) + '</b> ' + esc(sig.text) + ' · seen ' + esc(sayWhen(sig.at)) + '.'
            : '<b>' + plural(people.length, 'person') + '</b> on the record here, ' +
              (ring.length ? '<b>' + commas(ring.length) + '</b> you can ring now.' : 'nobody you can ring now.'),
          evidence: [{ val: people.length, cap: 'here' }, { val: ring.length, cap: 'to call' }].filter((e) => e.val),
          act: null, q: null,
        },
      };
    }
    const l = S.list && DB.byList[S.list];
    if (l) {
      const people = l.has.map((id) => DB.byCon[id]).filter(Boolean);
      const withNum = people.filter((c) => c.phone).length;
      const on = l.for && DB.byCamp[l.for];
      return {
        eyebrow: 'This list', subject: l.name,
        card: {
          state: on ? 'reading' : 'staged',
          text: on
            ? '<b>' + commas(people.length) + '</b> people on ' + esc(on.name) + ', <b>' + commas(withNum) + '</b> with a number.'
            : (function () {
                const inQ = people.filter((c) => campsOf(c).some(mine)).length;
                return inQ
                  ? '<b>' + commas(people.length) + '</b> people and no campaign; <b>' + commas(inQ) + '</b> of them are in your queue through another.'
                  : '<b>' + commas(people.length) + '</b> people and no campaign, so none of them is in your queue.';
              })(),
          evidence: [{ val: people.length, cap: 'people' }, { val: withNum, cap: 'with a number' }].filter((e) => e.val),
          act: null, q: null,
        },
      };
    }
    const q = queue();
    const camps = myCampaigns();
    if (isMgr()) {
      const live = q.filter(dealLive);
      const now = live.filter((c) => dealRank(c) <= 2);
      const worth = live.reduce((n, c) => n + amountOf(c), 0);
      return {
        eyebrow: 'Your book', subject: null,
        card: {
          state: now.length ? 'staged' : 'detected',
          text: now.length
            ? '<b>' + plural(now.length, 'deal') + '</b> ' + (now.length === 1 ? 'wants' : 'want') +
              ' something today, out of the <b>' + commas(live.length) + '</b> you are running.'
            : '<b>' + commas(live.length) + '</b> deals are running and none of them is late.',
          evidence: [{ val: euro(worth), cap: 'open' }, { val: camps.length, cap: 'campaigns' }],
          act: null, q: null,
        },
      };
    }
    const back = q.filter((x) => x.checkpoint === 'callback').length;
    return {
      eyebrow: 'Your book', subject: null,
      card: {
        state: back ? 'staged' : 'detected',
        text: back
          ? '<b>' + plural(back, 'person') + '</b> asked to be rung back, across your ' +
            plural(camps.length, 'campaign') + '.'
          : '<b>' + commas(q.length) + '</b> people are waiting to be rung across your ' +
            plural(camps.length, 'campaign') + '.',
        evidence: [{ val: commas(q.length), cap: 'to call' }, { val: camps.length, cap: 'campaigns' }],
        act: back ? 'Show the ' + back : null,
        q: back ? 'callback' : null,
      },
    };
  }

  /* ══ THE HEADING IS THE SWITCHER ════════════════════════════════════════
     Not a control above the heading and not a column beside it: the title of
     the block IS the choice. A page whose heading reads "Calls" already
     names the other two things it could be showing, and a separate navigation
     component to say the same thing is a second row of chrome for a product
     with three surfaces.

     The one you are on is the heading, at heading weight. The other two sit
     beside it, quiet, and press to become the heading. */
  /* ══ FINDING ONE THING IN NINE HUNDRED ═════════════════════════════════
     The cuts narrow by rung and the pager walks fifteen at a time, and
     neither answers "where is Sofie". Nine hundred and seventy-six people
     across sixty-six pages is a list you have already failed to search.

     ONE BOX, THREE SURFACES, and what it matches is whatever the cards on
     that surface actually show: a person by their name, their title, their
     company or their campaign; a campaign by its name, its goal or what it
     sells; a list by its name, its criteria or who found it. Matching on
     something the card does not display is how a search returns a row
     whose presence the reader cannot account for.

     IT IS NOT THE COMPOSER. The bar at the foot of the page takes
     sentences and does things; this narrows a list in place. Two boxes
     only confuse each other when they do the same job, and these do not. */
  const findWords = () => S.find.toLowerCase().split(/\s+/).filter(Boolean);
  const matches = (hay) => {
    const w = findWords();
    if (!w.length) return true;
    const h = hay.toLowerCase();
    return w.every((x) => h.indexOf(x) >= 0);
  };
  const conHay = (c) => {
    const a = accOf(c);
    return [c.name, c.title, a ? a.name : '', a ? a.city : '',
      campsOf(c).map((k) => k.name).join(' ')].join(' ');
  };
  const campHay = (k) => [k.name, k.goal,
    k.sells.map((x) => (SELL[x] || {}).name || x).join(' ')].join(' ');
  const listHay = (l) => [l.name, l.crit, l.via].join(' ');

  /* The count is the point of the foot line, and it is the caller's own
     words handed back so a search that found nothing says what it looked
     for rather than only that it failed. */
  function findBox(placeholder) {
    return '<label class="b-find">' +
      '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" ' +
        'stroke-width="2" stroke-linecap="round" aria-hidden="true">' +
        '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>' +
      '<input type="text" data-find value="' + esc(S.find) + '" ' +
        'placeholder="' + esc(placeholder) + '" spellcheck="false" ' +
        'aria-label="' + esc(placeholder) + '">' +
      (S.find ? '<button class="b-find-x" type="button" data-findclear ' +
        'aria-label="Clear the search">×</button>' : '') +
    '</label>';
  }

  /* ══ BACK, AND IT SAYS WHERE ═══════════════════════════════════════════
     `Back to today` and `Back to the queue` were two names for one place —
     the briefing you start from — and neither carried an arrow, so the one
     control on the page whose whole meaning is a direction was drawn as a
     line of text. The chevron is V3's, at V3's weight. */
  /* WHERE BACK ACTUALLY GOES. A person opened from a company goes back to
     the company; the button said "Back to the briefing" on the way to
     somewhere else. The label reads the state, so it cannot lie. */
  /* ══ ONE WAY TO PUT SOMETHING ON A CAMPAIGN ════════════════════════════
     There were two. A found list used a menu hanging off its button; a saved
     list and a company used a panel that opened in the page with a search, a
     multiple choice and a confirm — three steps for a question with one
     answer, and the second thing a caller had to learn for the job they had
     just done a different way.

     The menu wins. It is the shape everything else here uses when a choice
     hangs off a verb, a name in it is the whole interaction, and a second
     campaign is a second press rather than a checkbox and a button. */
  function campMenu(o) {
    const ks = o.opts;
    if (!ks.length) return '';
    return '<span class="b-menu-wrap">' +
      '<button class="' + esc(o.cls || 's-inline-btn') + ' b-menu-open" type="button" ' +
        'data-pickopen="' + esc(o.id) + '" aria-haspopup="menu">' + esc(o.label) + '</button>' +
      '<div class="b-menu" id="' + esc(o.id) + '" role="menu" hidden>' +
        '<span class="b-menu-cap">' + esc(o.cap) + '</span>' +
        '<input class="b-pick-find b-menu-find" type="text" data-picksearch ' +
          'placeholder="Find a campaign" aria-label="Find a campaign" spellcheck="false" />' +
        ks.map((k) =>
          '<button class="b-menu-item" type="button" role="menuitem" ' +
          'data-puton="' + esc(o.go + '|' + k.id) + '">' +
            '<span class="b-menu-line"><span class="b-menu-name">' + esc(k.name) + '</span>' +
            '<span class="b-menu-sub">' + esc(plural(membersOf(k.id).length, 'person')) +
            ' on it</span></span>' +
          '</button>').join('') +
      '</div>' +
    '</span>';
  }
  const campOpts = () => myCampaigns().filter(campOpen).map((k) => ({ id: k.id, name: k.name }));

  /* ══ A MENU ON ITS BUTTON ══════════════════════════════════════════════
     Five managers do not need a search box, a multiple choice and a
     confirm — that is a form for a question with one answer. The verb
     opens a menu under itself, a name hands them over, and the toast's
     Undo is the way back. Escape and a click outside close it. */
  /* ══ THE COLLEAGUES ARE A MENU ═════════════════════════════════════════
     "2 others at Morberg Collection" counted people and opened a company,
     which is a label promising one thing and a click doing another. It
     names them: each row opens that person, and the last opens the
     company they are all at. */
  function coMenu(a, others, label) {
    const shown = others.slice(0, 6);
    return '<span class="b-menu-wrap">' +
      '<button class="s-inline-btn b-menu-open" type="button" data-pickopen="coMenu" ' +
        'aria-haspopup="menu">' + esc(label) + '</button>' +
      '<div class="b-menu" id="coMenu" role="menu" hidden>' +
        '<span class="b-menu-cap">Also at ' + esc(a.name) + '</span>' +
        shown.map((x) => {
          const rg = RUNG[x.checkpoint] || RUNG['not-called'];
          return '<button class="b-menu-item" type="button" role="menuitem" data-con="' + esc(x.id) + '">' +
            '<span class="b-rstate-dot ' + (TL_TONE[rg.tone] || 'tone-neutral') + '"></span>' +
            '<span class="b-menu-line"><span class="b-menu-name">' + esc(x.name) + '</span>' +
            '<span class="b-menu-sub">' + esc(x.title) + '</span></span></button>';
        }).join('') +
        (others.length > shown.length
          ? '<span class="b-menu-cap b-menu-more">and ' + commas(others.length - shown.length) + ' more</span>' : '') +
        '<button class="b-menu-item is-foot" type="button" role="menuitem" data-acc="' + esc(a.id) + '">' +
          'Open ' + esc(a.name) + '</button>' +
      '</div>' +
    '</span>';
  }

  function mgrMenu(conId, label) {
    /* WHICH MANAGER IS ONLY A QUESTION IF THERE ARE SEVERAL. With one desk
       on the other side the menu would open on a single row, which is a
       question with one answer — so the verb does the thing instead. */
    if (MANAGERS.length === 1) {
      return '<button class="b-ghost" type="button" ' +
        'data-handto="' + esc(conId + ':' + MANAGERS[0].id) + '">' + esc(label) + '</button>';
    }
    return '<span class="b-menu-wrap">' +
      /* THE SHAPE OF THE WAY OUT, WITHOUT ITS TONE. Handing somebody over
         is the other thing on this row that ends a caller's part in a lead,
         and it read as a text link beside four other verbs. It takes the
         ghost's shape — a bordered pill on no ground — and none of its
         colour, because handing over is a good outcome. */
      '<button class="b-ghost b-menu-open" type="button" data-pickopen="mgrMenu" ' +
        'aria-haspopup="menu">' + esc(label) + '</button>' +
      '<div class="b-menu" id="mgrMenu" role="menu" hidden>' +
        '<span class="b-menu-cap">Hand over to</span>' +
        MANAGERS.map((r) =>
          '<button class="b-menu-item" type="button" role="menuitem" ' +
          'data-handto="' + esc(conId + ':' + r.id) + '">' +
            faceOf(r.id, 24) + esc(r.name) +
          '</button>').join('') +
      '</div>' +
    '</span>';
  }
  /* Hide what does not match, without a repaint: a repaint takes the focus
     out of the box being typed in. */
  function pickFilter(box) {
    const host = box.closest('.b-menu');
    if (!host) return;
    const q = box.value.trim().toLowerCase();
    host.querySelectorAll('.b-menu-item').forEach((b) => {
      b.hidden = !!q && b.textContent.toLowerCase().indexOf(q) < 0;
    });
  }

  /* ══ ONTO A CAMPAIGN, ONE OR SEVERAL ═══════════════════════════════════
     A list belongs to the first campaign it is put on; its people join all
     of them. One toast, one undo, whatever was chosen. */
  function putOn(kind, id, campIds) {
    const ks = campIds.map((x) => DB.byCamp[x]).filter(Boolean);
    if (!ks.length) return;
    const l = kind === 'list' ? DB.byList[id] : null;
    const a = kind === 'acc' ? DB.byAcc[id] : null;
    if (kind === 'list' && !l) return;
    if (kind === 'acc' && !a) return;
    const people = kind === 'list' ? l.has.map((x) => DB.byCon[x]).filter(Boolean) : consAt(id);
    const before = l ? l.for : null;
    const touched = [];
    people.forEach((c) => {
      const add = ks.map((k) => k.id).filter((x) => c.camps.indexOf(x) < 0);
      if (!add.length) return;
      patchCon(c, { camps: c.camps.concat(add) });
      touched.push({ id: c.id, add: add });
    });
    const dl = l ? DELTA.list.filter((x) => x.id === id)[0] : null;
    if (l && !l.for) { l.for = ks[0].id; if (dl) dl.for = ks[0].id; }
    if (!touched.length) {
      toast('They are all on ' + listSay(ks.map((k) => k.name)) + ' already.');
      return;
    }
    reindex();
    save();
    paint();
    toast(plural(touched.length, 'person') + ' joined ' + listSay(ks.map((k) => k.name)), () => {
      touched.forEach((x) => {
        const c = DB.byCon[x.id];
        patchCon(c, { camps: c.camps.filter((y) => x.add.indexOf(y) < 0) });
      });
      if (l) { l.for = before; if (dl) dl.for = before; }
      reindex(); save(); paint();
    });
  }

  /* ══ THE HAND-OVER NAMES ITS MANAGER ═══════════════════════════════════
     Not "the director" as a role read off the campaign, but the person
     chosen at the moment of handing over. From then on the record says who
     is managing it, and the BDR has nothing left to press. */
  function handover(conId, mgrId) {
    const c = DB.byCon[conId];
    const m = REP[mgrId];
    if (!c || !m) return;
    const before = { checkpoint: c.checkpoint, checkpointAt: c.checkpointAt, next: c.next, manager: c.manager || null };
    const now = new Date().toISOString();
    const t = {
      id: 'h' + Date.now().toString(36) + Math.floor(Math.random() * 1000),
      con: c.id, camp: campFor(c), by: me().id, at: now, secs: 0,
      outcome: 'checkpoint', proposals: [], objections: [], openings: [],
      note: 'Handed to ' + m.name + '.',
      lines: [], next: null, moved: [c.checkpoint, 'handed-over'], rung: 'handed-over',
    };
    patchCon(c, { checkpoint: 'handed-over', checkpointAt: now, next: null, manager: m.id });
    addTouch(t);
    paint();
    toast(c.name.split(' ')[0] + ' → ' + m.name + ' is managing them now', () => {
      dropTouch(t.id);
      patchCon(c, before);
      paint();
    });
  }

  /* ══ OPENING A DOCUMENT ════════════════════════════════════════════════
     The corpus holds it; the canvas is where anything from the corpus is
     read. So the chip opens it there — what it is, when it goes out, and
     which campaign it belongs to. */
  function openDoc(campId, i) {
    const k = DB.byCamp[campId];
    const r = k && k.resources[Number(i)];
    if (!r) return;
    const kind = RES_KIND[r.kind] || { label: 'Document', is: '', use: '' };
    openCanvas();
    say('aimy', answerBlock(r.name,
      '<div class="s-brief-call">' +
        '<p class="s-callp"><b>What it is</b> ' + esc(kind.label) + ' — ' + esc(kind.is) + '</p>' +
        '<p class="s-callp"><b>When it goes out</b> ' + esc(kind.use) + '</p>' +
        '<p class="s-callp"><b>Belongs to</b> ' + esc(k.name) + '</p>' +
      '</div>', 'in the shared corpus'));
  }

  function backHere() {
    const cap = (t) => (t.length > 34 ? t.slice(0, 32).replace(/\s+\S*$/, '') + '…' : t);
    const a = S.con && S.acc && DB.byAcc[S.acc];
    if (a) return backBtn('data-back', 'Back to ' + cap(a.name));
    const k = S.camp && DB.byCamp[S.camp];
    if (k) return backBtn('data-back', 'Back to ' + cap(k.name));
    const l = S.list && DB.byList[S.list];
    if (l) return backBtn('data-back', 'Back to ' + cap(l.name));
    /* A deal opened from the board goes back to the board: `on` rides
       through the navigation, so the only thing missing was the word. */
    if (S.on === 'deals') return backBtn('data-back', 'Back to the board');
    return backBtn('data-back', 'Back to the briefing');
  }

  const backBtn = (attr, label) =>
    '<button class="s-back" type="button" ' + attr + '>' +
      '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" ' +
        'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
        '<path d="M15 18l-6-6 6-6"/></svg>' + esc(label) + '</button>';

  function switcher(here) {
    /* Every tab but one counts a set. Today is not a set — it is a moment —
       so it carries no figure rather than borrowing one that means something
       else two tabs along. */
    const one = (k, label, n, over) =>
      '<button class="b-switch-btn' + (here === k ? ' is-on' : '') + '" type="button" ' +
      'data-go="' + esc(JSON.stringify(over)) + '"' +
      (here === k ? ' aria-current="page"' : '') + '>' + esc(label) +
      (n === null ? '' :
        '<span class="b-switch-n" data-fig="sw:' + k + '">' + commas(n) + '</span>') + '</button>';
    return '<h2 class="b-switch">' +
      (isMgr()
        ? one('today', 'Today', null, cleared()) +
          one('deals', 'Deals', queue().length, Object.assign(cleared(), { on: 'deals' }))
        : one('calls', 'Calls', queue().length, cleared())) +
      one('camps', 'Campaigns', myCampaigns().length, Object.assign(cleared(), { on: 'camps' })) +
      one('lists', 'Lists', DB.list.length, Object.assign(cleared(), { on: 'lists' })) +
      '<span class="b-switch-bar" aria-hidden="true"></span>' +
    '</h2>';
  }

  function paintRail() {
    const r = railReading();
    const c = r.card;
    byId('appRail').innerHTML =
      '<div class="rail-read">' +
        '<div class="rail-scope">' +
          '<span class="rail-scope-cap">' + esc(r.eyebrow) + '</span>' +
          (r.subject ? '<span class="rail-scope-name">' + esc(r.subject) + '</span>' : '') +
        '</div>' +
        '<div class="bcard rail-card">' +
          '<div class="bcard-meta"><span class="type-label rail-state p2">' +
            esc(WS_LABEL[c.state] || 'Reading') + '</span></div>' +
          '<p class="bcard-conclusion rail-conclusion">' + c.text + '</p>' +
          (c.evidence && c.evidence.length
            ? '<div class="bcard-evidence rail-evidence">' + c.evidence.map((e) =>
                '<span class="evidence-pill"><span class="val">' + esc(String(e.val)) + '</span>' +
                esc(e.cap) + '</span>').join('') + '</div>'
            : '') +
          (c.act
            ? '<button class="s-insight-lnk rail-act" type="button"' +
              (c.q ? ' data-q="' + esc(c.q) + '"' : ' data-home') + '>' + esc(c.act) + '</button>'
            : '') +
        '</div>' +
      '</div>';
  }

  /* ══ THE PILL IS THE DOOR TO THE OTHER DESK ════════════════════════════
     The panel was drawn in the markup and wired to nothing: the button
     claimed aria-expanded="false" for ever, the list was never filled, and
     the role under the name was the string 'BDR' whoever you were. It is
     on the menus' own machinery now — one open at a time, Escape and an
     outside click come free — and the job is read off the person. */
  function paintWho() {
    const p = me();
    byId('userAvatar').innerHTML = faceOf(p.id, 28);
    byId('userName').textContent = p.name;
    byId('userRole').textContent = JOB[p.fn];
    byId('asPanel').innerHTML = '<span class="b-menu-cap">Looking as</span>' +
      /* A TICK IS FOR THINGS YOU CHOOSE SEVERAL OF. This is one desk at a
         time — you are either at it or you are not — so the row you are on
         is lit the way the switcher's current tab is lit, and nothing on it
         suggests you could be two people at once. */
      REPS.map((r) =>
        '<button class="b-menu-item' + (r.id === p.id ? ' is-on' : '') + '" type="button" ' +
        'role="menuitemradio" aria-checked="' + (r.id === p.id) + '" ' +
        'data-as="' + esc(r.id) + '">' +
          faceOf(r.id, 24) +
          '<span class="b-menu-line">' +
            '<span class="b-menu-name">' + esc(r.name) + '</span>' +
            '<span class="b-menu-sub">' + esc(JOB[r.fn]) + '</span>' +
          '</span>' +
        '</button>').join('');
  }

  /* ══ HOME — the two things a BDR opens this to see ══════════════════════
     People to call, and the campaigns they are on. The opener above them is
     the shell's own "Since your last visit" block; the ways to start are its
     own strip. Nothing else is on this page, because everything else was a
     different role's question. */
  /* ══ THE MANAGER'S TODAY IS NOT A QUEUE ════════════════════════════════
     A caller's home is the whole list because dialling down it IS the job.
     A manager's is not: he takes the warm calls that matter, walks into
     meetings, runs campaigns and builds lists, and a hundred-row queue with
     six cuts and a pager is the caller's morning wearing his name.

     So Today answers one question — what wants me today — with the handful
     that do, and the board one tab along holds the rest. */
  function mgrHome() {
    const all = queue(null, 'all');
    const live = all.filter(dealLive);
    /* Late, never warm-called, or owed something today. `dealRank` already
       ranks exactly this, so the block and the board cannot disagree. */
    const now = live.filter((c) => dealRank(c) <= 2);
    const rows = now.slice(0, 6);
    const more = now.length - rows.length;
    return '<div class="s-home">' +
      topBrief('today') +
      '<section class="s-block s-block-wide" aria-label="What wants you today">' +
        '<div class="s-camp-list-head">' + switcher('today') + '</div>' +
        (rows.length
          ? '<p class="b-tocall"><b>' + commas(now.length) + '</b> of your ' +
              commas(live.length) + ' deals want something today</p>' +
            qgrid(rows) +
            '<div class="b-acts b-acts-end">' +
              '<button class="s-inline-btn" type="button" data-start="deals">' +
                (more > 0
                  ? 'The other ' + commas(more) + ', and the rest of the board'
                  : 'Open the board') + '</button>' +
            '</div>'
          : '<p class="s-block-sub">Nothing is late and nothing is waiting on a first ' +
            'call. The board has the ' + plural(live.length, 'deal') + ' you are running.</p>') +
      '</section>' +
    '</div>';
  }

  function homePage() {
    if (isMgr()) return mgrHome();
    const q = queue();
    const all = queue(null, 'all');
    const camps = myCampaigns();
    const counts = Object.create(null);
    all.forEach((c) => { const b = cutOf(c); counts[b] = (counts[b] || 0) + 1; });
    counts.after = queue(null, 'after').length;

    return '<div class="s-home">' +
      topBrief('calls') +
      queueBlock(all, counts) +
    '</div>';
  }

  /* ══ WHAT THE BOARD ADDS UP TO, BEFORE THE BOARD ═══════════════════════
     A board is chronological by nature — six columns you read left to right
     — and a chronology with no takeaway above it makes the reader do the
     arithmetic. The figure is what is still open; the sentence is the thing
     about it worth knowing today. */
  function dealsTake() {
    const all = queue(null, 'all');
    const live = all.filter(dealLive);
    const sum = (xs) => xs.reduce((n, c) => n + amountOf(c), 0);
    const comm = live.filter((c) => stageOf(c) === 'commercial');
    const cold = live.filter((c) => stageOf(c) === 'qual');
    const late = live.filter((c) => daysBetween(TODAY_ISO, closeBy(c)) < 0);
    const bits = [];
    if (comm.length) {
      /* No comma inside a clause: the join turns the last comma into 'and',
         and a clause carrying its own comma steals it. */
      bits.push('<b>' + esc(euro(sum(comm))) + '</b> of it sits in ' +
        plural(comm.length, 'commercial deal') + ' with the price already on the table');
    }
    if (late.length) {
      bits.push('<b>' + commas(late.length) + '</b> ' + (late.length === 1 ? 'is' : 'are') +
        ' past the date they should have landed');
    }
    if (cold.length) {
      bits.push('<b>' + commas(cold.length) + '</b> ' + (cold.length === 1 ? 'has' : 'have') +
        ' been handed to you and never warm-called');
    }
    const door = (label, q) => '<button class="s-insight-lnk" type="button" data-go="' +
      esc(JSON.stringify(Object.assign(cleared(), { q: q }))) + '">' + esc(label) + '</button>';
    return '<section class="s-insight is-lead s-block-wide" aria-label="Where the book stands">' +
      '<div class="s-lead-mark">' +
        '<svg class="s-insight-mark" viewBox="0 0 18 20" width="14" height="14" aria-hidden="true">' +
          '<use href="#aimy-logo-small"/></svg>' +
        '<span class="work-state ws-detected" data-work-state="detected">Read off the record</span>' +
      '</div>' +
      '<div class="s-lead-line">' +
        '<span class="s-lead-n">' + esc(euro(sum(live))) + '</span>' +
        '<span class="s-lead-say">still open, across <span class="s-lead-of">' +
          commas(live.length) + '</span> deals you are running.</span>' +
      '</div>' +
      '<p class="s-lead-deck">' +
        (bits.length ? bits.join(', ').replace(/, ([^,]*)$/, ' and $1') + '.'
          : 'Nothing is late and nothing is waiting on a first call.') + '</p>' +
      '<div class="s-lead-acts">' +
        (cold.length ? door('Show the ' + commas(cold.length) + ' never called', 'qual') : '') +
        (comm.length ? door('Show the ' + commas(comm.length) + ' in commercial', 'commercial') : '') +
      '</div>' +
    '</section>';
  }

  /* ══ SIX COLUMNS, THREE FACTS A CARD ═══════════════════════════════════
     What a manager scans a board for is where the money is and what is
     stuck, so a card carries the name, one line of why it is where it is,
     and what it is worth — and nothing else. Eight labelled fields a card
     is a spreadsheet somebody drew borders on.

     The columns scroll inside their own container and each list scrolls
     inside itself, so the page never moves sideways and the headings — the
     count and the sum, which is what the column is for — stay put. */
  function dealCard(c, i) {
    const a = accOf(c);
    return '<button class="b-dealcard" type="button" data-con="' + esc(c.id) + '" ' +
      'style="--i:' + Math.min(i, 8) + '">' +
      '<span class="b-dc-name">' + esc(c.name) + '</span>' +
      '<span class="b-dc-co">' + esc(a ? a.name : 'No company') + '</span>' +
      '<span class="b-dc-why">' + dealWhy(c) + '</span>' +
      '<span class="b-dc-amt">' + esc(euro(amountOf(c))) + '</span>' +
    '</button>';
  }

  function dealsPage() {
    const all = queue(null, 'all').filter((c) => matches(conHay(c)));
    const by = Object.create(null);
    DEAL_STAGES.forEach((st) => (by[st.k] = []));
    all.forEach((c) => by[stageOf(c)].push(c));
    /* No briefing strip here. Today is a surface of its own one tab along,
       and repeating its heading and its four verbs above a board is the
       page telling you twice where you are. The takeaway is the head. */
    return '<div class="s-home">' +
      dealsTake() +
      '<section class="s-block s-block-wide" aria-label="The board">' +
        '<div class="s-camp-list-head">' + switcher('deals') +
          findBox('Find a name, a company, a campaign') + '</div>' +
        '<div class="b-board">' +
          DEAL_STAGES.map((st) => {
            const rows = by[st.k];
            const sum = rows.reduce((n, c) => n + amountOf(c), 0);
            const end = st.k === 'won' || st.k === 'lost';
            return '<div class="' + (end ? 'b-col is-end' : 'b-col') + '">' +
              '<div class="b-col-head">' +
                '<span class="b-col-cap">' + esc(st.label) +
                  '<span class="b-col-n">' + commas(rows.length) + '</span></span>' +
                '<span class="b-col-sum">' + esc(euro(sum)) + '</span>' +
              '</div>' +
              (rows.length
                ? '<div class="b-col-list">' + rows.map(dealCard).join('') + '</div>'
                : '<p class="b-col-none">Nothing here</p>') +
            '</div>';
          }).join('') +
        '</div>' +
      '</section>' +
    '</div>';
  }

  /* ══ THE CAMPAIGNS YOU ARE ON ═══════════════════════════════════════════
     Its own surface, not a block under a thousand people. Paged like every
     other worklist, because fourteen today is forty next quarter. */
  function campsPage() {
    /* "soonest to close first", which the caption promised and the list
       did not do; closed ones last */
    const camps = myCampaigns().filter((k) => matches(campHay(k)))
      .sort((a, b) => (campOpen(b) - campOpen(a)) || (a.to < b.to ? -1 : 1));
    const pg = paged(camps);
    return '<div class="s-home">' +
      topBrief('camps') +
      '<section class="s-block s-block-wide" aria-label="Campaigns">' +
        '<div class="s-camp-list-head">' + switcher('camps') +
          findBox('Find a campaign, a goal, a product') + '</div>' +
        /* The count is on the switcher, the order is visible in the order,
           and what each card says is said by the card. */
        (S.find ? '<p class="s-block-sub">' + plural(camps.length, 'campaign') +
          ' matching “' + esc(S.find) + '”.</p>' : '') +
        cgrid(pg.rows) +
        pager(pg, 'campaign') +
      '</section>' +
    '</div>';
  }

  /* ══ THE BRIEFING FOLLOWS YOU ═══════════════════════════════════════════
     It sat on the calls surface only, so switching to Campaigns or Lists
     dropped the one block that says what today is and what to start. It
     renders above all three now, and what it SAYS changes with where you
     are — a paragraph about the call queue standing over a page of lists is
     a paragraph about somewhere else.

     The strip always carries a starting gate. A BDR whose queue is empty has
     nothing to do on this product unless something offers to go and find
     more, and "Find leads" is that door on every surface. */
  function topBrief(here) {
    const all = queue(null, 'all');
    const counts = Object.create(null);
    all.forEach((c) => { const b = cutOf(c); counts[b] = (counts[b] || 0) + 1; });
    counts.after = queue(null, 'after').length;
    const camps = myCampaigns();
    return '<section class="slv s-block-wide" aria-label="Today">' +
      '<div class="slv-head">' +
        '<svg viewBox="0 0 18 20" aria-hidden="true"><use href="#aimy-logo-small"/></svg>' +
        '<h1 class="slv-title">Today</h1>' +
        '<span class="slv-time">' + esc(sayDay(TODAY_ISO)) + '</span>' +
      '</div>' +
      '<div class="slv-body"><p class="slv-line">' +
        briefSentence(here, counts, all, camps) + '</p></div>' +
      '<div class="s-starts-wrap">' +
        '<span class="s-starts-cap">Start</span>' +
        startStrip(here, counts, all, camps) +
      '</div>' +
    '</section>';
  }

  /* What today is, on this surface, in one paragraph with the numbers in it.
     Only conditions that hold are named — a sentence listing three things
     that are all zero has to be read to learn nothing. */
  /* How long a campaign has. A window that has already shut is not "in 0
     days" — that is an arithmetic clamp wearing a sentence. */
  function closesIn(k) {
    const d = daysBetween(TODAY_ISO, k.to);
    return d > 0 ? 'closes first, in ' + plural(d, 'day') : 'closed ' + sayWhen(k.to);
  }

  /* On lists with no campaign: how many people are on none of yours. */
  function looseOff(loose) {
    let n = 0, total = 0;
    loose.forEach((l) => l.has.forEach((id) => {
      const c = DB.byCon[id];
      if (!c) return;
      total++;
      if (!campsOf(c).some(mine)) n++;
    }));
    return { n: n, all: n === total };
  }

  function briefSentence(here, counts, all, camps) {
    if (here === 'camps') {
      const busiest = camps.slice().sort((a, b) => queue(b.id).length - queue(a.id).length)[0];
      const soonest = camps.slice().sort((a, b) => (a.to < b.to ? -1 : 1))[0];
      if (!camps.length) return 'You are on no campaign, so there is nobody to ring.';
      return plural(camps.length, 'campaign') + ' are yours. <b>' + esc(busiest.name) +
        '</b> has the most left to ring at <b>' + commas(queue(busiest.id).length) + '</b>, and <b>' +
        esc(soonest.name) + '</b> ' + closesIn(soonest) + '.';
    }
    if (here === 'lists') {
      if (!DB.list.length) {
        return 'You have built no lists. A list is how anybody new reaches your queue — ' +
          'describe who to look for and what comes back is the list.';
      }
      const people = DB.list.reduce((n, l) => n + l.has.length, 0);
      const loose = DB.list.filter((l) => !l.for);
      const parked = loose.length;
      /* the people on a loose list who are on none of your campaigns — some
         of them are in your queue through another campaign, and the list's
         own page says so */
      const off = looseOff(loose);
      return plural(DB.list.length, 'list') + ' holding <b>' + commas(people) + '</b> people' +
        (parked ? ', and <b>' + plural(parked, 'of them is', 'of them are') +
          '</b> on no campaign, so ' + (off.all ? 'nobody on ' + (parked === 1 ? 'it' : 'them') + ' is in your queue'
            : '<b>' + commas(off.n) + '</b> of their people are not in your queue') : ', all of them on a campaign') + '.';
    }
    if (isMgr()) {
      return all.length
        ? '<b>' + plural(all.length, 'lead') + '</b> ' + (all.length === 1 ? 'has' : 'have') +
          ' been handed to you, across <b>' + plural(camps.length, 'campaign') + '</b> you own.'
        : 'Nothing has been handed to you yet.';
    }
    return openerText(counts, all, camps);
  }

  function openerText(counts, all, camps) {
    const bits = [];
    if (counts.callback) bits.push('<b>' + plural(counts.callback, 'person') +
      '</b> asked to be rung back');
    if (counts['not-called']) bits.push('<b>' + commas(counts['not-called']) +
      '</b> have never been rung');
    if (counts['no-answer']) bits.push('<b>' + commas(counts['no-answer']) +
      '</b> did not pick up last time');
    if (counts.after) bits.push('<b>' + plural(counts.after, 'meeting') + '</b> ' +
      (counts.after === 1 ? 'has' : 'have') + ' passed without a word on whether they turned up');
    if (!bits.length) bits.push('there is nobody left to ring');
    const decided = decidedLately();
    return 'You are on ' + plural(camps.length, 'campaign') + ' and <b>' + commas(all.length) +
      '</b> people on them can be rung. ' +
      bits.join(', ').replace(/, ([^,]*)$/, ' and $1') + '.' +
      (decided ? ' ' + decided : '');
  }

  /* ══ THE LOOP CLOSES WHERE THE FLOWCHART CLOSES ═══════════════════════
     A decision landed this week on somebody handed over from one of your
     campaigns. It is the one thing past the hand-over the BDR wants told. */
  function decidedHits() {
    const hits = [];
    DB.touch.forEach((t) => {
      if (t.outcome !== 'phase' || !t.decision) return;
      if (daysBetween(t.at.slice(0, 10), TODAY_ISO) > 7) return;
      const c = DB.byCon[t.con];
      if (!c || !campsOf(c).some(mine)) return;
      hits.push({ c: c, t: t });
    });
    return hits.sort((a, b) => (a.t.at < b.t.at ? 1 : -1));
  }
  function decidedLately() {
    const hits = decidedHits();
    if (!hits.length) return '';
    const h = hits[0];
    const more = hits.length - 1;
    return '<b>' + esc(h.c.name) + '</b>, handed over ' + esc(sayWhen(h.c.checkpointAt.slice(0, 10))) + ', ' +
      (h.t.decision === 'won' ? 'signed' : 'said no at resolution') + ' ' + esc(sayWhen(h.t.at.slice(0, 10))) +
      (more ? ', and ' + plural(more, 'other') + ' got a decision this week' : '') + '.';
  }

  /* Four ways to start, each with the reason it is worth pressing. The V3
     build's strip, with a BDR's four acts in it. */
  function startStrip(here, counts, all, camps) {
    /* THE GATE IS ON EVERY SURFACE. A caller whose queue is empty has nothing
       to do on this product unless something offers to go and find more, so
       the door that starts the finding is on all three rather than buried on
       the one page that already has lists on it. */
    const findLeads = { k: 'find', label: 'Find leads',
      why: DB.list.length ? 'describe who to look for; what comes back is a list'
        : 'the way anybody new reaches your queue' };

    let opens;
    if (isMgr()) {
      /* Four verbs, and every one of them is something this desk actually
         does: the phone for a warm call, the brief before a meeting, the
         board for where the money is, and the builder — a manager sources
         his own leads as well as taking the ones handed up. */
      const top = all[0];
      opens = [
        { k: 'callnext', label: 'Warm-call the next one',
          why: top ? esc(top.name) + ' is top of your deals' : 'nothing is waiting on a call' },
        { k: 'prep', label: 'Prepare me',
          why: top ? 'the brief on ' + esc(top.name) + ' before you dial'
            : 'nothing to prepare for yet' },
        { k: 'deals', label: 'Open the board',
          why: plural(all.filter(dealLive).length, 'deal') + ' still open' },
        findLeads,
      ];
    } else if (here === 'camps') {
      const busiest = camps.slice().sort((a, b) => queue(b.id).length - queue(a.id).length)[0];
      /* a door says "Work X", so X has to be open; the sentence above may
         still name the one that is past its date */
      const soonest = camps.filter((k) => k.to >= TODAY_ISO).sort((a, b) => (a.to < b.to ? -1 : 1))[0];
      opens = [
        busiest ? { k: 'camp:' + busiest.id, label: 'Work ' + busiest.name,
          why: plural(queue(busiest.id).length, 'person') + ' left to ring on it' } : null,
        soonest && soonest.id !== (busiest && busiest.id)
          ? { k: 'camp:' + soonest.id, label: 'Work ' + soonest.name, why: closesIn(soonest) }
          : null,
        { k: 'callnext', label: 'Call the next one',
          why: all.length ? esc(all[0].name) + ' is top of the queue' : 'nobody is callable right now' },
        findLeads,
      ].filter(Boolean);
    } else if (here === 'lists') {
      const parked = DB.list.filter((l) => !l.for)[0];
      opens = [
        findLeads,
        parked ? { k: 'list:' + parked.id, label: 'Put a list to work',
          why: esc(parked.name) + ' is on no campaign yet' } : null,
        { k: 'callnext', label: 'Call the next one',
          why: all.length ? esc(all[0].name) + ' is top of the queue' : 'nobody is callable right now' },
        { k: 'camps', label: 'Pick a campaign',
          why: plural(camps.length, 'campaign') + ' are yours to work' },
      ].filter(Boolean);
    } else {
      opens = [
        { k: 'callnext', label: 'Call the next one',
          why: all.length ? esc(all[0].name) + ' is top of the queue' : 'nobody is callable right now' },
        { k: 'callback', label: 'Work the callbacks',
          why: counts.callback ? plural(counts.callback, 'person') + ' asked to be rung back'
            : 'nobody asked for one' },
        /* A meeting that passed outranks a stranger: the door to say what
           happened takes the third slot while there is anything to say. */
        counts.after
          ? { k: 'after', label: 'Say what happened',
              why: plural(counts.after, 'meeting') + ' passed without a word' }
          : { k: 'not-called', label: 'Ring somebody new',
              why: counts['not-called'] ? commas(counts['not-called']) + ' have never been rung'
                : 'everyone has been tried' },
        findLeads,
      ];
    }
    return '<div class="s-starts" role="group" aria-label="Ways to start">' +
      opens.map((o) => '<button class="s-start" type="button" data-start="' + esc(o.k) + '">' +
        '<span class="s-start-label">' + esc(o.label) + '</span>' +
        '<span class="s-start-why">' + o.why + '</span>' +
      '</button>').join('') + '</div>';
  }

  /* The queue, cut by state. The cuts are always visible and their counts sum
     to All, so the row of chips is also the shape of the day. */
  function cuts(counts, all, ring) {
    const on = S.q || 'all';
    const chip = (k, label, n) =>
      '<button class="filter-chip' + (on === k ? ' active' : '') + '" type="button" data-q="' +
      esc(k) + '">' + esc(label) + '<span class="b-cut-n" data-fig="cut:' + esc(k) + '">' + commas(n) + '</span></button>';
    /* The run sits at the end of the row it acts on: these cuts, this page.
       It had a row of its own above them, which read as a second heading. */
    return '<div class="b-cuts b-cuts-row">' + chip('all', 'All', all.length) +
      (isMgr() ? MGR_BUCKETS : BUCKETS).map((b) => chip(b.k, b.label, counts[b.k] || 0)).join('') +
      ((ring && ring.length)
        ? '<button class="s-inline-btn b-cuts-go" type="button" data-callall="' +
          esc(ring.map((c) => c.id).join(',')) + '">Call these ' + ring.length + '</button>'
        : '') + '</div>';
  }

  /* ══ A PAGE OF THE QUEUE, NOT THE QUEUE ════════════════════════════════
     The book holds a thousand callable people and a campaign holds thousands
     more. Handing that to a scrollbar is not scale, it is an endless list: a
     caller cannot tell where they are in it, cannot come back to the same
     place, and gets no sense of having finished anything.

     So the queue is worked a PAGE at a time. Fifteen is a screenful — you
     see the whole of what is in front of you without scrolling, ring through
     it, and press once for the next fifteen. The total is stated on every
     page, so bounding what is drawn never hides how much there is.

     The windowing underneath stays, and is not redundant: it is what lets a
     campaign's roster or a heavy account's call history render at all. Here
     it simply has fifteen rows to draw. */
  const PAGE = 15;
  const pageAt = () => Math.max(0, parseInt(S.p, 10) || 0);

  /* ══ ONE PAGER PER SURFACE, AND ONE WORKLIST UNDER IT ═══════════════════
     Every surface leads with exactly one list you WORK, and that list is
     paged. Everything else on the surface is CONTEXT — what has happened on
     this campaign, what was said to this person, what a search would return
     — and context is capped and says how much it is showing of what.

     The distinction is not cosmetic. Two pagers on one page share a page
     number or need two, and both are worse than deciding which of the two
     lists is the reason you came. */
  function paged(items) {
    const total = items.length;
    const pages = Math.max(1, Math.ceil(total / PAGE));
    const p = Math.min(pageAt(), pages - 1);
    const from = p * PAGE;
    const to = Math.min(total, from + PAGE);
    return { rows: items.slice(from, to), from: from, to: to, total: total, p: p, pages: pages };
  }

  /* A capped view of context. Never a scrollbar into a thousand rows: the
     last few, and the count of what it is the last few of. */
  const PEEK = 8;
  function peek(items) {
    return { rows: items.slice(0, PEEK), total: items.length };
  }
  /* `end` is which end you are looking at. A feed is newest-first, so eight
     rows of it are the LAST eight things that happened; a search preview is
     unordered, so eight rows of it are simply the first eight. Calling both
     "the last 8" would be wrong about one of them every time. */
  function peekFoot(pg, one, many, end) {
    if (!pg.total) return '';
    if (pg.total <= PEEK) return '<p class="b-vfoot">' + plural(pg.total, one, many) + '.</p>';
    return '<p class="b-vfoot">The ' + (end || 'last') + ' ' + PEEK + ' of ' +
      plural(pg.total, one, many) + '.</p>';
  }

  function queueBlock(all, counts) {
    /* Narrowed BEFORE paging, so the foot line counts what matched rather
       than what page fifteen of the unsearched list happens to hold. */
    const pg = paged(queue(S.camp || null, S.q).filter((c) => matches(conHay(c))));
    const ring = pg.rows.filter((c) => callable(c) && rowVerb(c) === 'Call');
    return '<section class="s-block s-block-wide" aria-label="To call">' +
      /* ══ TWO ROWS, AND THE SEARCH BOX IS IN THE STABLE ONE ═════════════
         The box sat in the same flex row as `Call these 15` and `Let AiMY
         call 15`, and those two are drawn from what the search matched —
         so typing emptied them, the row reflowed, and the box slid sideways
         under the cursor mid-word. A control that moves while you are using
         it is the one thing a search field must never do.

         So the title row holds only what cannot change while you type: the
         switcher, whose counts are of the whole book, and the box. The run
         actions go underneath, where appearing and disappearing costs
         nothing above them. */
      '<div class="s-camp-list-head">' +
        (S.camp
          ? '<h2 class="s-block-h">' + (S.q === 'after' ? 'After the meeting'
            : isMgr() ? 'The deals on it' : 'To call') + '</h2>'
          : switcher(isMgr() ? 'today' : 'calls')) +
        /* On a campaign too. Two hundred and twenty-eight people across
           sixteen pages is the same problem the queue has, and the filter
           below already narrows whatever set it is handed. */
        findBox(S.camp ? 'Find someone on this campaign' : 'Find a name, a company, a campaign') +
      '</div>' +
      /* THE NUMBER SITS UNDER THE HEADING IT COUNTS. It was at the far end
         of the heading's row, which is where a section's actions live —
         so the one figure the chips add up to read as a control. */
      (S.camp
        ? '<p class="b-tocall">' + (isMgr()
            ? '<b>' + commas(all.length) + '</b> handed to you on this campaign'
            : S.q === 'after'
              ? '<b>' + commas(counts.after || 0) + '</b> meetings passed without a word'
              : '<b>' + commas(all.length) + '</b> you can ring now') + '</p>'
        : '') +
      cuts(counts, all, ring) +
      qgrid(pg.rows) +
      pager(pg, 'person') +
    '</section>';
  }
  /* Where you are, and the two ways to move. Never "load more": a caller
     needs to be able to go back to the fifteen they were just on. */
  function pager(pg, one, many) {
    const noun = one || 'row';
    if (!pg.total) return '';
    if (pg.pages === 1) {
      return '<p class="b-vfoot">' + plural(pg.total, noun, many) + ', all shown.</p>';
    }
    return '<div class="b-pager">' +
      '<span class="b-vfoot">' + commas(pg.from + 1) + '–' + commas(pg.to) + ' of ' +
        commas(pg.total) + ' ' + verbFor(pg.total, noun) + ' · page ' + (pg.p + 1) +
        ' of ' + commas(pg.pages) + '</span>' +
      '<span class="b-pager-go">' +
        (pg.p > 0 ? '<button class="s-inline-btn" type="button" data-page="' + (pg.p - 1) +
          '">Back ' + PAGE + '</button>' : '') +
        (pg.p < pg.pages - 1 ? '<button class="s-inline-btn" type="button" data-page="' +
          (pg.p + 1) + '">Next ' + Math.min(PAGE, pg.total - pg.to) + '</button>' : '') +
      '</span>' +
    '</div>';
  }


  /* ══ BUILDING A LIST ════════════════════════════════════════════════════
     The BDR's other job. You describe who to look for, the sources answer,
     and what comes back IS the list — there is no separate "run" step and no
     wizard, because describing and finding are one act.

     TWO PRESSES TO A LIST. Chips narrow it, Save writes it. A third press
     puts it on a campaign, which is what makes its people appear in the
     queue. Every chip is always visible and toggling one is the whole of the
     interaction; nothing opens, nothing has to be dismissed. */

  /* ══ WHERE THE NUMBERS COME FROM ═══════════════════════════════════════
     Three suppliers, and one of them is down — which is the normal state of
     three third-party APIs and something the page could not say. `down` is a
     fixture here; in a real build it is whatever the last call to them
     returned. */
  const FINDERS = [
    { k: 'apollo', name: 'Apollo', phone: 0.74, email: 0.86, down: false },
    { k: 'zoom', name: 'ZoomInfo', phone: 0.58, email: 0.79, down: false },
    { k: 'serper', name: 'Exa / Serper', phone: 0.41, email: 0.62, down: true },
  ];
  const finderUp = () => FINDERS.filter((x) => !x.down);
  /* ══ WHICH SUPPLIER IS ASKED IS NOT AN ADDRESS ═════════════════════════
     It was kept in `bk`, the same URL key that holds whether you are
     building companies or people. Pressing "Ask ZoomInfo" wrote bk=zoom, and
     the kind survived only because a draft happened to be in memory — reload
     that URL and the builder was collecting neither companies nor people.
     A supplier preference for one run is not where a page is. */
  let FINDER = 'apollo';

  const BUILD_AXES = [
    { k: 'industry', label: 'Industry', of: (n) => n.industry,
      opts: () => INDUSTRIES.map((i) => [i.k, i.label]) },
    { k: 'size', label: 'Headcount', of: (n) => sizeBand(n.size),
      opts: () => SIZE_BANDS.map((b) => [b.k, b.label]) },
    { k: 'where', label: 'Where', of: (n) => n.country,
      opts: () => COUNTRY_OPTS },
    { k: 'title', label: 'Job title', of: (n) => titleBand(n.title),
      opts: () => TITLE_BANDS.map((b) => [b.k, b.label]) },
  ];

  const SIZE_BANDS = [
    { k: 'small', label: 'Under 200', lo: 0, hi: 199 },
    { k: 'mid', label: '200 to 1,000', lo: 200, hi: 1000 },
    { k: 'large', label: '1,000 to 5,000', lo: 1001, hi: 5000 },
    { k: 'huge', label: 'Over 5,000', lo: 5001, hi: 1e9 },
  ];
  const sizeBand = (n) => (SIZE_BANDS.filter((b) => n >= b.lo && n <= b.hi)[0] || SIZE_BANDS[0]).k;

  const TITLE_BANDS = [
    { k: 'support', label: 'Support & service', re: /support|service|care|contact centre/i },
    { k: 'quality', label: 'Quality', re: /quality|qa/i },
    { k: 'tech', label: 'Technology', re: /technolog|engineering|cto|cio|it director|digital/i },
    { k: 'ops', label: 'Operations', re: /operations|coo|shared services|back office/i },
  ];
  const titleBand = (t) => (TITLE_BANDS.filter((b) => b.re.test(t))[0] || { k: 'other' }).k;

  const COUNTRY_OPTS = [['NL', 'Netherlands'], ['BE', 'Belgium'], ['DE', 'Germany'],
    ['FR', 'France'], ['IE', 'Ireland'], ['SE', 'Sweden'], ['DK', 'Denmark'],
    ['ES', 'Spain'], ['IT', 'Italy']];

  /* The criteria, out of the URL. `bt` is a comma list of `axis:value`, so a
     half-described search is a link somebody can send. */
  function terms() {
    const out = Object.create(null);
    String(S.bt || '').split(',').filter(Boolean).forEach((p) => {
      const at = p.indexOf(':');
      if (at < 0) return;
      const a = p.slice(0, at), v = p.slice(at + 1);
      (out[a] || (out[a] = [])).push(v);
    });
    return out;
  }
  function toggleTerm(axis, val) {
    const t = terms();
    const has = (t[axis] || []).indexOf(val) >= 0;
    t[axis] = has ? (t[axis] || []).filter((x) => x !== val) : (t[axis] || []).concat([val]);
    const flat = [];
    Object.keys(t).forEach((a) => t[a].forEach((v) => flat.push(a + ':' + v)));
    go({ bt: flat.join(','), on: 'lists', build: 'describe' });
  }

  /* What the search returns. An axis with nothing ticked does not narrow —
     an empty filter that excluded everything would make the first press of
     any chip look like it found something. */
  function buildMatched(over) {
    const t = over || terms();
    const only = (t.only || []).indexOf('new') >= 0;
    /* THE ONE NARROWING A CALLER ACTUALLY WANTS. Every other axis makes the
       set smaller; this one makes it callable, which is the only property
       that decides whether a row is worth having at all. */
    const onlyPhone = (t.only || []).indexOf('phone') >= 0;
    const fill = finderOf().phone;
    return DB.net.filter((n) => {
      if (only && n.known) return false;
      if (onlyPhone && n.seedPhone >= fill) return false;
      for (let i = 0; i < BUILD_AXES.length; i++) {
        const ax = BUILD_AXES[i];
        const want = t[ax.k];
        if (want && want.length && want.indexOf(ax.of(n)) < 0) return false;
      }
      return true;
    });
  }
  /* How many a chip would leave, if it were the only change. Counts on the
     chips are what makes narrowing legible before you press. */
  function countWith(axis, val) {
    const t = terms();
    const cur = t[axis] || [];
    t[axis] = cur.indexOf(val) >= 0 ? cur.filter((x) => x !== val) : cur.concat([val]);
    return buildMatched(t).length;
  }

  /* The one being asked, and never one that is not answering. */
  const finderOf = () => {
    const up = finderUp();
    const pick = up.filter((f) => f.k === FINDER)[0];
    return pick || up.sort((a, b) => b.phone - a.phone)[0] || FINDERS[0];
  };

  function listsPage() {
    if (S.build) return buildPage();
    const open = S.list ? DB.byList[S.list] : null;
    if (open) return listPage(open);
    const found = DB.list.slice().reverse().filter((l) => matches(listHay(l)));
    return '<div class="s-home">' +
      topBrief('lists') +
      '<section class="s-block s-block-wide" aria-label="Lists">' +
        '<div class="s-camp-list-head">' + switcher('lists') +
          findBox('Find a list, a criterion, a source') + '</div>' +
        /* The one action on this surface, at the end of the row the actions
           are at the end of everywhere else. */
        '<div class="b-acts b-acts-end">' +
          '<button class="s-inline-btn" type="button" data-bopen>Find leads</button>' +
        '</div>' +
        (found.length
          ? lgrid(paged(found).rows) + pager(paged(found), 'list')
          : '<p class="b-vfoot">' + (S.find
            ? 'No list matches “' + esc(S.find) + '”.'
            : 'You have not built one yet. A list is how new people reach your queue: ' +
              'describe who to look for, and putting what comes back on a campaign puts ' +
              'them in front of you. ' +
              '<button class="s-inline-btn" type="button" data-bopen>Find leads</button>') +
            '</p>') +
      '</section>' +
    '</div>';
  }


  /* ══ ONE LIST, AS A JOURNEY ═════════════════════════════════════════════
     You open a list to decide one thing: is it on a campaign yet, and if it
     is, who on it is left to ring. The page answered with the name in the
     caption gutter, the criteria and the counts in one grey sentence, and
     no Call action at all — a list of forty-six people, thirty-two of them
     ringable, and nowhere to press.

     Now: the masthead with the one chip that matters beside the name, what
     AiMY makes of the list with a door, the action row decided by state,
     the people never-rung first, where they all stand, and what has been
     said to them. */
  function listPage(l) {
    const camp = l.for && DB.byCamp[l.for];
    /* NEVER-RUNG FIRST. A list exists to bring new people in; the ones
       nobody has tried lead, the rest follow up the ladder, exits last. */
    const order = (c) => (isExit(c.checkpoint) ? 99 : rank(c.checkpoint));
    const people = l.has.map((id) => DB.byCon[id]).filter(Boolean)
      .sort((x, y) => (order(x) - order(y)) || qTie(x, y));
    const ring = people.filter(callable);
    const hist = [];
    people.forEach((c) => (DB.touchesOf[c.id] || []).forEach((id) => { if (TOUCH[id]) hist.push(TOUCH[id]); }));
    hist.sort((a, b) => (a.at > b.at ? -1 : 1));
    const chip = camp
      ? { label: 'On ' + camp.name, tone: 'ok' }
      : { label: 'Not on a campaign yet', tone: 'warn' };
    const first = ring[0];
    const callFirst = first
      ? '<button class="s-inline-btn" type="button" data-call="' + esc(first.id) + '">Call ' +
        esc(first.name.split(' ')[0]) + '</button>'
      : '';

    /* [2] ONE ROW, DECIDED BY STATE. Off a campaign the list has one job —
       getting onto one — so the chips are the row. On one, the phone. */
    const actions = camp
      ? (first
          ? '<button class="s-insight-lnk primary" type="button" data-call="' + esc(first.id) +
              '">Call the next one on this list</button>' +
            (ring.length > 1
              ? '<button class="s-inline-btn" type="button" data-callall="' +
                esc(ring.slice(0, PAGE).map((c) => c.id).join(',')) + '">Call these ' +
                Math.min(PAGE, ring.length) + '</button>'
              : '')
          : '<span class="s-block-sub">Nobody on it has a number you can ring now.</span>') +
        '<button class="s-inline-btn" type="button" data-camp="' + esc(camp.id) + '">' +
          'Open ' + esc(camp.name) + '</button>'
      : campMenu({ id: 'listCampPick', opts: campOpts(), cls: 's-insight-lnk primary',
          label: 'Put it on a campaign', cap: 'Put it on', go: 'list:' + l.id });

    return '<div class="s-home">' +
      backBtn('data-go="' + esc(JSON.stringify(Object.assign(cleared(), { on: 'lists' }))) + '"', 'Back to lists') +

      '<section class="s-rec-head s-block-wide">' +
        '<span class="s-rec-kind">List · ' + esc(plural(people.length, 'person')) + ' · found by ' +
          esc(l.via) + ' · ' + esc(sayWhen(l.at)) + '</span>' +
        '<div class="s-rec-title">' +
          '<h1 class="s-rec-name">' + esc(l.name) + '</h1>' +
          '<span class="s-meta-st tone-' + esc(chip.tone) + '">' + esc(chip.label) + '</span>' +
        '</div>' +
        '<div class="s-rec-facts">' +
          '<div><span>' + esc(l.crit) + '</span></div>' +
          /* [4] HOW MANY OF IT EACH CAMPAIGN HOLDS — V3's fact — and [2] the
             gap, with its door. */
          '<div>' +
            '<span>' + (ring.length
              ? '<b>' + commas(ring.length) + '</b> ringable'
              : 'nobody ringable') + '</span>' +
            (function () {
              const by = Object.create(null);
              let none = 0;
              people.forEach((c) => {
                const ks = campsOf(c).filter(mine);
                if (!ks.length) { none++; return; }
                ks.forEach((k) => (by[k.id] = (by[k.id] || 0) + 1));
              });
              const tops = Object.keys(by).sort((x, y) => by[y] - by[x]).slice(0, 2);
              /* two named, and the rest counted, so the facts add up to the lead */
              const others = Object.keys(by).length - tops.length;
              const onOthers = others ? people.filter((c) => {
                const ks = campsOf(c).filter(mine);
                return ks.length && !ks.some((k) => tops.indexOf(k.id) >= 0);
              }).length : 0;
              return tops.map((kid) => '<span><b>' + commas(by[kid]) + '</b> on ' +
                '<button class="s-inline-btn" type="button" data-camp="' + esc(kid) + '">' +
                esc(DB.byCamp[kid].name) + '</button></span>').join('') +
                (onOthers ? '<span><b>' + commas(onOthers) + '</b> on ' + (others === 1 ? 'one other' : 'other campaigns') + '</span>' : '') +
                (none ? '<span><b>' + commas(none) + '</b> on none</span>' : '');
            })() +
            (function () {
              const gap = listGap(l);
              if (!gap) return '';
              return '<span><b>' + commas(gap) + '</b> more matched its criteria · ' +
                '<button class="s-inline-btn" type="button" data-go="' +
                esc(JSON.stringify(Object.assign(cleared(), { on: 'lists', build: 'describe', bk: l.kind, bt: l.terms }))) +
                '">Bring them in</button></span>';
            })() +
          '</div>' +
        '</div>' +
        '<div class="s-rec-actions">' + actions + '</div>' +
      '</section>' +

      listLead(l, people, ring, camp) +

      '<section class="s-block s-block-wide" aria-label="Who is on it">' +
        '<div class="s-camp-list-head"><h2 class="s-block-h">Who is on it</h2>' +
          '<span class="s-block-say">' + esc(plural(people.length, 'person')) +
          ' · never rung first, then by rung</span></div>' +
        rosterBlock(paged(people).rows) +
        pager(paged(people), 'person') +
      '</section>' +

      /* A LIST IS WHO IS ON IT. Where they stand and what has been said
         are the campaign's questions, answered on the campaign's page — a
         list that repeats them is a second place for the same figure to go
         stale in. */
    '</div>';
  }

  /* ══ THE PEOPLE AS A ROSTER ═════════════════════════════════════════════
     A list is a roster you check, not a worklist you work, and V3 drew it as
     rows. The shell's own row — name, a line, the facts, one verb — at the
     scale this build uses, fifteen a page. The cards stay on the queue. */
  /* ══ THE ROW CARRIES WHAT V3'S ROW CARRIED ═════════════════════════════
     V3's list row said, left: who, what they do and where, the city and the
     sector, the two ways to reach them, the LinkedIn address, and under it
     AiMY's one line about this person; right: the company's size at the
     largest step because it is the figure you compare DOWN the page, what
     they would be bought for, and the status tag. Mine had the name, a
     line, the rung and a number. The whole right column was missing, and
     the right column is the reason a roster beats a grid: figures align.

     AiMY's line is drawn only where AiMY has something specific — a note
     somebody left, what they pushed back on, an opening, a screened call, a
     dead number. Fifteen rows each wearing the mark to say "software, 260
     staff" is the one-block-per-row defect V3's own note spends a paragraph
     on. The verb sits at the foot of the right column, where the eye ends. */
  const ROSTER_QUIET = ['the account and the campaign', 'the touchpoint before this one'];
  function rosterRow(c) {
    const a = accOf(c);
    const rg = RUNG[c.checkpoint] || RUNG['not-called'];
    const camp = campsOf(c).filter(mine)[0] || campsOf(c)[0];
    const sell = camp && SELL[camp.sells[0]];
    const slug = String(c.name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const li = 'linkedin.com/in/' + slug;
    const said = aimySays(c, true);
    const specific = said && ROSTER_QUIET.indexOf(said.from) < 0;
    const facts = [
      a ? esc(a.city) : null,
      a ? esc(INDUSTRY[a.industry].label) : null,
      c.email ? esc(c.email) : null,
      c.phone ? '<a class="s-inline-btn" href="tel:' + esc(c.phone.replace(/\s/g, '')) + '">' + esc(c.phone) + '</a>' : null,
    ].filter(Boolean);
    return '<div class="s-brow">' +
      '<span class="s-brow-nopick"></span>' +
      '<span class="s-brow-main">' +
        '<button class="s-brow-name" type="button" data-con="' + esc(c.id) + '">' + esc(c.name) + '</button>' +
        '<span class="s-brow-desc">' + esc(c.title) + (a ? ' at ' + esc(a.name) : '') + '</span>' +
        '<span class="s-brow-facts">' + (facts.length ? facts.join(' · ')
          : '<i>no email and no phone number</i>') + '</span>' +
        '<span class="s-brow-links">' +
          '<a class="s-brow-link" href="https://www.' + esc(li) + '" target="_blank" rel="noopener">' + esc(li) + '</a>' +
          (a ? '<a class="s-brow-link" href="https://' + esc(a.domain) + '" target="_blank" rel="noopener">' + esc(a.domain) + '</a>' : '') +
        '</span>' +
        (specific
          ? '<span class="s-brow-ops b-roster-ai">' +
              '<svg class="b-aimy-mark" width="13" height="15" viewBox="0 0 18 20" aria-hidden="true"><use href="#aimy-logo-small"/></svg>' +
              '<span>' + said.text + '</span></span>'
          : '') +
      '</span>' +
      '<span class="s-brow-side">' +
        '<span class="s-brow-fig">' + (a ? commas(a.size) + ' staff' : '—') + '</span>' +
        '<span class="s-brow-rev">' + (sell ? 'buys ' + esc(sell.name) : 'fit unknown') + '</span>' +
        /* A PILL ABOVE A PILL READS AS TWO BUTTONS. The rung is a state:
           a dot in its tone and the word, quiet. The only pill on the row
           is the one you press. */
        '<span class="b-rstate"><span class="b-rstate-dot ' + (TL_TONE[rg.tone] || 'tone-neutral') +
          '"></span>' + esc(rg.label) + '</span>' +
        (c.phone && callable(c)
          ? '<button class="s-insight-lnk b-roster-call" type="button" data-call="' + esc(c.id) + '">Call</button>'
          : !c.phone && !c.dnc && !isExit(c.checkpoint)
            ? '<button class="s-inline-btn b-roster-call" type="button" data-enrichcon="' + esc(c.id) + '">Find a number</button>'
            : '') +
      '</span>' +
    '</div>';
  }
  function rosterBlock(rows) {
    if (!rows.length) return '<p class="b-vfoot">Nobody is on this list.</p>';
    return '<div class="s-brows b-roster">' + rows.map(rosterRow).join('') + '</div>';
  }

  /* The criteria a saved list carries, parsed the way the builder parses
     the URL's — one reader, so a list re-run matches what it matched. */
  function termsOfCsv(csv) {
    const out = Object.create(null);
    String(csv || '').split(',').filter(Boolean).forEach((x) => {
      const at = x.indexOf(':');
      if (at < 0) return;
      (out[x.slice(0, at)] || (out[x.slice(0, at)] = [])).push(x.slice(at + 1));
    });
    return out;
  }
  /* [2] How many more matched the criteria and were never brought in —
     V3's listGap. Only for a list that still carries its criteria. */
  function listGap(l) {
    if (!l.terms) return 0;
    const matched = buildMatched(termsOfCsv(l.terms)).length;
    return Math.max(0, matched - (l.found || l.has.length));
  }

  /* [3] FILL IN WHAT IS MISSING — V3's data-enrichlist, over the people on
     this list without a number. The supplier's own hit rate decides who
     gets one, deterministically off the record's id so a re-run says the
     same thing. One write, one toast, one undo. */
  function fillList(id) {
    const l = DB.byList[id];
    if (!l) return;
    const f = finderOf();
    const done = [];
    l.has.map((cid) => DB.byCon[cid]).filter((c) => c && !c.phone).forEach((c) => {
      const h = Math.abs(hash(c.id));
      if ((h % 1000) / 1000 < f.phone) {
        patchCon(c, { phone: '+31 6 ' + String(1000000 + (h % 8999999)), enrichedAt: TODAY_ISO });
        done.push(c.id);
      }
    });
    paint();
    if (!done.length) { toast(f.name + ' had no number for anyone here.'); return; }
    toast(f.name + ' found a number for ' + plural(done.length, 'person') + ' on ' + l.name, () => {
      done.forEach((cid) => patchCon(DB.byCon[cid], { phone: null, enrichedAt: null }));
      paint();
    });
  }

  /* [3] What AiMY makes of the list, with a door. The card's two readings
     that mean something — it is on no campaign, or people came back without
     a number — get the block. The fallback, how many have been rung, is what
     the funnel two sections down shows, and is not drawn as a panel. */
  function listLead(l, people, ring, camp) {
    const said = listSays(l, people, ring.length, camp);
    if (!said || said.from === 'their own records') return '';
    const first = ring[0];
    /* The missing-number reading gets V3's verb; the no-campaign reading
       gets the phone anyway. */
    const door = /without a number/.test(said.text)
      ? '<button class="s-insight-lnk" type="button" data-filllist="' + esc(l.id) + '">' +
        'Fill in what is missing</button>'
      : first
        ? '<button class="s-insight-lnk" type="button" data-call="' + esc(first.id) + '">Call ' +
          esc(first.name.split(' ')[0]) + (camp ? '' : ' anyway') + '</button>'
        : '';
    return '<section class="s-insight is-lead b-lead-slim s-block-wide" aria-label="What AiMY makes of this list">' +
      '<div class="s-lead-mark">' +
        '<svg class="s-insight-mark" viewBox="0 0 18 20" width="14" height="14" aria-hidden="true">' +
          '<use href="#aimy-logo-small"/></svg>' +
        '<span class="work-state ws-detected" data-work-state="detected">' + esc(said.from) + '</span>' +
      '</div>' +
      '<p class="s-lead-deck">' + said.text + '</p>' +
      (door ? '<div class="s-lead-acts">' + door + '</div>' : '') +
    '</section>';
  }


  /* ══ THE BUILDER, PORTED FROM THE V3 BUILD ══════════════════════════════
     Four steps, and the V3 build's arguments for each of them hold here:

       KIND FIRST, because which axes exist follows from it — a job title is
       a criterion for people and meaningless for companies.

       THE SENTENCE IS TYPED IN THE BAR THAT IS ALREADY THERE. A textarea on
       this page asking "who are you looking for" beside a fixed composer
       asking the same thing in different words makes the first question of
       the interaction "which box?". The page shows what it HEARD; the bar is
       where you say it.

       AiMY OFFERS CRITERIA AND APPLIES NONE. Every suggestion states the
       count behind it and waits to be pressed. A builder that pre-applies
       what it guessed is a builder you have to audit before you trust.

       THE LOOKING IS VISIBLE. Rows arrive one at a time under the names of
       the suppliers that were asked, because a spinner over a search says
       nothing about whether it is working or stuck.

     `DRAFT` is the working document: the sentence, the name, which of your
     own you are bringing, and the run. The CRITERIA live in the URL, so a
     half-described search is a link somebody can send. */

  let DRAFT = null;
  const BSTEPS = ['kind', 'describe', 'run', 'done'];
  /* A done URL is only a result while something came back. The entry the
     browser keeps under a discarded result says done and holds nothing; it
     reads as the describe page, criteria intact, not as "0 came back". */
  const bstep = () => {
    const step = BSTEPS.indexOf(S.build) >= 0 ? S.build : 'kind';
    return step === 'done' && !(DRAFT && (DRAFT.rows || []).length) ? 'describe' : step;
  };

  function buildOpen(over) {
    DRAFT = { kind: 'con', said: '', name: null, take: [], drop: [], rows: [], run: null };
    go(Object.assign(cleared(), { on: 'lists', build: 'kind', bt: '' }, over || {}));
  }

  const buildKind = () => (DRAFT && DRAFT.kind) || S.bk || 'con';

  /* The name tracks the criteria until you disagree with it. Type in the
     field and it is yours and stops moving; leave it and it keeps up. */
  const buildAutoName = () => autoName(terms(), buildKind());
  const buildName = () => (DRAFT && DRAFT.name != null ? DRAFT.name : buildAutoName());

  function buildPage() {
    const step = bstep();
    if (!DRAFT) DRAFT = { kind: S.bk || 'con', said: '', name: null, take: [], drop: [], rows: [], run: null };
    if (step === 'run') return buildRunning();
    if (step === 'done') return buildDone();
    if (step === 'kind') return buildPickKind();
    return buildDescribe();
  }

  function buildPickKind() {
    return '<div class="s-home">' +
      backBtn('data-go="' + esc(JSON.stringify(Object.assign(cleared(), { on: 'lists' }))) + '"', 'Back to lists') +
      '<div class="s-sheet-head s-block-wide"><div class="s-sheet-head-main">' +
        '<div class="s-sheet-kind">New list</div>' +
        '<h1 class="s-sheet-name">What are you collecting?</h1>' +
      '</div></div>' +
      '<div class="s-ways s-block-wide">' +
        '<button class="s-way" type="button" data-bkind="acc">' +
          '<span class="s-way-name">Companies</span>' +
          '<span class="s-way-why">One row per organization. <b>' +
            commas(DB.net.length) + '</b> in reach, and the ones you already ' +
            'hold can come along.</span>' +
        '</button>' +
        '<button class="s-way" type="button" data-bkind="con">' +
          '<span class="s-way-name">People</span>' +
          '<span class="s-way-why">The people at those companies, narrowed by job ' +
            'title. <b>' + commas(DB.con.length) + '</b> of them are already yours.</span>' +
        '</button>' +
      '</div>' +
    '</div>';
  }

  function buildDescribe() {
    const t = terms();
    const found = buildMatched(t);
    const kind = buildKind();
    const mine2 = bookFit(t);
    const take = DRAFT.take.length;
    const eg = kind === 'con'
      ? 'QA managers at software companies in the Netherlands with 200 to 1,000 staff'
      : 'Banking and logistics companies in the Netherlands with 200 to 1,000 staff';
    const chips = [];
    BUILD_AXES.forEach((ax) => {
      if (kind === 'acc' && ax.k === 'title') return;
      const opts = Object.create(null);
      ax.opts().forEach((o) => (opts[o[0]] = o[1]));
      (t[ax.k] || []).forEach((v) => chips.push({ axis: ax.k, val: v, label: opts[v] || v }));
    });
    if ((t.only || []).indexOf('new') >= 0) {
      chips.push({ axis: 'only', val: 'new', label: 'Not already in the book' });
    }
    if ((t.only || []).indexOf('phone') >= 0) {
      chips.push({ axis: 'only', val: 'phone', label: 'Has a number' });
    }

    return '<div class="s-home">' +
      backBtn('data-go="' +
        esc(JSON.stringify(Object.assign(cleared(), { on: 'lists', build: 'kind' }))) + '"',
        'Companies or people') +
      /* ══ THE VERB IS WHERE THE PAGE STARTS ═════════════════════════════
         It sat at the bottom, past the criteria, the suggestions and the
         expectation — so the one thing this page is for was the last thing
         on it, and it was pressable before anybody had said who they were
         after. Top right, beside the name, and dark until there is a
         criterion to run: an empty search asks five hundred strangers for
         nothing in particular. */
      '<div class="s-sheet-head s-block-wide"><div class="s-sheet-head-main">' +
        '<div class="s-sheet-kind">New list · ' + (kind === 'con' ? 'People' : 'Companies') + '</div>' +
        '<h1 class="s-sheet-name"><input class="s-build-name" type="text" spellcheck="false" ' +
          'value="' + esc(buildName()) + '" data-auto="' + esc(buildAutoName()) + '" ' +
          'data-bname aria-label="Name this list" /></h1>' +
      '</div>' +
      '<span class="b-sheet-act">' +
        '<button class="entry-action em-direct s-build-go" type="button" data-bgo' +
          (anyCrit(t) && (found.length + take) ? '' : ' disabled aria-disabled="true"') +
          '>Generate the list</button>' +
      '</span></div>' +

      /* ══ A SENTENCE POINTING AT THE BAR IS NOT A WAY INTO IT ═══════════
         "Say who you are after in the bar below" was the whole of the empty
         state: an instruction to go and do something somewhere else on the
         page, with an example you would have to read, remember and retype.
         The one press puts the example in the bar with the caret at its end,
         so the first thing a caller does is edit a working sentence rather
         than face an empty field trying to recall the shape of one. */
      (DRAFT.said
        ? '<p class="s-block-wide s-said">' + esc(DRAFT.said) + '</p>'
        : '<div class="s-block-wide b-empty">' +
            /* A company has no job title, and the builder does not offer the
               axis on that side either. */
            '<p class="s-said is-empty">Say who you are after — a sector, a country, ' +
            'a size' + (kind === 'con' ? ', a job title' : '') + '. Say it in any order ' +
            'and I will read it.</p>' +
            '<button class="s-insight-lnk primary" type="button" data-fill="' + esc(eg) + '">' +
              'Add criteria</button>' +
          '</div>') +

      (chips.length
        ? '<div class="s-find-crit s-block-wide">' + chips.map((c) =>
            '<button class="chip active" type="button" data-bterm="' +
            esc(c.axis + ':' + c.val) + '">' + esc(c.label) +
            '<span class="s-crit-x" aria-hidden="true">×</span></button>').join('') + '</div>'
        : '') +

      buildSuggestBlock(t, found, mine2) +

      /* ══ THE SOURCES ARE A LISTING, NOT A CHOICE ═══════════════════════
         They were three chips with one lit, beside a sentence naming the lit
         one — a control for picking a supplier, on a page where nobody is
         picking a supplier. Which one answers is not a decision a caller
         makes; what they need is whether the numbers are coming and, when
         one of them stops, which one and since when.

         Under the sentence and to the left of the button, because it is the
         working of that sentence rather than another thing to press. */
      '<div class="s-build-foot s-block-wide">' +
        '<div class="b-src-side">' +
        buildExpect(t, found) +
        (take ? '<p class="s-build-total s-block-wide"><b>' + commas(take) +
          '</b> of your own are going in with them.</p>' : '') +
        '<div class="b-srcs">' +
          '<span class="b-srcs-cap">Where the numbers come from, and how they did last week</span>' +
          FINDERS.map((x) =>
            '<span class="b-src' + (x.down ? ' is-off' : '') + '">' +
              '<span class="b-rstate-dot ' + (x.down ? 'tone-warn' : 'tone-ok') + '"></span>' +
              '<span class="b-src-n">' + esc(x.name) + '</span>' +
              /* A percentage, because that is the unit a fill rate is quoted
                 in everywhere else a caller meets one. "7 in 10 with a
                 number" made you work out both what the ratio was and what
                 it was a ratio OF. */
              '<span class="b-src-v">' + (x.down
                ? 'not answering since ' + esc(sayDay(dayAdd(-2)))
                : Math.round(x.phone * 100) + '% came with a phone number') +
              '</span>' +
            '</span>').join('') +
        '</div>' +
        '</div>' +
      '</div>' +
    '</div>';
  }

  /* ── ONE READER FOR A TYPED SENTENCE ──
     "Software companies in Amsterdam with 200 to 1,000 staff" becomes three
     criteria, and it accumulates across axes rather than taking one match
     each — the difference between reading three things out of that sentence
     and reading one. */
  const GOAL_IND = [
    [/bank|insur|financ|fintech/i, 'banking'],
    [/software|saas|tech company|platform/i, 'software'],
    [/logistic|freight|shipping|transport|supply/i, 'logistics'],
    [/health|hospital|clinic|medical|care home/i, 'health'],
    [/retail|shop|store|ecommerce|e-commerce/i, 'retail'],
    [/energy|utility|utilities|power|grid/i, 'energy'],
    [/public|universit|school|council|government|education/i, 'public'],
    [/telecom|carrier|mobile operator/i, 'telecom'],
    [/manufactur|industrial|factory|plant/i, 'industry'],
    [/hotel|hospitality|resort|restaurant/i, 'hospitality'],
  ];

  function readSaid(text, kind) {
    const s = String(text || '').toLowerCase();
    const add = [];
    GOAL_IND.forEach((p) => { if (p[0].test(s)) add.push(['industry', p[1]]); });
    COUNTRY_OPTS.forEach((c) => {
      if (s.indexOf(c[1].toLowerCase()) >= 0) add.push(['where', c[0]]);
    });
    /* A city names its country, because somebody typing "Amsterdam" means the
       Netherlands and the index is filtered by country. */
    CITIES.forEach((c) => {
      if (s.indexOf(c[0].toLowerCase()) >= 0) add.push(['where', c[1]]);
    });
    if (kind === 'con') {
      TITLE_BANDS.forEach((b) => { if (b.re.test(s)) add.push(['title', b.k]); });
    }
    /* Headcount, written the way people write it. */
    const nums = (s.match(/([\d][\d,.]*)\s*(?:k\b)?/g) || [])
      .map((x) => Number(x.replace(/[^\d]/g, ''))).filter((n) => n >= 10);
    if (nums.length) {
      const lo = Math.min.apply(null, nums);
      const hi = nums.length > 1 ? Math.max.apply(null, nums) : lo;
      SIZE_BANDS.forEach((b) => { if (hi >= b.lo && lo <= b.hi) add.push(['size', b.k]); });
    }
    if (/not already|new only|exclude (mine|ours)|leave out/.test(s)) add.push(['only', 'new']);
    /* De-duplicated, because "Amsterdam, Netherlands" names one country twice. */
    const seen = Object.create(null);
    return add.filter((p) => {
      const k = p[0] + ':' + p[1];
      if (seen[k]) return false;
      seen[k] = 1;
      return true;
    });
  }

  /* Which of your own book matches the criteria. The index is what is out
     there; this is what you already hold, and it can come along. */
  function bookFit(t) {
    const want = t || terms();
    const any = BUILD_AXES.some((ax) => (want[ax.k] || []).length);
    if (!any) return [];
    return DB.con.filter((c) => {
      const a = accOf(c);
      if (!a) return false;
      if ((want.industry || []).length && want.industry.indexOf(a.industry) < 0) return false;
      if ((want.size || []).length && want.size.indexOf(sizeBand(a.size)) < 0) return false;
      if ((want.where || []).length && want.where.indexOf(a.country) < 0) return false;
      if ((want.title || []).length && want.title.indexOf(titleBand(c.title)) < 0) return false;
      return true;
    }).slice(0, 400);
  }

  /* ── WHAT AiMY OFFERS, AND APPLIES NONE OF ──
     Each one states the count behind it and waits to be pressed. */
  const anyCrit = (t) => BUILD_AXES.some((ax) => (t[ax.k] || []).length);
  /* A number given to two figures is a number nobody will read as exact. */
  const roughly = (n) => {
    if (n < 10) return commas(n);
    const p2 = Math.pow(10, String(Math.round(n)).length - 2);
    return commas(Math.round(n / p2) * p2);
  };

  /* ══ BEFORE THE RUN THERE IS NOTHING TO COUNT ══════════════════════════
     The foot read "12,000 of the 12,000 I can reach match. Apollo would give
     a number for about 8,880 of them" — a definite count, and the count of
     the whole index when nobody had said what they were after. If the page
     already knows how many there are and how many have numbers, pressing
     Generate discovers nothing, and the run underneath it is theatre.

     What is actually known here is the criteria and a local sketch of the
     market. So: an expectation, said as one — how wide the criteria are,
     how many should come back with a number, how much of it you may already
     hold — each with the thing the guess is read off. The counts arrive from
     the run, which is the only place they can come from. */
  function buildExpect(t, found) {
    if (!anyCrit(t)) return '';
    const f = finderOf();
    const share = found.length / Math.max(1, DB.net.length);
    /* Half a clause each, because they are read inside one sentence. */
    const wide = !found.length
      ? ['Nothing like this', 'nothing in my sketch matches, so expect very little back']
      : share >= 0.45
        ? ['Very wide', 'nearly everything matches, so name a sector or a country']
        : share >= 0.15
          ? ['Wide', 'it will fill the run easily and be a broad list']
          : share >= 0.03
            ? ['About right', 'narrow enough to be a list, wide enough to fill a run']
            : ['Narrow', 'you may get fewer than 500 back'];
    /* ══ A SUMMARY, NOT A TABLE ════════════════════════════════════════
       Two labelled rows, each a paragraph, to say the two things a caller
       reads in a second: is this too wide, and will they have numbers. One
       sentence with the two figures in it. Everything the guess is read off
       arrives on the run twelve seconds later and does not need saying
       twice before it. */
    return '<div class="b-expect">' +
      '<span class="b-srcs-cap">What to expect</span>' +
      '<p class="b-exp-say"><b>' + esc(wide[0]) + '</b> — ' + esc(wide[1]) + '. Maybe <b>' +
        Math.round(f.phone * 100) + '%</b> of them with a phone number, going on what ' +
        esc(f.name) + ' did last week.</p>' +
      /* What you already hold is said by the suggestion above, which also
         offers to drop them. Saying it twice, once without the fix, is the
         duplication this rebuild keeps taking out. */
    '</div>';
  }

  function buildSuggests(t, found, mine2) {
    const out = [];
    const has = (axis) => (t[axis] || []).length > 0;
    const camps = myCampaigns();

    /* ══ AN EMPTY BUILDER IS A QUESTION WITH NO ANSWER OFFERED ═══════════
       Everything else in this block narrows a set that already exists. These
       three propose the first criterion, off things a caller already has:
       a campaign of theirs that is running out of people, where their own
       handovers came from, and where they actually get through.

       The first used to read a sector out of the campaign's goal sentence.
       The goal is the ask now — "a first meeting with the VP of engineering"
       — and names no sector at all, so it read nothing and the empty builder
       went silent. The campaign carries an industry and a region as fields;
       there is no sentence to parse. */
    const THE_REGION = { nl: 1, nordic: 1 };
    const short = camps.filter(campOpen)
      .map((k) => ({ k: k, left: queue(k.id, 'all').length }))
      .sort((a, b) => a.left - b.left)[0];
    if (short && !has('industry')) {
      const k = short.k;
      const reg = REGION[k.region];
      out.push({ k: 'goal',
        terms: [['industry', k.industry]].concat((reg ? reg.cc : []).map((cc) => ['where', cc])),
        /* Two of the nine region names take an article and the rest do
           not, and "in Netherlands" is the kind of seam that makes a
           sentence read as assembled rather than written. */
        say: '<b>' + esc(k.name) + '</b> has ' + esc(plural(short.left, 'person')) +
          ' left to ring and is after ' + esc(INDUSTRY[k.industry].label.toLowerCase()) +
          ' in ' + (reg ? (THE_REGION[reg.k] ? 'the ' : '') + esc(reg.label) : 'its region') + '.',
        act: 'Look for those' });
    }
    /* Where the ones you have actually got somewhere came from. Two sectors
       at two in five, because "came from ten sectors" is every sector and no
       suggestion at all. */
    if (!has('industry')) {
      const won = DB.con.filter((c) => c.checkpoint === 'handed-over');
      const per = Object.create(null);
      won.forEach((c) => { const a = accOf(c); if (a) per[a.industry] = (per[a.industry] || 0) + 1; });
      const inds = Object.keys(per).sort((x, y) => per[y] - per[x]).slice(0, 2);
      const held = inds.reduce((t, i) => t + per[i], 0);
      if (inds.length && won.length >= 4 && held / won.length >= 0.4) {
        out.push({ k: 'won', terms: inds.map((i) => ['industry', i]),
          say: '<b>' + commas(held) + ' of your ' + commas(won.length) + '</b> handovers came ' +
            'from ' + listSay(inds.map((i) => INDUSTRY[i].label)) + '.',
          act: 'Add those sectors' });
      }
    }
    /* Where you actually get through. A country you have rung enough times
       for the rate to mean anything, and which beats your own average. */
    if (!has('where')) {
      const mineT = DB.touch.filter((t2) => t2.by === me().id && OUTCOME[t2.outcome]);
      const tot = Object.create(null);
      const got = Object.create(null);
      let allN = 0;
      let allGot = 0;
      mineT.forEach((t2) => {
        const c = DB.byCon[t2.con];
        const a = c && accOf(c);
        if (!a) return;
        tot[a.country] = (tot[a.country] || 0) + 1;
        allN++;
        if (t2.outcome === 'reached') { got[a.country] = (got[a.country] || 0) + 1; allGot++; }
      });
      /* Only a country the builder can actually be narrowed to. Austria and
         Switzerland are inside DACH and are not choices on the axis, so
         offering one adds a criterion with no name and no chip. */
      const known = Object.create(null);
      COUNTRY_OPTS.forEach((o) => (known[o[0]] = o[1]));
      const best = Object.keys(tot).filter((cc) => known[cc] && tot[cc] >= 25)
        .sort((x, y) => (got[y] || 0) / tot[y] - (got[x] || 0) / tot[x])[0];
      const rate = best ? (got[best] || 0) / tot[best] : 0;
      if (best && allN && rate > (allGot / allN) * 1.15) {
        const label = known[best];
        out.push({ k: 'gets', terms: [['where', best]],
          say: 'You get through most in <b>' + esc(label) + '</b> — ' +
            Math.round(rate * 100) + '% of the ' + commas(tot[best]) + ' calls you have made there.',
          act: 'Only ' + esc(label) });
      }
    }
    /* What you already hold that matches, and how much of it is live. */
    if (mine2.length && DRAFT.take.length < mine2.length) {
      const live = mine2.filter(callable);
      out.push({ k: 'have', take: mine2.map((c) => c.id),
        say: '<b>' + commas(mine2.length) + '</b> you already hold match this' +
          (live.length ? ', and <b>' + commas(live.length) + '</b> can be rung' : '') + '.',
        act: 'Bring ' + (mine2.length === 1 ? 'it' : 'them') + ' in' });
    }
    /* A concentration worth narrowing to. A third or better, or it is a fact
       rather than a finding. */
    if (found.length > 3 && !has('where') && anyCrit(t)) {
      const n = Object.create(null);
      found.forEach((r) => (n[r.country] = (n[r.country] || 0) + 1));
      const top = Object.keys(n).sort((a, b) => n[b] - n[a])[0];
      if (top && n[top] / found.length >= 0.3) {
        const label = (COUNTRY_OPTS.filter((c) => c[0] === top)[0] || [top, top])[1];
        out.push({ k: 'where', terms: [['where', top]],
          say: '<b>' + commas(n[top]) + ' of the ' + commas(found.length) + '</b> are in ' +
            esc(label) + '.',
          act: 'Only ' + esc(label) });
      }
    }
    /* A size band holding most of the matches. Same rule as the country
       below it: a third or better, or it is a fact rather than a finding. */
    if (found.length > 3 && !has('size') && anyCrit(t)) {
      const n = Object.create(null);
      found.forEach((r) => (n[sizeBand(r.size)] = (n[sizeBand(r.size)] || 0) + 1));
      const top = Object.keys(n).sort((a, b) => n[b] - n[a])[0];
      if (top && n[top] / found.length >= 0.35) {
        const band = SIZE_BANDS.filter((b) => b.k === top)[0];
        out.push({ k: 'size', terms: [['size', top]],
          say: '<b>' + commas(n[top]) + ' of the ' + commas(found.length) +
            '</b> have ' + esc((band ? band.label : top).toLowerCase()) + ' staff.',
          act: 'Only those' });
      }
    }
    /* Where the callable ones are. A criterion that narrows to people you can
       actually ring is worth more than one that narrows to more people. */
    if (buildKind() === 'con' && found.length > 3 && anyCrit(t)) {
      const f2 = finderOf();
      const dead = found.filter((r) => r.seedPhone >= f2.phone).length;
      if (dead && dead / found.length >= 0.25) {
        out.push({ k: 'phone', terms: [['only', 'phone']],
          say: '<b>' + commas(dead) + ' of the ' + commas(found.length) +
            '</b> will come back without a number, so they cannot be rung.',
          act: 'Only ones with a number' });
      }
    }
    /* The overlap between the index and your own book. */
    /* "1,441 of the 12,000 are already in your book" is true of the whole
       index and says nothing about a list nobody has described yet. */
    if ((t.only || []).indexOf('new') < 0 && anyCrit(t)) {
      const dupes = found.filter((r) => r.known).length;
      if (dupes) {
        out.push({ k: 'dedupe', terms: [['only', 'new']],
          say: '<b>' + commas(dupes) + ' of the ' + commas(found.length) +
            '</b> are already in your book.',
          act: 'Leave them out' });
      }
    }
    return out.slice(0, 3);
  }

  function buildSuggestBlock(t, found, mine2) {
    const sug = buildSuggests(t, found, mine2);
    if (!sug.length) return '';
    /* THE MARK GOES ON THE BLOCK, NOT ON EVERY ROW. `.s-sugg-row` is a
       two-column grid — the sentence and the button — so a third child took
       the button's column and pushed it onto a row of its own. One mark
       heads the block, which is also what the V3 build does and reads once
       rather than three times. */
    return '<div class="s-sugg s-block-wide">' +
      '<p class="s-lead-mark">' +
        '<svg class="s-insight-mark" viewBox="0 0 18 20" aria-hidden="true">' +
          '<use href="#aimy-logo-small"/></svg>AiMY suggests</p>' +
      sug.map((s) =>
        '<div class="s-sugg-row">' +
          '<span class="s-sugg-say">' + s.say + '</span>' +
          '<button class="s-finding-go" type="button" data-bsug="' + esc(s.k) + '">' +
            esc(s.act) + '</button>' +
        '</div>').join('') + '</div>';
  }

  /* ══ THE LOOKING IS A PIPELINE ═════════════════════════════════════════
     It was a caption and a stream of the last eight names ticking every
     ninety milliseconds: it said something was happening and nothing about
     what. A search that takes six seconds is four steps — read the
     criteria, ask the suppliers, fill in the ways to reach people, take
     out who you already have — and a caller waiting on it should be able
     to see which step it is on and what that step found.

     So it is a pipeline: a progress track, four stage tiles joined by
     connectors that fill as the next stage runs, and a step list with the
     time each took and, once it is done, what it found — the rows the
     chosen supplier returned, the share with a number, how many were
     already in the book. The run's REAL numbers, once each, on the step
     they belong to; a typed log stood here for one pass and said them four
     lines at a time before scrolling them away. One elapsed clock
     drives all of it from requestAnimationFrame; every element on screen
     is a function of that clock, so nothing can drift out of step, and a
     tab that was in the background catches up rather than stalling.

     It stays on screen when it finishes. Auto-navigating to the result
     would take away the one control a finished run offers — run it again
     with a different supplier — so the footer holds both: the way to what
     came back, and the other suppliers. */
  let PIPE = null;
  const PIPE_ICON = {
    read: '<path d="M4 6h16M4 12h10M4 18h7"/><circle cx="18" cy="17" r="3"/><path d="M20.2 19.2 22 21"/>',
    ask: '<path d="M12 20v-8"/><circle cx="12" cy="10" r="2"/><path d="M7.8 14.2a6 6 0 0 1 0-8.4M16.2 5.8a6 6 0 0 1 0 8.4M5 17a10 10 0 0 1 0-14M19 3a10 10 0 0 1 0 14"/>',
    fill: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z"/>',
    known: '<path d="M4 4h11a3 3 0 0 1 3 3v13H7a3 3 0 0 0-3 3z"/><path d="M4 4v19M18 20H7a3 3 0 0 0-3 3"/>',
  };
  const pipeIcon = (k) =>
    '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" ' +
      'stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      PIPE_ICON[k] + '</svg>';
  const pipeCheck = (size) =>
    '<svg viewBox="0 0 24 24" width="' + size + '" height="' + size + '" fill="none" ' +
      'stroke="currentColor" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round" ' +
      'aria-hidden="true"><path pathLength="1" d="M5 12.5l4.5 4.5L19 7"/></svg>';
  /* ══ TEXT THAT CHANGES STATE GOES THROUGH A BLUR ═══════════════════════
     "Running · Asking Apollo" became "Found · 500" by swapping characters
     in place, which the eye reads as a glitch. The old words leave through
     4px of blur and the new ones arrive through it, 90ms each way (bdr.css
     §29); a swap already under way is not restarted by the frame after it,
     and a newer word overrides an older one still on its way. */
  function swapText(el, text) {
    if (!el || el.textContent === text || el._swapTo === text) return;
    el.classList.add('b-swap', 'is-swapping');
    el._swapTo = text;
    setTimeout(() => {
      if (el._swapTo !== text) return;
      el.textContent = text;
      el._swapTo = null;
      el.classList.remove('is-swapping');
    }, 90);
  }
  const pipeFmt = (n) => n.toFixed(1) + 's';

  /* The four steps, with the run's own numbers in their lines. */
  function pipeStages() {
    const f = finderOf();
    const rows = DRAFT.rows || [];
    const mine2 = DRAFT.take.map((id) => DB.byCon[id]).filter(Boolean);
    const known = rows.filter((x) => x.known).length;
    const t = terms();
    const nCrit = Object.keys(t).reduce((n, k) => n + (t[k] || []).length, 0);
    const withNum = rows.filter((x) => x.seedPhone < f.phone).length;
    const withMail = rows.filter((x) => x.seedEmail < f.email).length;
    const kind = buildKind() === 'acc' ? 'companies' : 'people';
    const others = FINDERS.filter((x) => x.k !== f.k);
    const share = Math.round(rows.length * 0.62);
    return [
      { id: 'read', label: 'Read the criteria', icon: 'read', duration: 1.4, logs: [
        { at: 0.05, text: '$ find ' + kind + ' · ' + describeTerms(t) },
        { at: 0.6, text: '→ ' + plural(nCrit, 'criterion', 'criteria') + ' understood' },
        { at: 1.0, text: '✓ ready' } ] },
      { id: 'ask', label: 'Ask the suppliers', icon: 'ask', duration: 2.4, logs: [
        { at: 0.05, text: '$ ask ' + FINDERS.map((x) => x.name).join(' · ') },
        { at: 0.7, text: '→ ' + f.name + ': ' + commas(share) + ' rows' },
        { at: 1.4, text: '→ ' + others[0].name + ': ' + commas(rows.length - share) + ' rows' },
        { at: 2.0, text: '✓ ' + commas(rows.length) + ' candidates after de-duplication' } ] },
      { id: 'fill', label: 'Fill in the ways in', icon: 'fill', duration: 1.8, logs: [
        { at: 0.05, text: '$ ' + f.name.toLowerCase().replace(/\s.*$/, '') + ' fill --phone --email' },
        { at: 0.6, text: '→ numbers for ' + Math.round(f.phone * 100) + '%' },
        { at: 1.1, text: '→ emails for ' + Math.round(f.email * 100) + '%' },
        { at: 1.5, text: '✓ ' + commas(withNum) + ' with a number, ' + commas(withMail) + ' with an address' } ] },
      { id: 'known', label: 'Take out who you have', icon: 'known', duration: 1.4, logs: [
        { at: 0.05, text: '$ diff against your book' },
        { at: 0.5, text: '→ ' + commas(known) + ' already in your book' },
        { at: 0.9, text: '→ ' + commas(mine2.length) + ' brought in from yours' },
        { at: 1.2, text: '✓ ' + commas(rows.length + mine2.length) + ' ready to save' } ] },
    ];
  }

  function buildRun() {
    const t = terms();
    const found = buildMatched(t);
    const mine2 = DRAFT.take.map((id) => DB.byCon[id]).filter(Boolean);
    const rows = found.slice(0, Math.max(0, 500 - mine2.length));
    DRAFT.rows = rows;
    DRAFT.run = { total: rows.length + mine2.length, at: 0 };
    const stages = pipeStages();
    const starts = stages.reduce((acc, x) => acc.concat([acc[acc.length - 1] + x.duration]), [0]);
    if (PIPE && PIPE.raf) clearTimeout(PIPE.raf);
    PIPE = { stages: stages, starts: starts, total: starts[starts.length - 1], t0: null,
      raf: null, elapsed: 0 };
    go({ build: 'run' });
    PIPE.raf = setTimeout(pipeFrame, 16);
  }
  /* A TIMER, NOT requestAnimationFrame. rAF stops dead in a background tab,
     so a run started and then tabbed away from never finished. A timer is
     throttled there but still fires, and because every frame is a function
     of wall time the run simply catches up when it does. Sixteen
     milliseconds in a visible tab is the same sixty frames a second. */
  const pipeFrame = () => pipeTick(performance.now());

  /* One clock; everything is a function of it. */
  const pipeStateOf = (i) => (PIPE.elapsed >= PIPE.starts[i] + PIPE.stages[i].duration ? 'done'
    : PIPE.elapsed >= PIPE.starts[i] ? 'running' : 'pending');
  const pipeLocalOf = (i) => Math.max(0, Math.min(PIPE.elapsed - PIPE.starts[i], PIPE.stages[i].duration));
  const pipeProgressOf = (i) => Math.max(0, Math.min(1, pipeLocalOf(i) / PIPE.stages[i].duration));

  function pipeTick(now) {
    if (!PIPE || S.build !== 'run' || !byId('pipeCard')) { if (PIPE) PIPE.raf = null; return; }
    if (PIPE.t0 === null) PIPE.t0 = now;
    PIPE.elapsed = Math.min((now - PIPE.t0) / 1000, PIPE.total);
    pipePaint();
    if (PIPE.elapsed >= PIPE.total) { PIPE.raf = null; if (DRAFT && DRAFT.run) DRAFT.run.at = DRAFT.run.total; return; }
    PIPE.raf = setTimeout(pipeFrame, 16);
  }

  function pipePaint() {
    const finished = PIPE.elapsed >= PIPE.total;
    const firstOpen = PIPE.stages.findIndex((x, i) => pipeStateOf(i) !== 'done');
    const ai = firstOpen === -1 ? PIPE.stages.length - 1 : firstOpen;
    const active = PIPE.stages[ai];
    const activeDone = pipeStateOf(ai) === 'done';
    const local = pipeLocalOf(ai);
    /* One layout read, before any write: the connectors' widths, so the
       dot can be placed by transform and nothing lays out per frame. */
    const widths = Object.create(null);
    PIPE.stages.forEach((x) => { const cn = byId('pipeConn-' + x.id); if (cn) widths[x.id] = cn.parentNode.clientWidth; });

    const fill = byId('pipeFill');
    if (fill) { fill.style.clipPath = 'inset(0 ' + (100 - PIPE.elapsed / PIPE.total * 100) + '% 0 0 round 99px)'; fill.classList.toggle('done', finished); }
    const st = byId('pipeStatus');
    if (st) {
      swapText(st, finished ? 'Found · ' + commas(DRAFT.run.total) : 'Running · ' + active.label);
      st.classList.toggle('done', finished);
    }
    const dot = byId('pipeDot');
    if (dot) dot.classList.toggle('done', finished);

    PIPE.stages.forEach((x, i) => {
      const state = pipeStateOf(i);
      const tile = byId('pipeTile-' + x.id);
      if (tile) {
        tile.className = 'pipe-tile ' + (state === 'running' ? 'live' : state);
        const chk = tile.querySelector('.pipe-check');
        if (state === 'done' && !chk) tile.insertAdjacentHTML('beforeend', '<span class="pipe-check pipe-pop">' + pipeCheck(11) + '</span>');
        if (state !== 'done' && chk) chk.remove();
      }
      const lab = byId('pipeLabel-' + x.id);
      if (lab) lab.classList.toggle('pending', state === 'pending');
      const tm = byId('pipeTime-' + x.id);
      if (tm) {
        tm.textContent = state === 'done' ? pipeFmt(x.duration) : state === 'running' ? pipeFmt(pipeLocalOf(i)) : pipeFmt(0);
        tm.className = 'pipe-stage-time ' + state;
      }
      if (i > 0) {
        const pct = (state === 'pending' ? 0 : pipeProgressOf(i)) * 100;
        const cf = byId('pipeConn-' + x.id);
        if (cf) { cf.style.clipPath = 'inset(0 ' + (100 - pct) + '% 0 0 round 99px)'; cf.classList.toggle('done', state === 'done'); }
        const cd = byId('pipeConnDot-' + x.id);
        if (cd) { cd.hidden = state === 'done' || pct <= 1; cd.style.transform = 'translate(calc(' + ((widths[x.id] || 0) * pct / 100) + 'px - 50%), -50%)'; }
      }
      const row = byId('pipeRow-' + x.id);
      if (row) {
        row.className = 'pipe-row' + (state === 'running' ? ' live' : '');
        const mark = row.querySelector('.pipe-row-mark');
        const want = state === 'done' ? 'done' : state === 'running' ? 'live' : 'idle';
        if (mark && mark.getAttribute('data-state') !== want) {
          mark.setAttribute('data-state', want);
          mark.innerHTML = want === 'done' ? '<span class="pipe-row-check pipe-pop">' + pipeCheck(12) + '</span>'
            : want === 'live' ? '<span class="pipe-spinbox"><svg viewBox="0 0 24 24" width="20" height="20" class="pipe-spin" aria-hidden="true">' +
              '<path d="M12 2.7a9.3 9.3 0 1 0 9.3 9.3" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round"/></svg></span>'
            : '<span class="pipe-row-idle"></span>';
        }
        const rl = row.querySelector('.pipe-row-label');
        if (rl) rl.classList.toggle('pending', state === 'pending');
        const rt = row.querySelector('.pipe-row-time');
        if (rt) { rt.textContent = state === 'done' ? pipeFmt(x.duration) : state === 'running' ? '· · ·' : ''; rt.classList.toggle('done', state === 'done'); }
        /* WHAT THE STEP FOUND, ONCE, WHEN IT IS DONE. The typed log said it
           four lines at a time and then scrolled it away; the number that
           matters is the one the step ends on, and it belongs on the step. */
        const rs = row.querySelector('.pipe-row-sub');
        if (rs) swapText(rs, state === 'done' ? x.logs[x.logs.length - 1].text.replace(/^✓\s*/, '') : '');
      }
    });

    const el = byId('pipeElapsed');
    if (el) el.textContent = pipeFmt(PIPE.elapsed) + ' / ' + pipeFmt(PIPE.total);
    /* ══ A LOADING STATE IS NOT A DESTINATION ══════════════════════════════
       It finished and then waited to be told to show what it had found, with
       "Run again with ZoomInfo" beside the way out — two decisions on a
       screen whose whole purpose was to be over. It ends by opening the list,
       which is where every one of those decisions is available anyway. */
    const foot = byId('pipeFootAct');
    if (foot && foot.getAttribute('data-done') !== String(finished)) {
      foot.setAttribute('data-done', String(finished));
      foot.innerHTML = finished ? '' : '<span class="pipe-chip">' + esc(active.label) + '…</span>';
    }
    if (finished && PIPE && !PIPE.left) {
      PIPE.left = true;
      /* One beat on the finished state so the last tick is seen, then out. */
      setTimeout(() => { if (S.build === 'run') go({ build: 'done' }); }, 420);
    }
  }

  function buildRunning() {
    if (!PIPE) return '<div class="s-home"><p class="b-vfoot s-block-wide">Nothing is running.</p></div>';
    const f = finderOf();
    const kind = buildKind() === 'acc' ? 'Companies' : 'People';
    /* PLACED ON A PAGE, NOT FLOATED IN AN EMPTY ONE. The card sat alone
       under a back link, centred at 640px, with nothing saying what was
       being built. The page keeps the masthead the other builder steps
       have — what this is, its name, the criteria — and the card takes the
       column's full width under it, with its steps and its log side by
       side where there is room. */
    return '<div class="s-home">' +
      '<section class="s-rec-head s-block-wide">' +
        '<span class="s-rec-kind">Looking · ' + esc(kind) + ' · via ' + esc(f.name) + '</span>' +
        '<div class="s-rec-title"><h1 class="s-rec-name">' + esc(buildName()) + '</h1>' +
          '<span class="s-meta-st tone-warn">not saved</span></div>' +
        '<div class="s-rec-facts"><div><span>' + esc(describeTerms(terms())) + '</span></div></div>' +
      '</section>' +
      '<div class="pipe s-block-wide"><div class="pipe-card" id="pipeCard">' +
        '<header class="pipe-head">' +
          '<div class="pipe-head-row">' +
            '<div class="pipe-head-main">' +
              '<h1 class="pipe-title">' + esc(buildName()) + '</h1>' +
              '<span class="pipe-badge">' + esc(kind) + '<span class="pipe-badge-dot">·</span>' + esc(f.name) + '</span>' +
            '</div>' +
            '<div class="pipe-head-state">' +
              '<span class="pipe-status b-swap" id="pipeStatus">Running · ' + esc(PIPE.stages[0].label) + '</span>' +
              '<span class="pipe-live-dot" id="pipeDot" aria-hidden="true"></span>' +
            '</div>' +
          '</div>' +
          '<div class="pipe-track"><div class="pipe-fill" id="pipeFill" style="clip-path:inset(0 100% 0 0 round 99px)"></div></div>' +
        '</header>' +

        '<section class="pipe-panel pipe-rail" aria-label="Stages">' +
          PIPE.stages.map((x, i) =>
            (i > 0
              ? '<div class="pipe-conn-wrap"><div class="pipe-conn">' +
                  '<div class="pipe-conn-fill" id="pipeConn-' + esc(x.id) + '" style="clip-path:inset(0 100% 0 0 round 99px)"></div>' +
                  '<span class="pipe-dot" id="pipeConnDot-' + esc(x.id) + '" hidden></span>' +
                '</div></div>'
              : '') +
            '<div class="pipe-stage">' +
              '<div class="pipe-tile pending" id="pipeTile-' + esc(x.id) + '">' + pipeIcon(x.icon) + '</div>' +
              '<div class="pipe-stage-label pending" id="pipeLabel-' + esc(x.id) + '">' + esc(x.label) + '</div>' +
              '<div class="pipe-stage-time pending" id="pipeTime-' + esc(x.id) + '">0.0s</div>' +
            '</div>').join('') +
        '</section>' +

        '<section class="pipe-panel pipe-rows" aria-label="Steps">' +
          PIPE.stages.map((x) =>
            '<div class="pipe-row" id="pipeRow-' + esc(x.id) + '">' +
              '<span class="pipe-row-mark" data-state="idle"><span class="pipe-row-idle"></span></span>' +
              '<span class="pipe-row-text">' +
                '<span class="pipe-row-label pending">' + esc(x.label) + '</span>' +
                '<span class="pipe-row-sub b-swap"></span>' +
              '</span>' +
              '<span class="pipe-row-time"></span>' +
            '</div>').join('') +
        '</section>' +


        '<footer class="pipe-foot">' +
          '<span class="pipe-elapsed" id="pipeElapsed">0.0s / ' + pipeFmt(PIPE.total) + '</span>' +
          '<span class="pipe-foot-act" id="pipeFootAct" data-done=""></span>' +
        '</footer>' +
      '</div></div>' +
      '<p class="b-vfoot s-block-wide">Nothing is saved until you say so. What comes back is shown first, ' +
        'and you choose what to keep.</p>' +
    '</div>';
  }


  /* ── WHAT CAME BACK, BEFORE IT IS YOURS ──
     The set, what is missing from it, and the two ways out. Nothing is in the
     book until Save. */
  /* ══ WHAT SAVING IT ALSO DECIDES ═══════════════════════════════════════
     Six campaign chips in a row, each of which saved the list AND put it on
     that campaign in one press — a decision made by a control that did not
     look like it was making it, and six of them across the foot with no way
     to see which you had chosen because choosing one ended the page.

     Two menus on two buttons, the shape this build uses everywhere a choice
     is attached to a verb. They stage the decision on the draft, the button
     says what has been staged, and Save is still the one press that commits.

     ASSIGN TAKES SEVERAL. Five hundred leads and one caller is a queue
     nobody finishes; a list is split between the people who will ring it,
     so the menu toggles and stays open until you look away from it. */
  const assignedTo = () => ((DRAFT && DRAFT.assign && DRAFT.assign.length)
    ? DRAFT.assign : [me().id]);
  /* ══ A LIST ON NO CAMPAIGN IS A LIST NOBODY IS WORKING ═════════════════
     Save led and the campaign hung off it as a second thought, so the easy
     press produced a set of five hundred people sitting in a drawer. Putting
     them on a campaign is the point of having found them: it is the primary,
     it opens the menu, and a name in that menu saves and attaches in the one
     press. Saving without one is still there, named for what it leaves you
     with — a draft. */
  const campPickMenu = () => {
    const ks = myCampaigns().filter(campOpen);
    if (!ks.length) return '';
    return '<span class="b-menu-wrap">' +
      '<button class="entry-action em-direct s-build-go b-menu-open" type="button" ' +
        'data-pickopen="campPick" aria-haspopup="menu">Add to campaign</button>' +
      '<div class="b-menu" id="campPick" role="menu" hidden>' +
        '<span class="b-menu-cap">Put them on</span>' +
        '<input class="b-pick-find b-menu-find" type="text" data-picksearch ' +
          'placeholder="Find a campaign" aria-label="Find a campaign" spellcheck="false" />' +
        ks.map((k) =>
          '<button class="b-menu-item" type="button" role="menuitem" ' +
          'data-pickcamp="' + esc(k.id) + '">' +
            '<span class="b-menu-line"><span class="b-menu-name">' + esc(k.name) + '</span>' +
            '<span class="b-menu-sub">' + esc(plural(membersOf(k.id).length, 'person')) +
            ' on it · ' + esc(plural(daysBetween(TODAY_ISO, k.to), 'day')) + ' left</span></span>' +
          '</button>').join('') +
      '</div>' +
    '</span>';
  };
  const assignPickMenu = () => {
    const who = assignedTo();
    /* Untouched, it is the verb; touched, it is the answer. The campaign
       button beside it works the same way, and "You are calling them" read
       as a fact somebody was telling you rather than a control. */
    const set = !!(DRAFT && DRAFT.assign);
    /* Names, while there are few enough to name. "Split between 2" makes
       you open the menu to find out which two. */
    const first = (id) => (id === me().id ? 'you' : actor(id).name.split(' ')[0]);
    const say = !set
      ? 'Assign people'
      : who.length === 1
        ? (who[0] === me().id ? 'You are calling them' : actor(who[0]).name + ' is calling them')
        : who.length <= 3
          ? 'Split between ' + listSay(who.map(first))
          : 'Split between ' + commas(who.length) + ' of you';
    return '<span class="b-menu-wrap">' +
      '<button class="s-inline-btn b-menu-open' + (set ? ' is-set' : '') + '" ' +
        'type="button" data-pickopen="assignPick" aria-haspopup="menu">' +
        esc(say) + '</button>' +
      '<div class="b-menu" id="assignPick" role="menu" hidden>' +
        '<span class="b-menu-cap">Who is calling them</span>' +
        '<input class="b-pick-find b-menu-find" type="text" data-picksearch ' +
          'placeholder="Find a caller" aria-label="Find a caller" spellcheck="false" />' +
        BDRS.map((r) =>
          '<button class="b-menu-item" type="button" role="menuitem" ' +
          'data-pickrep="' + esc(r.id) + '" aria-pressed="' + (who.indexOf(r.id) >= 0) + '">' +
            '<span class="b-menu-tick' + (who.indexOf(r.id) >= 0 ? ' is-on' : '') + '"></span>' +
            faceOf(r.id, 24) +
            '<span class="b-menu-name">' + esc(r.id === me().id ? 'You' : r.name) + '</span>' +
          '</button>').join('') +
      '</div>' +
    '</span>';
  };
  function leaveGate(n) {
    if (!LEAVE) return '';
    return '<section class="s-insight is-lead b-lead-slim b-gate s-block-wide" aria-label="Not saved">' +
      '<div class="s-lead-mark">' +
        '<svg class="s-insight-mark" viewBox="0 0 18 20" width="14" height="14" aria-hidden="true">' +
          '<use href="#aimy-logo-small"/></svg>' +
        '<span class="work-state ws-staged" data-work-state="staged">Awaiting you</span>' +
      '</div>' +
      '<p class="s-lead-deck">This list is not saved. <b>' + esc(plural(n, 'person')) +
        '</b> came back and nothing is working them.</p>' +
      '<p class="b-gate-note">Leaving throws them away. Save it and it is yours; put it on a campaign ' +
        'and they join your queue.</p>' +
      '<div class="s-lead-acts">' +
        '<button class="s-insight-lnk primary" type="button" data-save>Save as draft</button>' +
        '<button class="s-insight-lnk" type="button" data-discard>Discard it</button>' +
        '<button class="s-inline-btn" type="button" data-stay>Stay</button>' +
      '</div>' +
    '</section>';
  }

  function buildDone() {
    const rows = DRAFT.rows || [];
    const mine2 = DRAFT.take.map((id) => DB.byCon[id]).filter(Boolean);
    const f = finderOf();
    const kept = rows.filter((x) => DRAFT.drop.indexOf(x.id) < 0).length;
    const withNum = rows.filter((x) => x.seedPhone < f.phone).length;
    return '<div class="s-home">' +
      leaveGate(kept + mine2.length) +
      '<div class="s-sheet-head s-block-wide"><div class="s-sheet-head-main">' +
        '<div class="s-sheet-kind">Found · not saved yet</div>' +
        '<h1 class="s-sheet-name"><input class="s-build-name" type="text" spellcheck="false" ' +
          'value="' + esc(buildName()) + '" data-auto="' + esc(buildAutoName()) + '" ' +
          'data-bname aria-label="Name this list" /></h1>' +
      '</div></div>' +

      '<p class="s-build-total s-block-wide"><b>' + commas(rows.length + mine2.length) + '</b> came back' +
        (kept < rows.length ? ', <b>' + commas(rows.length - kept) + '</b> unticked' : '') +
        (mine2.length ? ', <b>' + commas(mine2.length) + '</b> of them already yours' : '') +
        '. ' + esc(f.name) + ' found a number for <b>' + commas(withNum) + '</b>.</p>' +

      fillBlock(rows) +

      /* The finder chips moved to the run's finished footer, where "Run
         again with ZoomInfo" is what switching supplier actually means. */

      /* THE FOOT IS KEEP IT OR DO NOT. "Run again with ZoomInfo" and "Change
         the criteria" were two ways to abandon this set for a different one,
         sat between Save and Discard — three of the five controls under a
         list were about not having it. Discard puts you back where the
         criteria are. */
      '<div class="s-build-foot s-block-wide">' +
        campPickMenu() +
        '<button class="s-inline-btn" type="button" data-save>Save as draft</button>' +
        assignPickMenu() +
        '<button class="s-inline-btn" type="button" data-discard>Discard</button>' +
      '</div>' +

      '<section class="s-block s-block-wide" aria-label="What came back">' +
        '<div class="s-camp-list-head"><h2 class="s-block-h">What came back</h2>' +
          '<span class="s-block-say">untick anybody you do not want</span></div>' +
        '<div class="b-vlist" id="netList"></div>' +
        pager(paged(rows), 'row') +
      '</section>' +
    '</div>';
  }

  /* ══ THE ROW A SUPPLIER ACTUALLY RETURNS ════════════════════════════════
     Name, what they do, where and how big, and a way to go and look. The V3
     build's argument, and it is a good one: a row carrying four of the seven
     fields a supplier hands back is a row you scan rather than read, and the
     three it was missing are the three that decide whether this is worth a
     call at all.

     NOT A TABLE, and no header, because every value says what it is. The
     figures sit in a side column so the eye can run down them, and the
     unticked row is how you drop somebody before any of it is saved. */
  function netRow(n) {
    const f = finderOf();
    const hasPhone = n.seedPhone < f.phone;
    const hasMail = n.seedEmail < f.email;
    const dropped = DRAFT && DRAFT.drop.indexOf(n.id) >= 0;
    const slug = String(n.co).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const li = 'linkedin.com/company/' + slug;
    const person = buildKind() === 'con';
    return '<label class="s-pick-tick">' +
        '<input class="s-tick" type="checkbox" data-bdrop="' + esc(n.id) + '"' +
        (dropped ? '' : ' checked') + ' aria-label="Keep ' + esc(person ? n.name : n.co) + '" />' +
      '</label>' +
      '<span class="s-brow-main">' +
        '<span class="s-brow-name">' + esc(person ? n.name : n.co) + '</span>' +
        '<span class="s-brow-desc">' +
          (person ? esc(n.title) + ' at ' + esc(n.co) : esc(n.about)) + '</span>' +
        '<span class="s-brow-facts">' + [
          INDUSTRY[n.industry].label,
          n.city,
          person ? null : 'founded ' + n.founded,
          person ? (hasPhone ? 'has a number' : 'no number') : null,
          person ? (hasMail ? 'has an address' : 'no address') : null,
          n.known ? 'already in your book' : null,
        ].filter(Boolean).map(esc).join(' · ') + '</span>' +
        '<span class="s-brow-links">' +
          '<a class="s-brow-link" href="https://' + esc(n.domain) + '" target="_blank" ' +
            'rel="noopener">' + esc(n.domain) + '</a>' +
          '<a class="s-brow-link" href="https://www.' + esc(li) + '" target="_blank" ' +
            'rel="noopener">' + esc(li) + '</a>' +
        '</span>' +
      '</span>' +
      '<span class="s-brow-side">' +
        '<span class="s-brow-fig">' + commas(n.size) + ' staff</span>' +
        '<span class="s-brow-rev">' +
          (n.rev == null ? 'revenue unknown' : '€' + commas(n.rev) + 'm') + '</span>' +
        '<span class="s-brow-tag">' + esc(n.type) + '</span>' +
      '</span>';
  }

  /* ── WHAT IS MISSING FROM WHAT CAME BACK, AND WHO WOULD FILL IT ──
     Named suppliers with the share each actually fills, so the offer is a
     measurement rather than a promise. Pressing one re-asks that supplier
     and the numbers on the page move. */
  function fillOffers(rows) {
    const f = finderOf();
    /* "The best of the three" is not true while one of the three is not
       answering, and the listing on the builder says which one that is. */
    const ofThem = finderUp().length < FINDERS.length ? 'the ones answering' : 'the three';
    const noPhone = rows.filter((n) => n.seedPhone >= f.phone);
    const noMail = rows.filter((n) => n.seedEmail >= f.email);
    const known = rows.filter((n) => n.known);
    const out = [];
    if (noPhone.length) {
      const better = finderUp().filter((x) => x.phone > f.phone)
        .sort((a, b) => b.phone - a.phone)[0];
      out.push({ n: noPhone.length, act: better ? 'Ask ' + better.name : 'No better source',
        attr: better ? 'data-finder="' + esc(better.k) + '"' : 'disabled',
        say: 'came back without a number, so they cannot be rung. ' +
          (better ? esc(better.name) + ' fills ' + Math.round(better.phone * 100) +
            '% against ' + esc(f.name) + '&rsquo;s ' + Math.round(f.phone * 100) + '%.'
            : esc(f.name) + ' is the best of ' + ofThem + ' for numbers.') });
    }
    if (noMail.length) {
      const better = finderUp().filter((x) => x.email > f.email)
        .sort((a, b) => b.email - a.email)[0];
      out.push({ n: noMail.length, act: better ? 'Ask ' + better.name : 'No better source',
        attr: better ? 'data-finder="' + esc(better.k) + '"' : 'disabled',
        say: verbFor(noMail.length, 'has') + ' no email address. ' + (better
          ? esc(better.name) + ' fills ' + Math.round(better.email * 100) + '% of them.'
          : esc(f.name) + ' is the best of ' + ofThem + ' for addresses.') });
    }
    if (known.length) {
      out.push({ n: known.length, act: 'Leave them out', attr: 'data-bterm="only:new"',
        say: verbFor(known.length, 'is') + ' already in your book, so saving ' +
          (known.length === 1 ? 'them' : 'these') + ' would give you a second copy ' +
          'of somebody you may already have rung.' });
    }
    return out;
  }

  function fillBlock(rows) {
    const offers = fillOffers(rows);
    if (!offers.length) return '';
    return '<div class="s-findings is-panel s-block-wide">' +
      '<p class="s-lead-mark">' +
        '<svg class="s-insight-mark" viewBox="0 0 18 20" aria-hidden="true">' +
          '<use href="#aimy-logo-small"/></svg>AiMY reads it</p>' +
      '<p class="s-findings-say">' + (['', 'One thing', 'Two things', 'Three things', 'Four things'][offers.length] || plural(offers.length, 'thing')) +
        ' about what came back, before you keep it.</p>' +
      '<div class="s-findings-list">' + offers.map((o) =>
        '<div class="s-finding">' +
          '<span class="s-finding-say"><b>' + commas(o.n) + '</b> ' + o.say + '</span>' +
          '<button class="s-finding-go" type="button" ' + o.attr + '>' +
            esc(o.act) + '</button>' +
        '</div>').join('') + '</div>' +
    '</div>';
  }

  /* Saving mints the people, so from here they are ordinary records: the
     queue, the ladder and the call panel cannot tell where they came from. */
  function saveList(campId) {
    const camp = campId ? DB.byCamp[campId] : null;
    const crew = assignedTo();
    const t = terms();
    /* WHAT THE RUN ACTUALLY RETURNED, not the criteria run again. They are
       usually the same set and they are not always: pressing "Bring them in"
       adds people from your own book that no index search would return, and
       recomputing here would have silently dropped every one of them. */
    const found = ((DRAFT && DRAFT.rows) || buildMatched(t).slice(0, 500))
      .filter((n) => !DRAFT || DRAFT.drop.indexOf(n.id) < 0);
    const bring = (DRAFT && DRAFT.take) || [];
    if (!found.length && !bring.length) return;
    const f = finderOf();
    const now = new Date().toISOString();
    const id = 'l' + Date.now().toString(36);
    const madeAcc = [];
    const madeCon = [];
    found.forEach((n, i) => {
      const accId = 'x' + id + '_' + i;
      const a = {
        id: accId, name: n.co, domain: n.domain, industry: n.industry,
        city: n.city, country: n.country, region: CC_REGION[n.country], size: n.size,
      };
      const c = {
        id: 'y' + id + '_' + i, acc: accId, name: n.name, title: n.title,
        phone: n.seedPhone < f.phone ? '+31 6 ' + String(1000000 + Math.floor(n.seedPhone * 8999999)) : null,
        email: n.seedEmail < f.email
          ? n.name.toLowerCase().replace(/[^a-z ]/g, '').split(' ').slice(0, 2).join('.') + '@' + n.domain
          : null,
        /* Dealt out in order, so three callers get a third each rather than
           one of them getting five hundred. */
        camps: camp ? [camp.id] : [], owner: crew[i % crew.length],
        checkpoint: 'not-called', checkpointAt: null,
        attempts: 0, lastCallAt: null, next: null, remember: null, dnc: false,
        fate: SCENARIOS[i % SCENARIOS.length].k,
        enrichedAt: null,
      };
      madeAcc.push(a);
      madeCon.push(c);
    });
    const crit = describeSentence(t, buildKind());
    /* The people you brought in from your own book join the list without
       being minted again — they are already records, and a second copy of
       somebody you have already rung is the worst thing a list can add. */
    const has = madeCon.map((c) => c.id).concat(bring.filter((id2) => DB.byCon[id2]));
    const l = {
      id: id, name: buildName(), kind: 'con', terms: S.bt || '', crit: crit,
      has: has, by: me().id, at: now, for: camp ? camp.id : null, via: f.name,
      found: found.length + bring.length,
    };
    /* The people brought in from your own book are real records; they
       join the campaign by patch, and the undo takes them back off it. */
    const joined = [];
    if (camp) {
      bring.forEach((id2) => {
        const c = DB.byCon[id2];
        if (c && c.camps.indexOf(camp.id) < 0) { patchCon(c, { camps: c.camps.concat([camp.id]) }); joined.push(id2); }
      });
    }
    DB.acc = DB.acc.concat(madeAcc);
    DB.con = DB.con.concat(madeCon);
    DB.list.push(l);
    DELTA.list.push(l);
    DELTA.made = (DELTA.made || []).concat([{ list: id, acc: madeAcc, con: madeCon }]);
    reindex();
    save();
    const bt = S.bt;
    LEAVE = null;
    DRAFT = null;
    goFree(Object.assign(cleared(), { on: 'lists', list: id }));
    toast('Saved ' + plural(has.length, 'person') + ' as "' + l.name + '"' +
      (camp ? ' · on ' + camp.name : '') +
      (crew.length > 1 ? ' · split between ' + commas(crew.length) + ' of you' : ''), () => {
      joined.forEach((id2) => {
        const c = DB.byCon[id2];
        if (c) patchCon(c, { camps: c.camps.filter((x) => x !== camp.id) });
      });
      dropList(id);
      goFree(Object.assign(cleared(), { on: 'lists', build: 'describe', bt: bt }));
    });
  }

  function dropList(id) {
    const i = DB.list.findIndex((x) => x.id === id);
    if (i >= 0) DB.list.splice(i, 1);
    const j = DELTA.list.findIndex((x) => x.id === id);
    if (j >= 0) DELTA.list.splice(j, 1);
    (DELTA.made || []).filter((m) => m.list === id).forEach((m) => {
      const accIds = Object.create(null);
      m.acc.forEach((a) => (accIds[a.id] = 1));
      const conIds = Object.create(null);
      m.con.forEach((c) => (conIds[c.id] = 1));
      DB.acc = DB.acc.filter((a) => !accIds[a.id]);
      DB.con = DB.con.filter((c) => !conIds[c.id]);
    });
    DELTA.made = (DELTA.made || []).filter((m) => m.list !== id);
    reindex();
    save();
  }

  /* The company decision, made once. Mirrors `addListTo` exactly, including
     the undo: a write that cannot be taken back is a write nobody presses. */
  function describeTerms(t) {
    const bits = [];
    BUILD_AXES.forEach((ax) => {
      const v = t[ax.k];
      if (!v || !v.length) return;
      const opts = Object.create(null);
      ax.opts().forEach((o) => (opts[o[0]] = o[1]));
      bits.push(v.map((x) => opts[x] || x).join(' or '));
    });
    if ((t.only || []).indexOf('new') >= 0) bits.push('not already in the book');
    return bits.length ? bits.join(' · ') : 'everyone the sources hold';
  }
  /* ══ A LIST IS NAMED THE WAY THE SEEDED ONES ARE ═══════════════════════
     "Software · 200 to 1,000 · Netherlands · Quality" was the criteria
     string as a title, over the same string as a description. The seeded
     lists say who and where — "QA managers · Software" — and describe
     underneath: "QA managers at software companies, 200 to 1,000 staff". */
  const BAND_NOUN = { support: 'Support leads', quality: 'QA managers', tech: 'Technology leads', ops: 'Operations leads' };
  const countryName = (k) => (COUNTRY_OPTS.filter((o) => o[0] === k)[0] || [k, k])[1];
  const sizeLabel = (k) => (SIZE_BANDS.filter((b) => b.k === k)[0] || { label: k }).label;
  function autoName(t, kind) {
    const who = (t.title || []).map((k) => BAND_NOUN[k] || k).join(' and ');
    const ind = (t.industry || []).map((k) => (INDUSTRY[k] || { label: k }).label).join(' or ');
    const where = (t.where || []).map(countryName).join(' or ');
    const bits = kind === 'acc' ? [ind ? ind + ' companies' : 'Companies', where] : [who || 'People', ind, where];
    const name = bits.filter(Boolean).join(' · ');
    return name.length > 70 ? name.slice(0, 68) + '…' : name;
  }
  function describeSentence(t, kind) {
    const who = (t.title || []).map((k) => BAND_NOUN[k] || k).join(' and ');
    const ind = (t.industry || []).map((k) => (INDUSTRY[k] || { label: k }).label.toLowerCase()).join(' or ');
    /* "in the Netherlands", not "in Netherlands" */
    const where = (t.where || []).map((k) => { const nm = countryName(k); return nm === 'Netherlands' ? 'the Netherlands' : nm; }).join(' or ');
    const size = (t.size || []).map(sizeLabel).join(' or ');
    const head = kind === 'acc'
      ? (ind ? ind.replace(/^./, (c) => c.toUpperCase()) + ' companies' : 'Companies')
      : (who || 'People') + (ind ? ' at ' + ind + ' companies' : '');
    return head + (where ? ' in ' + where : '') + (size ? ', ' + size + ' staff' : '') +
      ((t.only || []).indexOf('new') >= 0 ? ', not already in the book' : '');
  }

  /* ══ ONE CAMPAIGN, AS THE PERSON WORKING IT SEES IT ═════════════════════
     Not the campaign's page — the BDR's page about the campaign. It answers
     one question first: what do I have to do on this today. No funnel, no
     financials, no stage flow, no roster of who owns what. Those are a
     manager's questions and they come back when a manager does.

     ONLY CAMPAIGNS YOU ARE ON. A URL to any other one says so and stops,
     rather than rendering somebody else's work as though it were yours. */
  function campPage() {
    const k = DB.byCamp[S.camp];
    if (!k) {
      return '<div class="s-home"><section class="s-rec-block s-block-wide">' +
        '<h2 class="s-rec-cap">No such campaign</h2>' +
        '<div class="s-rec-body"><p class="s-block-sub">That campaign is not in the book.</p>' +
        backBtn('data-home', 'Back to the briefing') + '</div>' +
      '</section></div>';
    }
    if (!mine(k)) {
      return '<div class="s-home"><section class="s-rec-block s-block-wide">' +
        '<h2 class="s-rec-cap">' + esc(k.name) + '</h2>' +
        '<div class="s-rec-body">' +
          '<p class="s-block-sub">You are not on this campaign, so there is nothing here for you ' +
          'to work. ' + esc(actor(k.owner).name) + ' owns it — ask them to add you.</p>' +
          backBtn('data-home', 'Back to the briefing') +
        '</div>' +
      '</section></div>';
    }

    const all = queue(k.id, 'all');
    const counts = Object.create(null);
    all.forEach((c) => { const b = cutOf(c); counts[b] = (counts[b] || 0) + 1; });
    counts.after = queue(k.id, 'after').length;
    const members = membersOf(k.id);
    const left = daysBetween(TODAY_ISO, k.to);
    const ring = paged(queue(k.id, S.q)).rows.filter((c) => rowVerb(c) === 'Call');

    /* ══ THE ORDER IS THE JOB ══════════════════════════════════════════════
       It opened with the name in a 132px caption gutter — a slot built for
       the word `Calls`, not for `Engineering teams — Banking & finance`,
       which stacked over three lines and read as a label rather than as the
       thing you had opened. Under it: two paragraphs, a button row, ten rung
       counts in one flat run, three AiMY panels, and then the pitch. The
       queue — the entire reason a BDR opens a campaign — was the fifth thing
       on the page and roughly a screen and a half down.

       So: what it is, what you do, THE WORK, then how it is going, then how
       to talk to them, then what has happened. Everything above the queue is
       what you need to start; everything below it is what you need once you
       have. The header uses the shell's own masthead family rather than the
       caption gutter — `.s-rec-head` is what this build had been reaching
       for and reimplementing badly. */
    return '<div class="s-home">' +
      backBtn('data-home', 'Back to the briefing') +

      '<section class="s-rec-head s-block-wide">' +
        '<span class="s-rec-kind">Campaign · ' + esc(INDUSTRY[k.industry].label) + ' · ' +
          esc(REGION[k.region].label) + ' · ' + esc(sayDay(k.from)) + ' to ' + esc(sayDay(k.to)) +
        '</span>' +
        '<div class="s-rec-title">' +
          '<h1 class="s-rec-name">' + esc(k.name) + '</h1>' +
          '<span class="s-meta-st tone-' + (left <= 0 ? 'err' : left < 21 ? 'warn' : 'neutral') + '">' +
            (left > 0 ? esc(plural(left, 'day')) + ' left' : 'closed ' + esc(sayWhen(k.to))) + '</span>' +
        '</div>' +
        campMeta(k) +
        '<div class="s-rec-actions">' +
          (all.length ? '<button class="s-insight-lnk primary" type="button" data-callnextin="' +
            esc(k.id) + '">Call the next one</button>' : '') +
          /* "Call these 15" is about the fifteen on the page of the queue, so
             it sits with the queue and nowhere else — it was here too, and a
             control repeated is a decision repeated. */
          /* THE OTHER HALF OF THE JOB. A campaign runs out of people, and
             the only door to the finder was on a surface two clicks away
             that does not know which campaign you were working. */
          (campOpen(k)
            ? '<button class="b-ghost" type="button" data-bopen="' + esc(k.id) +
              '">Find more for this campaign</button>'
            : '<span class="s-block-sub">It closed ' + esc(sayWhen(k.to)) + '. Nothing on it is dialled now.</span>') +
        '</div>' +
      '</section>' +

      /* WHETHER THE RINGING IS WORKING, BEFORE WHO TO RING. A caller who
         opens straight onto a worklist never learns how the campaign is
         doing, because nobody scrolls past their own queue to find out. */
      campLead(k) +

      /* THE WORK — or, on a closed campaign, what it left. */
      (campOpen(k) ? queueBlock(all, counts) :
        '<section class="s-block s-block-wide" aria-label="To call">' +
          '<div class="s-camp-list-head"><h2 class="s-block-h">To call</h2>' +
            '<span class="s-block-say">nothing — it closed ' + esc(sayWhen(k.to)) + '</span></div>' +
          '<p class="b-vfoot"><b>' + commas(members.filter((c) => c.checkpoint === 'not-called').length) + '</b> of its ' +
            esc(plural(members.length, 'person')) + ' were never rung. Where they stand is below.</p>' +
        '</section>') +

      /* The detail behind the headline, under the doing of it. */
      campStands(k) +

      /* WHAT IS STOPPING IT, BETWEEN HOW IT IS GOING AND WHAT TO SAY.
         The block above says where the campaign stands; the one below says
         the words. Neither said why it is stuck, which is the question
         between them and the one a caller actually carries into the next
         call. */
      blockersBlock(k) +

      /* Context, not a worklist: the last few things that happened here and
         the count of what they are the last few of. A second pager on this
         page would share a page number with the queue above it or need one
         of its own, and both are worse than deciding which of the two lists
         is the reason you came. */
      '<section class="s-block s-block-wide" aria-label="What happened">' +
        '<div class="s-camp-list-head"><h2 class="s-block-h">What happened</h2></div>' +
        feedBlock(campFeedItems(k.id)) +
      '</section>' +
    '</div>';
  }

  /* ══ WHAT A CAMPAIGN IS ════════════════════════════════════════════════
     The masthead carried one unlabelled sentence and two counts: the goal
     with nothing saying it was the goal, how many people are on it, and how
     many of those are yours to ring. Both counts were already stated below
     — the roster count heads Where it stands, and the ringable count sits
     under To call — so the masthead was spending its whole width repeating
     the page while five things a caller has to know before dialling were
     nowhere on it at all.

     Three parts carry it, because a caller asks three questions in this
     order and no other: what am I trying to get out of this, what am I
     selling, and whose is it. Then who to ask reception for, and who else
     is ringing these people. */
  const cmPart = (cap, body) =>
    '<div class="b-cmeta-part">' +
      '<h2 class="b-cmeta-cap">' + esc(cap) + '</h2>' +
      '<div class="b-cmeta-say">' + body + '</div>' +
    '</div>';

  /* ══ THE TEAM, AS PEOPLE ═══════════════════════════════════════════════
     "owned by Karim Fouad · with Sally Tarek and Omar Fathy" was a list of
     names in the kind line, above the campaign's own name, in the slot that
     says what KIND of record this is. They are the people ringing the same
     two hundred numbers as you, which is worth a face each.

     A face, a name, a job. It said what each of them is FOR on this
     campaign — owns it, calling — which is a sentence about the campaign
     dressed as a fact about a person, and the same three words on every
     campaign they are on. */
  const JOB = { 'sales-manager': 'Sales manager', bdr: 'BDR' };
  function teamRow(k) {
    const ids = [k.owner].concat(k.crew.filter((id) => id !== k.owner));
    return '<div class="b-team">' +
      '<span class="b-cmeta-cap b-team-cap">The team</span>' +
      ids.map((id) => {
        const you = id === me().id;
        return '<div class="b-mate">' + faceOf(id, 32) +
          '<span class="b-mate-t">' +
            '<span class="b-mate-name">' + esc(you ? 'You' : actor(id).name) + '</span>' +
            '<span class="b-mate-role">' + esc((REP[id] && JOB[REP[id].fn]) || 'On the crew') + '</span>' +
          '</span>' +
        '</div>';
      }).join('') +
    '</div>';
  }

  function campMeta(k) {
    const sells = k.sells.map((x) => SELL[x]).filter(Boolean);
    const cl = k.client ? CLIENT[k.client] : null;
    return '<div class="b-cmeta">' +
      cmPart('The goal', '<p class="b-cmeta-p">' + esc(k.goal) + '.</p>') +
      /* The name and which kind it is. The blurb underneath was the line a
         caller says out loud, and it is said out loud in What to say — here
         it was a second copy of it in the smallest type on the page. */
      cmPart('What we sell them', sells.map((x) =>
        '<p class="b-cmeta-p"><b>' + esc(x.name) + '</b> ' +
          '<span class="tag tag-neutral">' + esc(x.kind || 'offer') + '</span></p>').join('')) +
      /* The name, and nothing after it. What the engagement is does not
         change a single thing a caller does in the next eight minutes. */
      cmPart('Client', '<p class="b-cmeta-p"><b>' +
        esc(cl ? cl.name : 'Our own book') + '</b></p>') +
    '</div>' +
    teamRow(k);
  }

  /* ══ WHERE A CAMPAIGN IS AGAINST WHAT IT IS FOR ═══════════════════════
     Read once and used by the lead block, the figures and the readings, so
     three parts of one page cannot report three different positions.

     The goal's own verb picks the rung: a campaign to book meetings is
     measured at `meeting-set`, one to open conversations at `answered`.
     Counting everyone ever reached against a meetings goal is how this
     page once reported 35 of 22 with 111 people still unrung. */
  function campStand(k) {
    const members = membersOf(k.id);
    const n = rungCounts(members);
    /* Read off the field. This ran a regular expression over the goal
       sentence to find its own target, which made the number a consequence
       of the wording — "Replace 5 manual support desks in Belgium" measured
       itself at 5 meetings, and any rewrite of the prose moved the bar. */
    const target = k.target ? k.target.n : 0;
    const wantsMeeting = !k.target || k.target.noun === 'meeting';
    const at = wantsMeeting ? 'meeting-set' : 'answered';
    const done = members.filter((c) => rank(c.checkpoint) >= rank(at)).length;
    const left = daysBetween(TODAY_ISO, k.to);
    const need = Math.max(0, target - done);
    return {
      members: members, n: n, target: target, done: done, need: need, left: left,
      noun: k.target ? k.target.noun : 'meeting',
      /* Whole weeks, rounded up, because half a meeting a week is not a
         rate anybody can work to. */
      perWeek: left > 0 ? Math.ceil(need / Math.max(1, left / 7)) : 0,
      reached: members.filter((c) => rank(c.checkpoint) >= rank('answered')).length,
    };
  }

  /* ══ THE ONE THING THE PAGE IS ABOUT, BEFORE THE WORK ══════════════════
     A campaign page opened straight onto a queue, which tells a caller who
     to ring and nothing about whether the ringing is working. The numbers
     that answer that were below the queue, in a flat run of ten counts, and
     nobody scrolls past their own worklist to find out how they are doing.

     So the figure leads, the consequence follows it at the deck step, and
     the actions are underneath — the shell's own lead-insight anatomy, the
     one it uses wherever a page has a single finding worth announcing.

     THE CONSEQUENCE IS ARITHMETIC, NOT ENCOURAGEMENT. "You need 3 a week"
     is a rate somebody can hold themselves to; "good progress" is a mood.
     Where the sum has nothing to say — past the goal, or past the end date
     — it says that instead rather than dressing it up. */
  function campLead(k) {
    const st = campStand(k);
    const all = queue(k.id, 'all');
    /* ══ A BUTTON COUNTS WHAT IT OPENS ═════════════════════════════════════
       These read the rung tally at first — 14 callbacks, 102 never rung — and
       the cuts they open show 9 and 58, because the queue drops anyone whose
       follow-up is still in the future and anyone without a number. A door
       labelled with a different number from the room behind it is worse than
       an unlabelled door: you arrive believing something has gone missing. */
    const fresh = queue(k.id, 'not-called').length;
    const back = queue(k.id, 'callback').length;

    /* ══ YOUR OWN FOOTPRINT, FIRST ═══════════════════════════════════════
       The same "18 of 22, 1 a week" whether you had made two hundred calls
       on this campaign or none. A caller opening it for the first time does
       not need the rate; they need to know they have not started and where
       the pitch is. And a caller back from a run needs to see the run. */
    const meId = me().id;
    const myCalls = DB.touch.filter((t) => t.camp === k.id && t.by === meId && OUTCOME[t.outcome]);
    const today = myCalls.filter((t) => t.at.slice(0, 10) === TODAY_ISO);
    const fresh0 = !myCalls.length;
    const todayLine = today.length
      ? '<p class="b-lead-today">Today: <b>' + plural(today.length, 'call') + '</b>' +
        ' · <b>' + today.filter((t) => t.outcome === 'reached').length + '</b> got through' +
        ' · <b>' + today.filter((t) => t.moved && t.moved[1] === 'meeting-set').length +
        '</b> meetings set.</p>'
      : '';

    const deck = fresh0
      ? 'You have not rung anyone on this campaign yet. Call the next one — what to say comes up with it.'
      : !st.target
      ? 'This one has no number in its goal, so there is nothing to measure it against.'
      : !st.need
        ? 'It is past its goal. Everything from here is on top.'
        : st.left <= 0
          ? 'It is past its end date and <b>' + commas(st.need) + '</b> short.'
          : '<b>' + commas(st.perWeek) + ' a week</b> lands the other ' +
            commas(st.need) + ' before it closes.';

    return '<section class="s-insight is-lead s-block-wide" aria-label="Where this campaign is">' +
      '<div class="s-lead-mark">' +
        '<svg class="s-insight-mark" viewBox="0 0 18 20" width="14" height="14" aria-hidden="true">' +
          '<use href="#aimy-logo-small"/></svg>' +
        '<span class="work-state ws-detected" data-work-state="detected">Read off the record</span>' +
      '</div>' +
      '<div class="s-lead-line">' +
        '<span class="s-lead-n">' + commas(st.done) + '</span>' +
        '<span class="s-lead-say">' + (st.target
          ? 'of the <span class="s-lead-of">' + commas(st.target) + '</span> ' +
            esc(st.noun) + 's this campaign is for' +
            (st.left > 0 ? ', with ' + plural(st.left, 'day') + ' to go.'
                         : ', and it is past its end date.')
          : esc(st.noun) + 's so far, out of ' + plural(st.members.length, 'person') +
            ' on it.') + '</span>' +
      '</div>' +
      '<p class="s-lead-deck">' + deck + '</p>' +
      todayLine +
      '<div class="s-lead-acts">' +
        /* Call the next one is sixty pixels up, in the header. Here the
           doors are the cuts, and on a first visit the pitch. */

        (back && campOpen(k) ? '<button class="s-insight-lnk" type="button" data-q="callback">' +
          'Work the ' + commas(back) + ' callbacks</button>' : '') +
        (fresh && campOpen(k) ? '<button class="s-insight-lnk" type="button" data-q="not-called">' +
          'Show the ' + commas(fresh) + ' never rung</button>' : '') +
        (all.length || !campOpen(k) ? '' :
          '<button class="s-insight-lnk" type="button" data-bopen="' + esc(k.id) +
          '">Nobody left to ring — find more</button>') +
      '</div>' +
    '</section>';
  }

  /* ══ WHAT AiMY MAKES OF ONE CAMPAIGN ═══════════════════════════════════
     The card gets one line, because a grid of fourteen cards each holding
     four readings is a wall. The page can carry more — but only readings
     the card cannot give you, and only ones that are read off the corpus
     with the count in them.

     Every one states its basis and most carry a door, because a reading
     you cannot act on from where you are reading it is a reading you have
     to remember. Capped at three: a page of insights is a page nobody
     finishes, and the fourth-best thing AiMY noticed is not worth the
     reader deciding which three of five to trust.

     AGAINST THE GOAL, FIRST. Every campaign goal in this book opens with a
     number — "Open 20 conversations in Central Europe" — so the goal is
     countable, and where it stands is the question the campaign exists to
     answer. Read out of the sentence rather than stored beside it, so a
     goal that is edited cannot leave a target behind that disagrees. */
  function campReadings(k) {
    const here = DB.touch.filter((t) => t.camp === k.id);
    const members = membersOf(k.id);
    const left = daysBetween(TODAY_ISO, k.to);
    const out = [];

    /* The goal is the lead block's figure and deck, sixty pixels under the
       masthead. Saying it again here made the first reading under the bars a
       copy of the first thing on the page. */
    /* The top objection was read out here, once, with the agreed answer
       appended. What is in the way now counts every one of them, pairs
       each with the answer and the document that carries it, and says so
       when there is no agreed answer at all — which this could not. */

    /* The hour this campaign gets through, which is not the book's hour:
       a campaign into one region rings a different clock. */
    const h = hourOf(here);
    if (h) {
      out.push({
        text: 'It gets through most around <b>' + h.hour + ':00</b> — ' + h.pct +
          '% of the ' + commas(h.n) + ' calls made in that hour.',
        from: 'every call on this campaign',
      });
    }

    /* People on the ladder that nobody has touched in a fortnight. Not the
       never-rung — those are on the numbers line above — but the ones that
       were being worked and stopped, which no count on this page shows. */
    const cold = members.filter((c) => !isExit(c.checkpoint) &&
      c.checkpoint !== 'not-called' && c.lastCallAt &&
      daysBetween(c.lastCallAt.slice(0, 10), TODAY_ISO) >= 14);
    if (cold.length) {
      out.push({
        /* STATED, NOT LINKED. The stale ones sit across three rungs, and the
           cuts on this page are the rungs — every callable person is in
           exactly one, which is what makes the chips add up to All. A door
           here would have to point at one rung and quietly lose the rest, or
           add an overlapping cut and break the arithmetic under it. */
        text: '<b>' + commas(cold.length) + '</b> were being worked and have not been ' +
          'rung in a fortnight. They are spread across the cuts below.',
        from: 'the last call on each of their records',
      });
    }

    return out.slice(0, 3);
  }

  /* The best hour over any set of calls. `bestHour` is this over the whole
     book and caches; this one is scoped and does not, because the scope
     changes with the page. */
  function hourOf(list) {
    const hours = Object.create(null);
    list.forEach((t) => {
      const h = new Date(t.at).getHours();
      if (h < 7 || h > 19) return;
      const b = hours[h] || (hours[h] = { n: 0, got: 0 });
      b.n++;
      if (t.outcome === 'reached') b.got++;
    });
    const best = Object.keys(hours).filter((x) => hours[x].n >= 20)
      .sort((x, y) => hours[y].got / hours[y].n - hours[x].got / hours[x].n)[0];
    if (!best) return null;
    return { hour: Number(best), n: hours[best].n,
      pct: Math.round((hours[best].got / hours[best].n) * 100) };
  }

  /* Each reading is a block, and one with somewhere to go carries the door
     rather than describing where you would find it. */
  /* ══ ONE QUIET BLOCK, NOT THREE ANNOUNCEMENTS ══════════════════════════
     Three full-width accent panels under the funnel, on a page that opens
     with a fourth: the page said "this matters most" four times and meant
     it once. The shell's quote register — a raised surface, one mark, no
     accent — is built for exactly this: AiMY's reading OF the bars above,
     not a second announcement competing with the first. */
  /* ══ ONE BLOCK READS THE BARS ══════════════════════════════════════════
     Two paragraphs sat loose between the funnel and the block whose whole
     job is to say what the funnel means — who left the ladder, and what the
     managers are holding. Both are readings of the bars above them, both
     name a figure and say what it amounts to, and they were the only two
     sentences on the page in nobody's voice. They are readings now, and they
     lead, because they are read off the thing directly above. */
  function campAimy(k) {
    const st = campStand(k);
    const rs = [];
    const exits = exitsSay(st.members);
    if (exits) rs.push({ text: exits, from: 'where each of them stopped' });
    const deals = dealsSay(k);
    if (deals) rs.push({ text: deals, from: 'the leads you handed over' });
    campReadings(k).forEach((r) => rs.push(r));
    if (!rs.length) return '';
    return '<div class="s-insight is-quote b-readings">' +
      '<div class="s-lead-mark">' +
        '<svg class="s-insight-mark" viewBox="0 0 18 20" width="14" height="14" aria-hidden="true">' +
          '<use href="#aimy-logo-small"/></svg>Read off the bars above' +
      '</div>' +
      '<ul class="b-reading-list">' + rs.slice(0, 4).map((r) =>
        '<li class="b-reading">' + r.text +
          '<span class="b-aimy-from">' + esc(r.from) + '</span></li>').join('') +
      '</ul>' +
    '</div>';
  }

  /* Where the campaign's people stand. Informational: these are rungs, and
     the queue below cuts by what is OWED, not by rung — so a door here would
     open a filter that does not exist. Stated, not linked, rather than
     pretending to be pressable. */
  /* ══ WHERE IT STANDS, AS A NARROWING ══════════════════════════════════
     Ten counts in one flat run — `81 not called · 42 no answer · 17
     callback · 7 answered · 9 meeting set · 1 interested · 4 handed over ·
     13 declined · 6 wrong number · 2 do not call` — is a sentence you have
     to read word by word to find anything in, and it hid the one shape a
     campaign has: it narrows. Two hundred people rung, forty answered, nine
     with a meeting. The narrowing IS the finding.

     So four figures for what a BDR acts on, then the ladder as bars drawn
     against the whole roster — every bar against the same total, or the
     narrowing disappears — and the exits under it, because a lead does not
     climb to `declined`, it leaves. */
  /* ══ THE LADDER AS A NARROWING ═════════════════════════════════════════
     Every bar is drawn against the WHOLE roster rather than against the
     largest rung, because the narrowing is the finding: two hundred rung,
     forty answered, nine with a meeting. Scaled to the biggest bar instead,
     every campaign looks the same shape and the one fact this block exists
     to show disappears.

     Shared with the company page, which asks the same question of seven
     people that a campaign asks of two hundred. Two components for one
     question is two things to learn and two places for them to drift. */
  /* WRITTEN OUT, NOT COMPOSED. `'tone-' + x.tone` is invisible to the audit,
     which searches the source for the class names this build draws — and it
     said so: three rules defined and rendered nowhere, on rules that were
     rendered on every bar of every funnel. A class whose name only exists
     while the page is running is a class the audit cannot pair with its rule,
     and the rule it cannot pair is the one that silently stops applying. */
  const FN_TONE = { ok: 'tone-ok', warn: 'tone-warn', neutral: 'tone-neutral',
    err: 'tone-warn' };

  /* ══ A FUNNEL SHOWS WHAT IT COSTS TO GET TO THE NEXT RUNG ═════════════
     It drew how many people STAND on each rung today, scaled to the
     biggest — which says where the book is piled up and nothing about
     whether the ringing works. A funnel answers the other question: of the
     people who got this far, how many got one further. So each row counts
     everybody who ever reached that rung (their history says so, whatever
     happened after), the bar is that share of the campaign, and the figure
     beside it is the share of the row above — the drop, which is the whole
     reason to look. Pipedrive and Zoho both draw it this way. */
  const FUNNEL_STEPS = ['not-called', 'no-answer', 'answered', 'meeting-set', 'showed-up', 'interested', 'handed-over'];
  function everAt(members) {
    const out = Object.create(null);
    FUNNEL_STEPS.forEach((k) => (out[k] = 0));
    members.forEach((c) => {
      let top = isExit(c.checkpoint) ? 0 : rank(c.checkpoint);
      (DB.touchesOf[c.id] || []).forEach((id) => {
        const t = TOUCH[id];
        if (t && t.moved && !isExit(t.moved[1])) top = Math.max(top, rank(t.moved[1]));
      });
      FUNNEL_STEPS.forEach((k) => { if (top >= rank(k)) out[k]++; });
    });
    return out;
  }
  /* Who is off the ladder, as a sentence. It was welded to the funnel and
     printed underneath it, which is why the campaign page had two loose
     paragraphs sitting between the bars and the block that reads them. */
  function exitsSay(members) {
    const n2 = rungCounts(members);
    const gone = EXITS.filter((x) => n2[x.k]);
    const goneN = gone.reduce((t, x) => t + n2[x.k], 0);
    if (!goneN) return '';
    return '<b>' + commas(goneN) + '</b> ' + esc(verbFor(goneN, 'person')) +
      ' left the ladder — ' + gone.map((x) =>
        commas(n2[x.k]) + ' ' + esc(x.label.toLowerCase())).join(', ') + '.';
  }

  function funnelOf(members, topLabel, held) {
    const ever = everAt(members);
    const total = members.length || 1;
    let prev = null;
    const rows = FUNNEL_STEPS.map((k) => {
      const n = ever[k];
      if (!n && k !== 'not-called') return '';
      const rg = RUNG[k];
      const pct = Math.max(1, Math.round((n / total) * 100));
      const conv = prev == null ? null : (prev ? Math.round((n / prev) * 100) : 0);
      prev = n;
      return '<div class="b-fn-row">' +
        '<span class="b-fn-name">' + esc(k === 'not-called' ? (topLabel || 'On the campaign') : rg.label) + '</span>' +
        '<span class="b-fn-bar"><span class="b-fn-fill ' + (FN_TONE[rg.tone] || 'tone-neutral') + '" ' +
          'style="width:' + pct + '%"></span></span>' +
        '<span class="b-fn-n">' + commas(n) + '</span>' +
        '<span class="b-fn-conv">' + (conv == null ? '' : conv + '%') + '</span>' +
      '</div>';
    }).join('');
    return '<div class="b-funnel">' +
        '<div class="b-fn-head"><span class="b-fn-name">Got this far</span><span></span>' +
          '<span class="b-fn-n">people</span><span class="b-fn-conv">of the one above</span></div>' +
        rows + '</div>' +
      /* The campaign page holds this back and reads it out in the block
         under the bars; the company page has no such block and keeps it. */
      (held ? '' : (exitsSay(members)
        ? '<p class="b-tally-out">' + exitsSay(members) + '</p>' : ''));
  }

  /* ══ WITH THE MANAGERS ═════════════════════════════════════════════════
     The handed-over leads, by whoever is managing each one and how far the
     director has taken it. Named per person now that a hand-over chooses a
     manager, so two managers on one campaign read as two. */
  function dealsSay(k) {
    const handed = membersOf(k.id).filter((c) => c.checkpoint === 'handed-over');
    if (!handed.length) return '';
    const by = Object.create(null);
    handed.forEach((c) => {
      const m = directorOf(c);
      const g = by[m.id] || (by[m.id] = { name: m.name, at: Object.create(null), won: 0, lost: 0, waiting: 0, n: 0 });
      g.n++;
      const ph = phasesOf(c);
      const last = ph[ph.length - 1];
      if (!last) { g.waiting++; return; }
      if (last.decision === 'won') { g.won++; return; }
      if (last.decision === 'lost') { g.lost++; return; }
      g.at[last.phase] = (g.at[last.phase] || 0) + 1;
    });
    const say = Object.keys(by).map((id) => {
      const g = by[id];
      const bits = [];
      if (g.waiting) bits.push(commas(g.waiting) + ' waiting for discovery');
      PHASES.forEach((x) => { if (g.at[x.k]) bits.push(commas(g.at[x.k]) + ' past ' + x.label.toLowerCase().replace(' meeting', '')); });
      if (g.won) bits.push('<b>' + commas(g.won) + ' signed</b>');
      if (g.lost) bits.push(commas(g.lost) + ' said no at resolution');
      return esc(g.name) + ': ' + esc(plural(g.n, 'person')) + ' — ' + bits.join(', ');
    });
    return 'With ' + say.join('; with ') + '.';
  }

  function campStands(k) {
    const st = campStand(k);
    const n = st.n;
    /* ══ THE TILE IS THE DOOR ═══════════════════════════════════════════
       Two of the four figures map onto a cut of the queue. The tile shows
       the roster count — the fact — and its sub-line says how many of them
       you can ring now, which is the number on the other side of the door.
       So the door is labelled with the room behind it. */
    const fig = (cap, val, sub, tone, q) => {
      const inner =
        '<span class="s-af-cap">' + esc(cap) + '</span>' +
        '<span class="s-af-val' + (tone ? ' tone-' + tone : '') + '" data-fig="stand:' + esc(cap) + '">' + commas(val) + '</span>' +
        '<span class="s-af-sub">' + esc(sub) + '</span>';
      return q
        ? '<button class="s-af b-af-door" type="button" data-q="' + esc(q) + '">' + inner + '</button>'
        : '<div class="s-af">' + inner + '</div>';
    };
    const ringNew = queue(k.id, 'not-called').length;
    const ringNo = queue(k.id, 'no-answer').length;


    return '<section class="s-block s-block-wide" aria-label="Where it stands">' +
      '<div class="s-camp-list-head"><h2 class="s-block-h">Where it stands</h2>' +
        '<span class="s-block-say">' + esc(plural(st.members.length, 'person')) +
        ' on this campaign</span></div>' +

      '<div class="s-afs">' +
        fig('Never rung', n['not-called'] || 0,
          ringNew ? commas(ringNew) + ' of them you can ring now →' : 'none of them callable now',
          null, ringNew ? 'not-called' : null) +
        fig('Rung, no answer', n['no-answer'] || 0,
          ringNo ? commas(ringNo) + ' of them you can ring now →' : 'none of them callable now',
          null, ringNo ? 'no-answer' : null) +
        fig('Reached', st.reached, 'you got them on the phone', 'ok') +
        fig('Meetings set', (n['meeting-set'] || 0) + (n['showed-up'] || 0) +
          (n.interested || 0) + (n['handed-over'] || 0), 'got to a meeting, or past it', 'ok') +
      '</div>' +

      funnelOf(st.members, null, true) +
      campAimy(k) +
    '</section>';
  }


  /* ══ WHAT IS IN THE WAY ════════════════════════════════════════════════
     The page could say where a campaign stood and what to say on it, and
     nothing at all about why it was stuck. That is the middle of the story:
     a caller comes off a run of calls knowing the reason they keep hearing,
     and the campaign was the one place that could count it and could not.

     Two kinds of obstacle, and they are not the same kind of thing. What
     they SAY — counted off the calls, not scripted, so it is what this
     audience actually raises rather than what somebody expected them to.
     And what stops the call happening at all: no number, reception, rung
     four times and never picked up.

     Every one is paired with what beats it. For a spoken objection that is
     the answer the team agreed and the document that carries it — and where
     no answer was ever agreed it says so, because a campaign that lists an
     objection and no answer has told a caller what is coming and nothing
     else. For a blocked call it is the move: the name to ask reception for,
     the hour this campaign gets through, the rule about the fifth attempt.

     THIS IS NOT WHAT TO SAY. That block below is the script — what to
     expect and the agreed line. This one is the measurement: what actually
     came back, how often, and whether we have anything for it. */
  /* Which document answers which reason. "We do not offer that" is not
     met by a case study — it is met by the page that says what we do. */
  const DOC_FOR = { pricing: 'pricing', feature: 'deck', service: 'faq', timing: 'case', other: 'faq' };
  function blockersOf(k) {
    const here = DB.touch.filter((t) => t.camp === k.id && OUTCOME[t.outcome]);
    const members = membersOf(k.id);
    const agreed = Object.create(null);
    k.objections.forEach((o) => (agreed[o.k] = o.say));
    const said = Object.create(null);
    let gave = 0;
    here.forEach((t) => (t.objections || []).forEach((o) => { said[o] = (said[o] || 0) + 1; gave++; }));
    const spoken = Object.keys(said).sort((a, b) => said[b] - said[a]).map((kk) => {
      const want = DOC_FOR[kk];
      let doc = -1;
      k.resources.forEach((r, i) => { if (doc < 0 && r.kind === want) doc = i; });
      return {
        n: said[kk], of: gave, unit: 'reason',
        name: (OBJECTION[kk] || {}).label || kk,
        sub: (OBJECTION[kk] || {}).blurb || '',
        beats: agreed[kk] ||
          'Say the same thing to it twice and tell ' + actor(k.owner).name + ' what worked.',
        gap: !agreed[kk],
        doc: doc,
      };
    });

    /* What stops the call happening. Counted against different totals — a
       roster for the first, the calls for the rest — so each says its own. */
    const stops = [];
    const noNum = members.filter((c) => !c.phone && !c.dnc).length;
    if (noNum) {
      stops.push({
        n: noNum, of: members.length, unit: 'person', name: 'No number on the record',
        sub: 'They are on the campaign and there is nothing to dial.',
        beats: 'AiMY finds numbers overnight; the finder brings people who already have one.',
        door: { attr: 'data-bopen="' + esc(k.id) + '"', say: 'Find more for this campaign' },
      });
    }
    const gate = here.filter((t) => t.outcome === 'gatekeeper').length;
    if (gate) {
      stops.push({
        n: gate, of: here.length, unit: 'call', name: 'Stopped at reception',
        sub: 'Somebody answered and it was not them.',
        beats: 'Ask for ' + (k.persona ? k.persona.who : 'them by the job') +
          ' by the job — reception puts a name through to nobody.',
      });
    }
    const stuck = members.filter((c) => c.checkpoint === 'no-answer' && c.attempts >= TOUCH_RULE).length;
    if (stuck) {
      const h = hourOf(here);
      stops.push({
        n: stuck, of: members.length, unit: 'person', name: 'Rung four times, never picked up',
        sub: 'Past the fourth attempt a fifth is worth less than a colleague.',
        beats: (h ? 'This campaign gets through around ' + h.hour + ':00. ' : '') +
          'Try that hour, or open their company and ring somebody else there.',
        door: { attr: 'data-q="no-answer"', say: 'Show the no-answers' },
      });
    }
    const passed = queue(k.id, 'after').length;
    if (passed) {
      stops.push({
        n: passed, of: members.length, unit: 'person', name: 'Meeting passed, nothing logged',
        sub: 'The meeting was the whole point and nobody said what happened.',
        beats: 'Ring them and settle it — showed up, did not show, or interested.',
        door: { attr: 'data-q="after"', say: 'Work the ' + commas(passed) },
      });
    }
    stops.sort((a, b) => b.n - a.n);
    /* Under four reasons is a handful of anecdotes, and three rows each
       reading "1 of 3" is noise wearing the clothes of a finding. */
    return {
      spoken: gave >= 4 ? spoken.slice(0, 2) : [],
      thin: gave && gave < 4 ? gave : 0,
      stops: stops.slice(0, 2), calls: here.length, gave: gave,
    };
  }

  function blockersBlock(k) {
    const b = blockersOf(k);
    const rows = b.stops.concat(b.spoken);
    if (!rows.length) return '';
    /* ══ ONE BLOCK, ONE LINE EACH ══════════════════════════════════════
       It drew five findings, each with a figure at 24px, a bar, a blurb, a
       caption over the remedy and a chip under it — five sections wearing
       the clothes of a page. A caller reads this between calls, and what
       they need out of it is which obstacle is biggest and what to do about
       it. So: a sentence naming the worst of it and the one nobody has an
       answer for, then a line each — the count, what it is, what beats it.

       The bars are gone. Three of them measured against three different
       totals, which is the one thing a bar cannot do; the proportion is
       said in words beside each name instead. */
    const worst = rows[0];
    const gap = b.spoken.filter((x) => x.gap)[0];
    const lead = '<b>' + esc(worst.name) + '</b> is the most of it — ' +
      commas(worst.n) + ' of ' + esc(plural(worst.of, worst.unit)) + '.' +
      (gap
        ? ' Of the ' + esc(plural(b.gave, 'reason')) + ' anybody gave here, <b class="tone-warn">' +
          esc(gap.name.toLowerCase()) + '</b> is the one nobody agreed an answer to.'
        : b.spoken.length
          ? ' Every reason they give has an answer this campaign already agreed.'
          : '');
    return '<section class="s-block s-block-wide" aria-label="What is in the way">' +
      '<div class="s-camp-list-head"><h2 class="s-block-h">What is in the way</h2>' +
        '<span class="s-block-say">read off ' + esc(plural(b.calls, 'call')) +
        ' on this campaign</span></div>' +
      '<p class="b-way-lead">' + lead + '</p>' +
      '<div class="b-ways">' + rows.map((x) =>
        '<div class="b-way">' +
          '<span class="b-way-n' + (x.gap ? ' tone-warn' : '') + '">' + commas(x.n) + '</span>' +
          '<span class="b-way-what">' +
            '<span class="b-way-name">' + esc(x.name) + '</span>' +
            '<span class="b-way-of">of ' + esc(plural(x.of, x.unit)) + '</span>' +
          '</span>' +
          '<span class="b-way-beat">' +
            (x.gap ? '<b class="tone-warn">Nothing agreed.</b> ' : '') + esc(x.beats) +
            (x.door
              ? ' <button class="s-inline-btn" type="button" ' + x.door.attr + '>' +
                esc(x.door.say) + '</button>'
              : '') +
            (x.doc != null && x.doc >= 0 ? ' ' + docChip(k.id, x.doc, k.resources[x.doc]) : '') +
          '</span>' +
        '</div>').join('') + '</div>' +
      (!b.spoken.length && b.thin
        ? '<p class="b-way-thin">Only ' + esc(plural(b.thin, 'person')) + ' here ' +
          esc(verbFor(b.thin, 'has')) + ' given a reason so far — too few to call it a ' +
          'pattern. The answers this campaign agreed are in What to say below.</p>'
        : '') +
    '</section>';
  }

  /* ══ WHAT TO SAY MOVED TO WHERE IT IS SAID ═════════════════════════════
     A block on the campaign page held the opener, what comes back at you
     with the agreed answer, what we sell and what you can send. All of it is
     true and none of it was where it is used: it is preparation for one
     call, read in the ten seconds before that call connects, and it sat on a
     page you leave to make the call.

     It is in the brief now — `callPrep`, the thing that opens as the phone
     starts ringing — and the campaign page keeps what a campaign page is
     for, which is how this one is going and what is stopping it. */
  /* ══ ONE COMPANY ════════════════════════════════════════════════════════
     The surface this build did not have. An account was a phrase on
     somebody's record — `QA Manager at Zenport Engineering · Manufacturing
     · 260 staff` — and nothing you could open, so the four people at
     Zenport were four unrelated rows in a queue that ranks individuals.
     Ringing one of them told you nothing about the other three, and two
     BDRs could work the same company for a fortnight without either
     surface saying so.

     THE FACTS ARE RANKED, which is V3's argument and it holds here: size
     is what every ICP is written against, so it leads; what and where is
     the next filter; how the record reached us is a fact about our book
     and not about the company, so it goes last and quietest. Six facts at
     one weight is a block you have to read word by word. */
  /* ══ ONE COMPANY, AS A JOURNEY ══════════════════════════════════════════
     You come here from a person's record — "2 others at Velvik Institute" —
     or from AiMY's door when a number is dead, with one question: who else
     here can I ring, and has anyone here already been reached. The page
     answered it with the name in a 132px caption slot, the one thing it
     knows that nothing else does at the bottom of the header, and a row of
     campaign chips above the people they act on.

     Now: who (the masthead, with the furthest anyone here has got as the
     chip beside the name), what AiMY makes of the company with a door, the
     people — the ones who have picked up first — then where they all stand,
     then what has been said into the company by anyone, by day. */
  function accPage() {
    const a = DB.byAcc[S.acc];
    if (!a) {
      return '<div class="s-home"><section class="s-rec-block s-block-wide">' +
        '<h2 class="s-rec-cap">No such company</h2>' +
        '<div class="s-rec-body"><p class="s-block-sub">That company is not in the book.</p>' +
        backBtn('data-home', 'Back to the briefing') + '</div>' +
      '</section></div>';
    }
    /* WHO HAS PICKED UP, FIRST. The queue's ranking puts callbacks first,
       which is right for a worklist and wrong for a company, where the one
       question is who answers. Reached people lead; the rest follow in the
       queue's own order, so the two pages cannot disagree about the rest. */
    const reached = (c) => (!isExit(c.checkpoint) && rank(c.checkpoint) >= rank('answered')) ? 1 : 0;
    const people = consAt(a.id).sort((x, y) =>
      (reached(y) - reached(x)) || (qRank(x) - qRank(y)) || qTie(x, y));
    const ring = people.filter(callable);
    const hist = touchesAt(a.id);
    const camps = [];
    people.forEach((c) => campsOf(c).forEach((k) => {
      if (mine(k) && camps.indexOf(k) < 0) camps.push(k);
    }));
    const free = myCampaigns().filter((k) => camps.indexOf(k) < 0).slice(0, 5);

    /* The furthest anyone here has got, as the chip beside the name. Below
       `answered` nobody has been reached, and that is the chip's whole
       message: a company where nobody has picked up is a different call. */
    const top = people.filter((c) => !isExit(c.checkpoint))
      .sort((x, y) => rank(y.checkpoint) - rank(x.checkpoint))[0];
    /* AND IT MUST AGREE WITH THE LEAD. The chip read the rung people stand
       at NOW; the lead reads the calls. Somebody reached in July who has
       since slipped back to callback made the chip say "Nobody reached yet"
       under a reading that named who got through. The call is the fact. */
    SAID_SIGNAL = signalOf(a) ? a.id : null;
    const everReached = hist.some((t) => t.outcome === 'reached');
    const chip = top && rank(top.checkpoint) >= rank('answered')
      ? { label: rungLabel(top.checkpoint) + ' here', tone: (RUNG[top.checkpoint] || {}).tone || 'ok' }
      : everReached
        ? { label: 'Reached before', tone: 'ok' }
        : { label: 'Nobody reached yet', tone: 'neutral' };

    const chips = free.length
      ? '<div class="b-camps-row" id="accCamps">' +
          campMenu({ id: 'accCampPick', opts: free.map((k) => ({ id: k.id, name: k.name })),
            label: 'Put everybody here on a campaign', cap: 'Put them on', go: 'acc:' + a.id }) +
        '</div>'
      : '';
    const callFirst = ring.length
      ? '<button class="s-inline-btn" type="button" data-call="' + esc(ring[0].id) + '">Call ' +
        esc(ring[0].name.split(' ')[0]) + '</button>'
      : '';

    return '<div class="s-home">' +
      backHere() +

      '<section class="s-rec-head s-block-wide">' +
        '<span class="s-rec-kind">Company · ' + esc(INDUSTRY[a.industry].label) + ' · ' +
          esc(a.city) + ', ' + esc(a.country) + '</span>' +
        '<div class="s-rec-title">' +
          '<h1 class="s-rec-name">' + esc(a.name) + '</h1>' +
          '<span class="s-meta-st tone-' + esc(chip.tone) + '">' + esc(chip.label) + '</span>' +
        '</div>' +
        '<div class="s-rec-facts">' +
          /* Rank one: the size, then how many are here and how many you can
             ring — the numbers that decide whether this company is worth
             the afternoon. */
          '<div>' +
            '<span><b>' + commas(a.size) + ' staff</b></span>' +
            '<span>' + esc(plural(people.length, 'person')) + ' here</span>' +
            '<span>' + (ring.length
              ? '<b>' + commas(ring.length) + '</b> you can ring now'
              : 'nobody with a number you can ring now') + '</span>' +
          '</div>' +
          /* Rank two: our record of them. */
          '<div>' +
            '<span>' + esc(a.domain) + '</span>' +
            (REGION[a.region] ? '<span>' + esc(REGION[a.region].label) + '</span>' : '') +
            (signalOf(a) ? '<span><b>' + esc(a.signal.text) + '</b> · seen ' + esc(sayWhen(a.signal.at)) + '</span>' : '') +
            '<span>' + (camps.length
              ? 'on ' + camps.slice(0, 3).map((k) =>
                  '<button class="s-inline-btn" type="button" data-camp="' + esc(k.id) +
                  '">' + esc(k.name) + '</button>').join(', ') +
                (camps.length > 3 ? ' and ' + (camps.length - 3) + ' more of yours' : '')
              : 'on none of your campaigns') + '</span>' +
          '</div>' +
        '</div>' +
        '<div class="s-rec-actions">' +
          (ring.length
            ? '<button class="s-insight-lnk primary" type="button" data-call="' +
                esc(ring[0].id) + '">Call ' + esc(ring[0].name.split(' ')[0]) + '</button>' +
              (ring.length > 1
                ? '<button class="s-inline-btn" type="button" data-callall="' +
                  esc(ring.map((c) => c.id).join(',')) + '">Call all ' + ring.length +
                  ' here</button>'
                : '')
            : '<span class="s-block-sub">' + esc(accIdle(people)) + '</span>') +
          accHandBtn(people) +
        '</div>' +
      '</section>' +

      storyBlock(accStory(a, people, hist)) +
      accLead(a, people, hist, ring, free) +
      accMap(a, people) +

      '<section class="s-block s-block-wide" aria-label="Who is here">' +
        '<div class="s-camp-list-head"><h2 class="s-block-h">Who is here</h2>' +
          '<span class="s-block-say">' + esc(plural(people.length, 'person')) +
          ' · who has picked up first, then by rung</span></div>' +
        qgrid(paged(people).rows, 'Nobody on the record at this company.') +
        pager(paged(people), 'person') +
        chips +
      '</section>' +

      '<section class="s-block s-block-wide" aria-label="Where they stand">' +
        '<div class="s-camp-list-head"><h2 class="s-block-h">Where they stand</h2>' +
          '<span class="s-block-say">' + esc(plural(callsIn(hist).length, 'call')) +
          ' into this company</span></div>' +
        funnelOf(people, 'On the record here') +
      '</section>' +

      /* Every call into the company, whoever made it and whoever they
         rang. On an account the person is the thing that tells two calls
         apart, so the row leads with the name — and it is the same feed
         the campaign uses, under the day it happened. */
      '<section class="s-block s-block-wide" aria-label="What has been said here">' +
        '<div class="s-camp-list-head"><h2 class="s-block-h">What has been said here</h2></div>' +
        feedBlock(hist, 'Nobody has rung this company yet. ' + callFirst) +
      '</section>' +
    '</div>';
  }

  /* ══ WHAT AiMY MAKES OF THE COMPANY, WITH SOMEWHERE TO GO ══════════════
     The one sentence this page knows that nothing else in the product
     does — somebody already got through here, and to whom — was the last
     item in the header stack, under the funnel, with no door. It leads now,
     and the door follows the finding: the person who picked up, if they can
     be rung; otherwise the best of the rest; otherwise a campaign. The
     reader's fallback — size and place, which the masthead now states — is
     not worth a panel, so on that reading the block is not drawn. */
  function accLead(a, people, hist, ring, free) {
    const said = accSays(a, people, hist);
    if (!said || said.from === 'the account itself') return '';
    const got = hist.filter((t) => t.outcome === 'reached')[0];
    const who = got && DB.byCon[got.con];
    let door = '';
    /* THE DOOR FOLLOWS THE SENTENCE. The reading names who picked up; when
       that person cannot be rung now — a meeting set, a hand-over — the
       door opens their record rather than ringing somebody else under
       their name. */
    if (who && callable(who)) {
      door = '<button class="s-insight-lnk" type="button" data-call="' + esc(who.id) + '">' +
        'Call ' + esc(who.name.split(' ')[0]) + ' — they picked up before</button>';
    } else if (who) {
      door = '<button class="s-insight-lnk" type="button" data-con="' + esc(who.id) + '">' +
        'Open ' + esc(who.name) + ' — ' + esc(rg2(who)) + '</button>';
    } else if (ring[0]) {
      door = '<button class="s-insight-lnk" type="button" data-call="' + esc(ring[0].id) + '">' +
        'Call ' + esc(ring[0].name.split(' ')[0]) + '</button>';
    } else if (free.length) {
      door = '<button class="s-insight-lnk" type="button" data-goto="accCamps">' +
        'Put them on a campaign</button>';
    }
    return '<section class="s-insight is-lead b-lead-slim s-block-wide" aria-label="What AiMY makes of this company">' +
      '<div class="s-lead-mark">' +
        '<svg class="s-insight-mark" viewBox="0 0 18 20" width="14" height="14" aria-hidden="true">' +
          '<use href="#aimy-logo-small"/></svg>' +
        '<span class="work-state ws-detected" data-work-state="detected">' + esc(said.from) + '</span>' +
      '</div>' +
      '<p class="s-lead-deck">' + said.text + '</p>' +
      (door ? '<div class="s-lead-acts">' + door + '</div>' : '') +
    '</section>';
  }


  /* What AiMY makes of a company, read off the corpus and never composed.
     The order is the order the facts change your next move in. */
  /* Why nobody at a company can be rung now. It said "no number" over two
     people who had numbers and had simply gone past the rungs you ring. */
  function accIdle(people) {
    if (!people.length) return 'Nobody is on the record here.';
    const live = people.filter((c) => !c.dnc && !isExit(c.checkpoint));
    const past = live.filter((c) => rank(c.checkpoint) > 3).length;
    const parked = live.filter((c) => rank(c.checkpoint) <= 3 && c.phone && c.next && c.next.due > TODAY_ISO).length;
    const noNum = live.filter((c) => !c.phone).length;
    const gone = people.length - live.length;
    const bits = [];
    if (past) bits.push(plural(past, 'person') + ' past the rungs you ring');
    if (parked) bits.push(plural(parked, 'callback') + ' parked until its day');
    if (noNum) bits.push(plural(noNum, 'person') + ' with no number');
    if (gone) bits.push(plural(gone, 'person') + ' who left the ladder');
    return 'Nobody here can be rung now: ' + bits.join(', ') + '.';
  }

  /* The calls among a set of touchpoints. A hand-move, a profile going out
     and the director's meetings are on the record and are not calls, and
     four places counted them as calls. */
  const callsIn = (ts) => ts.filter((t) => OUTCOME[t.outcome]);

  function accSays(a, people, hist) {
    /* What changed here, paired with what anybody here said. */
    const sig = signalOf(a);
    if (sig) return signalReading(a, sig, hist);
    /* Somebody else got through here. That is the most useful sentence on
       the page and the one nothing else in this product would tell you. */
    const got = hist.filter((t) => t.outcome === 'reached')[0];
    if (got) {
      const who = DB.byCon[got.con];
      return {
        text: esc(actor(got.by).name) + ' got through to ' +
          esc(who ? who.name : 'somebody here') + ' ' + esc(sayWhen(got.at)) +
          '. Open on what they said, not on the pitch.',
        from: 'the calls into this company',
      };
    }
    /* An opening anybody heard here. It is about the company, so it is
       true of everybody at it. */
    const opened = hist.filter((t) => t.openings && t.openings.length)[0];
    if (opened) {
      return { text: esc(openLabel(opened.openings[0])) + ' came up here ' +
        esc(sayWhen(opened.at)) + ' — it is true of everybody at this company.',
        from: 'a call into this account' };
    }
    /* What this company pushes back on, if it has said the same thing twice. */
    const n = Object.create(null);
    hist.forEach((t) => (t.objections || []).forEach((o) => (n[o] = (n[o] || 0) + 1)));
    const top = Object.keys(n).sort((x, y) => n[y] - n[x])[0];
    if (top && n[top] > 1) {
      return { text: esc(OBJECTION[top].label) + ' has come up ' + times(n[top]) +
        ' here. ' + esc(OBJECTION[top].blurb),
        from: plural(callsIn(hist).length, 'call') + ' into this company' };
    }
    /* Rung and rung and nothing, across the whole company. */
    if (callsIn(hist).length >= 3 && !got) {
      return { text: plural(callsIn(hist).length, 'call') + ' in and nobody here has picked up. ' +
        'It may be a switchboard rather than the people.',
        from: 'this company’s own history' };
    }
    /* Nothing has happened, so the useful thing is who they are. */
    const ring = people.filter(callable).length;
    return { text: esc(INDUSTRY[a.industry].label) + ' at ' + commas(a.size) +
      ' staff in ' + esc(a.city) + ', and ' + (ring
        ? plural(ring, 'person') + ' here can be rung today'
        : 'nobody here has a number you can ring') + '.',
      from: 'the account itself' };
  }

  /* "2 times" is a count wearing a sentence’s clothes. */
  const times = (n) => (n === 1 ? 'once' : n === 2 ? 'twice' : n + ' times');

  /* ══ ONE PERSON ═════════════════════════════════════════════════════════
     Who they are, where they stand on the ladder, and what has been said.
     The brief and the post-meeting controls arrive with the call panel. */
  /* ══ ONE PERSON, AS A JOURNEY ═══════════════════════════════════════════
     You arrive from a card, the bell or a read-back with one question — who
     is this and what do I do — and the old page answered it with the name in
     a 132px caption slot over seven lines at one weight, the actions spread
     across three of them, and where they stand said three separate ways.

     Now it reads top to bottom in the order the question is asked: who (the
     masthead, with the rung as a chip beside the name), what AiMY makes of
     them with a door, what to do (one row, the primary decided by the rung),
     where they stand (the ladder, what is owed, what to remember — once),
     and what has been said, grouped by month. The last thing on the action
     row is the next person in the queue, because a finished record is one
     press from the next call and should not need the briefing in between. */
  /* ══ THE DEAL, IN FOUR FACTS ═══════════════════════════════════════════
     What it is worth, when it should land, what we are selling them and who
     found them. The first two are modelled and say so — no number has been
     typed on any of these records, and a figure presented as read when it
     was guessed is the one thing this record must never do. */
  function dealBlock(c) {
    const a = accOf(c);
    const k = dealCamp(c);
    const sells = k && k.sells && k.sells.length
      ? listSay(k.sells.map((x) => (SELL[x] || {}).name || x)) : 'nothing named yet';
    const owner = c.owner ? actor(c.owner) : null;
    const days = daysBetween(TODAY_ISO, closeBy(c));
    return '<section class="s-block s-block-wide" aria-label="The deal">' +
      '<div class="b-cmeta">' +
        cmPart('Worth', '<p class="b-cmeta-p"><b>' + esc(euro(amountOf(c))) + '</b> — modelled ' +
          'from ' + esc(sells) + ' at ' + (a ? commas(a.size) + ' staff' : 'their size') +
          ', not read off a proposal.</p>') +
        cmPart('Expected close', '<p class="b-cmeta-p"><b>' + esc(sayDay(closeBy(c))) + '</b> — ' +
          (dealLive(c)
            ? (days < 0 ? 'that is ' + plural(-days, 'day') + ' ago, counted from the last meeting.'
              : 'about ' + plural(days, 'day') + ' out, counted from the last meeting.')
            : 'it is already decided.') + '</p>') +
        cmPart('What we sell them', '<p class="b-cmeta-p">' + esc(sells) +
          (k ? ', on <b>' + esc(k.name) + '</b>' : '') + '.</p>') +
        cmPart('Found by', '<p class="b-cmeta-p">' +
          (owner ? '<b>' + esc(owner.name) + '</b> rang them cold and got them warm.'
            : 'Nobody is named as the caller.') + '</p>') +
      '</div>' +
    '</section>';
  }

  function contactPage() {
    const c = DB.byCon[S.con];
    if (!c) {
      return '<div class="s-home"><section class="s-rec-block s-block-wide">' +
        '<h2 class="s-rec-cap">No such person</h2>' +
        '<div class="s-rec-body"><p class="s-block-sub">That record is not in the book. ' +
        'It may have been on a list that was discarded.</p>' +
        backBtn('data-home', 'Back to the briefing') + '</div>' +
      '</section></div>';
    }
    const a = accOf(c);
    const camps = campsOf(c);
    const mineCamp = camps.filter(mine)[0] || camps[0];
    /* Past the hand-over the rung has stopped moving — every deal reads
       "Handed over" for ever — so at the manager's desk the status is the
       stage, which is the thing that is actually still moving. */
    const others = a ? consAt(a.id).filter((x) => x.id !== c.id) : [];
    const rg = (isMgr() && c.checkpoint === 'handed-over')
      ? DEAL_STAGE[stageOf(c)] : (RUNG[c.checkpoint] || RUNG['not-called']);
    const n = (DB.touchesOf[c.id] || []).length;

    /* THE WAY BACK AND THE WAY OUT SHARE A ROW. One leaves the record, the
       other ends it, and they are the only two things on this page that are
       not about working the lead — at opposite edges of the line above it,
       as far from Call as the page can put them. */
    return '<div class="s-home">' +
      /* WIDE, or the two-column grid takes it into the first column and
         the far edge of the row turns out to be the middle of the page. */
      '<div class="b-topbar s-block-wide">' + backHere() + endGate(c) + '</div>' +

      '<section class="s-rec-head s-block-wide">' +
        '<span class="s-rec-kind">Person' +
          (mineCamp ? ' · on ' + esc(mineCamp.name) : ' · on no campaign') +
          (camps.length > 1 ? ' and ' + (camps.length - 1) + ' more' : '') + '</span>' +
        '<div class="s-rec-title">' +
          '<h1 class="s-rec-name">' + esc(c.name) + '</h1>' +
          '<span class="s-meta-st tone-' + esc(rg.tone) + '">' + esc(rg.label) + '</span>' +
        '</div>' +
        '<div class="s-rec-facts">' +
          '<div>' +
            '<span>' + esc(c.title) + '</span>' +
            (a ? '<span><button class="s-inline-btn" type="button" data-acc="' + esc(a.id) +
              '">' + esc(a.name) + '</button></span>' +
              '<span>' + esc(INDUSTRY[a.industry].label) + '</span>' +
              '<span>' + esc(a.city) + ', ' + esc(a.country) + '</span>' +
              '<span>' + commas(a.size) + ' staff</span>' : '') +
          '</div>' +
          '<div>' +
            (c.phone
              ? '<span><a class="s-inline-btn" href="tel:' + esc(c.phone.replace(/\s/g, '')) +
                '">' + esc(c.phone) + '</a></span>'
              : '<span>No number on file</span>') +
            /* [7] A REASON TO OPEN THE COMPANY. A caller whose number rings
               out needs a colleague, not a company profile — so the fact that
               there are colleagues is on the record, with the door. */
            (others.length
              ? '<span>' + coMenu(a, others, plural(others.length, 'other') + ' at ' + a.name) + '</span>'
              : (a ? '<span>the only person here</span>' : '')) +
            /* WHO IS MANAGING THEM NOW. The one fact about this record that
               is not the BDR's to act on, so it sits with the facts. */
            /* Not at the manager's own desk: "Managed by Lina Haddad" read
               by Lina is the page telling her who she is. Where it came from
               is the useful provenance there, and the deal block carries it. */
            (!isMgr() && c.manager && REP[c.manager]
              ? '<span class="b-managed">Managed by <b>' + esc(REP[c.manager].name) + '</b></span>'
              : '') +
          '</div>' +
        '</div>' +
        actionsRow(c) +
      '</section>' +

      (isMgr() && c.checkpoint === 'handed-over' ? dealBlock(c) : '') +

      storyBlock(storyOf(c)) +

      conMap(c) +

      conLead(c) +

      '<section class="s-block s-block-wide" aria-label="What has been said">' +
        '<div class="s-camp-list-head">' +
          '<h2 class="s-block-h">What has been said</h2>' +
          '<span class="s-block-say">' + plural(n, 'touchpoint') + ' on the record</span>' +
        '</div>' +
        callsBlock(c) +
      '</section>' +
    '</div>';
  }

  /* ══ ONE ROW, AND THE RUNG DECIDES WHICH IS FIRST ══════════════════════
     Call was always the primary, even on a lead with a meeting in a diary
     — where the one thing this page is waiting for is whether they turned
     up. The rung says what the next press is; the row puts it first and
     everything else after it in the order it is likely to be needed. */
  /* ══ THE WAY OUT IS A CONTROL, AT THE FAR END OF THE MASTHEAD ══════════
     "They said no" was an .s-inline-btn — a text link — with its accent
     taken off, which leaves grey words with no border, no ground and no
     colour, sitting flush left under the primary exactly where a caption
     sits. Everything that says "you can press this" had been removed, and
     its hover set a border-colour on an element with no border.

     A mark and a bordered pill, at the top right of the record beside its
     name: a press that ends a lead should not live a thumb's width from the
     press that rings them, and the corner opposite the primary is where an
     interface puts the thing you do once and rarely.

     The question is a popover, on the same machinery as every other menu
     here — so a click anywhere else or Escape is the way back, and the row
     underneath does not grow a second state to hold it. */
  /* One control, two endings. A caller ends a lead nobody could sell to; a
     manager ends a deal that was on the table and came off it. Same shape,
     same gate, same undo — only the words differ, because the two acts are
     the same act at different points of the same story. */
  function endGate(c) {
    const mgr = isMgr() && c.checkpoint === 'handed-over';
    const endable = mgr ? dealLive(c)
      : (!isExit(c.checkpoint) && c.checkpoint !== 'handed-over' &&
        rank(c.checkpoint) >= rank('callback'));
    if (!endable) return '';
    const word = mgr ? 'We lost it' : 'They said no';
    const say = mgr
      ? 'The deal closes as lost and leaves the board. Undo on the toast is the way back.'
      : 'They leave your queue and nothing is owed. Undo on the toast is the way back.';
    const yes = mgr ? 'Yes, we lost it' : 'Yes, they said no';
    const doIt = mgr ? 'data-deal="' + esc(c.id + ':lost') + '"' : 'data-move="declined"';
    return '<span class="b-menu-wrap b-end">' +
      '<button class="b-ghost b-end-open" type="button" data-pickopen="noGate" aria-haspopup="menu">' +
        '<svg class="b-end-mark" viewBox="0 0 24 24" width="14" height="14" fill="none" ' +
          'stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">' +
          '<circle cx="12" cy="12" r="8.75"/><path d="M5.8 18.2 18.2 5.8"/></svg>' +
        '<span class="b-end-word">' + esc(word) + '</span></button>' +
      '<div class="b-menu b-end-pop" id="noGate" role="menu" hidden>' +
        '<span class="b-menu-cap">End it here</span>' +
        '<p class="b-end-say">' + esc(say) + '</p>' +
        '<div class="b-end-acts">' +
          '<button class="b-ghost b-end-go" type="button" role="menuitem" ' + doIt + '>' +
            esc(yes) + '</button>' +
          '<button class="s-inline-btn" type="button" data-pickopen="noGate">Keep them</button>' +
        '</div>' +
      '</div>' +
    '</span>';
  }

  function actionsRow(c) {
    const first = c.name.split(' ')[0];
    /* No call on somebody who opted out: the number is on the page, the
       verb is not. */
    const call = c.phone && !c.dnc
      ? { html: 'Call ' + esc(first) +
          /* a parked callback or a meeting still ahead: the call is early, and says so */
          (c.checkpoint === 'callback' && c.next && c.next.due > TODAY_ISO ? ' early'
            : c.checkpoint === 'meeting-set' && c.next && c.next.due > TODAY_ISO ? ' to confirm' : ''),
        attr: 'data-call="' + esc(c.id) + '"' } : null;
    /* no number, or a number that is not theirs: the verb is the supplier */
    const find = (!c.dnc && (c.checkpoint === 'wrong-number' || (!c.phone && !isExit(c.checkpoint))))
      ? { html: 'Find a number', attr: 'data-enrichcon="' + esc(c.id) + '"' } : null;
    /* THE DIRECTOR HAS A NAME. "Hand to the director" handed them to
       nobody in particular; the campaign's owner is who gets them. */
    /* "They said no" is not one of these: it ends the lead, so it is out
       of the row of ordinary verbs and behind a gate of its own. */
    /* The same row, asking the question this desk answers: a caller records
       what a rung did, a manager records what a meeting did. */
    const moves = (isMgr() && c.checkpoint === 'handed-over')
      ? dealMoves(c).map((m) => ({ html: esc(m.label),
        attr: 'data-deal="' + esc(c.id + ':' + m.k) + '"' }))
      : movesFor(c).filter((m) => m.k !== 'declined' && m.k !== 'handed-over')
        .map((m) => ({ html: esc(m.label), attr: 'data-move="' + esc(m.k) + '"' }));
    /* ══ THE HAND-OVER IS A CHOICE OF MANAGER ════════════════════════════
       Once somebody is warm the sales manager takes them, and which
       manager is a decision — so the verb opens the list rather than
       naming whoever happens to own the campaign. */
    /* From a callback up: a callback is a live thread — somebody asked to
       be rung back — and a BDR can pass one across. Below that nobody has
       spoken to them, and there is nothing to hand over. */
    const warm = rank(c.checkpoint) >= rank('callback') && !isExit(c.checkpoint) &&
      c.checkpoint !== 'handed-over';
    const send = null;
    let list;
    let quiet = [];
    let say = '';
    if (c.checkpoint === 'handed-over') {
      const ph = phasesOf(c);
      const fin = ph.length ? ph[ph.length - 1] : null;
      if (isMgr()) {
        /* It is on this desk, so the phone is the verb rather than a note
           about who has it. A decided deal keeps the sentence and loses it.
           The brief stands beside the phone because a manager walks into a
           meeting far more often than they dial. */
        const prep = { html: 'Prepare me', attr: 'data-prep="' + esc(c.id) + '"' };
        list = dealLive(c) ? (call ? [call, prep] : [prep]) : [];
        quiet = dealLive(c) ? [] : call ? [call] : [];
        say = dealLive(c) ? ''
          : 'They ' + (stageOf(c) === 'won' ? 'signed' : 'said no') + ' ' +
            sayWhen(fin.at.slice(0, 10)) + '.';
      } else {
        list = [];
        quiet = call ? [call] : [];
        /* the same tense as the ladder line: decided is past */
        say = fin && fin.decision
          ? directorOf(c).name + ' had it. They ' + (fin.decision === 'won' ? 'signed' : 'said no') + ' ' + sayWhen(fin.at.slice(0, 10)) + '.'
          : directorOf(c).name + ' has it now.';
      }
    } else if (c.checkpoint === 'wrong-number') {
      /* the ladder says nothing is owed until somebody finds a number that
         is theirs; that is the one thing to press, and Call is not */
      list = find ? [find] : [];
      quiet = [];
      say = find ? '' : rg2(c) + ', so there is nothing to press.';
    } else if (isExit(c.checkpoint)) {
      list = [];
      quiet = call ? [call] : [];
      say = rg2(c) + ', so there is nothing to press. Undo on the toast is the way back.';
    } else {
      /* ══ THE PHONE IS THE ROW; THE RUNGS ARE THE QUESTION ══════════════
         Four verbs stood in one line at two weights, and which of them led
         swapped as soon as a meeting date passed — so the button under the
         cursor changed from Call to They showed up without the page moving.
         The row is what you DO with this record: ring them, hand them over,
         go to the next one. What happened at the meeting is a different
         kind of thing — a fact to record, not an action to take — and it
         gets its own line and the question it answers. */
      list = (find ? [find] : []).concat(call ? [call] : []).concat(send ? [send] : []);
    }
    /* [8] THE WAY OUT IS THE NEXT PERSON. Reads the same ranking the queue
       uses, so the name here is the card that would be first if you went
       back — which is the whole point of not going back. */
    const next = queue(null, 'all').filter((x) => x.id !== c.id)[0];
    return '<div class="s-rec-actions">' +
      list.map((b, i) =>
        '<button class="' + (i === 0 ? 's-insight-lnk primary' : 's-inline-btn') + '" type="button" ' +
        b.attr + '>' + b.html + '</button>').join('') +
      (say ? '<span class="s-block-sub">' + esc(say) + '</span>' : '') +
      quiet.map((b) => '<button class="s-inline-btn" type="button" ' + b.attr + '>' + b.html + '</button>').join('') +
      /* the hand-over belongs with the verbs, not after the way out */
      (warm ? mgrMenu(c.id, 'Handover') : '') +
      (next
        ? '<button class="s-inline-btn b-next" type="button" data-con="' + esc(next.id) + '">' +
          'Next in the queue: ' + esc(next.name) + ' →</button>'
        : '') +
    '</div>' +
    (moves.length
      ? '<div class="b-ask">' +
          '<span class="b-ask-cap">What happened?</span>' +
          moves.map((b) => '<button class="s-inline-btn" type="button" ' + b.attr + '>' +
            b.html + '</button>').join('') +
        '</div>'
      : '');
  }
  const rg2 = (c) => (RUNG[c.checkpoint] || {}).say || 'they have left the ladder';

  /* ══ WHAT AiMY MAKES OF THIS ONE, WITH SOMEWHERE TO GO ═════════════════
     The card's punchline was the last line of the record's header, under
     Remember, with no door. It is the one reading on the page, so it gets
     the lead block — compact, because the figure the campaign's lead opens
     with has no equivalent for one person — and the door follows from what
     the reading found: a number that never answers wants a colleague; a
     screened call wants the hour; anything else wants the phone. */
  function conLead(c) {
    const said = aimySays(c, true);
    /* A LEAD BLOCK EARNS ITS PLACE OR IS NOT DRAWN. The reader's last resort
       is "Last was callback, 23 Aug" — a fact the ladder two sections down
       already states with the date beside it. Announced at the deck step in
       an accent panel, it promised a finding and delivered a timestamp. */
    if (!said || said.from === 'the touchpoint before this one') return '';
    const a = accOf(c);
    const others = a ? consAt(a.id).filter((x) => x.id !== c.id) : [];
    const hist = (DB.touchesOf[c.id] || []).map((id) => TOUCH[id]).filter(Boolean);
    const last = hist[0];
    let door = '';
    if (!c.dnc && (c.checkpoint === 'wrong-number' || (!c.phone && !isExit(c.checkpoint)))) {
      door = '<button class="s-insight-lnk" type="button" data-enrichcon="' + esc(c.id) + '">' +
        'Ask ' + esc(finderOf().name) + ' for a number</button>';
    } else if (c.attempts >= 3 && c.checkpoint === 'no-answer' && others.length) {
      door = coMenu(a, others, 'Try one of the ' + others.length + ' others at ' + a.name);
    } else if (c.attempts >= 3 && c.checkpoint === 'no-answer' && c.phone) {
      /* NO COLLEAGUE TO TRY, so the door is the supplier. The reading says
         this number may not be theirs, and "Call Ava" under it rang it
         again. */
      door = '<button class="s-insight-lnk" type="button" data-enrichcon="' + esc(c.id) + '">' +
        'Ask ' + esc(finderOf().name) + ' for a better number</button>';
    } else if (last && last.outcome === 'gatekeeper' && c.phone && callable(c)) {
      door = '<button class="s-insight-lnk" type="button" data-call="' + esc(c.id) + '">' +
        'Ring the mobile now</button>';
    } else if (c.phone && callable(c)) {
      door = '<button class="s-insight-lnk" type="button" data-call="' + esc(c.id) + '">' +
        'Call ' + esc(c.name.split(' ')[0]) + '</button>';
    }
    return '<section class="s-insight is-lead b-lead-slim s-block-wide" aria-label="What AiMY makes of this">' +
      '<div class="s-lead-mark">' +
        '<svg class="s-insight-mark" viewBox="0 0 18 20" width="14" height="14" aria-hidden="true">' +
          '<use href="#aimy-logo-small"/></svg>' +
        '<span class="work-state ws-detected" data-work-state="detected">' + esc(said.from) + '</span>' +
      '</div>' +
      '<p class="s-lead-deck">' + said.text + '</p>' +
      (door ? '<div class="s-lead-acts">' + door + '</div>' : '') +
    '</section>';
  }

  /* ══ EVERY TOUCHPOINT, WITH THE WHOLE OF IT INSIDE ═════════════════════
     It was a one-line row: outcome, who, when, and the note squeezed beside
     them. Everything a call actually produced — what was asked for, what
     pushed back, what opened, which rung it moved, what it left owing, the
     transcript — was written to the record and shown nowhere on it.

     So it is the record's card, drawn by the renderer the read-back uses.
     The closed line is when · who dialled · how it went, which is the whole
     of what a history is scanned for; everything else is inside.

     NEWEST OPEN. The last call is the one you need before the next, and a
     history whose every entry is shut asks you to press before it tells you
     anything. */
  /* ══ THE JOURNEY, ON A RAIL ═════════════════════════════════════════════
     Eight cards in a column read as a list. The same eight on a rail read
     as what they are: one person's history, newest at the top, with the
     rungs they climbed marked on the way down. Every touchpoint is a node
     in the tone of how it went; a touchpoint that MOVED a rung is a
     milestone — a larger accent ring and the rung it reached on the line —
     so the ladder is readable down the rail without opening anything. The
     rail ends where the journey began: the first rung, and the count.

     The card underneath each node is unchanged, and so are its handlers.
     Written out per tone rather than composed, for the audit. */
  const TL_TONE = { ok: 'tone-ok', warn: 'tone-warn', neutral: 'tone-neutral', err: 'tone-err' };
  function callsBlock(c) {
    const all = (DB.touchesOf[c.id] || []).map((id) => TOUCH[id]).filter(Boolean);
    if (!all.length) {
      return '<p class="b-vfoot">' + (untouched(c)
        ? 'Nobody has rung them yet.' : 'No calls on the record.') + '</p>';
    }
    /* ══ THE RECORD IS THE RECORD ══════════════════════════════════════
       The heading said "18 touchpoints on the record" and the rail showed
       eight of them, with the foot saying so and no way to the other ten.
       A digest is right for a feed about other people; a person's own
       history is the thing the page is for, so it pages like the roster. */
    const pg = paged(all);
    const climbed = all.filter((t) => t.moved && rank(t.moved[1]) > rank(t.moved[0])).length;
    const oldest = all[all.length - 1];
    let month = '';
    return '<div class="b-tl">' + pg.rows.map((t, i) => {
      const o = OUTCOME[t.outcome];
      const m = t.at.slice(0, 7);
      const head = m !== month
        ? '<h3 class="b-month b-tl-month">' + esc(monthName(t.at)) + '</h3>' : '';
      month = m;
      const up = t.moved && rank(t.moved[1]) > rank(t.moved[0]);
      const out = t.moved && isExit(t.moved[1]);
      /* the director's meetings are milestones too; a lost resolution is drawn as a way out */
      const ph = t.outcome === 'phase';
      const phTone = ph ? (t.decision === 'lost' ? 'warn' : 'ok') : null;
      return head + '<details class="s-call b-tl-item' + (up || out || ph ? ' is-milestone' : '') + '"' +
        (i === 0 && pg.p === 0 ? ' open' : '') + '>' +
        '<summary class="s-call-sum">' +
          '<span class="b-tl-dot ' + (TL_TONE[o ? o.tone : (phTone || 'neutral')] || 'tone-neutral') +
            '" aria-hidden="true"></span>' +
          '<span class="s-call-when">' + esc(sayDay(t.at)) + '</span>' +
          '<span class="s-call-by' + (whoDid(t).id === 'aimy' ? ' is-ai' : '') + '">' +
            esc(whoDid(t).name) + '</span>' +
          '<span class="s-call-out tone-' + esc(o ? o.tone : (phTone || 'neutral')) + '">' +
            esc(kindLabel(t)) + '</span>' +
          /* the chip names the rung reached; when the outcome already says it
             ("Callback → Callback") the ring on the dot is the milestone */
          (t.moved && rungLabel(t.moved[1]) !== kindLabel(t)
            ? '<span class="b-tl-move' + (out ? ' is-out' : '') + '">→ ' + esc(rungLabel(t.moved[1])) + '</span>'
            : ph && t.decision
              ? '<span class="b-tl-move' + (t.decision === 'lost' ? ' is-out' : '') + '">→ ' +
                (t.decision === 'won' ? 'Signed' : 'Declined') + '</span>'
              : '') +
          '<span class="s-call-ago">' + esc(sayAgo(t.at)) + '</span>' +
        '</summary>' +
        '<div class="s-call-body">' +
          /* The record's Remember is printed once, in the stand section. On
             the read-back card it travels with the call because the canvas
             is somewhere else; on the record's own history it was the same
             sentence on every one of eight cards. */
          callSummaryHtml(factsOfTouch(t), Object.assign({}, c, { remember: null }), t.note, t.lines) +
        '</div>' +
      '</details>';
    }).join('') +
      /* Where it began, on the page where it began: the cap is the end of
         the rail, and on page one of three the rail has not ended. */
      (pg.p === pg.pages - 1
        ? '<div class="b-tl-end"><span class="b-tl-dot is-end" aria-hidden="true"></span>' +
          'First rung ' + esc(sayDay(oldest.at)) + ' · ' + esc(plural(all.length, 'touchpoint')) +
          (climbed ? ' · ' + esc(plural(climbed, 'rung')) + ' climbed' : ' · no rung climbed yet') +
        '</div>'
        : '') +
    '</div>' + pager(pg, 'touchpoint');
  }



  /* ══ WHAT HAPPENS NEXT, AND WHOSE JOB IT IS ════════════════════════════
     The ladder says where they stand. It does not say what standing there
     means you do — and for the last two rungs it means somebody else does
     it. A BDR's part of this process ends at the handover: discovery, the
     proof meeting, the commercial one and the resolution belong to the
     director, and a page that stops naming them at the handover leaves the
     caller thinking the lead has gone quiet. */
  /* Where it is with the director, read off the phase touchpoints. */
  function phasesOf(c) {
    return (DB.touchesOf[c.id] || []).map((id) => TOUCH[id])
      .filter((t) => t && t.outcome === 'phase').sort((x, y) => (x.at < y.at ? -1 : 1));
  }
  /* ══ THE DEAL IS THE LEAD, AFTER THE HAND-OVER ══════════════════════════
     There is no deal record and there should not be one: a deal is a person
     at a company we are trying to sell to, which is a contact and an account,
     and the manager's half of its history is already on the record as the
     phase touchpoints the seed wrote. Stage is read off the last of them the
     way every other state here is read off its events, so moving a deal is
     writing one touchpoint and nothing has two answers. */
  function stageOf(c) {
    const ph = phasesOf(c);
    if (!ph.length) return 'qual';
    const last = ph[ph.length - 1];
    if (last.phase !== 'resolution') return last.phase;
    return last.decision === 'lost' ? 'lost' : 'won';
  }
  const dealLive = (c) => stageOf(c) !== 'won' && stageOf(c) !== 'lost';
  /* The campaign the deal belongs to, read the same way the index and the
     seed's own hand-over note read it, rather than through `campFor`, which
     answers for whoever is looking. */
  const dealCamp = (c) => (c && c.camps.length ? DB.byCamp[c.camps[0]] : null);

  function amountOf(c) {
    const a = accOf(c);
    const k = dealCamp(c);
    const sell = (k && k.sells && k.sells.length ? k.sells[0] : 'qa');
    const band = (PRICE[sell] || PRICE.qa)[priceBand(a ? a.size : 300)];
    const j = (Math.abs(hash(c.id + ':amt')) % 45) - 22;
    return Math.round((band * (1 + j / 100)) / 500) * 500;
  }
  /* When it should land, counted from the last thing that happened rather
     than from today: a deal that has sat still for a month is late, and a
     date that walks forward with the clock would never say so. */
  function closeBy(c) {
    const ph = phasesOf(c);
    const from = ph.length ? ph[ph.length - 1].at.slice(0, 10)
      : (c.checkpointAt || TODAY.toISOString()).slice(0, 10);
    const st = stageOf(c);
    return isoAdd(from, st === 'qual' ? 60 : st === 'discovery' ? 45 : st === 'proof' ? 28 : 14);
  }

  /* One line of why this deal is where it is — the last meeting held, and
     what it left owed. The card and the column read the same string. */
  function dealWhy(c) {
    const ph = phasesOf(c);
    const st = stageOf(c);
    const last = ph.length ? ph[ph.length - 1] : null;
    if (st === 'won') return 'They signed <b>' + esc(sayWhen(last.at.slice(0, 10))) + '</b>';
    if (st === 'lost') return 'They said no <b>' + esc(sayWhen(last.at.slice(0, 10))) + '</b>';
    if (!last) {
      return 'Handed to you <b>' + esc(sayWhen((c.checkpointAt || '').slice(0, 10))) +
        '</b>, and nobody has warm-called them';
    }
    const owed = c.next
      ? esc(c.next.what) + ' <b>' + (daysBetween(TODAY_ISO, c.next.due) < 0 ? 'was due ' : 'due ') +
        esc(sayWhen(c.next.due)) + '</b>'
      : '';
    return esc((PHASE[last.phase] || {}).label || last.phase) + ' <b>' +
      esc(sayWhen(last.at.slice(0, 10))) + '</b>' + (owed ? ' · ' + owed : '');
  }

  /* ══ MOVING A DEAL IS WRITING WHAT HAPPENED ═════════════════════════════
     The same act as a rung move and the same shape: one touchpoint, one
     patch, a toast that undoes both. The words are what a manager would say
     about the meeting, not the name of a column they dragged it into. */
  const DEAL_MOVES = [
    { k: 'discovery',  label: 'We spoke' },
    { k: 'proof',      label: 'We met' },
    { k: 'commercial', label: 'Proposal sent' },
    { k: 'won',        label: 'They signed' },
    { k: 'lost',       label: 'They passed' },
  ];
  function dealMoves(c) {
    const at = stageRank(stageOf(c));
    if (at >= stageRank('won')) return [];
    return DEAL_MOVES.filter((m) => stageRank(m.k) > at);
  }
  /* What each stage leaves owed. An ended deal owes nothing and says so by
     clearing the field, the way a finished rung does. */
  function nextForStage(k) {
    if (k === 'discovery') return { what: 'Meeting with them', due: dayAdd(7) };
    if (k === 'proof') return { what: 'Proposal to them', due: dayAdd(7) };
    if (k === 'commercial') return { what: 'Chase the proposal', due: dayAdd(5) };
    return null;
  }
  function setStage(conId, k) {
    const c = DB.byCon[conId];
    const st = DEAL_STAGE[k];
    if (!c || !st) return;
    const before = { checkpointAt: c.checkpointAt, next: c.next };
    const now = new Date().toISOString();
    const ended = k === 'won' || k === 'lost';
    const t = {
      id: 'd' + Date.now().toString(36) + Math.floor(Math.random() * 1000),
      con: c.id, camp: dealCamp(c) ? dealCamp(c).id : null, by: me().id, at: now, secs: 0,
      outcome: 'phase', phase: ended ? 'resolution' : k, decision: ended ? k : null,
      proposals: [], objections: [], openings: [],
      note: k === 'won' ? 'They signed on the terms agreed.'
        : k === 'lost' ? 'They decided against it.'
        : (PHASE[k] || {}).label + ' held.',
      lines: [], next: null, moved: null, rung: 'handed-over',
    };
    patchCon(c, { checkpointAt: now, next: nextForStage(k) });
    addTouch(t);
    paint();
    toast(c.name.split(' ')[0] + ' → ' + st.label, () => {
      dropTouch(t.id);
      patchCon(c, before);
      paint();
    });
  }

  function dealLine(c) {
    const d = directorOf(c);
    const ph = phasesOf(c);
    /* Whose it is depends on who is reading. To the caller who produced it
       the news is that somebody else is running it; to the manager running
       it the news is which meeting comes next. */
    const who = isMgr() ? 'You have it' : d.name + ' has it';
    const had = isMgr() ? 'You had it' : d.name + ' had it';
    const notYours = isMgr() ? '' : ', and none of them are yours';
    /* the ladder line above already carries the date */
    if (!ph.length) {
      return who + '. Discovery is the first of four meetings' + notYours + '.';
    }
    const done = ph.map((t) => (PHASE[t.phase] || {}).label + ' ' + sayDay(t.at)).join(' · ');
    const last = ph[ph.length - 1];
    if (last.decision) {
      return had + '. ' + done + '. ' +
        (last.decision === 'won' ? 'They signed ' : 'They said no ') + sayWhen(last.at.slice(0, 10)) + '. Done.';
    }
    const nextPh = PHASES[ph.length];
    return who + '. ' + done + '. Next: ' +
      (nextPh ? nextPh.label.toLowerCase() : 'resolution') +
      (isMgr() ? '.' : ', and it is not yours.');
  }

  /* ══ THE STORY SO FAR ══════════════════════════════════════════════════
     A record read top to bottom is a profile; a profile read as prose is a
     story. It was five sentences of prose, which is a paragraph to read
     rather than a story to take in — so it is told the way a story is
     told: where they stand NOW in one line at the deck step, the moments
     that got them there as a chain you read left to right, and one quiet
     line about how it ends. Nothing here is a control; the verbs are
     sixty pixels up. */
  /* A thing still owed, and a thing already settled. */
  const nmClock = () => '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" ' +
    'stroke-width="2" stroke-linecap="round" aria-hidden="true">' +
    '<circle cx="12" cy="12" r="9"/><path d="M12 7.5V12l3 2"/></svg>';
  const nmTick = () => '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" ' +
    'stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M5 12.5l4.5 4.5L19 7"/></svg>';

  /* ══ THE MAP ═══════════════════════════════════════════════════════════
     Every record here is joined to others and no page ever drew the joins.
     One shape on both surfaces — a root, a rail, and what hangs off it —
     read in the two directions a caller needs. From a person: the company
     they are at, and everybody else we hold inside it, because the person
     who will not take the call has a colleague who might. From a company:
     the people we hold there and the campaigns those people sit on, which
     is the one join no other block on that page can draw. Every node is a
     door and carries the fact that decides whether to open it. */
  function mapShell(o) {
    return '<section class="s-block s-block-wide" aria-label="Lead map">' +
      '<div class="s-camp-list-head"><h2 class="s-block-h">Lead map</h2>' +
        '<span class="s-block-say">' + esc(o.say) + '</span></div>' +
      '<div class="b-map">' +
        '<button class="b-node is-root" type="button" ' + o.root.attr + '>' +
          '<span class="b-node-name">' + esc(o.root.name) + '</span>' +
          '<span class="b-node-sub">' + esc(o.root.sub) + '</span>' +
        '</button>' +
        '<div class="b-map-body">' + o.limbs.map((x) =>
          '<div class="b-limb">' + x + '</div>').join('') + '</div>' +
      '</div>' +
      (o.more ? '<p class="b-vfoot">' + esc(o.more) + '</p>' : '') +
    '</section>';
  }
  const dotOf = (c) => '<span class="b-rstate-dot ' +
    (TL_TONE[(RUNG[c.checkpoint] || RUNG['not-called']).tone] || 'tone-neutral') + '"></span>';

  /* From a person: the company, and everybody we hold inside it. */
  function conMap(c) {
    const a = accOf(c);
    if (!a) return '';
    const all = consAt(a.id).slice().sort((x, y) =>
      (x.id === c.id ? -1 : y.id === c.id ? 1 : rank(y.checkpoint) - rank(x.checkpoint)));
    const shown = all.slice(0, 8);
    return mapShell({
      say: plural(all.length, 'lead') + ' at this company',
      root: {
        name: a.name,
        sub: INDUSTRY[a.industry].label + ' · ' + a.city + ' · ' + commas(a.size) + ' staff',
        attr: 'data-acc="' + esc(a.id) + '"',
      },
      limbs: ['<div class="b-map-row">' + shown.map((x) =>
        '<button class="b-node' + (x.id === c.id ? ' is-here' : '') + '" type="button" ' +
        'data-con="' + esc(x.id) + '">' +
          '<span class="b-node-top">' + dotOf(x) +
            '<span class="b-node-name">' + esc(x.name) + '</span>' +
            (x.id === c.id ? '<span class="b-node-mark">here</span>' : '') + '</span>' +
          '<span class="b-node-sub">' + esc(x.title) + '</span>' +
        '</button>').join('') + '</div>'],
      more: all.length > shown.length
        ? plural(all.length - shown.length, 'more') + ' at ' + a.name + ', on the roster below' : '',
    });
  }

  /* From a company: who we hold here, and what they are being worked on.
     One limb per kind of join, because a company joins two different things
     and a caller asks about them separately. A limb per campaign instead —
     which is what this drew first — printed the same seven names nine times
     down the page: true, and unreadable. Every campaign is here, not only
     mine: a company somebody else in the building is already calling is the
     one thing this drawing can say that no other block on the page can. */
  function accMap(a, people) {
    if (!people.length) return '';
    const by = Object.create(null);
    people.forEach((c) => campsOf(c).forEach((k) => (by[k.id] = by[k.id] || []).push(c)));
    const ids = Object.keys(by).sort((x, y) =>
      ((mine(DB.byCamp[y]) ? 1 : 0) - (mine(DB.byCamp[x]) ? 1 : 0)) || (by[y].length - by[x].length));
    const mineN = ids.filter((id) => mine(DB.byCamp[id])).length;
    const loose = people.filter((c) => !campsOf(c).length).length;
    const folk = people.slice(0, 8);
    const camps = ids.slice(0, 8);
    /* The head above already counts both, so a caption repeats it or says
       nothing. It says the thing the head cannot: which of these are mine. */
    const cap = (name, n) =>
      '<span class="b-branch-head is-flat">' +
        '<span class="b-branch-name">' + esc(name) + '</span>' +
        (n ? '<span class="b-branch-n">' + esc(n) + '</span>' : '') +
      '</span>';
    const limbs = [
      cap('Who we hold here', '') +
      '<div class="b-map-row">' + folk.map((x) =>
        '<button class="b-node" type="button" data-con="' + esc(x.id) + '">' +
          '<span class="b-node-top">' + dotOf(x) +
            '<span class="b-node-name">' + esc(x.name) + '</span></span>' +
          '<span class="b-node-sub">' + esc(x.title) + '</span>' +
        '</button>').join('') + '</div>',
    ];
    if (camps.length) {
      limbs.push(
        cap('What they are being worked on',
          mineN ? commas(mineN) + ' of them yours' : 'none of them yours') +
        '<div class="b-map-row">' + camps.map((id) => {
          const k = DB.byCamp[id];
          return '<button class="b-node" type="button" data-camp="' + esc(id) + '">' +
            '<span class="b-node-top">' +
              '<span class="b-node-name">' + esc(k.name) + '</span>' +
              (mine(k) ? '<span class="b-node-mark">yours</span>' : '') +
            '</span>' +
            '<span class="b-node-sub">' + commas(by[id].length) + ' of ' + commas(people.length) +
              (mine(k) ? '' : ' · ' + actor(k.owner).name + '’s') +
              (campOpen(k) ? '' : ' · closed') + '</span>' +
          '</button>';
        }).join('') + '</div>');
    }
    const rest = [];
    if (people.length > folk.length) {
      rest.push(plural(people.length - folk.length, 'more lead') + ' on the roster below');
    }
    if (ids.length > camps.length) rest.push(plural(ids.length - camps.length, 'more campaign'));
    if (loose) rest.push(commas(loose) + ' on no campaign at all');
    return mapShell({
      say: plural(people.length, 'lead') + ' and ' + plural(ids.length, 'campaign'),
      root: {
        name: a.name,
        sub: INDUSTRY[a.industry].label + ' · ' + a.city + ' · ' + commas(a.size) + ' staff',
        attr: 'data-acc="' + esc(a.id) + '"',
      },
      limbs: limbs,
      more: rest.join(' · '),
    });
  }

  function storyBlock(o) {
    return '<section class="s-block s-block-wide b-story" aria-label="The story so far">' +
      '<div class="s-camp-list-head"><h2 class="s-block-h">The story so far</h2>' +
        (o.cite ? '<span class="s-block-say">' + esc(o.cite) + '</span>' : '') + '</div>' +
      /* THE LADDER OPENS IT. It had a section of its own, under a heading
         that asked the same question this one answers, and the two said the
         same sentence one above the other. */
      '<p class="b-story-now">' + o.now + '</p>' +
      (o.steps.length
        ? '<ol class="b-story-line">' + o.steps.map((x, i) =>
            '<li class="b-story-step' + (i === o.steps.length - 1 ? ' is-now' : '') +
              (x.gap ? ' is-gap' : '') + '">' +
              '<span class="b-story-dot ' + (TL_TONE[x.tone] || 'tone-neutral') + '"></span>' +
              '<span class="b-story-k">' + esc(x.k) + '</span>' +
              '<span class="b-story-t">' + esc(x.t) + '</span>' +
            '</li>').join('') + '</ol>'
        : '') +
      /* ══ THE THING TO DO, AND THE NOTE SOMEBODY LEFT ═══════════════════
         Two captioned rows of prose was a wireframe of this: they are two
         different kinds of thing and they look it now. What to do is a task
         — a mark, the sentence at the lead step, and the date it is owed as
         a chip that turns amber when it has passed. What to remember is a
         note — the initials of whoever wrote it, their sentence, and their
         name under it, which is how a note left by a colleague reads
         everywhere else. HubSpot and Outseta both draw the second one this
         way; Twenty draws the first. */
      ((o.next || o.mem)
        ? '<div class="b-nm">' +
            (o.next
              ? '<div class="b-nm-do' + (o.done ? ' is-done' : '') + '">' +
                  '<span class="b-nm-mark">' + (o.done ? nmTick() : nmClock()) + '</span>' +
                  '<span class="b-nm-text">' +
                    /* THE CHIP IS ABOVE THE SENTENCE. Trailing it, the chip
                       wrapped onto its own line anyway and read as an
                       afterthought to the instruction; what is owed and when
                       is the thing you look for first. */
                    (o.due ? '<span class="b-nm-due' + (o.due.late ? ' is-late' : '') + '">' +
                      esc(o.due.what) + ' · ' + esc(o.due.when) + '</span>' : '') +
                    '<span class="b-nm-say">' + o.next + '</span>' +
                    (o.hand ? '<span class="b-nm-then">' + o.hand + '</span>' : '') +
                  '</span>' +
                '</div>'
              : '') +
            (o.mem
              ? '<div class="b-nm-note">' +
                  faceOf(o.mem.id, 28) +
                  '<span class="b-nm-text">' +
                    '<span class="b-nm-said">' + esc(o.mem.text) + '</span>' +
                    '<span class="b-nm-by">' + esc(o.mem.by) + ' wrote this down</span>' +
                  '</span>' +
                '</div>'
              : '') +
          '</div>'
        : '') +
    '</section>';
  }
  /* Six steps at most: the first two and the last four. A chain longer than
     the eye can hold is a list again. */
  function storyTrim(steps) {
    if (steps.length <= 6) return steps;
    return steps.slice(0, 1).concat([{ k: '⋯', t: plural(steps.length - 5, 'step') + ' more', tone: 'neutral', gap: true }])
      .concat(steps.slice(-4));
  }
  function storyOf(c) {
    const all = (DB.touchesOf[c.id] || []).map((id) => TOUCH[id]).filter(Boolean)
      .sort((x, y) => (x.at < y.at ? -1 : 1));
    const calls = callsIn(all);
    const list = DB.list.filter((l) => l.has.indexOf(c.id) >= 0)[0];
    const camps = campsOf(c).filter(mine);
    const d = directorOf(c);
    const rg = RUNG[c.checkpoint] || RUNG['not-called'];
    const steps = [];
    /* where they came from */
    const foundBy = list && !(calls.length && calls[0].at.slice(0, 10) < list.at);
    steps.push(foundBy
      ? { k: 'Found by ' + list.via, t: sayDay(list.at), tone: 'neutral' }
      : { k: 'In the book', t: list ? 'listed ' + sayDay(list.at) : 'from the start', tone: 'neutral' });
    if (calls.length) steps.push({ k: 'First rung', t: sayDay(calls[0].at) + ' · ' + whoDid(calls[0]).name.split(' ')[0], tone: 'neutral' });
    all.filter((t) => t.moved && rank(t.moved[1]) > rank(t.moved[0])).forEach((t) =>
      steps.push({ k: rungLabel(t.moved[1]), t: sayDay(t.at), tone: (RUNG[t.moved[1]] || {}).tone || 'ok' }));
    const out = all.filter((t) => t.moved && isExit(t.moved[1]))[0];
    if (out) steps.push({ k: rungLabel(out.moved[1]), t: sayDay(out.at), tone: (RUNG[out.moved[1]] || {}).tone || 'warn' });
    phasesOf(c).forEach((t) => steps.push({
      k: t.decision ? (t.decision === 'won' ? 'Signed' : 'They said no') : (PHASE[t.phase] || {}).label,
      t: sayDay(t.at) + ' · ' + actor(t.by).name.split(' ')[0],
      tone: t.decision === 'lost' ? 'warn' : 'ok',
    }));
    /* where they stand, and what that costs you today */
    /* the owed thing is the chip on the task below, not a second sentence */
    const late = c.next ? daysBetween(TODAY_ISO, c.next.due) < 0 : false;
    const due = c.next
      ? { what: c.next.what, when: (late ? 'was due ' : 'due ') + sayWhen(c.next.due), late: late }
      : null;
    const now = '<b class="tone-' + esc(rg.tone) + '">' + esc(rg.label) + '</b> — ' + esc(rg.say) +
      (c.checkpointAt ? ', ' + esc(sayWhen(c.checkpointAt.slice(0, 10))) : '') + '.';
    const quiet = quietUnderFour(c);
    /* the caption says "Next", so the sentence does not have to */
    const plainNext = whatNext(c).replace(/^Next:\s*/, '').replace(/^./, (x) => x.toUpperCase());
    const done = c.checkpoint === 'handed-over' || isExit(c.checkpoint);
    const next = c.checkpoint === 'handed-over' ? esc(dealLine(c))
      : isExit(c.checkpoint) ? esc('That is where it ended. Nothing is owed.')
      : esc(plainNext + (quiet ? ' ' + quietSay(quiet, c) : ''));
    const hand = done ? '' :
      'Your part ends at <b>Interested</b> — ' + esc(d.name) + ' takes it from there.';
    return {
      now: now, steps: storyTrim(steps),
      next: next, hand: hand, due: done ? null : due, done: done,
      mem: c.remember
        ? { text: c.remember.text, by: actor(c.remember.by).name, id: c.remember.by }
        : null,
      cite: (camps.length ? listSay(camps.map((k) => k.name)) + ' · ' : '') +
        (all.length ? plural(all.length, 'touchpoint') + (calls.length !== all.length ? ', ' + plural(calls.length, 'call') : '') : 'nothing on the record'),
    };
  }
  /* The company's story: the same shape, read across its people. */
  function accStory(a, people, hist) {
    const calls = callsIn(hist).slice().sort((x, y) => (x.at < y.at ? -1 : 1));
    const live = people.filter((c) => !isExit(c.checkpoint));
    const reached = live.filter((c) => rank(c.checkpoint) >= rank('answered'));
    const top = live.slice().sort((x, y) => rank(y.checkpoint) - rank(x.checkpoint))[0];
    const steps = [];
    if (calls.length) steps.push({ k: 'First rung', t: sayDay(calls[0].at) + ' · ' + whoDid(calls[0]).name.split(' ')[0], tone: 'neutral' });
    const got = calls.filter((t) => t.outcome === 'reached')[0];
    if (got) steps.push({ k: 'Got through', t: sayDay(got.at) + ' · ' + esc((DB.byCon[got.con] || {}).name || '').split(' ')[0], tone: 'ok' });
    if (top && rank(top.checkpoint) >= rank('answered')) {
      steps.push({ k: rungLabel(top.checkpoint), t: top.name.split(' ')[0] +
        (top.checkpointAt ? ' · ' + sayDay(top.checkpointAt) : ''), tone: (RUNG[top.checkpoint] || {}).tone || 'ok' });
      phasesOf(top).slice(-1).forEach((t) => steps.push({
        k: t.decision ? (t.decision === 'won' ? 'Signed' : 'They said no') : (PHASE[t.phase] || {}).label,
        t: sayDay(t.at) + ' · ' + actor(t.by).name.split(' ')[0],
        tone: t.decision === 'lost' ? 'warn' : 'ok',
      }));
    }
    const now = calls.length
      ? '<b>' + commas(people.length) + '</b> on the record here, <b>' + commas(calls.length) + '</b> ' +
        verbFor(calls.length, 'call') + ' in, <b>' + commas(reached.length) + '</b> of them reached.'
      : '<b>' + commas(people.length) + '</b> on the record here, and nobody has been rung.';
    const handed = top && top.checkpoint === 'handed-over';
    const next = handed ? esc(dealLine(top))
      : top && rank(top.checkpoint) >= rank('answered')
        ? esc(whatNext(top).replace(/^Next:\s*/, '').replace(/^./, (x) => x.toUpperCase()) + ' (' + top.name.split(' ')[0] + ')')
        : '';
    return {
      now: now, steps: storyTrim(steps),
      next: next, done: handed,
      hand: (!handed && top && rank(top.checkpoint) >= rank('answered'))
        ? 'Your part ends at <b>Interested</b> — ' + esc(directorOf(top).name) + ' takes it from there.' : '',
      cite: a.city + ' · ' + INDUSTRY[a.industry].label,
    };
  }
  /* The hand-over from the company page: the furthest person, once warm. */
  function accHandBtn(people) {
    const warm = people.filter((c) => !isExit(c.checkpoint) && rank(c.checkpoint) >= rank('answered') && c.checkpoint !== 'handed-over')
      .sort((x, y) => rank(y.checkpoint) - rank(x.checkpoint))[0];
    if (!warm) return '';
    return mgrMenu(warm.id, 'Hand ' + warm.name.split(' ')[0] + ' over');
  }

  function whatNext(c) {
    switch (c.checkpoint) {
      case 'not-called':  return 'Next: ring them for the first time.';
      case 'no-answer':   return 'Next: try again, or find a number they answer.';
      case 'callback':    return 'Next: ring them back when they said.';
      case 'answered':    return 'Next: ask for the meeting, or send them something and ring again.';
      case 'meeting-set': return 'Next: the meeting happens, then say here whether they turned up.';
      case 'showed-up':   return 'Next: say whether they are interested. That is the last thing this rung is waiting on.';
      case 'interested':  return 'Next: hand them to the director. Past that it is discovery, proof, commercial and resolution — and none of those are yours.';
      case 'handed-over': return dealLine(c);
      case 'declined':    return 'Nothing is owed. Send the company profile if it has not gone, and ring again only if something has changed.';
      case 'wrong-number': return 'Nothing is owed until somebody finds a number that is theirs.';
      case 'do-not-call': return 'Nothing is owed, and nothing may be. They opted out.';
      default:            return 'Next: ring them.';
    }
  }

  /* The ladder: eight bars and one sentence. The bars carry the position, the
     sentence carries the meaning. An exit is not a rung — it lights the whole
     track in the exit's colour, because a lead that said no is not standing
     partway up anything. */
  /* ══ ONE DRAWING OF ONE CLIMB ══════════════════════════════════════════
     Eight coloured bars sat above the chain that names the same eight rungs,
     dates three of them and says who did it — two drawings of one climb, and
     the one on top could only say how far along it was. It said that with
     colour alone, so a reader had to know the ladder by heart before the
     bars meant anything, and then read the chain underneath to find out
     which rung was which anyway. The chain stays; the bars go with the
     function that drew them. */

  function rungCounts(list) {
    const out = Object.create(null);
    list.forEach((c) => (out[c.checkpoint] = (out[c.checkpoint] || 0) + 1));
    return out;
  }

  /* ══ THE BUCKETS — one per person, and they are also the ranking ═══════
     Every callable person is in exactly ONE of these, which is what lets the
     chips add up to All. A first cut made them overlapping filters — a
     meeting whose date has passed is both "after a meeting" and "due" — and
     then the row of counts adds to more than the list it sits above, which
     is the kind of arithmetic nobody can defend when asked.

     The order is the queue's order, and there is only one of them: `qRank`
     reads the same function, so the chips and the ranking cannot drift. */
  /* ══ THE CUTS ARE THE LADDER, AND NOTHING ELSE ═════════════════════════
     They were After a meeting · Due · Try again · Open · Never rung — five
     invented words for a cold caller to learn on top of the eight rungs the
     product already has. "Due" and "Open" are a CRM's vocabulary; the person
     dialling has one question, which is where this lead stands with me.

     So a cut IS a rung. Four of them, because four rungs are callable: you
     have not rung them, you rang and nobody answered, they asked to be rung
     back, or you got them and there is no meeting yet. Past that a meeting
     is booked and they leave the queue — the BDR's part is done until it
     happens. Nothing here has a name that is not already on the ladder. */
  const BUCKETS = [
    { k: 'callback',   label: 'Callbacks' },
    { k: 'not-called', label: 'New' },
    { k: 'no-answer',  label: 'No answer' },
    { k: 'answered',   label: 'Answered' },
    /* Not a rung: the meeting-set people whose day has passed. They are
       not dialled from here, they are answered for. */
    { k: 'after',      label: 'After meeting' },
  ];
  const bucketOf = (c) => (afterMeeting(c) ? 'after' : c.checkpoint);
  /* A cut is a rung at one desk and a stage at the other, and it is exactly
     one per person either way — which is what lets the chips add up to All. */
  const MGR_BUCKETS = DEAL_STAGES.map((x) => ({ k: x.k, label: x.label }));
  const cutOf = (c) => (isMgr() ? stageOf(c) : bucketOf(c));
  const B_ORDER = Object.create(null);
  BUCKETS.forEach((b, i) => (B_ORDER[b.k] = i));

  /* Why this person is on the list today, with the fact in it. A queue that
     cannot say why it ranked somebody is a queue you have to trust. */
  const owedBit = (c) => (c.next
    ? ' · ' + esc(c.next.what) + ' ' + (daysBetween(TODAY_ISO, c.next.due) < 0 ? 'was due ' : 'due ') + esc(sayWhen(c.next.due))
    : '');
  function whyLine(c) {
    switch (c.checkpoint) {
      case 'callback': {
        /* "28 Aug" on 6 Sep is nine days late, and the card should say so. */
        const late = c.next ? -daysBetween(TODAY_ISO, c.next.due) : 0;
        const when = c.next ? sayWhen(c.next.due) : sayWhen(c.lastCallAt);
        /* "4 days ago · 4 days late" said it twice; the suffix is for a date */
        return 'Asked to be rung back <b>' + esc(when) + '</b>' +
          (late > 0 && !/ago|yesterday|today/.test(when) ? ' · <b>' + esc(plural(late, 'day')) + ' late</b>' : '');
      }
      case 'not-called':
        return 'Never rung';
      case 'no-answer':
        return 'Rung <b>' + plural(c.attempts, 'time') + '</b>, last ' + esc(sayWhen(c.lastCallAt));
      case 'meeting-set':
        return afterMeeting(c)
          ? esc(c.next.what) + ' was <b>' + esc(sayWhen(c.next.due)) + '</b> — did they turn up?'
          : c.next ? esc(c.next.what) + ' <b>' + esc(sayWhen(c.next.due)) + '</b>' : 'Meeting set';
      /* ══ THE RUNGS PAST THE PHONE, AND THE WAYS OUT ═════════════════════
         A handed-over person's card said "Spoke to them 8 Aug, no meeting
         yet"; so did a do-not-call's. The line says where they are. */
      case 'showed-up':
        return 'Came to the meeting <b>' + esc(sayWhen(c.checkpointAt || c.lastCallAt)) + '</b>' + owedBit(c);
      case 'interested':
        return 'Interested since <b>' + esc(sayWhen(c.checkpointAt || c.lastCallAt)) + '</b>' + owedBit(c);
      case 'handed-over': {
        const ph = phasesOf(c);
        const fin = ph[ph.length - 1];
        return 'With <b>' + esc(directorOf(c).name) + '</b> since ' + esc(sayWhen(c.checkpointAt || c.lastCallAt)) +
          (fin ? ' · ' + (fin.decision ? (fin.decision === 'won' ? 'signed ' : 'said no ') + esc(sayWhen(fin.at.slice(0, 10)))
            : esc((PHASE[fin.phase] || {}).label || fin.phase) + ' held ' + esc(sayWhen(fin.at.slice(0, 10)))) : '');
      }
      case 'declined':
        return 'Said no <b>' + esc(sayWhen(c.checkpointAt || c.lastCallAt)) + '</b>';
      case 'wrong-number':
        return 'The number is not theirs';
      case 'do-not-call':
        return 'Asked not to be called';
      default:
        /* what is owed, if anything is — the same line the record shows */
        return c.next
          ? esc(c.next.what) + ' <b>' + (daysBetween(TODAY_ISO, c.next.due) < 0 ? 'was due ' : 'due ') +
            esc(sayWhen(c.next.due)) + '</b>'
          : 'Spoke to them <b>' + esc(sayWhen(c.lastCallAt)) + '</b>, no meeting yet';
    }
  }

  /* Every row does the same thing, because on this surface there is only one
     thing to do. It briefly said "Say what happened" on people whose meeting
     had passed — a second verb, for a second job, in the middle of a list you
     are dialling down. The call itself logs the touchpoint; a separate step
     to report the same call is the step this build exists to remove. */
  const rowVerb = () => 'Call';

  /* The ranked queue. Stated once and read everywhere, so home, the campaign
     page and the composer cannot disagree about who is next. */
  /* The leads on your desk. A manager's queue is not built from who is
     callable — everyone on it has already been spoken to, by somebody else —
     it is simply what was handed over and has not finished. */
  /* Late first, then the ones nobody has warm-called, then what is running,
     then what is decided — the order a manager would work them in, and the
     same order the chips are counted in. */
  function dealRank(c) {
    const st = stageOf(c);
    if (st === 'won' || st === 'lost') return 4;
    if (c.next && daysBetween(TODAY_ISO, c.next.due) < 0) return 0;
    if (st === 'qual') return 1;
    if (c.next && daysBetween(TODAY_ISO, c.next.due) === 0) return 2;
    return 3;
  }
  function dealQueue(campId, bucket) {
    let out = (DB.byMgr[me().id] || []).map((id) => DB.byCon[id]).filter(Boolean);
    if (campId) out = out.filter((c) => c.camps.indexOf(campId) >= 0);
    if (bucket && bucket !== 'all') out = out.filter((c) => stageOf(c) === bucket);
    out.sort((a, b) => dealRank(a) - dealRank(b) || (closeBy(a) < closeBy(b) ? -1 : 1));
    return UI.cap ? out.slice(0, UI.cap) : out;
  }

  function queue(campId, bucket) {
    if (isMgr()) return dealQueue(campId, bucket);
    const meId = me().id;
    const mineCamps = Object.create(null);
    myCampaigns().filter(campOpen).forEach((c) => (mineCamps[c.id] = 1));
    if (campId && DB.byCamp[campId] && !campOpen(DB.byCamp[campId])) return [];
    const pool = campId ? membersOf(campId) : DB.con;
    const out = [];
    for (let i = 0; i < pool.length; i++) {
      const c = pool[i];
      if (!c) continue;
      /* the after-meeting cut is the one place a non-callable person is listed */
      if (!callable(c) && !(bucket === 'after' && afterMeeting(c))) continue;
      if (campId) { if (c.camps.indexOf(campId) < 0) continue; }
      else {
        if (!c.camps.some((k) => mineCamps[k])) continue;
        if (c.owner && c.owner !== meId) continue;
      }
      if (bucket && bucket !== 'all' && bucketOf(c) !== bucket) continue;
      out.push(c);
    }
    out.sort((a, b) => qRank(a) - qRank(b) || qTie(a, b));
    return UI.cap ? out.slice(0, UI.cap) : out;
  }
  const qRank = (c) => B_ORDER[bucketOf(c)];
  function qTie(a, b) {
    /* A company that just moved, then the people the four-touch rule
       names, then the campaign closing first, then size. */
    const ga = signalOf(accOf(a)) ? 0 : 1, gb = signalOf(accOf(b)) ? 0 : 1;
    if (ga !== gb) return ga - gb;
    const qa = quietUnderFour(a) ? 0 : 1, qb = quietUnderFour(b) ? 0 : 1;
    if (qa !== qb) return qa - qb;
    const ea = earliestEnd(a), eb = earliestEnd(b);
    if (ea !== eb) return ea < eb ? -1 : 1;
    const sa = accOf(a) ? accOf(a).size : 0, sb = accOf(b) ? accOf(b).size : 0;
    return sb - sa;
  }
  function earliestEnd(c) {
    let best = '9999-12-31';
    for (let i = 0; i < c.camps.length; i++) {
      const k = DB.byCamp[c.camps[i]];
      if (k && k.to < best) best = k.to;
    }
    return best;
  }

  /* ══ THE WINDOWED LIST ═════════════════════════════════════════════════
     One component, used by every list in the product: the call queue, a
     campaign's people, a person's history, a list preview. It renders only
     the rows on screen.

     WHY IT MEASURES IN LAYOUT PIXELS. The shell carries `zoom` on <body>, so
     getBoundingClientRect returns VISUAL pixels — layout pixels times the UI
     scale. A row height written in CSS is in layout pixels. Mixing the two
     puts the window in the wrong place on every screen that is not exactly
     the anchor width, and it is wrong by a factor rather than by an offset,
     so it looks like the list is simply broken. `offsetTop`, `scrollTop` and
     `clientHeight` are all layout pixels; the walk up to .page-scroll is why
     that element is positioned.

     ONE LISTENER FOR ALL OF THEM. The scroller is shared, so a per-list
     listener would be N listeners doing one job. Mounted lists live in a
     registry and the single rAF-throttled handler renders whichever moved.

     API — vlist({ host, items, rowH, row, key, empty, onCursor })
       .update(items)  new data, same scroll position, cursor kept by key
       .focus(i)       move the cursor and scroll it into view
       .destroy()      unmount
     `row(item, i, isCursor)` returns an HTML string. Rows carry no listeners:
     clicks reach the delegated router like everything else. */

  const VLISTS = [];
  let vframe = 0;

  function vlist(o) {
    const host = o.host;
    const scroller = byId('pageScroll');
    const rowH = o.rowH;
    const overscan = o.overscan == null ? 8 : o.overscan;
    const self = {
      host: host, items: o.items || [], cursor: -1,
      first: -1, last: -1,
    };

    host.classList.add('b-vlist');

    /* The host's top in the scroller's own content coordinates. Walked rather
       than cached: a block above this one can change height on any repaint,
       and a cached offset would put the window off by that much until
       something happened to invalidate it. */
    function topOf() {
      let t = 0, el = host;
      while (el && el !== scroller) { t += el.offsetTop; el = el.offsetParent; }
      return t;
    }

    function render(force) {
      const n = self.items.length;
      host.style.height = (n * rowH) + 'px';
      if (!n) {
        host.innerHTML = o.empty ? '<div class="b-vfoot">' + esc(o.empty) + '</div>' : '';
        host.style.height = 'auto';
        self.first = self.last = -1;
        return;
      }
      const top = topOf();
      const st = scroller.scrollTop;
      /* ══ A ZERO VIEWPORT IS NOT AN EMPTY LIST ══════════════════════════
         `clientHeight` is 0 whenever the scroller has not been laid out —
         mounted before the fonts settle, inside a collapsed ancestor, or in
         a browser pane the host has hidden. The arithmetic then puts the
         window's end before its start and the list draws nothing, which is
         indistinguishable from having no rows. Measured: the queue reported
         zero children while holding a hundred and five people.

         A guess is better than nothing here, because it is self-correcting:
         the first real scroll or resize recomputes it with a true height. */
      const vh = scroller.clientHeight || 700;
      let first = Math.floor((st - top) / rowH) - overscan;
      let last = Math.ceil((st - top + vh) / rowH) + overscan;
      if (first < 0) first = 0;
      if (last > n) last = n;
      if (last < first) last = first;
      if (!force && first === self.first && last === self.last) return;
      self.first = first;
      self.last = last;
      /* The row carries its OWN class from sales.css — `.s-qrow` and friends
         — and `.b-vrow` only positions it. Two row designs for one product
         is how an appendix becomes a second design system. */
      const cls = (o.rowClass ? o.rowClass + ' ' : '') + 'b-vrow';
      let html = '';
      for (let i = first; i < last; i++) {
        html += '<article class="' + cls + (i === self.cursor ? ' is-cursor' : '') + '" data-i="' + i +
          '" style="height:' + rowH + 'px;transform:translateY(' + (i * rowH) + 'px)">' +
          o.row(self.items[i], i, i === self.cursor) + '</article>';
      }
      host.innerHTML = html;
    }

    self.update = function (items) {
      const keyFn = o.key;
      const wasKey = keyFn && self.cursor >= 0 && self.items[self.cursor]
        ? keyFn(self.items[self.cursor]) : null;
      self.items = items || [];
      if (wasKey != null) {
        let at = -1;
        for (let i = 0; i < self.items.length; i++) {
          if (keyFn(self.items[i]) === wasKey) { at = i; break; }
        }
        self.cursor = at;
      }
      render(true);
    };
    self.focus = function (i) {
      const n = self.items.length;
      if (!n) return;
      if (i < 0) i = 0;
      if (i >= n) i = n - 1;
      self.cursor = i;
      const top = topOf();
      const want = top + i * rowH;
      const st = scroller.scrollTop;
      const vh = scroller.clientHeight;
      /* Only scroll when the row is not already whole on screen. A list that
         re-centres on every keypress makes the eye chase the cursor. */
      if (want < st) scroller.scrollTop = want - rowH;
      else if (want + rowH > st + vh - 96) scroller.scrollTop = want + rowH + 96 - vh;
      render(true);
      if (o.onCursor) o.onCursor(self.items[i], i);
    };
    self.render = render;
    self.destroy = function () {
      const i = VLISTS.indexOf(self);
      if (i >= 0) VLISTS.splice(i, 1);
      host.classList.remove('b-vlist');
    };

    VLISTS.push(self);
    render(true);
    return self;
  }

  /* One scroll listener for every list on the page, rAF-throttled. Each list
     decides for itself whether its window actually moved. */
  function vscroll() {
    if (vframe) return;
    vframe = requestAnimationFrame(() => {
      vframe = 0;
      for (let i = 0; i < VLISTS.length; i++) VLISTS[i].render(false);
    });
  }
  byId('pageScroll').addEventListener('scroll', vscroll, { passive: true });
  window.addEventListener('resize', () => {
    for (let i = 0; i < VLISTS.length; i++) VLISTS[i].render(true);
  }, { passive: true });

  /* Every repaint drops the lists that were on the previous surface. A list
     left in the registry keeps rendering into a host that is no longer in the
     document, which costs nothing visible and grows for ever. */
  function dropLists() {
    VLISTS.length = 0;
  }

  /* ── Toast. Every write lands here and every write can be taken back from
     here, which is what makes a one-press control safe to offer. ── */
  let toastTimer = null;
  let UNDO = null;
  /* ══ THE TOAST ARRIVES AND LEAVES THE SAME WAY ═════════════════════════
     The library gives the toast a 220ms rise, and it never ran here: the
     element was inserted already .visible, so there was no first frame to
     rise from, and it left by innerHTML = '', which is no way to leave.
     @starting-style (bdr.css §31) gives the insertion its first frame;
     .is-leaving takes it out along the same axis; and a receipt arriving
     while one is up changes the words in place rather than re-entering. */
  function toastGone() {
    const el = byId('toastHost').querySelector('.s-toast');
    UNDO = null;
    if (toastTimer) { clearTimeout(toastTimer); toastTimer = null; }
    if (!el || el.classList.contains('is-leaving')) return;
    el.classList.add('is-leaving');
    setTimeout(() => { if (el.parentNode) el.remove(); }, 200);
  }
  function toast(msg, undo) {
    /* The library's toast, with its own clock: `.aimy-toast-progress` scales
       from 1 to 0 over the toast's life, so a receipt carrying an Undo says
       how long you have rather than reading as stuck. */
    const life = undo ? 6000 : 4000;
    UNDO = undo || null;
    if (toastTimer) clearTimeout(toastTimer);
    const inner =
      '<span class="aimy-toast-icon"><svg width="13" height="15" viewBox="0 0 18 20">' +
        '<use href="#aimy-logo-small"/></svg></span>' +
      '<span class="aimy-toast-body"><span class="aimy-toast-title">' + esc(msg) + '</span></span>' +
      (undo ? '<span class="aimy-toast-divider"></span>' +
        '<button class="aimy-toast-undo" type="button" data-undo>Undo</button>' : '') +
      '<span class="aimy-toast-progress"><span class="aimy-toast-progress-fill" ' +
        'style="animation-duration:' + life + 'ms"></span></span>';
    const host = byId('toastHost');
    const up = host.querySelector('.s-toast:not(.is-leaving)');
    if (up) up.innerHTML = inner;
    else host.innerHTML = '<div class="aimy-toast visible s-toast">' + inner + '</div>';
    toastTimer = setTimeout(toastGone, life);
  }

  /* ── The prototype panel. Not product UI: what the corpus holds, the way
     back to the previous build, and the reset. ── */
  function paintProto() {
    const p = byId('protoPanel');
    if (p.hidden) return;
    let bytes = 0;
    try { bytes = (localStorage.getItem(KEY_DB) || '').length; } catch (e) {}
    p.innerHTML =
      '<div class="proto-sec">' +
        '<div class="proto-h">Build</div>' +
        /* WHICH VERSION OF THE FILES YOU ARE ACTUALLY LOOKING AT. The `?v=`
           stamp makes every asset immutable, so a browser that loaded the
           page before a bump keeps serving the old stylesheet — and a defect
           fixed an hour ago is still on the screen with nothing saying why.
           Read off the script's own src, so it cannot claim a version it is
           not. If this number is behind, hard-reload. */
        '<div class="proto-build">' + esc(BUILD) + '</div>' +
      '</div>' +
      '<div class="proto-sec">' +
        '<div class="proto-h">What the corpus holds</div>' +
        '<div class="proto-build">' + commas(DB.con.length) + ' people · ' +
          commas(DB.touch.length) + ' calls · ' + commas(bytes) + ' bytes of your changes</div>' +
      '</div>' +
      '<div class="proto-sec">' +
        '<div class="proto-h">Looking as</div>' +
        REPS.map((x) =>
          '<button class="proto-link" type="button" data-as="' + esc(x.id) + '">' +
          esc(x.name) + ' · ' + esc(JOB[x.fn]) +
          (x.id === me().id ? ' — you' : '') + '</button>').join('') +
      '</div>' +
      '<div class="proto-sec">' +
        '<div class="proto-h">Queue</div>' +
        '<button class="proto-link" type="button" data-cap="3">Cap it at 3</button>' +
        '<button class="proto-link" type="button" data-cap="0">No cap' +
          (UI.cap ? '' : ' — on') + '</button>' +
      '</div>' +
      '<div class="proto-sec">' +
        '<div class="proto-h">Start over</div>' +
        '<button class="proto-link" type="button" data-reset>Reset to seed</button>' +
        '<a class="proto-link" href="old/" target="_blank" rel="noopener">The V3 build</a>' +
        '<div class="proto-build">Your changes live in this browser. The corpus itself is ' +
          'rebuilt from one seed on every load.</div>' +
      '</div>';
  }

  /* ══ 7b. THE CALL ═══════════════════════════════════════════════════════
     A call is live and timed, and you move around during one — you open the
     person, you read the campaign's pitch, you check what was said last
     time. So it is a shell region beside the main column, not a modal, and
     it survives everything the URL does by construction.

     FOUR STATES, AND THE MIDDLE ONE IS REACHED BY A PERSON. `ready` shows
     the brief and waits; pressing Start begins `connecting`; the clock only
     starts at `live`, because a timer running through the ringing lies about
     the one thing it measures; `logging` is after you hang up.

     THE TELEPHONY IS FIXTURE. No Twilio, no WebRTC, no network of any kind:
     a transcript grows a line at a time from a script chosen by the person's
     own `fate`, so a demo walked twice tells the same story twice. The one
     real-world handoff is the `tel:` link on the record. */

  const DIAL_MS = 1600;
  const LINE_MS = 4000;
  let CALL_DIAL = null, CALL_TICK = null, CALL_LINE = null;

  /* One script per fate, written so the reader reads each back to the fate it
     came from. `assets/audit.js` asserts exactly that — a fixture that drifts
     from the lexicon would make the panel's suggestion wrong in a way only a
     careful reader would ever notice. */
  /* ══ TWENTY CALLS, AND EACH ONE ENDS DIFFERENTLY ═══════════════════════
     Five scripts meant five calls in a row told you three stories, and a
     caller walking the queue saw the same gatekeeper four times before the
     first meeting. Worse for the thing they are here to judge: four of the
     seven outcomes, two of the six proposals and none of the eight openings
     ever appeared, so most of what a logged call can say was unreachable by
     walking the product.

     So there is one scenario per shape the record can take. Every outcome
     appears, every objection, every opening the reader has a word for, and
     the proposals that a transcript can actually carry. `disp`, `props`,
     `objs` and `opps` on each are not decoration: `assets/audit.js` runs the
     reader over every script and fails the build if what it reads back is
     not what the scenario declares. A fixture that drifts from the lexicon
     makes AiMY's suggestion wrong in a way only a careful reader would ever
     catch, and nobody reads carefully on call ninety.

     WHY THE DECLARED VALUES ARE SOMETIMES A SET. "Send me a demo" is a demo
     asked for AND something to send, and the reader says both because the
     sentence says both. Declaring one would be asking the audit to bless a
     narrower reading than the words support. */
  const SCENARIOS = [
    { k: 'demo-pricing',      disp: 'reached',        props: ['demo'],     objs: ['pricing'], opps: [] },
    { k: 'meeting-timing',    disp: 'reached',        props: ['meeting'],  objs: ['timing'],  opps: [] },
    { k: 'proposal-feature',  disp: 'reached',        props: ['proposal'], objs: ['feature'], opps: [] },
    { k: 'info-service',      disp: 'reached',        props: ['info'],     objs: ['service'], opps: [] },
    { k: 'reached-unsure',    disp: 'reached',        props: ['info'],     objs: ['other'],   opps: [] },
    { k: 'reached-plain',     disp: 'reached',        props: [],           objs: [],          opps: [] },
    { k: 'reached-funded',    disp: 'reached',        props: ['demo'],     objs: [],          opps: ['funded'] },
    { k: 'reached-hiring',    disp: 'reached',        props: ['info'],     objs: [],          opps: ['hiring'] },
    { k: 'reached-renewal',   disp: 'reached',        props: ['meeting'],  objs: [],          opps: ['renewal-near'] },
    { k: 'reached-newhire',   disp: 'reached',        props: ['meeting'],  objs: [],          opps: ['new-hire'] },
    { k: 'reached-promoted',  disp: 'reached',        props: ['meeting'],  objs: [],          opps: ['promotion'] },
    { k: 'reached-moved',     disp: 'reached',        props: ['demo'],     objs: [],          opps: ['job-change'] },
    { k: 'reached-site',      disp: 'reached',        props: ['info'],     objs: [],          opps: ['visited-site'] },
    { k: 'callback-thursday', disp: 'callback',       props: ['callback'], objs: [],          opps: [] },
    { k: 'callback-nextweek', disp: 'callback',       props: ['callback'], objs: ['timing'],  opps: [] },
    { k: 'gatekeeper-msg',    disp: 'gatekeeper',     props: [],           objs: [],          opps: [] },
    { k: 'gatekeeper-mobile', disp: 'gatekeeper',     props: [],           objs: [],          opps: [] },
    { k: 'no-answer-vm',      disp: 'no-answer',      props: [],           objs: [],          opps: [] },
    { k: 'no-answer-rang',    disp: 'no-answer',      props: [],           objs: [],          opps: [] },
    { k: 'declined-signed',   disp: 'not-interested', props: [],           objs: [],          opps: [] },
    { k: 'declined-nofit',    disp: 'not-interested', props: [],           objs: [],          opps: [] },
    { k: 'wrong-number',      disp: 'wrong-number',   props: [],           objs: [],          opps: [] },
    { k: 'do-not-call',       disp: 'do-not-call',    props: [],           objs: [],          opps: [] },
  ];

  /* `{first}` is the only token, because a fixture that interpolates a
     company and a sector reads like a mail merge rather than like somebody
     talking. */
  const CALL_SCRIPTS = {
    'demo-pricing': [
      ['you', 'Morning — is that {first}?'],
      ['them', 'Speaking.'],
      ['you', 'I will keep it short. We take the support desk work off teams your size.'],
      ['them', 'Go on, I am open to hearing it.'],
      ['you', 'Rather than talk at you, could I show you the thing working?'],
      ['them', 'Book me a demo next week. The price will decide it, mind.'],
    ],
    'meeting-timing': [
      ['you', 'Morning {first}, have you got two minutes?'],
      ['them', 'Go on.'],
      ['you', 'We take the support desk work off teams your size. Worth half an hour?'],
      ['them', 'That was a good chat. Put a meeting in the diary, but nothing before Q1.'],
    ],
    'proposal-feature': [
      ['you', 'Morning — is that {first}?'],
      ['them', 'Speaking.'],
      ['you', 'We take the support desk work off teams your size.'],
      ['them', 'Promising. Send a proposal — though it does not do the routing we need.'],
    ],
    'info-service': [
      ['you', 'Morning {first} — two minutes?'],
      ['them', 'Receptive enough, go on.'],
      ['you', 'We take the support desk work off teams your size.'],
      ['them', 'Send me the one pager. Weekend cover is out of scope for you though.'],
    ],
    'reached-unsure': [
      ['you', 'Morning — is that {first}?'],
      ['them', 'It is.'],
      ['you', 'We take the support desk work off teams your size.'],
      ['them', 'Good conversation, but I am not convinced yet. Send me the case study.'],
    ],
    'reached-plain': [
      ['you', 'Morning {first} — two minutes?'],
      ['them', 'Go ahead.'],
      ['you', 'We take the support desk work off teams your size.'],
      ['them', 'Good chat. Leave it with me and I will come back to you.'],
    ],
    'reached-funded': [
      ['you', 'Morning — is that {first}?'],
      ['them', 'Speaking, and I am open to it.'],
      ['you', 'We take the support desk work off teams your size.'],
      ['them', 'We closed a round last month, so give me the walkthrough.'],
    ],
    'reached-hiring': [
      ['you', 'Morning {first} — two minutes?'],
      ['them', 'Interested, go on.'],
      ['you', 'We take the support desk work off teams your size.'],
      ['them', 'We are growing the team this year. Send me the deck.'],
    ],
    'reached-renewal': [
      ['you', 'Morning — is that {first}?'],
      ['them', 'Speaking. Keen to hear it, actually.'],
      ['you', 'We take the support desk work off teams your size.'],
      ['them', 'Our contract ends in March. Put a meeting in the diary before then.'],
    ],
    'reached-newhire': [
      ['you', 'Morning {first} — have you got two minutes?'],
      ['them', 'Positive, yes, go on.'],
      ['you', 'We take the support desk work off teams your size.'],
      ['them', 'Our new head of support starts Monday. Worth half an hour with them.'],
    ],
    'reached-promoted': [
      ['you', 'Morning {first} — and congratulations on the promotion.'],
      ['them', 'Thank you. I am open to a look.'],
      ['you', 'We take the support desk work off teams your size.'],
      ['them', 'Put half an hour in the diary and I will bring the team lead.'],
    ],
    'reached-moved': [
      ['you', 'Morning {first} — I heard Sofie has moved on. Are you covering it?'],
      ['them', 'I am, and I am open to hearing it.'],
      ['you', 'We take the support desk work off teams your size.'],
      ['them', 'Set up a demo and I will see it working myself.'],
    ],
    'reached-site': [
      ['you', 'Morning {first} — I saw you downloaded the guide last week.'],
      ['them', 'I did. Go on then.'],
      ['you', 'We take the support desk work off teams your size.'],
      ['them', 'Receptive, yes. Send me the case study and I will read it tonight.'],
    ],
    'callback-thursday': [
      ['you', 'Morning — is that {first}?'],
      ['them', 'It is, but you have caught me walking into something.'],
      ['you', 'No problem at all. When suits?'],
      ['them', 'Call me back Thursday.'],
    ],
    'callback-nextweek': [
      ['you', 'Morning {first} — two minutes?'],
      ['them', 'Not now, we are mid quarter close.'],
      ['you', 'Understood. When is better?'],
      ['them', 'Ring back next week and I will have the numbers.'],
    ],
    'gatekeeper-msg': [
      ['you', 'Morning, could I speak to {first}?'],
      ['them', 'Can I take a message? She is in workshops all week.'],
      ['you', 'When is the best time to try them?'],
      ['them', 'I could not say. I will pass it on.'],
    ],
    'gatekeeper-mobile': [
      ['you', 'Morning, is {first} about?'],
      ['them', 'This is the front desk. Who is calling?'],
      ['you', 'It is Engy. Is there a better way to reach them?'],
      ['them', 'For next time, they take calls on the mobile, not through me.'],
    ],
    'no-answer-vm': [
      ['you', 'Dialling…'],
      ['them', 'You have reached the voicemail of {first}.'],
      ['you', 'Left a voicemail asking for ten minutes.'],
    ],
    'no-answer-rang': [
      ['you', 'Dialling…'],
      ['them', 'The line rings out.'],
      ['you', 'Nobody picked up on the second ring either.'],
    ],
    'declined-signed': [
      ['you', 'Morning — is that {first}?'],
      ['them', 'It is.'],
      ['you', 'We take the support desk work off teams your size.'],
      ['them', 'Not interested. We signed with someone in the spring.'],
    ],
    'declined-nofit': [
      ['you', 'Morning {first} — two minutes?'],
      ['them', 'Go on.'],
      ['you', 'We take the support desk work off teams your size.'],
      ['them', 'Not a fit for us, we do it all in house. No thanks.'],
    ],
    'wrong-number': [
      ['you', 'Morning, could I speak to {first}?'],
      ['them', 'You have the wrong number. There is nobody here by that name.'],
      ['you', 'Apologies for the trouble.'],
    ],
    'do-not-call': [
      ['you', 'Morning, is that {first}?'],
      ['them', 'Take me off your list. Do not contact me on this number.'],
      ['you', 'Understood. You will not hear from us.'],
    ],
  };

  function scriptFor(c) {
    const s = CALL_SCRIPTS[c.fate] || CALL_SCRIPTS['reached-plain'];
    const first = c.name.split(' ')[0];
    return s.map((l) => [l[0], l[1].split('{first}').join(first)]);
  }

  /* ══ THE HANDSET, AS THE SHAPES EVERYBODY ALREADY KNOWS ═════════════════
     Mute · Hold · Hang up were words in a row of pills. Jakob's Law is the
     whole argument: every phone anybody has held for twenty years puts a
     struck-through microphone, two bars and a tilted handset in that order,
     and a caller reaching for one mid-conversation is not reading. `hangup`
     is the handset rotated 135° — the shape a receiver makes going back into
     a cradle, which is why it means what it means. The V3 build's icons,
     unchanged. */
  const ICONS = {
    dot: '<circle cx="12" cy="12" r="6"/>',
    mic: '<path d="M12 3a3 3 0 013 3v6a3 3 0 01-6 0V6a3 3 0 013-3z"/><path d="M5 11a7 7 0 0014 0M12 18v3M9 21h6"/>',
    'mic-off': '<path d="M15 9V6a3 3 0 00-5.9-.7M9 9v3a3 3 0 004.6 2.5"/><path d="M5 11a7 7 0 0011.5 5.4M19 11a7 7 0 01-.3 2M12 18v3M9 21h6"/><path d="M3 3l18 18"/>',
    play: '<path d="M7 4l12 8-12 8z"/>',
    pause: '<path d="M9 5v14M15 5v14"/>',
    phone: '<path d="M5 3h4l2 5-2.5 1.5a12 12 0 006 6L16 13l5 2v4a2 2 0 01-2 2A16 16 0 013 5a2 2 0 012-2z"/>',
    hangup: '<g transform="rotate(135 12 12)"><path d="M5 3h4l2 5-2.5 1.5a12 12 0 006 6L16 13l5 2v4a2 2 0 01-2 2A16 16 0 013 5a2 2 0 012-2z"/></g>',
  };
  const chIcon = (k) =>
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" ' +
    'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    (ICONS[k] || '') + '</svg>';

  const callOn = () => (DB.call ? DB.byCon[DB.call.con] : null);
  const fmtClock = (s) => Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');

  function clearCallTimers() {
    if (CALL_DIAL) { clearTimeout(CALL_DIAL); CALL_DIAL = null; }
    if (CALL_TICK) { clearInterval(CALL_TICK); CALL_TICK = null; }
    if (CALL_LINE) { clearInterval(CALL_LINE); CALL_LINE = null; }
  }

  /* Which campaign this call belongs to. A person can be on two; the one that
     matters is a campaign of mine, because that is the work I am doing. */
  function campFor(c) {
    const k = c.camps.filter((x) => DB.byCamp[x] && mine(DB.byCamp[x]))[0] || c.camps[0];
    return k || null;
  }

  /* The director a lead is handed to: the owner of the campaign it is on. */
  /* ══ WHOSE DESK, AS A FACT RATHER THAN A POINT OF VIEW ══════════════════
     `directorOf` answers this for the person reading — it runs through
     `campFor`, which prefers a campaign the reader is on — and that is right
     for a sentence on a page and wrong for an index, which would be rebuilt
     differently for every viewer. This reads the first campaign, which is
     the one the seed itself used when it wrote "Handed to …" on the record,
     so the index and the note cannot disagree. */
  function mgrOf(c) {
    if (c && c.manager && REP[c.manager]) return c.manager;
    const k = c && c.camps.length ? DB.byCamp[c.camps[0]] : null;
    return k && k.owner ? k.owner : MANAGERS[0].id;
  }

  function directorOf(c) {
    /* whoever it was handed to, else whoever owns the campaign it is on */
    if (c && c.manager && REP[c.manager]) return REP[c.manager];
    const k = DB.byCamp[campFor(c)];
    return actor(k && k.owner ? k.owner : MANAGERS[0].id);
  }

  function startCall(id, sess) {
    const c = DB.byCon[id];
    if (!c) return;
    if (!c.phone) { toast('No number on file for ' + c.name + '. Nothing to dial.'); return; }
    if (c.dnc) { toast(c.name + ' asked not to be called again.'); return; }
    clearCallTimers();
    DB.call = {
      con: id, camp: campFor(c), state: 'ready', secs: 0,
      script: scriptFor(c), shown: 0, note: '', outcome: null, read: null,
      when: 1, recording: false, muted: false, held: false, asking: false, notice: false,
      auto: false, sess: sess || (DB.call && DB.call.sess) || null,
    };
    document.body.classList.add('is-calling');
    paintCall();
    /* The brief goes up as the phone is about to ring, not after. It is a
       stored turn, so every toast and repaint for the rest of the run leaves
       it standing. */
    callPrep(c);
  }

  function callGo() {
    const c = DB.call;
    if (!c || c.state !== 'ready') return;
    c.state = 'connecting';
    paintCall();
    CALL_DIAL = setTimeout(() => {
      CALL_DIAL = null;
      if (!DB.call || DB.call.state !== 'connecting') return;
      DB.call.state = 'live';
      DB.call.secs = 0;
      CALL_TICK = setInterval(() => {
        if (!DB.call) return;
        DB.call.secs++;
        const el = byId('callTimer');
        if (el) el.textContent = (DB.call.held ? 'On hold · ' : '') + fmtClock(DB.call.secs);
      }, 1000);
      CALL_LINE = setInterval(growTranscript, LINE_MS);
      growTranscript();
      paintCall();
    }, DIAL_MS);
  }

  /* THE TRANSCRIPT ONLY GROWS WHILE RECORDING, which is what makes "Not
     recording. Nothing is being written down." a true sentence rather than a
     caption over a transcript that is being written down anyway. */
  function growTranscript() {
    const c = DB.call;
    if (!c || c.state !== 'live' || !c.recording) return;
    if (c.shown >= c.script.length) { clearInterval(CALL_LINE); CALL_LINE = null; return; }
    c.shown++;
    const host = byId('callLines');
    if (host) { host.innerHTML = transcriptHtml(c); host.scrollTop = host.scrollHeight; }
  }
  /* WHO SAID IT, ON EVERY LINE. A transcript without speakers is a wall of
     sentences, and the one thing a caller scans it for afterwards is what
     THEY said. `Them` rather than their name, because the person who picks
     up a switchboard is not the person you rang. */
  function transcriptHtml(c) {
    if (!c.recording) {
      return '<p class="call-none">Not recording. Nothing is being written down.</p>';
    }
    if (!c.shown) return '<p class="call-none">Recording. Nothing said yet.</p>';
    return c.script.slice(0, c.shown).map((l) => {
      const them = l[0] !== 'you';
      return '<p class="call-line ' + (them ? 'is-them' : 'is-you') + '">' +
        '<span class="call-who">' + esc(them ? 'Them' : me().name.split(' ')[0]) + '</span>' +
        esc(l[1]) + '</p>';
    }).join('');
  }
  const transcriptText = (c) => c.script.slice(0, c.shown).map((l) => l[1]).join(' ');

  /* Hanging up is where AiMY reads what it heard. The reading is a
     SUGGESTION — it lights an outcome and shows what it took from the call,
     and nothing is written until you press Log. */
  /* ══ HANGING UP CLOSES THE RAIL ═════════════════════════════════════════
     The rail is one call. When the call is over there is no call, so it goes
     — and the whole of the logging happens in the canvas, where AiMY has
     already been keeping the record of the run. Keeping the rail up in a
     fourth "logging" state gave the surface two places to answer the same
     question and put a form back in the column that had just lost one.

     What the call leaves behind is `PENDING`: everything the write needs,
     held outside `DB.call` because `DB.call` means a call is happening. */
  /* ══ AN OBSTACLE IMPLIES SOMEBODY SAID IT ══════════════════════════════
     "Pricing is the obstacle, you asked for another call" cannot sit under
     "I read that as no answer": nobody objected, nobody was asked. When the
     transcript could not tell and the note names an objection or a request,
     the disposition follows the note — a callback if that is all that was
     asked, connected otherwise. */
  function impliedDisp(disp, props, objs) {
    if (disp && disp !== 'no-answer' && disp !== 'gatekeeper') return disp;
    const ps = props || [], os = objs || [];
    if (!ps.length && !os.length) return disp;
    if (ps.length === 1 && ps[0] === 'callback' && !os.length) return 'callback';
    return 'reached';
  }

  function endCall() {
    const c = DB.call;
    if (!c || c.state === 'ready') return;
    clearCallTimers();
    const heard = readCall(transcriptText(c));
    /* the note typed during the call speaks per axis, and can imply contact */
    const noted = c.note ? readCall(c.note) : null;
    const disp = impliedDisp((noted && noted.disp) || heard.disp,
      noted && noted.props.length ? noted.props : heard.props,
      noted && noted.objs.length ? noted.objs : heard.objs);
    PENDING = {
      con: c.con, camp: c.camp, secs: c.secs, sess: c.sess, auto: c.auto,
      lines: c.script.slice(0, c.shown).map((l) => ({ who: l[0], text: l[1] })),
      note: c.note, read: heard, outcome: disp || 'no-answer',
      guessed: !disp, when: (noted && noted.when) || heard.when || 1,
    };
    DB.call = null;
    document.body.classList.remove('is-calling');
    paintCall();
    callLogPropose();
  }

  let PENDING = null;

  /* ══ WHEN IT CANNOT TELL, IT UNDER-CLAIMS ══════════════════════════════
     `PENDING.outcome` falls back to `no-answer` rather than to `reached`.
     An earlier cut claimed contact whenever any line had been said, and the
     first line of every script is the CALLER'S own opening — hang up two
     seconds in and AiMY lit Connected on the evidence of "could I speak to
     Sofie?", a claim that you reached somebody made out of you asking to.

     `no-answer` is the honest default: the one outcome that does not assert
     contact at all, so guessing it wrong costs a correction rather than a
     false record of a conversation. */

  /* ══ WHAT A CALL DOES TO A LEAD ═════════════════════════════════════════
     Pure, and the only thing that moves a rung on a call. A checkpoint never
     goes BACKWARDS on a call — ringing somebody you have already met does
     not un-meet them — and an exit is never climbed out of by a call, only
     by Undo. */
  /* ══ THE FOLLOW-UP DELAY IS AN ARGUMENT ═══════════════════════════════
     This read the date chips on the live call panel, which is fine while a
     person is holding the phone and null the moment AiMY is. Every outcome
     that owes a follow-up threw, the tick died inside its own setInterval,
     and the run limped on losing exactly the calls that went WELL — a
     connected call asking for a meeting, and a callback. The summary then
     reported, truthfully, that nobody got through, about a run that had
     silently dropped its successes.

     Seven days is the default because that is what the sentence reader
     answers for a follow-up naming no day. */
  function moveFor(c, outcome, props, when) {
    const days = when == null ? (DB.call ? DB.call.when : 7) : when;
    const at = rank(c.checkpoint);
    const has = (k) => props.indexOf(k) >= 0;
    const up = (k) => (isExit(c.checkpoint) ? null : rank(k) > at ? k : null);
    if (outcome === 'do-not-call') return { to: 'do-not-call', next: null, dnc: true };
    if (outcome === 'wrong-number') return { to: 'wrong-number', next: null };
    if (outcome === 'not-interested') return { to: 'declined', next: null };
    /* ══ A LEAD THAT HAS LEFT OWES NOTHING ═══════════════════════════════
       `up` has always refused to climb out of an exit. The follow-up beside
       it did not, so a connected call on a declined lead proposed "stays at
       Declined" and "Demo for them, tomorrow" in the same card — a queue
       entry for a call nobody may make, on a person who has said no.

       Below the three outcomes above, on purpose: one exit can still become
       another, and somebody who declined and then asks to be taken off the
       list has to be able to be. */
    if (isExit(c.checkpoint)) return { to: null, next: null };
    if (outcome === 'no-answer' || outcome === 'gatekeeper') {
      /* ══ A NO-ANSWER ON A CALLBACK MOVES THE DATE ═════════════════════
         Ringing an overdue callback and getting nobody left the date where
         it was, so the same person sat first in the queue again the moment
         the call was logged. The day moves to tomorrow: still a callback,
         still owed, behind today's. */
      const owed = c.checkpoint === 'callback' && c.next && c.next.due <= TODAY_ISO;
      return { to: up('no-answer'), next: owed ? { what: c.next.what, due: dayAdd(1) } : null };
    }
    if (outcome === 'callback') {
      return { to: up('callback'), next: { what: 'Call them back', due: dayAdd(days) } };
    }
    /* Connected. What was asked for decides how far it moves. */
    if (has('meeting') || has('demo')) {
      return {
        to: up('meeting-set'),
        next: { what: has('demo') ? 'Demo for them' : 'Meeting with them', due: dayAdd(days) },
      };
    }
    if (has('callback')) return { to: up('answered'), next: { what: 'Call them back', due: dayAdd(days) } };
    if (has('info')) return { to: up('answered'), next: { what: 'Send what was promised', due: dayAdd(1) } };
    if (has('proposal')) return { to: up('answered'), next: { what: 'Proposal to them', due: dayAdd(3) } };
    return { to: up('answered') };
  }

  /* ══ ONE WRITE, TWO PLACES IT SHOWS ═════════════════════════════════════
     The touchpoint and the contact's rung are the whole of it. Everything
     the campaign reports — how many are left to call, how many callbacks are
     due, how many meetings are set, its rung tally, its feed — is derived
     from those two, so the person's record and the campaign they are on
     cannot disagree about what just happened. */
  function logCall() {
    const call = PENDING;
    if (!call) return;
    const c = DB.byCon[call.con];
    /* The same resolution the card showed, so agreeing to a card and writing
       a record cannot produce two different calls. */
    const heard = logHeard(call);
    const props = heard.props;
    const objs = heard.objs;
    const opps = heard.opps;
    const outcome = call.outcome || 'no-answer';

    const before = {
      checkpoint: c.checkpoint, checkpointAt: c.checkpointAt, attempts: c.attempts,
      lastCallAt: c.lastCallAt, next: c.next, remember: c.remember, dnc: c.dnc,
    };
    const mv = moveFor(c, outcome, props, call.when);
    const now = new Date().toISOString();
    const t = {
      id: 't' + (Date.now().toString(36)) + Math.floor(Math.random() * 1000),
      con: c.id, camp: call.camp, by: me().id, at: now,
      secs: call.secs, outcome: outcome, auto: !!call.auto,
      proposals: props, objections: objs, openings: opps,
      note: call.note || (heard.disp ? 'Logged from the call.' : 'No answer.'),
      lines: call.lines || [],
      next: mv.next || null,
      moved: mv.to ? [c.checkpoint, mv.to] : null,
      rung: mv.to || c.checkpoint,
    };
    const fields = { attempts: c.attempts + 1, lastCallAt: now };
    if (mv.to) { fields.checkpoint = mv.to; fields.checkpointAt = now; }
    if (mv.next) fields.next = mv.next;
    if (mv.dnc) fields.dnc = true;
    /* A terminal owes nothing. Leaving a callback on a lead that has just
       opted out is a queue entry for a call nobody may make. */
    if (mv.to && isExit(mv.to)) fields.next = null;
    const remember = heard.remember;
    if (remember) fields.remember = { text: remember, by: me().id, at: now };

    patchCon(c, fields);
    addTouch(t);

    const camp = DB.byCamp[call.camp];
    const said = OUTCOME[outcome] ? OUTCOME[outcome].label.toLowerCase() : outcome;
    const moved = mv.to ? ' · moved to ' + rungLabel(mv.to) : '';
    const where = camp ? ' · ' + camp.name + ' now has ' +
      plural(queue(camp.id).length, 'person') + ' to call' : '';
    const again = mv.next && (outcome === 'no-answer' || outcome === 'gatekeeper')
      ? ' · due again ' + sayWhen(mv.next.due) : '';
    toast('Logged ' + said + ' with ' + c.name.split(' ')[0] + moved + again + where, () => {
      dropTouch(t.id);
      patchCon(c, before);
      paint();
      paintCall();
    });

    /* THE QUESTION HAS BEEN ANSWERED, so its shortcut stops being live. The
       turn keeps its button on screen — the thread is a record — but a
       second press would write the same call twice. */
    lbuildSpend();
    paintThread();

    const sess = call.sess;
    const conId = call.con;
    PENDING = null;
    /* THE CANVAS GETS OUT OF THE WAY. On a single call it is the last
       thing between you and the queue, and leaving it up made a write
       that had moved a person, moved a campaign and written a touchpoint
       look like a toast and nothing else. Inside a run it stays: there it
       is the record of the run, and the next call is already dialling. */
    if (!sess) hideCanvas();
    advance(sess, conId);
  }

  /* On to the next one in the session, or done. */
  function advance(sess, conId) {
    if (!sess) { closeCall(); paint(); return; }
    if (conId && sess.done.indexOf(conId) < 0) sess.done.push(conId);
    const nextId = sess.ids.filter((id) =>
      sess.done.indexOf(id) < 0 && sess.skipped.indexOf(id) < 0)[0];
    if (!nextId) {
      sess.finished = new Date().toISOString();
      closeCall();
      paint();
      sessionSummary(sess);
      return;
    }
    startCall(nextId, sess);
    paint();
  }

  function skipCall() {
    const call = DB.call;
    if (!call) return;
    if (call.sess) {
      call.sess.skipped.push(call.con);
      const sess = call.sess;
      advance(sess);
      return;
    }
    closeCall();
  }

  function closeCall() {
    clearCallTimers();
    DB.call = null;
    document.body.classList.remove('is-calling');
    paintCall();
  }

  /* A run through a set. AiMY's version is advanced by a clock and yours by a
     disposition; only the tick differs, so a session is not a second call
     model and not a page of its own. */
  function callAll(ids) {
    const live = ids.filter((id) => DB.byCon[id] && DB.byCon[id].phone && !DB.byCon[id].dnc);
    if (!live.length) { toast('Nobody in this set has a number to ring.'); return; }
    const sess = { id: 's' + Date.now().toString(36), ids: live, done: [], skipped: [], at: new Date().toISOString() };
    startCall(live[0], sess);
    paint();
  }

  function paintCall() {
    const host = byId('callPanel');
    host.hidden = !DB.call;
    host.innerHTML = DB.call ? callPanel() : '';
  }

  /* ══ THE RAIL IS ONE CALL, AND NOTHING ELSE ═════════════════════════════
     Five rows, and they are the V3 build's: the state, who you are speaking
     to, what is being said, somewhere to write, and the four shapes every
     telephone has.

     AND IT IS THE SAME RAIL IN A RUN. Skip was still in the handset row, and
     because End and Start take the full width of that row it wrapped to a
     line of its own — so a bulk run's rail was a row taller than a single
     call's, the notes field sat higher, and the two did not read as the same
     column. The build had already ruled on this one: the run's controls left
     this panel because in here they have no visible object, and they live on
     the brief in the canvas under a sentence naming the run, where Skip this
     one and Stop the run sit together. The counter stays, because "1 of 15"
     is something the rail knows rather than something it does.

     THE BRIEF IS NOT HERE. It is preparation, and preparation belongs in the
     canvas beside the rest of it — copying three of its lines into this
     column made a second, shorter, differently-worded version of a block six
     inches to the left.

     NEITHER IS THE OUTCOME ROW. Logging stopped being a form for a reason:
     AiMY reads the call and proposes what it heard, and you agree in a word
     or correct it in a sentence. Seven radios in a column whose every other
     word is about one person is the form coming back. */
  function callPanel() {
    const call = DB.call;
    const c = callOn();
    if (!c) return '';
    const a = accOf(c);
    const ready = call.state === 'ready';
    const dialing = call.state === 'connecting';
    const sess = call.sess;
    const at = sess ? sess.done.length + sess.skipped.length + 1 : 0;

    return '<div class="call-head">' +
        '<span class="call-live' + (ready ? ' is-ready' : dialing ? ' is-dialing' : '') +
          '" aria-hidden="true"></span>' +
        /* The word replaces the clock rather than sitting beside it: a clock
           reading 0:00 next to "Connecting" is two things saying one thing,
           and one of them is a number that has not started. */
        '<span class="call-timer" id="callTimer">' +
          (ready ? 'Ready to call' : dialing ? 'Connecting…' : (call.held ? 'On hold · ' : '') + fmtClock(call.secs)) + '</span>' +
        (call.auto
          ? '<span class="work-state ws-drafted" data-work-state="drafted">AiMY placed it</span>'
          : '') +
        (sess ? '<span class="call-of" id="callOf">' + at + ' of ' + sess.ids.length +
          '</span>' : '') +
      '</div>' +

      '<div class="call-who-block">' +
        '<p class="call-name">' + esc(c.name) + '</p>' +
        '<p class="call-sub">' + esc(c.title) + ' · ' + esc(a ? a.name : '') + '</p>' +
        (c.phone ? '<p class="call-num">' + esc(c.phone) + '</p>' : '') +
      '</div>' +

      /* ALWAYS RENDERED, in every state. `.call-lines` is `flex: 1 1 0` —
         it is what pushes Notes and the handset to the foot of the column —
         so leaving it out in `ready` collapsed the whole rail upward and the
         controls floated under the phone number. */
      '<div class="call-lines" id="callLines">' + transcriptHtml(call) + '</div>' +

      '<label class="ds-field call-note-field">' +
        '<span class="s-field-label">Notes</span>' +
        '<textarea class="ds-textarea" rows="2" spellcheck="false" data-note ' +
          'placeholder="Anything worth keeping.">' + esc(call.note) + '</textarea>' +
      '</label>' +

      /* ══ THE NOTICE IS A DOOR, NOT A PANEL ═══════════════════════════════
         Recording cannot start until they have been told, and the asking is
         one line with two answers rather than a block explaining the law. */
      (call.asking
        ? '<div class="call-consent" role="group" aria-labelledby="callConsentSay">' +
            '<p class="call-consent-say" id="callConsentSay">They have to be told before ' +
              'this can start. Have you told them?</p>' +
            '<div class="call-consent-acts">' +
              '<button class="btn btn-ghost btn-sm" type="button" data-call-consent="no">' +
                'Not yet</button>' +
              '<button class="btn btn-brand btn-sm" type="button" data-call-consent="yes">' +
                'I have told them</button>' +
            '</div>' +
          '</div>'
        : '') +

      '<div class="call-tools">' +
        /* Record, Mute and Hold are ABSENT in `ready` rather than disabled —
           there is no line for them to act on, and a row of controls that all
           refuse teaches you to stop pressing. */
        (ready ? '' :
          '<button class="call-tool' + (call.recording ? ' is-rec' : '') + '" type="button" ' +
            'data-call-rec aria-pressed="' + !!call.recording + '" aria-label="' +
            (call.recording ? 'Stop recording' : 'Record') + '" title="' +
            (call.recording ? 'Stop recording' : 'Record') + '">' + chIcon('dot') + '</button>' +
          '<button class="call-tool' + (call.muted ? ' is-on' : '') + '" type="button" ' +
            'data-call-mute aria-pressed="' + !!call.muted + '" aria-label="' +
            (call.muted ? 'Unmute' : 'Mute') + '" title="' + (call.muted ? 'Unmute' : 'Mute') +
            '">' + chIcon(call.muted ? 'mic-off' : 'mic') + '</button>' +
          '<button class="call-tool' + (call.held ? ' is-on' : '') + '" type="button" ' +
            'data-call-hold aria-pressed="' + !!call.held + '" aria-label="' +
            (call.held ? 'Resume' : 'Hold') + '" title="' + (call.held ? 'Resume' : 'Hold') +
            '">' + chIcon(call.held ? 'play' : 'pause') + '</button>') +

        /* End keeps its word alongside the handset. It is the one
           irreversible control here and the only one whose mispress costs you
           the call — Fitts says make it big, and a destructive control states
           itself. */
        (ready
          ? '<button class="call-end call-go" type="button" data-callgo ' +
            'aria-label="Start the call to ' + esc(c.name) + '">' + chIcon('phone') +
            'Start call</button>'
          : '<button class="call-end" type="button" data-call-end aria-label="' +
            (dialing ? 'Stop calling them' : 'End the call') + '">' + chIcon('hangup') +
            (dialing ? 'Stop' : 'End') + '</button>') +

      '</div>';
  }



  /* ══ 7c. WHAT A CALL CANNOT SAY ═════════════════════════════════════════
     Four rungs are things a person OBSERVED, not things a call record
     implies: whether they turned up, whether they are actually interested,
     whether the director has it now. No transcript can settle any of them,
     which is the whole reason this build stores a checkpoint instead of
     deriving one.

     So they are one press each, on the record, always visible, and every one
     of them is undoable. No modal, no picker, no confirm: the confirmation
     ladder's bottom rung is "act, then toast with Undo", and every one of
     these is reversible and touches one lead. */

  /* ══ THE BRANCH WITH NO CONTROL ════════════════════════════════════════
     The process has it: they answered, they showed no interest, so you send
     the company profile and ring again later. It was a step in the flow
     with nowhere to press, so it was either not done or done outside the
     product and never written down. It is a touchpoint like any other. */
  /* ══ A BETTER NUMBER FOR ONE PERSON ════════════════════════════════════
     The list has "Fill in what is missing"; a person whose number rang out
     six times had nothing. The supplier's own hit rate decides, off the id,
     so the answer is the same every time it is asked. A new number starts
     its own count of attempts; the history keeps the old calls. */
  function enrichCon(id) {
    const c = DB.byCon[id];
    if (!c) return;
    const f = finderOf();
    const first = c.name.split(' ')[0];
    const h = Math.abs(hash(c.id + ':again'));
    if ((h % 1000) / 1000 >= f.phone) { toast(f.name + ' has no other number for ' + first + '.'); return; }
    const wrong = c.checkpoint === 'wrong-number';
    const before = { phone: c.phone, enrichedAt: c.enrichedAt, attempts: c.attempts,
      checkpoint: c.checkpoint, checkpointAt: c.checkpointAt };
    const phone = '+31 6 ' + String(1000000 + (h % 8999999));
    const fields = { phone: phone, enrichedAt: TODAY_ISO, attempts: 0 };
    /* a wrong number with a right one found is a fresh start on the ladder */
    if (wrong) { fields.checkpoint = 'not-called'; fields.checkpointAt = new Date().toISOString(); }
    patchCon(c, fields);
    paint();
    toast(f.name + (before.phone ? ' found another number for ' : ' found a number for ') + first + ' · ' + phone +
      (wrong ? ' · back to Not called' : ''), () => {
      patchCon(c, before);
      paint();
    });
  }

  const MOVES = [
    { k: 'showed-up',   label: 'They showed up',  from: ['meeting-set'] },
    { k: 'no-show',     label: 'They did not show', from: ['meeting-set'] },
    { k: 'interested',  label: 'They are interested', from: ['meeting-set', 'showed-up'] },
    /* ══ THE HAND-OVER CLOSES THE BDR'S LOOP ═══════════════════════════
       Once a lead is warm the sales manager takes it, so the door is
       there from the first real conversation; at Interested it is the
       thing to press. */
    { k: 'handed-over', label: 'Hand to the director', from: ['answered', 'meeting-set', 'showed-up', 'interested'] },
    { k: 'declined',    label: 'They said no',    from: ['answered', 'meeting-set', 'showed-up', 'interested', 'callback'] },
  ];

  function movesFor(c) {
    return MOVES.filter((m) => m.from.indexOf(c.checkpoint) >= 0);
  }

  /* The next step each rung owes, if any. A rung that owes nothing clears
     the field rather than leaving a stale one: a handed-over lead with a
     callback still on it is a queue entry for work nobody should do. */
  function nextForRung(to) {
    if (to === 'showed-up') return { what: 'Say whether they are interested', due: dayAdd(1) };
    if (to === 'interested') return { what: 'Hand to the director', due: dayAdd(2) };
    if (to === 'answered') return { what: 'Call them back', due: dayAdd(2) };
    return null;
  }

  function setCheckpoint(id, mv) {
    const c = DB.byCon[id];
    if (!c) return;
    const to = mv === 'no-show' ? 'answered' : mv;
    const before = {
      checkpoint: c.checkpoint, checkpointAt: c.checkpointAt, next: c.next, dnc: c.dnc,
    };
    const now = new Date().toISOString();
    const t = {
      id: 'k' + Date.now().toString(36) + Math.floor(Math.random() * 1000),
      con: c.id, camp: campFor(c), by: me().id, at: now, secs: 0,
      outcome: 'checkpoint',
      proposals: [], objections: [], openings: [],
      note: mv === 'no-show' ? 'They did not turn up. Ring to reschedule.'
        : mv === 'handed-over' ? 'Handed to ' + directorOf(c).name + '.'
        : (MOVES.filter((m) => m.k === mv)[0] || {}).label + '.',
      lines: [], next: null, moved: [c.checkpoint, to], rung: to,
    };
    /* A NO-SHOW OWES A CALL WITH A REASON. "Call them back" said nothing
       about why; the flowchart's step is reach them to reschedule. */
    patchCon(c, { checkpoint: to, checkpointAt: now,
      next: mv === 'no-show' ? { what: 'Ring to reschedule the meeting', due: dayAdd(1) } : nextForRung(to) });
    addTouch(t);
    const camp = DB.byCamp[t.camp];
    toast(c.name.split(' ')[0] + ' → ' + rungLabel(to) +
      (to === 'handed-over' ? ' · ' + directorOf(c).name + ' has it' : camp ? ' · ' + camp.name : ''), () => {
      dropTouch(t.id);
      patchCon(c, before);
      paint();
    });
    paint();
  }

  /* ══ 7d. THE BELL ═══════════════════════════════════════════════════════
     What is still waiting on a person, enumerated. The same derivations the
     briefing summarises, so the two cannot go stale relative to each other —
     there is only one queue and one set of buckets. */

  /* ══ THE NOTIFICATIONS PANEL IS AiMY QA'S, BYTE FOR BYTE ═══════════════
     The IIFE below is copied out of ../QA/index.html by line range and not
     edited: it builds each row with createElement, derives the dot and the
     count from what is unread, opens on the bell, closes on an outside
     click and on Escape, walks the rows with the arrow keys, and sends a
     row's question to the canvas through `window.aimyOpenCanvas`. The one
     line added hands `render` out so the panel can be refreshed after a
     write, which QA never needed because its rows never changed.

     What is ours is the ROWS. QA's are QA's business; these are computed
     from the corpus in the same shape — type · status · one sentence · one
     verb · a question for the canvas — one row per KIND of thing that
     needs you, and a kind with nothing to say is not drawn. */
  const AIMY_TASKS = [];
  function bdrTasks() {
    const tasks = [];
    const backs = queue(null, 'callback').filter((c) => c.next && daysBetween(TODAY_ISO, c.next.due) <= 0);
    const late = backs.filter((c) => daysBetween(TODAY_ISO, c.next.due) < 0).length;
    if (backs.length) {
      tasks.push({ id: 'callbacks', sev: late ? 'p1' : 'p2', type: 'Callbacks',
        when: late ? late + ' overdue' : 'due today',
        body: plural(backs.length, 'person') + ' asked to be rung back and their day has come.' +
          (late ? ' ' + late + ' of them ' + (late === 1 ? 'is' : 'are') + ' already overdue.' : ''),
        cta: 'Work the callbacks',
        ask: 'Who asked to be rung back and is due today?' });
    }
    /* the same cut the chip counts, so the bell and the page cannot disagree */
    const met = queue(null, 'after');
    if (met.length) {
      tasks.push({ id: 'meetings', sev: 'p2', type: 'Meetings', when: met.length + ' unconfirmed',
        body: plural(met.length, 'meeting') + (met.length === 1 ? ' has' : ' have') +
          ' passed and nobody has said whether they turned up.',
        cta: 'Say what happened',
        ask: 'Which meetings have passed without anyone saying whether they turned up?' });
    }
    const dec = decidedLately();
    if (dec) {
      tasks.push({ id: 'decided', sev: 'p2', type: 'Handed over', when: 'this week',
        body: dec.replace(/<[^>]+>/g, ''), cta: 'See who decided',
        ask: 'Who that was handed over got a decision this week?' });
    }
    const closing = myCampaigns()
      .map((k) => ({ k: k, left: daysBetween(TODAY_ISO, k.to), fresh: queue(k.id, 'not-called').length }))
      .filter((x) => x.left > 0 && x.left <= 21 && x.fresh)
      .sort((a, b) => a.left - b.left)[0];
    if (closing) {
      tasks.push({ id: 'closing-' + closing.k.id, sev: 'p2', type: 'Campaign',
        when: plural(closing.left, 'day') + ' left',
        body: closing.k.name + ' closes in ' + plural(closing.left, 'day') + ' with ' +
          commas(closing.fresh) + ' people never rung.',
        cta: 'Show the campaign', ask: closing.k.name });
    }
    const today = DB.touch.filter((t) => t.by === me().id && t.at.slice(0, 10) === TODAY_ISO && OUTCOME[t.outcome]);
    if (today.length) {
      tasks.push({ id: 'run-today', sev: 'p3', type: 'Run', when: 'today',
        body: 'You rang ' + plural(today.length, 'person') + ' today: ' +
          today.filter((t) => t.outcome === 'reached').length + ' got through, ' +
          today.filter((t) => t.moved && t.moved[1] === 'meeting-set').length + ' meetings set.',
        cta: 'Read the summary', ask: 'What happened today?' });
    }
    /* ══ SIGNALS AND THE FOUR-TOUCH RULE, AS REMINDERS ══════════════════
       The notes' "remind and notify": what changed at the companies you
       are ringing, and who went quiet before the fourth touch. */
    /* this week's, for a reminder; the cards and the canvas carry three weeks */
    const sigs = signalHits(7);
    if (sigs.length) {
      tasks.push({ id: 'signals', sev: 'p2', type: 'Signals',
        when: plural(sigs.length, 'company', 'companies') + ' moved this week',
        body: sigs.slice(0, 2).map((h) => h.a.name + ' ' + h.sig.text + ', seen ' + sayWhen(h.sig.at)).join('; ') +
          (sigs.length > 2 ? '; and ' + plural(sigs.length - 2, 'more') : '') + '. Each has somebody in your queue.',
        cta: 'See the signals', ask: 'What changed at the companies I am calling?' });
    }
    const quiet = queue(null, 'all').filter(quietUnderFour);
    if (quiet.length) {
      tasks.push({ id: 'four-touch', sev: 'p3', type: 'Touchpoints', when: quiet.length + ' under four',
        body: plural(quiet.length, 'person') + ' you rang or reached went quiet before the fourth touch. ' +
          'The rule is four before you let go.',
        cta: 'Show them', ask: 'Who went quiet before the fourth touch?' });
    }
    const loose = DB.list.filter((l) => !l.for);
    if (loose.length) {
      const n = looseOff(loose).n;
      tasks.push({ id: 'lists-loose', sev: 'p3', type: 'Lists', when: loose.length + ' not on one',
        body: plural(loose.length, 'list') + (loose.length === 1 ? ' is' : ' are') +
          ' on no campaign, so ' + plural(n, 'person') + ' on them ' + (n === 1 ? 'is' : 'are') + ' not in your queue.',
        cta: 'Put them on one', ask: 'Which of my lists are not on a campaign?' });
    }
    return tasks;
  }
  /* The companies with a fresh signal and somebody in your queue, newest first. */
  function signalHits(withinDays) {
    const by = Object.create(null);
    queue(null, 'all').forEach((c) => {
      const a = accOf(c);
      const sig = signalOf(a);
      if (!sig) return;
      if (withinDays != null && daysBetween(sig.at, TODAY_ISO) > withinDays) return;
      (by[a.id] || (by[a.id] = { a: a, sig: sig, people: [] })).people.push(c);
    });
    return Object.keys(by).map((k) => by[k]).sort((x, y) => (x.sig.at < y.sig.at ? 1 : -1));
  }
  function refreshTasks() {
    AIMY_TASKS.length = 0;
    bdrTasks().forEach((t) => AIMY_TASKS.push(t));
    if (window.aimyNtfRender) window.aimyNtfRender();
  }
  /* QA's hook. A row's question goes where a typed one goes. */
  window.aimyOpenCanvas = function (q) { runInput(q); };

(function () {
  var bell   = document.getElementById('ntfBell');
  var panel  = document.getElementById('ntfPanel');
  var list   = document.getElementById('ntfList');
  var dot    = document.getElementById('ntfDot');
  var count  = document.getElementById('ntfCount');
  var clear  = document.getElementById('ntfClear');
  var askAll = document.getElementById('ntfAskAll');
  if (!bell || !panel || !list) return;

  var read = {};

  function unread() {
    var n = 0;
    for (var i = 0; i < AIMY_TASKS.length; i++) if (!read[AIMY_TASKS[i].id]) n++;
    return n;
  }

  /* The dot and the count are derived, never hardcoded. The bell this
     replaced had a permanently-visible red dot nothing could clear. */
  function syncCount() {
    var n = unread();
    if (count) { count.textContent = n; count.hidden = n === 0; }
    if (dot) dot.hidden = n === 0;
    bell.setAttribute('aria-label', n === 0
      ? 'Notifications, nothing waiting on you'
      : 'Notifications, ' + n + ' waiting on you');
  }

  function render() {
    while (list.firstChild) list.removeChild(list.firstChild);
    if (!AIMY_TASKS.length) {
      var empty = document.createElement('li');
      empty.className = 'ntf-empty';
      empty.textContent = 'Nothing waiting on you.';
      list.appendChild(empty);
      syncCount();
      return;
    }
    AIMY_TASKS.forEach(function (t) {
      var li = document.createElement('li');
      li.className = 'ntf-row' + (read[t.id] ? ' is-read' : '');
      li.setAttribute('data-ntf-id', t.id);

      var sev = document.createElement('span');
      sev.className = 'ntf-sev ' + t.sev;
      sev.setAttribute('aria-hidden', 'true');

      var main = document.createElement('div');
      main.className = 'ntf-row-main';

      var head = document.createElement('div');
      head.className = 'ntf-row-head';
      var type = document.createElement('span');
      type.className = 'ntf-row-type';
      type.textContent = t.type;
      var when = document.createElement('span');
      when.className = 'ntf-row-when';
      when.textContent = t.when;
      head.appendChild(type);
      head.appendChild(when);

      var body = document.createElement('p');
      body.className = 'ntf-row-body';
      body.textContent = t.body;

      var cta = document.createElement('button');
      cta.className = 'ntf-row-cta';
      cta.type = 'button';
      cta.textContent = t.cta;
      cta.addEventListener('click', function () { start(t); });

      main.appendChild(head);
      main.appendChild(body);
      main.appendChild(cta);
      li.appendChild(sev);
      li.appendChild(main);
      list.appendChild(li);
    });
    syncCount();
  }

  function ctas() {
    return Array.prototype.slice.call(list.querySelectorAll('.ntf-row-cta'));
  }

  function isOpen() { return !panel.hidden; }

  function openPanel() {
    render();
    panel.hidden = false;
    bell.setAttribute('aria-expanded', 'true');
    var first = ctas()[0];
    if (first) first.focus();
  }

  function closePanel(returnFocus) {
    panel.hidden = true;
    bell.setAttribute('aria-expanded', 'false');
    if (returnFocus) bell.focus();
  }

  /* Graceful when the adapter is missing rather than throwing, the six
     files define it in six different places. */
  function toCanvas(q) {
    if (typeof window.aimyOpenCanvas === 'function') window.aimyOpenCanvas(q);
  }

  /* Opening the task is what marks it read. The panel closes first so it
     cannot float above the canvas overlay. */
  function start(t) {
    read[t.id] = true;
    closePanel(false);
    toCanvas(t.ask);
  }

  bell.addEventListener('click', function (e) {
    e.stopPropagation();
    if (isOpen()) closePanel(false); else openPanel();
  });

  if (clear) clear.addEventListener('click', function () {
    AIMY_TASKS.forEach(function (t) { read[t.id] = true; });
    render();
  });

  if (askAll) askAll.addEventListener('click', function () {
    closePanel(false);
    toCanvas('Across everything waiting on me right now, what should I do first and why?');
  });

  document.addEventListener('click', function (e) {
    if (isOpen() && !panel.contains(e.target) && !bell.contains(e.target)) closePanel(false);
  });

  document.addEventListener('keydown', function (e) {
    if (!isOpen()) return;
    if (e.key === 'Escape') { e.preventDefault(); closePanel(true); return; }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    var items = ctas();
    if (!items.length) return;
    e.preventDefault();
    var i = items.indexOf(document.activeElement);
    if (i === -1) { items[0].focus(); return; }
    items[e.key === 'ArrowDown' ? (i + 1) % items.length
                                : (i - 1 + items.length) % items.length].focus();
  });

  window.aimyNtfRender = render;
  render();
})();


  /* ══ 7e. THE COMPOSER, AND THE CANVAS BEHIND IT ═════════════════════════
     The bar drives the page. Four routes, in the order a caller means them:
     a call being logged takes the sentence first, then a name, then a verb,
     then a question. Only the last one opens the canvas — a surface that
     opens for everything is a detail page wearing a chat's clothes. */

  const TURNS = [];
  let THREAD_SEEN = 0;

  /* ══ THE CANVAS SAYS ITS BASIS ═════════════════════════════════════════
     The bar was in the markup — "Based on" — and nothing filled it. It
     names what the canvas is looking at: the person on the phone or on
     screen, their company and campaign; a campaign; a company; a list; or
     your book. */
  function paintBasis() {
    const host = byId('overlayContextTags');
    if (!host) return;
    const tag = (label) => '<span class="overlay-context-tag">' + esc(label) + '</span>';
    const tags = [];
    const c = (DB.call && DB.byCon[DB.call.con]) || (PENDING && DB.byCon[PENDING.con]) || (S.con && DB.byCon[S.con]);
    if (c) {
      tags.push(tag(c.name));
      const a = accOf(c); if (a) tags.push(tag(a.name));
      const k = DB.byCamp[campFor(c)]; if (k) tags.push(tag(k.name));
    } else if (S.camp && DB.byCamp[S.camp]) tags.push(tag(DB.byCamp[S.camp].name));
    else if (S.acc && DB.byAcc[S.acc]) tags.push(tag(DB.byAcc[S.acc].name));
    else if (S.list && DB.byList[S.list]) tags.push(tag(DB.byList[S.list].name));
    else tags.push(tag('Your book · ' + plural(myCampaigns().length, 'campaign')));
    host.innerHTML = tags.join('');
  }
  /* ══ THE CHAT COLUMN: ON SCREEN, AND RECENT ════════════════════════════
     The markup promised two groups and drew an empty 240px column with a
     border. On screen is what the thread is about; Recent is what you have
     asked this session, each a press away from being asked again. */
  const ASKED = [];
  function paintChats() {
    const host = byId('overlayChats');
    if (!host) return;
    const c = S.con && DB.byCon[S.con], k = S.camp && DB.byCamp[S.camp], a = S.acc && DB.byAcc[S.acc], l = S.list && DB.byList[S.list];
    const on = c ? c.name : k ? k.name : a ? a.name : l ? l.name : 'Your book';
    host.innerHTML =
      '<div class="b-chat-group"><div class="b-chat-cap">On screen</div>' +
        '<div class="b-chat-item is-on">' + esc(on) + '</div></div>' +
      (ASKED.length
        ? '<div class="b-chat-group"><div class="b-chat-cap">Recent</div>' + ASKED.slice(0, 8).map((q) =>
            '<button class="b-chat-item" type="button" data-ask="' + esc(q) + '">' + esc(q) + '</button>').join('') + '</div>'
        : '');
  }
  function openCanvas() { byId('aimyOverlay').classList.add('open'); paintBasis(); paintChats(); }
  function closeCanvas() {
    /* X on a live call is hanging up, and hanging up is a call that
       happened: it ends into the read-back rather than vanishing unlogged.
       A call not yet started is simply put down. */
    if (DB.call && DB.call.state !== 'ready') { endCall(); return; }
    byId('aimyOverlay').classList.remove('open');
    /* THE RAIL GOES WITH IT. The canvas is where a run lives — the brief,
       the read-back, the summary — so dismissing it dismisses the run. A
       rail left standing beside a closed conversation is a call nobody is
       having any more, with a live clock on it. */
    if (DB.call) { closeCall(); paint(); }
  }
  /* Navigating away is not dismissing: the rail survives every URL change by
     construction, which is the whole reason it is a shell region. */
  function hideCanvas() { byId('aimyOverlay').classList.remove('open'); }

  /* The mark, at the size the V3 build draws it in a bubble. */
  const aiMark = () =>
    '<svg viewBox="0 0 18 20" width="13" height="14" aria-hidden="true">' +
      '<use href="#aimy-logo-small"/></svg>';

  /* EVERY TURN HAS A FACE. Yours on yours, the mark on AiMY's — which is
     the thing that makes a bubble AiMY speaking rather than the product
     printing. Mine had none at all. */
  const msgAvatar = (who) => (who === 'you'
    ? '<div class="msg-avatar user-av">' + faceOf(me().id, 28) + '</div>'
    : '<div class="msg-avatar aimy-av">' + aiMark() + '</div>');

  /* A turn is a face and a bubble. A turn that ASKS something carries its
     hint and its shortcuts inside that bubble — and an answered turn keeps
     its buttons on screen and loses their live-ness rather than losing the
     buttons: the thread is a record, and deleting what you chose between
     would hide the choice. */
  /* A KEY IN A HINT IS DRAWN AS A KEY. The digits 1–7 have set the outcome
     of a call since the first build and nothing on screen said so; the
     read-back's hint says it now, and [1] in a hint becomes a keycap. */
  function kbdify(text) {
    return esc(text).replace(/\[(\w)\]/g, '<kbd class="b-kbd">$1</kbd>');
  }
  function turnHtml(t) {
    if (t.who === 'you') {
      return '<div class="chat-msg user">' + msgAvatar('you') +
        '<div class="msg-bubble">' + t.html + '</div></div>';
    }
    return '<div class="chat-msg aimy">' + msgAvatar('aimy') +
      '<div class="msg-bubble">' + t.html +
        (t.hint ? '<p class="s-cb-hint">' + kbdify(t.hint) + '</p>' : '') +
        /* A QUESTION MAY SHOW ITS WORKING. The read-back asks whether a set
           of values is right, and the values have to be on screen for the
           question to mean anything — so a turn may carry markup between its
           sentence and its shortcuts. It is the card the record will carry,
           drawn by the renderer the record uses. */
        (t.card || '') +
        (t.opts && t.opts.length
          ? '<div class="s-cb-opts">' + t.opts.map((o) =>
              '<button class="s-cb-opt' + (o.quiet ? ' is-quiet' : '') +
              (t.spent ? ' is-spent' : '') + '" type="button" ' +
              /* Written out per step rather than composed at runtime: an
                 attribute whose name only exists while the page is running
                 is one the audit cannot pair with its handler. */
              (t.spent ? 'disabled'
                : t.step === 'calllog' ? 'data-calllog="' + esc(o.k) + '"'
                : 'data-lb="' + esc(o.k) + '"') + '>' +
              esc(o.label) + '</button>').join('') + '</div>'
          : '') +
      '</div></div>';
  }

  function say(who, html) {
    TURNS.push({ who: who, html: html });
    paintThread();
  }
  function paintThread() {
    const host = byId('overlayThread');
    if (!TURNS.length) {
      THREAD_SEEN = 0;
      host.innerHTML = ['How many are left to call?', 'Who is due today?',
        'What happened yesterday?', 'When do people actually answer?'].map((q) =>
        '<button class="overlay-sugg-chip" type="button" data-ask="' + esc(q) + '">' +
        esc(q) + '</button>').join('');
      return;
    }
    host.innerHTML = TURNS.map(turnHtml).join('');
    /* THE TURN THAT JUST ARRIVED ARRIVES (bdr.css §33). Only the last one,
       only when the thread grew — the ones already read stay put. */
    if (TURNS.length > THREAD_SEEN && host.lastElementChild) host.lastElementChild.classList.add('b-arrive');
    THREAD_SEEN = TURNS.length;
    host.scrollTop = host.scrollHeight;
  }

  /* Find a person or a campaign by what somebody typed. Exact-ish: a name
     has to be most of the words, or it is not a name, it is a question. */
  function findByName(text) {
    const q = text.toLowerCase().trim();
    if (q.length < 3) return null;
    const camp = DB.camp.filter((k) => k.name.toLowerCase() === q ||
      (q.length > 5 && k.name.toLowerCase().indexOf(q) >= 0))[0];
    if (camp) return { camp: camp };
    let hit = null;
    for (let i = 0; i < DB.con.length; i++) {
      const c = DB.con[i];
      const n = c.name.toLowerCase();
      if (n === q) return { con: c };
      if (!hit && q.length > 4 && n.indexOf(q) >= 0) hit = c;
    }
    return hit ? { con: hit } : null;
  }

  const CALL_RE = /^(call|ring|dial)\b/i;
  const ASK_RE = /\?$|^(how|who|what|when|where|why|show|which)\b/i;

  /* Who the sentence is about: a name in it on one of your campaigns, else
     whoever is open. Nobody: ask, and keep the sentence in the thread. */
  function logBySentence(text, read) {
    const lower = text.toLowerCase();
    const mineCamps = Object.create(null);
    myCampaigns().forEach((k) => (mineCamps[k.id] = 1));
    const c = DB.con.filter((x) => x.camps.some((k) => mineCamps[k]) && lower.indexOf(x.name.toLowerCase()) >= 0)[0]
      || (S.con ? DB.byCon[S.con] : null);
    openCanvas();
    say('you', esc(text));
    if (!c) {
      say('aimy', 'Who was that with? Put the name in the sentence and I will log it against them.');
      return true;
    }
    PENDING = {
      con: c.id, camp: campFor(c), secs: 0, sess: null, auto: false, lines: [],
      note: text, read: read, outcome: impliedDisp(read.disp, read.props, read.objs) || 'no-answer',
      guessed: !read.disp, when: read.when || 1, bySentence: c.name,
    };
    callLogPropose();
    return true;
  }

  function runInput(text) {
    const t = String(text || '').trim();
    if (!t) return;
    if (ASK_RE.test(t) && ASKED.indexOf(t) < 0) ASKED.unshift(t);

    /* A call being logged owns the sentence. It is the one moment where what
       you type is unambiguously about the thing in front of you. */
    if (PENDING) {
      if (callLogCorrect(t)) return;
      PENDING.note = t;
      toast('I could not read a disposition out of that. Say it another way.');
      return;
    }

    if (LBUILD) {
      /* Whatever you type belongs to the list being built. A name where a
         name was asked for, and criteria to read anywhere else. */
      if (LBUILD.step === 'name') { lbuildConfirm(t); return; }
      if (/^(go|that is enough|enough|look now|show me)$/i.test(t)) { lbuildName(); return; }
      /* The way out, said rather than pressed. It is a button on the first
         turn only, and a sentence under the second says this works. */
      if (/^\s*open (the )?builder\s*$/i.test(t)) { lbuildOpt('open'); return; }
      lbuildRead(t);
      return;
    }

    /* ══ THE BUILDER OWNS THE BAR WHILE IT IS OPEN ═════════════════════════
       A textarea on the describe step asking "who are you looking for" beside
       a fixed composer asking the same thing in different words makes the
       first question of the interaction "which box?". There is one box, and
       it is the one that was already there — the page shows what it HEARD. */
    /* NOT `&& DRAFT`. The draft is made by the first paint of this page, and
       on every path where it is not — a reload straight onto the URL, a way
       in that skipped the paint — the sentence fell past this branch and out
       the far end of the router, where anything unrecognised opens the
       canvas. The page is the condition; the draft is made if it is missing. */
    if (S.build === 'describe') {
      if (!DRAFT) DRAFT = { kind: S.bk || 'con', said: '', name: null, take: [], drop: [], rows: [], run: null };
      DRAFT.said = t;
      const read = readSaid(t, buildKind());
      if (!read.length) {
        paint();
        toast('I could not pick a sector, a country or a size out of that.');
        return;
      }
      const cur = terms();
      const flat = [];
      Object.keys(cur).forEach((a) => cur[a].forEach((v) => flat.push(a + ':' + v)));
      read.forEach((pair) => {
        const key = pair[0] + ':' + pair[1];
        if (flat.indexOf(key) < 0) flat.push(key);
      });
      go({ bt: flat.join(',') });
      return;
    }

    if (CALL_RE.test(t)) {
      const rest = t.replace(CALL_RE, '').replace(/^\s*(the\s+)?/i, '').trim();
      hideCanvas();
      if (!rest || /^next( one)?$/i.test(rest)) {
        const first = queue(S.camp || null, S.q).filter((c) => rowVerb(c) === 'Call')[0];
        if (first) startCall(first.id); else toast('Nobody in this cut has a number to ring.');
        return;
      }
      const found = findByName(rest);
      if (found && found.con) { startCall(found.con.id); return; }
      toast('No one here called "' + rest + '".');
      return;
    }

    if (!ASK_RE.test(t)) {
      const found = findByName(t);
      /* Naming a record is navigation, and navigation closes the canvas. It
         opened over the person it had just taken you to otherwise — the
         thing you asked for, behind the surface you asked it from. */
      if (found && found.con) { hideCanvas(); go(Object.assign(cleared(), { con: found.con.id })); return; }
      if (found && found.camp) {
        hideCanvas();
        go(Object.assign(cleared(), { camp: found.camp.id }));
        return;
      }
      /* ══ A SENTENCE ABOUT A CALL LOGS IT ═════════════════════════════════
         The bar promises "log a touchpoint" and this said "open the call
         panel". The sentence names who, or whoever is open is who; the
         read-back is the same card a call ends on, agreed in a word. */
      const read = readCall(t);
      if (read.disp || read.props.length || read.objs.length) {
        if (logBySentence(t, read)) return;
      }
    }

    openCanvas();
    say('you', esc(t));
    const a = answer(t);
    say('aimy', a);
  }

  /* What AiMY can answer, and it is deliberately short: every question a BDR
     asks has a surface that already answers it, so the canvas states the
     figure and hands over the door rather than becoming a second product. */
  function answer(text) {
    const q = text.toLowerCase();
    const all = queue(S.camp || null, 'all');
    const counts = Object.create(null);
    all.forEach((c) => { const b = cutOf(c); counts[b] = (counts[b] || 0) + 1; });
    counts.after = queue(S.camp || null, 'after').length;
    const door = (label, over) =>
      '<button class="s-insight-lnk" type="button" data-go="' + esc(JSON.stringify(over)) +
      '">' + esc(label) + '</button>';

    if (/\b(decision|decided|signed|handed)\b/.test(q)) {
      const hits = decidedHits();
      if (!hits.length) return 'Nobody handed over from your campaigns got a decision this week.';
      return '<b>' + plural(hits.length, 'decision') + '</b> this week on people handed over from your campaigns.' +
        '<div class="b-cuts">' + hits.slice(0, 6).map((h) =>
          door(h.c.name + ' · ' + (h.t.decision === 'won' ? 'signed' : 'said no') + ' ' + sayWhen(h.t.at.slice(0, 10)),
            Object.assign(cleared(), { con: h.c.id }))).join('') +
        '</div>';
    }
    if (/\b(signal|news|changed|funding|hiring|moved)\b/.test(q)) {
      const hits = signalHits();
      const week = signalHits(7);
      if (!hits.length) return 'Nothing has changed at the companies in your queue these three weeks.';
      /* the bell's number first, then the wider window it opens onto */
      return '<b>' + plural(week.length, 'company', 'companies') + '</b> in your queue moved this week' +
        (hits.length > week.length ? ', ' + commas(hits.length) + ' in the last three weeks' : '') +
        '. Each door is the company; the first person to ring is on it.' +
        '<div class="b-cuts">' + hits.slice(0, 6).map((h) =>
          door(h.a.name + ' · ' + h.sig.text + ' · seen ' + sayWhen(h.sig.at), Object.assign(cleared(), { acc: h.a.id }))).join('') +
        '</div>';
    }
    if (/\b(quiet|fourth|four touch|touchpoints?)\b/.test(q)) {
      const quiet = queue(null, 'all').filter(quietUnderFour);
      if (!quiet.length) return 'Nobody you rang or reached has gone quiet under four touches.';
      return '<b>' + plural(quiet.length, 'person') + '</b> went quiet before the fourth touch. They are first in their cuts now.' +
        '<div class="b-cuts">' +
          '<button class="s-insight-lnk" type="button" data-call="' + esc(quiet[0].id) + '">Call ' + esc(quiet[0].name.split(' ')[0]) + '</button>' +
          quiet.slice(0, 6).map((c) =>
          door(c.name + ' · ' + quietUnderFour(c) + ' of ' + TOUCH_RULE, Object.assign(cleared(), { con: c.id }))).join('') +
        '</div>';
    }
    if (/\bmeeting/.test(q)) {
      const met = queue(S.camp || null, 'after');
      if (!met.length) return 'No meeting has passed without an outcome. Everything booked is still ahead.';
      return '<b>' + plural(met.length, 'meeting') + '</b> ' + (met.length === 1 ? 'has' : 'have') +
        ' passed and nobody has said whether they turned up.' +
        '<div class="b-cuts">' + door('See all ' + met.length, Object.assign(cleared(), { q: 'after' })) +
          met.slice(0, 6).map((c) =>
          door(c.name + ' · ' + sayWhen(c.next.due), Object.assign(cleared(), { con: c.id }))).join('') +
        '</div>';
    }
    if (/\blists?\b/.test(q)) {
      const loose = DB.list.filter((l) => !l.for);
      if (!loose.length) return 'Every list is on a campaign, so everybody on them is in your queue.';
      return '<b>' + plural(loose.length, 'list') + '</b> ' + (loose.length === 1 ? 'is' : 'are') +
        ' on no campaign, so their people are not in your queue.' +
        '<div class="b-cuts">' + loose.map((l) =>
          door(l.name + ' · ' + plural(l.has.length, 'person'),
            Object.assign(cleared(), { on: 'lists', list: l.id }))).join('') +
        '</div>';
    }
    if (/callback|call back|rung back|owe|due/.test(q)) {
      const late = queue(S.camp || null, 'callback').filter((c) => c.next && c.next.due < TODAY_ISO).length;
      return '<b>' + plural(counts.callback || 0, 'person') + '</b> asked to be rung back' +
        (S.camp ? ' on this campaign' : ' across your ' +
        plural(myCampaigns().length, 'campaign')) + (late ? ', <b>' + commas(late) + '</b> of them overdue' : '') + '. ' +
        door('Show them', Object.assign(cleared(), { camp: S.camp || '', q: 'callback' }));
    }
    if (/how many|left|remaining|to call/.test(q)) {
      /* the after-meeting cut is not rung, so it is not in the sum; it is said */
      return '<b>' + commas(all.length) + '</b> people can be rung' +
        (S.camp ? ' on this campaign' : '') + ' — ' +
        BUCKETS.filter((b) => b.k !== 'after' && counts[b.k]).map((b) =>
          commas(counts[b.k]) + ' ' + b.label.toLowerCase()).join(', ') + '.' +
        (counts.after ? ' And <b>' + plural(counts.after, 'meeting') + '</b> ' +
          (counts.after === 1 ? 'has' : 'have') + ' passed without a word.' : '') + ' ' +
        door('Work the queue', Object.assign(cleared(), { camp: S.camp || '' })) +
        (counts.after ? ' ' + door('Say what happened', Object.assign(cleared(), { camp: S.camp || '', q: 'after' })) : '');
    }
    if (/happened|yesterday|today.*call|did i/.test(q)) {
      /* today and yesterday both answered "the last two days" */
      const yday = /yesterday/.test(q);
      const from = yday ? dayAdd(-1) : TODAY_ISO;
      const to = yday ? TODAY_ISO : dayAdd(1);
      const label = yday ? 'yesterday' : 'today';
      const mineT = DB.touch.filter((t) => t.by === me().id && OUTCOME[t.outcome] &&
        t.at.slice(0, 10) >= from && t.at.slice(0, 10) < to);
      if (!mineT.length) return 'Nothing on the record from you ' + label + '.';
      const by = Object.create(null);
      mineT.forEach((t) => (by[t.outcome] = (by[t.outcome] || 0) + 1));
      return '<b>' + plural(mineT.length, 'call') + '</b> ' + label + ' — ' +
        Object.keys(by).map((k) => by[k] + ' ' +
          ((OUTCOME[k] || { label: k }).label.toLowerCase())).join(', ') + '.';
    }
    if (/answer|best time|when do/.test(q)) {
      /* The hour with the best connect rate, computed over the calls that
         exist. Stated with its denominator, because a rate over nine calls
         is not a finding. */
      const hours = Object.create(null);
      DB.touch.forEach((t) => {
        const h = new Date(t.at).getHours();
        if (h < 7 || h > 19) return;
        const b = hours[h] || (hours[h] = { n: 0, got: 0 });
        b.n++;
        if (t.outcome === 'reached') b.got++;
      });
      const best = Object.keys(hours).filter((h) => hours[h].n >= 40)
        .sort((a, b) => hours[b].got / hours[b].n - hours[a].got / hours[a].n)[0];
      if (!best) return 'Not enough calls on the record to say yet.';
      const b = hours[best];
      return 'People answer most around <b>' + best + ':00</b> — ' +
        Math.round((b.got / b.n) * 100) + '% of ' + plural(b.n, 'call') + ' made in that hour ' +
        'got through.';
    }
    /* ══ A CAMPAIGN NAMED IN A QUESTION GETS ITS STANDING ══════════════════
       "How is Ireland logistics doing?" got the fallback; a name alone
       navigates, a name in a question answers. */
    const named = myCampaigns().filter((k) => q.indexOf(k.name.toLowerCase()) >= 0)[0];
    if (named) {
      const st = campStand(named);
      const cq = queue(named.id);
      const backs = cq.filter((c) => c.checkpoint === 'callback').length;
      const fresh = cq.filter((c) => c.checkpoint === 'not-called').length;
      return '<b>' + esc(named.name) + '</b>: <b>' + st.done + '</b> of the ' + st.target + ' ' +
        st.noun + (st.target === 1 ? '' : 's') + ' it is for' +
        /* the same sentences the campaign's own lead uses */
        (!st.need ? ' — past its goal, everything from here is on top' +
            (st.left > 0 ? ', with ' + plural(st.left, 'day') + ' to go' : '')
          : st.left > 0 ? ', with ' + plural(st.left, 'day') + ' to go — ' + st.perWeek + ' a week lands the other ' + st.need
          : ', past its end date and ' + st.need + ' short') +
        '. <b>' + commas(cq.length) + '</b> to ring' + (backs || fresh ? ': ' +
          [backs ? plural(backs, 'callback') : null, fresh ? commas(fresh) + ' never rung' : null].filter(Boolean).join(', ') : '') + '. ' +
        door('Open the campaign', Object.assign(cleared(), { camp: named.id }));
    }
    /* ══ WHAT TO DO FIRST ══════════════════════════════════════════════════
       The bell's own footer asks it, and got the fallback. The bell's rows
       are already in order; the answer says so and hands each one on. */
    if (/do first|first and why|what should i do|where do i start|start with|priorit/.test(q)) {
      const tasks = bdrTasks();
      if (!tasks.length) return 'Nothing is waiting on you. Ring the next one.';
      const first = tasks[0];
      return 'First, <b>' + esc(first.type.toLowerCase()) + '</b>: ' + esc(first.body) +
        (tasks.length > 1 ? ' Then ' + tasks.slice(1, 3).map((t) => esc(t.type.toLowerCase()) + ' — ' + esc(t.when)).join(', then ') + '.' : '') +
        '<div class="b-cuts">' + tasks.slice(0, 4).map((t) =>
          '<button class="s-insight-lnk" type="button" data-ask="' + esc(t.ask) + '">' + esc(t.cta) + '</button>').join('') + '</div>';
    }
    return 'I can say what is due, how many are left, what happened today or yesterday, when ' +
      'people answer, which meetings passed, what changed at the companies you ring, who went ' +
      'quiet, who got a decision, which lists are off a campaign, how a campaign stands, and ' +
      'what to do first. Name a person or a campaign to go there; a sentence about a call logs it.';
  }

  /* ══ THE CALL IN THE CANVAS, PORTED FROM THE V3 BUILD ═══════════════════
     The panel holds the call. The CANVAS holds the record of the run: the
     brief before each one, the read-back after it, and the summary at the
     end. Both doors commit through `logCall`, so there is one write.

     WHY THE BRIEF IS A STORED TURN AND NOT A PANEL BLOCK. Anything written
     to the DOM alone is erased by the next repaint — and every toast in this
     product repaints. Harmless while the brief was scenery; fatal once it
     carried the run's controls, because pressing "Pause after this call"
     toasted, the toast wiped the block, and Pause and Stop vanished with it.
     A control that removes itself by working. Stored turns survive every
     repaint, which is what makes the canvas the record of a run rather than
     a view of its last frame. */

  function answerBlock(title, body, cite) {
    return '<div class="s-ans">' +
      '<div class="s-ans-title">' + esc(title) + '</div>' +
      '<div class="s-ans-body">' + body + '</div>' +
      (cite ? '<div class="s-ans-cite"><span>' + esc(cite) + '</span></div>' : '') +
    '</div>';
  }

  /* Everything worth knowing before the phone rings, in the order you would
     ask it. Nine lines at most, and every one of them off the record. */
  /* ══ THE BRIEF IS DIFFERENT AT EVERY RUNG ══════════════════════════════
     It said the same thing to a stranger and to somebody who booked a
     meeting last Tuesday: who they are, what we sell, open on the pitch.
     That is the wrong sentence for six of the eight rungs. What you say
     to a lead who asked to be rung back is that you are ringing when they
     said; to one with a meeting in the diary it is a confirmation, not a
     pitch; to one who has never picked up it is a reason to keep trying.

     So the opener is a function of the checkpoint, and the follow-up the
     record owes is quoted inside it — the whole point of a stored ladder
     is that the next call can read it. */
  function stageOpen(c, camp, last) {
    const owed = c.next ? c.next.what.toLowerCase() + ' ' +
      (daysBetween(TODAY_ISO, c.next.due) < 0 ? 'was due ' : 'is due ') +
      sayWhen(c.next.due) : null;
    /* A quoted note keeps its own full stop, and the sentence around it then
       carries two. Trimmed here rather than in the seed: everywhere else the
       note is printed it is a sentence in its own right. */
    const said = last && last.note ? last.note.replace(/[.\s]+$/, '') : null;
    switch (c.checkpoint) {
      case 'not-called':
        return camp ? camp.pitch : 'Ask what they are running this with today.';
      case 'no-answer':
        return 'They have never picked up — ' + plural(c.attempts, 'attempt') +
          ' so far. Say why you keep ringing rather than that you have been.';
      case 'callback':
        return 'They asked to be rung back' + (c.next
          ? ', and it ' + (daysBetween(TODAY_ISO, c.next.due) < 0 ? 'was due ' : 'is due ') +
            sayWhen(c.next.due)
          : '') + '. Open on that: you are ringing when they said, not out of the blue.';
      case 'answered':
        return 'You have already spoken. Pick up where it stopped' +
          (said ? ' — ' + said : '') + ', and do not reintroduce yourself.';
      case 'meeting-set':
        return 'There is time in a diary' + (owed ? ' — ' + owed : '') +
          '. This call confirms it. Selling it again is how a booked meeting gets unbooked.';
      case 'showed-up':
        return 'They came to the meeting. Ask what they made of it and what would ' +
          'have to be true to go further.';
      case 'interested':
        return 'They want to go further. This call agrees who picks it up and when.';
      case 'handed-over':
        return 'This one is not yours any more — ' +
          esc(actor((camp && camp.owner) || me().id).name) +
          ' has it. Check before you ring.';
      case 'declined':
        return 'They said no' + (said ? ' — ' + said : '') +
          '. Ring only if something has changed, and open on the thing that changed.';
      case 'wrong-number':
        return 'The number on this record is not theirs. Find another before you dial.';
      case 'do-not-call':
        return 'They opted out. Do not ring this one.';
      default:
        return camp ? camp.pitch : 'Ask what they are running this with today.';
    }
  }

  /* ══ THE BRIEF IN THREE STEPS ══════════════════════════════════════════
     Nine label-and-value pairs at one size, one weight and one colour, in
     the order they happened to be written. Everything on it was true and
     nothing on it was louder than anything else, so a caller with ten
     seconds read the first two lines and started the call.

     A brief has three jobs and they are not equal. WHERE THEY STAND and the
     sentence to open with are what you act on in the next four seconds, so
     they lead and the opener is set as speech, because it is the only line
     here anybody says out loud. WHAT YOU KNOW is the two or three facts that
     shape those words — what changed at the company, what was said last
     time, what somebody wrote down. WHAT IS ON THE SHELF is the campaign's
     own material, identical on every call in it, and it goes last and
     quietest: reference, not instruction.

     What they push back on sits between the second and the third, because
     it is the only part of the campaign's material that arrives mid-call. */
  function callPrep(c) {
    const a = accOf(c);
    const camp = DB.byCamp[campFor(c)];
    const hist = (DB.touchesOf[c.id] || []).map((id) => TOUCH[id]).filter(Boolean);
    const calls = callsIn(hist);
    const last = hist[0];
    const sess = DB.call && DB.call.sess;
    const rg = RUNG[c.checkpoint];
    const late = c.next ? daysBetween(TODAY_ISO, c.next.due) < 0 : false;

    let body = '<div class="b-prep">';

    /* WHO, AS A SUBTITLE. The block is already headed with their name, so
       repeating it as the first of nine facts spent the loudest line on the
       one thing the reader had just read. */
    body += '<p class="b-prep-id">' + esc(c.title) +
      (a ? ' · ' + esc(a.name) + ' · ' + esc(INDUSTRY[a.industry].label) + ' · ' +
        commas(a.size) + ' staff' : '') + '</p>';

    /* ── 1. where they stand, and what is owed ── */
    body += '<div class="b-prep-state">' +
      '<span class="tag tag-' + esc(rg.tone === 'neutral' ? 'neutral' : rg.tone) + '">' +
        esc(rg.label) + '</span>' +
      '<span class="b-prep-owed">' + esc(rg.say) +
        (c.checkpointAt ? esc(', since ' + sayWhen(c.checkpointAt)) : '') + '</span>' +
      (c.next
        ? '<span class="b-prep-due' + (late ? ' is-late' : '') + '">' + esc(c.next.what) + ' · ' +
          esc((late ? 'was due ' : 'due ') + sayWhen(c.next.due)) + '</span>'
        : '') +
    '</div>';

    /* ── 2. the sentence you say ── */
    body += '<blockquote class="b-open">' +
      '<span class="b-open-cap">Open with</span>' +
      '<p class="b-open-say">' + esc(stageOpen(c, camp, last)) + '</p>' +
    '</blockquote>';

    /* ── 3. the two or three facts that shape it ── */
    const know = [];
    const sig = signalOf(a);
    if (sig) {
      know.push(['What changed', esc(a.name + ' ' + sig.text + ' · ' + sayWhen(sig.at)) + ' — ' +
        signalMeans(sig, hist) + ' <span class="s-callp-who">— ' + esc(sig.src) + '</span>']);
    }
    know.push(['Last time', (hist.length
      ? esc(plural(hist.length, 'touchpoint') + ', last ' + kindLabel(last).toLowerCase() +
        ' ' + sayWhen(last.at)) + (last.note ? ' — ' + esc(last.note) : '')
      : 'Nothing. This is the first contact.') +
      (quietUnderFour(c) ? ' — ' + esc(quietSay(quietUnderFour(c), c)) : '')]);
    if (c.remember) {
      know.push(['Remember', esc(c.remember.text) + ' <span class="s-callp-who">— ' +
        esc(actor(c.remember.by).name) + '</span>']);
    }
    body += '<div class="b-prep-know">' + know.map((x) =>
      '<p class="b-prep-line"><b>' + esc(x[0]) + '</b> ' + x[1] + '</p>').join('') + '</div>';

    /* ── 4. what arrives mid-call ── */
    const obj = objectionLikely(c, camp);
    if (camp && camp.objections.length) {
      body += '<h3 class="b-brief-cap">If they push back</h3>' +
        (obj ? '<p class="b-prep-most">' + obj + '</p>' : '') +
        '<div class="b-back">' + camp.objections.map((o) =>
          '<div class="b-back-row">' +
            '<span class="tag tag-warn b-back-k">' + esc((OBJECTION[o.k] || {}).label || o.k) + '</span>' +
            '<p class="b-back-v">' + esc(o.say) + '</p>' +
          '</div>').join('') + '</div>';
    }

    /* ── 5. the campaign's own material, quietest ── */
    if (camp) {
      body += '<div class="b-prep-ref">' +
        '<p class="b-prep-refp"><b>Selling</b> ' + esc(camp.sells.map((x) =>
          SELL[x].name + ' — ' + SELL[x].blurb).join('; ')) + '</p>' +
        '<p class="b-prep-refp"><b>Asking for</b> ' + esc(camp.goal) + '</p>' +
        (camp.resources.length
          ? '<p class="b-prep-refp"><b>You can send</b> <span class="b-docs">' +
            camp.resources.map((r, i) => docChip(camp.id, i, r)).join('') + '</span></p>'
          : '') +
      '</div>';
    }
    body += '</div>';

    /* THE RUN'S CONTROLS LIVE ON THE BRIEF, under a sentence naming what they
       act on. In the panel they read as pausing or stopping THIS call, which
       is a control whose object has to be guessed at. */
    if (sess) {
      const at = sess.done.length + sess.skipped.length + 1;
      body += '<p class="s-callsum-note">Call <b>' + at + '</b> of <b>' + sess.ids.length +
        '</b> on this run.</p>' +
        '<div class="b-cuts">' +
          '<button class="s-inline-btn" type="button" data-callskip>Skip this one</button>' +
          '<button class="s-inline-btn" type="button" data-sessstop>Stop the run</button>' +
        '</div>';
    }
    openCanvas();
    say('aimy', answerBlock('Before you speak to ' + c.name, body,
      calls.length ? plural(calls.length, 'call') + ' on the record' : 'nothing on the record yet'));
  }

  /* What this audience says no about, counted, and only where the count is
     worth quoting. A likely objection with two calls behind it is a guess
     wearing a number. */
  function objectionLikely(c, camp) {
    const pool = camp ? DB.touch.filter((t) => t.camp === camp.id) : [];
    const n = Object.create(null);
    let total = 0;
    pool.forEach((t) => t.objections.forEach((o) => { n[o] = (n[o] || 0) + 1; total++; }));
    const top = Object.keys(n).sort((a, b) => n[b] - n[a])[0];
    if (!top || n[top] < 3) return null;
    const agreed = camp.objections.filter((o) => o.k === top)[0];
    /* NO BOLD IN THE VALUE. On a brief line the bold element IS the label —
       sales.css:5497 gives it display:block, uppercase and letter-spacing —
       so a bold number inside the value became a second caption and broke
       the sentence across three lines. The label is the only bold thing on
       a brief line. */
    return esc(OBJECTION[top].label.toLowerCase()) + ' — ' + n[top] + ' of the ' +
      total + ' who gave a reason on this campaign said so. ' +
      esc(agreed ? agreed.say : OBJECTION[top].blurb);
  }

  /* ── THE READ-BACK ──
     AiMY says what it heard in the taxonomy's own words, with the card the
     record will carry. You agree in a word or correct it in a sentence. */
  /* ══ THE VALUES THE WRITE WOULD USE, RESOLVED ONCE ═════════════════════
     A CORRECTION IS READ ALONE AND WINS PER AXIS. Read together with the
     transcript, a gatekeeper heard on the call would outrank "actually I
     spoke to her" for ever, because the lexicon ranks by specificity and not
     by recency — the more you insisted, the less it would listen.

     One function, because the card you agree to and the record that gets
     written have to be the same values. Two resolutions of the same rule is
     a card that can disagree with what it becomes. */
  function logHeard(call) {
    const heard = call.read || {};
    const noted = call.note ? readCall(call.note) : null;
    const win = (k) => (noted && noted[k].length ? noted[k] : (heard[k] || []));
    return {
      disp: (noted && noted.disp) || heard.disp || null,
      remember: (noted && noted.remember) || heard.remember || null,
      props: win('props'), objs: win('objs'), opps: win('opps'),
    };
  }

  /* ══ THE PARAPHRASE ═══════════════════════════════════════════════════
     The taxonomy said out loud, in the order a person would say it. It is
     what makes the card underneath checkable rather than something to take
     on trust: the sentence and the rows are the same values twice, and a
     reader who disagrees with either has found the same mistake. */
  const listSay = (a) => (a.length < 2 ? (a[0] || '')
    : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1]);

  function logSay(call) {
    const h = logHeard(call);
    const d = OUTCOME[call.outcome];
    const bits = [d ? 'I read that as ' + d.label.toLowerCase() + '.'
      : 'I could not tell how that one ended.'];
    if (h.objs.length) {
      bits.push(listSay(h.objs.map((k) => OBJECTION[k].label)) +
        (h.objs.length === 1 ? ' is' : ' are') + ' the obstacle.');
    }
    if (h.props.length) {
      bits.push('You asked for ' +
        listSay(h.props.map((k) => PROPOSAL[k].label)).toLowerCase() + '.');
    }
    if (h.opps.length) {
      bits.push(listSay(h.opps.map((k) => openLabel(k))) + ' came up.');
    }
    return bits.join(' ');
  }

  /* The rows the card prints, which are the rows the record carries. The
     move is passed IN rather than read off the contact: a proposal states
     the checkpoint it WOULD set, and one that fell back to the record's own
     next step would print a follow-up already on the record as though this
     call had produced it. */
  /* ══ THE PROPOSED CALL AND THE LOGGED ONE ARE THE SAME CARD ════════════
     Drawn by one function, which is the whole reason it exists: a proposal
     rendered by a second renderer is a proposal that can disagree with what
     it becomes. So both shapes are flattened into one set of facts first —
     a pending call resolves its axes through `logHeard` and states the move
     it WOULD make; a touchpoint on the record already carries both. */
  const factsOfPending = (call, c, mv) => ({
    outcome: call.outcome,
    props: logHeard(call).props, objs: logHeard(call).objs, opps: logHeard(call).opps,
    from: c.checkpoint, to: mv.to, next: mv.next,
  });
  const factsOfTouch = (t) => ({
    outcome: t.outcome,
    props: t.proposals || [], objs: t.objections || [], opps: t.openings || [],
    from: t.moved ? t.moved[0] : null, to: t.moved ? t.moved[1] : null, next: t.next,
    rung: t.rung || null, phase: t.phase || null, decision: t.decision || null, by: t.by,
  });

  function callFacts(f, c) {
    const o = OUTCOME[f.outcome];
    const rows = [];
    if (o) rows.push(['Outcome', o.label, o.tone]);
    /* A rung somebody settled by hand and a profile going out are not
       calls, and the card says what they were rather than filing them
       under an outcome they never had. */
    else if (KINDS[f.outcome]) rows.push(['What happened', KINDS[f.outcome], 'neutral']);
    else if (f.outcome === 'phase') {
      rows.push(['What happened', (PHASE[f.phase] || {}).label + ' · ' + actor(f.by).name +
        (f.decision ? (f.decision === 'won' ? ' · they signed' : ' · they said no') : ''),
        f.decision === 'lost' ? 'warn' : 'ok']);
    }
    /* Stated even when empty. A groundwork call is a thing that happened,
       and a missing row is indistinguishable from one nobody filled in. */
    if (o) {
      rows.push(['Asked for', f.props.length
        ? f.props.map((k) => (PROPOSAL[k] || {}).label || k).join(' · ') : 'nothing',
        f.props.length ? 'ok' : 'neutral']);
    }
    if (f.objs.length) {
      rows.push(['Obstacle', f.objs.map((k) => (OBJECTION[k] || {}).label || k).join(' · '), 'warn']);
    }
    if (f.opps.length) {
      rows.push(['Opening', f.opps.map((k) => openLabel(k)).join(' · '), 'ok']);
    }
    /* On the record the move is the one that HAPPENED, so it is stated as
       one. On a proposal there is a checkpoint it would leave from, so the
       row says where it stays when the answer is nowhere. */
    if (f.to) {
      rows.push(['Checkpoint', (f.from ? rungLabel(f.from) + ' → ' : '') + rungLabel(f.to), 'ok']);
    } else if (c && f.outcome !== 'phase') {
      /* the rung they were on when it happened, not the rung today: a
         callback from July does not "stay at" a meeting set in August.
         A phase is the director's ladder, not this one, so it says
         nothing about a rung it was never going to move. */
      rows.push(['Checkpoint', 'stays at ' + rungLabel(f.from || f.rung || c.checkpoint), 'neutral']);
    }
    if (f.next) rows.push(['Next', f.next.what + ', ' + sayWhen(f.next.due), 'neutral']);
    return rows;
  }

  /* The card itself, in the V3 build's own anatomy: a column of captioned
     facts, then what was said, then what is worth remembering, then the
     transcript folded away. The caption is the quiet half and the value the
     loud one, so facts of different kinds read down a single edge. */
  function callSummaryHtml(f, c, note, lines) {
    lines = lines || [];
    return '<div class="s-callsum">' +
      '<div class="s-callsum-rows">' +
        callFacts(f, c).map((r) => '<div class="s-callsum-row">' +
          '<span class="s-callsum-cap">' + esc(r[0]) + '</span>' +
          '<span class="s-callsum-val tone-' + esc(r[2]) + '">' + esc(r[1]) + '</span>' +
        '</div>').join('') +
      '</div>' +
      (note ? '<p class="s-callsum-note">' + esc(note) + '</p>' : '') +
      (c.remember ? '<p class="s-callsum-mem"><span class="s-plan-cap">Remember</span>' +
        esc(c.remember.text) + '</p>' : '') +
      (lines.length ? '<details class="s-trace">' +
        '<summary class="s-trace-sum">Transcript' +
          '<span class="s-trace-n">' + lines.length + '</span></summary>' +
        '<div class="s-said-lines">' + lines.map((l) =>
          '<p class="call-line is-' + (l.who === 'you' ? 'you' : 'them') + '">' +
            '<span class="call-who">' +
              esc(l.who === 'you' ? me().name.split(' ')[0] : 'Them') + '</span>' +
            esc(l.text) + '</p>').join('') +
        '</div></details>' : '') +
    '</div>';
  }

  function callLogPropose() {
    const call = PENDING;
    if (!call) return;
    const c = DB.byCon[call.con];
    if (!c) return;
    const mv = moveFor(c, call.outcome || 'no-answer', logHeard(call).props, call.when);
    const sess = call.sess;
    const nextCon = sess ? DB.byCon[sess.ids.filter((id) => id !== call.con &&
      sess.done.indexOf(id) < 0 && sess.skipped.indexOf(id) < 0)[0]] : null;
    /* Only the newest question is live. Eleven logs in a row would otherwise
       leave eleven pressable confirms behind, each of them able to write a
       call that has already been written. */
    lbuildSpend();
    TURNS.push({
      who: 'aimy',
      html: (call.bySentence ? 'Against ' + esc(call.bySentence) + ' — ' : '') + esc(logSay(call)) + ' Is that right?',
      hint: 'Or tell me what I got wrong, or press [1] to [7] for the outcome.',
      /* THE NOTE COMES OFF THE PROPOSAL and stays on the record's card. Here
         it is either the sentence you typed one line above or the paraphrase
         AiMY said one line above, and a card that repeats the two things
         bracketing it is asking to be skipped. */
      card: '<div class="s-callsum-in-turn">' +
        callSummaryHtml(factsOfPending(call, c, mv), c, '', call.lines) + '</div>',
      step: 'calllog',
      /* ══ LOG IT, THEN THE NEXT ONE ═══════════════════════════════════
         Outside a run the read-back ended with "Log it" and the queue.
         The queue's next person is one press away now — the same ranking
         the page shows — and plain "Log it" stays for when it is not. */
      opts: sess
        ? [{ k: 'go', label: nextCon ? 'Log it and call ' + nextCon.name.split(' ')[0] : 'Log it and finish' }]
        : (function () {
            /* the scope you are working: on a campaign page, its queue */
            const nx = queue(S.camp || null, 'all').filter((x) => x.id !== call.con)[0];
            return nx
              ? [{ k: 'gonext', label: 'Log it and call ' + nx.name.split(' ')[0] }, { k: 'go', label: 'Log it' }]
              : [{ k: 'go', label: 'Log it' }];
          })(),
    });
    paintThread();
  }

  /* A CORRECTION IS READ ALONE, and every axis it speaks to replaces the
     proposal's. Read together with the transcript, a gatekeeper heard on the
     call would beat "actually I spoke to her" for ever, because the lexicon
     ranks by specificity and not by recency — the more you insisted, the less
     it would listen. */
  function callLogCorrect(text) {
    const call = PENDING;
    if (!call) return false;
    const read = readCall(text);
    if (!read.disp && !read.props.length && !read.objs.length && !read.opps.length) return false;
    call.note = text;
    const heard = call.read || {};
    call.read = {
      disp: read.disp || heard.disp,
      props: read.props.length ? read.props : (heard.props || []),
      objs: read.objs.length ? read.objs : (heard.objs || []),
      opps: read.opps.length ? read.opps : (heard.opps || []),
      remember: read.remember || heard.remember,
      when: read.when || heard.when,
    };
    if (read.disp) {
      call.outcome = read.disp;
      /* "no answer" said outright leaves no room for an obstacle */
      if (read.disp === 'no-answer' || read.disp === 'gatekeeper') { call.read.props = []; call.read.objs = []; }
    } else {
      call.outcome = impliedDisp(call.outcome, call.read.props, call.read.objs) || call.outcome;
    }
    if (read.when) call.when = read.when;
    say('you', esc(text));
    callLogPropose();
    return true;
  }

  /* ══ AiMY MAKES THE CALLS ═══════════════════════════════════════════════
     The same task as yours, with one difference stated plainly: your run is
     advanced by a disposition and AiMY's is advanced by a clock. Same
     touchpoints, same ladder moves, same undo — so it is not a second call
     model and not a page of its own.

     `by` is who pressed the button; `auto` is who is holding the phone. The
     V3 build got this wrong for a while and attributed every AiMY call to
     whoever started the run. */
  /* ── WHAT AN HOUR ON THE PHONE WAS WORTH ──
     Three questions, not one: what happened, what it produced, and what got
     in the way. A run that reports only its counts reports the least useful
     third of itself. */
  function sessionSummary(sess) {
    const ids = sess.done;
    const made = DB.touch.filter((t) => ids.indexOf(t.con) >= 0 &&
      t.at >= sess.at).slice(-ids.length);
    const by = Object.create(null);
    made.forEach((t) => (by[t.outcome] = (by[t.outcome] || 0) + 1));
    const got = made.filter((t) => t.outcome === 'reached').length;
    /* ONLY THE CALLS THAT CONNECTED. Summing every call's seconds counts the
       ringing, so a run where nobody picked up reported two minutes on the
       phone and nought got through in the same sentence. */
    const talk = made.filter((t) => t.outcome === 'reached')
      .reduce((n, t) => n + (t.secs || 0), 0);
    const mins = Math.round(talk / 60);
    const meetings = made.filter((t) => t.proposals.indexOf('meeting') >= 0 ||
      t.proposals.indexOf('demo') >= 0).length;
    const objs = Object.create(null);
    made.forEach((t) => t.objections.forEach((o) => (objs[o] = (objs[o] || 0) + 1)));
    const topObj = Object.keys(objs).sort((a, b) => objs[b] - objs[a])[0];

    const body =
      '<p class="s-callsum-note">' + plural(made.length, 'call') + ' · <b>' + got +
        '</b> got through' + (mins ? ', ' + plural(mins, 'minute') + ' of talking' : '') +
        '.</p>' +
      '<div class="b-cuts">' + Object.keys(by).map((k) =>
        '<span class="tag tag-' + esc((OUTCOME[k] || { tone: 'neutral' }).tone) + '">' +
        by[k] + ' ' + esc((OUTCOME[k] || { label: k }).label) + '</span>').join('') + '</div>' +
      '<div class="s-callsum-rows">' +
        '<div class="s-callsum-row"><span class="s-callsum-mem">What it was worth</span>' +
          '<span class="s-callsum-val">' + (got
            ? 'You got somebody on the phone ' + (got === 1 ? 'once' : plural(got, 'time')) +
              (meetings
                ? ', and ' + (meetings === 1 ? '<b>a meeting</b>' :
                  '<b>' + plural(meetings, 'meeting') + '</b>') + ' came out of it'
                : ', and nothing was asked for')
            : made.length ? 'Nobody picked up.'
              : 'Nobody was rung' + (sess.skipped.length ? ' — ' + plural(sess.skipped.length, 'person') + ' skipped.' : '.')) +
          '</span></div>' +
        (topObj
          ? '<div class="s-callsum-row"><span class="s-callsum-mem">What got in the way</span>' +
            '<span class="s-callsum-val"><b>' + esc(OBJECTION[topObj].label) + '</b> came up ' +
            plural(objs[topObj], 'time') + '. ' + esc(OBJECTION[topObj].blurb) +
            '</span></div>'
          : '') +
      '</div>';
    say('aimy', answerBlock('That run is finished', body,
      plural(made.length, 'call') + ' written to the record'));
  }

  /* ══ BUILDING A LIST IN THE CONVERSATION ════════════════════════════════
     The other door, and the V3 build makes it the front one. Its argument:
     the page used to open on a gate — do it yourself, or ask AiMY — a screen
     whose whole content was a question about how you would like to answer the
     next question. Two presses before anything was asked, and neither about
     the list.

     So the conversation opens by asking what you are collecting, which is the
     first real question either way, and it carries "Open the builder instead"
     on that same turn. The gate still exists; it is inside the first thing
     you were going to be asked anyway.

     EVERY TURN READS BACK WHAT IT UNDERSTOOD AND SAYS THE COUNT. A reader who
     cannot see what was heard has no way to correct it, and a narrowing whose
     effect is invisible is a narrowing you have to take on faith.

     NAMING IT IS THE COMMIT GESTURE. The last question is what to call it;
     answering carries everything said into the page's own draft and runs the
     build there — streaming, then the set with its offers and its reading.
     The conversation does not grow a second preview of its own. */

  let LBUILD = null;

  /* ══ THE WAY OUT IS NOT ONE OF THE ANSWERS ════════════════════════════
     It sat beside Companies and People in the same bordered chip, so a
     question with two answers looked like a question with three — and the
     one that was not an answer carried the same weight as the two that
     were. Quiet: no border, no ground, the weight of a word.

     And once. It rode every turn after the first as well, which is a
     conversation asking whether you would rather not be having it, over and
     over. On the second turn it becomes a sentence instead — the bar is
     right there, and saying "open builder" into it works from then on. */
  const LB_OUT = { k: 'open', label: 'Open the builder instead', quiet: true };
  const LB_GO = { k: 'go', label: 'That is enough — look now' };

  /* Options belong to the turn that offered them, and only the newest turn's
     are live. Old chips left pressable are a conversation you can answer
     twice in different places. */
  function lbuildSpend() {
    TURNS.forEach((t) => { if (t.opts) t.spent = true; });
  }
  function lbuildPush(text, opts, hint) {
    lbuildSpend();
    let h = hint || '';
    if (LBUILD) {
      LBUILD.turns = (LBUILD.turns || 0) + 1;
      /* On the turn the button stops appearing, and only that turn. */
      if (LBUILD.turns === 2) {
        h = (h ? h + ' ' : '') + 'Say “open builder” any time if you would rather fill it in yourself.';
      }
    }
    TURNS.push({ who: 'aimy', html: text, opts: opts || [], hint: h });
    paintThread();
  }

  const lbuildTerms = () => (LBUILD ? LBUILD.terms : []);
  const lbuildMatched = () => {
    const t = Object.create(null);
    lbuildTerms().forEach((p) => (t[p[0]] || (t[p[0]] = [])).push(p[1]));
    return buildMatched(t);
  };
  const lbuildSay = () => {
    const hit = lbuildMatched().length;
    return '<b>' + commas(hit) + '</b> of the ' + commas(DB.net.length) +
      ' I can reach match.';
  };
  function lbuildAutoName() {
    const t = Object.create(null);
    lbuildTerms().forEach((p) => (t[p[0]] || (t[p[0]] = [])).push(p[1]));
    return autoName(t, LBUILD.kind || 'con');
  }

  /* AN AXIS NOBODY HAS NAMED IS NOT A BLOCKER, it is the next useful thing to
     say. One at a time, so the turn stays a sentence rather than a checklist,
     and it is the axis that would narrow hardest. */
  function lbuildNudge() {
    const named = Object.create(null);
    lbuildTerms().forEach((p) => (named[p[0]] = 1));
    const order = ['industry', 'where', 'size', 'title'];
    const say = {
      industry: ' You have not said a sector — name one and I will narrow it.',
      where: ' You have not said where — name a country and I will narrow it.',
      size: ' You have not said how big — say a size and I will narrow it.',
      title: ' You have not said what they do — name a job title and I will narrow it.',
    };
    const open = order.filter((k) => !named[k] &&
      (k !== 'title' || LBUILD.kind === 'con'));
    return open.length ? say[open[0]] : '';
  }

  /* ══ FIND LEADS STARTS OVER ════════════════════════════════════════════
     A draft left from an earlier visit to the builder outlives the page it
     was made on, and `buildKind()` prefers its kind over the URL's — so the
     builder waiting behind the question was already collecting people
     before anybody had answered which of the two it was. Ask the question
     on a clean surface: the draft goes, and a half-built list is left
     rather than reopened underneath. */
  function lbuildStart(campId) {
    DRAFT = null;
    if (S.build || S.list) goFree(Object.assign(cleared(), { on: 'lists' }), true);
    LBUILD = { kind: null, terms: [], step: 'kind', name: null,
      camp: (campId && DB.byCamp[campId] && mine(DB.byCamp[campId])) ? campId : null };
    TURNS.length = 0;
    openCanvas();
    lbuildPush('What are you collecting — companies, or the people at them?',
      [{ k: 'kind-acc', label: 'Companies' }, { k: 'kind-con', label: 'People' }, LB_OUT],
      'Or just say who you are after and I will work it out.');
  }

  function lbuildKind(kind) {
    LBUILD.kind = kind;
    LBUILD.step = 'said';
    lbuildPush('<b>' + (kind === 'con' ? 'People' : 'Companies') + '</b>. ' +
      'Who are you after? Say it however you like — a sector, a country, a size, ' +
      'a job title.',
      [], 'Something like “QA managers at software companies in the Netherlands”.');
  }

  /* Read a sentence into criteria, then say what was understood and what it
     leaves. Nothing is applied silently and nothing is applied twice. */
  function lbuildRead(text) {
    if (!LBUILD.kind) LBUILD.kind = /\bcompan|organisation|organization|firm/i.test(text) ? 'acc' : 'con';
    const read = readSaid(text, LBUILD.kind);
    TURNS.push({ who: 'you', html: esc(text) });
    if (!read.length) {
      lbuildPush('I could not pick a sector, a country, a size or a job title out of that.',
        [LB_GO], 'Try naming one of those.');
      return;
    }
    const added = [];
    read.forEach((p) => {
      if (!LBUILD.terms.some((q) => q[0] === p[0] && q[1] === p[1])) {
        LBUILD.terms.push(p);
        added.push(p);
      }
    });
    LBUILD.step = 'said';
    const label = (p) => (p[0] === 'industry' ? INDUSTRY[p[1]].label
      : p[0] === 'size' ? (SIZE_BANDS.filter((b) => b.k === p[1])[0] || {}).label
      : p[0] === 'title' ? (TITLE_BANDS.filter((b) => b.k === p[1])[0] || {}).label
      : p[0] === 'where' ? (COUNTRY_OPTS.filter((c) => c[0] === p[1])[0] || [p[1], p[1]])[1]
      : 'not already in the book');
    const hit = lbuildMatched().length;
    /* in the page's axis order, so the read-back and the chips agree */
    const axisOrder = BUILD_AXES.map((ax) => ax.k);
    const inOrder = added.slice().sort((x, y) => axisOrder.indexOf(x[0]) - axisOrder.indexOf(y[0]));
    const head = added.length
      ? 'Read that as <b>' + inOrder.map((p) => esc(label(p))).join(', ') + '</b>.'
      : 'Nothing new in that.';
    if (!hit) {
      lbuildPush(head + ' Nothing in the index matches all of that. Take something ' +
        'back off it and I will look again.',
        [{ k: 'reset', label: 'Start the criteria again' }],
        'Or say it differently.');
      return;
    }
    lbuildPush(head + ' ' + lbuildSay() + lbuildNudge(), [LB_GO],
      'Say anything else that narrows it, or say go.');
  }

  function lbuildName() {
    LBUILD.step = 'name';
    lbuildPush(lbuildSay() + ' What should the list be called?',
      [{ k: 'name-auto', label: 'Call it “' + lbuildAutoName() + '”' }],
      lbuildAutoName());
  }

  /* The last turn. Everything said is carried into the page's draft, the
     canvas closes, and the build runs on the page — where the set gets its
     offers, its reading and its actions. A second preview inside the canvas
     would be two renderers of one thing, which is the duplication this whole
     rebuild exists to remove. */
  function lbuildConfirm(name) {
    TURNS.push({ who: 'you', html: esc(name) });
    lbuildSpend();
    const flat = LBUILD.terms.map((p) => p[0] + ':' + p[1]);
    const kind = LBUILD.kind || 'con';
    LBUILD = null;
    hideCanvas();
    DRAFT = { kind: kind, said: '', name: name, take: [], drop: [], rows: [], run: null };
    go(Object.assign(cleared(), { on: 'lists', build: 'describe', bk: kind, bt: flat.join(',') }));
    buildRun();
  }

  function lbuildOpt(k) {
    if (!LBUILD) return;
    if (k === 'open') {
      /* ══ THE WAY OUT DOES NOT ANSWER THE QUESTION IT IS LEAVING ════════
          defaulted the unanswered question to People,
         and the line under it — build: kind ? 'describe' : 'kind' — could
         never take its second branch, because the default had just made kind
         truthy. So the one control offered before the question was answered
         answered it, silently, always the same way, and walked past the
         builder's own companies-or-people step to prove it.

         Null until somebody says otherwise: the builder opens on the step
         that asks. */
      const flat = LBUILD.terms.map((p) => p[0] + ':' + p[1]);
      const kind = LBUILD.kind;
      LBUILD = null;
      hideCanvas();
      DRAFT = kind
        ? { kind: kind, said: '', name: null, take: [], drop: [], rows: [], run: null }
        : null;
      go(Object.assign(cleared(), { on: 'lists', build: kind ? 'describe' : 'kind',
        bk: kind || '', bt: flat.join(',') }));
      return;
    }
    if (k === 'kind-acc') { lbuildKind('acc'); return; }
    if (k === 'kind-con') { lbuildKind('con'); return; }
    if (k === 'go') { lbuildName(); return; }
    if (k === 'name-auto') { lbuildConfirm(lbuildAutoName()); return; }
    if (k === 'reset') {
      LBUILD.terms = [];
      lbuildPush('Cleared. Who are you after?', [], 'Name a sector, a country or a size.');
    }
  }

  /* ══ 8. THE ROUTER ══════════════════════════════════════════════════════
     One delegated listener. Every control is a `data-` verb matched by
     `closest`, so a row can be re-rendered without losing its behaviour and
     no markup carries an inline handler. */
  document.addEventListener('click', (e) => {
    const t = e.target;

    const home = t.closest('[data-home]');
    if (home) { go(cleared()); return; }

    const goEl = t.closest('[data-go]');
    if (goEl) {
      let over = {};
      try { over = JSON.parse(goEl.getAttribute('data-go')); } catch (err) { over = {}; }
      hideCanvas();
      go(over);
      return;
    }

    const con = t.closest('[data-con]');
    /* THE PAGE NUMBER BELONGS TO THE LIST YOU LEFT. Opening somebody from
       page three of the queue opened their history at page three. */
    if (con) { hideCanvas(); go({ con: con.getAttribute('data-con'), p: '' }); return; }

    /* Back to where you were, not to the front page. `data-home` clears every
       key, which from row eleven of page four of the Due cut means losing the
       cut, the page and the row — three deliberate choices, undone by the
       control that was supposed to return you to them. */
    /* ══ THE WAY BACK IS OUT OF THE RECORD YOU ARE IN ══════════════════
       It cleared `con` wherever it was pressed, so on a company page —
       where `con` is already empty — it did nothing at all. It clears the
       record this page IS, which lands on the company, then the campaign,
       then the briefing. */
    const back = t.closest('[data-back]');
    if (back) { go(S.con ? { con: '' } : S.acc ? { acc: '' } : cleared()); return; }

    const camp = t.closest('[data-camp]');
    if (camp) { go(Object.assign(cleared(), { camp: camp.getAttribute('data-camp') })); return; }

    /* Find leads opens the conversation, which carries the way onto the
       page on its first turn. The gate is inside the first real question
       rather than being a screen of its own. */
    const bop = t.closest('[data-bopen]');
    if (bop) { lbuildStart(bop.getAttribute('data-bopen') || null); return; }

    const lb = t.closest('[data-lb]');
    if (lb) { lbuildOpt(lb.getAttribute('data-lb')); return; }

    /* Which of the two you are collecting. It decides which axes exist — a
       job title is a criterion for people and meaningless for a company — so
       it is asked first and nothing else is on that screen. */
    const bkind = t.closest('[data-bkind]');
    if (bkind) {
      if (!DRAFT) buildOpen();
      DRAFT.kind = bkind.getAttribute('data-bkind');
      go({ on: 'lists', build: 'describe', bk: DRAFT.kind, bt: '' });
      return;
    }

    /* A criterion chip on the describe step removes itself. */
    const bterm = t.closest('[data-bterm]');
    if (bterm) {
      const v = bterm.getAttribute('data-bterm');
      const at = v.indexOf(':');
      toggleTerm(v.slice(0, at), v.slice(at + 1));
      return;
    }

    /* AiMY's offers apply nothing until pressed, and each one carries what it
       would apply rather than recomputing it from the label. */
    const bsug = t.closest('[data-bsug]');
    if (bsug) {
      const k = bsug.getAttribute('data-bsug');
      const t2 = terms();
      const found = buildMatched(t2);
      const s2 = buildSuggests(t2, found, bookFit(t2)).filter((x) => x.k === k)[0];
      if (!s2) return;
      if (s2.take) {
        s2.take.forEach((id) => { if (DRAFT.take.indexOf(id) < 0) DRAFT.take.push(id); });
        paint();
        toast(plural(s2.take.length, 'person') + ' of yours will come along.');
        return;
      }
      const flat = [];
      Object.keys(t2).forEach((a2) => t2[a2].forEach((v) => flat.push(a2 + ':' + v)));
      s2.terms.forEach((pair) => {
        const key = pair[0] + ':' + pair[1];
        if (flat.indexOf(key) < 0) flat.push(key);
      });
      go({ bt: flat.join(',') });
      return;
    }

    if (t.closest('[data-bgo]')) { buildRun(); return; }

    /* Unticking drops somebody before anything is written. Save counts what
       is still ticked, so the number you press is the number you get — the
       rule this product had to fix its own figures for once already. */
    const bdrop = t.closest('[data-bdrop]');
    if (bdrop && DRAFT) {
      const id = bdrop.getAttribute('data-bdrop');
      const at = DRAFT.drop.indexOf(id);
      if (at >= 0) DRAFT.drop.splice(at, 1);
      else DRAFT.drop.push(id);
      paint();
      return;
    }

    const term = t.closest('[data-term]');
    if (term) {
      const v = term.getAttribute('data-term');
      const at = v.indexOf(':');
      toggleTerm(v.slice(0, at), v.slice(at + 1));
      return;
    }
    const finder = t.closest('[data-finder]');
    if (finder) { FINDER = finder.getAttribute('data-finder'); paint(); return; }
    if (t.closest('[data-save]')) { saveList(); return; }
    /* Staged on the draft, not committed: Save is still the one press that
       writes anything, and both menus say what they have staged. */
    /* A name in the campaign menu is the commit, not a staged choice: it is
       the primary on the page and the page ends when it is pressed. */
    const pc = t.closest('[data-pickcamp]');
    if (pc) { shutMenus(null); saveList(pc.getAttribute('data-pickcamp')); return; }
    const pr = t.closest('[data-pickrep]');
    if (pr) {
      const id = pr.getAttribute('data-pickrep');
      const now = assignedTo().slice();
      const at = now.indexOf(id);
      if (at >= 0) { if (now.length > 1) now.splice(at, 1); } else now.push(id);
      DRAFT.assign = now;
      paint();
      /* The menu is a multiple choice, so it stays where it was. */
      const m = byId('assignPick');
      if (m) m.hidden = false;
      return;
    }
    if (t.closest('[data-discard]')) {
      /* The explicit verb, and the gate's own. Nothing has been written, so
         there is nothing to undo; the criteria stay in the URL. */
      const to = LEAVE ? LEAVE.over : Object.assign(cleared(), { on: 'lists' });
      const rep = LEAVE ? LEAVE.replace : false;
      const n = ((DRAFT && DRAFT.rows) || []).length;
      LEAVE = null; DRAFT = null;
      goFree(to, rep);
      if (n) toast('Threw away the ' + plural(n, 'person') + ' that came back. The criteria are still in the builder.');
      return;
    }
    if (t.closest('[data-stay]')) { LEAVE = null; paint(); return; }
    const fl = t.closest('[data-filllist]');
    if (fl) { fillList(fl.getAttribute('data-filllist')); return; }
    const lst = t.closest('[data-list]');
    if (lst) { go(Object.assign(cleared(), { on: 'lists', list: lst.getAttribute('data-list') })); return; }
    const acc = t.closest('[data-acc]');
    if (acc) { go(Object.assign(cleared(), { acc: acc.getAttribute('data-acc') })); return; }


    const nextin = t.closest('[data-callnextin]');
    if (nextin) {
      const k = nextin.getAttribute('data-callnextin');
      const first = queue(k, S.q).filter((c) => rowVerb(c) === 'Call')[0];
      if (first) startCall(first.id);
      else toast('Nobody in this cut has a number to ring.');
      return;
    }

    if (t.closest('[data-findclear]')) { go({ find: '', p: '' }, true); return; }

    /* The first-visit door: open the pitch and take you to it. Smooth only
       when motion is welcome. */
    const gt = t.closest('[data-goto]');
    if (gt) {
      const el = byId(gt.getAttribute('data-goto'));
      if (el) {
        const calm = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
        el.scrollIntoView({ behavior: calm ? 'auto' : 'smooth', block: 'center' });
      }
      return;
    }

    const cut = t.closest('[data-q]');
    if (cut) {
      /* A CUT NARROWS WHAT YOU ARE LOOKING AT, and on a campaign page what you
         are looking at is the campaign. Clearing every key sent you to the
         whole book's queue instead — the chip said Callbacks, the count under
         it said 48, and you landed on a list of six hundred. */
      const over = cleared();
      over.q = cut.getAttribute('data-q');
      if (S.camp) over.camp = S.camp;
      go(over);
      return;
    }

    const pg = t.closest('[data-page]');
    if (pg) { go({ p: pg.getAttribute('data-page') }); return; }

    /* The four openers. Each one is a narrowing of the queue or a jump to the
       top of it — none of them opens a surface of its own, because a way to
       start that needs a page first is not a way to start. */
    const start = t.closest('[data-start]');
    if (start) {
      const k = start.getAttribute('data-start');
      /* Two of the openers name a record rather than a cut. */
      if (k.indexOf('camp:') === 0) {
        go(Object.assign(cleared(), { camp: k.slice(5) }));
        return;
      }
      if (k.indexOf('list:') === 0) {
        go(Object.assign(cleared(), { list: k.slice(5) }));
        return;
      }
      if (k === 'find') { lbuildStart(null); return; }
      if (k === 'deals') { go(Object.assign(cleared(), { on: 'deals' })); return; }
      if (k === 'prep') {
        const top = queue(null, S.q)[0];
        if (top) callPrep(top); else toast('Nothing to prepare for yet.');
        return;
      }
      if (k === 'callnext') {
        /* A manager's next call is the deal at the top of his own ranking —
           nobody on it is `callable`, because callable means the caller has
           not finished with them, and on this desk they have. */
        const first = isMgr()
          ? queue(null, S.q).filter((c) => c.phone && !c.dnc && dealLive(c))[0]
          : queue(null, S.q).filter((c) => callable(c) && rowVerb(c) === 'Call')[0];
        if (first) startCall(first.id);
        else toast(isMgr() ? 'No deal is waiting on a call.' : 'Nobody in this cut has a number to ring.');
      } else if (k === 'lists') {
        go(Object.assign(cleared(), { on: 'lists' }));
      } else if (k === 'camps') {
        /* IT SCROLLED TO A BLOCK THAT IS NOT ON THIS PAGE. Campaigns became
           their own surface and this stayed pointed at the id of the strip
           they used to live in, so the card did nothing at all. */
        go(Object.assign(cleared(), { on: 'camps' }));
      } else {
        go(Object.assign(cleared(), { q: k }));
      }
      return;
    }

    const callone = t.closest('[data-call]');
    if (callone) { startCall(callone.getAttribute('data-call')); return; }

    const callall = t.closest('[data-callall]');
    if (callall) {
      const ids = callall.getAttribute('data-callall');
      callAll(ids ? ids.split(',') : []);
      return;
    }

    if (t.closest('[data-callgo]')) { callGo(); return; }
    if (t.closest('[data-call-end]')) { endCall(); return; }
    if (t.closest('[data-call-rec]')) {
      if (!DB.call) return;
      if (DB.call.recording) { DB.call.recording = false; paintCall(); return; }
      /* Consent is asked once per call and cannot be skipped: a transcript
         taken without telling them is the one thing on this surface that is
         not ours to undo. */
      if (DB.call.notice) { DB.call.recording = true; paintCall(); return; }
      DB.call.asking = true;
      paintCall();
      return;
    }
    const consent = t.closest('[data-call-consent]');
    if (consent && DB.call) {
      DB.call.asking = false;
      if (consent.getAttribute('data-call-consent') === 'yes') {
        DB.call.notice = true;
        DB.call.recording = true;
      }
      paintCall();
      return;
    }
    if (t.closest('[data-call-mute]')) {
      if (DB.call) { DB.call.muted = !DB.call.muted; paintCall(); }
      return;
    }
    if (t.closest('[data-call-hold]')) {
      if (DB.call) { DB.call.held = !DB.call.held; paintCall(); }
      return;
    }
    const cl = t.closest('[data-calllog]');
    if (cl) {
      const how = cl.getAttribute('data-calllog');
      logCall();
      /* the queue has re-ranked by now; its first is the one to ring */
      if (how === 'gonext') { const nx = queue(S.camp || null, 'all')[0]; if (nx) startCall(nx.id); }
      return;
    }
    if (t.closest('[data-callskip]')) { skipCall(); return; }
    if (t.closest('[data-sessstop]')) {
      const sess = DB.call && DB.call.sess;
      closeCall();
      if (sess) { sess.finished = new Date().toISOString(); sessionSummary(sess); }
      paint();
      return;
    }

    const out = t.closest('[data-out]');
    if (out && DB.call) {
      /* Pressing an outcome mid-call ends it: you know how it went before the
         script does, and making somebody press End first is a step for the
         product's benefit. */
      if (DB.call.state === 'live' || DB.call.state === 'connecting') endCall();
      DB.call.outcome = out.getAttribute('data-out');
      paintCall();
      return;
    }
    const en = t.closest('[data-enrichcon]');
    if (en) { enrichCon(en.getAttribute('data-enrichcon')); return; }

    /* ══ THE CHOOSER ═══════════════════════════════════════════════════════
       Opening, choosing and filtering all happen in the DOM: a repaint
       between two presses would close the panel under the hand using it.
       Only the confirm writes, and the write repaints. */
    const po = t.closest('[data-pickopen]');
    if (po) {
      const panel = byId(po.getAttribute('data-pickopen'));
      if (!panel) return;
      /* ONE AT A TIME. The listener that closes menus stands down for a
         click on any opener, which is right for the one being opened and
         wrong for every other menu on the page — two could sit over each
         other, and the one underneath was still live. */
      shutMenus(panel);
      panel.hidden = !panel.hidden;
      const find = panel.querySelector('[data-picksearch]');
      if (!panel.hidden && find) { try { find.focus({ preventScroll: true }); } catch (x) { find.focus(); } }
      /* A MENU THAT WOULD RUN OFF THE EDGE HANGS THE OTHER WAY. Measured
         after it is shown, because a hidden element has no width. */
      if (!panel.hidden && panel.classList.contains('b-menu')) {
        panel.classList.remove('is-right');
        if (panel.getBoundingClientRect().right > window.innerWidth - 16) panel.classList.add('is-right');
      }
      return;
    }
    const doc = t.closest('[data-doc]');
    if (doc) {
      const v = doc.getAttribute('data-doc');
      openDoc(v.slice(0, v.indexOf(':')), v.slice(v.indexOf(':') + 1));
      return;
    }

    const hto = t.closest('[data-handto]');
    if (hto) {
      const v = hto.getAttribute('data-handto');
      handover(v.slice(0, v.indexOf(':')), v.slice(v.indexOf(':') + 1));
      return;
    }

    /* A name in a campaign menu is the whole interaction. */
    const pon = t.closest('[data-puton]');
    if (pon) {
      const v = pon.getAttribute('data-puton');
      const at = v.indexOf('|');
      const go2 = v.slice(0, at);
      shutMenus(null);
      putOn(go2.slice(0, go2.indexOf(':')), go2.slice(go2.indexOf(':') + 1), [v.slice(at + 1)]);
      return;
    }


    const prp = t.closest('[data-prep]');
    if (prp) {
      const c = DB.byCon[prp.getAttribute('data-prep')];
      if (c) callPrep(c);
      return;
    }

    const dl = t.closest('[data-deal]');
    if (dl) {
      const p = dl.getAttribute('data-deal').split(':');
      setStage(p[0], p[1]);
      return;
    }

    const dc = t.closest('[data-decide]');
    if (dc) { setCheckpoint(dc.getAttribute('data-for'), dc.getAttribute('data-decide')); return; }

    const mv = t.closest('[data-move]');
    if (mv) { setCheckpoint(S.con, mv.getAttribute('data-move')); return; }

    const when = t.closest('[data-when]');
    if (when && DB.call) {
      DB.call.when = Number(when.getAttribute('data-when')) || 1;
      paintCall();
      return;
    }

    /* The tray's quick chips are the shell's, and they name queue cuts. */
    const quick = t.closest('[data-quick]');
    if (quick) {
      /* the chips are the cuts, in the cuts' own words; "Going cold" and
         "Mine" were another build's */
      const v = quick.getAttribute('data-quick');
      go(Object.assign(cleared(), { q: BUCKETS.some((b) => b.k === v) ? v : 'all' }));
      return;
    }

    if (t.closest('#canvasOpen')) { openCanvas(); paintThread(); return; }
    const ask = t.closest('[data-ask]');
    if (ask) { runInput(ask.getAttribute('data-ask')); return; }

    /* ══ FILL THE BAR, DO NOT RUN IT ══════════════════════════════════════
       `data-ask` submits what it carries, which is right for a question with
       one answer. This one hands you a sentence to change: the caret goes to
       the end so typing continues it, and nothing happens until you say so.

       WHICHEVER BAR THE PAGE IS USING. There are two composers and only one
       of them is live at a time — the float bar on a page, the overlay's own
       while the canvas is up. Writing into the wrong one puts your sentence
       somewhere you cannot see and leaves the cursor in a box that is not
       there. */
    const fill = t.closest('[data-fill]');
    if (fill) {
      /* The canvas is open when it carries the class that opens it. It is
         never marked hidden, so testing for that put the sentence into the
         composer nobody was looking at. */
      const over = byId('aimyOverlay');
      const el = (over && over.classList.contains('open') && byId('overlayInput')) || byId('floatInput');
      if (!el) return;
      el.value = fill.getAttribute('data-fill');
      el.focus();
      try { el.setSelectionRange(el.value.length, el.value.length); } catch (x) { /* not a text input */ }
      return;
    }

    const railToggle = t.closest('#railToggle');
    if (railToggle) {
      document.body.classList.toggle('rail-open');
      railToggle.setAttribute('aria-expanded', String(document.body.classList.contains('rail-open')));
      return;
    }
    if (t.closest('#railScrim')) { document.body.classList.remove('rail-open'); return; }

    const closeC = t.closest('[data-overlay-close]');
    /* Through `closeCanvas`, not straight at the class. This branch removed
       the class itself and so escaped the rule that dismissing the canvas
       dismisses the run — the close button left a live rail beside a closed
       conversation, with the clock still going. */
    if (closeC) { closeCanvas(); return; }

    const undoEl = t.closest('[data-undo]');
    if (undoEl) { const fn = UNDO; toastGone(); if (fn) fn(); return; }

    const cap = t.closest('[data-cap]');
    if (cap) { UI.cap = Number(cap.getAttribute('data-cap')) || 0; saveUI(); paint(); return; }

    const as = t.closest('[data-as]');
    if (as) {
      shutMenus(null);
      go({ as: as.getAttribute('data-as') === DEFAULT_ME ? '' : as.getAttribute('data-as') });
      return;
    }

    const rst = t.closest('[data-reset]');
    if (rst) { reset(); return; }

    const pt = t.closest('#protoToggle');
    if (pt) {
      const panel = byId('protoPanel');
      panel.hidden = !panel.hidden;
      pt.setAttribute('aria-expanded', String(!panel.hidden));
      paintProto();
      return;
    }

    /* ══ THE WHOLE CARD IS THE DOOR ════════════════════════════════════════
       A card is a hundred and eighty pixels of one thing, and only the title
       inside it opened that thing — so the way in was a twelve-pixel line of
       text, and the other ninety-odd per cent of the card did nothing when
       pressed, which is the one behaviour a card shape promises.

       LAST, ON PURPOSE. The router matches by `closest` and returns on the
       first hit, so every control inside a card — Call, the campaign chip,
       the title itself — is matched above and wins. Only a press on the
       card's own surface reaches here. Written as a trailing fallback rather
       than as a list of things to ignore, because such a list goes stale the
       next time a control is added to a card. */
    const card = t.closest('[data-open]');
    if (card) {
      /* A press that was a text selection is not a press. */
      const sel = window.getSelection();
      if (sel && String(sel).length > 2) return;
      const bits = card.getAttribute('data-open').split(':');
      const over = cleared();
      over[bits[0]] = bits.slice(1).join(':');
      /* A list lives under the lists surface, so opening one has to say
         which surface it is under or the router lands on the queue. */
      if (bits[0] === 'list') over.on = 'lists';
      go(over);
    }
  });

  /* ══ TYPING NARROWS IN PLACE ═══════════════════════════════════════════
     `replaceState`, not a push: thirty keystrokes are one search, and a
     history entry per letter turns Back into a spelling replay. The page
     number goes with every change, because page four of the old list is
     nowhere in the new one.

     AND THE CARET SURVIVES THE REPAINT. `paint` replaces the surface's
     markup, which destroys the input you are typing into — so the box is
     found again and the caret put back where it was. Without it the field
     lost focus on the first letter and the search was unusable. */
  document.addEventListener('input', (e) => {
    /* The chooser filters its own list where it stands. A repaint would
       take the focus out of the box being typed in. */
    const ps = e.target.closest && e.target.closest('[data-picksearch]');
    if (ps) { pickFilter(ps); return; }
    const box = e.target.closest && e.target.closest('[data-find]');
    if (!box) return;
    const at = box.selectionStart;
    const sc = byId('pageScroll');
    const keep = sc ? sc.scrollTop : 0;
    go({ find: box.value, p: '' }, true);
    const again = document.querySelector('[data-find]');
    if (again) {
      /* ══ NEITHER OF THESE MAY MOVE THE PAGE ═════════════════════════════
         `focus` scrolls an element the browser thinks is out of view, so it
         is told not to. `setSelectionRange` scrolls the CARET into view and
         takes no such option, so the scroller's position is taken before the
         repaint and put back after — which covers both without either of
         them having to be trusted.

         Measured after: five keystrokes from the top of the page and five
         from 600px down, and the scroller does not move by a pixel in
         either. Typing narrows a list, and narrowing a list is not a reason
         to go anywhere. */
      try { again.focus({ preventScroll: true }); } catch (x) { again.focus(); }
      try { again.setSelectionRange(at, at); } catch (x) {}
      if (sc) sc.scrollTop = keep;
    }
  });

  /* The pitch opens the first time and stays however you left it after that.
     `toggle` does not bubble, so it is caught in the capture phase rather
     than by hanging a listener on an element every repaint replaces. */
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.shiftKey) return;
    const el = e.target;
    if (el && el.id === 'floatInput') {
      e.preventDefault();
      const v = el.value; el.value = '';
      runInput(v);
    } else if (el && el.id === 'overlayInput') {
      e.preventDefault();
      const v = el.value; el.value = '';
      runInput(v);
    }
  });
  document.addEventListener('click', (e) => {
    if (e.target.closest('#floatSend')) {
      const el = byId('floatInput'); const v = el.value; el.value = ''; runInput(v);
    } else if (e.target.closest('#overlaySend')) {
      const el = byId('overlayInput'); const v = el.value; el.value = ''; runInput(v);
    }
  });

  /* THE NAME TRACKS THE CRITERIA UNTIL YOU DISAGREE WITH IT. While the field
     still holds the derived name, `DRAFT.name` stays null and the heading
     keeps up with what you narrow to. The moment you type something else it
     is yours and stops moving — which is the only way to disagree with a
     generated name without saving the list and renaming it afterwards. */
  document.addEventListener('input', (e) => {
    const nm = e.target.closest('[data-bname]');
    if (nm && DRAFT) {
      DRAFT.name = nm.value === nm.getAttribute('data-auto') ? null : nm.value;
      return;
    }

    const n = e.target.closest('[data-note]');
    if (!n || !DB.call) return;
    DB.call.note = n.value;
    /* NOT `paintCall()`. Repainting the panel replaces the textarea the
       caret is sitting in, and the caret goes with it — you would lose the
       cursor on every keystroke. Only what the reading changes is redrawn. */
    /* Nothing is repainted while you type. The note is read when the call
       is logged, and the canvas already carries the reading — redrawing the
       rail here would take the caret with it. */
  });

  /* ══ THE KEYBOARD, BECAUSE THE MOUSE IS THE SLOW PART ═══════════════════
     Two hundred calls in a day is two hundred rounds of: read the brief,
     dial, listen, say what happened, next. Every one of those is a key here,
     and the hand never leaves the home row except to type the note.

     Enter is the whole loop. It means "the obvious next thing" at every
     state — dial the next one, start this one, hang up, log it and go on —
     which is what makes it one key rather than four. */
  const TYPING = (el) => el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA');

  document.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const typing = TYPING(e.target);

    /* `/` puts the cursor in the composer from anywhere, which is the one
       shortcut people try without being told. */
    if (e.key === '/' && !typing) { e.preventDefault(); byId('floatInput').focus(); return; }

    if (e.key === 'Enter' && !typing) {
      e.preventDefault();
      const c = DB.call;
      if (!c && PENDING) { logCall(); return; }
      if (!c) {
        /* Only where there is a queue in front of you. On the list builder
           the obvious next thing is not "dial somebody" — it is the surface
           you are actually on, and Enter guessing otherwise is the product
           taking an action nobody asked for. */
        if (S.on === 'lists') return;
        /* The card the keyboard is standing on, or the top of the cut. A
           cursor that moves and an Enter that ignores it is two different
           ideas of where you are. */
        const cards = gridCards();
        if (GRID_AT >= 0 && cards[GRID_AT]) {
          startCall(cards[GRID_AT].getAttribute('data-card'));
          return;
        }
        const first = queue(S.camp || null, S.q).filter((x) => rowVerb(x) === 'Call')[0];
        if (first) startCall(first.id); else toast('Nobody in this cut has a number to ring.');
      } else if (c.state === 'ready') callGo();
      else endCall();
      return;
    }

    if (typing) return;

    if (DB.call || PENDING) {
      /* The seven outcomes, in the order the taxonomy declares them. Pressing
         one mid-call ends the call first — you know how it went before the
         transcript does — and then it is the pending call that carries it. */
      const n = OUTCOMES.filter((o) => o.key === e.key)[0];
      if (n) {
        e.preventDefault();
        if (DB.call) endCall();
        if (PENDING) { PENDING.outcome = n.k; callLogPropose(); }
        return;
      }
      if (e.key === 'n' || e.key === 'N') {
        const note = byId('callPanel').querySelector('[data-note]');
        if (note) { e.preventDefault(); note.focus(); }
        return;
      }
      /* `&&` binds tighter than `||`, so the guard only ever applied to the
         capital: a lowercase s with no call swallowed the key and did
         nothing. It is the only way to skip without the canvas now. */
      if ((e.key === 's' || e.key === 'S') && DB.call) { e.preventDefault(); skipCall(); return; }
    }

    /* Moving through the cards, and opening or ringing the one you are on.
       The queue is a grid rather than a windowed column now, so the cursor
       lives on the cards themselves — j and k walk them in reading order,
       which across three columns is left to right and then down. */
    const cards = gridCards();
    if (cards.length) {
      if (e.key === 'j' || e.key === 'ArrowDown') { e.preventDefault(); moveGrid(1); return; }
      if (e.key === 'k' || e.key === 'ArrowUp') { e.preventDefault(); moveGrid(-1); return; }
      if (e.key === 'o' && GRID_AT >= 0) {
        e.preventDefault();
        go({ con: cards[GRID_AT].getAttribute('data-card') });
        return;
      }
      return;
    }

    /* The surfaces that are still a single column. */
    const list = VLISTS[0];
    if (!list || !list.items.length) return;
    if (e.key === 'j' || e.key === 'ArrowDown') {
      e.preventDefault(); list.focus(list.cursor < 0 ? 0 : list.cursor + 1); return;
    }
    if (e.key === 'k' || e.key === 'ArrowUp') {
      e.preventDefault(); list.focus(list.cursor < 0 ? 0 : list.cursor - 1); return;
    }
    if (e.key === 'o' && list.cursor >= 0) {
      const item = list.items[list.cursor];
      if (item && item.id && item.id[0] === 'p') { e.preventDefault(); go({ con: item.id }); }
      return;
    }
  });

  /* Which card the keyboard is on. Reset by every repaint, because the cards
     under it are new elements and an index into the old ones means nothing. */
  let GRID_AT = -1;
  const gridCards = () => byId('wbStage').querySelectorAll('.b-qcard');
  function moveGrid(d) {
    const cards = gridCards();
    if (!cards.length) return;
    GRID_AT = GRID_AT < 0 ? 0 : Math.max(0, Math.min(cards.length - 1, GRID_AT + d));
    for (let i = 0; i < cards.length; i++) cards[i].classList.toggle('is-cursor', i === GRID_AT);
    cards[GRID_AT].scrollIntoView({ block: 'nearest' });
  }

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (byId('aimyOverlay').classList.contains('open')) { closeCanvas(); return; }
    /* The notifications panel closes itself on Escape — that is QA's code. */
    if (DB.call) { skipCall(); }
  });

  /* A MENU CLOSES ON THE NEXT THING YOU DO. Anything outside it, or Esc. */
  function shutMenus(keep) {
    document.querySelectorAll('.b-menu:not([hidden])').forEach((m) => { if (m !== keep) m.hidden = true; });
  }
  document.addEventListener('click', (e) => {
    if (e.target.closest && (e.target.closest('.b-menu') || e.target.closest('[data-pickopen]'))) return;
    shutMenus(null);
  }, true);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') shutMenus(null); });

  /* ══ A THEME FLIPS; IT DOES NOT CROSSFADE ══════════════════════════════
     Nearly every element here transitions its colour, its border or its
     ground, and a theme switch changes all three on all of them at once —
     so the whole page smeared from dark to light over a hundred and fifty
     milliseconds, each part on its own clock. Every transition is switched
     off for the frame the flip happens on and switched back on the frame
     after. Registered on the capture phase so it runs before the library's
     own handler makes the change. */
  const themeBtn = byId('ds-theme-toggle');
  if (themeBtn) {
    themeBtn.addEventListener('click', () => {
      const still = document.createElement('style');
      still.textContent = '*,*::before,*::after{transition:none!important}';
      document.head.appendChild(still);
      void document.documentElement.offsetWidth;
      /* Two frames, or forty milliseconds — whichever comes first. A frame
         never comes in a tab that is not painting, and a page that has
         stopped transitioning until somebody looks at it is a page that
         will not transition when they do. */
      const back = () => still.remove();
      requestAnimationFrame(() => requestAnimationFrame(back));
      setTimeout(back, 40);
    }, true);
  }

  window.addEventListener('resize', () => placeSwitchBar(null));
  /* The webfont lands after the first paint and the buttons narrow under
     the bar; it is placed again when the fonts are in. */
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => placeSwitchBar(null));
  window.addEventListener('popstate', (e) => {
    if (BACK_GUARD && !(e.state && e.state.aimyGuard) && S.build === 'done' && DRAFT && (DRAFT.rows || []).length) {
      history.pushState({ aimyGuard: 1 }, '', location.href);
      LEAVE = { over: Object.assign(cleared(), { on: 'lists' }), replace: true, back: true };
      paint();
      byId('pageScroll').scrollTop = 0;
      return;
    }
    parse(); paint();
  });
  window.addEventListener('pagehide', () => { if (saveTimer) saveNow(); });

  /* ══ 9. BOOT ════════════════════════════════════════════════════════════ */

  loadUI();
  load();
  parse();
  paint();

  /* A handle for checking counts from the console, and for the audit. Not
     product surface: nothing in the app reads it. */
  window.BDR = {
    db: DB,
    delta: () => DELTA,
    stats: function () {
      const q = queue();
      return {
        campaigns: DB.camp.length,
        mine: myCampaigns().length,
        accounts: DB.acc.length,
        contacts: DB.con.length,
        withPhone: DB.con.filter((c) => c.phone).length,
        touchpoints: DB.touch.length,
        queue: q.length,
        due: DB.con.filter((c) => callable(c) && dueToday(c)).length,
        untouched: DB.con.filter((c) => callable(c) && untouched(c)).length,
        rungs: rungCounts(DB.con),
        deltaBytes: (function () { try { return (localStorage.getItem(KEY_DB) || '').length; } catch (e) { return 0; } })(),
      };
    },
    reset: reset,
    go: go,
    queue: queue,
    /* The mounted windowed lists. Exposed because the scroll handler is
       rAF-throttled and a hidden tab never runs a frame — so a check that
       scrolls and then reads the DOM has to be able to force the render
       itself rather than wait for a frame that is not coming. */
    vlists: VLISTS,
    read: readCall,
    patch: patchCon,
    addTouch: addTouch,
    dropTouch: dropTouch,
  };
})();
