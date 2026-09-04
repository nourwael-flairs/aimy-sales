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

  const FIRST = ['Femke', 'Bas', 'Lieke', 'Sanne', 'Daan', 'Ruben', 'Anouk', 'Thijs',
    'Marit', 'Jeroen', 'Eva', 'Sven', 'Nina', 'Lars', 'Iris', 'Koen', 'Sofie',
    'Pieter', 'Emma', 'Joris', 'Fleur', 'Wouter', 'Noor', 'Tim', 'Julia', 'Stijn',
    'Maud', 'Rik', 'Lotte', 'Bram', 'Elena', 'Mats', 'Hanna', 'Niels', 'Clara',
    'Otto', 'Ida', 'Finn', 'Saskia', 'Jens', 'Katrin', 'Paul', 'Ines', 'Tomas'];
  const LAST = ['de Boer', 'van Leeuwen', 'de Groot', 'Jansen', 'Bakker', 'Visser',
    'Smit', 'Meijer', 'Mulder', 'de Vries', 'Bos', 'Vos', 'Peters', 'Hendriks',
    'van Dijk', 'Kuipers', 'Willems', 'Dekker', 'Brouwer', 'van den Berg',
    'Schmidt', 'Weber', 'Hoffmann', 'Lindqvist', 'Andersen', 'Nielsen', 'Larsen',
    'Novak', 'Kowalski', 'Moreau', 'Dubois', 'Rossi', 'Ferrari', 'Garcia',
    'Lopez', 'Murphy', 'Keller', 'Brandt', 'Sorensen', 'Haas'];

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

    return { camp: camp, acc: acc, con: con, touch: touch };
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
  let DELTA = { v: 1, con: Object.create(null), touch: [], list: [], session: [], dismissed: [], read: [] };

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
    DB.camp = s.camp; DB.acc = s.acc; DB.con = s.con; DB.touch = s.touch;
    DB.list = []; DB.session = [];
    let raw = null;
    try { raw = localStorage.getItem(KEY_DB); } catch (e) {}
    if (raw) {
      try {
        const d = JSON.parse(raw);
        if (d && d.v === 1) {
          DELTA = Object.assign({ v: 1, con: {}, touch: [], list: [], session: [], dismissed: [], read: [] }, d);
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

  const overdue = (c) => !!(c.next && c.next.due < TODAY_ISO);
  const dueToday = (c) => !!(c.next && c.next.due <= TODAY_ISO);
  const untouched = (c) => c.checkpoint === 'not-called';
  const daysSinceCall = (c) =>
    c.lastCallAt ? Math.floor((Date.now() - new Date(c.lastCallAt)) / DAY_MS) : null;
  const stale = (c) => {
    const d = daysSinceCall(c);
    return d != null && d >= 14 && rank(c.checkpoint) >= 1 && rank(c.checkpoint) <= 4;
  };
  /* A meeting whose date has gone by and nobody has said what happened. */
  const awaitingDecision = (c) => c.checkpoint === 'meeting-set' && !!c.next && c.next.due < TODAY_ISO;
  /* Who a BDR may ring: a number, not opted out, still on the calling part of
     the ladder, and not parked on a future date. */
  const callable = (c) =>
    !!c.phone && !c.dnc && !isExit(c.checkpoint) && rank(c.checkpoint) <= 4 &&
    !(c.next && c.next.due > TODAY_ISO);
  const retry = (c) =>
    c.checkpoint === 'no-answer' && c.attempts < 5 && (daysSinceCall(c) == null || daysSinceCall(c) >= 2);

  /* ══ 6. THE URL IS THE STATE ════════════════════════════════════════════
     One object mirrors the query string, one function writes it, one function
     repaints. A surface that is not in the URL is a surface you cannot send
     anybody. */
  const SCALAR = ['con', 'camp', 'lists', 'build', 'bk', 'bt', 'q', 'p', 'chat', 'as'];
  const DEFAULTS = { q: 'all' };
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
    byId('navBar').innerHTML = '';
    byId('filterBar').innerHTML = '';
    byId('chipBar').innerHTML = '';
    paintWho();
    byId('wbStage').innerHTML = S.con ? contactPage() : homePage();
    mountLists();
    paintRail();
    paintProto();
  }

  /* The lists a surface declares, mounted after its markup exists. Kept apart
     from the page's string because a windowed list cannot be one: it has to
     measure where it landed before it knows which rows to draw. */
  function mountLists() {
    const q = byId('queueList');
    if (q) {
      const all = queue(null, S.q);
      const from = Math.min(pageAt(), Math.max(0, Math.ceil(all.length / PAGE) - 1)) * PAGE;
      vlist({
        host: q, items: all.slice(from, from + PAGE), rowH: 72, rowClass: 's-qrow',
        key: (c) => c.id, row: qrow,
        empty: 'Nobody in this part of the queue.',
      });
    }
    const cs = byId('campList');
    if (cs) {
      vlist({
        host: cs, items: myCampaigns(), rowH: 72, rowClass: 'b-camp-row',
        key: (c) => c.id, row: camprow,
        empty: 'You are on no campaign.',
      });
    }
    const h = byId('histList');
    if (h) {
      const c = DB.byCon[S.con];
      vlist({
        host: h, items: (DB.touchesOf[S.con] || []).map((id) => TOUCH[id]).filter(Boolean),
        rowH: 64, rowClass: 's-qrow', key: (t) => t.id, row: touchRow,
        empty: c && untouched(c) ? 'Nobody has rung them yet.' : 'No calls on the record.',
      });
    }
  }

  /* One person in a queue, in the row anatomy this product already has:
     who on the first line, why they are ranked here on the second, and the
     way in beside both. */
  function qrow(c, i) {
    const a = accOf(c);
    const camp = DB.byCamp[c.camps.filter((k) => DB.byCamp[k] && mine(DB.byCamp[k]))[0] || c.camps[0]];
    return '<div class="s-qrow-id">' +
        '<button class="s-qrow-name" type="button" data-con="' + esc(c.id) + '">' + esc(c.name) + '</button>' +
        '<span class="s-qrow-sub">' + esc(c.title) + ' · ' + esc(a ? a.name : '') + '</span>' +
      '</div>' +
      '<div class="s-qrow-why">' +
        '<span class="s-qrow-because">' + whyLine(c) + '</span>' +
        (camp ? '<span class="s-qrow-lead">' + esc(camp.name) + '</span>' : '') +
      '</div>' +
      /* Only the first row is filled. Six identical primaries is six
         recommendations, which is none — the list is already ranked, so the
         top row is the recommendation and says so by being the only filled
         thing on the surface. */
      '<button class="s-insight-lnk s-qrow-go' + (i === 0 ? ' primary' : '') +
        '" type="button" ' + (bucketOf(c) === 'after'
          ? 'data-con="' + esc(c.id) + '"'
          : 'data-call="' + esc(c.id) + '"') + '>' + rowVerb(c) + '</button>';
  }

  /* One campaign. The numbers on the second line are the ones that decide
     whether to open it, and they are the same derivations the campaign's own
     page reads — so a row and the page it opens cannot disagree. */
  function camprow(k) {
    const q = queue(k.id);
    const due = q.filter((c) => bucketOf(c) === 'due').length;
    const after = q.filter((c) => bucketOf(c) === 'after').length;
    const left = daysBetween(TODAY_ISO, k.to);
    return '<button class="b-camp-name" type="button" data-camp="' + esc(k.id) + '">' + esc(k.name) + '</button>' +
      '<div class="b-camp-why">' +
        '<span><b>' + commas(q.length) + '</b> to call</span>' +
        (due ? '<span><b>' + due + '</b> due</span>' : '') +
        (after ? '<span><b>' + after + '</b> after a meeting</span>' : '') +
        '<span>' + (left > 0 ? 'ends in ' + plural(left, 'day') : 'past its end date') + '</span>' +
      '</div>' +
      '<button class="s-insight-lnk b-camp-go" type="button" data-camp="' + esc(k.id) + '">Work it</button>';
  }

  /* One call on the record. What happened, what came of it, and when. */
  function touchRow(t) {
    const o = OUTCOME[t.outcome];
    const said = t.proposals.map((p) => PROPOSAL[p] && PROPOSAL[p].label).filter(Boolean)
      .concat(t.objections.map((p) => OBJECTION[p] && OBJECTION[p].label).filter(Boolean));
    return '<div class="s-qrow-id">' +
        '<span class="s-qrow-name">' + esc(o ? o.label : t.outcome) + '</span>' +
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
    const q = queue();
    const due = q.filter((x) => bucketOf(x) === 'due').length;
    const after = q.filter((x) => bucketOf(x) === 'after').length;
    const camps = myCampaigns();
    return {
      eyebrow: 'Your book', subject: null,
      card: {
        state: due || after ? 'staged' : 'detected',
        text: due
          ? '<b>' + plural(due, 'person') + '</b> ' + verbFor(due, 'is') +
            ' owed something today across your ' + plural(camps.length, 'campaign') + '.'
          : after
            ? '<b>' + plural(after, 'meeting') + '</b> ' + verbFor(after, 'has') +
              ' been and gone with nothing recorded.'
            : '<b>' + commas(q.length) + '</b> people are callable across your ' +
              plural(camps.length, 'campaign') + ', and nothing is overdue.',
        evidence: [{ val: commas(q.length), cap: 'to call' }, { val: camps.length, cap: 'campaigns' }],
        act: due ? 'Show the ' + due : after ? 'Show the ' + after : null,
        q: due ? 'due' : after ? 'after' : null,
      },
    };
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
      '<section class="slv" aria-label="Since your last visit">' +
        '<div class="slv-head">' +
          '<svg viewBox="0 0 18 20" aria-hidden="true"><use href="#aimy-logo-small"/></svg>' +
          '<h1 class="slv-title">Today</h1>' +
          '<span class="slv-time">' + esc(sayDay(TODAY_ISO)) + '</span>' +
        '</div>' +
        '<div class="slv-body"><p class="slv-line">' + openerText(counts, all, camps) + '</p></div>' +
        '<div class="s-starts-wrap">' +
          '<span class="s-starts-cap">Start</span>' +
          startStrip(counts, all, camps) +
        '</div>' +
      '</section>' +

      queueBlock(all, counts) +
      campsBlock(camps) +
    '</div>';
  }

  /* What today is, in one paragraph with the numbers in it. Only conditions
     that hold are named — a sentence listing three things that are all zero
     is a sentence that has to be read to learn nothing. */
  function openerText(counts, all, camps) {
    const bits = [];
    if (counts.due) bits.push('<b>' + plural(counts.due, 'person') + '</b> ' +
      verbFor(counts.due, 'is') + ' owed something today');
    if (counts.after) bits.push('<b>' + plural(counts.after, 'meeting') + '</b> ' +
      verbFor(counts.after, 'has') + ' been and gone with nothing recorded');
    if (counts.retry) bits.push('<b>' + commas(counts.retry) + '</b> are ready for another try');
    if (!bits.length) bits.push('nothing is owed and nothing is overdue');
    return 'You are on ' + plural(camps.length, 'campaign') + ' and <b>' + commas(all.length) +
      '</b> people on them can be rung. ' +
      bits.join(', ').replace(/, ([^,]*)$/, ' and $1') + '.';
  }

  /* Four ways to start, each with the reason it is worth pressing. The V3
     build's strip, with a BDR's four acts in it. */
  function startStrip(counts, all, camps) {
    const opens = [
      { k: 'callnext', label: 'Call the next one',
        why: all.length ? esc(all[0].name) + ' is top of the queue' : 'nobody is callable right now' },
      { k: 'due', label: 'Work what is due',
        why: counts.due ? plural(counts.due, 'person') + ' owed something today' : 'nothing is owed today' },
      { k: 'untouched', label: 'Ring somebody new',
        why: counts.untouched ? commas(counts.untouched) + ' have never been rung' : 'everyone has been tried' },
      { k: 'camps', label: 'Pick a campaign',
        why: plural(camps.length, 'campaign') + ' are yours to work' },
    ];
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

  function queueBlock(all, counts) {
    const shown = queue(null, S.q);
    const pages = Math.max(1, Math.ceil(shown.length / PAGE));
    const p = Math.min(pageAt(), pages - 1);
    const from = p * PAGE;
    const to = Math.min(shown.length, from + PAGE);
    return '<section class="s-block s-block-wide" aria-label="To call">' +
      '<div class="s-camp-list-head">' +
        '<h2 class="s-block-h">To call</h2>' +
        (function () {
          const page = shown.slice(from, to);
          const ring = page.filter((c) => rowVerb(c) === 'Call').length;
          if (!ring) return '';
          return '<button class="s-inline-btn" type="button" data-callall="' +
            esc(page.filter((c) => rowVerb(c) === 'Call').map((c) => c.id).join(',')) +
            '">Call these ' + ring + '</button>';
        })() +
      '</div>' +
      cuts(counts, all) +
      '<div class="b-vlist" id="queueList"></div>' +
      pager(from, to, shown.length, p, pages) +
    '</section>';
  }

  /* Where you are, and the two ways to move. Never "load more": a caller
     needs to be able to go back to the fifteen they were just on. */
  function pager(from, to, total, p, pages) {
    if (!total) return '';
    return '<div class="b-pager">' +
      '<span class="b-vfoot">' + commas(from + 1) + '–' + commas(to) + ' of ' +
        commas(total) + ' · page ' + (p + 1) + ' of ' + commas(pages) + '</span>' +
      '<span class="b-pager-go">' +
        (p > 0 ? '<button class="s-inline-btn" type="button" data-page="' + (p - 1) +
          '">Back ' + PAGE + '</button>' : '') +
        (p < pages - 1 ? '<button class="s-inline-btn" type="button" data-page="' + (p + 1) +
          '">Next ' + Math.min(PAGE, total - to) + '</button>' : '') +
      '</span>' +
    '</div>';
  }

  function campsBlock(camps) {
    return '<section class="s-block s-block-wide" aria-label="Your campaigns">' +
      '<div class="s-camp-list-head">' +
        '<h2 class="s-block-h">Your campaigns</h2>' +
        '<span class="s-block-say">' + plural(camps.length, 'campaign') + ' you are on</span>' +
      '</div>' +
      '<div class="b-vlist" id="campList"></div>' +
    '</section>';
  }

  /* ══ ONE PERSON ═════════════════════════════════════════════════════════
     Who they are, where they stand on the ladder, and what has been said.
     The brief and the post-meeting controls arrive with the call panel. */
  function contactPage() {
    const c = DB.byCon[S.con];
    if (!c) {
      return '<div class="s-home"><section class="s-rec-block">' +
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
      '<section class="s-rec-block">' +
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
          (c.next ? '<p class="s-block-sub">Next: <b>' + esc(c.next.what) + '</b> ' +
            esc(sayWhen(c.next.due)) + '.</p>' : '') +
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
      '</section>' +
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
  const BUCKETS = [
    { k: 'after',     label: 'After a meeting' },
    { k: 'due',       label: 'Due' },
    { k: 'retry',     label: 'Try again' },
    { k: 'open',      label: 'Open' },
    { k: 'untouched', label: 'Never rung' },
  ];
  function bucketOf(c) {
    if (awaitingDecision(c)) return 'after';
    if (dueToday(c)) return 'due';
    if (retry(c)) return 'retry';
    if (untouched(c)) return 'untouched';
    return 'open';
  }
  const B_ORDER = Object.create(null);
  BUCKETS.forEach((b, i) => (B_ORDER[b.k] = i));

  /* Why this person is on the list today, with the fact in it. A queue that
     cannot say why it ranked somebody is a queue you have to trust. */
  function whyLine(c) {
    const b = bucketOf(c);
    if (b === 'after') return 'Met <b>' + esc(sayWhen(c.next.due)) + '</b> — nothing recorded since';
    if (b === 'due') {
      const late = c.next.due < TODAY_ISO;
      return esc(c.next.what) + (late ? ' — <b>' + esc(sayWhen(c.next.due)) + '</b>' : ' <b>today</b>');
    }
    if (b === 'retry') return 'Rung <b>' + plural(c.attempts, 'time') + '</b>, last ' + esc(sayWhen(c.lastCallAt));
    if (b === 'untouched') return 'Never rung';
    return 'Spoke <b>' + esc(sayWhen(c.lastCallAt)) + '</b>, nothing owed';
  }
  /* What the row's press does. The action names the real next step: after a
     meeting nobody has ruled on, the move is to say what happened, not to
     ring them again. */
  const rowVerb = (c) => (bucketOf(c) === 'after' ? 'Say what happened' : 'Call');

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
        html += '<article class="' + cls + '" data-i="' + i +
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
  }

  /* ══ WHAT A CALL DOES TO A LEAD ═════════════════════════════════════════
     Pure, and the only thing that moves a rung on a call. A checkpoint never
     goes BACKWARDS on a call — ringing somebody you have already met does
     not un-meet them — and an exit is never climbed out of by a call, only
     by Undo. */
  function moveFor(c, outcome, props) {
    const at = rank(c.checkpoint);
    const has = (k) => props.indexOf(k) >= 0;
    const up = (k) => (isExit(c.checkpoint) ? null : rank(k) > at ? k : null);
    if (outcome === 'do-not-call') return { to: 'do-not-call', next: null, dnc: true };
    if (outcome === 'wrong-number') return { to: 'wrong-number', next: null };
    if (outcome === 'not-interested') return { to: 'declined', next: null };
    if (outcome === 'no-answer' || outcome === 'gatekeeper') return { to: up('no-answer') };
    if (outcome === 'callback') {
      return { to: up('callback'), next: { what: 'Call them back', due: dayAdd(DB.call.when) } };
    }
    /* Connected. What was asked for decides how far it moves. */
    if (has('meeting') || has('demo')) {
      return {
        to: up('meeting-set'),
        next: { what: has('demo') ? 'Demo for them' : 'Meeting with them', due: dayAdd(DB.call.when) },
      };
    }
    if (has('callback')) return { to: up('answered'), next: { what: 'Call them back', due: dayAdd(DB.call.when) } };
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
      const n = sess.done.length;
      closeCall();
      paint();
      toast('Session finished — ' + plural(n, 'call') + ' logged.');
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

  /* ══ 8. THE ROUTER ══════════════════════════════════════════════════════
     One delegated listener. Every control is a `data-` verb matched by
     `closest`, so a row can be re-rendered without losing its behaviour and
     no markup carries an inline handler. */
  document.addEventListener('click', (e) => {
    const t = e.target;

    const home = t.closest('[data-home]');
    if (home) { go(cleared()); return; }

    const con = t.closest('[data-con]');
    if (con) { go({ con: con.getAttribute('data-con') }); return; }

    /* Back to where you were, not to the front page. `data-home` clears every
       key, which from row eleven of page four of the Due cut means losing the
       cut, the page and the row — three deliberate choices, undone by the
       control that was supposed to return you to them. */
    const back = t.closest('[data-back]');
    if (back) { go({ con: '' }); return; }

    const camp = t.closest('[data-camp]');
    if (camp) { toast('The campaign page is the next step of the build.'); return; }

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
      if (k === 'callnext') {
        const first = queue(null, S.q).filter((c) => rowVerb(c) === 'Call')[0];
        if (first) startCall(first.id);
        else toast('Nobody in this cut has a number to ring.');
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
      const map = { 'due=overdue': 'due', 'status=going-cold': 'retry',
        'status=untouched': 'untouched', 'owner=mine': 'all' };
      go(Object.assign(cleared(), { q: map[v] || 'all' }));
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

  document.addEventListener('input', (e) => {
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
