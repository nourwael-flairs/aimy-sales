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
  const OPENING = Object.create(null);
  OPENINGS.forEach((o) => (OPENING[o.k] = o));

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
    [/\b(raised|funding|funded|series a|series b|series c|series d|investment round|new investor|closed a round)\b/, 'funding'],
    [/\b(moved to|new role|left for|joining|changed jobs|has moved|starts at)\b/, 'job-change'],
    [/\b(promoted|promotion|stepped up|now heads|took over as)\b/, 'promotion'],
    [/\b(new cto|new cio|new coo|new head of|new director|new vp|new manager|just hired|joined last month)\b/, 'new-hire'],
    [/\b(hiring|recruiting|vacancy|vacancies|job ad|growing the team|headcount|taking on)\b/, 'job-posting'],
    [/\b(on our site|visited our|our website|downloaded|looked at our|read our)\b/, 'web-visit'],
    [/\b(renewal|renew|contract ends|contract is up|notice period|up for renewal)\b/, 'renewal'],
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
    const FATES = ['reached', 'gatekeeper', 'no-answer', 'callback', 'not-interested'];

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

    return { camp: camp, acc: acc, con: con, touch: touch, net: net };
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
  function save() {
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
    DB.camp.forEach((c) => { DB.byCamp[c.id] = c; DB.membersOf[c.id] = []; });
    DB.acc.forEach((a) => (DB.byAcc[a.id] = a));
    DB.list.forEach((l) => (DB.byList[l.id] = l));
    DB.con.forEach((c) => {
      DB.byCon[c.id] = c;
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
    DB.list = []; DB.session = [];
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
          DB.list = DELTA.list.slice();
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
  const SCALAR = ['on', 'con', 'camp', 'list', 'build', 'bk', 'bt', 'q', 'p', 'chat', 'as'];
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
  function go(over, replace) {
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
  function paint() {
    dropLists();
    GRID_AT = -1;
    byId('navBar').innerHTML = '';
    byId('filterBar').innerHTML = '';
    byId('chipBar').innerHTML = '';
    paintWho();
    byId('wbStage').innerHTML = S.con ? contactPage()
      : S.camp ? campPage()
      : S.on === 'lists' ? listsPage()
      : S.on === 'camps' ? campsPage()
      : homePage();
    mountLists();
    paintRail();
    paintBell();
    paintProto();
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
    const feed = byId('campFeed');
    if (feed) {
      vlist({
        host: feed, items: peek(campFeedItems(S.camp)).rows, rowH: 64, rowClass: 's-qrow',
        key: (t) => t.id, row: campTouchRow,
        empty: 'Nothing has happened on this campaign yet.',
      });
    }
    const h = byId('histList');
    if (h) {
      const c = DB.byCon[S.con];
      vlist({
        host: h,
        items: peek((DB.touchesOf[S.con] || []).map((id) => TOUCH[id]).filter(Boolean)).rows,
        rowH: 64, rowClass: 's-qrow', key: (t) => t.id, row: touchRow,
        empty: c && untouched(c) ? 'Nobody has rung them yet.' : 'No calls on the record.',
      });
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
    return '<article class="type-card s-card b-qcard" data-card="' + esc(c.id) + '">' +
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
  function qgrid(rows) {
    if (!rows.length) return '<p class="b-vfoot">Nobody on this rung.</p>';
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
  function aimySays(c) {
    const camp = DB.byCamp[campFor(c)];
    const hist = (DB.touchesOf[c.id] || []).map((id) => TOUCH[id]).filter(Boolean);
    const last = hist[0];
    const a = accOf(c);

    /* Somebody wrote this down about them, on purpose. */
    if (c.remember) {
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
      return { text: esc(OPENING[last.openings[0]].label) + ' — worth opening on.',
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
      return { text: 'Last call was ' + esc(OUTCOME[last.outcome].label.toLowerCase()) + ', ' +
        esc(sayWhen(last.at)) + '.', from: 'the call before this one' };
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
    return '<article class="type-card s-card b-qcard">' +
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
    return '<article class="type-card s-card b-qcard">' +
      '<div class="tc-head">' +
        '<span class="tag tag-' + (camp ? 'ok' : 'neutral') + '">' +
          (camp ? 'On a campaign' : 'Not on one yet') + '</span>' +
        '<span class="tc-type">' + esc(l.via) + '</span>' +
      '</div>' +
      '<button class="tc-title s-card-title" type="button" data-list="' + esc(l.id) + '">' +
        esc(l.name) + '</button>' +
      '<p class="tc-summary">' + esc(l.crit) + '.</p>' +
      '<div class="b-qcard-why"><b>' + commas(people.length) + '</b> people, <b>' +
        commas(ring) + '</b> of them ringable' +
        (camp ? ' · on ' + esc(camp.name) : '') + '</div>' +
      aimyBlock(listSays(l, people, ring, camp)) +
      '<div class="tc-gov b-qcard-foot">' +
        '<span class="b-qcard-num">built ' + esc(sayWhen(l.at)) + '</span>' +
        '<button class="s-insight-lnk' + (i === 0 ? ' primary' : '') +
          '" type="button" data-list="' + esc(l.id) + '">Open</button>' +
      '</div>' +
    '</article>';
  }
  function lgrid(rows) {
    if (!rows.length) return '<p class="b-vfoot">You have not built one yet.</p>';
    return '<div class="b-grid">' + rows.map(lcard).join('') + '</div>';
  }

  function listSays(l, people, ring, camp) {
    if (!camp) {
      return { text: 'Nobody on this list is in your queue until it is on a campaign.',
        from: 'the list having no campaign' };
    }
    const gap = people.length - ring;
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

  function campTouchRow(t) {
    const c = DB.byCon[t.con];
    const o = OUTCOME[t.outcome];
    const head = o ? o.label : t.moved ? rungLabel(t.moved[1]) : t.outcome;
    return '<div class="s-qrow-id">' +
        '<button class="s-qrow-name" type="button" data-con="' + esc(t.con) + '">' +
          esc(c ? c.name : 'Somebody') + '</button>' +
        '<span class="s-qrow-sub">' + esc(head) + ' · ' + esc(actor(t.by).name) +
          ' · ' + esc(sayWhen(t.at)) + '</span>' +
      '</div>' +
      '<div class="s-qrow-why"><span class="s-qrow-because">' + esc(t.note) + '</span></div>';
  }

  /* One call on the record. What happened, what came of it, and when. */
  function touchRow(t) {
    const o = OUTCOME[t.outcome];
    const said = t.proposals.map((p) => PROPOSAL[p] && PROPOSAL[p].label).filter(Boolean)
      .concat(t.objections.map((p) => OBJECTION[p] && OBJECTION[p].label).filter(Boolean));
    /* A rung somebody moved by hand is not a call, and the history says so
       rather than filing it under an outcome it never had. */
    const head = o ? o.label
      : t.moved ? rungLabel(t.moved[0]) + ' → ' + rungLabel(t.moved[1])
      : t.outcome;
    return '<div class="s-qrow-id">' +
        '<span class="s-qrow-name">' + esc(head) + '</span>' +
        '<span class="s-qrow-sub">' + esc(actor(t.by).name) + ' · ' + esc(sayWhen(t.at)) + '</span>' +
      '</div>' +
      '<div class="s-qrow-why"><span class="s-qrow-because">' + esc(t.note) + '</span>' +
        (said.length ? '<span class="s-qrow-lead">' + esc(said.join(' · ')) + '</span>' : '') +
      '</div>';
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
  function switcher(here) {
    const one = (k, label, n, over) =>
      '<button class="b-switch-btn' + (here === k ? ' is-on' : '') + '" type="button" ' +
      'data-go="' + esc(JSON.stringify(over)) + '"' +
      (here === k ? ' aria-current="page"' : '') + '>' + esc(label) +
      '<span class="b-switch-n">' + commas(n) + '</span></button>';
    return '<h2 class="b-switch">' +
      one('calls', 'Calls', queue().length, cleared()) +
      one('camps', 'Campaigns', myCampaigns().length, Object.assign(cleared(), { on: 'camps' })) +
      one('lists', 'Lists', DB.list.length, Object.assign(cleared(), { on: 'lists' })) +
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
    const camps = myCampaigns();
    const pg = paged(camps);
    return '<div class="s-home">' +
      topBrief('camps') +
      '<section class="s-block s-block-wide" aria-label="Campaigns">' +
        '<div class="s-camp-list-head">' + switcher('camps') + '</div>' +
        '<p class="s-block-sub">' + plural(camps.length, 'campaign') + ' you are on, ' +
          'soonest to close first. Each says how many of its people are yours to ring.</p>' +
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
      esc(k) + '">' + esc(label) + '<span class="b-cut-n">' + commas(n) + '</span></button>';
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
    const pg = paged(queue(S.camp || null, S.q));
    const ring = pg.rows.filter((c) => rowVerb(c) === 'Call');
    return '<section class="s-block s-block-wide" aria-label="To call">' +
      '<div class="s-camp-list-head">' +
        (S.camp ? '<h2 class="s-block-h">To call</h2>' : switcher('calls')) +
        (ring.length
          ? '<button class="s-inline-btn" type="button" data-callall="' +
            esc(ring.map((c) => c.id).join(',')) + '">Call these ' + ring.length + '</button>' +
            '<button class="s-inline-btn s-ai-btn" type="button" data-autocall="' +
            esc(ring.map((c) => c.id).join(',')) + '">Let AiMY call ' + ring.length + '</button>'
          : '') +
      '</div>' +
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
    return '<div class="s-home">' +
      topBrief('lists') +
      '<section class="s-block s-block-wide" aria-label="Lists">' +
        '<div class="s-camp-list-head">' + switcher('lists') +
          '<button class="s-inline-btn" type="button" data-bopen>Find leads</button>' +
        '</div>' +
        '<p class="s-block-sub">A list is how new people reach your queue. Describe who to ' +
          'look for; what comes back is the list, and putting it on a campaign puts them ' +
          'in front of you.</p>' +
        (DB.list.length
          ? lgrid(paged(DB.list.slice().reverse()).rows) + pager(paged(DB.list), 'list')
          : '<p class="b-vfoot">You have not built one yet.</p>') +
      '</section>' +
    '</div>';
  }


  function listPage(l) {
    const camp = l.for && DB.byCamp[l.for];
    const people = l.has.map((id) => DB.byCon[id]).filter(Boolean);
    const callableN = people.filter(callable).length;
    return '<div class="s-home">' +
      '<button class="s-back" type="button" data-go="' +
        esc(JSON.stringify(Object.assign(cleared(), { on: 'lists' }))) + '">Back to lists</button>' +
      '<section class="s-rec-block s-block-wide">' +
        '<h2 class="s-rec-cap">' + esc(l.name) + '</h2>' +
        '<div class="s-rec-body">' +
          '<p class="s-block-sub">' + esc(l.crit) + '. Found by ' + esc(l.via) + ', ' +
            esc(sayWhen(l.at)) + '. <b>' + commas(l.has.length) + '</b> people, ' +
            '<b>' + commas(callableN) + '</b> of them callable.</p>' +
          (camp
            ? '<p class="s-block-sub">On <b>' + esc(camp.name) + '</b>, so they are in your queue.</p>'
            : '<p class="s-block-sub">On no campaign yet — put it on one and its people join ' +
              'your queue.</p>' +
              '<div class="b-cuts">' + myCampaigns().slice(0, 6).map((k) =>
                '<button class="filter-chip" type="button" data-addlist="' + esc(l.id) +
                '" data-tocamp="' + esc(k.id) + '">' + esc(k.name) + '</button>').join('') +
              '</div>') +
        '</div>' +
      '</section>' +
      '<section class="s-block s-block-wide" aria-label="Who is on it">' +
        '<div class="s-camp-list-head"><h2 class="s-block-h">Who is on it</h2></div>' +
        qgrid(paged(people).rows) +
        pager(paged(people), 'person') +
      '</section>' +
    '</div>';
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
  const bstep = () => (BSTEPS.indexOf(S.build) >= 0 ? S.build : 'kind');

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
      '<button class="s-back" type="button" data-go="' +
        esc(JSON.stringify(Object.assign(cleared(), { on: 'lists' }))) + '">Back to lists</button>' +
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
      '<button class="s-back" type="button" data-go="' +
        esc(JSON.stringify(Object.assign(cleared(), { on: 'lists', build: 'kind' }))) +
        '">Companies or people</button>' +
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

  /* ── THE LOOKING IS VISIBLE ──
     Rows arrive one at a time under the names of the suppliers that were
     asked. A spinner says nothing about whether a search is working or stuck. */
  let BUILD_TICK = null;
  function buildRun() {
    const t = terms();
    const found = buildMatched(t);
    const mine2 = DRAFT.take.map((id) => DB.byCon[id]).filter(Boolean);
    const rows = found.slice(0, Math.max(0, 500 - mine2.length));
    DRAFT.rows = rows;
    DRAFT.run = { total: rows.length + mine2.length, at: 0 };
    go({ build: 'run' });
    if (BUILD_TICK) clearInterval(BUILD_TICK);
    BUILD_TICK = setInterval(buildTick, 90);
  }
  function buildTick() {
    if (!DRAFT || !DRAFT.run || S.build !== 'run') {
      clearInterval(BUILD_TICK); BUILD_TICK = null; return;
    }
    const r = DRAFT.run;
    r.at = Math.min(r.total, r.at + Math.max(1, Math.round(r.total / 40)));
    const host = $('.s-stream');
    const n = $('.s-stream-n');
    if (n) n.textContent = commas(r.at);
    if (host) {
      host.innerHTML = DRAFT.rows.slice(Math.max(0, r.at - 8), r.at)
        .map((x) => '<div class="s-stream-row">' +
          '<span class="s-stream-name">' + esc(buildKind() === 'acc' ? x.co : x.name) + '</span>' +
          '<span class="s-stream-facts">' + esc(x.co) + ' · ' +
          esc(INDUSTRY[x.industry].label) + ' · ' + esc(x.city) + '</span></div>').join('');
    }
    if (r.at >= r.total) {
      clearInterval(BUILD_TICK); BUILD_TICK = null;
      go({ build: 'done' }, true);
    }
  }

  function buildRunning() {
    const r = DRAFT.run || { total: 0, at: 0 };
    return '<div class="s-home">' +
      '<div class="s-sheet-head s-block-wide"><div class="s-sheet-head-main">' +
        '<div class="s-sheet-kind">Looking</div>' +
        '<h1 class="s-sheet-name">' + esc(buildName()) + '</h1>' +
      '</div></div>' +
      '<p class="s-stream-cap s-block-wide"><span class="s-stream-n">0</span> of ' + commas(r.total) +
        ' · asked ' + FINDERS.map((f) => esc(f.name)).join(' · ') + '</p>' +
      '<div class="s-stream s-block-wide"></div>' +
    '</div>';
  }

  /* ── WHAT CAME BACK, BEFORE IT IS YOURS ──
     The set, what is missing from it, and the two ways out. Nothing is in the
     book until Save. */
  function buildDone() {
    const rows = DRAFT.rows || [];
    const mine2 = DRAFT.take.map((id) => DB.byCon[id]).filter(Boolean);
    const f = finderOf();
    const kept = rows.filter((x) => DRAFT.drop.indexOf(x.id) < 0).length;
    const withNum = rows.filter((x) => x.seedPhone < f.phone).length;
    return '<div class="s-home">' +
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

      '<div class="b-cuts s-block-wide">' + FINDERS.map((x) =>
        '<button class="filter-chip' + (f.k === x.k ? ' active' : '') +
        '" type="button" data-finder="' + esc(x.k) + '">' + esc(x.name) +
        '<span class="b-cut-n">' + Math.round(x.phone * 100) + '% with a number</span>' +
        '</button>').join('') +
      '</div>' +

      '<div class="s-build-foot s-block-wide">' +
        '<button class="entry-action em-direct s-build-go" type="button" data-save>Save ' +
          commas(kept + mine2.length) + '</button>' +
        '<button class="s-inline-btn" type="button" data-go="' +
          esc(JSON.stringify(Object.assign(cleared(), { on: 'lists', build: 'describe' }))) +
          '">Change the criteria</button>' +
        '<button class="s-inline-btn" type="button" data-go="' +
          esc(JSON.stringify(Object.assign(cleared(), { on: 'lists' }))) + '">Discard</button>' +
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
  function saveList() {
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
        camps: [], owner: me().id, checkpoint: 'not-called', checkpointAt: null,
        attempts: 0, lastCallAt: null, next: null, remember: null, dnc: false,
        fate: ['reached', 'gatekeeper', 'no-answer', 'callback', 'not-interested'][i % 5],
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
      has: has, by: me().id, at: now, for: null, via: f.name,
      found: found.length + bring.length,
    };
    DB.acc = DB.acc.concat(madeAcc);
    DB.con = DB.con.concat(madeCon);
    DB.list.push(l);
    DELTA.list.push(l);
    DELTA.made = (DELTA.made || []).concat([{ list: id, acc: madeAcc, con: madeCon }]);
    reindex();
    save();
    go(Object.assign(cleared(), { list: id }));
    toast('Saved ' + plural(has.length, 'person') + ' as "' + l.name + '"', () => {
      dropList(id);
      go(Object.assign(cleared(), { on: 'lists', build: 'describe', bt: S.bt }));
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
        '<button class="s-back" type="button" data-home>Back to today</button></div>' +
      '</section></div>';
    }
    if (!mine(k)) {
      return '<div class="s-home"><section class="s-rec-block s-block-wide">' +
        '<h2 class="s-rec-cap">' + esc(k.name) + '</h2>' +
        '<div class="s-rec-body">' +
          '<p class="s-block-sub">You are not on this campaign, so there is nothing here for you ' +
          'to work. ' + esc(actor(k.owner).name) + ' owns it — ask them to add you.</p>' +
          '<button class="s-back" type="button" data-home>Back to today</button>' +
        '</div>' +
      '</section></div>';
    }

    const all = queue(k.id, 'all');
    const counts = Object.create(null);
    all.forEach((c) => { const b = bucketOf(c); counts[b] = (counts[b] || 0) + 1; });
    const members = membersOf(k.id);
    const left = daysBetween(TODAY_ISO, k.to);
    const ring = paged(queue(k.id, S.q)).rows.filter((c) => rowVerb(c) === 'Call');

    return '<div class="s-home">' +
      '<button class="s-back" type="button" data-home>Back to today</button>' +
      '<section class="s-rec-block s-block-wide">' +
        '<h2 class="s-rec-cap">' + esc(k.name) + '</h2>' +
        '<div class="s-rec-body">' +
          '<p class="s-block-sub">' + esc(k.goal) + '. ' +
            (left > 0 ? 'Ends in ' + plural(left, 'day') + '.' : 'Past its end date.') + '</p>' +

          /* WHAT YOU ARE ON IT TO DO, in numbers that are each a door. The
             sentence names the work; the chips under it are the same cuts
             the queue below is filtered by, so pressing one narrows the
             thing it is describing rather than opening a second surface. */
          '<p class="s-block-sub">You are on this campaign to call. ' +
            '<b>' + commas(all.length) + '</b> of its ' + plural(members.length, 'person') +
            ' can be rung' +
            (counts.callback ? ', <b>' + counts.callback + '</b> asked to be rung back' : '') +
            (counts['not-called'] ? ', <b>' + commas(counts['not-called']) + '</b> never rung' : '') +
          '.</p>' +

          '<div class="b-cuts">' +
            (all.length ? '<button class="s-insight-lnk primary" type="button" data-callnextin="' +
              esc(k.id) + '">Call the next one</button>' : '') +
            (ring.length ? '<button class="s-inline-btn" type="button" data-callall="' +
              esc(ring.map((c) => c.id).join(',')) + '">Call these ' + ring.length + '</button>' : '') +
          '</div>' +

          tally(members) +
        '</div>' +
      '</section>' +

      pitchBlock(k) +

      queueBlock(all, counts) +

      /* Context, not a worklist: the last few things that happened here and
         the count of what they are the last few of. A second pager on this
         page would share a page number with the queue above it or need one
         of its own, and both are worse than deciding which of the two lists
         is the reason you came. */
      '<section class="s-block s-block-wide" aria-label="What happened">' +
        '<div class="s-camp-list-head"><h2 class="s-block-h">What happened</h2>' +
          '<span class="s-block-say">newest first</span></div>' +
        '<div class="b-vlist" id="campFeed"></div>' +
        peekFoot(peek(campFeedItems(k.id)), 'call') +
      '</section>' +
    '</div>';
  }

  /* Where the campaign's people stand. Informational: these are rungs, and
     the queue below cuts by what is OWED, not by rung — so a door here would
     open a filter that does not exist. Stated, not linked, rather than
     pretending to be pressable. */
  function tally(members) {
    const n = rungCounts(members);
    const rows = LADDER.concat(EXITS).filter((x) => n[x.k]);
    if (!rows.length) return '';
    return '<div class="b-tally">' + rows.map((x) =>
      '<span class="b-tally-item"><b>' + commas(n[x.k]) + '</b> ' + esc(x.label.toLowerCase()) +
      '</span>').join('') + '</div>';
  }

  /* Preparation, folded away after the first visit. Native `<details>`, which
     is a disclosure and not a modal: it takes no focus, blocks nothing, and
     remembers nothing you have to dismiss. */
  function pitchBlock(k) {
    const sells = k.sells.map((s) => SELL[s]).filter(Boolean);
    return '<details class="s-rec-block s-block-wide" id="pitchBox"' + (UI.pitchSeen ? '' : ' open') + '>' +
      '<summary class="s-rec-cap">What we are selling them</summary>' +
      '<div class="s-rec-body">' +
        '<p class="s-block-sub">' + sells.map((s) =>
          '<b>' + esc(s.name) + '</b> — ' + esc(s.blurb)).join('. ') + '.</p>' +
        '<p class="s-block-sub">' + esc(k.pitch) + '</p>' +
        '<div class="s-callsum-rows">' + k.objections.map((o) =>
          '<div class="s-callsum-row">' +
            '<span class="s-callsum-mem">' + esc(OBJECTION[o.k].label) + '</span>' +
            '<span class="s-callsum-val">' + esc(o.say) + '</span>' +
          '</div>').join('') + '</div>' +
        '<div class="b-cuts">' + k.resources.map((r) =>
          '<span class="tag tag-neutral">' + esc(r.name) + '</span>').join('') + '</div>' +
      '</div>' +
    '</details>';
  }

  /* ══ ONE PERSON ═════════════════════════════════════════════════════════
     Who they are, where they stand on the ladder, and what has been said.
     The brief and the post-meeting controls arrive with the call panel. */
  function contactPage() {
    const c = DB.byCon[S.con];
    if (!c) {
      return '<div class="s-home"><section class="s-rec-block s-block-wide">' +
        '<h2 class="s-rec-cap">No such person</h2>' +
        '<div class="s-rec-body"><p class="s-block-sub">That record is not in the book. ' +
        'It may have been on a list that was discarded.</p>' +
        '<button class="s-back" type="button" data-home>Back to today</button></div>' +
      '</section></div>';
    }
    const a = accOf(c);
    const camps = campsOf(c);
    const n = (DB.touchesOf[c.id] || []).length;
    return '<div class="s-home">' +
      '<button class="s-back" type="button" data-back>Back to the queue</button>' +
      '<section class="s-rec-block s-block-wide">' +
        '<h2 class="s-rec-cap">' + esc(c.name) + '</h2>' +
        '<div class="s-rec-body">' +
          '<p class="s-block-sub">' + esc(c.title) + ' at ' + esc(a ? a.name : 'an unknown account') +
            (a ? ' · ' + esc(INDUSTRY[a.industry].label) + ' · ' + esc(a.city) + ', ' + esc(a.country) +
              ' · ' + commas(a.size) + ' staff' : '') + '</p>' +
          '<p class="s-block-sub">' +
            (c.phone
              ? '<button class="s-insight-lnk primary" type="button" data-call="' + esc(c.id) +
                '">Call ' + esc(c.name.split(' ')[0]) + '</button>' +
                ' <a class="s-inline-btn" href="tel:' + esc(c.phone.replace(/\s/g, '')) + '">' +
                esc(c.phone) + '</a>'
              : 'No number on file.') +
            (camps.length ? ' · On ' + camps.map((k) => esc(k.name)).join(', ') : ' · On no campaign') +
          '</p>' +
          ladder(c) +
          movesBlock(c) +
          (c.next ? '<p class="s-block-sub">Next: <b>' + esc(c.next.what) + '</b> ' +
            esc(sayWhen(c.next.due)) + '.</p>' +
            '<div class="b-cuts">' +
              [[1, 'Tomorrow'], [3, 'In 3 days'], [7, 'Next week']].map((d) =>
                '<button class="filter-chip" type="button" data-movenext="' + d[0] + '">' +
                esc(d[1]) + '</button>').join('') +
              '<button class="filter-chip" type="button" data-movenext="clear">Drop it</button>' +
            '</div>'
            : '') +
          (c.remember ? '<p class="s-block-sub">Remember — ' + esc(c.remember.text) +
            ' <i>' + esc(actor(c.remember.by).name) + '</i></p>' : '') +
        '</div>' +
      '</section>' +
      '<section class="s-block s-block-wide" aria-label="What has been said">' +
        '<div class="s-camp-list-head">' +
          '<h2 class="s-block-h">What has been said</h2>' +
          '<span class="s-block-say">' + plural(n, 'call') + ' on the record</span>' +
        '</div>' +
        '<div class="b-vlist" id="histList"></div>' +
        peekFoot(peek(DB.touchesOf[c.id] || []), 'call') +
      '</section>' +
    '</div>';
  }

  /* The rungs only a person can settle. Rendered only where they apply — a
     lead nobody has met is offered nothing here, because the answer to "did
     they show up" is not "no", it is "there was no meeting". */
  function movesBlock(c) {
    const ms = movesFor(c);
    if (!ms.length) {
      /* An exit says why nothing is on offer rather than showing an empty
         row. A surface with no action has to say why there is none. */
      return isExit(c.checkpoint)
        ? '<p class="s-block-sub">' + esc(RUNG[c.checkpoint].say) +
          ', so there is nothing to move. Undo on the toast is the way back.</p>'
        : c.checkpoint === 'handed-over'
          ? '<p class="s-block-sub">The director has it now. Past the handover it stops being a BDR lead.</p>'
          : '';
    }
    return '<div class="b-cuts">' + ms.map((m, i) =>
      '<button class="s-insight-lnk' + (i === 0 ? ' primary' : '') +
      '" type="button" data-move="' + esc(m.k) + '">' + esc(m.label) + '</button>').join('') +
    '</div>';
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
  function toast(msg, undo) {
    /* The library's toast, with its own clock: `.aimy-toast-progress` scales
       from 1 to 0 over the toast's life, so a receipt carrying an Undo says
       how long you have rather than reading as stuck. */
    const life = undo ? 6000 : 4000;
    UNDO = undo || null;
    if (toastTimer) clearTimeout(toastTimer);
    byId('toastHost').innerHTML =
      '<div class="aimy-toast visible s-toast">' +
        '<span class="aimy-toast-icon"><svg width="13" height="15" viewBox="0 0 18 20">' +
          '<use href="#aimy-logo-small"/></svg></span>' +
        '<span class="aimy-toast-body"><span class="aimy-toast-title">' + esc(msg) + '</span></span>' +
        (undo ? '<span class="aimy-toast-divider"></span>' +
          '<button class="aimy-toast-undo" type="button" data-undo>Undo</button>' : '') +
        '<span class="aimy-toast-progress"><span class="aimy-toast-progress-fill" ' +
          'style="animation-duration:' + life + 'ms"></span></span>' +
      '</div>';
    toastTimer = setTimeout(() => { byId('toastHost').innerHTML = ''; UNDO = null; }, life);
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
  const CALL_SCRIPTS = {
    reached: [
      ['you', 'Morning — is that {first}?'],
      ['them', 'Speaking.'],
      ['you', 'I will keep it short. We take the support desk work off teams your size.'],
      ['them', 'Go on, I am open to hearing it.'],
      ['you', 'Rather than talk at you, could I show you the thing working?'],
      ['them', 'Yes, I am interested. Send me a demo next week — though the price came up last time we looked at this.'],
    ],
    gatekeeper: [
      ['you', 'Morning, could I speak to {first}?'],
      ['them', 'Can I take a message? She is in workshops all week.'],
      ['you', 'When is the best time to try her?'],
      ['them', 'I could not say. I will pass it on.'],
    ],
    'no-answer': [
      ['you', 'Dialling…'],
      ['them', 'The line rings out.'],
      ['you', 'Left a voicemail.'],
    ],
    callback: [
      ['you', 'Morning — is that {first}?'],
      ['them', 'It is, but you have caught me walking into something.'],
      ['you', 'No problem at all. When suits?'],
      ['them', 'Call me back Thursday.'],
    ],
    'not-interested': [
      ['you', 'Morning — is that {first}?'],
      ['them', 'It is.'],
      ['you', 'We take support desk work off teams your size.'],
      ['them', 'Not interested, we have just signed with someone.'],
    ],
  };
  function scriptFor(c) {
    const s = CALL_SCRIPTS[c.fate] || CALL_SCRIPTS.reached;
    const first = c.name.split(' ')[0];
    return s.map((l) => [l[0], l[1].split('{first}').join(first)]);
  }

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
      when: 1, sess: sess || (DB.call && DB.call.sess) || null,
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

  function growTranscript() {
    const c = DB.call;
    if (!c || c.state !== 'live') return;
    if (c.shown >= c.script.length) { clearInterval(CALL_LINE); CALL_LINE = null; return; }
    c.shown++;
    const host = byId('callLines');
    if (host) { host.innerHTML = transcriptHtml(c); host.scrollTop = host.scrollHeight; }
  }
  function transcriptHtml(c) {
    if (!c.shown) return '<p class="call-none">Nothing said yet.</p>';
    return c.script.slice(0, c.shown).map((l) =>
      '<p class="call-line' + (l[0] === 'you' ? ' is-you' : '') + '">' + esc(l[1]) + '</p>').join('');
  }
  const transcriptText = (c) => c.script.slice(0, c.shown).map((l) => l[1]).join(' ');

  /* Hanging up is where AiMY reads what it heard. The reading is a
     SUGGESTION — it lights an outcome and shows what it took from the call,
     and nothing is written until you press Log. */
  function endCall() {
    const c = DB.call;
    if (!c || c.state === 'ready' || c.state === 'logging') return;
    clearCallTimers();
    c.state = 'logging';
    const heard = readCall(transcriptText(c));
    c.read = heard;
    /* ══ WHEN IT CANNOT TELL, IT UNDER-CLAIMS ══════════════════════════
       This fell back to `reached` whenever any line had been said, and the
       first line of every script is the CALLER'S own opening. Hang up two
       seconds in and AiMY lit Connected on the evidence of "could I speak
       to Sofie?" — a claim that you reached somebody, made out of you
       asking to. Measured on a gatekeeper fixture ended early.

       `no-answer` is the honest default: it is the one outcome that does
       not assert contact (`writes: false`), so guessing it wrong costs a
       correction rather than a false record of a conversation. */
    c.outcome = heard.disp || 'no-answer';
    c.guessed = !heard.disp;
    if (heard.when) c.when = heard.when;
    paintCall();
    callLogPropose();
  }

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
    const call = DB.call;
    if (!call || call.state !== 'logging') return;
    const c = DB.byCon[call.con];
    const heard = call.read || {};
    const noted = call.note ? readCall(call.note) : null;
    /* A CORRECTION IS READ ALONE AND WINS PER AXIS. Read together with the
       transcript, a gatekeeper heard on the call would outrank "actually I
       spoke to her" for ever, because the lexicon ranks by specificity and
       not by recency — the more you insisted, the less it would listen. */
    const props = noted && noted.props.length ? noted.props : (heard.props || []);
    const objs = noted && noted.objs.length ? noted.objs : (heard.objs || []);
    const opps = noted && noted.opps.length ? noted.opps : (heard.opps || []);
    const outcome = call.outcome || 'no-answer';

    const before = {
      checkpoint: c.checkpoint, checkpointAt: c.checkpointAt, attempts: c.attempts,
      lastCallAt: c.lastCallAt, next: c.next, remember: c.remember, dnc: c.dnc,
    };
    const mv = moveFor(c, outcome, props);
    const now = new Date().toISOString();
    const t = {
      id: 't' + (Date.now().toString(36)) + Math.floor(Math.random() * 1000),
      con: c.id, camp: call.camp, by: me().id, at: now,
      secs: call.secs, outcome: outcome,
      proposals: props, objections: objs, openings: opps,
      note: call.note || (heard.disp ? 'Logged from the call.' : 'No answer.'),
      lines: call.script.slice(0, call.shown).map((l) => ({ who: l[0], text: l[1] })),
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
    const remember = (noted && noted.remember) || heard.remember;
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

    advance();
  }

  /* On to the next one in the session, or done. */
  function advance() {
    const call = DB.call;
    const sess = call && call.sess;
    if (!sess) { closeCall(); paint(); return; }
    sess.done.push(call.con);
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
    if (call.sess) { call.sess.skipped.push(call.con); advance(); return; }
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

  function callPanel() {
    const call = DB.call;
    const c = callOn();
    if (!c) return '';
    const a = accOf(c);
    const camp = DB.byCamp[call.camp];
    const ready = call.state === 'ready';
    const dialing = call.state === 'connecting';
    const logging = call.state === 'logging';
    const sess = call.sess;
    const at = sess ? sess.done.length + sess.skipped.length + 1 : 0;

    return '<div class="call-head">' +
        '<span class="call-live' + (ready ? ' is-ready' : dialing ? ' is-dialing' : '') +
          '" aria-hidden="true"></span>' +
        '<span class="call-timer" id="callTimer">' +
          (ready ? 'Ready to call' : dialing ? 'Connecting…' : fmtClock(call.secs)) + '</span>' +
        (sess ? '<span class="call-of">' + at + ' of ' + sess.ids.length + '</span>' : '') +
      '</div>' +

      '<div class="call-who-block">' +
        '<p class="call-name">' + esc(c.name) + '</p>' +
        '<p class="call-sub">' + esc(c.title) + ' · ' + esc(a ? a.name : '') + '</p>' +
        '<p class="call-num">' + esc(c.phone) + '</p>' +
        '<p class="call-sub">' + esc(rungLabel(c.checkpoint)) +
          (camp ? ' · ' + esc(camp.name) : '') + '</p>' +
      '</div>' +

      /* Three lines of preparation, and only while there is time to read
         them. Once the phone is ringing the transcript takes the space —
         a brief you cannot act on any more is a brief in the way. */
      (ready ? briefBlock(c, camp) : '') +

      (ready ? '' : '<div class="call-lines" id="callLines">' + transcriptHtml(call) + '</div>') +

      (logging ? outcomeBlock(call, c) : '') +

      '<div class="call-tools">' +
        (ready
          ? '<button class="call-go" type="button" data-callgo>Start call</button>'
          : logging
            ? '<button class="call-go" type="button" data-calllog>Log &amp; next</button>'
            : '<button class="call-end" type="button" data-callend>End</button>') +
        (ready || logging
          ? '<button class="call-tool" type="button" data-callskip>' +
            (sess ? 'Skip' : 'Close') + '</button>'
          : '') +
      '</div>';
  }

  /* WHO THIS IS AND WHAT TO SAY. On a first call there is no history to
     report, so the campaign's own preparation takes its place — what we
     sell, how to open, and what they will push back on. */
  function briefBlock(c, camp) {
    const n = (DB.touchesOf[c.id] || []).length;
    const last = n ? TOUCH[DB.touchesOf[c.id][0]] : null;
    const obj = camp && camp.objections.length ? camp.objections[0] : null;
    const rows = [];
    rows.push(['Open with', camp
      ? SELL[camp.sells[0]].name + ' — ' + SELL[camp.sells[0]].blurb
      : 'Ask what they are running this with today.']);
    if (last) {
      rows.push(['Last time', OUTCOME[last.outcome].label + ', ' + sayWhen(last.at) +
        (last.note ? ' — ' + last.note : '')]);
    } else {
      rows.push(['First call', 'Nobody has spoken to them. The campaign is all you have.']);
    }
    if (obj) rows.push(['They push back on', OBJECTION[obj.k].label + '. ' + obj.say]);
    if (c.remember) rows.push(['Remember', c.remember.text]);
    return '<div class="s-callsum">' +
      '<div class="s-callsum-cap">Before you speak to ' + esc(c.name.split(' ')[0]) + '</div>' +
      '<div class="s-callsum-rows">' + rows.map((r) =>
        '<div class="s-callsum-row"><span class="s-callsum-mem">' + esc(r[0]) + '</span>' +
        '<span class="s-callsum-val">' + esc(r[1]) + '</span></div>').join('') + '</div>' +
      '<button class="s-insight-lnk" type="button" data-con="' + esc(c.id) + '">The whole record</button>' +
    '</div>';
  }

  /* WHAT HAPPENED, IN ONE PRESS. Seven outcomes, always visible, with the
     one AiMY read already lit. Under it a line to type, which AiMY reads for
     what was asked for and what pushed back — and which overrides the
     transcript on whatever it speaks to. */
  function outcomeBlock(call, c) {
    const heard = call.read || {};
    const noted = call.note ? readCall(call.note) : null;
    const props = noted && noted.props.length ? noted.props : (heard.props || []);
    const objs = noted && noted.objs.length ? noted.objs : (heard.objs || []);
    const opps = noted && noted.opps.length ? noted.opps : (heard.opps || []);
    const chips = props.map((k) => PROPOSAL[k] && PROPOSAL[k].label)
      .concat(objs.map((k) => OBJECTION[k] && OBJECTION[k].label))
      .concat(opps.map((k) => OPENING[k] && OPENING[k].label))
      .filter(Boolean);
    const wantsDate = call.outcome === 'callback' ||
      props.indexOf('meeting') >= 0 || props.indexOf('demo') >= 0 || props.indexOf('callback') >= 0;
    const mv = moveFor(c, call.outcome || 'no-answer', props);

    return '<div class="b-outs">' +
      '<div class="s-callsum-cap">' +
        (heard.disp
          ? 'AiMY read this as ' + esc(OUTCOME[heard.disp].label)
          : 'AiMY could not tell from what was said — say what happened') +
      '</div>' +
      '<div class="b-cuts">' + OUTCOMES.map((o) =>
        '<button class="filter-chip' + (call.outcome === o.k ? ' active' : '') +
        '" type="button" data-out="' + o.k + '">' + esc(o.label) + '</button>').join('') + '</div>' +

      (wantsDate ? '<div class="b-cuts">' + [[1, 'Tomorrow'], [3, 'In 3 days'], [7, 'Next week']]
        .map((d) => '<button class="filter-chip' + (call.when === d[0] ? ' active' : '') +
          '" type="button" data-when="' + d[0] + '">' + esc(d[1]) + '</button>').join('') +
        '</div>' : '') +

      '<label class="ds-field call-note-field">' +
        '<span class="s-field-label">In a line</span>' +
        '<textarea class="ds-textarea" rows="2" spellcheck="false" data-note ' +
          'placeholder="What happened, what you asked for, what they pushed back on.">' +
          esc(call.note) + '</textarea>' +
      '</label>' +

      (chips.length ? '<div class="b-cuts">' + chips.map((x) =>
        '<span class="tag tag-neutral">' + esc(x) + '</span>').join('') + '</div>' : '') +

      '<p class="s-callsum-note">' +
        (mv.to ? 'Moves them to <b>' + esc(rungLabel(mv.to)) + '</b>' : 'Stays at <b>' +
          esc(rungLabel(c.checkpoint)) + '</b>') +
        (mv.next ? ', and sets <b>' + esc(mv.next.what) + '</b> for ' + esc(sayWhen(mv.next.due)) : '') +
        '.</p>' +
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

  const readNtf = new Set();

  function ntfRows() {
    const rows = [];
    queue(null, 'callback').slice(0, 12).forEach((c) => rows.push({
      id: 'back-' + c.id, con: c.id,
      what: c.name + ' asked to be rung back ' +
        (c.next ? sayWhen(c.next.due) : sayWhen(c.lastCallAt)),
      cta: 'Call them',
    }));
    return rows.slice(0, 12);
  }

  function paintBell() {
    const rows = ntfRows();
    const unread = rows.filter((r) => !readNtf.has(r.id)).length;
    byId('ntfDot').hidden = !unread;
    const cnt = byId('ntfCount');
    cnt.hidden = !unread;
    cnt.textContent = unread;
    byId('ntfList').innerHTML = rows.length
      ? rows.map((r) => '<li><button class="ntf-row' +
          (readNtf.has(r.id) ? ' is-read' : '') + '" type="button" data-con="' +
          esc(r.con) + '"><span class="ntf-row-main">' +
          '<span class="ntf-row-body">' + esc(r.what) + '</span>' +
          '<span class="ntf-row-cta">' + esc(r.cta) + '</span>' +
          '</span></button></li>').join('')
      : '<li class="ntf-empty">Nothing is waiting on you.</li>';
  }

  /* ══ 7e. THE COMPOSER, AND THE CANVAS BEHIND IT ═════════════════════════
     The bar drives the page. Four routes, in the order a caller means them:
     a call being logged takes the sentence first, then a name, then a verb,
     then a question. Only the last one opens the canvas — a surface that
     opens for everything is a detail page wearing a chat's clothes. */

  const TURNS = [];

  function openCanvas() { byId('aimyOverlay').classList.add('open'); }
  function closeCanvas() { byId('aimyOverlay').classList.remove('open'); }

  function say(who, html) {
    TURNS.push({ who: who, html: html });
    paintThread();
  }
  function paintThread() {
    const host = byId('overlayThread');
    if (!TURNS.length) {
      host.innerHTML = ['How many are left to call?', 'Who is due today?',
        'What happened yesterday?', 'When do people actually answer?'].map((q) =>
        '<button class="overlay-sugg-chip" type="button" data-ask="' + esc(q) + '">' +
        esc(q) + '</button>').join('');
      return;
    }
    host.innerHTML = TURNS.map((t) =>
      '<div class="chat-msg ' + (t.who === 'you' ? 'user' : 'aimy') + '">' +
        '<div class="msg-bubble">' + t.html + '</div>' +
      '</div>').join('');
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
    if (DB.call && DB.call.state === 'logging') {
      if (callLogCorrect(t)) return;
      DB.call.note = t;
      paintCall();
      toast('I could not read a disposition out of that. Pick one, or say it another way.');
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
      closeCanvas();
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
      if (found && found.con) { closeCanvas(); go({ con: found.con.id }); return; }
      if (found && found.camp) {
        closeCanvas();
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
    body += line('What has passed', hist.length
      ? esc(plural(hist.length, 'call') + ', last ' + OUTCOME[last.outcome].label.toLowerCase() +
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
    body += line('Open with', hist.length
      ? esc('Pick up where it stopped — ' + (last.note || 'you have spoken before.'))
      : esc(camp ? camp.pitch : 'Ask what they are running this with today.'));
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
    return esc(OBJECTION[top].label.toLowerCase()) + ' — <b>' + n[top] + '</b> of the ' +
      total + ' who gave a reason on this campaign said so. ' +
      esc(agreed ? agreed.say : OBJECTION[top].blurb);
  }

  /* ── THE READ-BACK ──
     AiMY says what it heard in the taxonomy's own words, with the card the
     record will carry. You agree in a word or correct it in a sentence. */
  function callLogPropose() {
    const call = DB.call;
    if (!call) return;
    const c = callOn();
    const heard = call.read || {};
    const props = heard.props || [];
    const objs = heard.objs || [];
    const mv = moveFor(c, call.outcome || 'no-answer', props);
    const row = (k, v) => '<div class="s-callsum-row"><span class="s-callsum-mem">' +
      esc(k) + '</span><span class="s-callsum-val">' + v + '</span></div>';
    const body = '<div class="s-callsum-rows">' +
      row('What happened', esc((OUTCOME[call.outcome] || {}).label || call.outcome)) +
      row('You asked for', props.length
        ? esc(props.map((p) => PROPOSAL[p].label).join(' · ')) : 'nothing') +
      row('They pushed back on', objs.length
        ? esc(objs.map((o) => OBJECTION[o].label).join(' · ')) : 'nothing') +
      row('It moves them to', mv.to ? '<b>' + esc(rungLabel(mv.to)) + '</b>'
        : 'nowhere — they stay at ' + esc(rungLabel(c.checkpoint))) +
      '</div>' +
      '<div class="b-cuts">' +
        '<button class="s-insight-lnk primary" type="button" data-calllog>Log it' +
          (call.sess ? ' and call the next one' : '') + '</button>' +
      '</div>' +
      '<p class="s-callsum-note">Or tell me what I got wrong, in the bar below.</p>';
    say('aimy', answerBlock(
      heard.disp ? 'I read that as ' + OUTCOME[heard.disp].label
        : 'I could not tell from what was said',
      body, 'the transcript and your note'));
  }

  /* A CORRECTION IS READ ALONE, and every axis it speaks to replaces the
     proposal's. Read together with the transcript, a gatekeeper heard on the
     call would beat "actually I spoke to her" for ever, because the lexicon
     ranks by specificity and not by recency — the more you insisted, the less
     it would listen. */
  function callLogCorrect(text) {
    const call = DB.call;
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
    paintCall();
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
      closeCanvas();
      go(over);
      return;
    }

    const con = t.closest('[data-con]');
    if (con) { closeCanvas(); go({ con: con.getAttribute('data-con') }); return; }

    /* Back to where you were, not to the front page. `data-home` clears every
       key, which from row eleven of page four of the Due cut means losing the
       cut, the page and the row — three deliberate choices, undone by the
       control that was supposed to return you to them. */
    const back = t.closest('[data-back]');
    if (back) { go({ con: '' }); return; }

    const camp = t.closest('[data-camp]');
    if (camp) { go(Object.assign(cleared(), { camp: camp.getAttribute('data-camp') })); return; }

    if (t.closest('[data-bopen]')) { buildOpen(); return; }

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
    if (t.closest('[data-save]')) { saveList(); return; }
    const lst = t.closest('[data-list]');
    if (lst) { go(Object.assign(cleared(), { list: lst.getAttribute('data-list') })); return; }
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

    const cut = t.closest('[data-q]');
    if (cut) { go(Object.assign(cleared(), { q: cut.getAttribute('data-q') })); return; }

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
      if (k === 'find') { buildOpen(); return; }
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
    if (t.closest('[data-callend]')) { endCall(); return; }
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

    const bell = t.closest('#ntfBell');
    if (bell) {
      const panel = byId('ntfPanel');
      panel.hidden = !panel.hidden;
      bell.setAttribute('aria-expanded', String(!panel.hidden));
      if (!panel.hidden) paintBell();
      return;
    }
    if (t.closest('#ntfClear')) {
      ntfRows().forEach((r) => readNtf.add(r.id));
      paintBell();
      return;
    }
    if (t.closest('#ntfAskAll')) {
      byId('ntfPanel').hidden = true;
      runInput('What is due today?');
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
    if (closeC) { byId('aimyOverlay').classList.remove('open'); return; }

    const undoEl = t.closest('[data-undo]');
    if (undoEl) { const fn = UNDO; UNDO = null; byId('toastHost').innerHTML = ''; if (fn) fn(); return; }

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
    const box = byId('callPanel').querySelector('.b-outs');
    if (box) {
      const c = callOn();
      box.outerHTML = outcomeBlock(DB.call, c);
      const again = byId('callPanel').querySelector('[data-note]');
      if (again) { again.value = DB.call.note; again.focus();
        again.setSelectionRange(again.value.length, again.value.length); }
    }
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
      else if (c.state === 'live' || c.state === 'connecting') endCall();
      else if (c.state === 'logging') logCall();
      return;
    }

    if (typing) return;

    if (DB.call) {
      /* The seven outcomes on the number row, in the order they are drawn.
         Pressing one mid-call ends the call first — you know how it went
         before the transcript does. */
      const n = OUTCOMES.filter((o) => o.key === e.key)[0];
      if (n) {
        e.preventDefault();
        if (DB.call.state === 'live' || DB.call.state === 'connecting') endCall();
        DB.call.outcome = n.k;
        paintCall();
        return;
      }
      if (e.key === 'n' || e.key === 'N') {
        const note = byId('callPanel').querySelector('[data-note]');
        if (note) { e.preventDefault(); note.focus(); }
        return;
      }
      if (e.key === 's' || e.key === 'S') { e.preventDefault(); skipCall(); return; }
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
    const panel = byId('ntfPanel');
    if (byId('aimyOverlay').classList.contains('open')) { closeCanvas(); return; }
    if (!panel.hidden) { panel.hidden = true; return; }
    if (DB.call) { skipCall(); }
  });

  window.addEventListener('popstate', () => { parse(); paint(); });
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
