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
    { k: 'handed-over', label: 'Handed over',  tone: 'ok',      say: 'the director has it now' },
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
  const kindLabel = (t) => (OUTCOME[t.outcome] ? OUTCOME[t.outcome].label
    : KINDS[t.outcome] || (t.moved ? rungLabel(t.moved[1]) : t.outcome));

  const OPENING = Object.create(null);
  OPENINGS.forEach((o) => (OPENING[o.k] = o));
  const openLabel = (k) => (OPENING[k] ? OPENING[k].label : k);

  /* What we sell. Eight offerings; a campaign carries one or two. */
  const SELLS = [
    { k: 'voice',   name: 'AiMY Voice',              blurb: 'an AI voice agent that answers, qualifies and books' },
    { k: 'qa',      name: 'AiMY QA',                 blurb: 'quality scored on every conversation, not on a sample' },
    { k: 'know',    name: 'AiMY Knowledge',          blurb: 'one answer surface over documentation nobody can find' },
    { k: 'support', name: 'Managed customer support', blurb: 'a support team we run for you, in your tone of voice' },
    { k: 'test',    name: 'QA and test automation',  blurb: 'a test suite, and the engineers who keep it green' },
    { k: 'eng',     name: 'Engineering teams',       blurb: 'engineers embedded in your team, on EU hours' },
    { k: 'data',    name: 'Data annotation',         blurb: 'labelled data at volume, with an accuracy guarantee' },
    { k: 'back',    name: 'Finance and back office', blurb: 'invoicing, reconciliation and reporting, run for you' },
  ];
  const SELL = Object.create(null);
  SELLS.forEach((s) => (SELL[s.k] = s));

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

  /* The cast. Four BDRs and two managers is enough to make ownership mean
     something without pretending this is a directory. */
  const REPS = [
    { id: 'engy',   name: 'Engy Saleh',    initials: 'ES', fn: 'bdr' },
    { id: 'habeba', name: 'Sally Tarek',   initials: 'ST', fn: 'bdr' },
    { id: 'omar',   name: 'Omar Fathy',    initials: 'OF', fn: 'bdr' },
    { id: 'sara',   name: 'Sara Nabil',    initials: 'SN', fn: 'bdr' },
    { id: 'lina',   name: 'Lina Haddad',   initials: 'LH', fn: 'sales-manager' },
    { id: 'ahmed',  name: 'Ahmed Mohamed', initials: 'AM', fn: 'sales-manager' },
  ];
  const REP = Object.create(null);
  REPS.forEach((r) => (REP[r.id] = r));
  const BDRS = REPS.filter((r) => r.fn === 'bdr');
  const MANAGERS = REPS.filter((r) => r.fn === 'sales-manager');
  const DEFAULT_ME = 'engy';
  const me = () => REP[S.as] || REP[DEFAULT_ME];

  const AIMY = { id: 'aimy', name: 'AiMY', initials: 'AI' };
  const actor = (id) => REP[id] || (id === 'aimy' ? AIMY : { id: id, name: id, initials: '?' });

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

    return { disp, props, objs, opps, next, when, remember, outcome, said };
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
    const CAMP_N = 40;
    const usedNames = Object.create(null);
    for (let i = 0; i < CAMP_N; i++) {
      const ind = pick(r, INDUSTRIES);
      const reg = pick(r, REGIONS);
      const sells = [pick(r, SELLS)];
      if (chance(r, 0.35)) {
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

      camp.push({
        id: 'c' + i,
        name: name,
        goal: pick(r, [
          'Book ' + between(r, 8, 30) + ' first meetings with ' + ind.label.toLowerCase() + ' operations leads',
          'Open ' + between(r, 10, 25) + ' conversations in ' + reg.label + ' before the quarter closes',
          'Find ' + between(r, 6, 18) + ' teams carrying the work ' + sells[0].name + ' takes off them',
          'Replace ' + between(r, 5, 15) + ' manual support desks in ' + reg.label,
        ]),
        pitch: 'They are ' + ind.label.toLowerCase() + ' in ' + reg.label +
          ', and they are running this with people rather than with a system. ' +
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
    const others = BDRS.filter((b) => b.id !== DEFAULT_ME);
    running.slice(0, 14).forEach((c) => c.crew.push(DEFAULT_ME));
    camp.forEach((c) => {
      const extra = between(r, 0, 2);
      for (let j = 0; j < extra; j++) {
        const b = pick(r, others);
        if (c.crew.indexOf(b.id) < 0) c.crew.push(b.id);
      }
      if (!c.crew.length) c.crew.push(pick(r, others).id);
    });

    /* ── Accounts ── */
    const ACC_N = 2500;
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
    const CON_N = 6000;
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
      });
      const c = con[con.length - 1];
      c.email = chance(r, 0.74)
        ? c.name.toLowerCase().replace(/[^a-z ]/g, '').split(' ').slice(0, 2).join('.') + '@' + a.domain
        : null;
    }

    /* ── Membership ── every campaign gets a slice of the book. A contact can
       be on two campaigns; the queue de-duplicates by person, not by row. */
    camp.forEach((c) => {
      const want = between(r, 120, 400);
      for (let j = 0; j < want; j++) {
        const p = con[Math.floor(r() * CON_N)];
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
    const START = [
      ['not-called', 0.26],
      ['no-answer', 0.19],
      ['callback', 0.05],
      ['answered', 0.10],
      ['meeting-set', 0.045],
      ['showed-up', 0.02],
      ['interested', 0.015],
      ['handed-over', 0.01],
      ['declined', 0.045],
      ['wrong-number', 0.015],
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
      reached: ['Good conversation, they want a demo.', 'Spoke to her, keen but the price came up.',
        'Talked it through. They asked me to send the case study.', 'Got through. Timing is the problem, not the fit.'],
      callback: ['Asked me to call back next week.', 'Bad moment, ring back Thursday.', 'Call her back after the board meeting.'],
      gatekeeper: ['Reception would not put me through.', 'Screened. Assistant took a message.', 'Front desk again, she is in workshops all week.'],
      'no-answer': ['No answer.', 'Rang out.', 'Left a voicemail.', 'Straight to answerphone.'],
      'not-interested': ['Not interested, they have just signed with someone.', 'No appetite this year.', 'Brushed me off.'],
      'wrong-number': ['Wrong number, she left last year.', 'Number is not in service.'],
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
        if (oc === 'reached') {
          if (chance(r, 0.55)) props.push(pick(r, PROPOSALS).k);
          if (chance(r, 0.5)) objs.push(pick(r, OBJECTIONS).k);
          if (chance(r, 0.15)) opps.push(pick(r, OPENINGS).k);
        }
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
      c.attempts = n;
      c.lastCallAt = last;
      c.checkpointAt = last;
      if (rung === 'do-not-call') c.dnc = true;

      /* What is owed next, and when. Only the rungs that owe something. */
      if (rung === 'callback') {
        c.next = { what: 'Call them back', due: dayAdd(between(r, -9, 6)) };
      } else if (rung === 'meeting-set') {
        c.next = { what: pick(r, ['Meeting with them', 'Demo for them']), due: dayAdd(between(r, -6, 14)) };
      } else if (rung === 'answered' && chance(r, 0.45)) {
        c.next = { what: pick(r, ['Send what was promised', 'Call them back']), due: dayAdd(between(r, -8, 9)) };
      } else if (rung === 'interested' || rung === 'showed-up') {
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
    for (let i = 0; i < 12000; i++) {
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
    DB.camp.forEach((c) => { DB.byCamp[c.id] = c; DB.membersOf[c.id] = []; });
    DB.acc.forEach((a) => (DB.byAcc[a.id] = a));
    DB.list.forEach((l) => (DB.byList[l.id] = l));
    DB.con.forEach((c) => {
      DB.byCon[c.id] = c;
      (DB.consOf[c.acc] || (DB.consOf[c.acc] = [])).push(c.id);
      c.camps.forEach((k) => DB.membersOf[k] && DB.membersOf[k].push(c.id));
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
  const mine = (c) => c.crew.indexOf(me().id) >= 0;
  const myCampaigns = () => DB.camp.filter((c) => mine(c) && c.state !== 'done');
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
    const url = qs(over);
    if (replace) history.replaceState(null, '', url);
    else history.pushState(null, '', url);
    parse();
    paint();
    /* A NEW SURFACE STARTS AT ITS TOP; A NEW PAGE OF ONE DOES NOT.
       Opening a person from row eleven of the queue landed on their record
       eleven rows down it — the header, the ladder and the whole reason you
       opened it were above the fold. Moving through the queue's pages is the
       opposite case: you are working a list, the rows change underneath you,
       and being thrown to the top of the document each time is what makes a
       pager worse than a scroll. */
    if (wasOn !== S.con + '|' + S.camp) byId('pageScroll').scrollTop = 0;
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
      : S.on === 'camps' ? campsPage()
      : homePage();
    mountLists();
    paintRail();
    refreshTasks();
    paintProto();
    guardBack();
    postPaint(pre);
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
    const r = RUNG[c.checkpoint] || RUNG['not-called'];
    const last = (DB.touchesOf[c.id] || []).map((id) => TOUCH[id]).filter(Boolean)[0];
    return '<article class="type-card s-card b-qcard" data-card="' + esc(c.id) + '" ' +
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
      '<div class="b-qcard-why">' + whyLine(c) + '</div>' +
      /* What was actually said, in the words it was written in. A caller
         opening cold on somebody they rang last week is the thing this card
         exists to stop. */
      (last && last.note
        ? '<p class="tc-quote b-qcard-note">' + esc(last.note) + '</p>'
        : '') +
      aimyBlock(aimySays(c)) +
      '<div class="tc-gov b-qcard-foot">' +
        '<span class="b-qcard-num">' + esc(c.phone) + '</span>' +
        /* Only the first card is filled. Fifteen identical primaries is
           fifteen recommendations, which is none — the list is already
           ranked, so the top card is the recommendation and says so by being
           the only filled thing on the surface. */
        '<button class="s-insight-lnk' + (i === 0 ? ' primary' : '') +
          '" type="button" data-call="' + esc(c.id) + '">' + rowVerb() + '</button>' +
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
  function aimySays(c, onRecord) {
    const camp = DB.byCamp[campFor(c)];
    const hist = (DB.touchesOf[c.id] || []).map((id) => TOUCH[id]).filter(Boolean);
    const last = hist[0];
    const a = accOf(c);

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
    return '<article class="type-card s-card b-qcard" data-open="camp:' + esc(k.id) + '">' +
      '<div class="tc-head">' +
        '<span class="tag tag-' + (left > 0 && left < 21 ? 'warn' : 'neutral') + '">' +
          (left > 0 ? esc(plural(left, 'day')) + ' left' : 'past its end') + '</span>' +
        '<span class="tc-type">' + esc(SELL[k.sells[0]].name) + '</span>' +
      '</div>' +
      '<button class="tc-title s-card-title" type="button" data-camp="' + esc(k.id) + '">' +
        esc(k.name) + '</button>' +
      '<p class="tc-summary">' + esc(k.goal) + '.</p>' +
      '<div class="b-qcard-why"><b>' + commas(q.length) + '</b> of its ' +
        plural(members.length, 'person') + ' to ring' +
        (back ? ', <b>' + back + '</b> ' + verbFor(back, 'callback') : '') +
        (fresh ? ', <b>' + commas(fresh) + '</b> never rung' : '') + '</div>' +
      aimyBlock(campSays(k, q, back, fresh, left)) +
      '<div class="tc-gov b-qcard-foot">' +
        '<span class="b-qcard-num">' + esc(actor(k.owner).name) + '</span>' +
        '<button class="s-insight-lnk' + (i === 0 ? ' primary' : '') +
          '" type="button" data-camp="' + esc(k.id) + '">Work it</button>' +
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
    }).join('') + '</div>' + peekFoot(pg, 'call');
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
        '<span class="s-qrow-sub">' + esc(head) + ' · ' + esc(actor(t.by).name) +
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
          text: n
            ? 'Rung <b>' + plural(n, 'time') + '</b> and standing at <b>' + esc(r.label) +
              '</b> — ' + esc(r.say) + '.'
            : 'Nobody has rung them yet. The campaign is the only thing that knows anything about them.',
          evidence: [{ val: n, cap: n === 1 ? 'call' : 'calls' },
            { val: c.attempts, cap: 'attempts' }].filter((e) => e.val),
          act: c.next ? esc(c.next.what) + ' ' + esc(sayWhen(c.next.due)) : null,
        },
      };
    }
    const k = S.camp && DB.byCamp[S.camp];
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
    const q = queue();
    const back = q.filter((x) => x.checkpoint === 'callback').length;
    const camps = myCampaigns();
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
        'stroke-width="2.2" stroke-linecap="round" aria-hidden="true">' +
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
  const backBtn = (attr, label) =>
    '<button class="s-back" type="button" ' + attr + '>' +
      '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" ' +
        'stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
        '<path d="M15 18l-6-6 6-6"/></svg>' + esc(label) + '</button>';

  function switcher(here) {
    const one = (k, label, n, over) =>
      '<button class="b-switch-btn' + (here === k ? ' is-on' : '') + '" type="button" ' +
      'data-go="' + esc(JSON.stringify(over)) + '"' +
      (here === k ? ' aria-current="page"' : '') + '>' + esc(label) +
      '<span class="b-switch-n" data-fig="sw:' + k + '">' + commas(n) + '</span></button>';
    return '<h2 class="b-switch">' +
      one('calls', 'Calls', queue().length, cleared()) +
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

  function paintWho() {
    const p = me();
    byId('userAvatar').textContent = p.initials;
    byId('userName').textContent = p.name;
    byId('userRole').textContent = 'BDR';
  }

  /* ══ HOME — the two things a BDR opens this to see ══════════════════════
     People to call, and the campaigns they are on. The opener above them is
     the shell's own "Since your last visit" block; the ways to start are its
     own strip. Nothing else is on this page, because everything else was a
     different role's question. */
  function homePage() {
    const q = queue();
    const all = queue(null, 'all');
    const camps = myCampaigns();
    const counts = Object.create(null);
    all.forEach((c) => { const b = bucketOf(c); counts[b] = (counts[b] || 0) + 1; });

    return '<div class="s-home">' +
      topBrief('calls') +
      queueBlock(all, counts) +
    '</div>';
  }

  /* ══ THE CAMPAIGNS YOU ARE ON ═══════════════════════════════════════════
     Its own surface, not a block under a thousand people. Paged like every
     other worklist, because fourteen today is forty next quarter. */
  function campsPage() {
    const camps = myCampaigns().filter((k) => matches(campHay(k)));
    const pg = paged(camps);
    return '<div class="s-home">' +
      topBrief('camps') +
      '<section class="s-block s-block-wide" aria-label="Campaigns">' +
        '<div class="s-camp-list-head">' + switcher('camps') +
          findBox('Find a campaign, a goal, a product') + '</div>' +
        '<p class="s-block-sub">' + (S.find
          ? plural(camps.length, 'campaign') + ' matching “' + esc(S.find) + '”.'
          : plural(camps.length, 'campaign') + ' you are on, soonest to close first. ' +
            'Each says how many of its people are yours to ring.') + '</p>' +
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
    all.forEach((c) => { const b = bucketOf(c); counts[b] = (counts[b] || 0) + 1; });
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
    return d > 0 ? 'closes first, in ' + plural(d, 'day') : 'is already past its end date';
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
      const parked = DB.list.filter((l) => !l.for).length;
      return plural(DB.list.length, 'list') + ' holding <b>' + commas(people) + '</b> people' +
        (parked ? ', and <b>' + plural(parked, 'of them is', 'of them are') +
          '</b> on no campaign, so nobody on ' + (parked === 1 ? 'it' : 'them') +
          ' is in your queue' : ', all of them on a campaign') + '.';
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
    if (!bits.length) bits.push('there is nobody left to ring');
    return 'You are on ' + plural(camps.length, 'campaign') + ' and <b>' + commas(all.length) +
      '</b> people on them can be rung. ' +
      bits.join(', ').replace(/, ([^,]*)$/, ' and $1') + '.';
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
    if (here === 'camps') {
      const busiest = camps.slice().sort((a, b) => queue(b.id).length - queue(a.id).length)[0];
      const soonest = camps.slice().sort((a, b) => (a.to < b.to ? -1 : 1))[0];
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
        { k: 'not-called', label: 'Ring somebody new',
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
  function cuts(counts, all) {
    const on = S.q || 'all';
    const chip = (k, label, n) =>
      '<button class="filter-chip' + (on === k ? ' active' : '') + '" type="button" data-q="' +
      esc(k) + '">' + esc(label) + '<span class="b-cut-n" data-fig="cut:' + esc(k) + '">' + commas(n) + '</span></button>';
    return '<div class="b-cuts">' + chip('all', 'All', all.length) +
      BUCKETS.map((b) => chip(b.k, b.label, counts[b.k] || 0)).join('') + '</div>';
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
    const ring = pg.rows.filter((c) => rowVerb(c) === 'Call');
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
          ? '<h2 class="s-block-h">To call</h2>' +
            /* "Never rung 102" three sections down and "New 58" on the chip
               are both right — the roster, and who is callable now — and the
               page never said so. This is the number the chips add up to. */
            '<span class="s-block-say"><b>' + commas(all.length) + '</b> you can ring now</span>'
          : switcher('calls')) +
        /* On a campaign too. Two hundred and twenty-eight people across
           sixteen pages is the same problem the queue has, and the filter
           below already narrows whatever set it is handed. */
        findBox(S.camp ? 'Find someone on this campaign' : 'Find a name, a company, a campaign') +
      '</div>' +
      (ring.length
        ? '<div class="b-acts">' +
          '<button class="s-inline-btn" type="button" data-callall="' +
            esc(ring.map((c) => c.id).join(',')) + '">Call these ' + ring.length + '</button>' +
          '<button class="s-inline-btn s-ai-btn" type="button" data-autocall="' +
            esc(ring.map((c) => c.id).join(',')) + '">Let AiMY call ' + ring.length + '</button>' +
        '</div>'
        : '') +
      cuts(counts, all) +
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
      return '<p class="b-vfoot">' + plural(pg.total, noun, many) + ', all of them here.</p>';
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

  const FINDERS = [
    { k: 'apollo', name: 'Apollo', phone: 0.74, email: 0.86 },
    { k: 'zoom', name: 'ZoomInfo', phone: 0.58, email: 0.79 },
    { k: 'serper', name: 'Exa / Serper', phone: 0.41, email: 0.62 },
  ];

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
    return DB.net.filter((n) => {
      if (only && n.known) return false;
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

  const finderOf = () => FINDERS.filter((f) => f.k === (S.bk || 'apollo'))[0] || FINDERS[0];

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
        '<div class="b-acts">' +
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
      : '<span class="b-camps-cap">Put it on a campaign</span>' +
        myCampaigns().slice(0, 6).map((k) =>
          '<button class="filter-chip" type="button" data-addlist="' + esc(l.id) +
          '" data-tocamp="' + esc(k.id) + '">' + esc(k.name) + '</button>').join('');

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
              ? '<b>' + commas(ring.length) + '</b> you can ring now'
              : 'nobody you can ring now') + '</span>' +
            (function () {
              const by = Object.create(null);
              let none = 0;
              people.forEach((c) => {
                const ks = campsOf(c).filter(mine);
                if (!ks.length) { none++; return; }
                ks.forEach((k) => (by[k.id] = (by[k.id] || 0) + 1));
              });
              const tops = Object.keys(by).sort((x, y) => by[y] - by[x]).slice(0, 2);
              return tops.map((kid) => '<span><b>' + commas(by[kid]) + '</b> on ' +
                '<button class="s-inline-btn" type="button" data-camp="' + esc(kid) + '">' +
                esc(DB.byCamp[kid].name) + '</button></span>').join('') +
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

      '<section class="s-block s-block-wide" aria-label="Where they stand">' +
        '<div class="s-camp-list-head"><h2 class="s-block-h">Where they stand</h2>' +
          '<span class="s-block-say">what the list has yielded</span></div>' +
        funnelOf(people) +
      '</section>' +

      '<section class="s-block s-block-wide" aria-label="What has been said to them">' +
        '<div class="s-camp-list-head"><h2 class="s-block-h">What has been said to them</h2>' +
          '<span class="s-block-say">newest first</span></div>' +
        feedBlock(hist, 'Nobody on this list has been rung yet. ' + callFirst) +
      '</section>' +
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
        '<span class="s-brow-tag"><span class="tag tag-' + esc(rg.tone) + '">' + esc(rg.label) + '</span></span>' +
        (c.phone && callable(c)
          ? '<button class="s-insight-lnk b-roster-call" type="button" data-call="' + esc(c.id) + '">Call</button>'
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
  const buildAutoName = () => autoName(terms());
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

    return '<div class="s-home">' +
      backBtn('data-go="' +
        esc(JSON.stringify(Object.assign(cleared(), { on: 'lists', build: 'kind' }))) + '"',
        'Companies or people') +
      '<div class="s-sheet-head s-block-wide"><div class="s-sheet-head-main">' +
        '<div class="s-sheet-kind">New list · ' + (kind === 'con' ? 'People' : 'Companies') + '</div>' +
        '<h1 class="s-sheet-name"><input class="s-build-name" type="text" spellcheck="false" ' +
          'value="' + esc(buildName()) + '" data-auto="' + esc(buildAutoName()) + '" ' +
          'data-bname aria-label="Name this list" /></h1>' +
      '</div></div>' +

      (DRAFT.said
        ? '<p class="s-block-wide s-said">' + esc(DRAFT.said) + '</p>'
        : '<p class="s-block-wide s-said is-empty">Say who you are after in the bar below — something ' +
          'like “' + esc(eg) + '”.</p>') +

      (chips.length
        ? '<div class="s-find-crit s-block-wide">' + chips.map((c) =>
            '<button class="chip active" type="button" data-bterm="' +
            esc(c.axis + ':' + c.val) + '">' + esc(c.label) +
            '<span class="s-crit-x" aria-hidden="true">×</span></button>').join('') + '</div>'
        : '') +

      buildSuggestBlock(t, found, mine2) +

      '<div class="s-build-foot s-block-wide">' +
        '<p class="s-build-total s-block-wide"><b>' + commas(found.length) + '</b> of the ' +
          commas(DB.net.length) + ' I can reach match' +
          (take ? ', and <b>' + commas(take) + '</b> of yours' : '') + '. ' +
          esc(finderOf().name) + ' would give a number for about <b>' +
          commas(Math.round(found.length * finderOf().phone)) + '</b> of them.</p>' +
        '<div class="b-cuts">' + FINDERS.map((x) =>
          '<button class="filter-chip' + (finderOf().k === x.k ? ' active' : '') +
          '" type="button" data-finder="' + esc(x.k) + '">' + esc(x.name) +
          '<span class="b-cut-n">' + Math.round(x.phone * 100) + '%</span></button>').join('') +
        '</div>' +
        '<button class="entry-action em-direct s-build-go" type="button" data-bgo' +
          (found.length + take ? '' : ' disabled aria-disabled="true"') + '>Generate ' +
          commas(Math.min(found.length + take, 500)) + '</button>' +
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
  function buildSuggests(t, found, mine2) {
    const out = [];
    const has = (axis) => (t[axis] || []).length > 0;
    const camps = myCampaigns();

    /* Somebody already wrote down who this is for. */
    const camp = camps[0];
    if (camp && !has('industry')) {
      const read = readSaid(camp.goal + ' ' + camp.pitch, buildKind())
        .filter((p) => p[0] === 'industry');
      if (read.length) {
        out.push({ k: 'goal', terms: read,
          say: 'The goal on <b>' + esc(camp.name) + '</b> describes ' +
            read.map((p) => esc(INDUSTRY[p[1]].label)).join(', ') + '.',
          act: 'Use that' });
      }
    }
    /* Where the ones you have actually got somewhere came from. */
    if (!has('industry')) {
      const won = DB.con.filter((c) => c.checkpoint === 'handed-over');
      const inds = [];
      won.forEach((c) => {
        const a = accOf(c);
        if (a && inds.indexOf(a.industry) < 0) inds.push(a.industry);
      });
      if (inds.length) {
        out.push({ k: 'won', terms: inds.map((i) => ['industry', i]),
          say: 'Your ' + plural(won.length, 'handover') + ' came from ' +
            inds.map((i) => esc(INDUSTRY[i].label)).join(', ') + '.',
          act: 'Add those sectors' });
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
    if (found.length > 3 && !has('where')) {
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
    /* The overlap between the index and your own book. */
    if ((t.only || []).indexOf('new') < 0) {
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
    const foot = byId('pipeFootAct');
    if (foot && foot.getAttribute('data-done') !== String(finished)) {
      foot.setAttribute('data-done', String(finished));
      const f = finderOf();
      foot.innerHTML = finished
        ? '<button class="pipe-btn pipe-rise" type="button" data-pipe-open>' + pipeCheck(14) +
            'Open what came back</button>' +
          FINDERS.filter((x) => x.k !== f.k).map((x) =>
            '<button class="pipe-chip pipe-rise" type="button" data-rerun="' + esc(x.k) + '">' +
            'Run again with ' + esc(x.name) + '</button>').join('')
        : '<span class="pipe-chip">' + esc(active.label) + '…</span>';
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
  const saveCampChips = () => {
    const ks = myCampaigns().slice(0, 6);
    if (!ks.length) return '';
    return '<span class="b-camps-cap">and put it on</span>' + ks.map((k) =>
      '<button class="filter-chip" type="button" data-savecamp="' + esc(k.id) + '">' +
      esc(k.name) + '</button>').join('');
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
        '<button class="s-insight-lnk primary" type="button" data-save>Save ' + commas(n) + '</button>' +
        saveCampChips() +
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

      '<div class="s-build-foot s-block-wide">' +
        '<button class="entry-action em-direct s-build-go" type="button" data-save>Save ' +
          commas(kept + mine2.length) + '</button>' +
        /* ONE PRESS SAVES AND PUTS IT ON A CAMPAIGN. Saving and then finding
           the campaign chips on the list's page was two decisions for one
           intention, and a list that is on no campaign is a list nobody is
           working. The chips are inline, where the decision is made. */
        saveCampChips() +
        '<button class="s-inline-btn" type="button" data-go="' +
          esc(JSON.stringify(Object.assign(cleared(), { on: 'lists', build: 'describe' }))) +
          '">Change the criteria</button>' +
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
    const noPhone = rows.filter((n) => n.seedPhone >= f.phone);
    const noMail = rows.filter((n) => n.seedEmail >= f.email);
    const known = rows.filter((n) => n.known);
    const out = [];
    if (noPhone.length) {
      const better = FINDERS.filter((x) => x.phone > f.phone)
        .sort((a, b) => b.phone - a.phone)[0];
      out.push({ n: noPhone.length, act: better ? 'Ask ' + better.name : 'No better source',
        attr: better ? 'data-finder="' + esc(better.k) + '"' : 'disabled',
        say: 'came back without a number, so they cannot be rung. ' +
          (better ? esc(better.name) + ' fills ' + Math.round(better.phone * 100) +
            '% against ' + esc(f.name) + '&rsquo;s ' + Math.round(f.phone * 100) + '%.'
            : esc(f.name) + ' is the best of the three for numbers.') });
    }
    if (noMail.length) {
      const better = FINDERS.filter((x) => x.email > f.email)
        .sort((a, b) => b.email - a.email)[0];
      out.push({ n: noMail.length, act: better ? 'Ask ' + better.name : 'No better source',
        attr: better ? 'data-finder="' + esc(better.k) + '"' : 'disabled',
        say: 'have no email address. ' + (better
          ? esc(better.name) + ' fills ' + Math.round(better.email * 100) + '% of them.'
          : esc(f.name) + ' is the best of the three for addresses.') });
    }
    if (known.length) {
      out.push({ n: known.length, act: 'Leave them out', attr: 'data-bterm="only:new"',
        say: 'are already in your book, so saving these would give you a second copy ' +
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
      '<p class="s-findings-say">Three things about what came back, before you keep it.</p>' +
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
        camps: camp ? [camp.id] : [], owner: me().id, checkpoint: 'not-called', checkpointAt: null,
        attempts: 0, lastCallAt: null, next: null, remember: null, dnc: false,
        fate: SCENARIOS[i % SCENARIOS.length].k,
        enrichedAt: null,
      };
      madeAcc.push(a);
      madeCon.push(c);
    });
    const crit = describeTerms(t);
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
      (camp ? ' · on ' + camp.name : ''), () => {
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
  function addAccTo(accId, campId) {
    const a = DB.byAcc[accId];
    const k = DB.byCamp[campId];
    if (!a || !k) return;
    const touched = [];
    consAt(accId).forEach((c) => {
      if (c.camps.indexOf(campId) < 0) {
        patchCon(c, { camps: c.camps.concat([campId]) });
        touched.push(c.id);
      }
    });
    if (!touched.length) { toast('Everybody here is already on ' + k.name + '.'); return; }
    reindex();
    paint();
    toast(plural(touched.length, 'person') + ' at ' + a.name + ' joined ' + k.name, () => {
      touched.forEach((id) => {
        const c = DB.byCon[id];
        patchCon(c, { camps: c.camps.filter((x) => x !== campId) });
      });
      reindex();
      paint();
    });
  }

  function addListTo(listId, campId) {
    const l = DB.byList[listId];
    const k = DB.byCamp[campId];
    if (!l || !k) return;
    const before = l.for;
    l.for = campId;
    const touched = [];
    l.has.forEach((id) => {
      const c = DB.byCon[id];
      if (c && c.camps.indexOf(campId) < 0) { c.camps.push(campId); touched.push(id); }
    });
    const dl = DELTA.list.filter((x) => x.id === listId)[0];
    if (dl) dl.for = campId;
    (DELTA.made || []).filter((m) => m.list === listId).forEach((m) =>
      m.con.forEach((c) => { if (touched.indexOf(c.id) >= 0) c.camps = DB.byCon[c.id].camps.slice(); }));
    reindex();
    save();
    go(Object.assign(cleared(), { camp: campId }));
    toast(plural(touched.length, 'person') + ' joined ' + k.name, () => {
      l.for = before;
      if (dl) dl.for = before;
      touched.forEach((id) => {
        const c = DB.byCon[id];
        c.camps = c.camps.filter((x) => x !== campId);
      });
      reindex(); save(); go(Object.assign(cleared(), { list: listId }));
    });
  }

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
  function autoName(t) {
    const d = describeTerms(t);
    return d.length > 70 ? d.slice(0, 68) + '…' : d.replace(/^./, (c) => c.toUpperCase());
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
    all.forEach((c) => { const b = bucketOf(c); counts[b] = (counts[b] || 0) + 1; });
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
        /* "Campaign · Lina Haddad" read as a person's name. The owner is
           labelled, and the crew — who else is ringing these people — is on
           the page for the first time. */
        '<span class="s-rec-kind">Campaign · owned by ' + esc(actor(k.owner).name) +
          (function () {
            const crew = k.crew.filter((id) => id !== me().id && id !== k.owner)
              .map((id) => actor(id).name);
            return crew.length ? ' · with ' + esc(listSay(crew)) : '';
          })() + '</span>' +
        '<div class="s-rec-title">' +
          '<h1 class="s-rec-name">' + esc(k.name) + '</h1>' +
          '<span class="s-meta-st tone-' + (left <= 0 ? 'err' : left < 21 ? 'warn' : 'neutral') + '">' +
            (left > 0 ? esc(plural(left, 'day')) + ' left' : 'past its end date') + '</span>' +
        '</div>' +
        /* The dots between these come from the stylesheet, so a fact that is
           not there does not leave a separator behind it. */
        '<div class="s-rec-facts">' +
          '<div><span>' + esc(k.goal) + '</span></div>' +
          '<div>' +
            '<span>' + esc(plural(members.length, 'person')) + ' on it</span>' +
            '<span><b>' + commas(all.length) + '</b> yours to ring</span>' +
            '<span>' + esc(sayDay(k.from)) + ' to ' + esc(sayDay(k.to)) + '</span>' +
          '</div>' +
        '</div>' +
        '<div class="s-rec-actions">' +
          (all.length ? '<button class="s-insight-lnk primary" type="button" data-callnextin="' +
            esc(k.id) + '">Call the next one</button>' : '') +
          /* "Call these 15" is about the fifteen on the page of the queue, so
             it sits with the queue and nowhere else — it was here too, and a
             control repeated is a decision repeated. */
          /* THE OTHER HALF OF THE JOB. A campaign runs out of people, and
             the only door to the finder was on a surface two clicks away
             that does not know which campaign you were working. */
          '<button class="s-inline-btn" type="button" data-bopen="' + esc(k.id) +
            '">Find more for this campaign</button>' +
        '</div>' +
      '</section>' +

      /* WHETHER THE RINGING IS WORKING, BEFORE WHO TO RING. A caller who
         opens straight onto a worklist never learns how the campaign is
         doing, because nobody scrolls past their own queue to find out. */
      campLead(k) +

      /* THE WORK. */
      queueBlock(all, counts) +

      /* The detail behind the headline, under the doing of it. */
      campStands(k) +

      sellingBlock(k) +

      /* Context, not a worklist: the last few things that happened here and
         the count of what they are the last few of. A second pager on this
         page would share a page number with the queue above it or need one
         of its own, and both are worse than deciding which of the two lists
         is the reason you came. */
      '<section class="s-block s-block-wide" aria-label="What happened">' +
        '<div class="s-camp-list-head"><h2 class="s-block-h">What happened</h2>' +
          '<span class="s-block-say">newest first</span></div>' +
        feedBlock(campFeedItems(k.id)) +
      '</section>' +
    '</div>';
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
    const target = Number((k.goal.match(/\b(\d{1,4})\b/) || [])[1]) || 0;
    const wantsMeeting = !/\bconversation/i.test(k.goal);
    const at = wantsMeeting ? 'meeting-set' : 'answered';
    const done = members.filter((c) => rank(c.checkpoint) >= rank(at)).length;
    const left = daysBetween(TODAY_ISO, k.to);
    const need = Math.max(0, target - done);
    return {
      members: members, n: n, target: target, done: done, need: need, left: left,
      noun: wantsMeeting ? 'meeting' : 'conversation',
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
      ? 'You have not rung anyone on this campaign yet. Read what to say, then call the next one.'
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
        (fresh0
          ? '<button class="s-insight-lnk primary" type="button" data-pitch>Read what to say</button>'
          : '') +
        (back ? '<button class="s-insight-lnk" type="button" data-q="callback">' +
          'Work the ' + commas(back) + ' callbacks</button>' : '') +
        (fresh ? '<button class="s-insight-lnk" type="button" data-q="not-called">' +
          'Show the ' + commas(fresh) + ' never rung</button>' : '') +
        (all.length ? '' :
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
    /* What this audience says no about, counted, with the answer the
       campaign has already agreed to it. */
    const objs = Object.create(null);
    let gave = 0;
    here.forEach((t) => (t.objections || []).forEach((o) => { objs[o] = (objs[o] || 0) + 1; gave++; }));
    const top = Object.keys(objs).sort((a, b) => objs[b] - objs[a])[0];
    if (top && objs[top] >= 3) {
      const agreed = k.objections.filter((o) => o.k === top)[0];
      out.push({
        text: '<b>' + esc((OBJECTION[top] || {}).label || top) + '</b> is what they push back ' +
          'on — ' + objs[top] + ' of the ' + gave + ' reasons anybody gave here. ' +
          esc(agreed ? agreed.say : (OBJECTION[top] || {}).blurb || ''),
        from: plural(here.length, 'call') + ' on this campaign',
      });
    }

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
  function campAimy(k) {
    const rs = campReadings(k);
    if (!rs.length) return '';
    return '<div class="s-insight is-quote b-readings">' +
      '<div class="s-lead-mark">' +
        '<svg class="s-insight-mark" viewBox="0 0 18 20" width="14" height="14" aria-hidden="true">' +
          '<use href="#aimy-logo-small"/></svg>Read off the bars above' +
      '</div>' +
      '<ul class="b-reading-list">' + rs.map((r) =>
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

  function funnelOf(members) {
    const n = rungCounts(members);
    const total = members.length || 1;
    const bars = LADDER.filter((x) => n[x.k]).map((x) =>
      '<span class="b-fn-name">' + esc(x.label) + '</span>' +
      '<span class="b-fn-bar"><span class="b-fn-fill ' + (FN_TONE[x.tone] || 'tone-neutral') + '" ' +
        'style="width:' + Math.max(1, Math.round((n[x.k] / total) * 100)) + '%"></span></span>' +
      '<span class="b-fn-n">' + commas(n[x.k]) + '</span>').join('');
    const gone = EXITS.filter((x) => n[x.k]);
    const goneN = gone.reduce((t, x) => t + n[x.k], 0);
    return (bars ? '<div class="b-funnel">' + bars + '</div>' : '') +
      (goneN ? '<p class="b-tally-out">' + esc(plural(goneN, 'person')) +
        ' left the ladder — ' + gone.map((x) =>
          commas(n[x.k]) + ' ' + esc(x.label.toLowerCase())).join(', ') + '.</p>' : '');
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
          (n.interested || 0) + (n['handed-over'] || 0), 'a time in a diary', 'ok') +
      '</div>' +

      funnelOf(st.members) +
      campAimy(k) +
    '</section>';
  }


  /* ══ WHAT TO SAY, IN THE ORDER YOU SAY IT ══════════════════════════════
     It was one paragraph of product names run together, a second paragraph
     of pitch, a set of objections drawn with `.s-callsum-mem` — the Remember
     style, an accent stripe meant for a durable fact about one person — and
     a row of grey tags. Four kinds of preparation at one weight, in a block
     whose whole job is to be scanned in the ten seconds before a call
     connects.

     Now it runs in the order the call does: what we sell, the sentence you
     open with, what comes back at you and the agreed answer to it, and what
     you can send afterwards. The opener gets the deck step because it is the
     one thing here you actually say out loud.

     STILL A DISCLOSURE, open the first time and however you left it after.
     A caller who has run this campaign for three weeks does not need the
     pitch on screen above the feed every time they come back. */
  /* The first sentence of a pitch, cut at a word if it runs long. */
  const firstSentence = (t) => {
    const one = String(t || '').split(/(?<=[.!?])\s/)[0] || '';
    return one.length > 96 ? one.slice(0, 92).replace(/\s+\S*$/, '') + '…' : one;
  };

  function sellingBlock(k) {
    const sells = k.sells.map((x) => SELL[x]).filter(Boolean);
    const cap = (t) => '<h3 class="b-sell-cap">' + esc(t) + '</h3>';
    /* ══ ONE SHAPE FOR BOTH LISTS ══════════════════════════════════════
       What we sell and what they push back on are the same shape — a name
       and a line about it — and they were drawn two different ways: the
       first as bold-then-text run together on one line, the second in a
       96px RIGHT-aligned gutter where "Something else" wrapped to two lines
       and every label ended at a different distance from its own answer.
       Four left edges in one block, and nothing to scan down.

       One grid, one left edge, labels left-aligned so they start where the
       eye is already going. The "is-say" modifier marks the lines you
       actually speak, which get full ink; a product blurb is read, not said. */
    const rows = (pairs, mod) => '<div class="b-say' + (mod || '') + '">' +
      pairs.map((r) => '<span class="b-say-k">' + esc(r[0]) + '</span>' +
        '<span class="b-say-v">' + esc(r[1]) + '</span>').join('') + '</div>';
    return '<details class="s-block s-block-wide b-sell" id="pitchBox"' +
      (UI.pitchSeen ? '' : ' open') + '>' +
      /* THE FOLDED LINE IS THE OPENER. It listed the product names, which
         are on the campaign card and in the header; the one thing a folded
         block should hand you is the sentence you are about to say. */
      '<summary class="b-sell-sum"><span class="s-block-h">What to say</span>' +
        '<span class="s-block-say b-sell-opener">' + esc(firstSentence(k.pitch)) +
        '</span></summary>' +
      '<div class="b-sell-body">' +

        cap('What we sell them') +
        rows(sells.map((x) => [x.name, x.blurb])) +

        cap('Open with') +
        '<p class="b-sell-pitch">' + esc(k.pitch) + '</p>' +

        cap('What comes back, and what to say to it') +
        rows(k.objections.map((o) =>
          [(OBJECTION[o.k] || {}).label || o.k, o.say]), ' is-say') +

        (k.resources.length
          ? cap('What you can send') +
            '<div class="b-cuts">' + k.resources.map((r) =>
              '<span class="tag tag-neutral">' + esc(r.name) + '</span>').join('') + '</div>'
          : '') +
      '</div>' +
    '</details>';
  }

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
    const everReached = hist.some((t) => t.outcome === 'reached');
    const chip = top && rank(top.checkpoint) >= rank('answered')
      ? { label: rungLabel(top.checkpoint) + ' here', tone: (RUNG[top.checkpoint] || {}).tone || 'ok' }
      : everReached
        ? { label: 'Reached before', tone: 'ok' }
        : { label: 'Nobody reached yet', tone: 'neutral' };

    const chips = free.length
      ? '<div class="b-camps-row" id="accCamps">' +
          '<span class="b-camps-cap">Put everybody here on a campaign</span>' +
          free.map((k) =>
            '<button class="filter-chip" type="button" data-addacc="' + esc(a.id) +
            '" data-tocamp="' + esc(k.id) + '">' + esc(k.name) + '</button>').join('') +
        '</div>'
      : '';
    const callFirst = ring.length
      ? '<button class="s-inline-btn" type="button" data-call="' + esc(ring[0].id) + '">Call ' +
        esc(ring[0].name.split(' ')[0]) + '</button>'
      : '';

    return '<div class="s-home">' +
      backBtn('data-back', 'Back') +

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
            : '<span class="s-block-sub">Nobody here has a number you can ring. ' +
              (free.length ? 'Putting them on a campaign is the next thing.' : '') + '</span>') +
        '</div>' +
      '</section>' +

      accLead(a, people, hist, ring, free) +

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
          '<span class="s-block-say">' + esc(plural(hist.length, 'call')) +
          ' into this company</span></div>' +
        funnelOf(people) +
      '</section>' +

      /* Every call into the company, whoever made it and whoever they
         rang. On an account the person is the thing that tells two calls
         apart, so the row leads with the name — and it is the same feed
         the campaign uses, under the day it happened. */
      '<section class="s-block s-block-wide" aria-label="What has been said here">' +
        '<div class="s-camp-list-head"><h2 class="s-block-h">What has been said here</h2>' +
          '<span class="s-block-say">newest first</span></div>' +
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
    const target = (who && callable(who)) ? who : ring[0];
    let door = '';
    if (target) {
      door = '<button class="s-insight-lnk" type="button" data-call="' + esc(target.id) + '">' +
        'Call ' + esc(target.name.split(' ')[0]) +
        (who && target.id === who.id ? ' — they picked up before' : '') + '</button>';
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
  function accSays(a, people, hist) {
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
        from: plural(hist.length, 'call') + ' into this company' };
    }
    /* Rung and rung and nothing, across the whole company. */
    if (hist.length >= 3 && !got) {
      return { text: plural(hist.length, 'call') + ' in and nobody here has picked up. ' +
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
    const others = a ? consAt(a.id).filter((x) => x.id !== c.id) : [];
    const rg = RUNG[c.checkpoint] || RUNG['not-called'];
    const n = (DB.touchesOf[c.id] || []).length;

    return '<div class="s-home">' +
      backBtn('data-back', 'Back to the briefing') +

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
              ? '<span><button class="s-inline-btn" type="button" data-acc="' + esc(a.id) +
                '">' + plural(others.length, 'other') + ' at ' + esc(a.name) + '</button></span>'
              : (a ? '<span>the only person here</span>' : '')) +
          '</div>' +
        '</div>' +
        actionsRow(c) +
      '</section>' +

      conLead(c) +

      '<section class="s-block s-block-wide" aria-label="Where they stand">' +
        '<div class="s-camp-list-head"><h2 class="s-block-h">Where they stand</h2>' +
          '<span class="s-block-say">' + esc(plural(c.attempts, 'attempt')) + '</span></div>' +
        ladder(c) +
        '<p class="s-block-sub">' + esc(whatNext(c)) + '</p>' +
        owedLine(c) +
        (c.remember
          ? '<p class="s-callsum-mem"><span class="s-plan-cap">Remember</span>' +
            esc(c.remember.text) + ' <span class="b-faint">— ' +
            esc(actor(c.remember.by).name) + '</span></p>'
          : '') +
      '</section>' +

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
  function actionsRow(c) {
    const first = c.name.split(' ')[0];
    const call = c.phone
      ? { html: 'Call ' + esc(first), attr: 'data-call="' + esc(c.id) + '"' } : null;
    const moves = movesFor(c).map((m) => ({ html: esc(m.label), attr: 'data-move="' + esc(m.k) + '"' }));
    const send = (c.checkpoint === 'answered' || c.checkpoint === 'callback')
      ? { html: 'Send the company profile', attr: 'data-sendprofile="' + esc(c.id) + '"' } : null;
    /* Past a meeting the question is what happened at it; before one, the
       question is the phone. */
    const settling = rank(c.checkpoint) >= rank('meeting-set') && !isExit(c.checkpoint);
    const list = (settling ? moves.concat(call ? [call] : []) : (call ? [call] : []).concat(moves))
      .concat(send ? [send] : []);
    /* [8] THE WAY OUT IS THE NEXT PERSON. Reads the same ranking the queue
       uses, so the name here is the card that would be first if you went
       back — which is the whole point of not going back. */
    const next = queue(null, 'all').filter((x) => x.id !== c.id)[0];
    return '<div class="s-rec-actions">' +
      list.map((b, i) =>
        '<button class="' + (i === 0 ? 's-insight-lnk primary' : 's-inline-btn') + '" type="button" ' +
        b.attr + '>' + b.html + '</button>').join('') +
      (!list.length
        ? '<span class="s-block-sub">' + esc(isExit(c.checkpoint)
            ? rg2(c) + ', so there is nothing to press. Undo on the toast is the way back.'
            : 'The director has it now.') + '</span>'
        : '') +
      (next
        ? '<button class="s-inline-btn b-next" type="button" data-con="' + esc(next.id) + '">' +
          'Next in the queue: ' + esc(next.name) + ' →</button>'
        : '') +
    '</div>';
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
    if (c.attempts >= 3 && c.checkpoint === 'no-answer' && others.length) {
      door = '<button class="s-insight-lnk" type="button" data-acc="' + esc(a.id) + '">' +
        'Try one of the ' + others.length + ' others at ' + esc(a.name) + '</button>';
    } else if (last && last.outcome === 'gatekeeper' && c.phone) {
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

  /* [4] What is owed, and the three ways to move it, on one line. */
  function owedLine(c) {
    if (!c.next) return '';
    const late = daysBetween(TODAY_ISO, c.next.due) < 0;
    return '<div class="b-owed">' +
      '<span class="b-owed-say"><b>' + esc(c.next.what) + '</b> ' +
        (late ? 'was due ' : 'due ') + esc(sayWhen(c.next.due)) + '</span>' +
      [[1, 'Tomorrow'], [3, 'In 3 days'], [7, 'Next week']].map((d) =>
        '<button class="filter-chip" type="button" data-movenext="' + d[0] + '">' +
        esc(d[1]) + '</button>').join('') +
      '<button class="filter-chip" type="button" data-movenext="clear">Drop it</button>' +
    '</div>';
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
    const pg = peek(all);
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
      return head + '<details class="s-call b-tl-item' + (up || out ? ' is-milestone' : '') + '"' +
        (i === 0 ? ' open' : '') + '>' +
        '<summary class="s-call-sum">' +
          '<span class="b-tl-dot ' + (TL_TONE[o ? o.tone : 'neutral'] || 'tone-neutral') +
            '" aria-hidden="true"></span>' +
          '<span class="s-call-when">' + esc(sayDay(t.at)) + '</span>' +
          '<span class="s-call-by' + (t.by === 'aimy' ? ' is-ai' : '') + '">' +
            esc(actor(t.by).name) + '</span>' +
          '<span class="s-call-out tone-' + esc(o ? o.tone : 'neutral') + '">' +
            esc(kindLabel(t)) + '</span>' +
          (t.moved
            ? '<span class="b-tl-move' + (out ? ' is-out' : '') + '">→ ' + esc(rungLabel(t.moved[1])) + '</span>'
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
      /* Where it began. Read off the whole history, not the eight shown, so
         the end of the rail is the true start of the journey. */
      '<div class="b-tl-end"><span class="b-tl-dot is-end" aria-hidden="true"></span>' +
        'First rung ' + esc(sayDay(oldest.at)) + ' · ' + esc(plural(all.length, 'touchpoint')) +
        (climbed ? ' · ' + esc(plural(climbed, 'rung')) + ' climbed' : ' · no rung climbed yet') +
      '</div>' +
    '</div>' + peekFoot(pg, 'touchpoint');
  }



  /* ══ WHAT HAPPENS NEXT, AND WHOSE JOB IT IS ════════════════════════════
     The ladder says where they stand. It does not say what standing there
     means you do — and for the last two rungs it means somebody else does
     it. A BDR's part of this process ends at the handover: discovery, the
     proof meeting, the commercial one and the resolution belong to the
     director, and a page that stops naming them at the handover leaves the
     caller thinking the lead has gone quiet. */
  function whatNext(c) {
    switch (c.checkpoint) {
      case 'not-called':  return 'Next: ring them for the first time.';
      case 'no-answer':   return 'Next: try again, or find a number they answer.';
      case 'callback':    return 'Next: ring them back when they said.';
      case 'answered':    return 'Next: ask for the meeting, or send them something and ring again.';
      case 'meeting-set': return 'Next: the meeting happens, then say here whether they turned up.';
      case 'showed-up':   return 'Next: say whether they are interested. That is the last thing this rung is waiting on.';
      case 'interested':  return 'Next: hand them to the director. Past that it is discovery, proof, commercial and resolution — and none of those are yours.';
      case 'handed-over': return 'Done. The director runs discovery, proof, commercial and resolution from here.';
      case 'declined':    return 'Nothing is owed. Ring again only if something has changed.';
      case 'wrong-number': return 'Nothing is owed until somebody finds a number that is theirs.';
      case 'do-not-call': return 'Nothing is owed, and nothing may be. They opted out.';
      default:            return 'Next: ring them.';
    }
  }

  /* The ladder: eight bars and one sentence. The bars carry the position, the
     sentence carries the meaning. An exit is not a rung — it lights the whole
     track in the exit's colour, because a lead that said no is not standing
     partway up anything. */
  function ladder(c) {
    const out = isExit(c.checkpoint);
    const at = rank(c.checkpoint);
    const bars = LADDER.map((x, i) => {
      const cls = out ? 'is-exit' : i < at ? 'is-done' : i === at ? 'is-now' : '';
      return '<span class="b-rung ' + cls + '"></span>';
    }).join('');
    const r = RUNG[c.checkpoint];
    return '<div class="b-ladder">' + bars + '</div>' +
      '<p class="b-ladder-say"><b>' + esc(r.label) + '</b> — ' + esc(r.say) +
      (c.checkpointAt ? ', ' + esc(sayWhen(c.checkpointAt)) : '') + '.</p>';
  }

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
  ];
  const bucketOf = (c) => c.checkpoint;
  const B_ORDER = Object.create(null);
  BUCKETS.forEach((b, i) => (B_ORDER[b.k] = i));

  /* Why this person is on the list today, with the fact in it. A queue that
     cannot say why it ranked somebody is a queue you have to trust. */
  function whyLine(c) {
    switch (c.checkpoint) {
      case 'callback':
        return 'Asked to be rung back <b>' +
          esc(c.next ? sayWhen(c.next.due) : sayWhen(c.lastCallAt)) + '</b>';
      case 'not-called':
        return 'Never rung';
      case 'no-answer':
        return 'Rung <b>' + plural(c.attempts, 'time') + '</b>, last ' + esc(sayWhen(c.lastCallAt));
      default:
        return 'Spoke to them <b>' + esc(sayWhen(c.lastCallAt)) + '</b>, no meeting yet';
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
  function queue(campId, bucket) {
    const meId = me().id;
    const mineCamps = Object.create(null);
    myCampaigns().forEach((c) => (mineCamps[c.id] = 1));
    const pool = campId ? membersOf(campId) : DB.con;
    const out = [];
    for (let i = 0; i < pool.length; i++) {
      const c = pool[i];
      if (!c || !callable(c)) continue;
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
        REPS.filter((x) => x.fn === 'bdr').map((x) =>
          '<button class="proto-link" type="button" data-as="' + esc(x.id) + '">' +
          esc(x.name) + (x.id === me().id ? ' — you' : '') + '</button>').join('') +
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
      ['them', 'Our new head of support starts Monday. Worth half an hour with her.'],
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
      ['you', 'When is the best time to try her?'],
      ['them', 'I could not say. I will pass it on.'],
    ],
    'gatekeeper-mobile': [
      ['you', 'Morning, is {first} about?'],
      ['them', 'This is the front desk. Who is calling?'],
      ['you', 'It is Engy. Is there a better way to reach her?'],
      ['them', 'For next time, she takes calls on the mobile, not through me.'],
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
        if (el) el.textContent = fmtClock(DB.call.secs);
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
  function endCall() {
    const c = DB.call;
    if (!c || c.state === 'ready') return;
    clearCallTimers();
    const heard = readCall(transcriptText(c));
    PENDING = {
      con: c.con, camp: c.camp, secs: c.secs, sess: c.sess, auto: c.auto,
      lines: c.script.slice(0, c.shown).map((l) => ({ who: l[0], text: l[1] })),
      note: c.note, read: heard, outcome: heard.disp || 'no-answer',
      guessed: !heard.disp, when: heard.when || 1,
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
    if (outcome === 'no-answer' || outcome === 'gatekeeper') return { to: up('no-answer') };
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
    toast('Logged ' + said + ' with ' + c.name.split(' ')[0] + moved + where, () => {
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
          (ready ? 'Ready to call' : dialing ? 'Connecting…' : fmtClock(call.secs)) + '</span>' +
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

        /* Deciding not to ring somebody is a decision you make reading their
           brief, not while their phone rings — so Skip holds in `ready`. */
        /* Skip belongs to a RUN. Outside one there is nothing to skip to,
           and V3 draws exactly one control here: Start call. A second button
           beside it broke the full-width primary the whole column ends on. */
        (ready && sess
          ? '<button class="call-tool call-tool-word" type="button" data-callskip>Skip</button>'
          : '') +
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
  function sendProfile(id) {
    const c = DB.byCon[id];
    if (!c) return;
    const camp = DB.byCamp[campFor(c)];
    const before = { next: c.next };
    const now = new Date().toISOString();
    const t = {
      id: 'e' + Date.now().toString(36) + Math.floor(Math.random() * 1000),
      con: c.id, camp: campFor(c), by: me().id, at: now, secs: 0,
      outcome: 'sent',
      proposals: ['info'], objections: [], openings: [],
      note: 'Sent the company profile' + (camp ? ' for ' + camp.name : '') + '.',
      lines: [], next: null, moved: null,
    };
    /* It buys a reason to ring again, so it sets one. */
    patchCon(c, { next: { what: 'Call them back', due: dayAdd(3) } });
    addTouch(t);
    paint();
    toast('Company profile sent to ' + c.name.split(' ')[0] + ' · ring back in 3 days', () => {
      dropTouch(t.id);
      patchCon(c, before);
      paint();
    });
  }

  const MOVES = [
    { k: 'showed-up',   label: 'They showed up',  from: ['meeting-set'] },
    { k: 'no-show',     label: 'They did not show', from: ['meeting-set'] },
    { k: 'interested',  label: 'They are interested', from: ['meeting-set', 'showed-up'] },
    { k: 'handed-over', label: 'Hand to the director', from: ['showed-up', 'interested'] },
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
      note: mv === 'no-show' ? 'They did not turn up.'
        : (MOVES.filter((m) => m.k === mv)[0] || {}).label + '.',
      lines: [], next: null, moved: [c.checkpoint, to],
    };
    patchCon(c, { checkpoint: to, checkpointAt: now, next: nextForRung(to) });
    addTouch(t);
    const camp = DB.byCamp[t.camp];
    toast(c.name.split(' ')[0] + ' → ' + rungLabel(to) +
      (camp ? ' · ' + camp.name : ''), () => {
      dropTouch(t.id);
      patchCon(c, before);
      paint();
    });
    paint();
  }

  /* Moving a date without a picker. Three chips and a way to drop it — the
     three answers that cover almost every follow-up a caller sets, and the
     fourth case is a sentence to AiMY. */
  function moveNext(id, days) {
    const c = DB.byCon[id];
    if (!c || !c.next) return;
    const before = { next: c.next };
    patchCon(c, { next: days == null ? null : { what: c.next.what, due: dayAdd(days) } });
    toast(days == null ? 'Dropped the follow-up on ' + c.name.split(' ')[0]
      : c.next.what + ' moved to ' + sayWhen(c.next.due), () => {
      patchCon(c, before); paint();
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
    const met = DB.con.filter((c) => c.checkpoint === 'meeting-set' && c.next &&
      daysBetween(TODAY_ISO, c.next.due) < 0 && campsOf(c).some(mine));
    if (met.length) {
      tasks.push({ id: 'meetings', sev: 'p2', type: 'Meetings', when: met.length + ' unconfirmed',
        body: plural(met.length, 'meeting') + (met.length === 1 ? ' has' : ' have') +
          ' passed and nobody has said whether they turned up.',
        cta: 'Say what happened',
        ask: 'Which meetings have passed without anyone saying whether they turned up?' });
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
    const loose = DB.list.filter((l) => !l.for);
    if (loose.length) {
      const n = loose.reduce((t, l) => t + l.has.length, 0);
      tasks.push({ id: 'lists-loose', sev: 'p3', type: 'Lists', when: loose.length + ' not on one',
        body: plural(loose.length, 'list') + (loose.length === 1 ? ' is' : ' are') +
          ' on no campaign, so ' + plural(n, 'person') + ' are not in your queue.',
        cta: 'Put them on one', ask: 'Which of my lists are not on a campaign?' });
    }
    return tasks;
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

  function openCanvas() { byId('aimyOverlay').classList.add('open'); }
  function closeCanvas() {
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

  /* EVERY TURN HAS A FACE. Your initials on yours, the mark on AiMY's —
     which is the thing that makes a bubble AiMY speaking rather than the
     product printing. Mine had none at all. */
  const msgAvatar = (who) => (who === 'you'
    ? '<div class="msg-avatar user-av">' + esc(me().initials) + '</div>'
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
              '<button class="s-cb-opt' + (t.spent ? ' is-spent' : '') + '" type="button" ' +
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

  function runInput(text) {
    const t = String(text || '').trim();
    if (!t) return;

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
      lbuildRead(t);
      return;
    }

    /* ══ THE BUILDER OWNS THE BAR WHILE IT IS OPEN ═════════════════════════
       A textarea on the describe step asking "who are you looking for" beside
       a fixed composer asking the same thing in different words makes the
       first question of the interaction "which box?". There is one box, and
       it is the one that was already there — the page shows what it HEARD. */
    if (S.build === 'describe' && DRAFT) {
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
      if (found && found.con) { hideCanvas(); go({ con: found.con.id }); return; }
      if (found && found.camp) {
        hideCanvas();
        go(Object.assign(cleared(), { camp: found.camp.id }));
        return;
      }
      /* A sentence that reads as a call, against whoever is open. */
      const read = readCall(t);
      if (read.disp && S.con) {
        toast('Open the call panel to log that against ' + DB.byCon[S.con].name.split(' ')[0] + '.');
        return;
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
    all.forEach((c) => { const b = bucketOf(c); counts[b] = (counts[b] || 0) + 1; });
    const door = (label, over) =>
      '<button class="s-insight-lnk" type="button" data-go="' + esc(JSON.stringify(over)) +
      '">' + esc(label) + '</button>';

    if (/\bmeeting/.test(q)) {
      const met = DB.con.filter((c) => c.checkpoint === 'meeting-set' && c.next &&
        daysBetween(TODAY_ISO, c.next.due) < 0 && campsOf(c).some(mine));
      if (!met.length) return 'No meeting has passed without an outcome. Everything booked is still ahead.';
      return '<b>' + plural(met.length, 'meeting') + '</b> ' + (met.length === 1 ? 'has' : 'have') +
        ' passed and nobody has said whether they turned up.' +
        '<div class="b-cuts">' + met.slice(0, 6).map((c) =>
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
      return '<b>' + plural(counts.callback || 0, 'person') + '</b> asked to be rung back' +
        (S.camp ? ' on this campaign' : ' across your ' +
        plural(myCampaigns().length, 'campaign')) + '. ' +
        door('Show them', Object.assign(cleared(), { camp: S.camp || '', q: 'callback' }));
    }
    if (/how many|left|remaining|to call/.test(q)) {
      return '<b>' + commas(all.length) + '</b> people can be rung' +
        (S.camp ? ' on this campaign' : '') + ' — ' +
        BUCKETS.filter((b) => counts[b.k]).map((b) =>
          commas(counts[b.k]) + ' ' + b.label.toLowerCase()).join(', ') + '. ' +
        door('Work the queue', Object.assign(cleared(), { camp: S.camp || '' }));
    }
    if (/happened|yesterday|today.*call|did i/.test(q)) {
      const since = new Date(Date.now() - 2 * DAY_MS).toISOString();
      const mineT = DB.touch.filter((t) => t.by === me().id && t.at >= since);
      if (!mineT.length) return 'Nothing on the record from you in the last two days.';
      const by = Object.create(null);
      mineT.forEach((t) => (by[t.outcome] = (by[t.outcome] || 0) + 1));
      return '<b>' + plural(mineT.length, 'call') + '</b> in the last two days — ' +
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
    return 'I can tell you what is due, how many are left to call, what you logged ' +
      'recently, and when people actually answer. Everything else is on the page.';
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

  function callPrep(c) {
    const a = accOf(c);
    const camp = DB.byCamp[campFor(c)];
    const hist = (DB.touchesOf[c.id] || []).map((id) => TOUCH[id]).filter(Boolean);
    const last = hist[0];
    const sess = DB.call && DB.call.sess;
    const line = (k, v) => '<p class="s-callp"><b>' + esc(k) + '</b> ' + v + '</p>';

    let body = '<div class="s-brief-call">';
    body += line('Who', esc(c.name) + ', ' + esc(c.title) +
      (a ? ' at ' + esc(a.name) + ' · ' + esc(INDUSTRY[a.industry].label) + ' · ' +
        commas(a.size) + ' staff' : ''));
    /* WHERE THEY ARE, SAID BEFORE WHAT HAS PASSED. The rung is the one
       fact that decides what this call is for, and it was the one fact the
       brief did not carry. `since` and the owed follow-up come with it,
       because a checkpoint with no date is a claim with no age. */
    const rg = RUNG[c.checkpoint];
    body += line('Where they are', '<span class="tone-' + esc(rg.tone) + '">' +
      esc(rg.label) + '</span> — ' + esc(rg.say) +
      (c.checkpointAt ? esc(', since ' + sayWhen(c.checkpointAt)) : '') +
      (c.next ? esc('. ' + c.next.what + ' ' +
        (daysBetween(TODAY_ISO, c.next.due) < 0 ? 'was due ' : 'is due ') +
        sayWhen(c.next.due)) : ''));
    body += line('What has passed', hist.length
      ? esc(plural(hist.length, 'touchpoint') + ', last ' + kindLabel(last).toLowerCase() +
        ' ' + sayWhen(last.at)) + (last.note ? ' — ' + esc(last.note) : '')
      : 'Nothing. This is the first contact.');
    if (c.remember) {
      body += line('Remember', esc(c.remember.text) + ' <span class="s-callp-who">— ' +
        esc(actor(c.remember.by).name) + '</span>');
    }
    if (camp) {
      body += line('Selling', esc(camp.sells.map((k) => SELL[k].name).join(' and ')));
      body += line('The goal', esc(camp.goal));
    }
    body += line('Open with', esc(stageOpen(c, camp, last)));
    /* ON A FIRST CALL THERE IS NOTHING TO PICK UP FROM, so the campaign's
       own material stands in for the history — which is the only thing a
       caller can actually offer somebody they have never spoken to. */
    if (camp && c.checkpoint === 'not-called' && camp.resources.length) {
      body += line('What you can send', camp.resources.map((r) =>
        '<span class="tag tag-neutral">' + esc(r.name) + '</span>').join(' '));
    }
    const obj = objectionLikely(c, camp);
    if (obj) body += line('They will push back on', obj);
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
      hist.length ? plural(hist.length, 'call') + ' on the record' : 'nothing on the record yet'));
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
  });

  function callFacts(f, c) {
    const o = OUTCOME[f.outcome];
    const rows = [];
    if (o) rows.push(['Outcome', o.label, o.tone]);
    /* A rung somebody settled by hand and a profile going out are not
       calls, and the card says what they were rather than filing them
       under an outcome they never had. */
    else if (KINDS[f.outcome]) rows.push(['What happened', KINDS[f.outcome], 'neutral']);
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
    } else if (c) {
      rows.push(['Checkpoint', 'stays at ' + rungLabel(f.from || c.checkpoint), 'neutral']);
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
      html: esc(logSay(call)) + ' Is that right?',
      hint: 'Or tell me what I got wrong, or press [1] to [7] for the outcome.',
      /* THE NOTE COMES OFF THE PROPOSAL and stays on the record's card. Here
         it is either the sentence you typed one line above or the paraphrase
         AiMY said one line above, and a card that repeats the two things
         bracketing it is asking to be skipped. */
      card: '<div class="s-callsum-in-turn">' +
        callSummaryHtml(factsOfPending(call, c, mv), c, '', call.lines) + '</div>',
      step: 'calllog',
      opts: [{ k: 'go', label: sess
        ? (nextCon ? 'Log it and call ' + nextCon.name.split(' ')[0] : 'Log it and finish')
        : 'Log it' }],
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
    if (read.disp) call.outcome = read.disp;
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
  /* Two in ten get through, which is what cold calling actually returns —
     but front-loaded, because a five-call demo off a rotation that starts
     with three misses shows a run where nothing happened. */
  const AUTO_DEAL = ['reached', 'no-answer', 'gatekeeper', 'no-answer', 'callback',
    'no-answer', 'reached', 'no-answer', 'not-interested', 'no-answer'];
  let AUTO_TICK = null;

  function autoCall(ids) {
    const live = ids.filter((id) => DB.byCon[id] && DB.byCon[id].phone && !DB.byCon[id].dnc);
    if (!live.length) { toast('Nobody in this set has a number to ring.'); return; }
    if (AUTO_TICK) { toast('AiMY is already working through a set.'); return; }
    const sess = {
      id: 'a' + Date.now().toString(36), ids: live, done: [], skipped: [],
      at: new Date().toISOString(), auto: true, dealt: 0,
    };
    DB.session.push(sess);
    openCanvas();
    say('aimy', answerBlock('Calling ' + plural(live.length, 'person'),
      '<p class="s-callsum-note">I will work through them and write up each one as I go. ' +
      'Everything I log is attributed to me, and every line of it can be undone.</p>' +
      '<div class="b-cuts"><button class="s-inline-btn" type="button" data-autostop>' +
      'Stop it</button></div>', 'you started this run'));
    AUTO_TICK = setInterval(() => autoTick(sess), 1400);
    autoTick(sess);
  }

  function autoTick(sess) {
    const nextId = sess.ids.filter((id) =>
      sess.done.indexOf(id) < 0 && sess.skipped.indexOf(id) < 0)[0];
    if (!nextId) { autoStop(sess); return; }
    const c = DB.byCon[nextId];
    if (!c) { sess.skipped.push(nextId); return; }
    const outcome = AUTO_DEAL[sess.dealt++ % AUTO_DEAL.length];
    const props = outcome === 'reached' ? [sess.dealt % 2 ? 'meeting' : 'info'] : [];
    const before = {
      checkpoint: c.checkpoint, checkpointAt: c.checkpointAt, attempts: c.attempts,
      lastCallAt: c.lastCallAt, next: c.next, dnc: c.dnc,
    };
    const mv = moveFor(c, outcome, props, 7);
    const now = new Date().toISOString();
    const t = {
      id: 'u' + Date.now().toString(36) + sess.dealt,
      con: c.id, camp: campFor(c), by: me().id, auto: true, at: now,
      secs: outcome === 'reached' ? between(rng(sess.dealt * 7), 90, 420) : 20,
      outcome: outcome, proposals: props, objections: [], openings: [],
      note: 'AiMY called them.', lines: [], next: mv.next || null,
      moved: mv.to ? [c.checkpoint, mv.to] : null,
    };
    const fields = { attempts: c.attempts + 1, lastCallAt: now };
    if (mv.to) { fields.checkpoint = mv.to; fields.checkpointAt = now; }
    if (mv.next) fields.next = mv.next;
    if (mv.dnc) fields.dnc = true;
    if (mv.to && isExit(mv.to)) fields.next = null;
    patchCon(c, fields);
    addTouch(t);
    sess.done.push(c.id);
    say('aimy', '<b>' + esc(c.name) + '</b> — ' +
      esc((OUTCOME[outcome] || {}).label || outcome) +
      (mv.to ? ', now ' + esc(rungLabel(mv.to)) : '') +
      ' <span class="s-callp-who">' + sess.done.length + ' of ' + sess.ids.length + '</span>');
    paint();
  }

  function autoStop(sess) {
    if (AUTO_TICK) { clearInterval(AUTO_TICK); AUTO_TICK = null; }
    sess.finished = new Date().toISOString();
    sessionSummary(sess);
    paint();
  }

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
            : 'Nobody picked up.') + '</span></div>' +
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

  const LB_OUT = { k: 'open', label: 'Open the builder instead' };
  const LB_GO = { k: 'go', label: 'That is enough — look now' };

  /* Options belong to the turn that offered them, and only the newest turn's
     are live. Old chips left pressable are a conversation you can answer
     twice in different places. */
  function lbuildSpend() {
    TURNS.forEach((t) => { if (t.opts) t.spent = true; });
  }
  function lbuildPush(text, opts, hint) {
    lbuildSpend();
    TURNS.push({ who: 'aimy', html: text, opts: opts || [], hint: hint || '' });
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
    return autoName(t);
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

  function lbuildStart(campId) {
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
      [LB_OUT], 'Something like “QA managers at software companies in the Netherlands”.');
  }

  /* Read a sentence into criteria, then say what was understood and what it
     leaves. Nothing is applied silently and nothing is applied twice. */
  function lbuildRead(text) {
    if (!LBUILD.kind) LBUILD.kind = /\bcompan|organisation|organization|firm/i.test(text) ? 'acc' : 'con';
    const read = readSaid(text, LBUILD.kind);
    TURNS.push({ who: 'you', html: esc(text) });
    if (!read.length) {
      lbuildPush('I could not pick a sector, a country, a size or a job title out of that.',
        [LB_GO, LB_OUT], 'Try naming one of those.');
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
    const head = added.length
      ? 'Read that as <b>' + added.map((p) => esc(label(p))).join(', ') + '</b>.'
      : 'Nothing new in that.';
    if (!hit) {
      lbuildPush(head + ' Nothing in the index matches all of that. Take something ' +
        'back off it and I will look again.',
        [{ k: 'reset', label: 'Start the criteria again' }, LB_OUT],
        'Or say it differently.');
      return;
    }
    lbuildPush(head + ' ' + lbuildSay() + lbuildNudge(), [LB_GO, LB_OUT],
      'Say anything else that narrows it, or say go.');
  }

  function lbuildName() {
    LBUILD.step = 'name';
    lbuildPush(lbuildSay() + ' What should the list be called?',
      [{ k: 'name-auto', label: 'Call it “' + lbuildAutoName() + '”' }, LB_OUT],
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
      const flat = LBUILD.terms.map((p) => p[0] + ':' + p[1]);
      const kind = LBUILD.kind || 'con';
      LBUILD = null;
      hideCanvas();
      DRAFT = { kind: kind, said: '', name: null, take: [], drop: [], rows: [], run: null };
      go(Object.assign(cleared(), { on: 'lists', build: kind ? 'describe' : 'kind',
        bk: kind, bt: flat.join(',') }));
      return;
    }
    if (k === 'kind-acc') { lbuildKind('acc'); return; }
    if (k === 'kind-con') { lbuildKind('con'); return; }
    if (k === 'go') { lbuildName(); return; }
    if (k === 'name-auto') { lbuildConfirm(lbuildAutoName()); return; }
    if (k === 'reset') {
      LBUILD.terms = [];
      lbuildPush('Cleared. Who are you after?', [LB_OUT], 'Name a sector, a country or a size.');
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
    if (con) { hideCanvas(); go({ con: con.getAttribute('data-con') }); return; }

    /* Back to where you were, not to the front page. `data-home` clears every
       key, which from row eleven of page four of the Due cut means losing the
       cut, the page and the row — three deliberate choices, undone by the
       control that was supposed to return you to them. */
    const back = t.closest('[data-back]');
    if (back) { go({ con: '' }); return; }

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
    if (finder) { go({ bk: finder.getAttribute('data-finder') }); return; }
    if (t.closest('[data-pipe-open]')) { go({ build: 'done' }, true); return; }
    const rerun = t.closest('[data-rerun]');
    if (rerun) { S.bk = rerun.getAttribute('data-rerun'); buildRun(); return; }
    if (t.closest('[data-save]')) { saveList(); return; }
    const sc = t.closest('[data-savecamp]');
    if (sc) { saveList(sc.getAttribute('data-savecamp')); return; }
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

    const adda = t.closest('[data-addacc]');
    if (adda) { addAccTo(adda.getAttribute('data-addacc'), adda.getAttribute('data-tocamp')); return; }

    const addl = t.closest('[data-addlist]');
    if (addl) { addListTo(addl.getAttribute('data-addlist'), addl.getAttribute('data-tocamp')); return; }

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

    if (t.closest('[data-pitch]')) {
      const box = byId('pitchBox');
      if (box) {
        box.open = true;
        const calm = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
        box.scrollIntoView({ behavior: calm ? 'auto' : 'smooth', block: 'start' });
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
      if (k === 'callnext') {
        const first = queue(null, S.q).filter((c) => rowVerb(c) === 'Call')[0];
        if (first) startCall(first.id);
        else toast('Nobody in this cut has a number to ring.');
      } else if (k === 'lists') {
        go(Object.assign(cleared(), { on: 'lists' }));
      } else if (k === 'camps') {
        byId('campList').scrollIntoView({ block: 'start' });
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
    if (t.closest('[data-calllog]')) { logCall(); return; }
    if (t.closest('[data-callskip]')) { skipCall(); return; }
    if (t.closest('[data-sessstop]')) {
      const sess = DB.call && DB.call.sess;
      closeCall();
      if (sess) { sess.finished = new Date().toISOString(); sessionSummary(sess); }
      paint();
      return;
    }
    if (t.closest('[data-autostop]')) {
      const live = DB.session.filter((x) => x.auto && !x.finished)[0];
      if (live) autoStop(live);
      return;
    }
    const auto = t.closest('[data-autocall]');
    if (auto) {
      const ids = auto.getAttribute('data-autocall');
      autoCall(ids ? ids.split(',') : []);
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
    const sp = t.closest('[data-sendprofile]');
    if (sp) { sendProfile(sp.getAttribute('data-sendprofile')); return; }

    const mv = t.closest('[data-move]');
    if (mv) { setCheckpoint(S.con, mv.getAttribute('data-move')); return; }

    const mn = t.closest('[data-movenext]');
    if (mn) {
      const v = mn.getAttribute('data-movenext');
      moveNext(S.con, v === 'clear' ? null : Number(v));
      return;
    }

    const when = t.closest('[data-when]');
    if (when && DB.call) {
      DB.call.when = Number(when.getAttribute('data-when')) || 1;
      paintCall();
      return;
    }

    /* The tray's quick chips are the shell's, and they name queue cuts. */
    const quick = t.closest('[data-quick]');
    if (quick) {
      const v = quick.getAttribute('data-quick');
      const map = { 'due=overdue': 'callback', 'status=going-cold': 'no-answer',
        'status=untouched': 'not-called', 'owner=mine': 'all' };
      go(Object.assign(cleared(), { q: map[v] || 'all' }));
      return;
    }

    if (t.closest('#canvasOpen')) { openCanvas(); paintThread(); return; }
    const ask = t.closest('[data-ask]');
    if (ask) { runInput(ask.getAttribute('data-ask')); return; }

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
    if (as) { go({ as: as.getAttribute('data-as') === DEFAULT_ME ? '' : as.getAttribute('data-as') }); return; }

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

  document.addEventListener('toggle', (e) => {
    if (!e.target || e.target.id !== 'pitchBox') return;
    UI.pitchSeen = !e.target.open;
    saveUI();
  }, true);

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
      if (e.key === 's' || e.key === 'S' && DB.call) { e.preventDefault(); skipCall(); return; }
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
