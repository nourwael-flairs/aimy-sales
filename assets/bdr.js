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
        '" type="button" data-con="' + esc(c.id) + '">' + rowVerb(c) + '</button>';
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
          return '<button class="s-inline-btn" type="button" data-callall>Call these ' +
            ring + '</button>';
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
              ? 'Phone <a class="s-inline-btn" href="tel:' + esc(c.phone.replace(/\s/g, '')) + '">' + esc(c.phone) + '</a>'
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
        const first = queue(null, S.q)[0];
        if (first) go({ con: first.id });
        else toast('Nobody is callable right now.');
      } else if (k === 'camps') {
        byId('campList').scrollIntoView({ block: 'start' });
      } else {
        go(Object.assign(cleared(), { q: k }));
      }
      return;
    }

    const callall = t.closest('[data-callall]');
    if (callall) { toast('Calling through a queue arrives with the call panel.'); return; }

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
    patch: patchCon,
    addTouch: addTouch,
    dropTouch: dropTouch,
  };
})();
