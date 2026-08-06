/* ═══════════════════════════════════════════════════════════════════════
   sales.js — AiMY Sales v2

   One surface. The URL is the state, and the only state: every filter, the
   open record and the view mode live in the query string, and nothing
   filters off a variable the URL does not also hold. That is what makes the
   surface drivable by an agent as well as by a person.

   Two theses, and everything here follows from them.

   A LEAD IS A RECORD, NOT A RESULT. V1 answered a question with prose and a
   table and kept the conversation; ask again tomorrow and you got a second
   conversation. Nothing accumulated, because there was nothing to
   accumulate onto. Here the query produces records, the records persist,
   and touchpoints land on them.

   STATUS IS COMPUTED, NEVER ATTESTED. There is no stage dropdown. A CRM
   stage field is the canonical thing nobody updates — it is Knowledge v2's
   trust-state problem wearing a sales badge. Every status below is derived
   from the touchpoints, and every status has an exit.

   Prototype scope: there is no backend. The corpus, the user and the
   touchpoint history are fixtures, generated deterministically so that a
   reload reproduces them exactly — which the empty-state triggers depend
   on, since they work by mutating the corpus for real.
   ═══════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  /* ═══════════════════════════════════════════════
     HELPERS
  ═══════════════════════════════════════════════ */

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  /* HTML-escape. Every fixture string goes through this on its way into
     markup — the corpus holds apostrophes and ampersands and one of them
     will eventually be a quote. */
  const esc = (s) =>
    String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));

  /* Deterministic PRNG (mulberry32). Math.random would give a different
     corpus every reload, and the empty-state triggers work by mutating the
     real corpus — with a random one you could never tell whether a trigger
     had done anything or the fixtures had simply changed under you. */
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
  const chance = (r, p) => r() < p;
  const between = (r, lo, hi) => lo + Math.floor(r() * (hi - lo + 1));

  /* ── Dates ──
     Readable, never numeric: `12 Mar 2026`, not `03-12-2026`. A numeric date
     is ambiguous across regions and slower to read, and this corpus spans
     EMEA, APAC and the Americas. */
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  /* "Today" is fixed. A prototype whose fixtures are relative to the real
     clock drifts: a lead built to be 3 days overdue is 200 days overdue by
     the time somebody opens the deployed link, and every status shifts. */
  const TODAY = new Date('2026-08-05T09:00:00');

  const day = 86400000;
  const dayOf = (d) => Math.floor(new Date(d).getTime() / day);
  const daysBetween = (a, b) => dayOf(b) - dayOf(a);
  const daysAgo = (d) => daysBetween(d, TODAY);
  const shift = (base, days) => new Date(new Date(base).getTime() + days * day);
  const iso = (d) => new Date(d).toISOString().slice(0, 10);

  function fmtDate(d) {
    const t = new Date(d);
    return `${t.getDate()} ${MONTHS[t.getMonth()]} ${t.getFullYear()}`;
  }

  /* A distance, not a point. "How long has it been" is the question these
     answer, and a date makes the reader do the subtraction. */
  function fmtAgo(d) {
    const n = daysAgo(d);
    if (n < 0) return `in ${fmtIn(-n)}`;
    if (n === 0) return 'today';
    if (n === 1) return 'yesterday';
    if (n < 7) return `${n} days ago`;
    if (n < 14) return 'last week';
    if (n < 60) return `${Math.round(n / 7)} weeks ago`;
    if (n < 365) return `${Math.round(n / 30)} months ago`;
    return `${(n / 365).toFixed(n < 730 ? 1 : 0)} years ago`;
  }
  function fmtIn(n) {
    if (n === 0) return 'today';
    if (n === 1) return 'tomorrow';
    if (n < 14) return `${n} days`;
    if (n < 60) return `${Math.round(n / 7)} weeks`;
    return `${Math.round(n / 30)} months`;
  }
  /* The same distance as a phrase that can stand in a sentence. "demo 9
     days" is not English; "demo in 9 days" is, and "demo today" must not
     become "demo in today". */
  function fmtInPhrase(n) {
    const s = fmtIn(n);
    return s === 'today' || s === 'tomorrow' ? s : `in ${s}`;
  }

  /* Counts that read as sentences. `1 accounts` is the tell that nobody
     looked at the empty and single cases — and `30 addresss` is the tell
     that the plural was left to a bare +"s". Irregulars are declared, so a
     new call site cannot reintroduce one by forgetting to pass the plural. */
  const IRREGULAR = { address: 'addresses', person: 'people', company: 'companies', reply: 'replies' };
  const plural = (n, one, many) =>
    `${n} ${n === 1 ? one : many || IRREGULAR[one] || one + 's'}`;

  /* Employee counts, in the reader's units. V1 printed `259000` in a column
     headed ESTIMATED NUM EMPLOYEES; nobody reads six digits as a size. */
  function fmtSize(n) {
    if (n == null) return null;
    if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1).replace('.0', '')}k staff`;
    return `${n} staff`;
  }

  /* Money at the magnitude a rep talks in. V1's criteria card printed
     "$10.0M - $500M" and its table printed nothing at all. */
  function fmtMoney(n) {
    if (n == null) return null;
    if (n >= 1e9) return `$${(n / 1e9).toFixed(n >= 10e9 ? 0 : 1).replace('.0', '')}B`;
    if (n >= 1e6) return `$${(n / 1e6).toFixed(n >= 100e6 ? 0 : 1).replace('.0', '')}M`;
    return `$${Math.round(n / 1e3)}k`;
  }

  /* ═══════════════════════════════════════════════
     TAXONOMY — one vocabulary, shared by the filters, the chip bar,
     the input parser and the answers.

     Declared once. A second lexicon anywhere is a lexicon that drifts from
     this one, which is how "who owns the support accounts" and the Owner
     filter come to disagree about what an owner is.
  ═══════════════════════════════════════════════ */

  const TAX = {
    /* The eight computed statuses. `.tone` drives the card border and the
       word's colour; `.exit` is the single action the card offers, because
       the card's one action IS its status's exit. */
    /* `mode` is the doctrine's entry-mode classification (§3) and is
       mandatory: an unclassified action fails review.

       `opens` is why most of these have no button. An exit that opens the
       record is not a control — the card already opens the record, and the
       row already opens the record. Measured before the change: 100 of 118
       cards carried a CTA, 89 of them said one of three things that did
       exactly what clicking the card did, and the first twelve cards on the
       default screen all read "Log the touchpoint". A hundred buttons that
       duplicate their own container is not a call to action, it is a
       texture.

       WHAT SURVIVES IS WHAT CARRIES A MESSAGE the card is not already
       carrying: this one is late, this one is dying, you disqualified this
       and owe a reason. Each opens a surface of its own.

       The instruction is not lost with the button. The status word in the
       meta line IS the instruction — "Awaiting us" and "Log the touchpoint"
       are the same sentence, and only one of them needs a border. */
    status: [
      { k: 'untouched',    label: 'Untouched',    tone: 'neutral', exit: 'First touch',         mode: 'em-direct', opens: 'record' },
      { k: 'awaiting-us',  label: 'Awaiting us',  tone: 'err',     exit: 'Log the touchpoint',  mode: 'em-direct', opens: 'record' },
      { k: 'awaiting-them', label: 'Awaiting them', tone: 'ok',    exit: 'Set a follow-up',     mode: 'em-direct', opens: 'record' },
      { k: 'stalled',      label: 'Stalled',      tone: 'err',     exit: 'Reschedule or close', mode: 'em-direct', opens: 'commit' },
      { k: 'going-cold',   label: 'Going cold',   tone: 'warn',    exit: 'Re-engage or drop',   mode: 'em-review', opens: 'canvas' },
      { k: 'not-a-fit',    label: 'Not a fit',    tone: 'neutral', exit: 'Say why',             mode: 'em-direct', opens: 'commit' },
      { k: 'won',          label: 'Won',          tone: 'ok',      exit: null,                  mode: null,        opens: null },
      { k: 'lost',         label: 'Lost',         tone: 'neutral', exit: null,                  mode: null,        opens: null },
    ],

    /* Four channels. Three are things a person did; the fourth is AiMY, and
       it is never disguised as one of the other three. */
    channel: [
      { k: 'physical', label: 'In person', verb: 'Met',    ico: 'pin',   blurb: 'A visit, an event, a meeting on their site.' },
      { k: 'phone',    label: 'Phone',     verb: 'Called', ico: 'phone', blurb: 'A call you made or took.' },
      { k: 'meeting',  label: 'Online',    verb: 'Met online', ico: 'video', blurb: 'A video call or a screen share.' },
      { k: 'aimy',     label: 'AiMY',      verb: 'AiMY emailed', ico: 'aimy', auto: true, blurb: 'AiMY sends these itself. You do not log them.' },
    ],

    outcome: [
      { k: 'meeting-booked', label: 'Meeting booked', tone: 'ok' },
      { k: 'positive',       label: 'Positive',       tone: 'ok' },
      { k: 'neutral',        label: 'Neutral',        tone: 'neutral' },
      { k: 'negative',       label: 'Negative',       tone: 'err' },
      { k: 'no-answer',      label: 'No answer',      tone: 'neutral' },
      { k: 'bounced',        label: 'Bounced',        tone: 'warn' },
    ],

    industry: [
      { k: 'software',  label: 'Software' },
      { k: 'banking',   label: 'Banking & finance' },
      { k: 'logistics', label: 'Logistics' },
      { k: 'health',    label: 'Healthcare' },
      { k: 'retail',    label: 'Retail' },
      { k: 'energy',    label: 'Energy & utilities' },
      { k: 'public',    label: 'Public & education' },
      { k: 'telecom',   label: 'Telecom' },
      { k: 'industry',  label: 'Manufacturing' },
    ],

    region: [
      { k: 'emea',   label: 'EMEA' },
      { k: 'apac',   label: 'APAC' },
      { k: 'amer',   label: 'Americas' },
      { k: 'global', label: 'Global' },
    ],

    /* Revenue, in bands. V1's List Criteria filters on it — "$10.0M -
       $500M" — and it is how a rep sizes a deal before they size a company:
       headcount says how much work there is, revenue says whether they can
       pay for it. */
    rev: [
      { k: 'r0', label: 'Under $10M',   lo: 0,          hi: 10e6 },
      { k: 'r1', label: '$10M – $50M',  lo: 10e6,       hi: 50e6 },
      { k: 'r2', label: '$50M – $250M', lo: 50e6,       hi: 250e6 },
      { k: 'r3', label: '$250M – $1B',  lo: 250e6,      hi: 1e9 },
      { k: 'r4', label: 'Over $1B',     lo: 1e9,        hi: Infinity },
    ],

    /* Bands, not numbers. Nobody filters for "between 4,000 and 7,500". */
    size: [
      { k: 'micro', label: 'Under 50',    lo: 0,     hi: 49 },
      { k: 'small', label: '50–200',      lo: 50,    hi: 200 },
      { k: 'mid',   label: '200–1,000',   lo: 201,   hi: 1000 },
      { k: 'large', label: '1,000–5,000', lo: 1001,  hi: 5000 },
      { k: 'ent',   label: '5,000+',      lo: 5001,  hi: Infinity },
    ],

    /* Where the lead came from. `aimy` is the scrape V1 already runs. */
    src: [
      { k: 'scrape',   label: 'AiMY scrape' },
      { k: 'inbound',  label: 'Inbound' },
      { k: 'referral', label: 'Referral' },
      { k: 'event',    label: 'Event' },
      { k: 'list',     label: 'Imported list' },
    ],

    /* FlairsTech's own services — the same five Knowledge files ICPs under,
       so an ICP retrieved from Knowledge lands on an axis this surface
       already has. */
    service: [
      { k: 'qa',        label: 'QA' },
      { k: 'voice',     label: 'Voice' },
      { k: 'support',   label: 'Support' },
      { k: 'cx',        label: 'CX' },
      { k: 'analytics', label: 'Analytics' },
      { k: 'dev',       label: 'Development' },
    ],
  };

  /* Index every axis once, by key. Every lookup in this file goes through
     these — a `.find()` on an array in a render path is how a label ends up
     rendered as its key on one surface and its label on another. */
  const BY = {};
  for (const axis of Object.keys(TAX)) {
    BY[axis] = Object.create(null);
    for (const row of TAX[axis]) BY[axis][row.k] = row;
  }
  /* Falls back through two levels, not one. `BY[axis]` is undefined for the
     axes whose values are people rather than taxonomy — `owner`, `shared` —
     and a helper that throws on an axis it does not know is a helper that
     turns a naming miss into a dead click. */
  const label = (axis, k) => (BY[axis] && BY[axis][k] ? BY[axis][k].label : k);

  /* ═══════════════════════════════════════════════
     WHO IS LOOKING

     Entitlement determines what may be shown; relevance determines what is
     shown first (Knowledge direction §9.2).

     THIS REVERSES WHAT THIS BANNER USED TO SAY. It read: "Both are derived
     here rather than declared, so there is no role toggle and no role
     setting." That was true while every actor could see everything — a
     statement about a corpus with one tier in it, not a principle. The Lead
     Tracking map asks for Permission over Clients, Admins and Stakeholders,
     and the roadmap asks for observability for others and managers; neither
     is derivable from a record. So a tier is declared, and the reversal is
     recorded here rather than quietly edited out.

     A TIER IS WHAT YOU MAY SEE. A ROLE IS WHAT YOU DO. They are kept apart
     because merging them is how permission bugs get written: "Account
     Executive" is a job, and two of them can sit in different tiers.
  ═══════════════════════════════════════════════ */

  /* Each tier's rule is stated in the words the surface will use to explain
     itself, because it has to explain itself — see `hiddenBy()`. A rule
     nobody can read is a rule nobody can check. */
  const TIERS = {
    admin: {
      label: 'Admin', ceiling: 'Everyone',
      rule: 'Admins see every record in the workspace.',
      sees: () => true, writes: true,
    },
    manager: {
      label: 'Manager', ceiling: 'Everyone in Sales EMEA',
      rule: 'Managers see every lead owned by someone on their team, and every lead nobody owns.',
      sees: (rec, me) => !rec.owner || teamOf(me.id).has(rec.owner), writes: true,
    },
    rep: {
      label: 'Rep', ceiling: 'Everyone in Sales EMEA',
      rule: 'You see leads you own, leads shared with you, and leads in a campaign you are assigned to.',
      sees: (rec, me) => rec.owner === me.id || (rec.shared || []).includes(me.id) || onACampaignWith(rec, me.id),
      writes: true,
    },
    stakeholder: {
      label: 'Stakeholder', ceiling: 'Everyone',
      rule: 'Stakeholders see every lead and can change none of them.',
      sees: () => true, writes: false,
    },
    client: {
      label: 'Client', ceiling: null,
      rule: 'You see the leads in your own engagement, and nothing outside it.',
      sees: (rec, me) => clientsOf(rec).includes(me.client), writes: false,
    },
  };

  /* Client-tier people are actors here exactly as reps are. Modelling them
     as a separate kind would mean every `actor()` call site learning about
     two shapes, and the one thing that differs — the engagement they are
     bounded to — is one field. */
  const REPS = [
    { id: 'nour',    name: 'Nour Wael',     initials: 'NW', role: 'Product Design',    tier: 'admin' },
    { id: 'ahmed',   name: 'Ahmed Mahfouz', initials: 'AM', role: 'Sales Lead',        tier: 'manager' },
    { id: 'engy',    name: 'Engy Saleh',    initials: 'ES', role: 'BDR',               tier: 'rep' },
    { id: 'habeba',  name: 'Habeba Mourad', initials: 'HM', role: 'BDR',               tier: 'rep' },
    { id: 'omar',    name: 'Omar Fathy',    initials: 'OF', role: 'Account Executive', tier: 'rep' },
    { id: 'sara',    name: 'Sara Nabil',    initials: 'SN', role: 'Account Executive', tier: 'rep' },
    { id: 'youssef', name: 'Youssef Adel',  initials: 'YA', role: 'Delivery Director', tier: 'stakeholder' },
    /* A client's `role` is their job, not their company — the pill already
       names the engagement beside it, and "Upland · Upland" says one thing
       twice while saying nothing about who this person is. */
    { id: 'marit',   name: 'Marit de Wit',  initials: 'MW', role: 'Revenue Operations', tier: 'client', client: 'upland' },
    { id: 'tomas',   name: 'Tomas Brandt',  initials: 'TB', role: 'Head of Sales',      tier: 'client', client: 'kestrel' },
  ];
  const REP = Object.create(null);
  REPS.forEach((r) => (REP[r.id] = r));

  /* Who can own a lead. Stakeholders and clients are people on this surface
     but they do not carry a book, so offering them in the Owner and
     Shared-with axes would be offering a filter that can only return
     nothing — and a nought that is structural reads as a nought that is
     news. */
  const SELLERS = REPS.filter((p) => ['admin', 'manager', 'rep'].includes(p.tier));

  /* One team, because one is enough to make "my team" mean something and two
     would be corpus for its own sake. The manager is not a member of their
     own team — `teamOf` adds them, so the rule reads the way people say it. */
  const TEAMS = [
    { k: 'emea', name: 'Sales EMEA', manager: 'ahmed', members: ['engy', 'habeba', 'omar', 'sara'] },
  ];
  function teamOf(id) {
    const t = TEAMS.find((x) => x.manager === id || x.members.includes(id));
    return new Set(t ? [t.manager].concat(t.members) : [id]);
  }
  const teamName = (id) => {
    const t = TEAMS.find((x) => x.manager === id || x.members.includes(id));
    return t ? t.name : null;
  };

  /* AiMY is an actor in this model, not a feature of it. It owns nothing and
     is never an owner, but it is the `by` on a touchpoint it made — and it
     renders with the --ai gradient, never the avatar gradient, so a rep can
     never mistake AiMY's work for their own. */
  const AIMY = { id: 'aimy', name: 'AiMY', initials: 'AI', role: 'Agent', isAi: true };
  const actor = (id) => (id === 'aimy' ? AIMY : REP[id] || { id, name: id, initials: '??' });

  /* Who is looking, from `?as=`. In a real product this comes from auth and
     is not addressable; here it is state, because demonstrating what each
     tier sees IS the deliverable — and a permission model you cannot link
     someone to is a permission model nobody reviews.

     This is a function, not the constant it replaced. Half this file reads
     the current person at render time, and a value snapshotted at boot would
     have gone stale the moment `?as=` changed — which is the quietest
     possible permission bug: the right records filtered against the wrong
     person, with nothing on screen to say so. */
  const DEFAULT_ME = 'nour';
  const me = () => REP[S.as] || REP[DEFAULT_ME];

  /* ═══════════════════════════════════════════════
     THE CORPUS

     Real organisations, fictional people. The firmographics — name, domain,
     city, staff, founded — are public facts and are exactly what V1's
     scrape returns, so the surface is evaluated against the data it will
     really hold. The contacts are invented: fabricating a named individual
     at a real company is a different thing entirely, and nothing here needs
     it.

     Seeded from V1's own result set, which found 100 Dutch tech companies
     over 1,000 staff, concentrated in Amsterdam (44), Eindhoven (7),
     Utrecht (5), Schiphol (4) and Rotterdam (4).
  ═══════════════════════════════════════════════ */

  /* name · domain · city · staff · founded · industry
     `null` staff or founded is a real hole in the scrape, not a placeholder
     — V1 rendered seven of twelve columns as "N/A" and this corpus keeps
     the holes so the table has to cope with them honestly. */
  const SEED_ACCOUNTS = [
    ['ING', 'ing.com', 'Amsterdam', 60000, 1991, 'banking'],
    ['ABN AMRO', 'abnamro.com', 'Amsterdam', 22000, 1991, 'banking'],
    ['Rabobank', 'rabobank.com', 'Utrecht', 43000, 1972, 'banking'],
    ['Aegon', 'aegon.com', 'The Hague', 22000, 1983, 'banking'],
    ['NN Group', 'nn-group.com', 'The Hague', 16000, 1845, 'banking'],
    ['Achmea', 'achmea.nl', 'Zeist', 14000, 1811, 'banking'],
    ['Adyen', 'adyen.com', 'Amsterdam', 4200, 2006, 'banking'],
    ['Mollie', 'mollie.com', 'Amsterdam', 750, 2004, 'banking'],
    ['bunq', 'bunq.com', 'Amsterdam', 450, 2012, 'banking'],
    ['Optiver', 'optiver.com', 'Amsterdam', 1900, 1986, 'banking'],
    ['Flow Traders', 'flowtraders.com', 'Amsterdam', 700, 2004, 'banking'],
    ['IMC Trading', 'imc.com', 'Amsterdam', 1100, 1989, 'banking'],
    ['Philips', 'philips.com', 'Amsterdam', 69000, 1891, 'health'],
    ['ASML', 'asml.com', 'Veldhoven', 42000, 1984, 'industry'],
    ['NXP Semiconductors', 'nxp.com', 'Eindhoven', 34000, 2006, 'industry'],
    ['Signify', 'signify.com', 'Eindhoven', 32000, 2016, 'industry'],
    ['Nedap', 'nedap.com', 'Groenlo', 900, 1929, 'industry'],
    ['VDL Groep', 'vdlgroep.com', 'Eindhoven', 16000, 1953, 'industry'],
    ['Vanderlande', 'vanderlande.com', 'Veghel', 8500, 1949, 'industry'],
    ['Damen Shipyards', 'damen.com', 'Gorinchem', 12000, 1927, 'industry'],
    ['Booking.com', 'booking.com', 'Amsterdam', 23000, 1996, 'software'],
    ['TomTom', 'tomtom.com', 'Amsterdam', 3700, 1991, 'software'],
    ['Miro', 'miro.com', 'Amsterdam', 1800, 2011, 'software'],
    ['Backbase', 'backbase.com', 'Amsterdam', 1000, 2003, 'software'],
    ['MessageBird', 'messagebird.com', 'Amsterdam', 700, 2011, 'software'],
    ['Exact', 'exact.com', 'Delft', 1800, 1984, 'software'],
    ['AFAS Software', 'afas.nl', 'Leusden', 600, 1996, 'software'],
    ['Channable', 'channable.com', 'Utrecht', 350, 2014, 'software'],
    ['Sendcloud', 'sendcloud.com', 'Eindhoven', 350, 2012, 'software'],
    ['Mambu', 'mambu.com', 'Amsterdam', 900, 2011, 'software'],
    ['Framer', 'framer.com', 'Amsterdam', 140, 2014, 'software'],
    ['Wolters Kluwer', 'wolterskluwer.com', 'Alphen aan den Rijn', 21000, 1836, 'software'],
    ['RELX', 'relx.com', 'Amsterdam', 36000, 1993, 'software'],
    ['Randstad', 'randstad.com', 'Diemen', 40000, 1960, 'public'],
    ['Randstad Sourceright', 'randstadsourceright.com', 'Amsterdam', 3500, 2011, 'public'],
    ['Brunel', 'brunel.net', 'Amsterdam', 12000, 1975, 'public'],
    ['YER', 'yer.nl', 'Eindhoven', 500, 1987, 'public'],
    ['BearingPoint', 'bearingpoint.com', 'Amsterdam', 7000, 1956, 'public'],
    ['Capgemini Netherlands', 'capgemini.com', 'Utrecht', 6400, 2002, 'software'],
    ['Arcadis', 'arcadis.com', 'Amsterdam', 36000, 1888, 'industry'],
    ['Royal HaskoningDHV', 'royalhaskoningdhv.com', 'Amersfoort', 6000, 1881, 'industry'],
    ['Fugro', 'fugro.com', 'Leidschendam', 9000, 1962, 'energy'],
    ['Boskalis', 'boskalis.com', 'Papendrecht', 11000, 1910, 'industry'],
    ['KLM', 'klm.com', 'Schiphol', 33000, 1919, 'logistics'],
    ['Schiphol Group', 'schiphol.nl', 'Schiphol', 2600, 1916, 'logistics'],
    ['Transavia', 'transavia.com', 'Schiphol', 2000, 1965, 'logistics'],
    ['Martinair', 'martinair.com', 'Schiphol', 900, 1958, 'logistics'],
    ['Port of Rotterdam', 'portofrotterdam.com', 'Rotterdam', 1300, 1932, 'logistics'],
    ['PostNL', 'postnl.nl', 'The Hague', 34000, 1799, 'logistics'],
    ['DHL Express Netherlands', 'dhl.nl', 'Utrecht', 4000, 1969, 'logistics'],
    ['Van Oord', 'vanoord.com', 'Rotterdam', 5000, 1868, 'logistics'],
    ['Ahold Delhaize', 'aholddelhaize.com', 'Zaandam', 390000, 2016, 'retail'],
    ['Jumbo', 'jumbo.com', 'Veghel', 100000, 1921, 'retail'],
    ['Coolblue', 'coolblue.nl', 'Rotterdam', 7000, 1999, 'retail'],
    ['bol', 'bol.com', 'Utrecht', 2500, 1999, 'retail'],
    ['Action', 'action.com', 'Zwaagdijk', 70000, 1993, 'retail'],
    ['HEMA', 'hema.nl', 'Amsterdam', 19000, 1926, 'retail'],
    ['Picnic', 'picnic.app', 'Amsterdam', 15000, 2015, 'retail'],
    ['Rituals', 'rituals.com', 'Amsterdam', 11000, 2000, 'retail'],
    ['Just Eat Takeaway', 'justeattakeaway.com', 'Amsterdam', 17000, 2000, 'retail'],
    ['Swapfiets', 'swapfiets.com', 'Amsterdam', 1500, 2014, 'retail'],
    ['KPN', 'kpn.com', 'Rotterdam', 10000, 1852, 'telecom'],
    ['VodafoneZiggo', 'vodafoneziggo.nl', 'Utrecht', 7500, 2016, 'telecom'],
    ['Odido', 'odido.nl', 'The Hague', 2000, 1999, 'telecom'],
    ['Eneco', 'eneco.com', 'Rotterdam', 7000, 1995, 'energy'],
    ['Vattenfall Netherlands', 'vattenfall.nl', 'Amsterdam', 3500, 1909, 'energy'],
    ['TenneT', 'tennet.eu', 'Arnhem', 8000, 1998, 'energy'],
    ['Alliander', 'alliander.com', 'Arnhem', 8000, 2009, 'energy'],
    ['Stedin', 'stedin.net', 'Rotterdam', 5000, 2008, 'energy'],
    ['Shell', 'shell.com', 'The Hague', 96000, 1907, 'energy'],
    ['Heineken', 'heineken.com', 'Amsterdam', 90000, 1864, 'retail'],
    ['Unilever', 'unilever.com', 'Rotterdam', 128000, 1929, 'retail'],
    ['AkzoNobel', 'akzonobel.com', 'Amsterdam', 23000, 1994, 'industry'],
    ['DSM-Firmenich', 'dsm-firmenich.com', 'Maastricht', 30000, 1902, 'industry'],
    ['Eindhoven University of Technology', 'tue.nl', 'Eindhoven', 4000, 1956, 'public'],
    ['Delft University of Technology', 'tudelft.nl', 'Delft', 6400, 1842, 'public'],
    ['Utrecht University', 'uu.nl', 'Utrecht', 8500, 1636, 'public'],
    ['University of Amsterdam', 'uva.nl', 'Amsterdam', 6000, 1632, 'public'],
    ['Leiden University', 'universiteitleiden.nl', 'Leiden', 7000, 1575, 'public'],
    ['University of Twente', 'utwente.nl', 'Enschede', 3400, 1961, 'public'],
    ['Wageningen University', 'wur.nl', 'Wageningen', 7200, 1918, 'public'],
    ['Erasmus University Rotterdam', 'eur.nl', 'Rotterdam', 3200, 1913, 'public'],
    ['Radboud University', 'ru.nl', 'Nijmegen', 5300, 1923, 'public'],
    ['TNO', 'tno.nl', 'The Hague', 3800, 1932, 'public'],
    ['Amsterdam UMC', 'amsterdamumc.org', 'Amsterdam', 16000, 2018, 'health'],
    ['Erasmus MC', 'erasmusmc.nl', 'Rotterdam', 15000, 1950, 'health'],
    ['UMC Utrecht', 'umcutrecht.nl', 'Utrecht', 12000, 1999, 'health'],
    ['Nederlandse Spoorwegen', 'ns.nl', 'Utrecht', 20000, 1938, 'logistics'],
    ['ProRail', 'prorail.nl', 'Utrecht', 5000, 2003, 'logistics'],
    ['Sligro Food Group', 'sligro.nl', 'Veghel', 6500, 1935, 'retail'],
    ['Lightyear', 'lightyear.one', 'Helmond', 250, 2016, 'industry'],
    ['Nearfield Instruments', 'nearfieldinstruments.com', 'Rotterdam', 180, 2016, 'industry'],
    ['SMART Photonics', 'smartphotonics.nl', 'Eindhoven', 160, 2012, 'industry'],
    ['Salvia BioElectronics', 'salviabio.com', 'Eindhoven', null, 2017, 'health'],
    ['Amber Mobility', 'ambermobility.com', 'Eindhoven', null, 2016, 'software'],
    ['Bird', 'bird.com', 'Amsterdam', 800, 2011, 'software'],
    ['Dept Agency', 'deptagency.com', 'Amsterdam', 4000, 2015, 'software'],
    ['Tony’s Chocolonely', 'tonyschocolonely.com', 'Amsterdam', 300, 2005, 'retail'],
    ['G-Star RAW', 'g-star.com', 'Amsterdam', 1400, 1989, 'retail'],
    ['VanMoof', 'vanmoof.com', 'Amsterdam', null, 2009, 'retail'],
    ['Elastic', 'elastic.co', 'Amsterdam', 3400, 2012, 'software'],
    ['GitLab Netherlands', 'gitlab.com', 'Amsterdam', 2100, 2014, 'software'],
    ['Databricks Netherlands', 'databricks.com', 'Amsterdam', 900, 2013, 'software'],
    ['Uber Netherlands', 'uber.com', 'Amsterdam', 2000, 2013, 'software'],
    ['Netflix EMEA', 'netflix.com', 'Amsterdam', 1200, 2015, 'software'],
    ['Salesforce Netherlands', 'salesforce.com', 'Amsterdam', 800, 2007, 'software'],
    ['Cisco Netherlands', 'cisco.com', 'Amsterdam', 600, 1995, 'telecom'],
    ['Accenture Netherlands', 'accenture.com', 'Amsterdam', 4500, 1989, 'public'],
    ['Deloitte Netherlands', 'deloitte.nl', 'Amsterdam', 7000, 1883, 'public'],
    ['KPMG Netherlands', 'kpmg.nl', 'Amstelveen', 4000, 1917, 'public'],
    ['PwC Netherlands', 'pwc.nl', 'Amsterdam', 5500, 1849, 'public'],
    ['EY Netherlands', 'ey.com', 'Amsterdam', 5000, 1883, 'public'],
    ['Ordina', 'ordina.com', 'Nieuwegein', 3000, 1973, 'software'],
    ['Sopra Steria Netherlands', 'soprasteria.nl', 'Utrecht', 1200, 1968, 'software'],
    ['Conclusion', 'conclusion.nl', 'Utrecht', 2400, 1996, 'software'],
    ['Info Support', 'infosupport.com', 'Veenendaal', 500, 1986, 'software'],
    ['Quintor', 'quintor.nl', 'Groningen', 300, 2005, 'software'],
    ['Xebia', 'xebia.com', 'Hilversum', 1200, 2001, 'software'],
  ];

  /* Fictional people. Dutch given names and surnames combined by the seeded
     PRNG, so nobody here is a real person at a real company. */
  const GIVEN = ['Sanne', 'Daan', 'Lotte', 'Bram', 'Femke', 'Sven', 'Maartje', 'Joris',
    'Nienke', 'Thijs', 'Eva', 'Ruben', 'Anouk', 'Pieter', 'Iris', 'Koen', 'Marije',
    'Wouter', 'Esther', 'Bas', 'Lieke', 'Jeroen', 'Sofie', 'Rick', 'Noor', 'Tim'];
  const SURNAME = ['de Vries', 'van Dijk', 'Bakker', 'Janssen', 'Visser', 'Smit',
    'Meijer', 'de Boer', 'Mulder', 'de Groot', 'Bos', 'Vos', 'Peters', 'Hendriks',
    'van Leeuwen', 'Dekker', 'Brouwer', 'de Wit', 'Dijkstra', 'Kok', 'van der Berg'];

  /* Roles worth calling, per service. The role decides which ICP an account
     matches and what a first touch would even be about — and it is also the
     job-title axis, because V1 filters on exactly this: "Title: IT Support
     Manager". On a CONTACT the title is theirs; on an ACCOUNT it means
     somebody there holds it, which is how you find a company by the person
     you need to reach. */
  const ROLES = [
    { t: 'Head of QA', svc: 'qa' },
    { t: 'QA Manager', svc: 'qa' },
    { t: 'Director of Engineering', svc: 'dev' },
    { t: 'VP Engineering', svc: 'dev' },
    { t: 'Head of Customer Support', svc: 'support' },
    { t: 'Support Operations Manager', svc: 'support' },
    /* V1's own worked example filters on this exact title. It has to exist
       in the corpus or the screenshot's query can never return anything. */
    { t: 'IT Support Manager', svc: 'support' },
    { t: 'Head of Customer Experience', svc: 'cx' },
    { t: 'CX Programme Lead', svc: 'cx' },
    { t: 'Head of Data & Analytics', svc: 'analytics' },
    { t: 'Analytics Manager', svc: 'analytics' },
    { t: 'Contact Centre Director', svc: 'voice' },
    { t: 'Head of Service Delivery', svc: 'voice' },
    { t: 'CTO', svc: 'dev' },
    { t: 'COO', svc: 'support' },
    { t: 'Procurement Lead', svc: 'qa' },
  ];

  /* ═══════════════════════════════════════════════
     CLIENTS — the engagement a piece of work belongs to

     AIMY-1253 asks for retrieval by client and the Lead Tracking map puts
     Clients in the permission list. Both need the same object, which did not
     exist: the README declared retrieval-by-client "not built" because there
     was no client model to filter on.

     A client is an organisation FlairsTech runs an engagement for. Most
     campaigns here are FlairsTech's own book and carry `client: null` — that
     is not a missing value, it is the commonest case, and forcing every
     campaign to name a client would have invented an owner for work that
     genuinely has none.

     NOTHING STORES A CLIENT ON A RECORD. A lead reaches a client the way it
     reaches a campaign: through membership, derived in `reindex()` into
     `DB.clientsOf`. A lead can sit in two engagements, and the second copy
     of that fact is the one that would drift.
  ═══════════════════════════════════════════════ */

  const CLIENTS = [
    { k: 'upland',  name: 'Upland',        since: '2025-02-01', owner: 'sara', svc: ['dev'],
      what: 'Education software. We prospect their EMEA pilot market and run the first two touches.' },
    { k: 'kestrel', name: 'Kestrel Voice', since: '2026-01-15', owner: 'omar', svc: ['voice'],
      what: 'Contact-centre platform. Their EMEA financial-services push, sourced and qualified here.' },
  ];
  const CLIENT_BY = Object.create(null);
  CLIENTS.forEach((c) => (CLIENT_BY[c.k] = c));
  const clientName = (k) => (CLIENT_BY[k] ? CLIENT_BY[k].name : k);

  /* ═══════════════════════════════════════════════
     CAMPAIGNS — and what V1 calls a "list" is a campaign nobody started

     V1 has Lists (create · merge · add contacts · assign) and the epic asks
     for Campaigns. THEY ARE ONE OBJECT, and V1's own copy proves it: the
     dialog is headed "Add Contacts to Strategic Q4" and the warning inside
     it reads "5 contacts already exist in the target CAMPAIGN". The same
     thing is a list in the header and a campaign in the body, because nobody
     settled the word.

     The epic settles it. There is one record type — the campaign — and a
     "list" is one nobody has started. So DRAFT IS A STATE, not a second
     noun, and `campState` computes it: no plan means nobody has decided how
     to work it, past its window means it is done. Same rule as every lead
     status here, for the same reason — a field somebody has to remember to
     set is a field that goes stale.

     MEMBERSHIP LIVES ON THE CAMPAIGN, not on the record. Every operation V1
     has is audience-shaped — add these contacts, merge these two, who is
     assigned — and a reverse index (`DB.campsOf`) gives the record its side
     without a second copy that can drift.
  ═══════════════════════════════════════════════ */

  const CAMPAIGNS = [
    {
      k: 'q3-nl', name: 'Q3 Netherlands — QA', owner: 'ahmed', assignees: ['engy', 'habeba'],
      made: '2026-06-02', from: '2026-06-15', to: '2026-09-30',
      description: 'Dutch enterprises over 1,000 staff running their own QA function. Lead with the SARS E-Track and RO modernisation stories — both are legacy-to-modern, which is what this audience is buying.',
      plan: ['aimy', 'phone', 'meeting'], svc: 'qa', kb: 'kb-icp-qa-ent',
      crit: { industry: ['software', 'industry'], size: ['ent', 'large'], svc: ['qa'] },
    },
    {
      k: 'ams-scrape', name: 'Amsterdam scrape — August', owner: 'engy', assignees: [],
      made: '2026-07-21', from: '2026-08-01', to: '2026-08-31',
      description: 'Everything the August crawl surfaced in Amsterdam over 500 staff. Unqualified on purpose: the point of it is to find out which of them match an ICP.',
      plan: ['aimy'], svc: null, kb: 'kb-scrape-ams',
      crit: { q: 'Amsterdam', src: ['scrape'] },
    },
    {
      k: 'fin-voice', name: 'Financial services — Voice', owner: 'omar', assignees: ['sara'], client: 'kestrel',
      made: '2026-04-18', from: '2026-05-01', to: '2026-08-31',
      description: 'Banks and insurers with contact centres. Voice and CX together; the ICP is explicit that these two are bought by the same person.',
      plan: ['phone', 'meeting'], svc: 'voice', kb: 'kb-icp-voice-fin',
      crit: { industry: ['banking'], svc: ['voice'] },
    },
    {
      k: 'tue-eind', name: 'Eindhoven deep-tech', owner: 'habeba', assignees: [],
      made: '2026-06-19', from: '2026-07-01', to: '2026-10-31',
      description: 'Brainport cluster. Small, technical, and they build their own tooling — the pitch is capacity, not capability.',
      plan: ['physical', 'aimy'], svc: 'dev', kb: null,
      crit: { q: 'Eindhoven' },
    },
    /* A finished one. Its window shut on 15 July, and `campState` reports
       that from the window alone — the `closed` flag is a second way of
       saying the same thing and is only here for a campaign somebody stops
       early. */
    {
      k: 'edu-nl', name: 'Dutch universities', owner: 'sara', assignees: [], client: 'upland',
      made: '2026-03-20', from: '2026-04-01', to: '2026-07-15',
      description: 'Research institutions with student-facing systems. Long cycles, procurement-gated. Kept for the record.',
      plan: ['meeting'], svc: 'dev', kb: null,
      crit: { industry: ['public'] },
    },
    {
      k: 'referral-26', name: 'Referrals 2026', owner: 'nour', assignees: ['omar'],
      made: '2025-12-15', from: '2026-01-01', to: '2026-12-31',
      description: 'Anything that came in through somebody we already work with. No sequence — these are warm and a sequence would insult them.',
      plan: ['phone', 'meeting', 'physical'], svc: null, kb: null,
      crit: { src: ['referral'] },
    },
    /* A DRAFT — no plan, no window. This is what V1 calls a "list", and it
       is the state most campaigns spend their first week in: an audience
       somebody is assembling before anyone has decided how to work it.
       In the fixtures so the draft state is reachable without building one. */
    {
      k: 'strategic-q4', name: 'Strategic Q4', owner: 'nour', assignees: ['omar', 'engy'],
      made: '2026-07-28', from: null, to: null,
      description: 'Accounts worth a partner conversation rather than a sequence. Being assembled by hand; nobody has decided how to work it yet.',
      plan: null, svc: null, kb: null,
      crit: { size: ['ent'] },
    },
  ];

  /* ── What Knowledge holds for Sales ──
     Not a copy of Knowledge's corpus: these are the objects the sales
     copilot RETRIEVES, rendered here as `.type-card.is-compact` with trust
     state unchanged (direction §8.1). Each carries the id it has at home,
     so a correction routes back rather than dying at the product boundary.
     `trust` is Knowledge's, not ours — an expired ICP reads as expired
     here exactly as it does there. */
  const KB = [
    { id: 'kb-icp-qa-ent', type: 'icp', title: 'ICP — QA, enterprise EMEA',
      trust: 'verified', owner: 'ahmed', updated: '2026-07-02',
      summary: '1,000+ staff, in-house QA, regulated or safety-critical delivery. Buying trigger is a release cadence they cannot staff.',
      svc: 'qa', region: 'emea' },
    { id: 'kb-icp-voice-fin', type: 'icp', title: 'ICP — Voice, financial services',
      trust: 'due', owner: 'omar', updated: '2026-04-18', client: 'kestrel',
      summary: 'Banks and insurers running a contact centre over 80 seats. Voice and CX are bought together by the same owner.',
      svc: 'voice', region: 'emea' },
    { id: 'kb-icp-dev-scale', type: 'icp', title: 'ICP — Development, scale-ups',
      trust: 'expired', owner: 'ahmed', updated: '2025-11-20',
      summary: '150–800 staff, product-led, hiring engineers faster than they can onboard them. Last reviewed before the 2026 rate card.',
      svc: 'dev', region: 'global' },
    { id: 'kb-story-upland', type: 'story', title: 'Upland — SARS E-Track and RO modernisation',
      trust: 'verified', owner: 'sara', updated: '2026-06-11', client: 'upland',
      summary: 'Two modernisation programmes: an education solution VB6 → MVC C#/Angular 11 over two years, and web forms → Angular v8/APIs, .NET 4 → 4.8, nine months with eight developers.',
      svc: 'dev', region: 'amer' },
    { id: 'kb-story-qa-cadence', type: 'story', title: 'Release cadence doubled without headcount',
      trust: 'verified', owner: 'ahmed', updated: '2026-05-30',
      summary: 'Regression suite cut from 11 hours to 90 minutes; the client went from monthly to fortnightly releases with the same team.',
      svc: 'qa', region: 'emea' },
    { id: 'kb-deck-qa', type: 'asset', title: 'QA capability deck — 2026',
      trust: 'verified', owner: 'ahmed', updated: '2026-07-21',
      summary: 'Twelve slides. Rate card is slide 9 and is the one that goes out of date.',
      svc: 'qa', region: 'global' },
    { id: 'kb-deck-voice', type: 'asset', title: 'Voice & CX overview',
      trust: 'due', owner: 'omar', updated: '2026-03-02', client: 'kestrel',
      summary: 'Contact-centre offer, seat economics, and the two EMEA references that agreed to be named.',
      svc: 'voice', region: 'emea' },
    { id: 'kb-scrape-ams', type: 'webpage', title: 'Amsterdam crawl — August 2026',
      trust: 'verified', owner: 'engy', updated: '2026-08-01',
      summary: 'Firmographics for 118 Amsterdam-region organisations over 500 staff. Employee counts are estimates and three of them are missing.',
      svc: null, region: 'emea' },
    { id: 'kb-brief-q3', type: 'campaign', title: 'Q3 Netherlands — campaign brief',
      trust: 'verified', owner: 'ahmed', updated: '2026-06-14',
      summary: 'Positioning, sequence copy, objection handling, and the two stories this audience responds to.',
      svc: 'qa', region: 'emea' },
    { id: 'kb-rate-2026', type: 'article', title: 'Rate card 2026 — EMEA',
      trust: 'superseded', owner: 'ahmed', updated: '2026-01-08',
      summary: 'Replaced by the H2 card in June. Still cited by three decks.',
      svc: null, region: 'emea' },
  ];
  const KB_BY = Object.create(null);
  KB.forEach((k) => (KB_BY[k.id] = k));

  /* ═══════════════════════════════════════════════
     BUILDING THE CORPUS

     One function, called once at boot and again by any empty-state trigger
     that needs the fixtures back. Everything downstream reads `DB`, so a
     rebuild is the only way state is ever restored — there is no second
     copy to drift.
  ═══════════════════════════════════════════════ */

  const DB = { acc: [], con: [], touch: [], list: [], task: [], accBy: {}, conBy: {}, touchBy: {}, listBy: {}, campsOf: {}, clientsOf: {}, taskBy: {}, tasksOn: {} };

  function build() {
    const r = rng(20260805);
    DB.acc = [];
    DB.con = [];
    DB.touch = [];
    DB.camp = CAMPAIGNS.map((l) => Object.assign({}, l, {
      assignees: (l.assignees || []).slice(),
      plan: l.plan ? l.plan.slice() : null,
      members: [],
    }));
    const byKey = Object.create(null);
    DB.camp.forEach((l) => (byKey[l.k] = l));
    let tid = 0;

    SEED_ACCOUNTS.forEach((row, i) => {
      const [name, domain, city, emp, founded, industry] = row;
      const id = 'a' + i;

      /* Which of FlairsTech's services this account would buy, and therefore
         which ICP it matches. Derived from industry, not stored twice. */
      const svcPool = {
        banking: ['voice', 'cx', 'qa'], software: ['qa', 'dev', 'analytics'],
        logistics: ['support', 'analytics', 'qa'], health: ['qa', 'support'],
        retail: ['cx', 'support', 'voice'], energy: ['analytics', 'support'],
        public: ['dev', 'qa', 'analytics'], telecom: ['voice', 'cx', 'support'],
        industry: ['qa', 'dev', 'analytics'],
      }[industry] || ['qa'];
      const svc = pick(r, svcPool);

      const acc = {
        id, kind: 'acc', name, domain, city, country: 'Netherlands', region: 'emea',
        emp, founded, industry, svc,
        src: pick(r, ['scrape', 'scrape', 'scrape', 'inbound', 'referral', 'event', 'list']),
        owner: pick(r, SELLERS).id,
        shared: [],
        icp: null,
        next: null,
        outcome: null,
        outcomeWhy: null,
        override: null,
        arch: false,
        /* Enrichment provenance, per field. The table shows it per cell:
           an estimate and a stated fact are not the same number and V1
           printed them identically. */
        /* Revenue, scaled off headcount with real variance by sector — a
           trading firm and a university with the same staff count are not
           the same size of customer. Always an estimate, and the confidence
           says so: nobody publishes this and every provider guesses. */
        rev: emp == null ? null : Math.round(emp * ({
          banking: 380e3, software: 240e3, telecom: 300e3, energy: 520e3,
          retail: 240e3, logistics: 175e3, industry: 270e3, health: 145e3,
          public: 85e3,
        }[industry] || 220e3) * (0.6 + r() * 0.9)),
        enrich: {
          emp: emp == null ? null : { conf: chance(r, 0.55) ? 'high' : 'medium', src: 'AiMY scrape', at: '2026-08-01' },
          founded: founded == null ? null : { conf: 'high', src: 'Company register', at: '2026-08-01' },
          rev: emp == null ? null : { conf: chance(r, 0.3) ? 'medium' : 'low', src: 'Modelled from headcount', at: '2026-08-01' },
        },
      };

      /* List membership. Written onto the LIST, because every operation V1
         has is list-shaped — add these, merge those, who is assigned. */
      const join = (k) => byKey[k].members.push(id);
      if (industry === 'banking' && chance(r, 0.75)) join('fin-voice');
      if (city === 'Amsterdam' && chance(r, 0.7)) join('ams-scrape');
      if (city === 'Eindhoven' || city === 'Veldhoven' || city === 'Helmond') {
        if (chance(r, 0.8)) join('tue-eind');
      }
      if (name.includes('Universit') || name === 'TNO') join('edu-nl');
      if (acc.src === 'referral') join('referral-26');
      if (emp != null && emp >= 1000 && svc === 'qa' && chance(r, 0.8)) join('q3-nl');
      if (emp != null && emp >= 5000 && chance(r, 0.22)) join('strategic-q4');

      /* The matched ICP, and it is Knowledge's object, not ours. */
      if (svc === 'qa' && emp != null && emp >= 1000) acc.icp = 'kb-icp-qa-ent';
      else if (svc === 'voice' && industry === 'banking') acc.icp = 'kb-icp-voice-fin';
      else if (svc === 'dev' && emp != null && emp >= 150 && emp <= 800) acc.icp = 'kb-icp-dev-scale';

      /* Sharing. An edge to a person, exactly like ownership. */
      if (chance(r, 0.18)) {
        const other = pick(r, SELLERS).id;
        if (other !== acc.owner) acc.shared.push(other);
      }

      DB.acc.push(acc);

      /* ── Contacts ── */
      const n = emp == null ? 1 : emp > 20000 ? between(r, 2, 4) : emp > 2000 ? between(r, 1, 3) : between(r, 1, 2);
      const usedRoles = [];
      for (let c = 0; c < n; c++) {
        let role = pick(r, ROLES);
        let guard = 0;
        while (usedRoles.includes(role.t) && guard++ < 8) role = pick(r, ROLES);
        usedRoles.push(role.t);
        const given = pick(r, GIVEN);
        const sur = pick(r, SURNAME);
        const con = {
          id: `${id}c${c}`, kind: 'con', acc: id,
          name: `${given} ${sur}`,
          role: role.t, svc: role.svc,
          email: `${given.toLowerCase()}.${sur.replace(/[^a-z]/gi, '').toLowerCase()}@${domain}`,
          phone: chance(r, 0.62) ? `+31 ${between(r, 20, 79)} ${between(r, 100, 999)} ${between(r, 1000, 9999)}` : null,
          li: chance(r, 0.8) ? `linkedin.com/in/${given.toLowerCase()}-${sur.replace(/[^a-z]/gi, '').toLowerCase()}` : null,
          owner: acc.owner, shared: [],
          next: null, outcome: null, outcomeWhy: null, override: null, arch: false,
          enrich: {
            email: { conf: chance(r, 0.5) ? 'high' : chance(r, 0.6) ? 'medium' : 'low', src: 'AiMY scrape', at: '2026-08-01' },
          },
        };
        DB.con.push(con);
      }
    });

    /* ── Touchpoints ──
       Written per account so the whole spread of statuses is reachable:
       roughly a third untouched (which is what a fresh scrape looks like),
       and the rest distributed across live, cold, stalled and terminal. */
    DB.acc.forEach((acc) => {
      const cons = DB.con.filter((c) => c.acc === acc.id);
      const shape = r();

      if (shape < 0.34) return;                       /* untouched */

      const count = shape < 0.55 ? between(r, 1, 2) : between(r, 3, 9);
      /* When the sequence started, counted back from today. */
      let cursor = between(r, 3, 210);

      /* Only a list with a PLAN can produce a touchpoint — that is what a
         plan is. A list without one is a set somebody is assembling, and
         crediting outreach to it would invent a campaign nobody ran. */
      const running = DB.camp.filter((l) => l.plan && l.plan.length && l.members.includes(acc.id));

      for (let i = 0; i < count; i++) {
        const con = cons.length ? pick(r, cons) : null;
        const camp = running.length ? pick(r, running) : null;
        const inCamp = camp ? camp.k : null;
        const ch = camp ? pick(r, camp.plan) : pick(r, ['phone', 'aimy', 'meeting', 'aimy', 'physical']);
        const auto = ch === 'aimy';
        /* AiMY only ever sends. An inbound reply is a person, on whatever
           channel they chose to reply on. */
        const dir = auto ? 'out' : chance(r, 0.3) ? 'in' : 'out';
        const outcome = auto
          ? pick(r, ['no-answer', 'no-answer', 'no-answer', 'positive', 'bounced', 'neutral'])
          : dir === 'in'
            ? pick(r, ['positive', 'neutral', 'negative', 'meeting-booked'])
            : pick(r, ['positive', 'neutral', 'no-answer', 'meeting-booked', 'negative']);

        DB.touch.push({
          id: 't' + tid++,
          on: con ? con.id : acc.id,
          acc: acc.id,
          ch, dir,
          at: iso(shift(TODAY, -cursor)),
          by: auto ? 'aimy' : acc.owner,
          outcome,
          note: touchNote(ch, dir, outcome, con, acc),
          list: inCamp,
          steps: auto ? autoSteps(acc, con, camp, r) : null,
        });
        cursor -= between(r, 2, 26);
        if (cursor < 0) { cursor = 0; }
      }

      const last = DB.touch.filter((t) => t.acc === acc.id).sort((a, b) => (a.at < b.at ? 1 : -1))[0];
      if (!last) return;

      /* Terminal outcomes. Uncommon, and they end the record's live states. */
      const end = r();
      if (end < 0.07) { acc.outcome = 'won'; return; }
      if (end < 0.12) { acc.outcome = 'lost'; return; }
      if (end < 0.17) {
        acc.outcome = 'not-a-fit';
        acc.outcomeWhy = pick(r, [
          'Runs QA entirely in-house and has just hired for it.',
          'Under 200 staff — below the ICP floor.',
          'Already contracted with a competitor until 2028.',
          'Public tender only; we are not on the framework.',
        ]);
        return;
      }

      /* A next step, on about two-thirds of live records. Some are due, some
         are overdue, some are overdue enough to be stalled.

         IT CANNOT PREDATE THE LAST TOUCHPOINT. A card reading "scoping call
         22 days overdue · met online today" describes a rep who sat in a
         meeting and left the overdue item from before it untouched — which
         is not a state, it is a generator writing two fields that never
         looked at each other. The step is scheduled from the last contact,
         which is when it would really have been agreed. */
      if (chance(r, 0.66)) {
        const since = daysAgo(last.at);
        /* Weighted toward the overdue end. `awaiting-us` is checked before
           `stalled` and steals every candidate whose last touch was inbound,
           so an even spread leaves stalled almost unreachable — one record
           in a corpus of 118, which is a state you cannot look at. */
        const offsets = [-60, -40, -30, -22, -16, -9, -4, -1, 0, 2, 5, 9, 16, 30].filter((o) => -o < since);
        const when = offsets.length ? pick(r, offsets) : pick(r, [2, 5, 9, 16, 30]);
        acc.next = {
          what: pick(r, ['Demo', 'Follow-up call', 'Send the QA deck', 'Scoping call',
            'Intro to the delivery lead', 'Proposal', 'Site visit', 'Reply to their question']),
          due: iso(shift(TODAY, when)),
          by: acc.owner,
        };
      }
    });

    /* Contacts inherit the account's next step only where the touchpoint
       history put it on them — a next step is with a person. */
    DB.con.forEach((con) => {
      const mine = DB.touch.filter((t) => t.on === con.id);
      if (!mine.length) return;
      const acc = DB.acc.find((a) => a.id === con.acc);
      if (acc && acc.next && chance(rng(con.id.length * 977 + mine.length), 0.6)) {
        con.next = acc.next;
      }
    });

    reindex();
    buildTasks();
  }

  /* Tasks are built AFTER `reindex`, because which records a task touches
     comes from its campaign's membership — which does not exist until the
     index does. A crawl belongs to no campaign and touches nothing yet,
     which is not a gap in the model: work that has not started has not
     touched anything, and pretending otherwise would be the first lie the
     task list told. */
  function buildTasks() {
    DB.task = TASKS.map((t) => {
      const camp = t.camp ? DB.campBy[t.camp] : null;
      const members = camp ? camp.members.slice(0, t.take) : [];
      return Object.assign({}, t, {
        at: iso(shift(TODAY, t.at)),
        finished: t.finished != null ? iso(shift(TODAY, t.finished)) : null,
        blocked: t.blocked ? Object.assign({}, t.blocked, { since: iso(shift(TODAY, t.blocked.since)) }) : null,
        on: members,
        kind: t.kind, take: t.take, done: t.done, failed: t.failed,
      });
    });
    /* The record's side of "what is running on me", so a record can say so
       without every record page scanning every task. Shared with the verbs
       in Part C, because a task made at runtime has to land in the same
       indexes as one that was in the fixtures. */
    indexTasks();
  }

  const tasksOn = (rec) => (DB.tasksOn[rec.id] || []).map((id) => DB.taskBy[id]).filter(Boolean);
  const anyTaskFilter = () => !!(S.q || S.tstate.length || S.kind.length || S.started.length || S.campaign.length || S.client.length);

  /* Tasks run through their own filter rather than being bent through the
     lead one. The axes genuinely differ — a task has no industry and a lead
     has no progress — and a single predicate that served both would be a
     predicate with two halves that never run together. */
  function filteredTasks(opts) {
    const skipEnt = !!(opts && opts.all);
    const q = S.q.trim().toLowerCase();
    return DB.task.filter((t) => {
      if (!skipEnt && !entitledTask(t)) return false;
      if (S.tstate.length && !S.tstate.includes(taskState(t))) return false;
      if (S.kind.length && !S.kind.includes(t.kind)) return false;
      if (S.started.length && !S.started.includes(t.by)) return false;
      if (S.campaign.length && !(t.camp && S.campaign.includes(t.camp))) return false;
      if (S.client.length) {
        const c = t.camp && DB.campBy[t.camp] ? DB.campBy[t.camp].client : null;
        if (!S.client.some((k) => (k === 'own' ? !c : c === k))) return false;
      }
      /* `started` is the task's owner axis, and it carries the same two
         scope values the lead axis does. */
      if (!ownerMatch(S.started, null, t.by)) return false;
      if (q && !`${t.title} ${TASK_KIND[t.kind].label} ${actor(t.by).name} ${t.camp ? campName(t.camp) : ''}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }

  /* ── CAMPAIGNS ARE A RECORD TYPE, WITH A LIST OF THEIR OWN ──

     Pass 3 ruled that a campaign is a filter plus a sheet, and that a second
     view mode would be a second place the same set is described. That ruling
     is reversed here, for a reason the ruling could not have seen: with no
     list, "how do I know a campaign was built?" has **no answer by looking**.
     You could create one and there was nowhere to go and see it. A primitive
     the product is organised around has to be somewhere.

     It is the same shape `?on=tasks` already is, so this fills in a pattern
     rather than inventing one. */
  function filteredCampaigns(opts) {
    const skipEnt = !!(opts && opts.all);
    const q = S.q.trim().toLowerCase();
    return DB.camp.filter((c) => {
      /* A CAMPAIGN BELONGS TO AN ENGAGEMENT, NOT TO ITS MEMBERS.

         The first version let any single entitled member expose the whole
         campaign — and measured, that showed Marit **6 of 7 campaigns**,
         each captioned with its full size. A campaign of 24 accounts of
         which one is hers would have told her the other 23 exist, which is
         exactly what the clean-scoping ruling removed from everywhere else.

         A client sees the campaigns run FOR them. Everyone internal is
         bounded by the accounts inside, as they are everywhere else. */
      if (!skipEnt) {
        const w = me();
        if (w.tier === 'client') { if (c.client !== w.client) return false; }
        else if (w.tier !== 'admin' && w.tier !== 'stakeholder'
          && !c.members.some((m) => DB.accBy[m] && entitled(DB.accBy[m]))) return false;
      }
      if (S.tstate.length && !S.tstate.includes(campState(c))) return false;
      if (!ownerMatch(S.owner, null, c.owner)) return false;
      if (S.client.length && !S.client.some((k) => (k === 'own' ? !c.client : c.client === k))) return false;

      if (q && !`${c.name} ${c.description || ''} ${actor(c.owner).name}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }

  /* Running first, then what has not started, then what is over — the same
     "what costs me to ignore" order the other two lists use. */
  const CAMP_URGENCY = ['running', 'draft', 'finished'];

  function campCard(c, i) {
    const st = campState(c);
    /* Only the members the looker may see. Counting all of them would state
       the size of somebody else's book on the face of a card. */
    const members = maySee(c.members.map((m) => DB.accBy[m]).filter(Boolean));
    const by = {};
    members.forEach((a) => (by[statusOf(a)] = (by[statusOf(a)] || 0) + 1));
    /* The same distribution the sheet draws, at card scale — so the shape of
       a campaign is legible from the list without opening it. */
    const bars = TAX.status.filter((s) => by[s.k]).slice(0, 4);
    const meta = [
      `<span class="s-meta-st tone-${esc(CAMP_STATE[st].tone)}">${esc(CAMP_STATE[st].label)}</span>`,
      esc(plural(members.length, 'account')),
      esc(actor(c.owner).name),
      c.client ? esc(clientName(c.client)) : 'our own book',
    ];
    return `<article class="type-card s-card s-camp-card st-${esc(CAMP_STATE[st].tone)}" style="--i:${i || 0}" data-row="${esc(c.k)}">
      <div class="tc-head"><span class="tc-type">Campaign</span></div>
      <button class="tc-title s-card-title" type="button" data-camp="${esc(c.k)}">${esc(c.name)}</button>
      <p class="tc-summary s-card-snip">${esc(c.description || 'No description.')}</p>
      ${members.length ? `<div class="s-camp-dist" role="img" aria-label="${esc(bars.map((s) => `${by[s.k]} ${s.label.toLowerCase()}`).join(', '))}">
        ${bars.map((s) => `<span class="s-camp-seg tone-${esc(s.tone)}" style="width:${Math.round((by[s.k] / members.length) * 100)}%"></span>`).join('')}
      </div>` : ''}
      <div class="tc-gov s-card-meta">${meta.join('<span class="tc-gov-sep"> · </span>')}</div>
    </article>`;
  }

  function personCard(p, i) {
    const st = standing(p.id);
    const bars = TAX.status.filter((s) => st.by[s.k]).slice(0, 4);
    /* The card leads with the number a manager is actually scanning for.
       "Waiting on a person" is the one that costs money today; a book size
       on its own says how busy somebody looks, not whether anything is
       going wrong. */
    const tone = st.waiting > 5 ? 'err' : st.waiting ? 'warn' : 'ok';
    const meta = [
      `<span class="s-meta-st tone-${esc(tone)}">${st.waiting ? esc(plural(st.waiting, 'account')) + ' waiting' : 'nothing waiting'}</span>`,
      st.overdue ? `<span class="s-meta-due">${esc(plural(st.overdue, 'next step'))} overdue</span>` : 'nothing overdue',
      st.untouched ? `${st.untouched} never touched` : 'all touched',
      st.last ? `last moved ${esc(fmtAgo(st.last.at))}` : 'no touchpoint yet',
    ];
    return `<article class="type-card s-card s-person-card st-${esc(tone)}" style="--i:${i || 0}" data-row="${esc(p.id)}">
      <div class="tc-head"><span class="tc-type"><span class="avatar avatar-sm">${esc(p.initials)}</span>${esc(p.role)}</span></div>
      ${/* The title goes to their leads, not to a person page — there is no
            such thing here, and a manager clicking a name means "show me
            their work". Same rule as every other control: it lands where
            its label says. */ ''}
      <button class="tc-title s-card-title" type="button" data-quick2="on=accounts&owner=${esc(p.id)}&camp=">${esc(p.name)}</button>
      <p class="tc-summary s-card-snip">${esc(plural(st.book, 'account'))} in their book</p>
      ${st.book ? `<div class="s-camp-dist" role="img" aria-label="${esc(bars.map((s) => `${st.by[s.k]} ${s.label.toLowerCase()}`).join(', '))}">
        ${bars.map((s) => `<span class="s-camp-seg tone-${esc(s.tone)}" style="width:${Math.round((st.by[s.k] / st.book) * 100)}%"></span>`).join('')}
      </div>` : ''}
      <div class="tc-gov s-card-meta">${meta.join('<span class="tc-gov-sep"> · </span>')}</div>
    </article>`;
  }

  /* Ordered by what it costs to ignore, exactly as leads are. A blocked task
     is the only one on this list that is costing something right now. */
  const TASK_URGENCY = ['needs-you', 'running', 'queued', 'paused', 'failed', 'done'];
  function orderedTasks(list) {
    return list.slice().sort((a, b) => {
      const d = TASK_URGENCY.indexOf(taskState(a)) - TASK_URGENCY.indexOf(taskState(b));
      if (d) return d;
      return a.at < b.at ? 1 : -1;
    });
  }

  function orderedCamps(list) {
    return list.slice().sort((a, b) => {
      const d = CAMP_URGENCY.indexOf(campState(a)) - CAMP_URGENCY.indexOf(campState(b));
      if (d) return d;
      return (a.from || '') < (b.from || '') ? 1 : -1;
    });
  }

  /* ═══════════════════════════════════════════════
     THE TEAM — people as records

     The roadmap asks for "observability for others and managers", and until
     this pass the answer was a filter: narrow the Owner axis to one person
     and read their leads. That is observability of RECORDS, not of people.
     Measured as the one manager in this corpus, answering "how is each of my
     people doing" took four filter changes and compared nothing — while the
     numbers sat one query away: Habeba on 23 leads and 7 waiting, against
     Engy on 10 and 3. Twice the book and twice the backlog, and no surface
     said so.

     A person is a record here for the same reason a campaign is: it has a
     state you can compute, a set it holds, and a thing you do about it.

     WHO GETS IT is the load-bearing part. Only tiers whose entitlement
     actually covers other people's work — a rep sees their own leads plus
     shared plus campaign-mates, so a peer's card would show three of
     Habeba's twenty-three and label it her book. That is a lie by omission
     and exactly what `tier-audit` exists to catch, so the tab does not
     render for them at all rather than rendering wrong.
  ═══════════════════════════════════════════════ */
  const seesOthers = () => ['admin', 'manager', 'stakeholder'].includes(me().tier);

  /* Their book, and what is wrong with it — every number bounded by what the
     LOOKER may see, never by what the person owns. A manager who cannot see
     one of Habeba's accounts must not be told it exists by a count. */
  function standing(id) {
    /* ACCOUNTS ONLY, because that is what the card's click delivers.
       Counting accounts AND contacts made the card say "73 leads, 17
       waiting" over a link that landed on "23 accounts, 7 waiting" — the
       number you press has to be the number you get, or the board is
       teaching you to distrust it on the first click.

       Nothing is lost by leaving contacts out: an account's status is
       computed from the touchpoints of its people, so a person-level
       backlog already shows in the account that holds them. */
    const mine = maySee(DB.acc).filter((r) => r.owner === id && !r.arch);
    const by = {};
    mine.forEach((r) => (by[statusOf(r)] = (by[statusOf(r)] || 0) + 1));
    const last = maySeeTouch(DB.touch)
      .filter((t) => t.by === id)
      .sort((a, b) => (a.at < b.at ? 1 : -1))[0];
    return {
      book: mine.length,
      /* The same pair the result line counts, so the two agree by
         construction rather than by two people writing the same rule. */
      waiting: mine.filter((r) => ['awaiting-us', 'stalled'].includes(statusOf(r))).length,
      overdue: mine.filter((r) => r.next && daysAgo(r.next.due) > 0).length,
      untouched: mine.filter((r) => statusOf(r) === 'untouched').length,
      last,
      by,
      recs: mine,
    };
  }

  function filteredTeam(opts) {
    const skipEnt = !!(opts && opts.all);
    if (!skipEnt && !seesOthers()) return [];
    const w = me();
    const q = S.q.trim().toLowerCase();
    /* A manager's team is their team. An admin or stakeholder has no team in
       `TEAMS` and sees everything, so theirs is everyone who owns work —
       one rule said two ways: the people whose work you are entitled to. */
    const pool = teamName(w.id)
      ? SELLERS.filter((p) => teamOf(w.id).has(p.id))
      : SELLERS.slice();
    return pool.filter((p) => {
      if (q && !`${p.name} ${p.role}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }

  /* Ordered by what is waiting, not by name. The same "what costs me to
     ignore" rule the other three lists follow — a team board sorted
     alphabetically makes you read all of it to find the one that matters. */
  function orderedTeam(list) {
    return list.slice().sort((a, b) => {
      const A = standing(a.id), B = standing(b.id);
      return (B.waiting - A.waiting) || (B.overdue - A.overdue) || (B.book - A.book);
    });
  }

  function reindex() {
    DB.accBy = Object.create(null);
    DB.conBy = Object.create(null);
    DB.touchBy = Object.create(null);
    DB.campBy = Object.create(null);
    DB.campsOf = Object.create(null);
    DB.acc.forEach((a) => (DB.accBy[a.id] = a));
    DB.con.forEach((c) => (DB.conBy[c.id] = c));
    DB.touch.forEach((t) => {
      (DB.touchBy[t.acc] || (DB.touchBy[t.acc] = [])).push(t);
    });
    for (const k of Object.keys(DB.touchBy)) DB.touchBy[k].sort((a, b) => (a.at < b.at ? 1 : -1));

    /* The record's side of membership, derived. Membership is stored once,
       on the list; this is a read index, never written to directly, so the
       two can never disagree.

       A contact belongs to whatever its ACCOUNT belongs to. Lists are
       assembled at account level here — you target a company and then find
       the people in it — and a contact that dropped out of its account's
       list would be a contact nobody could explain. */
    DB.camp.forEach((l) => {
      DB.campBy[l.k] = l;
      l.members.forEach((id) => {
        (DB.campsOf[id] || (DB.campsOf[id] = [])).push(l.k);
      });
    });
    DB.con.forEach((c) => {
      const up = DB.campsOf[c.acc];
      if (up) DB.campsOf[c.id] = up.slice();
    });

    /* The client index, derived from the campaign index rather than from
       membership again — a lead is in an engagement because it is in a
       campaign that belongs to one, and deriving it twice from the source
       would let the two disagree about a campaign whose client changed. */
    DB.clientsOf = Object.create(null);
    for (const id of Object.keys(DB.campsOf)) {
      const cs = DB.campsOf[id].map((k) => DB.campBy[k] && DB.campBy[k].client).filter(Boolean);
      if (cs.length) DB.clientsOf[id] = [...new Set(cs)];
    }
  }

  /* Every read of "which campaigns is this in" goes through here. */
  const campsOf = (rec) => DB.campsOf[rec.id] || [];
  const campName = (k) => (DB.campBy[k] ? DB.campBy[k].name : k);
  const clientsOf = (rec) => DB.clientsOf[rec.id] || [];

  /* Used by the rep tier: a lead you do not own but are working anyway,
     because you are on the campaign it is in. Without this a BDR loses sight
     of the audience they were assigned to the moment somebody else owns a
     row in it, which is the campaign working against the person running it. */
  function onACampaignWith(rec, id) {
    return campsOf(rec).some((k) => {
      const c = DB.campBy[k];
      return c && (c.owner === id || (c.assignees || []).includes(id));
    });
  }

  /* ── A campaign's state, computed ──

     V1 calls the same object two things: the dialog is headed "Add Contacts
     to Strategic Q4" and the warning inside it reads "5 contacts already
     exist in the target campaign". It is one object and nobody settled the
     word. The epic settles it — campaign — and what V1 calls a "list" is a
     campaign nobody has started yet.

     So DRAFT IS A STATE, NOT A SECOND NOUN. And it is computed from what the
     record holds, like every other status here: no plan means nobody has
     decided how to work it, and past its window means it is done. There is
     no field somebody has to remember to set. */
  function campState(c) {
    if (!c) return 'draft';
    if (!c.plan || !c.plan.length) return 'draft';
    if (c.closed || (c.to && daysAgo(c.to) > 0)) return 'finished';
    return 'running';
  }
  const CAMP_STATE = {
    draft:    { label: 'Draft',    tone: 'neutral', note: 'Nothing sends until it is started.' },
    running:  { label: 'Running',  tone: 'ok',      note: 'Working its audience now.' },
    finished: { label: 'Finished', tone: 'neutral', note: 'Past its window. Kept for the record.' },
  };

  /* What a touchpoint says it was. Written from the channel, the direction
     and the outcome rather than picked from a bag of sentences, so the note
     can never contradict the fields beside it. */
  function touchNote(ch, dir, outcome, con, acc) {
    const who = con ? con.name.split(' ')[0] : acc.name;
    if (ch === 'aimy') {
      if (outcome === 'bounced') return `Address rejected the message. Nothing was delivered.`;
      if (outcome === 'positive') return `${who} replied and asked what a pilot would look like.`;
      if (outcome === 'neutral') return `${who} replied: not now, try after the year end.`;
      return `Sequence step sent. No reply yet.`;
    }
    if (dir === 'in') {
      if (outcome === 'meeting-booked') return `${who} came back and picked a slot.`;
      if (outcome === 'positive') return `${who} asked for the QA deck and a reference.`;
      if (outcome === 'negative') return `${who} says the budget is committed for this year.`;
      return `${who} acknowledged, no commitment either way.`;
    }
    if (outcome === 'no-answer') return ch === 'phone' ? `No answer, left a voicemail.` : `They did not attend.`;
    if (outcome === 'meeting-booked') return `Booked a scoping call for the following week.`;
    if (outcome === 'positive') return `Good conversation — they have a release cadence they cannot staff.`;
    if (outcome === 'negative') return `Not interested at the moment; asked us not to chase before Q1.`;
    return `Introduced FlairsTech and what we do. Nothing decided.`;
  }

  /* AiMY's reasoning trace. Glass box, not black box: the rep can see what
     it did and why, which is the only thing that makes an automatic
     touchpoint acceptable in a record a person is accountable for. */
  function autoSteps(acc, con, list, r) {
    const steps = [
      /* A step that did not succeed does not get a tick. The first version
         put one beside "no ICP matched", which is a trace agreeing with
         itself rather than reporting. */
      { t: 'Matched against the ICP', d: acc.icp ? KB_BY[acc.icp].title : 'No ICP matched — sent on list membership alone', ok: !!acc.icp },
      { t: 'Pulled the campaign brief', d: list ? list.name : 'No campaign', ok: !!list },
      { t: 'Chose the story', d: acc.svc === 'qa' ? 'Release cadence doubled without headcount' : 'Upland — SARS E-Track and RO modernisation', ok: true },
      { t: 'Composed and sent', d: con ? `To ${con.name}, ${con.role}` : `To the account, no named contact`, ok: !!con },
    ];
    if (chance(r, 0.2)) steps.push({ t: 'Held back a second step', d: 'Two sends in one week is the cap for this campaign', ok: true });
    return steps;
  }

  /* ═══════════════════════════════════════════════
     TASKS — AiMY's work while it is still happening

     The roadmap puts "observing the long running tasks" on the SOFTWARE half
     of V3, beside the list and the table — so a task is a record type here,
     at `?on=tasks`, and it reuses the table, the cards, the filters, the
     pager, the column manager and the URL. A bespoke panel would have been
     a second way to look at a set of things, built next to the one that
     already works.

     WHY THIS HAS TO EXIST AT ALL. Everything AiMY did in this corpus was
     history — a touchpoint with a date in the past. Nothing was ever
     in-flight, which meant the surface could report what had happened and
     never what was happening. A sales floor where forty emails are going out
     over three days needs the second one, and the moment it needs a decision
     it needs it urgently.
  ═══════════════════════════════════════════════ */

  /* `at` is days from today, negative for the past. Written relative so the
     corpus does not go stale against `TODAY`, the same way the touchpoints
     are. `take` is how many of the campaign's members it addresses. */
  const TASKS = [
    { id: 'tk-q3', kind: 'send', camp: 'q3-nl', by: 'ahmed', at: -2,
      title: 'First touch across Q3 Netherlands',
      take: 42, done: 18, failed: 2, wrote: true,
      next: 'the next twelve, tomorrow morning' },

    { id: 'tk-enrich-fin', kind: 'enrich', camp: 'fin-voice', by: 'omar', at: -1,
      title: 'Fill in the missing contact details on Financial services',
      take: 12, done: 9, failed: 0, wrote: false,
      blocked: { why: 'Three of them returned two plausible addresses each. Picking one is a judgement about a person, not a confidence score.', since: -1 } },

    { id: 'tk-scrape-rot', kind: 'scrape', camp: null, by: 'engy', at: 0,
      title: 'Crawl Rotterdam, 500+ staff',
      take: 0, done: 0, failed: 0, wrote: false,
      next: 'starts when the Amsterdam crawl finishes' },

    { id: 'tk-sched-edu', kind: 'schedule', camp: 'edu-nl', by: 'sara', at: -4,
      title: 'Find a slot with four universities',
      take: 4, done: 2, failed: 0, wrote: true,
      blocked: { why: 'Wageningen came back with a conflict and proposed two alternatives. Neither is inside the window you gave.', since: -1 } },

    { id: 'tk-voice-send', kind: 'send', camp: 'fin-voice', by: 'omar', at: -9,
      title: 'Voice & CX overview to the banks',
      take: 16, done: 14, failed: 2, wrote: true, finished: -6 },

    { id: 'tk-eind', kind: 'send', camp: 'tue-eind', by: 'habeba', at: -5,
      title: 'Eindhoven deep-tech, first sequence step',
      take: 9, done: 3, failed: 0, wrote: true, paused: true,
      pausedWhy: 'Held while the rate card is re-checked' },

    { id: 'tk-scrape-bru', kind: 'scrape', camp: null, by: 'engy', at: -3,
      title: 'Crawl Brussels, 500+ staff',
      take: 0, done: 0, failed: 1, wrote: false, finished: -3,
      failWhy: 'The source refused the request rate and then refused the session. Nothing was collected.' },

    { id: 'tk-prep-upl', kind: 'prepare', camp: 'edu-nl', by: 'sara', at: -1,
      title: 'Draft a proposal for Eindhoven University of Technology',
      take: 1, done: 1, failed: 0, wrote: false, finished: -1 },
  ];

  /* ── A task's state, computed ──

     Same thesis as a lead's status and for the same reason: a field somebody
     has to remember to set is a field that goes stale, and a task nobody
     updated is exactly the task you most need the truth about.

     FIRST THAT APPLIES WINS, and the order is the rule. Blocked outranks
     everything because it is the only state where the task is waiting on a
     person — which is the only state that costs anything to leave sitting. */
  function taskState(t) {
    if (t.blocked) return 'needs-you';
    if (t.paused) return 'paused';
    if (t.finished != null) return t.failed && !t.done ? 'failed' : 'done';
    if (t.done + t.failed >= t.take && t.take > 0) return 'done';
    if (t.done > 0) return 'running';
    return 'queued';
  }

  const TASK_STATE = {
    'queued':    { label: 'Queued',    tone: 'neutral', exit: null },
    'running':   { label: 'Running',   tone: 'ok',      exit: null },
    'needs-you': { label: 'Needs you', tone: 'err',     exit: 'Decide' },
    'paused':    { label: 'Paused',    tone: 'warn',    exit: null },
    'done':      { label: 'Done',      tone: 'neutral', exit: null },
    'failed':    { label: 'Failed',    tone: 'err',     exit: null },
  };

  /* `past` is declared rather than built from `verb + "ed"`, which produced
     "scheduleed" and "prepareed" the moment it met a verb ending in e. A
     rule that works for two of five words is not a rule. */
  const TASK_KIND = {
    send:     { label: 'Sending',    past: 'sent to' },
    enrich:   { label: 'Enriching',  past: 'enriched' },
    scrape:   { label: 'Crawling',   past: 'crawled' },
    schedule: { label: 'Scheduling', past: 'scheduled' },
    prepare:  { label: 'Preparing',  past: 'prepared' },
  };

  /* THE SAME CTA RULE THE CARDS FOLLOW. A task row opens the task, and the
     task holds stop, pause and undo — so a button repeating any of those
     would be a button that duplicates its own container, which is what 89 of
     them were doing on the lead cards before the last pass removed them.

     `needs-you` is the exception, and it is the same exception `going-cold`
     is: the decision needs the evidence beside it, so it opens in the canvas,
     which is somewhere the row click does not go. */
  function taskExit(t) {
    const st = taskState(t);
    return TASK_STATE[st].exit ? { k: st, label: TASK_STATE[st].exit } : null;
  }

  /* A task is visible if you may see something it touches. Reusing the lead
     rule rather than inventing a task rule means a client sees the work
     running on their engagement and nothing else, and it means the two can
     never disagree about the same record.

     A task that touches nothing yet — a crawl that has not found anybody —
     falls back to who started it, because there is no record to ask. */
  function entitledTask(t) {
    if (TIERS[me().tier].sees === TIERS.admin.sees) return true;
    const on = tasksRecords(t);
    if (on.length) return on.some((r) => entitled(r));
    return t.by === me().id || teamOf(me().id).has(t.by);
  }

  const tasksRecords = (t) => (t.on || []).map((id) => DB.accBy[id] || DB.conBy[id]).filter(Boolean);

  /* ═══════════════════════════════════════════════
     STATUS — computed, never attested

     There is no stage field. Every status is derived from what the record
     already holds, and THE FIRST THAT APPLIES IS THE ONE SHOWN — the order
     below is the whole of the rule.

     Order matters and is argued, not arbitrary:

       · A terminal outcome ends the live states. Somebody recorded it.
       · No touchpoint at all is the honest first thing to say about a lead
         that came out of a scrape ten minutes ago.
       · THEY SPOKE LAST outranks everything else that is still live. A
         reply nobody answered is the most expensive thing on this surface,
         and it stays "awaiting us" whether it arrived yesterday or in May —
         going cold would describe it as our patience running out rather
         than our not having answered.
       · Stalled sits above the ordinary due case because two weeks past a
         date is a different problem from today's list.
  ═══════════════════════════════════════════════ */

  const STALL_DAYS = 14;
  const COLD_DAYS = 30;

  function touchesFor(rec) {
    if (rec.kind === 'acc') return DB.touchBy[rec.id] || [];
    return (DB.touchBy[rec.acc] || []).filter((t) => t.on === rec.id);
  }

  function statusOf(rec) {
    if (rec.override) return rec.override.v;
    return computedStatus(rec);
  }

  /* The three that are endings rather than live states. `computedStatus`
     reads them straight off the record, so setting one is recording a fact —
     which is why the override surface writes `outcome` for these and
     `override` for everything else. */
  const ENDINGS = ['won', 'lost', 'not-a-fit'];

  function computedStatus(rec) {
    if (rec.outcome) return rec.outcome;                  /* won · lost · not-a-fit */

    /* A terminal outcome is about the DEAL, and the deal is the account. So
       it settles every contact inside it too: without this, the four people
       at an account we won last month each read "going cold", which is both
       false and the kind of false a rep would act on. */
    if (rec.kind === 'con') {
      const acc = DB.accBy[rec.acc];
      if (acc && acc.outcome) return acc.outcome;
    }

    const ts = touchesFor(rec);
    if (!ts.length) return 'untouched';

    const last = ts[0];
    if (last.dir === 'in') return 'awaiting-us';

    const next = rec.next;
    if (next) {
      const over = daysAgo(next.due);
      if (over > STALL_DAYS) return 'stalled';
      if (over >= 0) return 'awaiting-us';
    }

    /* Going cold is silence with NOTHING SCHEDULED TO BREAK IT. Anything
       still due was caught above (overdue by more than a fortnight is
       stalled; due or overdue is ours), so a `next` surviving to here is in
       the future — and a record somebody has planned the next move on is
       not drifting, however long the gap behind it. Without this clause a
       lead read "going cold — nothing scheduled" directly above the
       proposal it had scheduled for a fortnight's time. */
    if (!next && daysAgo(last.at) > COLD_DAYS) return 'going-cold';
    return 'awaiting-them';
  }

  /* The exit is the action the badge implies, so the card offers that rather
     than a vocabulary of its own. `not-a-fit` with a reason already recorded
     has nothing left to ask. */
  /* The exit as a CONTROL. Returns null whenever the exit is "open the
     record", because the card and the row already do that — a button whose
     only job is what its own container does is noise, and there were a
     hundred of them. */
  function exitFor(rec) {
    const s = statusOf(rec);
    const row = BY.status[s];
    if (!row || !row.exit || row.opens === 'record') return null;
    if (s === 'not-a-fit' && rec.outcomeWhy) return null;
    return { k: s, label: row.exit, mode: row.mode };
  }

  /* Tone is colour AND text, never colour alone. */
  const toneOf = (s) => (BY.status[s] ? BY.status[s].tone : 'neutral');

  /* ═══════════════════════════════════════════════
     THE GRAPH

     Every record carries typed edges — to an owner, the people it is shared
     with, its lists, its industry, its region, its source, its matched ICP,
     and (for a contact) its account. The peek opens one of them in place;
     the answers walk them.

     Declared as data rather than as a switch statement, because the peek,
     the answers and the filter row all need the same list, and a second copy
     of it is a second copy that drifts.
  ═══════════════════════════════════════════════ */

  const EDGES = [
    { k: 'campaign', label: 'Campaign',  many: true,  of: (rec) => campsOf(rec),             name: (v) => campName(v) },
    { k: 'owner',    label: 'Owner',     many: false, of: (rec) => rec.owner,                name: (v) => actor(v).name },
    { k: 'industry', label: 'Industry',  many: false, of: (rec) => accOf(rec).industry,      name: (v) => label('industry', v) },
    { k: 'region',   label: 'Region',    many: false, of: (rec) => accOf(rec).region,        name: (v) => label('region', v) },
    { k: 'status',   label: 'Status',    many: false, of: (rec) => statusOf(rec),            name: (v) => label('status', v) },
    { k: 'src',      label: 'Source',    many: false, of: (rec) => accOf(rec).src,           name: (v) => label('src', v) },
    { k: 'icp',      label: 'ICP',       many: false, of: (rec) => accOf(rec).icp,           name: (v) => (KB_BY[v] ? KB_BY[v].title : 'No ICP matched') },
    { k: 'acc',      label: 'Account',   many: false, of: (rec) => (rec.kind === 'con' ? rec.acc : null), name: (v) => (DB.accBy[v] ? DB.accBy[v].name : v) },
  ];

  const accOf = (rec) => (rec.kind === 'acc' ? rec : DB.accBy[rec.acc] || rec);

  /* ═══════════════════════════════════════════════
     STATE — the URL, and nothing else

     Every key here is readable and writable. Commas are left unencoded on
     purpose: a filter URL is meant to be read and pasted as well as
     generated.
  ═══════════════════════════════════════════════ */

  /* Multi-value axes are comma lists; single-value ones are scalars. The
     distinction is declared here so `parse` and `write` cannot disagree
     about which is which. */
  const MULTI = ['status', 'campaign', 'channel', 'industry', 'region', 'size', 'rev', 'title',
    'src', 'owner', 'shared', 'icp', 'svc', 'client', 'kind', 'tstate', 'started', 'inc', 'exc', 'cols', 'ids'];
  /* `scope` replaces the old `mine=1`. A boolean could say "mine" and "not
     mine", and the third thing a person actually asks for — my team — has no
     room in a boolean, which is why it was missing. */
  const SCALAR = ['q', 'on', 'view', 'talk', 'touched', 'due', 'as', 'archived',
    'lead', 'camp', 'state', 'page', 'per', 'task',
    /* `in` — WHAT YOU ARE NARROWING INSIDE THE OPEN THING.
       Deliberately NOT `status`. Reusing `status` here made one key mean two
       things: inside a campaign it narrowed the campaign, and the moment you
       walked out it became a corpus filter — so closing a campaign landed you
       on `?status=untouched&on=campaigns`, a chip claiming to filter a list it
       does not apply to, and your original corpus filter silently rewritten by
       a click you made somewhere else.

       Two views, two keys. `status` is the corpus; `in` is the thing you
       opened. `in` is cleared on the way in and on the way out, because a
       narrowing belongs to the scope it was made in. */
    'in'];

  /* Values that write nothing, because they are what you get without asking.
     A URL that carries its own defaults is a URL nobody can read. */
  const DEFAULTS = { on: 'accounts', view: 'cards' };

  /* `?v=` off this file's own <script src>. `document.currentScript` is null
     by the time a callback runs, so it is read at parse time. */
  const BUILD = (() => {
    const me = document.currentScript
      || [...document.querySelectorAll('script[src*="sales.js"]')].pop();
    const m = me && me.src.match(/[?&]v=([^&]+)/);
    return m ? 'v' + m[1] : 'unstamped';
  })();

  const S = {};

  function parse() {
    const p = new URLSearchParams(location.search);
    for (const k of MULTI) {
      const v = p.get(k);
      S[k] = v ? v.split(',').map((x) => x.trim()).filter(Boolean) : [];
    }
    for (const k of SCALAR) S[k] = p.get(k) || '';
    for (const k of Object.keys(DEFAULTS)) if (!S[k]) S[k] = DEFAULTS[k];
    return S;
  }

  function qs(over) {
    const next = Object.assign({}, S, over || {});
    const parts = [];
    for (const k of MULTI) {
      const v = next[k];
      if (v && v.length) parts.push(`${k}=${v.join(',')}`);
    }
    for (const k of SCALAR) {
      const v = next[k];
      if (v && v !== DEFAULTS[k]) parts.push(`${k}=${encodeURIComponent(v)}`);
    }
    return parts.length ? '?' + parts.join('&') : location.pathname;
  }

  /* One way in and one way out. Every navigation on this surface goes
     through `go`, so there is exactly one place that writes history and one
     place that repaints. `paint` is a hoisted declaration further down. */
  function go(over, replace) {
    /* Any change that is not itself a page change sends you back to page
       one. Filtering from page 3 to a set with two pages otherwise lands on
       a page that no longer exists — and worse, one that does exist but
       holds different records than the ones you were reading. */
    const KEEPS_PAGE = ['per', 'talk', 'cols', 'camp'];
    if (over && !('page' in over) && Object.keys(over).some((k) => !KEEPS_PAGE.includes(k))) {
      over = Object.assign({}, over, { page: '' });
    }
    const url = qs(over);
    if (replace) history.replaceState(null, '', url);
    else history.pushState(null, '', url);
    parse();
    /* Who is looking is chrome, and it changes what the body says — so when
       `as` moves, the chrome has to move with it. It used to be repainted
       only by the handlers that knew they had changed it, which meant the
       pill kept naming the previous person while the count beneath it had
       already changed. A stale identity beside a fresh count is the exact
       thing the disclosure exists to prevent. */
    if ('as' in (over || {})) paintChrome();
    else paintWho();
    paint();
    paintContext();
  }

  /* Expose the pieces the rest of the file (and the console, while this is a
     prototype) needs. Nothing here is a second source of truth: every one of
     these reads DB or S. */
  const SALES = {
    $, $$, esc, TAX, BY, label, REPS, REP, AIMY, actor, me, KB, KB_BY, DB, EDGES,
    TODAY, fmtDate, fmtAgo, fmtIn, fmtSize, plural, daysAgo, iso, shift, rng,
    statusOf, computedStatus, exitFor, toneOf, touchesFor, accOf, campName,
    TIERS, TEAMS, CLIENTS,
    TASK_STATE, TASK_KIND, taskState, taskExit, filteredTasks, tasksOn,
    /* Getters, not values. This literal is evaluated before `entitled`,
       `canWrite` and `clientsOf` are — they are const arrows declared
       further down — and naming them directly threw on load with
       "cannot access before initialization". Everything else here is either
       a hoisted function or declared above this point. */
    filtered, openRec,
    get entitled() { return entitled; },
    get canWrite() { return canWrite; },
    get clientsOf() { return clientsOf; },
    get maySee() { return maySee; },
    get maySeeTouch() { return maySeeTouch; },
    get disclosure() { return disclosure; },
    get filteredCampaigns() { return filteredCampaigns; },
    get filteredTeam() { return filteredTeam; },
    get standing() { return standing; },
    get seesOthers() { return seesOthers; },
    S, parse, qs, go, build, reindex, MULTI, SCALAR, DEFAULTS,
    STALL_DAYS, COLD_DAYS,
  };
  window.SALES = SALES;

  /* ═══════════════════════════════════════════════
     FILTERING

     One pass over the corpus. Every predicate reads S and nothing else, so
     there is no filter that a URL cannot express and none that the chip bar
     cannot show.
  ═══════════════════════════════════════════════ */

  const sizeBand = (n) => {
    if (n == null) return null;
    const row = TAX.size.find((b) => n >= b.lo && n <= b.hi);
    return row ? row.k : null;
  };
  const revBand = (n) => {
    if (n == null) return null;
    const row = TAX.rev.find((b) => n >= b.lo && n < b.hi);
    return row ? row.k : null;
  };

  /* Every job title in the corpus, once. The axis is built from the data
     rather than declared, so a title nobody holds is never offered. */
  const TITLES = [...new Set(ROLES.map((r) => r.t))].sort();

  /* Titles held at an account — the account's side of the contact's title.
     V1's example ("companies with an IT Support Manager") is an account
     query answered from contact data. */
  function titlesAt(rec) {
    if (rec.kind === 'con') return [rec.role];
    return DB.con.filter((c) => c.acc === rec.id).map((c) => c.role);
  }

  /* Everything a free-text term can match. Used by include, exclude and the
     plain search, so all three agree about what a word can hit. */
  function haystack(rec) {
    const acc = accOf(rec);
    return [rec.name, acc.name, acc.domain, acc.city, rec.role, rec.email,
      label('industry', acc.industry), label('src', acc.src), label('service', rec.svc || acc.svc),
      ...titlesAt(rec), ...campsOf(rec).map(campName),
      ...touchesFor(rec).slice(0, 3).map((t) => t.note),
    ].filter(Boolean).join(' ').toLowerCase();
  }

  /* Rolling windows over the last touchpoint. Two of them run the other way
     — "not touched in 30 days" is the question a rep actually asks, and it
     is not the negation of "touched in the last 30 days" for a lead that
     was never touched at all. Those stay excluded: `untouched` is a status
     and has its own filter. */
  const TOUCHED = {
    '7d':   { label: 'Last 7 days',       test: (n) => n != null && n <= 7 },
    '30d':  { label: 'Last 30 days',      test: (n) => n != null && n <= 30 },
    '90d':  { label: 'Last 90 days',      test: (n) => n != null && n <= 90 },
    '1y':   { label: 'This year',         test: (n) => n != null && n <= 365 },
    'not30': { label: 'Not in 30 days',   test: (n) => n != null && n > 30 },
    'not90': { label: 'Not in 90 days',   test: (n) => n != null && n > 90 },
  };

  /* `due` is a set of named buckets, not a window, and it is a separate
     control for that reason. Knowledge folded four date pickers into one
     because all four asked "when" of the same kind of value; these two ask
     different questions in different vocabularies, and one control that
     answered both would have to name them anyway. */
  const DUE = {
    overdue: { label: 'Overdue',       test: (rec) => rec.next && daysAgo(rec.next.due) > 0 },
    today:   { label: 'Due today',     test: (rec) => rec.next && daysAgo(rec.next.due) === 0 },
    '7d':    { label: 'Due this week', test: (rec) => rec.next && daysAgo(rec.next.due) >= -7 },
    '30d':   { label: 'Due this month', test: (rec) => rec.next && daysAgo(rec.next.due) >= -30 },
    none:    { label: 'No next step',  test: (rec) => !rec.next },
  };

  function records() {
    return S.on === 'contacts' ? DB.con : DB.acc;
  }

  /* ── Entitlement, and why it is not a filter ──

     A filter is a question you asked and can unask. Entitlement is neither:
     you did not choose it and you cannot clear it, so it is applied as a
     boundary on the corpus rather than as another axis, and it is DISCLOSED
     rather than left for someone to notice.

     `filtered({ all: true })` runs the identical predicate without the
     boundary, which is how the disclosure knows the number. Two passes over
     354 records costs nothing, and the alternative — a second copy of the
     predicate that counts instead of filters — is a second copy that drifts,
     and the thing it would drift about is who may see what. */
  const entitled = (rec, who) => TIERS[(who || me()).tier].sees(rec, who || me());

  /* Everything that reads the corpus WITHOUT going through `filtered()` goes
     through this instead — the briefing, the bell, the answers, a campaign's
     member list, the prototype control's links. Each of those was its own
     way around the boundary, and a boundary with five ways around it is a
     suggestion. */
  const maySee = (list) => list.filter((r) => entitled(r));

  /* THE SAME BOUNDARY, OVER TOUCHPOINTS. `maySee` bounds records, and four
     display paths counted `DB.touch` raw — so every tier, including a client,
     read the same "AiMY sent 42 messages in the last fortnight, 21 addresses
     rejected". That is the whole agency's volume across every engagement,
     reported to somebody entitled to one of them.

     It is the same class of defect as the URL-paste hole: a read path that
     never passes the boundary. Records had a helper and touchpoints did not,
     so touchpoints were the way round it.

     A touchpoint is visible if the record it happened to is. `t.on` is the
     contact where there is one, `t.acc` the account otherwise — checking the
     account is what makes an account-level entitlement cover its people. */
  const maySeeTouch = (list) => list.filter((t) => {
    const r = DB.accBy[t.acc] || DB.conBy[t.on];
    return r && entitled(r);
  });

  /* Read-only tiers do not get disabled buttons, they get no buttons. A
     control that is present and refuses is the same defect as a CTA that
     duplicates its own card: it occupies the place where a real affordance
     would be and teaches people that the controls here are decorative. The
     disclosure line says why the page is quieter than they expected. */
  const canWrite = () => TIERS[me().tier].writes;

  /* Scope is the opposite: a question you did ask, so the switch shows it and
     nothing has to be disclosed. It is still bounded by tier — a rep asking
     for "everyone" gets everyone they are entitled to, and the switch says
     so on its face rather than pretending the word means what it usually
     means. */
  /* THE OWNER AXIS ANSWERS THREE KINDS OF QUESTION, and they are not the
     same shape: two scopes and a list of people. `mine` deliberately means
     owned-or-shared, which is what the old switcher meant silently and what
     its option now says out loud; picking your own NAME still means owned
     by you, and the two giving different counts is now legible rather than
     confusing, because the labels differ. */
  function ownerMatch(list, rec, ownerId) {
    if (!list.length) return true;
    const w = me();
    return list.some((v) => {
      if (v === 'mine') return ownerId === w.id || ((rec && rec.shared) || []).includes(w.id);
      if (v === 'team') return teamOf(w.id).has(ownerId);
      return v === ownerId;
    });
  }

  function filtered(opts) {
    const any = (list, v) => !list.length || list.includes(v);
    const anyOf = (list, vals) => !list.length || vals.some((v) => list.includes(v));
    const q = S.q.trim().toLowerCase();
    const skipEnt = !!(opts && opts.all);

    return records().filter((rec) => {
      const acc = accOf(rec);
      if (!skipEnt && !entitled(rec)) return false;

      /* Archived is a mode, not a filter: an archived record is absent
         unless you ask for it, and then it is the only thing present. */
      if (S.archived === '1') { if (!rec.arch) return false; }
      else if (rec.arch) return false;

      /* An explicit id set wins over everything except archive. It is the
         answer→surface bridge: the canvas cites records and writes their
         ids here, so closing the canvas lands on what it was talking about. */
      if (S.ids.length) return S.ids.includes(rec.id);

      if (!any(S.status, statusOf(rec))) return false;
      if (!anyOf(S.campaign, campsOf(rec))) return false;
      /* `own` is the engagement that is ours, so it matches having none. */
      if (S.client.length && !S.client.some((k) => (k === 'own' ? !clientsOf(rec).length : clientsOf(rec).includes(k)))) return false;
      if (!ownerMatch(S.owner, rec, rec.owner)) return false;
      if (S.shared.length && !anyOf(S.shared, rec.shared || [])) return false;
      if (!any(S.industry, acc.industry)) return false;
      if (!any(S.region, acc.region)) return false;
      if (!any(S.src, acc.src)) return false;
      if (!any(S.icp, acc.icp)) return false;
      if (!any(S.svc, rec.svc || acc.svc)) return false;
      if (S.size.length && !S.size.includes(sizeBand(acc.emp))) return false;
      if (S.rev.length && !S.rev.includes(revBand(acc.rev))) return false;
      if (S.title.length && !titlesAt(rec).some((t) => S.title.includes(t))) return false;

      /* Include and exclude, V1's green and red chips. Free text rather than
         an axis, because they are how a rep says the thing the taxonomy has
         no word for — "software support", "not previously contacted". EVERY
         include must hit and NO exclude may: an include list that only needs
         one match is a widening filter wearing a narrowing label. */
      if (S.inc.length || S.exc.length) {
        const hay = haystack(rec);
        if (!S.inc.every((w) => hay.includes(w.toLowerCase()))) return false;
        if (S.exc.some((w) => hay.includes(w.toLowerCase()))) return false;
      }

      /* Channel is the channel of the LAST touchpoint. "Which of these did
         AiMY reach and I have not?" is the question, and it is about the
         most recent contact, not about whether the channel ever appeared. */
      if (S.channel.length) {
        const ts = touchesFor(rec);
        if (!ts.length || !S.channel.includes(ts[0].ch)) return false;
      }

      if (S.touched) {
        const ts = touchesFor(rec);
        const last = ts.length ? ts[0].at : null;
        /* A rolling window and a fixed range live in the SAME key, because
           they are different questions rather than different formats: "the
           last 30 days" still means the last 30 days tomorrow, and
           1 Jun – 30 Jul does not. Chat writes the token; the calendar
           writes the range. */
        if (S.touched.includes('..')) {
          const [a, b] = S.touched.split('..');
          if (!last || last < a || last > b) return false;
        } else if (TOUCHED[S.touched]) {
          if (!TOUCHED[S.touched].test(last ? daysAgo(last) : null)) return false;
        }
      }
      /* `due` holds either a named bucket (overdue · today · none) or a
         range, because both answer "what is coming up" and splitting them
         into two keys would put the same question in two places. */
      if (S.due) {
        if (S.due.includes('..')) {
          const [a, b] = S.due.split('..');
          if (!rec.next || rec.next.due < a || rec.next.due > b) return false;
        } else if (DUE[S.due] && !DUE[S.due].test(rec)) return false;
      }

      if (q) {
        const hay = [rec.name, acc.name, acc.domain, acc.city, rec.role, rec.email]
          .filter(Boolean).join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }

  /* One ordering, named after its question: what needs a person first.
     There is no sort control — ordering is not a filter, and a control
     offering three answers to a question nobody asked is one more thing on
     screen. Within a status, the oldest thing waiting leads. */
  const URGENCY = ['awaiting-us', 'stalled', 'going-cold', 'awaiting-them', 'untouched', 'won', 'lost', 'not-a-fit'];
  function ordered(list) {
    return list.slice().sort((a, b) => {
      const d = URGENCY.indexOf(statusOf(a)) - URGENCY.indexOf(statusOf(b));
      if (d) return d;
      const an = a.next ? dayOf(a.next.due) : Infinity;
      const bn = b.next ? dayOf(b.next.due) : Infinity;
      if (an !== bn) return an - bn;
      const at = touchesFor(a)[0];
      const bt = touchesFor(b)[0];
      return (bt ? dayOf(bt.at) : 0) - (at ? dayOf(at.at) : 0);
    });
  }

  /* ═══════════════════════════════════════════════
     THE FILTER ROW

     `.v2-dropdown` is the design system's only select control and carries
     the whole keyboard model, so every axis here is one. The full ARIA set
     is written by hand: the library's normalisation pass runs once at load
     and cannot adopt a dropdown rendered afterwards — which is every
     dropdown on a surface whose filters are drawn from the corpus. Its
     `ensureIds` is not reachable from outside either, and
     `aria-activedescendant` needs the ids, so those are written too.
     Filed in ../GAPS.md.

     THE ORDER IS A HIERARCHY, NOT A LIST. Campaign · Status · Owner, then
     the firmographics: which piece of work the lead belongs to, what state
     it is in, whose it is — then what kind of company it happens to be.
     Firmographics describe the lead; the first three describe the work,
     and the work is what someone opening this surface came for.
  ═══════════════════════════════════════════════ */

  /* The axes the row draws a control for. Declared once: the chip bar reads
     the same list to decide which values it must show and which the row is
     already showing, and a second copy is how a filter comes to appear
     twice or not at all. */
  /* FIVE CONTROLS, and the rest behind More.

     Eleven dropdowns on one row is not a filter row, it is a wall — nothing
     in it is findable because everything in it is the same size and weight.
     What stays out is what a rep touches every day: which campaign, what
     state it is in, whose it is, and when.

     MORE HIDES CONTROLS, NEVER STATE. Every secondary filter that is set
     still renders as a removable chip in the chip bar, so nothing active is
     ever invisible — hiding a control is a density decision, hiding a filter
     that is on is a lie about what you are looking at. */
  /* PER RECORD TYPE, because the axes genuinely differ. A task has no
     industry and no revenue, and drawing those controls over a list of
     tasks would be eleven dropdowns that can only return nothing — the same
     wall the More popover was built to remove, rebuilt out of dead options. */
  const AXES_ON = {
    accounts: {
      row:  ['campaign', 'status', 'owner'],
      more: ['due', 'industry', 'size', 'rev', 'title', 'src', 'channel', 'svc', 'region', 'icp', 'shared', 'client'],
    },
    tasks: {
      row:  ['tstate', 'kind', 'started'],
      more: ['campaign', 'client'],
    },
    /* `tstate` is shared with tasks — both are "what state is this in", and
       `AXES.tstate` reads its rows from whichever type is on screen. */
    campaigns: {
      row:  ['tstate', 'owner', 'client'],
      more: [],
    },
    /* No axes. A team is four to six people — a filter row above it would be
       five controls for a list you can read in one look. */
    team: { row: [], more: [] },
  };
  AXES_ON.contacts = AXES_ON.accounts;
  const ROW_AXES = () => AXES_ON[S.on].row;
  const MORE_AXES = () => AXES_ON[S.on].more;
  const onTasks = () => S.on === 'tasks';
  const onCamps = () => S.on === 'campaigns';
  const onTeam = () => S.on === 'team';
  /* The two that are not leads, which is the distinction most call sites
     actually care about — a lead has a status and a touchpoint history, and
     neither of the other two does. */
  const onLeads = () => !onTasks() && !onCamps() && !onTeam();

  let ddSeq = 0;

  function dropdown(opts) {
    const id = 'dd' + ++ddSeq;
    const rows = opts.rows;
    const cur = opts.value;
    const sel = rows.find((r) => r[0] === cur) || rows[0];
    const on = sel !== rows[0];
    /* SEARCH INSIDE A FILTER, over six options. The library ships letter
       typeahead, which finds a value you can already spell. A list of
       fourteen lists or nine industries is the case where you cannot — you
       know it has "Amsterdam" in it somewhere — so this narrows instead of
       jumping. Recorded in ../GAPS.md. */
    const searchable = rows.length > 6;
    return `<div class="v2-dropdown s-filter" data-filter-key="${esc(opts.key)}">
      <button class="v2-dropdown-btn${on ? ' active-filter' : ''}" type="button"
              id="${id}b" aria-haspopup="listbox" aria-expanded="false" aria-controls="${id}p">
        <span class="dd-label-text">${esc(sel[1])}</span>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>
      </button>
      <div class="v2-dropdown-panel" id="${id}p" role="listbox" aria-labelledby="${id}b" tabindex="-1">
        ${searchable ? `<div class="dd-search">
          <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>
          <input type="text" placeholder="Search…" aria-label="Search these options" autocomplete="off" spellcheck="false" />
        </div>` : ''}
        ${rows.map((row, i) => `<div class="v2-dropdown-option${row[0] === sel[0] ? ' selected' : ''}"
             id="${id}o${i}" role="option" aria-selected="${row[0] === sel[0]}"
             data-value="${esc(row[0])}">${esc(row[1])}${row[2] != null ? `<span class="s-dd-n">${row[2]}</span>` : ''}</div>`).join('')}
        ${searchable ? `<div class="dd-none" hidden>Nothing matches that.</div>` : ''}
      </div>
    </div>`;
  }

  /* ── The three handlers that make the search field usable ──

     All at the CAPTURE phase, because the library closes a dropdown on any
     click that is not an option or the trigger — so clicking into the search
     box used to shut the thing you were about to search. */
  ['click', 'mousedown', 'keydown'].forEach((type) => {
    document.addEventListener(type, (e) => {
      if (!e.target.closest || !e.target.closest('.dd-search')) return;
      e.stopPropagation();
      if (type === 'keydown' && ['ArrowDown', 'ArrowUp', 'Enter', 'Escape'].includes(e.key)) {
        /* Let the library's keyboard model have the navigation keys — they
           are what move between the options this field just narrowed. */
        return;
      }
      if (type === 'keydown') e.stopPropagation();
    }, true);
  });

  /* The add-contacts search redraws the candidate list as you type. Same
     rule as the source tabs: it is the same decision seen differently, so it
     replaces the live block rather than stacking another. */
  document.addEventListener('input', (e) => {
    if (!e.target.classList || !e.target.classList.contains('s-add-q')) return;
    if (!addTo) return;
    const at = e.target.selectionStart;
    addTo.q = e.target.value;
    dropWork();
    paintAddWork();
    const again = $('.s-add-q');
    if (again) { again.focus(); again.setSelectionRange(at, at); }
  });

  document.addEventListener('input', (e) => {
    const field = e.target.closest && e.target.closest('.dd-search');
    if (!field) return;
    const panel = field.closest('.v2-dropdown-panel');
    const q = e.target.value.trim().toLowerCase();
    let shown = 0;
    $$('.v2-dropdown-option', panel).forEach((o, i) => {
      /* The axis's "All" row survives any query. Clearing a filter must
         never be something you have to spell your way back to. */
      const keep = i === 0 || !q || o.textContent.toLowerCase().includes(q);
      /* DETACHED, not hidden. The library's keyboard model reads
         `.v2-dropdown-option` straight from the DOM without checking
         `hidden`, so merely hiding them lets arrow keys walk through rows
         nobody can see. */
      o.classList.toggle('dd-off', !keep);
      if (keep) shown++;
    });
    const none = $('.dd-none', panel);
    if (none) none.hidden = shown > 1;
  });

  /* How many records each option would leave, computed against the OTHER
     filters rather than against everything. A count that ignores the rest
     of the row promises results the click will not deliver. */
  function countsFor(key, values) {
    const saved = S[key];
    const out = Object.create(null);
    for (const v of values) {
      S[key] = MULTI.includes(key) ? [v] : v;
      out[v] = onTasks() ? filteredTasks().length : onCamps() ? filteredCampaigns().length : onTeam() ? filteredTeam().length : filtered().length;
    }
    S[key] = saved;
    return out;
  }

  const AXES = {
    campaign: { all: 'Any campaign', rows: () => DB.camp.map((c) => [c.k, c.name]) },
    status:   { all: 'Any status',   rows: () => TAX.status.map((s) => [s.k, s.label]) },
    /* `mine` and `team` are scope values, not people, so they sit above the
       names with a rule of their own. `mine` states the thing the old
       switcher hid: it is not the same as picking yourself. */
    owner:    { all: 'Anyone', rows: () => [['mine', 'Mine — owned or shared with me']]
                 .concat(teamName(me().id) ? [['team', 'My team']] : [])
                 .concat(SELLERS.map((p) => [p.id, p.name])) },
    due:      { all: 'Any next step', rows: () => Object.keys(DUE).map((k) => [k, DUE[k].label]), scalar: true },
    industry: { all: 'Any industry', rows: () => TAX.industry.map((i) => [i.k, i.label]) },
    size:     { all: 'Any headcount', rows: () => TAX.size.map((b) => [b.k, b.label]) },
    rev:      { all: 'Any revenue',  rows: () => TAX.rev.map((b) => [b.k, b.label]) },
    title:    { all: 'Any job title', rows: () => TITLES.map((t) => [t, t]) },
    src:      { all: 'Any source',   rows: () => TAX.src.map((s) => [s.k, s.label]) },
    channel:  { all: 'Any channel',  rows: () => TAX.channel.map((c) => [c.k, `Last touch: ${c.label}`]) },
    svc:      { all: 'Any service',  rows: () => TAX.service.map((s) => [s.k, s.label]) },
    region:   { all: 'Any region',   rows: () => TAX.region.map((r) => [r.k, r.label]) },
    icp:      { all: 'Any ICP',      rows: () => KB.filter((k) => k.type === 'icp').map((k) => [k.id, k.title]) },
    shared:   { all: 'Shared with anyone', rows: () => SELLERS.map((p) => [p.id, p.name]) },
    /* "Our own book" is a real value, not the absence of one. Most work here
       is FlairsTech's; an axis that could only say "Upland" or "any" would
       make the commonest case the one you cannot ask for. */
    client:   { all: 'Any engagement', rows: () => [['own', 'Our own book']].concat(CLIENTS.map((c) => [c.k, c.name])) },
    /* The task axes. `started` rather than `owner` because a task is not
       owned — it was asked for, once, and then it ran. */
    tstate:   { all: 'Any state',    rows: () => Object.keys(TASK_STATE).map((k) => [k, TASK_STATE[k].label]) },
    kind:     { all: 'Any kind',     rows: () => Object.keys(TASK_KIND).map((k) => [k, TASK_KIND[k].label]) },
    started:  { all: 'Started by anyone', rows: () => SELLERS.map((p) => [p.id, p.name]) },
  };

  /* THE "ANY" ROW CANNOT CARRY AN EMPTY VALUE, and the reason is in the
     library. `aimy-ds.js` resolves a chosen option like this:

         const value = opt.getAttribute('data-value') || opt.textContent.trim();

     `||` on an empty string falls through to the LABEL, so clicking *Any
     status* emitted `"Any status"` as the value and the surface filtered to a
     status nothing has. It only bit on the second interaction — the Any row
     starts selected, so you only ever click it to clear — which is exactly
     "change a filter and change it back gives no results".

     A sentinel rather than the empty string, and one that cannot collide:
     every real value on every axis is a kebab key or an id — `going-cold`,
     `q3-nl`, `kb-icp-qa-ent`, `a10` — and none of them contains an
     underscore. `S` never sees it, because the handler maps it back before
     `go()`, so the URL, the chip bar and every count still deal only in real
     values or in nothing. Filed in ../GAPS.md. */
  const ALL_OPT = '__all__';

  function axisDropdown(key) {
    const ax = AXES[key];
    const opts = ax.rows();
    const counts = countsFor(key, opts.map((r) => r[0]));
    /* An option that would empty the surface is still shown, with its zero.
       Hiding it would answer "are there any?" by omission, and the honest
       answer to that question is a nought. */
    const rows = [[ALL_OPT, ax.all]].concat(opts.map((r) => [r[0], r[1], counts[r[0]]]));
    const cur = ax.scalar ? (S[key] || '') : (S[key] || [])[0] || '';
    return dropdown({ key, value: cur || ALL_OPT, rows });
  }

  function filterRow() {
    const primary = ROW_AXES().map(axisDropdown).join('');
    const on = MORE_AXES().filter((k) => (AXES[k].scalar ? S[k] : (S[k] || []).length)).length;

    return `<div class="s-filters" role="group" aria-label="Filters">
      ${primary}${dateRange()}
      <div class="s-more-wrap">
        <button class="s-more-btn${on ? ' active-filter' : ''}" type="button" data-more
                aria-haspopup="dialog" aria-expanded="false">
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 6h16M7 12h10M10 18h4"/></svg>
          More${on ? ` <span class="s-more-n">${on}</span>` : ''}
        </button>
        <div class="s-more-panel" hidden role="dialog" aria-label="More filters">
          <div class="s-more-grid">${MORE_AXES().map(axisDropdown).join('')}</div>
          ${on ? `<button class="s-more-clear" type="button" data-clear-more>Clear these ${on}</button>` : ''}
        </div>
      </div>
    </div>`;
  }

  /* ═══════════════════════════════════════════════
     THE DATE RANGE

     The design system's `.cal` is a SINGLE-DATE picker: head, nav, grid,
     dow, and `.muted` / `.today` / `.selected`. A range has two ends and a
     middle, so three states are added on top of `.selected` rather than
     instead of it — which is what keeps a one-day range looking like the
     library's selected day. Recorded in ../GAPS.md.

     HALF A RANGE WRITES NOTHING. A filter that emptied the surface the
     moment you picked the first date would be answering a question you had
     not finished asking.
  ═══════════════════════════════════════════════ */

  let calMonth = TODAY.getMonth();
  let calYear = TODAY.getFullYear();
  let calFrom = null;

  /* ── Which date the range means, derived ──

     One control, not two. Which date it filters follows from what else is
     filtered: ask about next steps and a range is obviously about due dates;
     ask about anything else and it is about when something last happened.

     THE DERIVATION IS STATED ON THE CONTROL'S FACE — it reads "Next step due
     · 1–14 Aug", never bare dates. A derived value is fine; a derived value
     that will not say what it derived is the attestation problem again, in
     reverse. And the URL still carries one key per axis, so a pasted link
     reproduces the surface without anyone re-running the rule to read it. */
  function dateAxis() {
    return (S.due && !S.due.includes('..')) || S.status.includes('stalled') ? 'due' : 'touched';
  }
  const AXIS_LABEL = { due: 'Next step due', touched: 'Last touched' };

  function dateRange() {
    const axis = dateAxis();
    const raw = S[axis];
    const cur = raw && raw.includes('..') ? raw.split('..') : null;
    return `<div class="s-cal-wrap">
      <button class="s-cal-btn${cur ? ' active-filter' : ''}" type="button" data-cal-open
              aria-haspopup="dialog" aria-expanded="false">
        <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.9" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>
        ${cur
          ? `<span class="s-cal-axis">${esc(AXIS_LABEL[axis])}</span><span class="s-cal-dates">${esc(fmtDate(cur[0]))}&thinsp;–&thinsp;${esc(fmtDate(cur[1]))}</span>`
          : 'A date range'}
      </button>
      <div class="s-cal-panel" hidden role="dialog" aria-label="Pick a date range">${calBody()}</div>
    </div>`;
  }

  function calBody() {
    const axis = dateAxis();
    const raw = S[axis];
    const cur = raw && raw.includes('..') ? raw.split('..') : null;
    const first = new Date(calYear, calMonth, 1);
    const start = (first.getDay() + 6) % 7;            /* weeks start Monday */
    const days = new Date(calYear, calMonth + 1, 0).getDate();
    const prevDays = new Date(calYear, calMonth, 0).getDate();

    const cells = [];
    for (let i = start - 1; i >= 0; i--) cells.push({ d: prevDays - i, muted: true });
    for (let d = 1; d <= days; d++) cells.push({ d, muted: false, iso: `${calYear}-${String(calMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}` });
    while (cells.length % 7) cells.push({ d: cells.length - start - days + 1, muted: true });

    const a = calFrom || (cur && cur[0]);
    const b = !calFrom && cur ? cur[1] : null;

    return `
      <div class="s-cal-field">
        <span class="s-cal-field-label">This range means</span>
        <div class="s-cal-axis-said">${esc(AXIS_LABEL[axis])}</div>
        <p class="s-cal-why">${esc(axis === 'due'
          ? 'because you are filtering by next step'
          : 'add a next-step filter and it will mean the due date instead')}</p>
      </div>
      <div class="cal s-cal">
        <div class="cal-head">
          <button class="cal-nav" type="button" data-cal-mv="-1" aria-label="Previous month">‹</button>
          <span class="cal-title">${MONTHS[calMonth]} ${calYear}</span>
          <button class="cal-nav" type="button" data-cal-mv="1" aria-label="Next month">›</button>
        </div>
        <div class="cal-grid">
          ${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => `<span class="cal-dow" aria-hidden="true">${d[0]}</span>`).join('')}
          ${cells.map((c) => {
            if (c.muted) return `<span class="cal-day muted">${c.d}</span>`;
            const isA = c.iso === a, isB = c.iso === b;
            const inR = a && b && c.iso > a && c.iso < b;
            return `<button class="cal-day${isA || isB ? ' selected' : ''}${isA ? ' range-start' : ''}${isB ? ' range-end' : ''}${inR ? ' in-range' : ''}${c.iso === iso(TODAY) ? ' today' : ''}"
              type="button" data-cal-day="${c.iso}">${c.d}</button>`;
          }).join('')}
        </div>
      </div>
      <p class="s-cal-hint">${calFrom
        ? `From ${esc(fmtDate(calFrom))} — now pick the other end.`
        : 'Pick two days. Nothing is filtered until you pick the second.'}</p>
      ${cur ? `<button class="s-cal-clear" type="button" data-cal-clear>Clear the range</button>` : ''}`;
  }

  /* ═══════════════════════════════════════════════
     THE CHIP BAR — the URL, made removable

     Only for what a dropdown cannot say: several values on one axis, free
     text, an explicit record set, a matched ICP. Everything a dropdown CAN
     say is said by the dropdown lighting up, because two places showing one
     filter is two places that can disagree.
  ═══════════════════════════════════════════════ */

  function chipBar() {
    const chips = [];
    const add = (key, val, text) => chips.push({ key, val, text });

    if (S.q) add('q', '', `Matching “${S.q}”`);
    if (S.archived === '1') add('archived', '', 'Archived');
    if (S.ids.length) add('ids', '', `${plural(S.ids.length, 'record')} from an answer`);

    /* THIS IS WHAT MAKES "MORE" HONEST. An axis whose control is on the row
       is already saying its first value by lighting up, so only its second
       and later values need a chip. An axis hidden behind More has no
       control on screen at all, so EVERY value it holds gets one — hiding a
       control is a density decision, hiding a filter that is on would be a
       lie about what you are looking at. */
    for (const key of MULTI) {
      if (key === 'ids' || key === 'cols' || key === 'inc' || key === 'exc') continue;
      const vals = S[key] || [];
      const from = ROW_AXES().includes(key) ? 1 : 0;
      vals.slice(from).forEach((v) => add(key, v, chipText(key, v)));
    }
    if (S.due && !DUE[S.due]) add('due', '', `Next step ${fmtRange(S.due)}`);
    else if (S.due) add('due', '', DUE[S.due].label);
    if (S.touched) add('touched', '', `Last touched ${S.touched.includes('..') ? fmtRange(S.touched) : (TOUCHED[S.touched] || {}).label || S.touched}`);

    if (!chips.length && !S.inc.length && !S.exc.length) return '';
    return `<div class="s-chips" role="group" aria-label="Active filters">
      ${S.inc.map((w) => keywordChip('inc', w)).join('')}
      ${S.exc.map((w) => keywordChip('exc', w)).join('')}
      ${chips.map((c) => `<button class="chip active s-chip" type="button"
          data-drop-key="${esc(c.key)}" data-drop-val="${esc(c.val)}">
          ${esc(c.text)}
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>`).join('')}
      <button class="s-chip-clear" type="button" data-clear-all>Clear all</button>
    </div>`;
  }

  /* Include and exclude carry their own colour, as V1's do: green widens,
     red narrows, and a rep scanning the bar can tell which way a term cuts
     without reading it. */
  function keywordChip(key, w) {
    return `<button class="chip s-chip s-kw s-kw-${key}" type="button" data-drop-key="${esc(key)}" data-drop-val="${esc(w)}">
      ${key === 'inc' ? 'Include' : 'Exclude'}: ${esc(w)}
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
    </button>`;
  }

  const fmtRange = (v) => v.split('..').map((d) => fmtDate(d)).join(' – ');

  function chipText(key, v) {
    switch (key) {
      case 'campaign': return campName(v);
      /* The two scope values are not people, so they do not get "Owned by".
         `mine` says what it includes, because that is exactly the thing the
         switcher it replaced never said. */
      case 'owner':    return v === 'mine' ? 'Mine — owned or shared with me'
                            : v === 'team' ? 'My team'
                            : `Owned by ${actor(v).name}`;
      case 'shared':   return `Shared with ${actor(v).name}`;
      case 'icp':      return KB_BY[v] ? KB_BY[v].title : v;
      case 'svc':      return label('service', v);
      case 'channel':  return `Last touch: ${label('channel', v)}`;
      case 'region':   return label('region', v);
      case 'size':     return label('size', v);
      case 'src':      return label('src', v);
      case 'industry': return label('industry', v);
      case 'status':   return label('status', v);
      case 'rev':      return label('rev', v);
      case 'title':    return v;
      default:         return v;
    }
  }

  /* ═══════════════════════════════════════════════
     THE RESULT LINE

     The count, what it is counting, and the two things that change the
     shape of the answer rather than its contents: which record type, and
     which view. Both write to the URL; both keep every filter.
  ═══════════════════════════════════════════════ */

  function resultLine(list) {
    const noun = onTasks() ? 'task' : onCamps() ? 'campaign' : onTeam() ? 'person' : S.on === 'contacts' ? 'contact' : 'account';
    const scope = scopeName();

    /* The number that is not the count: how many of these are waiting on a
       person right now. A screenful of leads with no summary makes you read
       every card to find out whether today is busy.

       The same question of a task list is "how many have stopped and are
       waiting on somebody" — the same sentence, over the other record type,
       because it is the same worry. */
    /* The same worry over each type: how many of these are waiting on a
       person right now. For a campaign that is one that is running but has
       nobody left to reach — work that looks alive and is not. */
    const need = onTasks()
      ? list.filter((t) => taskState(t) === 'needs-you').length
      : onCamps()
        ? list.filter((c) => campState(c) === 'running'
            && !c.members.some((m) => DB.accBy[m] && !DB.accBy[m].outcome)).length
        : list.filter((r) => ['awaiting-us', 'stalled'].includes(statusOf(r))).length;

    /* Two rows, and which control sits on which is the whole point.

       ACCOUNTS/CONTACTS BELONGS WITH THE COUNT, because it says what is being
       counted — "118" means nothing until you know of what. CARDS/TABLE is a
       display control and belongs with the other display controls, on its own
       line. Side by side they were two identical segmented pairs reading as
       one four-option thing, which is the defect in the screenshot.

       The waiting figure loses its red pill. It is a pointer, not an alarm —
       the card borders already carry the alarm, and a second red thing beside
       the count competes with the number it is qualifying. */
    return `<div class="s-result">
      <div class="s-result-row">
        <div class="s-result-main">
          <h1 class="s-result-count">${plural(list.length, noun)}</h1>
          ${/* Contacts say what they sit inside. "236 contacts" beside a tab
                reading "118 accounts" gives no clue the first is the people
                in the second — the same relation the account card now
                states from its own side. */ ''}
          ${S.on === 'contacts' && list.length
            ? `<span class="s-result-scope">at ${esc(plural(new Set(list.map((r) => accOf(r).id)).size, 'account'))}</span>` : ''}
          ${scope ? `<span class="s-result-scope">in ${scope}</span>` : ''}
          <div class="seg" role="group" aria-label="Record type">
            <button class="seg-btn${S.on === 'accounts' ? ' active' : ''}" type="button" data-on="accounts">Accounts</button>
            <button class="seg-btn${S.on === 'contacts' ? ' active' : ''}" type="button" data-on="contacts">Contacts</button>
            ${/* Tasks carry a count on the tab and the other two do not. It
                  is not decoration: work in flight is the one thing on this
                  surface that changes while nobody is looking at it, and
                  work that has STOPPED is the one thing that gets worse.

                  Two counts, two weights. Stopped is red and outranks; in
                  flight is quiet and only shows when nothing has stopped —
                  one number on a tab, and it is the number that matters
                  most at that moment. */ ''}
            <button class="seg-btn${onCamps() ? ' active' : ''}" type="button" data-on="campaigns">Campaigns</button>
            ${seesOthers() ? `<button class="seg-btn${onTeam() ? ' active' : ''}" type="button" data-on="team">Team</button>` : ''}
            <button class="seg-btn${onTasks() ? ' active' : ''}" type="button" data-on="tasks">Running${
              (() => {
                const ts = filteredTasks();
                const stuck = ts.filter((t) => taskState(t) === 'needs-you').length;
                if (stuck) return `<span class="s-seg-n">${stuck}</span>`;
                const live = ts.filter((t) => ['running', 'queued'].includes(taskState(t))).length;
                return live ? `<span class="s-seg-n is-quiet">${live}</span>` : '';
              })()
            }</button>
          </div>
        </div>
        ${canWrite() ? `<button class="btn btn-brand btn-sm s-build" type="button" data-build>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>
          Build a campaign
        </button>` : ''}
      </div>
      <div class="s-result-row is-under">
        <div class="s-result-left">
          ${need ? `<button class="s-result-need" type="button" data-quick="status=awaiting-us,stalled">${need} waiting on a person</button>` : ''}
        </div>
        <div class="seg" role="group" aria-label="View">
          <button class="seg-btn${S.view === 'cards' ? ' active' : ''}" type="button" data-view="cards">Cards</button>
          <button class="seg-btn${S.view === 'table' ? ' active' : ''}" type="button" data-view="table">Table</button>
        </div>
      </div>
      ${disclosure()}
    </div>`;
  }

  /* ── The scope switch ──

     Three questions a person actually asks, where `mine=1` could only ask
     one and a half. The widest option NAMES ITS CEILING: for anyone below
     admin it is not "Everyone", it is everyone they are entitled to, and a
     control labelled with a word it does not mean is worse than no control.
     A client has no ceiling to name because their whole world is one
     engagement, so the switch does not render for them at all — three
     options that all return the same set is a control pretending to work. */
  /* THE SCOPE SWITCHER IS GONE, FOLDED INTO THE OWNER AXIS.

     It was a second control asking the Owner filter's question and giving a
     different answer: `Mine` showed 32 where `Owner = Nour Wael` showed 28,
     because "mine" quietly meant "owned by me OR shared with me" and nothing
     on screen said so. Two controls that look like one question and disagree
     is worse than either alone — and the header was carrying three switchers,
     eight buttons, above fifteen filter axes.

     Both meanings survive as options on the axis that already asks whose work
     this is, and the one that used to be silent is now the explicit one:
     "Mine — owned or shared with me". `?scope=` retired with the control;
     tasks and campaigns use their own owner axes, so there is one way to ask
     the question per record type rather than two. */

  /* ── Permission is never silent ──

     A count that quietly shrinks is a lie about the size of the world. The
     same principle the date axis follows when it names the field it resolved
     to, and the status follows when it says why it is what it is: a surface
     that derives something must say what it derived.

     It says the NUMBER and the RULE, not an apology. "Some records are
     hidden" tells you nothing you can act on; "34 not shown — you see leads
     you own, that are shared with you, or in a campaign you are on" tells you
     both how much you are missing and how to come by it. */
  /* WHAT YOU CANNOT SEE IS NOT DESCRIBED TO YOU.

     This used to count it — "53 accounts not shown to you" — on the argument
     that permission should never be silent, so a quiet page says why it is
     quiet. That argument was overruled: a count of what is withheld is still
     information about what is withheld, and on a surface an external client
     uses, the shape and size of somebody else's book is not theirs to
     infer.

     What is left states the frame rather than the remainder: which
     engagement you are in, and whether you can write. Both are facts about
     you, and neither describes anything outside your world.

     The cost is real and taken deliberately: a rep who pastes a colleague's
     link now gets "not here" for a record that does exist, and may redo work
     already done. Clean scoping for the outside was judged worth it. */
  function disclosure() {
    const w = me();
    const tier = TIERS[w.tier];
    const bits = [];
    if (w.tier === 'client') {
      bits.push(`<span class="s-disc-eng">${esc(clientName(w.client))}</span> — this engagement is your workspace.`);
    }
    if (!tier.writes) bits.push('Read-only: nothing here can be changed from this account.');
    if (!bits.length) return '';
    return `<div class="s-disclosure"${w.tier === 'client' ? ' data-client="1"' : ''}>
      ${lockMark()}<span class="s-disc-text">${bits.join(' ')}</span>
    </div>`;
  }

  const lockMark = () => `<svg class="s-disc-ico" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><rect x="4.5" y="10.5" width="15" height="10" rx="2"/><path d="M8 10.5V7a4 4 0 018 0v3.5"/></svg>`;

  /* One name, and only the one that earns it. A campaign narrowed to one is
     the case: that name opens its own brief, so the finding and its detail
     are one click. Status and owner are already said by their dropdowns
     lighting up, and repeating them here would be the same fact twice. */
  function scopeName() {
    if (S.campaign.length !== 1) return '';
    return `<button class="s-scope-link" type="button" data-camp="${esc(S.campaign[0])}">${esc(campName(S.campaign[0]))}</button>`;
  }

  /* ═══════════════════════════════════════════════
     THE CARD — three tiers, not five rows

     Measured on V1: the lead table gave twelve columns at one weight, seven
     of them "N/A", and the two that mattered — whether anyone had contacted
     them, and what happens next — were a boolean and absent respectively.

     What every list of this kind settles on is one rule: metadata collapses
     onto a single dim line and never becomes rows that compete, and status
     is carried by colour and position rather than by a pill that outranks
     the title.

       Status   the card's own 1px border, tinted; and the word in that tone
                inside the meta line. Colour AND text, never colour alone.
       Title    first element, 15/700
       Snippet  one line — the single most identifying fact for the type
       Meta     one wrapped middot line: status · what · owner · last touch

     The status tint is the library's, not an invention: `.bcard.p1/.p2/.p3`
     put the whole border at low alpha on the card's own 1px. Same
     information, no new mechanism, no content shift, and hover wins exactly
     as it does on `.bcard`.
  ═══════════════════════════════════════════════ */

  /* A task card, built on the same three tiers as a lead card so the two
     views read as one surface: the state word in the meta line carries the
     instruction, the border carries the tone, and there is no button unless
     the button goes somewhere the card click does not.

     The one thing a task has that a lead does not is PROGRESS, and it is the
     reason to look — so it sits where the snippet does, as a sentence, with
     the bar under it. "18 of 42, 2 bounced" is a fact; a bar on its own is a
     shape you have to guess at. */
  function taskCard(t, i) {
    const st = taskState(t);
    const ex = taskExit(t);
    const pct = t.take ? Math.round(((t.done + t.failed) / t.take) * 100) : 0;
    const meta = [
      `<span class="s-meta-st tone-${esc(TASK_STATE[st].tone)}">${esc(TASK_STATE[st].label)}</span>`,
      esc(TASK_KIND[t.kind].label),
      t.camp ? esc(campName(t.camp)) : 'no campaign',
      `${esc(actor(t.by).name)} started it ${esc(fmtAgo(t.at))}`,
    ];
    return `<article class="type-card s-card s-task-card st-${esc(TASK_STATE[st].tone)}" style="--i:${i || 0}" data-row="${esc(t.id)}">
      <div class="tc-head">
        <span class="tc-type">${aiMark()}AiMY</span>
      </div>
      <button class="tc-title s-card-title" type="button" data-task="${esc(t.id)}">${esc(t.title)}</button>
      <p class="tc-summary s-card-snip">${esc(taskProgress(t))}</p>
      ${t.take ? `<div class="s-prog" role="img" aria-label="${esc(taskProgress(t))}">
        <span class="s-prog-done" style="width:${pct}%"></span>
        ${t.failed ? `<span class="s-prog-fail" style="width:${Math.round((t.failed / t.take) * 100)}%"></span>` : ''}
      </div>` : ''}
      <div class="tc-gov s-card-meta">${meta.join('<span class="tc-gov-sep"> · </span>')}</div>
      ${ex && canWrite() ? `<div class="tc-action"><button class="entry-action em-review" type="button" data-taskgo="${esc(t.id)}">${esc(ex.label)}</button></div>` : ''}
    </article>`;
  }

  /* One sentence, used by the card, the table, the record and the bell — so
     all four say a task's progress the same way. A failure count that only
     appears in one of them is a failure count nobody trusts. */
  function taskProgress(t) {
    const st = taskState(t);
    if (st === 'failed') return t.failWhy || 'It failed and did nothing.';
    if (st === 'needs-you') return t.blocked.why;
    if (st === 'paused') return `${t.done} of ${t.take} done. ${t.pausedWhy || 'Paused.'}`;
    if (!t.take) return t.next ? `Nothing yet — ${t.next}.` : 'Nothing yet.';
    const bits = [`${t.done} of ${t.take} done`];
    if (t.failed) bits.push(`${t.failed} failed`);
    if (st === 'running' && t.next) bits.push(t.next);
    if (st === 'done') bits.push(`finished ${fmtAgo(t.finished)}`);
    return bits.join(', ') + '.';
  }

  function card(rec, i) {
    const acc = accOf(rec);
    const st = statusOf(rec);
    const ts = touchesFor(rec);
    const last = ts[0];
    const exit = exitFor(rec);

    /* One line, and it is the most identifying fact this type has. For an
       account that is what it is and how big; for a contact it is the role
       and where. V1 printed twelve fields and answered neither. */
    /* An account states its people; a contact already states its account.
       Without the first, the two lead lists read as unrelated tables rather
       than two ways into one book — and "236 contacts" next to "118
       accounts" gives no clue that the first sits inside the second.

       `maySee`-bounded, so it never counts a person the looker may not
       open. */
    const people = rec.kind === 'acc'
      ? maySee(DB.con.filter((c) => c.acc === acc.id && !c.arch)).length : 0;
    const snippet = rec.kind === 'acc'
      ? [label('industry', acc.industry), fmtSize(acc.emp), acc.city,
         people ? plural(people, 'person') : null].filter(Boolean).join(' · ')
      : [rec.role, acc.name].filter(Boolean).join(' · ');

    const meta = [];
    meta.push(`<span class="s-meta-st tone-${toneOf(st)}">${esc(label('status', st))}${rec.override ? '<span class="s-override-dot" title="Set by hand"></span>' : ''}</span>`);
    if (rec.next) {
      const over = daysAgo(rec.next.due);
      meta.push(`<span class="${over > 0 ? 's-meta-due' : ''}">${esc(rec.next.what)} ${over > 0 ? `${plural(over, 'day')} overdue` : fmtIn(-over)}</span>`);
    }
    meta.push(esc(actor(rec.owner).name));
    /* Who moved last, not just when. "Called 3 days ago" and "they called 3
       days ago" are the difference between waiting and owing, and that is
       the difference the status above is made of — a meta line that hides
       it makes the status look arbitrary. */
    meta.push(last ? esc(touchPhrase(last)) : 'never contacted');

    /* `data-row`, the same key the table uses, so the card and the row open
       the record through one handler. It matters more since the CTA left:
       a card whose only opening target is its own title is a card that looks
       clickable everywhere and answers in one place. The ICP peek and the
       title button are handled earlier in the chain, so they still win. */
    return `<article class="type-card s-card st-${toneOf(st)}" style="--i:${i || 0}" data-row="${esc(rec.id)}">
      <div class="tc-head">
        <span class="tc-type">${chIcon(rec.kind === 'acc' ? 'building' : 'person')}${rec.kind === 'acc' ? 'Account' : 'Contact'}</span>
        ${acc.icp ? `<button class="s-icp" type="button" data-kb="${esc(acc.icp)}" title="${esc(KB_BY[acc.icp].title)}">ICP</button>` : ''}
      </div>
      <button class="tc-title s-card-title" type="button" data-open="${esc(rec.id)}">${esc(rec.name)}</button>
      <p class="tc-summary s-card-snip">${esc(snippet)}</p>
      <div class="tc-gov s-card-meta">${meta.join('<span class="tc-gov-sep"> · </span>')}</div>
      ${exit && canWrite() ? `<div class="tc-action"><button class="entry-action ${exit.mode}" type="button" data-exit="${esc(rec.id)}">${esc(exit.label)}</button></div>` : ''}
    </article>`;
  }

  /* One touchpoint, as a phrase. Facts are phrases, not labels: `CHANNEL`
     stacked over `Phone` is two things to read where one would do. Used by
     the card, the table, the timeline and the answers, so all four say a
     touchpoint the same way. */
  function touchPhrase(t) {
    const when = fmtAgo(t.at);
    if (t.by === 'aimy') return `AiMY emailed ${when}`;
    if (t.dir === 'in') {
      const back = { phone: 'They called', meeting: 'They joined', physical: 'They visited' }[t.ch] || 'They replied';
      return `${back} ${when}`;
    }
    return `${BY.channel[t.ch].verb} ${when}`;
  }

  const ICONS = {
    building: '<path d="M4 21V5a1 1 0 011-1h6a1 1 0 011 1v16M12 21V10a1 1 0 011-1h5a1 1 0 011 1v11M3 21h18M7 8h2M7 12h2M15 13h1M15 17h1"/>',
    person: '<circle cx="12" cy="8" r="3.5"/><path d="M5 20a7 7 0 0114 0"/>',
    phone: '<path d="M5 3h4l2 5-2.5 1.5a12 12 0 006 6L16 13l5 2v4a2 2 0 01-2 2A16 16 0 013 5a2 2 0 012-2z"/>',
    video: '<rect x="3" y="6" width="12" height="12" rx="2"/><path d="M15 10l6-3v10l-6-3z"/>',
    pin: '<path d="M12 21s7-6.2 7-11a7 7 0 10-14 0c0 4.8 7 11 7 11z"/><circle cx="12" cy="10" r="2.5"/>',
    aimy: '<circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1"/>',
  };
  const chIcon = (k) =>
    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[k] || ''}</svg>`;

  /* ═══════════════════════════════════════════════
     THE GRID
  ═══════════════════════════════════════════════ */

  function grid(list) {
    if (!list.length) return empty();
    if (S.view === 'table') return table(list);
    const one = onTasks() ? taskCard : onCamps() ? campCard : onTeam() ? personCard : card;
    return `<div class="s-grid s-stagger">${list.map((r, i) => one(r, i)).join('')}</div>`;
  }

  /* ═══════════════════════════════════════════════
     THE TABLE — Clay's canvas, and the direct fix for V1's

     V1's contacts table is the clearest thing in the screenshots and the
     clearest thing wrong with them. Measured: twelve columns, of which
     ORGANIZATION ID is a primary key nobody can use, ORGANIZATION REVENUE
     PRINTED is a field name rather than a heading, LINKEDIN URL and WEBSITE
     URL are both the word "View Profile", and seven of the twelve read
     "N/A" all the way down. The two facts that matter to a sales rep —
     whether anybody has contacted them, and what happens next — appear as
     `PREVIOUSLY CONTACTED: False` and not at all.

     Four rules here, each one of those defects turned around:

       · Columns are named in the reader's words, not the API's.
       · A COLUMN WITH NOTHING IN IT DOES NOT RENDER. An empty column is a
         promise the data did not keep, and twelve of them make the two full
         ones impossible to find.
       · No identifiers. An id is for the machine; the record's name is the
         thing a person can act on.
       · Every row can be acted on, and the two columns V1 lacked lead.
  ═══════════════════════════════════════════════ */

  /* ── Selection ──
     Deliberately NOT in the URL. Every other piece of state here is, and the
     rule holds because those describe what you are looking at. A selection
     describes what you are about to do to it, and it cannot survive the
     filter changing underneath it — a `?sel=` carrying twenty ids into a
     surface that now shows none of them is a scope nobody can see. */
  const SEL = new Set();
  const selectedIds = () => [...SEL];
  function clearSel() { if (SEL.size) { SEL.clear(); return true; } return false; }

  /* Every column this table can draw. `get` decides whether it has anything
     to say for the rows on screen; `num` right-aligns and makes the figures
     tabular so a column of them can be compared down its own length. */
  /* Two column sets, one table. The task columns answer a different set of
     questions — how far along, on what, started by whom — and forcing them
     through the lead columns would have meant a Revenue header over a crawl. */
  const COLS_TASK = [
    { k: 'title',  head: 'What is running', cell: (t) => `<button class="s-td-name" type="button" data-task="${esc(t.id)}">${esc(t.title)}</button>`, get: (t) => t.title, lock: true },
    { k: 'tstate', head: 'State', cell: (t) => `<span class="s-meta-st tone-${esc(TASK_STATE[taskState(t)].tone)}">${esc(TASK_STATE[taskState(t)].label)}</span>`, get: () => true },
    { k: 'prog',   head: 'Progress', cell: (t) => esc(taskProgress(t)), get: () => true },
    { k: 'tkind',  head: 'Kind', cell: (t) => esc(TASK_KIND[t.kind].label), get: (t) => t.kind },
    { k: 'tcamp',  head: 'Campaign', cell: (t) => (t.camp ? esc(campName(t.camp)) : '<span class="s-td-none">none</span>'), get: (t) => t.camp },
    { k: 'tby',    head: 'Started by', cell: (t) => esc(actor(t.by).name), get: (t) => t.by },
    { k: 'tat',    head: 'Started', cell: (t) => esc(fmtAgo(t.at)), get: (t) => t.at },
  ];

  /* A campaign has none of a lead's columns — no status, no touchpoints, no
     next step — so pointing the table at COLS_LEAD rendered seven rows of
     empty cells under lead headings. Its own columns, same shape. */
  const COLS_CAMP = [
    { k: 'cname',  head: 'Campaign', cell: (c) => `<button class="s-td-name" type="button" data-camp="${esc(c.k)}">${esc(c.name)}</button>`, get: (c) => c.name, lock: true },
    { k: 'tstate', head: 'State', cell: (c) => `<span class="s-meta-st tone-${esc(CAMP_STATE[campState(c)].tone)}">${esc(CAMP_STATE[campState(c)].label)}</span>`, get: () => true },
    { k: 'csize',  head: 'Accounts', cell: (c) => String(maySee(c.members.map((m) => DB.accBy[m]).filter(Boolean)).length), get: () => true },
    { k: 'cwin',   head: 'Window', cell: (c) => (c.from ? `${esc(fmtDate(c.from))} – ${esc(fmtDate(c.to))}` : '<span class="s-td-none">not started</span>'), get: (c) => c.from },
    { k: 'cowner', head: 'Owner', cell: (c) => esc(actor(c.owner).name), get: (c) => c.owner },
    { k: 'cclient', head: 'For', cell: (c) => (c.client ? esc(clientName(c.client)) : '<span class="s-td-none">our own book</span>'), get: (c) => c.client },
  ];

  const COLS_TEAM = [
    { k: 'pname',  head: 'Person', cell: (p) => `<button class="s-td-name" type="button" data-quick2="on=accounts&owner=${esc(p.id)}&camp=">${esc(p.name)}</button>`, get: (p) => p.name, lock: true },
    { k: 'prole',  head: 'Role', cell: (p) => esc(p.role), get: (p) => p.role },
    { k: 'pbook',  head: 'Book', cell: (p) => String(standing(p.id).book), get: () => true },
    { k: 'pwait',  head: 'Waiting on them', cell: (p) => { const n = standing(p.id).waiting;
        return n ? `<span class="s-meta-st tone-${n > 5 ? 'err' : 'warn'}">${n}</span>` : '<span class="s-td-none">none</span>'; }, get: () => true },
    { k: 'pover',  head: 'Overdue', cell: (p) => { const n = standing(p.id).overdue;
        return n ? `<span class="s-meta-due">${n}</span>` : '<span class="s-td-none">none</span>'; }, get: () => true },
    { k: 'punt',   head: 'Never touched', cell: (p) => String(standing(p.id).untouched), get: () => true },
    { k: 'plast',  head: 'Last moved', cell: (p) => { const l = standing(p.id).last;
        return l ? esc(fmtAgo(l.at)) : '<span class="s-td-none">never</span>'; }, get: () => true },
  ];

  const COLS_LEAD = [
    { k: 'name',   head: 'Name',       cell: (r) => `<button class="s-td-name" type="button" data-open="${esc(r.id)}">${esc(r.name)}</button>`, get: (r) => r.name, lock: true },
    { k: 'status', head: 'Where it stands', cell: (r) => `<span class="s-meta-st tone-${toneOf(statusOf(r))}">${esc(label('status', statusOf(r)))}</span>`, get: () => true },
    { k: 'last',   head: 'Last touch', cell: (r) => { const t = touchesFor(r)[0]; return t ? esc(touchPhrase(t)) : '<span class="s-td-none">never</span>'; }, get: (r) => touchesFor(r).length },
    { k: 'next',   head: 'Next step',  cell: (r) => r.next ? `${esc(r.next.what)}<span class="s-td-sub">${daysAgo(r.next.due) > 0 ? esc(plural(daysAgo(r.next.due), 'day')) + ' overdue' : esc(fmtDate(r.next.due))}</span>` : '<span class="s-td-none">none</span>', get: (r) => r.next },
    { k: 'owner',  head: 'Owner',      cell: (r) => esc(actor(r.owner).name), get: (r) => r.owner },
    { k: 'role',   head: 'Job title',  cell: (r) => esc(r.role || ''), get: (r) => r.role },
    { k: 'acc',    head: 'Account',    cell: (r) => r.kind === 'con' ? esc(accOf(r).name) : '', get: (r) => (r.kind === 'con' ? r.acc : null) },
    { k: 'ind',    head: 'Industry',   cell: (r) => esc(label('industry', accOf(r).industry)), get: (r) => accOf(r).industry },
    { k: 'size',   head: 'Headcount',  num: true, cell: (r) => { const a = accOf(r); return a.emp == null ? '<span class="s-td-none">not known</span>' : `${esc(fmtSize(a.emp))}${a.enrich.emp ? confDot(a.enrich.emp) : ''}`; }, get: (r) => accOf(r).emp },
    /* V1 filtered on revenue and never showed it. It is always modelled, so
       it always carries its confidence — a number nobody publishes, printed
       without a caveat, is the defect this whole table exists to fix. */
    { k: 'rev',    head: 'Revenue',    num: true, cell: (r) => { const a = accOf(r); return a.rev == null ? '<span class="s-td-none">not known</span>' : `${esc(fmtMoney(a.rev))}${a.enrich.rev ? confDot(a.enrich.rev) : ''}`; }, get: (r) => accOf(r).rev },
    { k: 'city',   head: 'Where',      cell: (r) => esc(accOf(r).city), get: (r) => accOf(r).city },
    { k: 'camp',   head: 'Campaigns',  cell: (r) => campsOf(r).map((k) => esc(campName(k))).join(', '), get: (r) => campsOf(r).length },
  ];

  const COLS = () => (onTasks() ? COLS_TASK : onCamps() ? COLS_CAMP : onTeam() ? COLS_TEAM : COLS_LEAD);

  /* Which columns render. The automatic rule stands unless somebody
     overrides it, and `?cols=` holds the override rather than the result —
     so an untouched table keeps dropping empty columns as the filters
     change, and a chosen one stays chosen. */
  function columnsFor(list) {
    const filled = COLS().filter((c) => list.some((r) => {
      const v = c.get(r);
      return v !== null && v !== undefined && v !== '' && v !== 0;
    }));
    if (!S.cols.length) return { cols: filled, dropped: COLS().length - filled.length, manual: false };
    const chosen = COLS().filter((c) => c.lock || S.cols.includes(c.k));
    return { cols: chosen, dropped: 0, manual: true };
  }

  /* Pagination. V1 shows "Rows per page 50 · Showing 1-50 of 80" and this
     matches it, because a hundred-row table is a scroll with no end in
     sight and no way to say where you are in it. */
  const PER = () => Math.max(10, parseInt(S.per, 10) || 50);
  const PAGE = () => Math.max(1, parseInt(S.page, 10) || 1);

  function table(all) {
    const { cols, dropped, manual } = columnsFor(all);
    const per = PER();
    const pages = Math.max(1, Math.ceil(all.length / per));
    /* A page number past the end is a URL somebody edited or a filter that
       shrank underneath them. Land on the last real page rather than on
       nothing. */
    const page = Math.min(PAGE(), pages);
    const from = (page - 1) * per;
    const list = all.slice(from, from + per);
    const allOn = list.length && list.every((r) => SEL.has(r.id));
    /* Most rows have no action now, so the column is usually empty — and
       the same rule the data columns follow applies to it: a column with
       nothing in it is not drawn. */
    const tk = onTasks();
    const exOf = (r) => (tk ? taskExit(r) : exitFor(r));
    const anyAct = canWrite() && list.some(exOf);
    /* No tick column on tasks. The selection drives bulk operations over
       leads — add to a campaign, share, assign — and none of them mean
       anything applied to a crawl. A checkbox whose only outcome is an empty
       action bar is a control that lies about what it enables. */
    const pick = !tk;

    return `<div class="s-table-tools">
      <div class="s-cols-wrap">
        <button class="s-more-btn" type="button" data-cols aria-haspopup="dialog" aria-expanded="false">
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16M15 4v16"/></svg>
          Columns${manual ? ` <span class="s-more-n">${cols.length}</span>` : ''}
        </button>
        <div class="s-cols-panel" hidden role="dialog" aria-label="Which columns to show">
          ${COLS().map((c) => `<label class="ds-choice s-col-row${c.lock ? ' is-locked' : ''}">
            <input type="checkbox" value="${esc(c.k)}" ${c.lock || cols.includes(c) ? 'checked' : ''} ${c.lock ? 'disabled' : ''} />
            <span>${esc(c.head)}${c.lock ? ' <span class="s-pick-role">always</span>' : ''}</span>
          </label>`).join('')}
          ${manual ? '<button class="s-more-clear" type="button" data-cols-auto>Back to automatic</button>'
            : '<p class="s-cols-note">Automatic: a column with nothing in it is not drawn.</p>'}
        </div>
      </div>
    </div>
    <div class="s-table-wrap">
      <table class="dtable s-table">
        <thead><tr>
          ${pick ? `<th scope="col" class="s-td-tick">
            <label class="s-tick-hit"><input type="checkbox" class="s-tick-all" ${allOn ? 'checked' : ''} aria-label="Select every row on this page" /></label>
          </th>` : ''}
          ${cols.map((c) => `<th scope="col"${c.num ? ' class="s-td-num"' : ''}>${esc(c.head)}</th>`).join('')}
          ${anyAct ? '<th scope="col"><span class="s-sr">Action</span></th>' : ''}
        </tr></thead>
        <tbody>${list.map((r) => {
          const ex = exOf(r);
          const tone = tk ? TASK_STATE[taskState(r)].tone : toneOf(statusOf(r));
          /* THE WHOLE ROW OPENS THE RECORD. Reaching for a checkbox to look
             at something is the tax V1's table charged on every row; the
             tick is for picking, and picking is the rarer job. */
          return `<tr class="s-tr st-${esc(tone)}${SEL.has(r.id) ? ' is-picked' : ''}" data-row="${esc(r.id)}">
            ${pick ? `<td class="s-td-tick"><label class="s-tick-hit"><input type="checkbox" class="s-tick" value="${esc(r.id)}" ${SEL.has(r.id) ? 'checked' : ''} aria-label="Select ${esc(r.name)}" /></label></td>` : ''}
            ${cols.map((c) => `<td${c.num ? ' class="s-td-num"' : ''}>${c.cell(r)}</td>`).join('')}
            ${anyAct ? `<td class="s-td-act">${ex ? `<button class="btn btn-ghost btn-sm" type="button" data-${tk ? 'taskgo' : 'exit'}="${esc(r.id)}">${esc(ex.label)}</button>` : ''}</td>` : ''}
          </tr>`;
        }).join('')}</tbody>
      </table>
    </div>
    ${dropped ? `<p class="s-table-note">${esc(plural(dropped, 'column'))} ${dropped === 1 ? 'is' : 'are'} empty for this filter and ${dropped === 1 ? 'is' : 'are'} not drawn.</p>` : ''}
    ${pager(all.length, page, pages, per, from, list.length)}`;
  }

  function pager(total, page, pages, per, from, shown) {
    if (!total) return '';
    const win = [];
    for (let i = 1; i <= pages; i++) {
      if (i === 1 || i === pages || Math.abs(i - page) <= 1) win.push(i);
      else if (win[win.length - 1] !== '…') win.push('…');
    }
    return `<div class="s-pager">
      <label class="s-per">Rows per page
        <select class="s-per-sel" aria-label="Rows per page">
          ${[25, 50, 100].map((n) => `<option value="${n}"${n === per ? ' selected' : ''}>${n}</option>`).join('')}
        </select>
      </label>
      <span class="s-pager-said">Showing ${from + 1}–${from + shown} of ${total}</span>
      ${pages > 1 ? `<div class="pager s-pager-nav">
        <button class="s-page-btn" type="button" data-gopage="${page - 1}" ${page === 1 ? 'disabled' : ''} aria-label="Previous page">‹</button>
        ${win.map((n) => n === '…'
          ? '<span class="s-page-gap">…</span>'
          : `<button class="s-page-btn${n === page ? ' is-here' : ''}" type="button" data-gopage="${n}"${n === page ? ' aria-current="page"' : ''}>${n}</button>`).join('')}
        <button class="s-page-btn" type="button" data-gopage="${page + 1}" ${page === pages ? 'disabled' : ''} aria-label="Next page">›</button>
      </div>` : ''}
    </div>`;
  }

  /* The scope bar. The library's `.set-scope-bar` exists for exactly this:
     bulk work over a filtered selection, where the SCOPE STATEMENT is the
     component's reason for existing. "Apply to selection" without saying
     what the selection is makes blast radius invisible at the moment it
     matters most. */
  function scopeBar() {
    if (!SEL.size) return '';
    const recs = selectedIds().map(recBy).filter(Boolean);
    const accs = toAccountIds(recs).length;
    return `<div class="set-scope-bar s-scope">
      ${/* The noun agrees with the number. It read "1 accounts picked",
            which is the kind of small wrongness that makes a surface feel
            like it is not looking at what it is describing. */ ''}
      <span class="ss-count"><span class="ss-num">${SEL.size}</span> <span class="ss-scope">${esc((S.on === 'contacts' ? 'contact' : 'account') + (SEL.size === 1 ? '' : 's'))} picked${accs !== SEL.size ? `, at ${esc(plural(accs, 'account'))}` : ''}</span></span>
      <span class="ss-actions">
        <button class="btn btn-brand btn-sm" type="button" data-newlist>New campaign</button>
        <button class="btn btn-ghost btn-sm" type="button" data-addsel>Add to a campaign</button>
      </span>
      <button class="ss-clear" type="button" data-clearsel>Clear</button>
    </div>`;
  }

  /* Provenance on the cell, not in a footnote. An estimate and a stated
     fact are not the same number, and V1 printed them identically. */
  function confDot(c) {
    return `<span class="s-conf s-conf-${esc(c.conf)}" title="${esc(c.conf)} confidence · ${esc(c.src)} · ${esc(fmtDate(c.at))}"></span>`;
  }

  /* ═══════════════════════════════════════════════
     THE LIST SHEET

     A list is a filter that persists, so it has no page: filtering to one
     shows its members, and its NAME on the result line opens this — the
     description, who is on it, the plan if it has one, and the numbers.

     ONE SHEET FOR BOTH KINDS. A campaign is a list with a plan, so the plan
     block is the only thing that differs, and a list without one offers to
     become a campaign rather than hiding the possibility.
  ═══════════════════════════════════════════════ */

  /* ── A task, opened ──

     EVERY TASK HAS A STOP. The same rule as every status having an exit, and
     for the same reason: work you cannot end is work that owns you. What the
     stop means differs by state and is said rather than assumed — stopping a
     send that has gone to eighteen people does not unsend eighteen emails,
     and a control that let somebody believe it did would be worse than no
     control at all.

     `undo` appears only where the task WROTE something. A crawl that
     collected nothing has nothing to undo, and offering it anyway teaches
     people that undo here is decorative. */
  function taskSheet(ov) {
    const t = DB.taskBy[S.task];
    if (!t || !entitledTask(t)) { ov.hidden = true; return; }
    const st = taskState(t);
    const on = maySee(tasksRecords(t));
    const live = ['queued', 'running', 'paused', 'needs-you'].includes(st);

    return `<div class="s-rec s-camp-page">
      <div class="s-rec-main">
        <button class="s-back" type="button" data-close-camp>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg>
          Back to campaigns
        </button>
      <div class="s-sheet-head">
        <div class="s-sheet-head-main">
          <div class="s-sheet-kind">
            ${aiMark()}${esc(TASK_KIND[t.kind].label)}
            <span class="s-camp-state tone-${esc(TASK_STATE[st].tone)}">${esc(TASK_STATE[st].label)}</span>
          </div>
          <h2 class="s-sheet-name">${esc(t.title)}</h2>
          <p class="s-sheet-when">
            ${esc(actor(t.by).name)} started it ${esc(fmtAgo(t.at))}
            ${t.camp ? ` · ${esc(campName(t.camp))}` : ''}
          </p>
          ${/* Why it ended early, under the state that says it did. A stop
                without its reason leaves the next person to guess whether it
                worked, ran out, or was overtaken. */ ''}
          ${t.stopWhy ? `<div class="inline-note"><span class="dot"></span>${esc(t.stopWhy.why)} <span class="s-why-who">— ${esc(actor(t.stopWhy.by).name)}, ${esc(fmtAgo(t.stopWhy.at))}</span></div>` : ''}
        </div>
        <button class="modal-close" type="button" data-sheet-close aria-label="Close">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      <p class="s-sheet-brief">${esc(taskProgress(t))}</p>

      ${st === 'needs-you' ? `<div class="banner is-warn s-task-block">
        <div class="banner-body">
          <strong>It stopped and is waiting on you.</strong>
          ${esc(t.blocked.why)} Nothing has moved since ${esc(fmtAgo(t.blocked.since))}.
        </div>
      </div>` : ''}

      ${t.take ? `<div class="s-sheet-block">
        <h3 class="s-sheet-h">How far it got</h3>
        <div class="s-task-nums">
          <span class="s-task-num"><b>${t.done}</b> done</span>
          ${t.failed ? `<span class="s-task-num is-fail"><b>${t.failed}</b> failed</span>` : ''}
          <span class="s-task-num is-left"><b>${Math.max(0, t.take - t.done - t.failed)}</b> to go</span>
        </div>
        ${live && t.next ? `<p class="s-task-next">Next: ${esc(t.next)}.</p>` : ''}
      </div>` : ''}

      ${on.length ? `<div class="s-sheet-block">
        <h3 class="s-sheet-h">What it is touching</h3>
        <div class="s-camps">${on.slice(0, 8).map((r) => `<button class="chip default s-camp-chip" type="button" data-open="${esc(r.id)}">${esc(r.name)}</button>`).join('')}</div>
        ${on.length > 8 ? `<p class="s-cols-note">${on.length - 8} more.</p>` : ''}
      </div>` : ''}

      <div class="s-sheet-foot">
        ${on.length ? `<button class="btn btn-brand btn-sm" type="button" data-quick="ids=${esc(on.map((r) => r.id).join(','))}&on=accounts">Show them on the surface</button>` : ''}
        ${/* Pause is not offered on a task that is already stopped. A
              needs-you task has stopped and is waiting on a person, so
              "Pause it" there is a control whose effect is nothing —
              indistinguishable, from the outside, from a broken one. */ ''}
        ${canWrite() && live ? `
          ${st === 'needs-you' ? `<button class="btn btn-ghost btn-sm s-ai-btn" type="button" data-taskgo="${esc(t.id)}">${aiMark()}Decide</button>` : ''}
          ${st === 'needs-you' ? ''
            : st !== 'paused' ? `<button class="btn btn-ghost btn-sm" type="button" data-taskpause="${esc(t.id)}">Pause it</button>`
            : `<button class="btn btn-ghost btn-sm" type="button" data-taskpause="${esc(t.id)}">Start it again</button>`}
          <button class="btn btn-ghost btn-sm" type="button" data-taskstop="${esc(t.id)}">Stop it</button>
        ` : ''}
        ${canWrite() && t.wrote ? `<button class="btn btn-ghost btn-sm" type="button" data-taskundo="${esc(t.id)}">Undo what it did</button>` : ''}
      </div>`;
  }

  function settingsSheet() {
    const ov = $('#setOverlay');
    if (!ov) return;
    /* A task opens in the same sheet a campaign does. It is the same kind of
       thing to the surface — a named piece of work with a state and a set of
       records — and giving it its own overlay would have been a second sheet
       that has to be dismissed the same way and drifts in every other. */
    if (S.task) { taskSheet(ov); return; }
    ov.hidden = true;
  }

  /* ═══════════════════════════════════════════════
     A CAMPAIGN IS A PAGE, THE WAY A LEAD IS

     It used to be a 600px modal, and the content outgrew the box: a
     description, an assignee list, a distribution over eight statuses, a
     plan, a Knowledge brief and four actions. Worse than cramped — it was a
     LAYER, and layers stack. Measured before this pass: opening a campaign
     and pressing its own "Start it" left the sheet, the canvas and a commit
     all open at once, three deep, with cancel able only to peel the top one.

     Now `?camp=<k>` opens it exactly as `?lead=<id>` opens an account: full
     width, one Back button, and nothing over anything. The whole class of
     stacking bug cannot happen here because there is no longer a layer.
  ═══════════════════════════════════════════════ */
  const campRaw = () => (S.camp ? DB.campBy[S.camp] || null : null);

  /* Entitled by the same rule the list uses, so a URL is never more
     permissive than the tab it came from. */
  function openCamp() {
    const c = campRaw();
    if (!c) return null;
    return filteredCampaigns({ all: false }).includes(c) ? c : null;
  }

  function campPage(l) {
    const st = campState(l);
    const members = maySee(DB.acc).filter((a) => l.members.includes(a.id) && !a.arch);
    const by = {};
    members.forEach((a) => (by[statusOf(a)] = (by[statusOf(a)] || 0) + 1));
    const sent = maySeeTouch(DB.touch).filter((t) => t.list === l.k);
    const auto = sent.filter((t) => t.by === 'aimy');
    const kb = l.kb ? KB_BY[l.kb] : null;
    const running = st === 'running';
    /* `?in=` narrows within THIS campaign. Its own key, so the corpus filter
       you had before you opened it is still there when you leave. */
    const narrowed = !!S.in;
    const shown = narrowed ? members.filter((a) => statusOf(a) === S.in) : members;

    return `<div class="s-rec s-camp-page">
      <div class="s-rec-main">
        <button class="s-back" type="button" data-close-camp>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg>
          Back to campaigns
        </button>
      <div class="s-sheet-head">
        <div class="s-sheet-head-main">
          <div class="s-sheet-kind">
            Campaign
            <span class="s-camp-state tone-${esc(CAMP_STATE[st].tone)}">${esc(CAMP_STATE[st].label)}</span>
          </div>
          <h2 class="s-sheet-name">${esc(l.name)}</h2>
          <p class="s-sheet-when">
            ${l.from ? `${esc(fmtDate(l.from))}&thinsp;–&thinsp;${esc(fmtDate(l.to))}` : 'Not started'}
            · ${esc(actor(l.owner).name)} owns it
          </p>
          ${l.stopWhy ? `<div class="inline-note"><span class="dot"></span>${esc(l.stopWhy.why)} <span class="s-why-who">— ${esc(actor(l.stopWhy.by).name)}, ${esc(fmtAgo(l.stopWhy.at))}</span></div>` : ''}
        </div>
        ${/* THE PRIMARY IS WHAT THIS CAMPAIGN NEEDS NEXT, derived from its
              state exactly as a lead's card exit is. It used to be "Show its
              accounts" — navigation — while "Start it", the only thing a
              draft actually needs, sat buried below a distribution table. */ ''}
        ${canWrite() && campExit(l) ? `<button class="entry-action ${esc(campExit(l).mode)} s-camp-primary" type="button" ${campExit(l).attr}>${esc(campExit(l).label)}</button>` : ''}
      </div>
      <div class="s-camp-body">
      ${/* Prose, not a quote panel. The block treatment was sized for a
            paragraph and a four-character description made it a mostly
            empty box. */ ''}
      ${l.description ? `<p class="s-camp-desc">${esc(l.description)}</p>` : ''}

      <div class="s-sheet-block">
        <h3 class="s-sheet-h">Who is on it</h3>
        <div class="s-assignees">
          <span class="s-assignee is-owner"><span class="avatar avatar-sm">${esc(actor(l.owner).initials)}</span>${esc(actor(l.owner).name)}<span class="s-assignee-role">owner</span></span>
          ${l.assignees.map((id) => `<span class="s-assignee"><span class="avatar avatar-sm">${esc(actor(id).initials)}</span>${esc(actor(id).name)}</span>`).join('')}
          <button class="btn btn-ghost btn-sm" type="button" data-assign="${esc(l.k)}">${l.assignees.length ? 'Change' : 'Assign someone'}</button>
        </div>
      </div>

      <div class="s-sheet-block">
        <h3 class="s-sheet-h">Where its ${esc(plural(members.length, 'account'))} stand</h3>
        ${/* The bar carries the proportion. Eight numbers in a column is a
              shape you have to compute; this block exists to show one. */ ''}
        ${(() => {
          if (!members.length) return `<p class="s-none">Nothing on it yet.</p>`;
          const spread = TAX.status.filter((x) => by[x.k]);
          /* A DISTRIBUTION OF ONE IS NOT A DISTRIBUTION. Drawing a 100% bar
             for "all 30 untouched" reads as a progress meter stuck at full,
             which is a different and wrong claim. One status says so. */
          if (spread.length === 1) {
            const only = spread[0];
            return `<button class="s-ans-row s-ans-one" type="button" data-quick2="on=accounts&campaign=${esc(l.k)}&camp=">
              <span class="s-ans-name tone-${esc(only.tone)}">All ${esc(plural(members.length, 'account'))} are ${esc(only.label.toLowerCase())}</span>
            </button>`;
          }
          /* THE ROW IS THE TARGET. Eight rows each carrying a Show button is
             the card-CTA defect again — a button that duplicates its own
             container, eight times in one page. */
          return spread.map((x) => `<button class="s-ans-row s-ans-hit${S.in === x.k ? ' is-on' : ''}" type="button" data-cstatus="${esc(x.k)}">
            <span class="s-ans-name tone-${esc(x.tone)}">${esc(x.label)}</span>
            <span class="s-ans-bar tone-${esc(x.tone)}" role="presentation"><span style="width:${Math.round((by[x.k] / members.length) * 100)}%"></span></span>
            <span class="s-ans-fact">${by[x.k]}</span>
          </button>`).join('');
        })()}
      </div>

      <div class="s-sheet-block">
        <h3 class="s-sheet-h">${st === 'draft' ? 'Not started yet' : 'The plan'}</h3>
        ${l.plan && l.plan.length
          ? `<div class="s-camps">${l.plan.map((p) => `<span class="chip default">${esc(label('channel', p))}</span>`).join('')}</div>
             <p class="s-sheet-note">${esc(plural(sent.length, 'touchpoint'))} credited to it${auto.length ? `, ${auto.length} of them AiMY&rsquo;s` : ', none of them AiMY&rsquo;s'}.</p>`
          /* A draft is safe to assemble; starting it is the moment that
             changes, so that is the moment the surface makes explicit. */
          : `<p class="s-none">Nobody has decided how to work this yet, so nothing sends. Choose the channels and a window to start it — after that AiMY works the plan, and anything it sends is logged as AiMY&rsquo;s.</p>
             `}
      </div>

      ${/* The sheet keeps the card rather than the one-line form the record
            uses. The difference is what you came for: a record is about a
            lead and the brief is a footnote, but this sheet IS the campaign,
            and its brief is the thing being inspected. */ ''}
      ${kb ? `<div class="s-sheet-block">
        <h3 class="s-sheet-h">Its brief in Knowledge</h3>
        ${kbCard(kb)}
      </div>` : ''}

      ${/* ITS ACCOUNTS ARE ON THIS PAGE, NOT BEHIND A LINK OUT.

            "Show its accounts" used to jump to the global list filtered by
            this campaign — fifteen dropdowns above a header reading "15
            accounts in q3". You were inside the thing and outside it at the
            same time, and nothing said which filters applied to which. The
            question it produced was exactly "am I filtering inside what I
            opened, or globally again?"

            Now the campaign holds them. The controls above this list narrow
            WITHIN its members and say so; the global filter row is not
            rendered on a page at all. */ ''}
      <div class="s-sheet-block">
        <div class="s-camp-list-head">
          <h3 class="s-sheet-h">${narrowed
            ? `${shown.length} <span class="s-camp-of">of ${esc(plural(members.length, 'account'))}</span> in it`
            : `${esc(plural(members.length, 'account'))} in it`}</h3>
          <div class="s-camp-list-tools">
            ${TAX.status.filter((x) => by[x.k]).map((x) => `<button class="chip${S.in === x.k ? ' active' : ' default'} s-camp-fchip" type="button" data-cstatus="${esc(x.k)}">${esc(x.label)} ${by[x.k]}</button>`).join('')}
            ${narrowed ? `<button class="s-inline-btn" type="button" data-cstatus="">Show all ${members.length}</button>` : ''}
          </div>
        </div>
        ${shown.length
          ? `<div class="s-grid s-camp-grid">${shown.map((r, i) => card(r, i)).join('')}</div>`
          : `<p class="s-none">None of its accounts are ${esc(label('status', S.in).toLowerCase())}.</p>`}
      </div>

      </div>
      <div class="s-camp-foot">
        ${canWrite() ? `
        ${campExit(l) && campExit(l).k !== 'addto' ? `<button class="btn btn-ghost btn-sm" type="button" data-addto="${esc(l.k)}">Add contacts</button>` : ''}
        <button class="btn btn-ghost btn-sm" type="button" data-merge="${esc(l.k)}">Merge</button>
        <button class="btn btn-ghost btn-sm" type="button" data-assign="${esc(l.k)}">Assign</button>
        ${running ? `<button class="btn btn-ghost btn-sm" type="button" data-stop="${esc(l.k)}">Stop it</button>` : ''}` : ''}
      </div>
      </div>
    </div>`;
  }

  /* One action per state, declared as data — the same shape `exitFor` uses
     for a lead, so the two derivations read alike and neither invents its
     own vocabulary. */
  function campExit(l) {
    const st = campState(l);
    if (st === 'draft') return { k: 'plan', label: 'Start it', mode: 'em-direct', attr: `data-plan="${esc(l.k)}"` };
    if (st === 'running') return { k: 'addto', label: 'Add contacts', mode: 'em-direct', attr: `data-addto="${esc(l.k)}"` };
    return null;
  }

  function empty() {
    /* Two different nothings. "No lead matches these filters" and "there
       are no leads" ask for opposite things, and one message for both sends
       somebody hunting for a filter that was never on. */
    if (!DB.acc.length && !DB.con.length) return emptyCorpus();
    /* Nothing running is the good state, and it should read as one. A task
       list is the only surface here where empty is what you want. */
    if (onTasks() && !filteredTasks({ all: true }).length && !anyTaskFilter()) {
      return `<div class="empty-state s-empty">
        <div class="empty-state-title">Nothing is running</div>
        <p class="empty-state-desc">AiMY has no work in flight for you. Ask it to send, enrich, schedule or prepare something and it will appear here while it happens.</p>
      </div>`;
    }
    return `<div class="empty-state s-empty">
      <div class="empty-state-title">Nothing matches</div>
      <p class="empty-state-desc">No ${onTasks() ? 'task' : onCamps() ? 'campaign' : onTeam() ? 'person' : S.on === 'contacts' ? 'contact' : 'account'} is in every one of these filters at once. Removing the narrowest one usually brings something back.</p>
      <button class="btn btn-brand" type="button" data-clear-all>Clear the filters</button>
    </div>`;
  }

  /* ═══════════════════════════════════════════════
     THE RECORD PAGE — and the one docked thread on this surface

     `?lead=<id>` renders INSTEAD of the grid, in the same region, and the
     briefing rail and the filter row step aside while it does: a record is
     a page, and a filter row above a page is a control for something that
     is not on screen.

     THE DOCKED THREAD IS THE DECLARED DEVIATION. AIMY-1288 and AIMY-1208
     ask for a split pane — chat left, canvas right, after Clay. Knowledge's
     direction §5.1 rejects exactly that shape, and AIMY-1288 also says
     "same pattern as AiMY Knowledge workbench", so the ticket asks for both
     at once. This is the resolution: no column anywhere on the surface, and
     one here, because a touchpoint log genuinely IS a thread — it is a
     sequence of exchanges with one counterparty, in time order, that you
     add to by writing at the bottom. That is not a chat panel borrowed for
     a table; it is the shape the data already has.

     It sits on the right rather than the left. The ticket says chat-left,
     and Clay puts Claygent there, but the thread is not the copilot: it is
     the record's own history, and the record reads left. The copilot is
     still the float bar and the overlay, everywhere including here.
  ═══════════════════════════════════════════════ */

  /* THE URL IS A DOOR, AND ENTITLEMENT HAS TO BE ON IT.

     Filtering the grid is not enough. `?lead=a10` addresses a record
     directly and never passes through `filtered()`, so a client pasting a
     colleague's link — or keeping their own from before an engagement
     ended — walked straight into a record outside their engagement. Every
     way in has to answer the same question, and this is the last one. */
  function openRec() {
    const rec = leadRaw();
    return rec && entitled(rec) ? rec : null;
  }
  const leadRaw = () => (S.lead ? DB.accBy[S.lead] || DB.conBy[S.lead] || null : null);

  /* Why the door did not open. A blank surface where a record was asked for
     is the same defect as a count that quietly shrinks: something happened
     and nothing said so. The two reasons are different and are said
     differently — one is a record that is not yours, one is a record that is
     not there, and telling a person the wrong one sends them looking in the
     wrong place. */
  function leadDenial() {
    if (!S.lead) return null;
    const rec = leadRaw();
    if (!rec) return { title: 'That record is not here', body: 'The link points at something this workspace does not hold. It may have been merged into another record, or removed.' };
    /* The same answer as a record that genuinely is not here. The two used
       to be distinguished — "not yours" against "not here" — so that a
       refused door said which of the two it was. Under clean scoping they
       are one answer, because saying "not yours" confirms the record
       exists, which is the thing being withheld. */
    if (!entitled(rec)) {
      return { title: 'That record is not here', body: 'The link points at something this workspace does not hold. It may have been merged into another record, or removed.' };
    }
    return null;
  }

  function recordPage(rec) {
    const acc = accOf(rec);
    const st = statusOf(rec);
    const exit = exitFor(rec);
    const ts = touchesFor(rec);

    /* Facts are phrases, not labels. `FOUNDED YEAR` stacked over `1891` is
       two things to read where one would do, and V1 stacked twelve of them. */
    const facts = [];
    if (rec.kind === 'acc') {
      if (acc.emp != null) facts.push(`${fmtSize(acc.emp)}`);
      facts.push(label('industry', acc.industry));
      facts.push(`${acc.city}, ${acc.country}`);
      if (acc.founded) facts.push(`Founded ${acc.founded}`);
      facts.push(`Came in through ${label('src', acc.src).toLowerCase()}`);
    } else {
      facts.push(rec.role);
      facts.push(`at ${acc.name}`);
      if (rec.phone) facts.push(rec.phone);
    }

    const cons = rec.kind === 'acc' ? DB.con.filter((c) => c.acc === acc.id) : [];

    return `<div class="s-rec">
      <div class="s-rec-main">
        <button class="s-back" type="button" data-close-rec>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg>
          Back to ${esc(S.on === 'contacts' ? 'contacts' : 'accounts')}
        </button>

        <header class="s-rec-head">
          <div class="s-rec-kind">${chIcon(rec.kind === 'acc' ? 'building' : 'person')}${rec.kind === 'acc' ? 'Account' : 'Contact'}</div>
          <h1 class="s-rec-name">${esc(rec.name)}</h1>
          <div class="s-rec-status">
            <span class="s-meta-st tone-${toneOf(st)}">${esc(label('status', st))}</span>
            <span class="s-rec-because">${esc(because(rec))}</span>
            ${rec.override ? `<button class="s-inline-btn" type="button" data-override="${esc(rec.id)}">change it</button>` : ''}
          </div>
          <p class="s-rec-facts">${facts.map(esc).join(' · ')}</p>
          ${rec.outcomeWhy ? `<div class="inline-note"><span class="dot"></span>${esc(rec.outcomeWhy)}</div>` : ''}
          ${canWrite() ? `<div class="s-rec-actions">
            ${exit ? `<button class="entry-action ${exit.mode}" type="button" data-exit="${esc(rec.id)}">${esc(exit.label)}</button>` : ''}
            ${rec.kind === 'con' && rec.phone ? `<button class="btn btn-ghost btn-sm" type="button" data-call="${esc(rec.id)}">${chIcon('phone')}Call</button>` : ''}
            <button class="btn btn-ghost btn-sm" type="button" data-share="${esc(rec.id)}">Share</button>
            <button class="btn btn-ghost btn-sm" type="button" data-override="${esc(rec.id)}">Set status by hand</button>
            <button class="btn btn-ghost btn-sm" type="button" data-archive="${esc(rec.id)}">${rec.arch ? 'Bring it back' : 'Archive'}</button>
          </div>` : `<div class="s-readonly">${lockMark()}You can read this record. Changing it is not something this account does.</div>`}
        </header>

        ${rec.next ? nextStepBlock(rec) : ''}
        ${recBlocks(rec, acc, cons)}
      </div>
    </div>`;
  }

  /* The status, in one sentence, from the same facts that computed it. A
     computed status that will not say why it is what it is asks to be taken
     on faith, which is the whole thing this product replaced. */
  function because(rec) {
    const st = statusOf(rec);
    /* An override says WHY, not just who. This line is the whole thesis in
       one sentence, and while the override carried no reason it made the
       record say strictly less than it knew before somebody touched it —
       "set by Nour on 5 Aug" in place of "they came back 3 months ago and
       nobody has answered". Who and when stay, because an attested value
       that is not attributed is the model this replaced. */
    if (rec.override) {
      const who = `${actor(rec.override.by).name}, ${fmtAgo(rec.override.at)}`;
      return rec.override.why ? `${rec.override.why} — set by ${who}` : `set by ${who}`;
    }
    const ts = touchesFor(rec);
    const last = ts[0];
    switch (st) {
      case 'untouched':  return 'nobody has contacted them';
      case 'awaiting-us':
        if (last && last.dir === 'in') return `they came back ${fmtAgo(last.at)} and nobody has answered`;
        return `${rec.next.what.toLowerCase()} was due ${fmtAgo(rec.next.due)}`;
      case 'stalled':    return `${rec.next.what.toLowerCase()} is ${plural(daysAgo(rec.next.due), 'day')} past its date`;
      case 'going-cold': return `nothing since ${fmtAgo(last.at)}, and nothing scheduled`;
      case 'awaiting-them':
        return rec.next
          ? `${rec.next.what.toLowerCase()} ${fmtInPhrase(-daysAgo(rec.next.due))}`
          : `we moved last, ${fmtAgo(last.at)}`;
      case 'won':        return 'closed won';
      case 'lost':       return 'closed lost';
      case 'not-a-fit':  return 'disqualified against the ICP';
      default:           return '';
    }
  }

  function nextStepBlock(rec) {
    const over = daysAgo(rec.next.due);
    return `<div class="s-next${over > 0 ? ' is-over' : ''}">
      <div class="s-next-what">${esc(rec.next.what)}</div>
      <div class="s-next-when">${over > 0 ? `${plural(over, 'day')} overdue — was due ${esc(fmtDate(rec.next.due))}` : `Due ${esc(fmtDate(rec.next.due))}, ${esc(fmtIn(-over))}`} · ${esc(actor(rec.next.by).name)}</div>
      <button class="btn btn-ghost btn-sm" type="button" data-reschedule="${esc(rec.id)}">Reschedule</button>
    </div>`;
  }

  function recBlocks(rec, acc, cons) {
    const out = [];

    /* WHAT IS RUNNING ON THIS RECORD, FIRST. A rep about to phone somebody
       needs to know AiMY emailed them an hour ago before they dial, not
       after — and they will not think to check a task list for it. The one
       place they are certainly looking is the record itself.

       Live work only. A finished task is already in the timeline below as
       the touchpoints it made; repeating it here would be the same event
       twice, once as history and once as news. */
    const live = tasksOn(rec).filter((t) => ['running', 'queued', 'needs-you', 'paused'].includes(taskState(t)));
    if (live.length) {
      out.push(`<div class="s-runline">
        <span class="s-kbline-mark">${aiMark()}</span>
        <span class="s-kbline-text">${live.map((t) => {
          const st = taskState(t);
          return `<button class="s-inline-btn" type="button" data-task="${esc(t.id)}">${esc(t.title)}</button>
            <span class="s-run-st tone-${esc(TASK_STATE[st].tone)}">${esc(TASK_STATE[st].label.toLowerCase())}</span>`;
        }).join('<span class="s-kbline-sep"> · </span>')}</span>
      </div>`);
    }

    if (rec.kind === 'acc' && cons.length) {
      out.push(block('People here', `<div class="s-people">
        ${cons.map((c) => {
          const cst = statusOf(c);
          const cts = touchesFor(c);
          return `<button class="s-person" type="button" data-open="${esc(c.id)}">
            <span class="avatar avatar-sm">${esc(c.name.split(' ').map((w) => w[0]).join('').slice(0, 2))}</span>
            <span class="s-person-main">
              <span class="s-person-name">${esc(c.name)}</span>
              <span class="s-person-role">${esc(c.role)}</span>
            </span>
            <span class="s-person-st tone-${toneOf(cst)}">${esc(cts.length ? touchPhrase(cts[0]) : 'never contacted')}</span>
          </button>`;
        }).join('')}
      </div>`));
    }

    if (rec.kind === 'con') {
      out.push(block('Reaching them', `<div class="s-reach">
        ${rec.email ? reachRow('Email', rec.email, rec.enrich.email, touchesFor(rec).some((t) => t.outcome === 'bounced') ? rec.id : null) : ''}
        ${rec.phone ? reachRow('Phone', rec.phone, null) : ''}
        ${rec.li ? reachRow('LinkedIn', rec.li, null) : ''}
      </div>`));
    }

    /* Lists and campaigns are one object, so this is one block. The chip
       says which kind it is, because a list with a plan will send on your
       behalf and a list without one will not — that is the whole difference,
       and it belongs on the chip rather than in a second section. */
    const mine = campsOf(rec).map((k) => DB.campBy[k]).filter(Boolean);
    out.push(block('Campaigns', mine.length
      ? `<div class="s-camps">${mine.map((c) => {
          const st = campState(c);
          return `<span class="s-camp-pair"><button class="chip default s-camp-chip" type="button" data-camp="${esc(c.k)}">${esc(c.name)}<span class="s-camp-state tone-${esc(CAMP_STATE[st].tone)}">${esc(CAMP_STATE[st].label)}</span></button><button class="s-camp-out" type="button" data-uncamp="${esc(rec.id)}|${esc(c.k)}" aria-label="Take it out of ${esc(c.name)}">×</button></span>`;
        }).join('')}
        <button class="btn btn-ghost btn-sm" type="button" data-addlist="${esc(rec.id)}">Add to another</button></div>`
      : `<p class="s-none">In no campaign. <button class="s-inline-btn" type="button" data-addlist="${esc(rec.id)}">Add it to one</button></p>`));

    const shared = rec.shared || [];
    out.push(block('Who can see this', `<div class="s-share">
      <span class="s-share-own"><span class="avatar avatar-sm">${esc(actor(rec.owner).initials)}</span>${esc(actor(rec.owner).name)} owns it</span>
      ${shared.length
        ? `<span class="s-share-with">shared with ${shared.map((id) => `<button class="s-inline-btn" type="button" data-gofilter="shared:${esc(id)}" title="See everything shared with ${esc(actor(id).name)}">${esc(actor(id).name)}</button>`).join(', ')}</span>`
        : `<span class="s-none">not shared with anyone</span>`}
    </div>`));

    /* ── What Knowledge holds ──
       This used to be a block of cards: 402px of a 956px record, three
       objects, six buttons, and a solid primary on every one. Nobody opens a
       lead to browse documents, and the block conflated two different things
       — the ICP is provenance for a claim the page already makes, while the
       story and the deck are ammunition for a message not yet written.

       So: one line, naming what is there, opening it where reading happens.
       The retrieval AIMY-1253 asks for is unchanged; only its weight is. */
    const kb = knowledgeFor(rec, acc);
    if (kb.length) out.push(kbLine(kb, acc));

    return out.join('');
  }

  function block(title, body, sub) {
    return `<section class="s-block">
      <h2 class="s-block-title">${esc(title)}</h2>
      ${sub ? `<p class="s-block-sub">${esc(sub)}</p>` : ''}
      ${body}
    </section>`;
  }

  function reachRow(what, val, conf, bouncedFor) {
    return `<div class="s-reach-row">
      <span class="s-reach-what">${esc(what)}</span>
      <span class="s-reach-val">${esc(val)}</span>
      ${conf ? confBadge(conf) : ''}
      ${bouncedFor ? `<button class="btn btn-ghost btn-sm" type="button" data-fixaddr="${esc(bouncedFor)}">Bounced — fix it</button>` : ''}
    </div>`;
  }

  /* Confidence, where it changes interpretation (doctrine §5.7). A scraped
     address at low confidence is a guess, and a rep who sends to it without
     being told that will read the silence as disinterest. Medium and low
     must also state what limits them. */
  function confBadge(c) {
    const why = { high: 'Verified against the company domain', medium: 'Pattern-matched from two known addresses', low: 'Guessed from the name and domain alone' }[c.conf];
    return `<span class="conf-badge conf-${esc(c.conf)}" title="${esc(why)}">
      <span class="conf-meter"><i></i><i></i><i></i></span>
      <span class="conf-val">${esc(c.conf)}</span>
    </span>`;
  }

  /* Which Knowledge objects this lead pulls. Matched on the ICP it resolved
     to, the service it would buy, and any campaign brief it is inside —
     which is the query pattern AIMY-1253 asks to be defined. */
  function knowledgeFor(rec, acc) {
    const want = new Set();
    if (acc.icp) want.add(acc.icp);
    (campsOf(rec)).forEach((k) => {
      const c = DB.campBy[k];
      if (c && c.kb) want.add(c.kb);
    });
    const svc = rec.svc || acc.svc;
    KB.forEach((k) => {
      if (k.type === 'story' && k.svc === svc) want.add(k.id);
      if (k.type === 'asset' && k.svc === svc) want.add(k.id);
    });
    return [...want].map((id) => KB_BY[id]).filter(Boolean).slice(0, 4);
  }

  const KB_TYPE = { icp: 'ICP', story: 'Success story', asset: 'Sales asset', campaign: 'Campaign brief', webpage: 'Scrape', article: 'Article' };
  const TRUST_LABEL = { verified: 'Verified', due: 'Review due', expired: 'Expired', unverified: 'Unverified', superseded: 'Superseded' };

  /* One line on the record, in place of a block of cards.

     The ICP is named because it is the reason the lead is here at all —
     provenance for a claim the page is already making, so it reads as a
     sentence rather than as a document. Everything else is counted, not
     listed: a rep reading where a lead stands does not need three titles,
     they need to know the material exists and one way to it.

     Trust state shows only when it is NOT verified. This is a deliberate
     narrowing of "trust state carries unchanged": a line that badges every
     object *Verified* teaches people to stop reading badges, and the badge
     exists for the expired one. The full state is on every object in the
     canvas, where it is being read rather than counted. */
  function kbLine(kb, acc) {
    const icp = kb.find((k) => k.type === 'icp' && k.id === acc.icp);
    const rest = kb.filter((k) => k !== icp);

    /* Two targets at most, and each opens exactly what it names — the ICP
       alone, or the sendable material alone. An extra "read them all" would
       be a third button covering the union of the other two, which is the
       same duplication the cards were removed for, one order smaller. */
    const parts = [];
    if (icp) {
      parts.push(`Matched <button class="s-inline-btn" type="button" data-kb="${esc(icp.id)}">${esc(icp.title)}</button>`
        + (icp.trust !== 'verified'
          ? ` <span class="trust-state ts-${esc(icp.trust)}" data-trust-state="${esc(icp.trust)}">${esc(TRUST_LABEL[icp.trust])}</span>`
          : ''));
    }
    if (rest.length) {
      /* THE STALE COUNT IS A CONTROL. It was text, on the argument that a
         button here would open what the button beside it already opens.
         That was wrong twice over: it opens a DIFFERENT set — one object,
         not four — so finding the stale one meant opening four and hunting
         for the badge; and "review" is not "read", so even having found it
         there was nothing to do. A line that names a problem and offers no
         way to it is the shape this whole surface exists to remove. */
      const stale = rest.filter((k) => k.trust !== 'verified');
      parts.push(`<button class="s-inline-btn" type="button" data-kb="${esc(rest.map((k) => k.id).join(','))}">${rest.length} ${icp ? 'more' : 'thing' + (rest.length === 1 ? '' : 's')} to send</button>`
        + (stale.length
          ? `<span class="s-kbline-sep"> — </span><button class="s-inline-btn s-kbline-warn" type="button" data-kb="${esc(stale.map((k) => k.id).join(','))}">${stale.length} need${stale.length === 1 ? 's' : ''} a review</button>`
          : ''));
    }

    return `<div class="s-kbline">
      <span class="s-kbline-mark">${aiMark()}</span>
      <span class="s-kbline-text">${parts.join('<span class="s-kbline-sep"> · </span>')}</span>
    </div>`;
  }

  /* A Knowledge object, read where the conversation is.

     There is no "Open in Knowledge" any more. The canvas already hosts
     Knowledge — it is the retrieval surface this product answers from — so
     sending a rep to another product to read one paragraph ends the piece of
     work they were in the middle of and asks them to find their way back.

     Routing follows the surface's own rule, taken once in `answerBlock`: with
     a record on screen it lands in the rail beside it; with no subject, the
     canvas opens over the work. The object carries everything the card did,
     plus the summary the card had no room for — which is the part a rep
     actually wanted and the reason the card's button existed. */
  function kbRead(ids) {
    const objs = ids.map((i) => KB_BY[i]).filter(Boolean);
    if (!objs.length) return;
    if (!docked()) openCanvas();
    /* The heading frames, it does not repeat: with one object the card below
       already carries its title, and a heading echoing it is the same word
       twice in 40px. */
    answerBlock(
      objs.length === 1 ? 'From AiMY Knowledge' : `${objs.length} things from AiMY Knowledge`,
      objs.map(kbCard).join(''),
    );
  }

  /* A KNOWLEDGE CARD IN THE THREAD IS A WINDOW, NOT A QUOTE.

     Everything else in the conversation is history and stays put — a work
     block that has run records what was decided at that moment, and
     rewriting it would be rewriting the past. A retrieved object is the
     opposite: it is a live view of something that lives elsewhere, and if
     the thing changes the window has to show it.

     Without this, asking for a review set `k.review` on the object, called
     `paint()` — which redraws the surface, not the thread — and left a live
     "Ask Omar to re-verify it" button sitting on a request already sent.
     Clicking it again would have sent a second one. `correctKnowledge` had
     the identical bug and has been on the same footing since it shipped. */
  function repaintKb(kbId) {
    const k = KB_BY[kbId];
    if (!k) return;
    $$(`[data-kbid="${kbId}"]`).forEach((el) => {
      const fresh = document.createElement('div');
      fresh.innerHTML = kbCard(k);
      el.replaceWith(fresh.firstElementChild);
    });
  }

  /* The FULL card, not `.is-compact`. The library's compact variant sets
     `.tc-summary { display: none }`, which is right where a card is a
     reference and wrong where it is the thing being read — and here it is
     the thing being read, since reading it is what replaced the hop to
     Knowledge. Compact was correct for the record block this came from;
     carrying it over would have shipped a reader with the text hidden. */
  function kbCard(k) {
    return `<article class="type-card s-kb-card" data-kbid="${esc(k.id)}">
      <div class="tc-head">
        <span class="tc-type">${esc(KB_TYPE[k.type] || k.type)}</span>
        <span class="trust-state ts-${esc(k.trust)}" data-trust-state="${esc(k.trust)}">${esc(TRUST_LABEL[k.trust] || k.trust)}</span>
      </div>
      <div class="tc-title">${esc(k.title)}</div>
      <p class="tc-summary">${esc(k.summary)}</p>
      <div class="tc-gov">${esc(actor(k.owner).name)}<span class="tc-gov-sep"> · </span>updated ${esc(fmtDate(k.updated))}</div>
      ${/* THE EXIT FROM "REVIEW DUE".

            The badge said an object was stale and the card offered one
            action — report a problem — which is a different thing. "This is
            wrong" and "nobody has checked this lately" are not the same
            claim, and a rep who has no complaint about the content has
            nothing to report; they just want it looked at.

            Reviewing is Knowledge's write, not ours, so this asks rather
            than does — the same boundary the correction loop keeps, and the
            same shape: a request to the owner, marked here immediately so
            the next person can see it has been asked for. */ ''}
      <div class="tc-action">
        ${k.trust !== 'verified'
          ? `<button class="entry-action em-direct${k.review ? ' is-asked' : ''}" type="button" data-kbrev="${esc(k.id)}"${k.review ? ' disabled' : ''}>${k.review ? `${esc(actor(k.review.by).name)} asked ${esc(fmtAgo(k.review.at))}` : `Ask ${esc(actor(k.owner).name.split(' ')[0])} to ${k.trust === 'unverified' ? 'verify' : 're-verify'} it`}</button>`
          : ''}
        <button class="cite-action${k.flagged ? ' is-flagged' : ''}" type="button" data-kbfix="${esc(k.id)}">${k.flagged ? 'Reported' : 'Report a problem'}</button>
      </div>
    </article>`;
  }
  /* ═══════════════════════════════════════════════
     THE COMMIT SURFACE

     Every consequential write goes through this and nothing else. It names
     the record, states the effects BEFORE the button, and closes by
     reporting what it did — so a write is never something that just
     happened somewhere.

     Conversation for the judgement, commit for the consequence.
  ═══════════════════════════════════════════════ */

  let commitRun = null;
  /* Which record the open commit's channel picker is about, so the effects
     line can be rewritten without the handler having to find it again. */
  let chPickRec = null;

  /* ═══════════════════════════════════════════════
     ONE DECISION SURFACE AT A TIME, AND CANCEL PUTS YOU BACK

     There are three: the commit host, the canvas work block, and — until this
     pass — the settings sheet. Each was opened and closed by its own
     handlers, with no rule between them, and the result was measurable:
     opening a campaign and pressing "Start it" left the sheet, the canvas AND
     a commit open at once, three deep. Cancelling removed the top one and
     left the other two, so cancel could not put anybody back anywhere — it
     only peeled a layer.

     The fix is one place rather than thirty. `commit()` and `canvasWork()`
     both go through here, so every one of the 29 call sites is unchanged and
     none of them can forget the rule.

     `cameFrom` is the URL, not a DOM reference, because the surface behind
     may be rebuilt between opening and cancelling — a campaign page redrawn
     by a filter change is a different set of elements describing the same
     place, and the place is what you want back.
  ═══════════════════════════════════════════════ */
  let cameFrom = null;

  function surfacesOpen() {
    return [
      !!$('#commitHost .modal') && 'commit',
      ($('#aimyOverlay') || { classList: { contains: () => false } }).classList.contains('open') && 'canvas',
    ].filter(Boolean);
  }

  /* Everything except the one about to open. Called before any decision
     surface renders, so the count can never exceed one. */
  function closeSurfaces(keep) {
    if (keep !== 'commit') closeCommit();
    /* `endBuild` goes here rather than on the close button, so EVERY way out
       ends the flow — the X, Escape, the backdrop, and opening another
       surface. A flag that only one exit clears is a flag that gets stuck. */
    if (keep !== 'canvas') { endBuild(); dropWork(); closeCanvas(); }
  }

  function openSurface(keep, render) {
    /* Only record the origin when we are not already inside one — a commit
       opened FROM a canvas block should return to where the canvas was
       opened from, not to the canvas. */
    if (!surfacesOpen().length) cameFrom = location.search || '';
    closeSurfaces(keep);
    render();
  }

  /* Cancel is a return, not a dismissal. Restoring the URL puts the record,
     the campaign, the filters and the tab back exactly as they were. */
  function cancelSurface() {
    closeSurfaces(null);
    if (cameFrom !== null && cameFrom !== location.search) {
      history.replaceState(null, '', cameFrom || location.pathname);
      parse(); paint(); paintChrome();
    }
    cameFrom = null;
  }

  function commit(o) {
    openSurface('commit', () => renderCommit(o));
  }

  function renderCommit(o) {
    commitRun = o.run;
    $('#commitHost').innerHTML = `
      <div class="modal-backdrop s-commit-back" data-commit-backdrop>
        <div class="modal s-commit" role="dialog" aria-modal="true" aria-labelledby="commitTitle">
          <div class="modal-header">
            <h2 class="modal-title" id="commitTitle">${esc(o.title)}</h2>
            <button class="modal-close" type="button" data-commit-cancel aria-label="Cancel">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>
          <div class="modal-body">
            ${o.body || ''}
            <div class="s-effects">
              <div class="s-effects-title">What this changes</div>
              ${o.effects.map((e) => `<div class="s-effect is-${esc(e[0])}"${e[2] ? ` data-effect="${esc(e[2])}"` : ''}>${esc(e[1])}</div>`).join('')}
            </div>
          </div>
          ${/* A REQUIRED REASON HOLDS THE BUTTON, RATHER THAN REJECTING AFTER.

                It used to let you pick a status, press Set it, and only then
                say that a reason was needed — which is a rejection dressed
                as an action, and it teaches people that the confirm is a
                guess. The condition is knowable before the click, so it is
                enforced before the click: the button is inert and says what
                is missing, and the moment a reason exists it becomes live.

                The state is on the FOOTER, not only on the button, so the
                requirement reads as a condition of the commit rather than as
                a broken control. */ ''}
          <div class="modal-footer${o.needs ? ' is-blocked' : ''}"${o.needs ? ` data-needs="${esc(o.needs)}"` : ''}>
            ${o.needs ? `<span class="s-needs">${esc(o.needsSay || 'A reason is required.')}</span>` : ''}
            <button class="btn btn-ghost btn-sm" type="button" data-commit-cancel>Cancel</button>
            <button class="btn btn-brand btn-sm" type="button" data-commit-go${o.needs ? ' disabled aria-disabled="true"' : ''}>${esc(o.confirm)}</button>
          </div>
        </div>
      </div>`;
    /* Once on open, so a requirement that is already satisfied — or one that
       names a field this surface does not have — is resolved before anybody
       clicks. Without it the markup's `disabled` stands until the first
       keystroke, which is the trap this guards against. */
    gateCommit();
    /* Focus goes to the field when there is one to fill, and to the confirm
       when there is not. Focusing a disabled button is focusing nothing. */
    const foot = $('#commitHost .modal-footer[data-needs]');
    const want = (foot && $('#commitHost ' + foot.dataset.needs))
      || $('#commitHost .s-commit [data-commit-go]');
    if (want) want.focus();
  }

  /* Watches the field the commit named as required and releases the confirm
     the moment it has something in it. Delegated at the document rather than
     bound per-surface, because every commit is rendered fresh into
     `#commitHost` and a bound listener would die with the last one. */
  function gateCommit() {
    const foot = $('#commitHost .modal-footer[data-needs]');
    if (!foot) return;
    const go = $('#commitHost [data-commit-go]');
    const field = $('#commitHost ' + foot.dataset.needs);

    /* A `needs:` that names a field this surface does not have would leave
       the confirm disabled with nothing that could ever satisfy it — a trap,
       and a silent one, since the modal opens and the message reads right.

       It cannot be caught statically: the class it names usually exists on
       some OTHER commit, so a file-wide check passes while this surface is
       broken. So it is handled here, by not trapping anybody. The commit's
       own `run()` guard still refuses an empty reason, so nothing is written
       without one either way — the requirement degrades from "held" to
       "refused", which is the previous behaviour rather than no behaviour. */
    if (!field) {
      foot.classList.remove('is-blocked');
      if (go) { go.disabled = false; go.removeAttribute('aria-disabled'); }
      console.warn(`commit: needs "${foot.dataset.needs}" but this surface has no such field — the confirm was released so nobody is stuck. The run() guard still refuses.`);
      return;
    }

    const ok = !!String(field.value || '').trim();
    foot.classList.toggle('is-blocked', !ok);
    if (go) { go.disabled = !ok; go.setAttribute('aria-disabled', String(!ok)); }
  }
  document.addEventListener('input', (e) => {
    if (e.target.closest && e.target.closest('#commitHost')) gateCommit();
  });

  /* A decision zone's confirm follows its radio. `data-say` on the option is
     what the button becomes, so the pick and the button can never disagree —
     which is the one thing that would make a decision zone worse than a
     plain button rather than better. */
  document.addEventListener('change', (e) => {
    const opt = e.target.closest && e.target.closest('[data-say]');
    if (!opt) return;
    const host = opt.closest('#commitHost, .s-work');
    const go = host && (host.querySelector('[data-commit-go]') || host.querySelector('[data-work-go]'));
    if (go) go.textContent = opt.dataset.say;
  });

  function closeCommit() { $('#commitHost').innerHTML = ''; commitRun = null; chPickRec = null; }

  /* ── Toast ──
     A receipt, not feedback. The action highlights what it changed; this is
     only here so there is somewhere to put Undo. */
  let undoFn = null;
  let toastTimer = null;

  function toast(msg, undo) {
    /* Every receipt is also a line in the thread of whatever it happened
       to, so no write can land without the conversation recording it. */
    noteChange(esc(msg), undo);
    undoFn = undo || null;
    clearTimeout(toastTimer);
    /* THE TOAST SHOWS ITS OWN CLOCK. The library ships
       `.aimy-toast-progress` — a bar that scales from 1 to 0 over the life of
       the toast — and this was not using it, so a receipt with an Undo on it
       sat there for nine seconds with nothing saying how long you had. It
       read as stuck rather than as counting.

       Nine seconds was also too long. Five is the library's own animation
       length, and matching the two means the bar reaches zero exactly when
       the toast leaves rather than at some other moment. */
    const life = undo ? 6000 : 4000;
    $('#toastHost').innerHTML = `<div class="aimy-toast visible s-toast">
      <span class="aimy-toast-icon"><svg width="13" height="15" viewBox="0 0 18 20"><use href="#aimy-logo-small"/></svg></span>
      <span class="aimy-toast-body"><span class="aimy-toast-title">${esc(msg)}</span></span>
      ${undo ? `<span class="aimy-toast-divider"></span><button class="aimy-toast-undo" type="button" data-undo>Undo</button>` : ''}
      <span class="aimy-toast-progress"><span class="aimy-toast-progress-fill" style="animation-duration:${life}ms"></span></span>
    </div>`;
    toastTimer = setTimeout(() => { $('#toastHost').innerHTML = ''; undoFn = null; }, life);
  }

  /* Tint what moved, for 1.5s. Nothing else on the surface says an action
     landed here rather than somewhere else. Under reduced motion it holds
     the tint instead of fading it — the signal survives, the movement does
     not. */
  function markChanged(sel) {
    requestAnimationFrame(() => {
      $$(sel).forEach((el) => {
        el.classList.remove('is-settling');
        el.classList.add('s-changed');
        /* Two frames, not one: adding the class and the target in the same
           frame gives the browser nothing to transition from. */
        requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('is-settling')));
        setTimeout(() => el.classList.remove('s-changed', 'is-settling'), 1800);
      });
    });
  }

  /* ═══════════════════════════════════════════════
     THE BRIEFING — what changed since you were last here

     Not counts, and not a log. Four or five sentences about what moved, each
     with one thing to do, and every one of them a FILTER LINK — it sets the
     surface's state rather than going somewhere else. That is what lets the
     briefing and the filters speak one language.

     V1 put the list of past conversations in this rail. A log cannot be
     filtered and cannot be acted on, and asking the same question twice
     made two of them — the live V1 rail carries "Current Job Opportunities
     Available" twice for exactly that reason.

     Every entry is computed and every entry renders ONLY IF ITS CONDITION
     HOLDS. An entry pushed unconditionally is not a finding, and the empty
     state underneath it is unreachable.
  ═══════════════════════════════════════════════ */

  function briefItems() {
    const mine = maySee(DB.acc.concat(DB.con)).filter((r) => !r.arch && (r.owner === me().id || (r.shared || []).includes(me().id)));
    const items = [];

    /* Above everything, because it is the only thing here that is halted.
       The rest of this rail is work that is late; this is work that stopped
       and cannot restart without a person. */
    /* A READ-ONLY TIER IS TOLD, NOT ASKED. A client was being handed "AiMY
       stopped mid-way through Find a slot with four universities and needs
       you to decide → Decide" — an internal operational choice, offered to
       somebody outside the company who cannot write anything.

       Hiding it would have been worse. Their engagement HAS stalled and they
       are entitled to know, and to know how long. So the same fact arrives
       with the owner's name instead of a decision, and the button opens the
       task to read rather than to change. */
    const stuck = filteredTasks().filter((t) => taskState(t) === 'needs-you');
    if (stuck.length) {
      const one = stuck.length === 1 ? stuck[0] : null;
      items.push(canWrite()
        ? { p: 0, text: one
              ? `AiMY stopped mid-way through “${one.title}” and needs you to decide.`
              : `${stuck.length} things AiMY is running have stopped and need you to decide.`,
            cta: one ? 'Decide' : 'Show them',
            go: one ? null : { on: 'tasks', tstate: ['needs-you'], lead: '' },
            task: one ? one.id : null }
        : { p: 0, text: one
              ? `AiMY stopped mid-way through “${one.title}”, waiting on ${actor(one.by).name}. Nothing has moved since ${fmtAgo(one.blocked.since)}.`
              : `${stuck.length} things AiMY is running have stopped, waiting on the people who started them.`,
            cta: one ? 'Look at it' : 'Show them',
            go: one ? { on: 'tasks', task: one.id, lead: '' } : { on: 'tasks', tstate: ['needs-you'], lead: '' } });
    }

    /* Work merely IN FLIGHT is deliberately not here. It was, and it lost
       the cut: this rail sorts by priority and keeps five, so an ambient
       "AiMY has two things running" was competing with six overdue next
       steps and losing — which is the right outcome for the rail and the
       wrong one for the fact. It lives on the Running tab instead, where it
       is permanent and costs nothing. Only work that has STOPPED belongs
       here, and it is above everything. */

    /* THE ONE LINE THAT IS ABOUT SOMEBODY ELSE.

       Everything above and below this is the viewer's own work — "leads came
       back to YOU", "YOU need to decide". For a manager that is a rep's
       briefing over a bigger set, and it was the whole of what the surface
       offered them. This asks the question a manager actually has.

       Derived from `standing()`, the same function the Team tab reads, so
       the rail and the board cannot disagree about who is behind. */
    if (seesOthers()) {
      const others = filteredTeam().filter((p) => p.id !== me().id);
      const worst = orderedTeam(others)[0];
      const st = worst ? standing(worst.id) : null;
      if (st && st.waiting) {
        const next = others.length > 1 ? standing(orderedTeam(others)[1].id).waiting : 0;
        items.push({ p: 1,
          text: `${actor(worst.id).name} has ${plural(st.waiting, 'account')} waiting on a person${
            st.waiting > next ? ', more than anyone else on your team' : ''}.`,
          cta: 'Show them', go: { on: 'accounts', owner: [worst.id], status: ['awaiting-us', 'stalled'], lead: '', camp: '' } });
      }
    }

    const answered = mine.filter((r) => statusOf(r) === 'awaiting-us' && touchesFor(r)[0] && touchesFor(r)[0].dir === 'in');
    if (answered.length) {
      items.push({ p: 1, text: `${plural(answered.length, 'lead')} came back to you and nobody has answered.`,
        cta: 'Show them', go: { status: ['awaiting-us'], scope: 'mine', lead: '' } });
    }

    const over = mine.filter((r) => r.next && daysAgo(r.next.due) > 0);
    if (over.length) {
      const worst = over.slice().sort((a, b) => daysAgo(b.next.due) - daysAgo(a.next.due))[0];
      items.push({ p: 1, text: `${plural(over.length, 'next step')} past ${over.length === 1 ? 'its' : 'their'} date. The oldest is ${worst.next.what.toLowerCase()} on ${worst.name}, ${plural(daysAgo(worst.next.due), 'day')} ago.`,
        cta: 'Show them', go: { due: 'overdue', scope: 'mine', lead: '' } });
    }

    const cold = mine.filter((r) => statusOf(r) === 'going-cold');
    if (cold.length) {
      items.push({ p: 2, text: `${plural(cold.length, 'lead')} went quiet with nothing scheduled to bring ${cold.length === 1 ? 'it' : 'them'} back.`,
        cta: 'Show them', go: { status: ['going-cold'], scope: 'mine', lead: '' } });
    }

    /* What AiMY did while you were elsewhere, and what came of it. A
       campaign that sent and got nothing is the finding, not the sending. */
    const recentAi = maySeeTouch(DB.touch).filter((t) => t.by === 'aimy' && daysAgo(t.at) <= 14);
    if (recentAi.length) {
      const replied = recentAi.filter((t) => t.outcome === 'positive' || t.outcome === 'neutral').length;
      const bounced = recentAi.filter((t) => t.outcome === 'bounced').length;
      items.push({ p: replied ? 2 : 3,
        text: `AiMY sent ${plural(recentAi.length, 'message')} in the last fortnight. ${replied ? `${replied} replied` : 'Nobody replied'}${bounced ? `, ${bounced} bounced` : ''}.`,
        cta: 'Show who it reached', go: { channel: ['aimy'], touched: '30d', scope: '', lead: '' } });
    }

    /* A bounce is a broken address, and it is the one thing here a rep can
       fix outright rather than chase. */
    const bad = maySeeTouch(DB.touch).filter((t) => t.outcome === 'bounced');
    if (bad.length) {
      items.push({ p: 2, text: `${plural(bad.length, 'address')} rejected what we sent. Nothing was delivered to ${bad.length === 1 ? 'it' : 'them'}.`,
        cta: 'Show them', go: { ids: [...new Set(bad.map((t) => t.on))], on: 'contacts', lead: '' } });
    }

    const shared = maySee(DB.acc.concat(DB.con)).filter((r) => (r.shared || []).includes(me().id) && r.owner !== me().id);
    if (shared.length) {
      items.push({ p: 3, text: `${plural(shared.length, 'lead')} ${shared.length === 1 ? 'was' : 'were'} shared with you.`,
        cta: 'Show them', go: { shared: [me().id], lead: '' } });
    }

    /* A fresh scrape with nothing done to it is the state V1 left everything
       in permanently: a hundred rows and no way to act on one. */
    const fresh = maySee(DB.acc).filter((a) => a.src === 'scrape' && statusOf(a) === 'untouched');
    if (fresh.length) {
      items.push({ p: 3, text: `${plural(fresh.length, 'account')} came out of a scrape and ${fresh.length === 1 ? 'has' : 'have'} never been contacted.`,
        cta: 'Review them', go: { status: ['untouched'], src: ['scrape'], scope: '', lead: '' } });
    }

    return items.sort((a, b) => a.p - b.p).slice(0, 5);
  }

  function briefing() {
    const items = briefItems();
    const host = $('#brief');
    if (!host) return;

    if (!items.length) {
      host.innerHTML = `<div class="s-brief-quiet">
        <p>Nothing changed since you were last here.</p>
        <p class="s-brief-quiet-sub">Every next step is ahead of its date and nothing is waiting on you.</p>
      </div>`;
      return;
    }

    host.innerHTML = `<div class="s-brief s-stagger">
      ${items.map((it, i) => `<div class="s-brief-item" style="--i:${i}">
        <span class="s-brief-dot p${it.p}"></span>
        <p class="s-brief-text">${esc(it.text)}</p>
        <button class="s-brief-cta" type="button" data-brief="${i}">${esc(it.cta)}</button>
      </div>`).join('')}
    </div>`;
    host._items = items;
  }

  /* ═══════════════════════════════════════════════
     THE BELL — what is still waiting on a person

     The same model the briefing reads, at a different grain: the briefing
     summarises, this enumerates. Neither can go stale relative to the other
     because there is only one derivation.
  ═══════════════════════════════════════════════ */

  const readNtf = new Set();

  function ntfRows() {
    const rows = [];
    /* A task that has stopped and is waiting on a person belongs at the top
       of the thing that lists what is waiting on a person. It arrives first
       because it is the only kind of item here that is costing something
       every hour it sits — a lead going unanswered is slow, a batch halted
       mid-flight is not. */
    filteredTasks().filter((t) => taskState(t) === 'needs-you').forEach((t) => {
      /* Same split as the briefing: a tier that cannot write is told what
         stopped and who it is waiting on, and its button reads rather than
         decides. Two surfaces, one rule, because a bell that offers what the
         rail withholds is a rule with a hole in it. */
      rows.push(canWrite()
        ? { id: 'task-' + t.id, p: 1, type: t.title, when: fmtAgo(t.blocked.since),
            body: t.blocked.why, cta: 'Decide', task: t.id }
        : { id: 'task-' + t.id, p: 1, type: t.title, when: fmtAgo(t.blocked.since),
            body: `${t.blocked.why} It is waiting on ${actor(t.by).name}.`, cta: 'Look at it', open: t.id });
    });
    maySee(DB.acc.concat(DB.con)).forEach((r) => {
      if (r.arch || (r.owner !== me().id && !(r.shared || []).includes(me().id))) return;
      const ts = touchesFor(r);
      const last = ts[0];
      if (last && last.dir === 'in' && statusOf(r) === 'awaiting-us') {
        rows.push({ id: 'in-' + r.id, p: 1, type: r.name, when: fmtAgo(last.at),
          body: last.note, cta: 'Open it', rec: r.id });
      } else if (r.next && daysAgo(r.next.due) > 0) {
        rows.push({ id: 'due-' + r.id, p: daysAgo(r.next.due) > STALL_DAYS ? 1 : 2, type: r.name,
          when: `${plural(daysAgo(r.next.due), 'day')} over`,
          body: `${r.next.what} was due ${fmtDate(r.next.due)}.`, cta: 'Open it', rec: r.id });
      }
    });
    return rows.sort((a, b) => a.p - b.p).slice(0, 12);
  }

  function bell() {
    const rows = ntfRows();
    const unread = rows.filter((r) => !readNtf.has(r.id)).length;
    const dot = $('#ntfDot');
    const count = $('#ntfCount');
    if (dot) dot.hidden = !unread;
    if (count) { count.hidden = !unread; count.textContent = unread; }

    const list = $('#ntfList');
    if (!list) return;
    list.innerHTML = rows.length
      ? rows.map((r) => `<li class="ntf-row${readNtf.has(r.id) ? ' is-read' : ''}">
          <span class="ntf-sev p${r.p}"></span>
          <div class="ntf-row-main">
            <div class="ntf-row-head">
              <span class="ntf-row-type">${esc(r.type)}</span>
              <span class="ntf-row-when">${esc(r.when)}</span>
            </div>
            <p class="ntf-row-body">${esc(r.body)}</p>
            <button class="ntf-row-cta" type="button" data-ntf="${esc(r.id)}" data-ntf-rec="${esc(r.rec || '')}" data-ntf-task="${esc(r.task || '')}" data-ntf-open="${esc(r.open || '')}">${esc(r.cta)}</button>
          </div>
        </li>`).join('')
      : `<li class="ntf-empty">Nothing is waiting on you.</li>`;
  }

  /* ═══════════════════════════════════════════════
     THE INPUT — one field, four routes

     Filters always apply; a question always answers. They are not
     alternatives.

       expired leads in amsterdam        refilters
       ING                                opens that record
       which campaigns are stalling?      answers, and cites what it counted
       log a call with ING, positive…     commit surface

     A pure question writes `?ids=` for the records it cited as the answer
     resolves, so closing the canvas lands on where the conversation got to.
  ═══════════════════════════════════════════════ */

  /* An explicit write, anywhere: "log a call with ING…". */
  const WRITE_RE = /^\s*(log|logged|add|share|move|reschedul\w*|book|mark)\b/i;

  /* A write BECAUSE A RECORD IS OPEN. With the record on screen, a sentence
     in the past tense about what happened is a touchpoint — that is what a
     rep types, and demanding the word "log" in front of it is asking them to
     address the machine rather than describe the work.

     This only applies with `?lead=` set. Without a record there is nothing to
     write it to, and "called" on the grid is a question about the corpus. */
  const TOUCH_RE = /^\s*(met|meeting|call|called|calling|rang|phoned|spoke|spoken|talked|emailed|mailed|wrote|visited|saw|demoed|demo'?d|presented|pitched|caught up|followed up|left a (voicemail|message)|no answer|they (replied|came back|got back|said))\b/i;
  const ASK_RE = /\?\s*$|^\s*(who|what|which|why|how many|how much|when|where|show me why|is|are|do|does)\b/i;

  function runInput(text, fromRail) {
    const t = text.trim();
    if (!t) return;

    /* With AiMY unreachable the parse and the canvas are what degrade.
       Filters still apply, because reading a filter out of a URL never
       needed AiMY — only reading one out of a sentence did. */
    if (aiDown()) {
      const f = parseFilters(t);
      if (Object.keys(f).length) { go(Object.assign({ lead: '' }, f)); toast('Filters applied. AiMY is unreachable, so nothing was interpreted beyond them.'); }
      else toast('AiMY is unreachable. The filter controls still work.');
      return;
    }

    /* 1 · A write. Checked first, because "log a call with ING" names a
       record and would otherwise open it. With a record open, describing
       what happened counts — the word "log" is not required. */
    /* The last gate on a write. Hiding the controls is not enough — this
       input takes a sentence, and "log a call with Marije" is a write
       nobody clicked a button to reach. It answers rather than ignoring:
       silence would read as the surface being broken. */
    /* The doing verbs run before the logging ones. "Send the deck to ING"
       and "log a call with ING" are both writes, but only one of them is a
       record of something that already happened — and `WRITE_RE` would have
       caught "send" as a touchpoint and asked what channel it was on. */
    if (DO_RE.test(t)) {
      if (!canWrite()) {
        answerBlock('That would change a record', `${esc(TIERS[me().tier].rule)} This account reads; it does not write.`);
        return;
      }
      routeDo(t); return;
    }

    /* DESCRIBING WHAT HAPPENED IS LOGGING IT, whether or not a record is
       open. `TOUCH_RE` used to need `S.lead`, on the reasoning that a past
       tense sentence with no subject is ambiguous — but "called Heineken
       yesterday, no answer" is not ambiguous, it names its subject in the
       second word. Requiring the record to be open first meant a rep who
       had just put the phone down had to go and find the lead before they
       could say what happened, which is the friction the one input exists
       to remove. Ambiguity is still handled: `routeWrite` refuses when it
       cannot resolve a name, and says what it could not find. */
    if (WRITE_RE.test(t) || TOUCH_RE.test(t)) {
      if (!canWrite()) {
        answerBlock('That would change a record', `${esc(TIERS[me().tier].rule)} This account reads; it does not write. Ask a question about what is here and it will be answered.`);
        return;
      }
      routeWrite(t); return;
    }

    /* 2 · A named record, spelled closely enough. Autocompleting to
       something that exists never needed generation, so the canvas stays
       shut (direction §5.2). */
    const named = findRecord(t);
    if (named && !ASK_RE.test(t)) {
      go({ lead: named.id, on: named.kind === 'con' ? 'contacts' : 'accounts' });
      return;
    }

    /* 3 · A question. Filters in it still apply — "leads in amsterdam we
       have not touched, why did they go quiet?" does both jobs. */
    const f = parseFilters(t);
    if (ASK_RE.test(t)) {
      if (Object.keys(f).length && !S.lead) go(Object.assign({ lead: '' }, f));
      answer(t, fromRail);
      return;
    }

    /* 4 · A filter. */
    if (Object.keys(f).length) { go(Object.assign({ lead: '' }, f)); return; }

    /* Nothing recognised is a real outcome and says so, rather than being
       silently read as a question about nothing. */
    answer(t, fromRail);
  }

  /* Spell a record's name and get the record. Exact first, then a prefix,
     then a contained string — and only if one record wins outright, because
     "Delft" matching two universities should not silently pick one. */
  function findRecord(t) {
    const all = maySee(DB.acc.concat(DB.con));
    const tryOne = (q) => {
      if (q.length < 3) return null;
      const exact = all.filter((r) => r.name.toLowerCase() === q);
      if (exact.length === 1) return exact[0];
      const pre = all.filter((r) => r.name.toLowerCase().startsWith(q));
      if (pre.length === 1) return pre[0];
      const has = all.filter((r) => r.name.toLowerCase().includes(q));
      return has.length === 1 ? has[0] : null;
    };
    const q = t.toLowerCase().replace(/[?.!]+$/, '').trim();
    const hit = tryOne(q);
    if (hit) return hit;

    /* WALK BACK FROM THE END. People do not type a name and stop — they type
       "called Heineken yesterday" or "met Vattenfall at their office", and
       the words after the name are about the touchpoint, not about who it
       was with. Requiring the whole phrase to match meant the name had to be
       the last thing in the sentence, which is not how anyone writes.

       Trailing words go first because a name leads its clause. The unique
       match rule is untouched: two candidates still resolve to nothing, so a
       shorter query never guesses. */
    const words = q.split(/\s+/).filter(Boolean);
    for (let n = words.length - 1; n >= 1; n--) {
      const shorter = tryOne(words.slice(0, n).join(' '));
      if (shorter) return shorter;
    }
    return null;
  }

  /* One lexicon, and it is the taxonomy. Asking the taxonomy again here is
     reuse; a second vocabulary is a second vocabulary that drifts from the
     filter row. */
  function parseFilters(text) {
    /* Include and exclude phrases come out FIRST, and the axis matching runs
       on what is left. "including software support" was setting
       `industry=software` as well as the keyword, because the word is in
       both vocabularies — so one phrase produced two filters, and the
       account had to be a software company to survive its own keyword. */
    const kw = { inc: null, exc: null };
    let rest = text;
    const grab = (re, into) => {
      const m = rest.match(re);
      if (m) { kw[into] = m[1].trim().toLowerCase(); rest = rest.replace(m[0], ' '); }
    };
    grab(/\b(?:include|including|about|mentioning)\s+([^.,;?]+)/i, 'inc');
    grab(/\b(?:exclude|excluding|without|but not|except)\s+([^.,;?]+)/i, 'exc');

    const t = ' ' + rest.toLowerCase() + ' ';
    const out = {};
    /* Deduped. Two passes can legitimately reach the same value — the
       taxonomy loop matches the label "untouched" and the vocabulary regex
       matches the word — and `?status=untouched,untouched` is a URL that
       says one thing twice. */
    const push = (k, v) => {
      const list = out[k] || (out[k] = []);
      if (!list.includes(v)) list.push(v);
    };

    for (const row of TAX.status) if (t.includes(' ' + row.label.toLowerCase())) push('status', row.k);
    for (const row of TAX.industry) if (t.includes(' ' + row.label.toLowerCase().split(' ')[0])) push('industry', row.k);
    for (const row of TAX.src) if (t.includes(row.label.toLowerCase())) push('src', row.k);
    for (const row of TAX.channel) if (t.includes(' by ' + row.label.toLowerCase())) push('channel', row.k);
    for (const c of DB.camp) if (t.includes(c.name.toLowerCase()) || t.includes(c.k)) push('campaign', c.k);
    for (const p of SELLERS) if (t.includes(p.name.toLowerCase()) || t.includes(p.name.split(' ')[0].toLowerCase() + '’s')) push('owner', p.id);

    /* Words people actually use, mapped onto the axes they mean. */
    if (/\b(cold|quiet|gone quiet|dormant)\b/.test(t)) push('status', 'going-cold');
    if (/\bnever (been )?(contacted|touched)|untouched|not touched\b/.test(t)) push('status', 'untouched');
    if (/\boverdue|past due|late\b/.test(t)) out.due = 'overdue';
    if (/\bno next step|nothing scheduled\b/.test(t)) out.due = 'none';
    if (/\bmine|my (leads|accounts|book)\b/.test(t)) out.scope = 'mine';
    if (/\b(my|the) team('s)?\b/.test(t)) out.scope = 'team';
    if (/\barchived\b/.test(t)) out.archived = '1';
    if (/\bcontacts?|people\b/.test(t)) out.on = 'contacts';
    if (/\bnot (touched|contacted) in (30|thirty) days?\b/.test(t)) out.touched = 'not30';
    if (/\bthis week|last 7 days\b/.test(t)) out.touched = '7d';
    if (/\blast (30|thirty) days|this month\b/.test(t)) out.touched = '30d';

    /* A city is not an axis, but it is how a rep names a set — V1's own
       result was "Amsterdam (44), Eindhoven (7)". Free text carries it. */
    const city = [...new Set(DB.acc.map((a) => a.city))].find((c) => t.includes(' ' + c.toLowerCase()));
    if (city) out.q = city;

    /* Job titles, spelled. V1's example is "Title: IT Support Manager", and
       a rep says it exactly that way — "IT directors at logistics companies"
       is the first sentence in the V1 screenshot. */
    TITLES.forEach((title) => { if (t.includes(title.toLowerCase())) push('title', title); });

    /* The phrases pulled out at the top, now placed. "Excluding previously
       contacted" is not a keyword — it is a status, and searching for the
       phrase would find nothing while looking like it had worked. */
    if (kw.inc) out.inc = [kw.inc];
    if (kw.exc) {
      if (/previously contacted|contacted before|anyone contacted/.test(kw.exc)) push('status', 'untouched');
      else out.exc = [kw.exc];
    }

    return out;
  }

  function routeWrite(t) {
    /* An open record wins. If you are looking at Optiver and you type "met
       them at their office", you mean Optiver — not whichever other record
       happens to contain the word "office". */
    /* THE STRIP TAKES THE NOUN, NOT THE REST OF THE SENTENCE.

       It used to end `.*$`, so "log a call with ING, positive, next step demo
       Tuesday" — the exact example the failure message below offers — lost
       everything from "a call" onward and searched for the empty string. The
       product's own suggestion answered "Nothing to write to".

       Everything after the channel noun is where the record name lives, and
       usually the outcome and the next step too, all of which `readTouch`
       needs further down. So: remove the phrase, keep the sentence. */
    const named = t
      .replace(WRITE_RE, ' ')
      .replace(/\b(a|an|the)\s+(call|meeting|visit|email|touchpoint|note|demo)\b/gi, ' ')
      .replace(/\b(call|called|met|meeting|visited|emailed|spoke|rang)\b/gi, ' ')
      /* The clause separators end the name. "ING, positive" is a record and a
         reading of it, not a record called "ING, positive". */
      .split(/[,;.]|\bnext step\b|\bwith outcome\b/i)[0]
      .replace(/\b(with|to|at|for|on)\b/gi, ' ')
      .trim();
    const rec = (S.lead ? recBy(S.lead) : null) || findRecord(named);
    if (!rec) { answerBlock('Nothing to write to', `That names an action but not a record${named ? ` — nothing here is called <em>${esc(named)}</em>` : ''}. Open a lead first, or name one: <em>log a call with ING, positive, next step demo Tuesday</em>.`); return; }

    if (/\bshare\b/i.test(t)) { shareRec(rec.id); return; }
    if (/\b(move|reschedul)/i.test(t)) { reschedule(rec.id); return; }

    const ch = /\bmet|visit|in person|on site\b/i.test(t) ? 'physical'
      : /\bcall|phone|rang|dial/i.test(t) ? 'phone'
      : /\bmeeting|zoom|teams|online|demo\b/i.test(t) ? 'meeting' : 'phone';
    logTouch(rec.id, ch, t);
  }

  /* ═══════════════════════════════════════════════
     WHAT AiMY DOES — prepare · send · schedule · enrich

     The roadmap puts these on the AI half of V3, and until this pass the
     chat could not do any of them. It could FIND things and it could record
     what a person had already done; asking it to write the email, send it,
     book the meeting or fill in the missing number produced nothing. An
     assistant that can only describe the work is a search box with opinions.

     FOUR RULES, all of them extensions of what is already here rather than
     new doctrine:

     1. Each opens in the CANVAS, through `canvasWork`. Every one of them
        needs evidence, a set, or a draft long enough to read — which is the
        canvas rule this surface already follows.
     2. NOTHING SENDS WITHOUT A COMMIT, and AiMY signs as AiMY. Audit trail
        level 6: its work is never attributed to the person who asked for it.
     3. A DRAFT CARRIES ITS SOURCES ON ITS FACE — which story, which ICP,
        which touchpoints. A proposal that will not say what it drew from is
        an attestation, which is the thing this product replaced.
     4. ANYTHING THAT TAKES TIME BECOMES A TASK, so the work is watchable
        from the moment it starts rather than reported once it is over.
  ═══════════════════════════════════════════════ */

  /* The words a person actually types, mapped to the verb they mean. Read
     BEFORE the write route, because "draft a proposal for ING" is a write in
     every sense except the one `WRITE_RE` was built for — it does not log
     what happened, it makes something happen. */
  const DO_RE = /^\s*(draft|write|prepare|compose|send|email|book|schedule|arrange|find (a )?(time|slot)|enrich|fill in|look up)\b/i;

  /* THE SUBJECT IS RESOLVED ONCE, for all four verbs, in one order:

       the open record  →  what is ticked  →  what the sentence names

     An open record wins because you are looking at it. A selection wins over
     the sentence because ticking three rows and typing "send them the deck"
     is one gesture, and "them" is not a name anybody can look up.

     A SELECTION OF ONE IS STILL A SELECTION. The first version guarded on
     `set.length > 1` and dropped a single ticked row into the name-a-lead
     path, so ticking one account and asking to send answered "send to
     whom?" — with the answer visibly ticked on screen. */
  function routeDo(t) {
    const set = SEL.size ? [...SEL].map(recBy).filter(Boolean) : null;
    const rec = (S.lead ? recBy(S.lead) : null)
      || (set && set.length === 1 ? set[0] : null)
      || findRecord(stripVerb(t));
    const many = set && set.length > 1 ? set : null;

    if (/\benrich|fill in|look up\b/i.test(t)) return doEnrich(rec, many);
    if (/\bbook|schedule|arrange|find (a )?(time|slot)\b/i.test(t)) return doSchedule(rec, many);
    if (/\bsend|email\b/i.test(t)) return doSend(rec, many, t);
    return doPrepare(rec, many, t);
  }
  /* Three passes, and the third is the one that was missing: the verb, then
     the thing being made, then the preposition joining it to the lead.
     "find a slot with Optiver" left " with Optiver", and `findRecord` looked
     for a company called "with Optiver" and answered "with whom?" — which
     reads as the surface not knowing Optiver rather than not knowing English. */
  const stripVerb = (t) => t
    .replace(DO_RE, '')
    .replace(/^\s*(a |an |the )?(proposal|pitch|deck|demo brief|demo|email|note|meeting|call|time|slot)\b/i, '')
    .replace(/^\s*(with|for|to|at|on|about)\s+/i, '')
    .trim();

  /* What a draft is made of, said before it is read. Three sources, each
     named and each openable — the ICP that explains why this lead is a
     lead, the story this audience responds to, and what has actually passed
     between us. A generated paragraph with no provenance is exactly the
     unsourced confidence the status model exists to remove. */
  function draftBasis(rec) {
    const acc = accOf(rec);
    const kb = knowledgeFor(rec, acc);
    const icp = kb.find((k) => k.type === 'icp');
    const story = kb.find((k) => k.type === 'story');
    const asset = kb.find((k) => k.type === 'asset');
    const ts = touchesFor(rec);
    return { acc, icp, story, asset, ts, kb };
  }

  function basisRows(rec, b) {
    const rows = [
      b.icp ? ['Why they are a lead', b.icp.title, b.icp.id, b.icp.trust]
        : ['Why they are a lead', 'No ICP matched — they are here on campaign membership alone', null, null],
      b.story ? ['The story it leans on', b.story.title, b.story.id, b.story.trust]
        : ['The story it leans on', 'Nothing in Knowledge for this service', null, null],
      b.asset ? ['What it offers to send', b.asset.title, b.asset.id, b.asset.trust]
        : ['What it offers to send', 'No asset for this service', null, null],
      ['What has passed between us', b.ts.length ? touchPhrase(b.ts[0]) : 'Nothing yet', null, null],
    ];
    return `<div class="s-basis">
      <div class="s-basis-title">What this is built from</div>
      ${rows.map(([what, val, id, trust]) => `<div class="s-basis-row">
        <span class="s-basis-what">${esc(what)}</span>
        ${id ? `<button class="s-inline-btn" type="button" data-kb="${esc(id)}">${esc(val)}</button>` : `<span class="s-basis-val">${esc(val)}</span>`}
        ${trust && trust !== 'verified' ? `<span class="trust-state ts-${esc(trust)}" data-trust-state="${esc(trust)}">${esc(TRUST_LABEL[trust])}</span>` : ''}
      </div>`).join('')}
    </div>`;
  }

  /* ── Prepare ──
     The draft is assembled from the record's own facts and the Knowledge it
     cites. It is editable before it is anything else, because the first
     thing anybody does with a generated paragraph is change it, and a
     surface that makes you copy it out to do that has not helped. */
  function doPrepare(rec, many, text) {
    /* A draft is one lead's. Twenty drafts is twenty things to read, and
       nobody reads twenty — so this says so rather than producing them. */
    if (many) { answerBlock('One at a time', `A draft is written from one lead's own history and the ICP it matched, so ${plural(many.length, 'record')} would be ${many.length} things to read before anything went out. Open one, or send them a sequence instead — <em>send them the deck</em>.`); return; }
    if (!rec) { answerBlock('Which lead?', 'Name a lead or open one, and I will draft against what we know about them. <em>Draft a proposal for ING</em>.'); return; }
    const kind = /\bpitch\b/i.test(text) ? 'pitch' : /\bdemo\b/i.test(text) ? 'demo brief' : 'proposal';
    const b = draftBasis(rec);
    const body = draftText(rec, b, kind);
    canvasWork({
      title: `A ${kind} for ${rec.name}`,
      lede: `Drafted from what we know. Nothing has been sent — this is a draft you own.`,
      body: `${basisRows(rec, b)}
        <label class="s-field-label" for="draftBody">The draft</label>
        <textarea class="input s-draft" id="draftBody" rows="9">${esc(body)}</textarea>`,
      effects: [
        ['ok', `Saved against ${rec.name} as a draft, attributed to AiMY, with the three sources above recorded on it.`],
        b.kb.some((k) => k.trust !== 'verified')
          ? ['warn', 'One of the sources is not currently verified in Knowledge. It is named above so you can check it before this goes anywhere.']
          : null,
        ['skip', 'Nothing is sent. Preparing and sending are two decisions and this is the first one.'],
      ],
      confirm: 'Keep this draft',
      run(id) {
        const txt = ($('#draftBody') || {}).value || body;
        const t = makeTask({ kind: 'prepare', title: `Draft a ${kind} for ${rec.name}`, on: [rec.id],
          take: 1, done: 1, finished: iso(TODAY), camp: campsOf(rec)[0] || null, draft: txt });
        settleWork(id, `Draft kept on ${rec.name}.`);
        paint(); paintChrome();
        toast(`Draft kept. It is on ${rec.name} and in Running.`, () => { dropTask(t.id); paint(); paintChrome(); });
      },
    });
  }

  function draftText(rec, b, kind) {
    const acc = b.acc;
    const who = rec.kind === 'con' ? rec.name.split(' ')[0] : 'there';
    const lead = b.ts.length
      ? `Following ${touchPhrase(b.ts[0]).toLowerCase()}, I wanted to put something concrete in front of you.`
      : `We have not spoken before, so I will be brief.`;
    const why = b.icp
      ? `You match what we see across ${label('industry', acc.industry).toLowerCase()} at your size: ${b.icp.summary.split('.')[0].toLowerCase()}.`
      : `You came up in our ${label('src', acc.src).toLowerCase()} work rather than against a defined profile, so treat this as a first conversation.`;
    const proof = b.story ? `The closest thing we have done: ${b.story.title} — ${b.story.summary.split(';')[0]}.` : '';
    const ask = kind === 'demo brief'
      ? `For the demo: thirty minutes, your QA lead and whoever owns the release calendar.`
      : kind === 'pitch'
      ? `If that lands, the next step is thirty minutes with whoever owns delivery.`
      : `Scope, shape and a rate would follow a thirty-minute call. ${b.asset ? `I can send ${b.asset.title} ahead of it.` : ''}`;
    return `Hi ${who},\n\n${lead} ${why}\n\n${proof}\n\n${ask}\n\nNour`;
  }

  /* ── Send ──
     The one verb that reaches a person. It reuses the commit surface rather
     than the canvas when it is one message to one lead, and the canvas when
     it is a set — the same rule everything else here follows. Either way it
     writes a touchpoint attributed to AiMY, never to the rep. */
  function doSend(rec, many, text) {
    if (many) return doSendMany(many);
    if (!rec) { answerBlock('Send to whom?', 'Name a lead, open one, or pick a set. <em>Send the QA deck to ING</em>.'); return; }
    const b = draftBasis(rec);
    const body = draftText(rec, b, 'pitch');
    const to = rec.kind === 'con' ? rec : DB.con.find((c) => c.acc === accOf(rec).id);
    canvasWork({
      title: `Send to ${rec.name}`,
      lede: to ? `To ${to.name}, ${to.role}${to.email ? ` — ${to.email}` : ''}.` : 'No named contact at this account yet.',
      body: `${basisRows(rec, b)}
        <label class="s-field-label" for="sendBody">What goes out</label>
        <textarea class="input s-draft" id="sendBody" rows="8">${esc(body)}</textarea>`,
      effects: [
        ['ok', `A touchpoint is recorded on ${rec.name}, dated today, attributed to AiMY — not to you.`],
        to && to.enrich && to.enrich.email && to.enrich.email.conf === 'low'
          ? ['warn', `${to.name}'s address was guessed from the name and domain. It may bounce, and a bounce is recorded too.`] : null,
        ['skip', 'This is a prototype with no mail server. Nothing leaves this browser.'],
      ],
      confirm: 'Send it',
      run(id) {
        const t = makeTask({ kind: 'send', title: `Send to ${rec.name}`, on: [rec.id], take: 1, done: 1,
          finished: iso(TODAY), camp: campsOf(rec)[0] || null, wrote: true });
        const touch = { id: 'tx' + Math.abs(DB.touch.length + 1), acc: accOf(rec).id, on: rec.id,
          ch: 'aimy', dir: 'out', at: iso(TODAY), by: 'aimy', outcome: 'neutral', task: t.id,
          note: `AiMY sent a pitch drawing on ${b.story ? b.story.title : 'the campaign brief'}.`,
          list: campsOf(rec)[0] || null };
        DB.touch.unshift(touch);
        reindex(); settleWork(id, `Sent. Recorded on ${rec.name} as AiMY's.`);
        paint(); paintChrome();
        toast(`Sent to ${rec.name}, recorded as AiMY's.`, () => {
          DB.touch = DB.touch.filter((x) => x.id !== touch.id); dropTask(t.id);
          reindex(); paint(); paintChrome();
        });
      },
    });
  }

  /* A set is where a task earns its existence: forty messages do not happen
     at once, so the thing you get back is not a result, it is something to
     watch. */
  function doSendMany(set) {
    const accs = [...new Set(set.map((r) => accOf(r).id))].map((id) => DB.accBy[id]).filter(Boolean);
    const noIcp = accs.filter((a) => !a.icp).length;
    canvasWork({
      title: `Send to ${plural(accs.length, 'account')}`,
      lede: 'One sequence, personalised per account from its own ICP and history.',
      body: `<div class="s-camps">${accs.slice(0, 10).map((a) => `<button class="chip default s-camp-chip" type="button" data-open="${esc(a.id)}">${esc(a.name)}</button>`).join('')}</div>
        ${accs.length > 10 ? `<p class="s-cols-note">${accs.length - 10} more.</p>` : ''}`,
      effects: [
        ['ok', `A task appears in Running. It goes out over the next two days and you can stop it at any point.`],
        noIcp ? ['warn', `${noIcp} of them matched no ICP, so ${noIcp === 1 ? 'that one goes' : 'those go'} on campaign membership alone and ${noIcp === 1 ? 'reads' : 'read'} more generally.`] : null,
        ['skip', 'Each one records a touchpoint attributed to AiMY as it goes, not all at the end.'],
      ],
      confirm: `Start sending to ${accs.length}`,
      run(id) {
        const t = makeTask({ kind: 'send', title: `Sequence to ${plural(accs.length, 'account')}`,
          on: accs.map((a) => a.id), take: accs.length, done: 0, wrote: true,
          next: accs[0].name, camp: campsOf(accs[0])[0] || null });
        SEL.clear();
        settleWork(id, `Started. Watch it in Running.`);
        go({ on: 'tasks', task: t.id });
        toast(`Sending to ${plural(accs.length, 'account')}.`, () => { dropTask(t.id); go({ on: 'accounts', task: '' }); });
      },
    });
  }

  /* ── Schedule ──
     NOT the same thing as `book`, which sets a next step — a note to
     yourself. This is a negotiation with a person: times go out, and the
     task sits in `needs-you` the moment somebody answers with a problem,
     which is the clearest example on this surface of why long-running work
     needs a state a person can be summoned into. */
  function doSchedule(rec, many) {
    if (many) { answerBlock('One at a time', `Finding a time is a conversation with a person, so ${plural(many.length, 'record')} is ${many.length} conversations. Open one, or send them something they can reply to — <em>send them the deck</em>.`); return; }
    if (!rec) { answerBlock('With whom?', 'Name a lead or open one. <em>Find a slot with ING</em> — and if you only want a reminder for yourself, say <em>book a demo on Tuesday</em> instead.'); return; }
    const to = rec.kind === 'con' ? rec : DB.con.find((c) => c.acc === accOf(rec).id);
    const slots = [3, 4, 7].map((d) => fmtDate(iso(shift(TODAY, d))));
    canvasWork({
      title: `Find a slot with ${rec.name}`,
      lede: to ? `AiMY will propose three times to ${to.name} and settle on one.` : 'No named contact yet — it will go to the account address.',
      body: `<div class="s-slots">${slots.map((s) => `<span class="chip default">${esc(s)}</span>`).join('')}</div>
        <p class="s-work-p">If they come back with a conflict, this stops and asks you rather than guessing at a fourth time.</p>`,
      effects: [
        ['ok', 'A task appears in Running and stays there until a time is agreed or you stop it.'],
        ['warn', 'It stops and waits for you if they propose something outside these three. Deciding for you is not something it does with somebody else’s calendar.'],
        ['skip', `This does not touch your calendar. Setting a next step for yourself is a different thing — that is “book a demo on Tuesday”.`],
      ],
      confirm: 'Start looking',
      run(id) {
        const t = makeTask({ kind: 'schedule', title: `Find a slot with ${rec.name}`, on: [rec.id],
          take: 1, done: 0, wrote: false, camp: campsOf(rec)[0] || null, next: 'waiting on their reply' });
        settleWork(id, 'Started. It is in Running.');
        paint(); paintChrome();
        toast(`Looking for a time with ${rec.name}.`, () => { dropTask(t.id); paint(); paintChrome(); });
      },
    });
  }

  /* ── Enrich ──
     The one that must never write silently. Enriched values arrive with a
     confidence and a source, and they land in a DECISION ZONE per field —
     accept, edit or reject — because a number nobody chose to believe,
     sitting in a record somebody is accountable for, is the attestation
     model coming back in through the data layer. */
  function doEnrich(rec, set) {
    const targets = set && set.length ? set : rec ? [rec] : null;
    if (!targets) { answerBlock('Enrich what?', 'Open a lead, name one, or tick a few. <em>Fill in what is missing on ING</em>.'); return; }
    if (targets.length > 1) return doEnrichMany(targets);

    const r = targets[0];
    const acc = accOf(r);
    const gaps = enrichGaps(r, acc);
    if (!gaps.length) {
      answerBlock(`Nothing missing on ${esc(r.name)}`, 'Every field this surface holds is already filled. Enriching would overwrite what is here with a guess, which is worse than a gap.');
      return;
    }
    canvasWork({
      title: `Fill in what is missing on ${r.name}`,
      lede: `${plural(gaps.length, 'field')} with nothing in ${gaps.length === 1 ? 'it' : 'them'}. Each comes back with where it came from and how sure it is.`,
      body: `<div class="decision-zone s-enrich">
        ${gaps.map((g, i) => `<div class="s-enrich-row">
          <div class="s-enrich-head">
            <span class="s-enrich-what">${esc(g.what)}</span>
            ${confBadge({ conf: g.conf })}
          </div>
          <input class="input s-enrich-val" id="enr${i}" value="${esc(g.val)}" aria-label="${esc(g.what)}" />
          <span class="s-enrich-src">${esc(g.src)}</span>
          <label class="ds-choice s-enrich-take"><input type="checkbox" class="s-enrich-tick" value="${esc(g.k)}" ${g.conf === 'low' ? '' : 'checked'} /><span>Take it</span></label>
        </div>`).join('')}
      </div>`,
      effects: [
        ['ok', 'Only the ones you tick are written, and each keeps its source and confidence on the record.'],
        gaps.some((g) => g.conf === 'low') ? ['warn', 'The low-confidence ones start unticked. A guess you did not read is worse than an empty field.'] : null,
        ['skip', 'Nothing already filled in is touched. This only fills gaps.'],
      ],
      confirm: 'Take the ticked ones',
      run(id) {
        const take = $$('.s-enrich-tick:checked').map((c) => c.value);
        if (!take.length) { settleWork(id, 'Nothing ticked, so nothing was written.'); return; }
        const prev = JSON.parse(JSON.stringify({ acc: { emp: acc.emp, rev: acc.rev, enrich: acc.enrich }, rec: { email: r.email, phone: r.phone, enrich: r.enrich } }));
        take.forEach((k) => {
          const g = gaps.find((x) => x.k === k);
          const val = ($('#enr' + gaps.indexOf(g)) || {}).value || g.val;
          const host = g.on === 'acc' ? acc : r;
          host[k] = g.num ? parseInt(String(val).replace(/\D/g, ''), 10) : val;
          host.enrich = host.enrich || {};
          host.enrich[k] = { conf: g.conf, src: g.src, at: iso(TODAY) };
        });
        const t = makeTask({ kind: 'enrich', title: `Fill in ${r.name}`, on: [r.id], take: take.length,
          done: take.length, finished: iso(TODAY), wrote: false, camp: campsOf(r)[0] || null });
        reindex(); settleWork(id, `${plural(take.length, 'field')} filled on ${r.name}.`);
        paint(); paintChrome();
        toast(`${plural(take.length, 'field')} filled, each with its source.`, () => {
          Object.assign(acc, prev.acc); Object.assign(r, prev.rec); dropTask(t.id);
          reindex(); paint(); paintChrome();
        });
      },
    });
  }

  function doEnrichMany(set) {
    const accs = [...new Set(set.map((r) => accOf(r).id))].map((id) => DB.accBy[id]).filter(Boolean);
    const withGaps = accs.filter((a) => enrichGaps(a, a).length);
    canvasWork({
      title: `Fill in what is missing across ${plural(accs.length, 'account')}`,
      lede: `${withGaps.length} of them have a gap. The rest are already complete and are skipped.`,
      body: `<div class="s-camps">${withGaps.slice(0, 10).map((a) => `<button class="chip default s-camp-chip" type="button" data-open="${esc(a.id)}">${esc(a.name)}</button>`).join('')}</div>
        ${withGaps.length > 10 ? `<p class="s-cols-note">${withGaps.length - 10} more.</p>` : ''}`,
      effects: [
        ['ok', 'A task appears in Running and works through them.'],
        ['warn', 'Anything it is not sure about stops the task and comes back to you as a decision, one record at a time. It does not take a low-confidence guess across a set.'],
        accs.length - withGaps.length ? ['skip', `${accs.length - withGaps.length} are already complete and are not touched.`] : null,
      ],
      confirm: `Start on ${withGaps.length}`,
      run(id) {
        const t = makeTask({ kind: 'enrich', title: `Fill in ${plural(withGaps.length, 'account')}`,
          on: withGaps.map((a) => a.id), take: withGaps.length, done: 0, wrote: false,
          next: withGaps[0] ? withGaps[0].name : null });
        SEL.clear();
        settleWork(id, 'Started. Watch it in Running.');
        go({ on: 'tasks', task: t.id });
        toast(`Enriching ${plural(withGaps.length, 'account')}.`, () => { dropTask(t.id); go({ on: 'accounts', task: '' }); });
      },
    });
  }

  /* What is actually missing, and what enrichment would put there. Values
     are derived from the corpus rather than invented, so a demo of this
     never shows a number that contradicts the record beside it. */
  function enrichGaps(rec, acc) {
    const out = [];
    const r = rng((rec.id.length * 7919) + rec.name.length);
    if (acc.emp == null) out.push({ k: 'emp', on: 'acc', num: true, what: 'Headcount',
      val: String(200 + Math.floor(r() * 4000)), conf: 'medium', src: 'Two job boards and their careers page' });
    if (acc.rev == null) out.push({ k: 'rev', on: 'acc', num: true, what: 'Revenue',
      val: String(Math.round((acc.emp || 500) * 180)), conf: 'low', src: 'Modelled from headcount for this industry' });
    if (rec.kind === 'con' && !rec.email) out.push({ k: 'email', on: 'rec', what: 'Email',
      val: `${rec.name.toLowerCase().replace(/[^a-z]+/g, '.')}@${acc.domain}`, conf: 'low', src: 'Guessed from the name and the domain' });
    if (rec.kind === 'con' && !rec.phone) out.push({ k: 'phone', on: 'rec', what: 'Phone',
      val: `+31 ${20 + Math.floor(r() * 60)} ${100 + Math.floor(r() * 899)} ${1000 + Math.floor(r() * 8999)}`, conf: 'medium', src: 'Their switchboard, from the site footer' });
    return out;
  }

  /* One place tasks are made, so every verb produces the same shape and the
     indexes are always rebuilt. A task added by hand somewhere else is a
     task that would not appear on the records it touches. */
  let taskSeq = 0;
  function makeTask(o) {
    const t = Object.assign({
      id: 'tk-new' + ++taskSeq, by: me().id, at: iso(TODAY), camp: null, on: [],
      take: 0, done: 0, failed: 0, wrote: false, finished: null, blocked: null, paused: false,
    }, o);
    DB.task.unshift(t);
    indexTasks();
    return t;
  }
  function dropTask(id) {
    DB.task = DB.task.filter((t) => t.id !== id);
    indexTasks();
  }
  function indexTasks() {
    DB.taskBy = Object.create(null);
    DB.tasksOn = Object.create(null);
    DB.task.forEach((t) => {
      DB.taskBy[t.id] = t;
      t.on.forEach((id) => {
        (DB.tasksOn[id] || (DB.tasksOn[id] = [])).push(t.id);
        DB.con.filter((c) => c.acc === id).forEach((c) => {
          (DB.tasksOn[c.id] || (DB.tasksOn[c.id] = [])).push(t.id);
        });
      });
    });
  }

  /* ═══════════════════════════════════════════════
     ANSWERS

     Computed from the corpus, never written out in advance, and each one
     cites what it counted — a number with no way to see behind it is the
     same unsourced confidence this product exists to remove, wearing a more
     objective face.

     What the question ASKS picks the shape; what its words NAME picks the
     records it is answered from. The most specific matching shape wins
     rather than the first declared.
  ═══════════════════════════════════════════════ */

  const SHAPES = [
    {
      k: 'campaign-health', spec: 3,
      test: (t) => /\bcampaign/.test(t) && /\bstall|health|working|performing|going\b/.test(t),
      words: ['campaign', 'stalling', 'stalled', 'health', 'working', 'performing', 'going', 'which', 'are'],
      run() {
        const STUCK = ['stalled', 'going-cold'];
        const rows = DB.camp.map((c) => {
          const members = maySee(DB.acc).filter((a) => c.members.includes(a.id) && !a.arch);
          const stuck = members.filter((a) => STUCK.includes(statusOf(a)));
          const untouched = members.filter((a) => statusOf(a) === 'untouched');
          return { c, members, stuck, untouched, drag: stuck.length + untouched.length };
        }).filter((r) => r.members.length);

        /* A closed campaign cannot be worked on, so it cannot be "the one to
           look at" — it is here for the record and nothing else. And the
           ranking is by how many accounts are actually stuck, not by the
           proportion: a tenth of ten and a tenth of a hundred are not the
           same amount of work, and the proportion ranked them equal. */
        const open = rows.filter((r) => campState(r.c) !== 'finished');
        const worst = open.slice().sort((a, b) => b.drag - a.drag || b.members.length - a.members.length)[0];

        const title = !rows.length ? 'No campaign has any members'
          : !worst || !worst.drag ? 'Nothing is stalling'
          : `${worst.c.name} is the one to look at — ${plural(worst.drag, 'account')} stuck or never contacted`;

        return {
          title,
          body: rows.map((r) => `<div class="s-ans-row">
              <button class="s-ans-name" type="button" data-camp="${esc(r.c.k)}">${esc(r.c.name)}${campState(r.c) !== 'running' ? ` <span class="s-ans-sub">${esc(CAMP_STATE[campState(r.c)].label.toLowerCase())}</span>` : ''}</button>
              <span class="s-ans-fact">${esc(plural(r.members.length, 'account'))} · ${r.untouched.length} never contacted · ${r.stuck.length} stalled or cold</span>
              <button class="btn btn-ghost btn-sm s-ans-go" type="button" data-quick="campaign=${esc(r.c.k)}">Show</button>
            </div>`).join(''),
          cite: rows.flatMap((r) => r.members).map((a) => a.id),
          citeLabel: `Counted across ${plural(rows.reduce((n, r) => n + r.members.length, 0), 'account')} in ${plural(rows.length, 'campaign')}. Membership overlaps, so the total is larger than the corpus.`,
        };
      },
    },
    {
      k: 'untouched', spec: 2,
      test: (t) => /\b(not|never|haven.t|have not)\b.*\b(touch|contact|reach|spoke|call)/.test(t) || /\buntouched\b/.test(t),
      words: ['who', 'have', 'we', 'not', 'never', 'touched', 'contacted', 'reached', 'in', 'days', 'untouched', 'which'],
      /* "Never contacted" and "nothing in 30 days" are different questions,
         and this shape answered the second under the first's name — so
         "who have we never contacted?" replied about records that HAD been
         contacted, a month ago. It now answers what it was asked, and says
         which of the two it read. */
      run(scope, text) {
        const never = /\b(never|untouched|no one|nobody|not once)\b/.test(String(text || '').toLowerCase());
        const cold = never
          ? scope.filter((r) => !touchesFor(r).length)
          : scope.filter((r) => { const ts = touchesFor(r); return !ts.length || daysAgo(ts[0].at) > 30; });
        const byOwner = {};
        cold.forEach((r) => (byOwner[r.owner] = (byOwner[r.owner] || 0) + 1));
        return {
          title: never
            ? `${plural(cold.length, 'record')} nobody has ever contacted`
            : `${plural(cold.length, 'record')} with nothing in the last 30 days`,
          body: Object.keys(byOwner).sort((a, b) => byOwner[b] - byOwner[a]).map((o) => `<div class="s-ans-row">
              <span class="s-ans-name">${esc(actor(o).name)}</span>
              <span class="s-ans-fact">${esc(plural(byOwner[o], 'record'))}</span>
              <button class="btn btn-ghost btn-sm s-ans-go" type="button" data-quick="owner=${esc(o)}">Show</button>
            </div>`).join(''),
          cite: cold.map((r) => r.id),
          citeLabel: `Out of ${plural(scope.length, 'record')} in scope.`,
        };
      },
    },
    {
      k: 'aimy-did', spec: 3,
      test: (t) => /\baimy\b/.test(t) && /\bsend|sent|did|do|reach|email/.test(t),
      words: ['what', 'did', 'aimy', 'send', 'sent', 'last', 'week', 'who', 'replied', 'do', 'reach', 'email'],
      run() {
        const sent = maySeeTouch(DB.touch).filter((t) => t.by === 'aimy');
        const recent = sent.filter((t) => daysAgo(t.at) <= 30);
        const byOutcome = {};
        recent.forEach((t) => (byOutcome[t.outcome] = (byOutcome[t.outcome] || 0) + 1));
        return {
          title: `AiMY sent ${plural(recent.length, 'message')} in the last 30 days`,
          body: Object.keys(byOutcome).sort((a, b) => byOutcome[b] - byOutcome[a]).map((o) => `<div class="s-ans-row">
              <span class="s-ans-name tone-${esc(BY.outcome[o] ? BY.outcome[o].tone : 'neutral')}">${esc(label('outcome', o))}</span>
              <span class="s-ans-fact">${esc(plural(byOutcome[o], 'message'))}</span>
            </div>`).join('') + `<p class="s-ans-note">Every one of them is on its record as AiMY&rsquo;s, with the reasoning it used. None of them is attributed to a rep.</p>`,
          cite: [...new Set(recent.map((t) => t.acc))],
          citeLabel: `${plural(sent.length, 'message')} in total; ${recent.length} inside 30 days.`,
        };
      },
    },
    {
      k: 'counts', spec: 1,
      test: (t) => /\bhow many\b/.test(t),
      words: ['how', 'many', 'are', 'there', 'do', 'we', 'have'],
      run(scope) {
        const by = {};
        scope.forEach((r) => (by[statusOf(r)] = (by[statusOf(r)] || 0) + 1));
        return {
          title: `${plural(scope.length, S.on === 'contacts' ? 'contact' : 'account')} in scope`,
          body: TAX.status.filter((s) => by[s.k]).map((s) => `<div class="s-ans-row">
              <span class="s-ans-name tone-${esc(s.tone)}">${esc(s.label)}</span>
              <span class="s-ans-fact">${esc(plural(by[s.k], 'record'))}</span>
              <button class="btn btn-ghost btn-sm s-ans-go" type="button" data-quick="status=${esc(s.k)}">Show</button>
            </div>`).join(''),
          cite: scope.map((r) => r.id),
          citeLabel: 'Every record the current filters leave.',
        };
      },
    },
    {
      k: 'owners', spec: 2,
      /* "who has" was too wide — it swallowed "who has gone quiet", which is
         a question about momentum, not about ownership. Ownership words
         only. */
      test: (t) => /\b(owns?|owner|owned)\b/.test(t) || /\bwho is on\b/.test(t),
      words: ['who', 'owns', 'has', 'is', 'on', 'the', 'which'],
      run(scope) {
        const by = {};
        scope.forEach((r) => (by[r.owner] = (by[r.owner] || 0) + 1));
        return {
          title: `${plural(Object.keys(by).length, 'person')} between them`,
          body: Object.keys(by).sort((a, b) => by[b] - by[a]).map((o) => `<div class="s-ans-row">
              <span class="s-ans-name">${esc(actor(o).name)} <span class="s-ans-sub">${esc(actor(o).role)}</span></span>
              <span class="s-ans-fact">${esc(plural(by[o], 'record'))}</span>
              <button class="btn btn-ghost btn-sm s-ans-go" type="button" data-quick="owner=${esc(o)}">Show</button>
            </div>`).join(''),
          cite: scope.map((r) => r.id),
          citeLabel: `Counted over ${plural(scope.length, 'record')}.`,
        };
      },
    },

    /* ── The questions the corpus obviously invites ──
       Five shapes was too few, and every miss landed on a flat refusal. Each
       of these answers something the surface already knows and was making
       people find by filtering by hand. */

    {
      k: 'changed', spec: 3,
      test: (t) => /\b(changed|happened|new|moved|since)\b/.test(t) && /\b(week|lately|recently|today|yesterday)\b/.test(t),
      words: ['what', 'changed', 'happened', 'new', 'this', 'week', 'lately', 'recently', 'since', 'moved', 'today'],
      run() {
        const days = 7;
        const ts = maySeeTouch(DB.touch).filter((x) => daysAgo(x.at) <= days);
        /* NOT filtered against the visible scope. A touchpoint lands on the
           contact; the surface is usually showing accounts — so intersecting
           the two reported "across 0 records" while listing 64 touchpoints,
           which is a sentence that contradicts itself in its own clause. */
        const recs = [...new Set(ts.map((x) => x.on || x.acc))].map(recBy).filter(Boolean);
        if (!ts.length) return { title: 'Nothing moved this week', body: `<p class="s-ans-none">No touchpoint anywhere you can see is newer than ${plural(days, 'day')}. That is itself worth knowing.</p>` };
        const byWho = {};
        ts.forEach((x) => (byWho[x.by === 'aimy' ? 'aimy' : x.by] = (byWho[x.by === 'aimy' ? 'aimy' : x.by] || 0) + 1));
        return {
          title: `${plural(ts.length, 'touchpoint')} in the last ${plural(days, 'day')}, across ${plural(recs.length, 'record')}`,
          body: Object.keys(byWho).sort((a, b) => byWho[b] - byWho[a]).map((w) => `<div class="s-ans-row">
              <span class="s-ans-name">${w === 'aimy' ? 'AiMY' : esc(actor(w).name)}</span>
              <span class="s-ans-fact">${esc(plural(byWho[w], 'touchpoint'))}</span>
            </div>`).join(''),
          cite: recs.map((r) => r.id),
          citeLabel: `${plural(recs.length, 'record')} moved.`,
        };
      },
    },

    {
      k: 'running', spec: 3,
      test: (t) => /\b(running|in flight|working on|doing now|busy)\b/.test(t) || (/\baimy\b/.test(t) && /\bnow\b/.test(t)),
      words: ['what', 'is', 'aimy', 'running', 'now', 'in', 'flight', 'working', 'on', 'doing', 'busy'],
      run() {
        const live = filteredTasks().filter((x) => taskState(x) !== 'done');
        if (!live.length) return { title: 'AiMY is not running anything', body: '<p class="s-ans-none">Nothing is in flight. Ask it to prepare, send, schedule or enrich and it will appear here.</p>' };
        return {
          title: `AiMY has ${plural(live.length, 'thing')} in flight`,
          body: live.map((x) => `<div class="s-ans-row">
              <span class="s-ans-name tone-${esc(TASK_STATE[taskState(x)].tone)}">${esc(x.title)}</span>
              <span class="s-ans-fact">${x.done} of ${x.take}</span>
              <button class="btn btn-ghost btn-sm s-ans-go" type="button" data-quick2="on=tasks&task=${esc(x.id)}">Open</button>
            </div>`).join(''),
          citeLabel: 'On the Running tab, with a stop on each.',
        };
      },
    },

    {
      k: 'bounced', spec: 3,
      test: (t) => /\b(bounce|bounced|bad address|undeliverable|rejected)\b/.test(t),
      words: ['which', 'what', 'addresses', 'bounced', 'bad', 'address', 'undeliverable', 'rejected', 'are'],
      run() {
        const bad = maySeeTouch(DB.touch).filter((x) => x.outcome === 'bounced');
        const recs = [...new Set(bad.map((x) => x.on || x.acc))].map(recBy).filter(Boolean);
        if (!recs.length) return { title: 'Nothing has bounced', body: '<p class="s-ans-none">Every address AiMY has used was delivered to.</p>' };
        return {
          title: `${plural(recs.length, 'address')} rejected what we sent`,
          body: recs.slice(0, 8).map((r) => `<div class="s-ans-row">
              <span class="s-ans-name">${esc(r.name)}<span class="s-ans-sub">${esc(r.email || 'no address on file')}</span></span>
              <button class="btn btn-ghost btn-sm s-ans-go" type="button" data-open="${esc(r.id)}">Fix it</button>
            </div>`).join(''),
          cite: recs.map((r) => r.id),
          citeLabel: `Nothing was delivered to ${recs.length === 1 ? 'it' : 'them'}.`,
        };
      },
    },

    {
      k: 'quiet', spec: 3,
      test: (t) => /\b(quiet|not heard|no reply|silent|ignoring|ghost)\b/.test(t),
      words: ['who', 'has', 'gone', 'quiet', 'not', 'heard', 'from', 'no', 'reply', 'silent', 'ignoring'],
      run(scope) {
        const cold = scope.filter((r) => ['going-cold', 'stalled'].includes(statusOf(r)));
        if (!cold.length) return { title: 'Nobody in scope has gone quiet', body: '<p class="s-ans-none">Everything here is either moving or finished.</p>' };
        return {
          title: `${plural(cold.length, 'lead')} stopped moving`,
          body: cold.slice(0, 8).map((r) => `<div class="s-ans-row">
              <span class="s-ans-name tone-${esc(toneOf(statusOf(r)))}">${esc(r.name)}<span class="s-ans-sub">${esc(because(r))}</span></span>
              <button class="btn btn-ghost btn-sm s-ans-go" type="button" data-open="${esc(r.id)}">Open</button>
            </div>`).join(''),
          cite: cold.map((r) => r.id),
          citeLabel: `${plural(cold.length, 'record')}, worst first.`,
        };
      },
    },
  ];

  /* One phrasing per shape, in the words a rep would use rather than the
     words the matcher wants. Kept beside SHAPES so the two stay the same
     length — a shape with no phrasing here is a capability nobody can find. */
  const CAN_ANSWER = [
    'Which campaigns are stalling?',
    'Who have we never contacted?',
    'What did AiMY send?',
    'Who has gone quiet?',
    'What changed this week?',
    'What is AiMY running now?',
    'Which addresses bounced?',
    'Who owns what?',
  ];

  /* Asking-words are not search terms. Each shape declares its own
     vocabulary and those words are dropped before the scope search runs —
     without it, "who have we not touched?" scopes itself to the one company
     whose name contains "we". */
  function scopeFor(shape, text) {
    /* EVERY ASKING-WORD, not just the ones a shape remembered to declare.
       "Who owns what?" left "what" behind, which then searched the corpus
       for a company called What and scoped the answer to nothing — so the
       question answered "0 people between them" over 118 records. A shape
       author cannot be expected to list the whole interrogative vocabulary
       every time; the vocabulary is a property of English, so it lives
       here once. */
    const drop = new Set((shape ? shape.words : []).concat(
      ['the', 'a', 'an', 'of', 'and', 'or', 'our', 'us', 'me', 'my', 'any', 'all', 'that', 'this', 'it', 'is', 'was',
       'what', 'which', 'who', 'whom', 'whose', 'when', 'where', 'why', 'how', 'many', 'much',
       'are', 'do', 'does', 'did', 'have', 'has', 'had', 'we', 'they', 'them', 'their', 'been',
       'gone', 'still', 'now', 'lately', 'recently', 'about', 'from', 'with', 'for', 'not', 'no']));
    const terms = text.toLowerCase().replace(/[?.,!]/g, ' ').split(/\s+/).filter((w) => w.length > 2 && !drop.has(w));
    const base = ordered(filtered());
    if (!terms.length) return base;
    const hit = base.filter((r) => {
      const acc = accOf(r);
      const hay = [r.name, acc.name, acc.city, label('industry', acc.industry), r.role].filter(Boolean).join(' ').toLowerCase();
      return terms.some((w) => hay.includes(w));
    });
    /* A term that hits a quarter of what is in scope is not coverage — it
       is a word that happens to be common. Fall back rather than pretend
       the narrowing meant something. */
    return hit.length && hit.length < base.length * 0.9 ? hit : base;
  }

  function answer(text, fromRail) {
    /* Where the answer lands follows the same rule as the rail itself: if
       there is a subject on screen it goes in the rail beside it, and if
       there is not, the canvas opens over the work. Two surfaces, one
       decision, taken once. */
    if (!fromRail && !docked()) { openCanvas(); pushMsg('user', esc(text)); }

    const t = text.toLowerCase();
    const matches = SHAPES.filter((s) => s.test(t)).sort((a, b) => b.spec - a.spec);
    const shape = matches[0];

    /* A REFUSAL THAT NAMES WHAT IT CAN DO. The old fallback said only that
       it could not help, which is honest and useless — and it was firing
       often, because there were five shapes. Saying no is still the right
       answer; leaving somebody with no next move is not. The suggestions are
       generated from the shapes themselves, so a shape added later shows up
       here without anyone remembering to add it. */
    if (!shape) {
      answerBlock('Not something this surface knows',
        `<p class="s-ans-none">Guessing would be worse than saying so. It does know about leads, touchpoints, campaigns and what AiMY has run — try one of these:</p>
         <div class="s-ans-try">${CAN_ANSWER.map((q) => `<button class="btn btn-ghost btn-sm" type="button" data-ask="${esc(q)}">${esc(q)}</button>`).join('')}</div>`);
      return;
    }

    const scope = scopeFor(shape, text);
    /* The text goes through too. A shape that covers two nearby questions
       needs to know which one was asked; without it, one of them answers
       under the other's name. */
    const res = shape.run(scope, text);
    answerBlock(res.title, res.body, res.citeLabel, res.cite);
  }

  function answerBlock(title, body, citeLabel, cite) {
    const html = `<div class="s-ans">
      <div class="s-ans-title">${title}</div>
      <div class="s-ans-body">${body}</div>
      ${citeLabel ? `<div class="s-ans-cite">
        <span>${esc(citeLabel)}</span>
        ${cite && cite.length ? `<button class="cite-action" type="button" data-cite="${esc(cite.join(','))}">Put them on the surface</button>` : ''}
      </div>` : ''}
    </div>`;
    if (docked()) say('aimy', title, { html });
    else pushMsg('aimy', html);
  }

  /* ═══════════════════════════════════════════════
     THE DOCKED CONVERSATION

     THE RULE: the canvas docks when its work has a subject on screen, and
     overlays when it does not.

     An overlay cannot show a change it is causing. Building a list is a
     conversation whose entire output is a change to the surface behind it —
     the filter row lights up, the count moves — and covering that surface
     with the conversation hides the only evidence the conversation worked.
     Pass 1 got this wrong, and the fix is not "a column always" but "a
     column when there is something to watch".

     Three things go in the rail, and the third is the point:

       1 · what was said
       2 · what AiMY understood — removable chips that rewrite the URL
       3 · WHAT CHANGED — every write, inline, with its own Undo

     Which makes the conversation and the change log the same list. That is
     the answer to "how do I track both at once": there is only one.

     Conversations are SCOPED TO THEIR SUBJECT. V1's rail is a flat global
     chat list carrying "AI - Predictive candidate" four times and "Current
     Job Opportunities Available" twice, because a log has no idea what it is
     about. Here a thread belongs to the list or record it concerns, so
     asking the same thing twice lands in one place and there is nothing to
     deduplicate.
  ═══════════════════════════════════════════════ */

  /* Threads, by subject key. `surface` is the one for the grid itself. */
  const THREADS = Object.create(null);
  const threadKey = () => (S.lead ? 'rec:' + S.lead : S.camp ? 'camp:' + S.camp : 'surface');
  const thread$ = () => (THREADS[threadKey()] || (THREADS[threadKey()] = []));

  /* Derived, never stored. `?talk=1` is the only override, and it can only
     force docking on — you cannot pin the rail shut over work that needs it. */
  function docked() {
    if (S.talk === '1') return true;
    if (S.state === 'ai-down') return false;
    if (S.lead) return true;            /* a record is the subject */
    if (S.camp) return true;            /* so is a campaign */
    if (SEL.size) return true;          /* a selection is the scope */
    return false;
  }

  function paintTalk() {
    const host = $('#talkRail');
    if (!host) return;
    const on = docked();
    document.body.classList.toggle('is-docked', on);
    host.hidden = !on;
    if (!on) return;

    const turns = thread$();
    /* NO HEADER WITH A RECORD OPEN, and it was two defects in one row.

       The chevron ran `go({ talk: '', lead: '' })` and the record's own
       "Back to accounts" runs `go({ lead: '' })` — the same action twice,
       one of them unlabelled, sitting level with each other. And the title
       repeated the record's H1 two hundred pixels to its right.

       Without a record the header stays, because then the rail is being held
       open by a selection or a guided build and the chevron is the only way
       out of it. */
    /* A CAMPAIGN PAGE IS A PAGE TOO. This rule knew only about `S.lead`, so
       opening a campaign brought the header and its chevron back — and the
       chevron sits level with the page's own "Back to campaigns", which is
       the two-ways-out defect this rule was written to remove. Any page
       with its own title and its own Back takes the header away. */
    const onPage = S.lead || S.camp;
    const head = onPage ? '' : `
      <div class="s-talk-head">
        <span class="s-talk-title">${esc(talkTitle())}</span>
        <button class="s-talk-close" type="button" data-talk-close aria-label="Undock the conversation">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>
        </button>
      </div>`;
    host.innerHTML = `
      ${head}
      ${talkChips()}
      <div class="s-talk-scroll${onPage ? ' is-headless' : ''}" id="talkScroll" aria-live="polite">
        ${recTimeline()}
        ${campTimeline()}
        ${turns.length ? turns.map(turnHtml).join('') : talkEmpty()}
      </div>`;
    const sc = $('#talkScroll');
    if (sc) sc.scrollTop = sc.scrollHeight;
  }

  /* ── The touchpoint timeline, inside the rail ──

     It used to be a second column on the right of an open record, which put
     TWO conversation-shaped rails on one page. They are one thing: the
     touchpoints are what has been said to this lead, and the turns are what
     has been said about it. Same subject, same order, one rail.
  */
  function recTimeline() {
    if (!S.lead) return '';
    const rec = recBy(S.lead);
    if (!rec) return '';
    const ts = touchesFor(rec);
    if (!ts.length) return '';
    return `<div class="timeline s-timeline">${ts.slice().reverse().map(touchItem).join('')}</div>`;
  }

  /* ══ WHAT HAS HAPPENED TO THIS CAMPAIGN ══════════════════════════════
     An account already had this: open one and the rail carries every
     touchpoint, who made it, and — for AiMY's — the steps it took. A campaign
     is the other thing you open here and it had nothing, so the question
     "what state is it in and how did it get there" had no answer on screen.

     Built from what is already recorded rather than from an event log the
     product does not keep: the campaign's own fields say when it was made,
     who is on it, whether a plan was chosen and when it ran, and the
     touchpoints say what was actually sent under it. Derived, so it cannot
     disagree with the page beside it.

     THE FIRST STEP IS ALWAYS THERE. A campaign made a minute ago has no
     touchpoints, and an empty rail on something you have just created reads
     as broken rather than as new. "Created" is the origin every campaign has,
     so the rail always opens with the thing that is true. */
  function campTimeline() {
    if (!S.camp) return '';
    const c = openCamp();
    if (!c) return '';
    const st = campState(c);
    const sent = maySeeTouch(DB.touch).filter((t) => t.list === c.k)
      .slice().sort((x, y) => String(y.at).localeCompare(String(x.at)));

    /* TWO QUESTIONS, NOT ONE LIST.

       The first cut merged the campaign's own lifecycle into its touchpoints
       and sorted the lot by date. Measured on a running campaign: **94 rows**,
       four of which were the lifecycle — the answer to "how did this get
       here" buried ninety rows down, and "brief" is what was asked for.

       Worse, it read as wrong: touchpoints credited to this campaign run back
       to January while the campaign was made in July, because a campaign
       GATHERS accounts that were already being worked. Interleaved, that looks
       like a campaign acting before it existed. Separated, it is just true:
       what it is doing now, and how it came to be. */
    const life = [];
    if (c.made) life.push({ at: c.made, seq: 0, kind: 'made', tone: 'neutral',
      title: 'Created', by: c.owner,
      body: `${esc(plural((c.members || []).length, 'account'))} gathered into it.` });
    if ((c.assignees || []).length) life.push({ at: c.made, seq: 1, kind: 'who', tone: 'neutral',
      title: `${plural(c.assignees.length, 'person')} put on it`, by: c.owner,
      body: esc(c.assignees.map((x) => actor(x).name).join(', ')) });
    if (c.plan && c.plan.length) life.push({ at: c.from || c.made, seq: 2, kind: 'plan', tone: 'ok',
      title: 'The plan was set', by: c.owner,
      body: esc(c.plan.map((k) => (BY.channel[k] || { label: k }).label).join(' · ')) });
    if (c.from) life.push({ at: c.from, seq: 3, kind: 'start', tone: 'ok',
      title: 'Started', by: c.owner, body: `Runs to ${esc(fmtDate(c.to))}.` });
    if (st === 'finished') life.push({ at: c.to, seq: 4, kind: 'end', tone: 'neutral',
      title: 'Finished', by: c.owner, body: 'Its window closed. Nothing more sends.' });
    /* Newest first — and `seq` breaks the ties, because several of these
       share a date and a lifecycle listed out of order reads as wrong even
       when every date on it is right. Created is seq 0, so it always ends up
       last: the origin, at the bottom, where the story starts. */
    life.sort((x, y) => String(y.at).localeCompare(String(x.at)) || y.seq - x.seq);

    const RECENT = 6;
    const head = sent.slice(0, RECENT);
    const rest = sent.slice(RECENT);

    return `<div class="s-hist">
      <div class="s-hist-now">
        <span class="s-camp-state tone-${esc(CAMP_STATE[st].tone)}">${esc(CAMP_STATE[st].label)}</span>
        <span class="s-hist-count">${esc(plural(sent.length, 'touchpoint'))} under it</span>
      </div>

      <h4 class="s-hist-h">What it has been doing</h4>
      ${sent.length ? `<div class="timeline s-timeline">${head.map(touchItem).join('')}</div>
        ${rest.length ? `<details class="s-hist-more">
          <summary class="s-hist-sum">${esc(plural(rest.length, 'older touchpoint'))}</summary>
          <div class="timeline s-timeline">${rest.map(touchItem).join('')}</div>
        </details>` : ''}`
        : `<p class="s-hist-new">Nothing has been sent under it yet.${
            st === 'draft' ? ' Choose the channels and a window, and AiMY works the plan from there.' : ''}</p>`}

      ${/* ALWAYS PRESENT, AND ALWAYS ENDING IN "CREATED". A campaign made a
            minute ago has no touchpoints, and an empty rail on something you
            have just made reads as broken rather than as new. */ ''}
      <h4 class="s-hist-h">How it got here</h4>
      <div class="timeline s-timeline">${life.map(histItem).join('')}</div>
    </div>`;
  }

  /* A lifecycle step. Same `.tl-item` vocabulary as a touchpoint so the two
     read as one history rather than two lists that happen to be adjacent. */
  function histItem(e) {
    const a = actor(e.by);
    return `<div class="tl-item s-touch s-hist-item">
      <span class="tl-dot ${esc(e.tone)}">${histIcon(e.kind)}</span>
      <div class="tl-title">${esc(e.title)}</div>
      <div class="tl-time">
        <span class="s-touch-by${a.isAi ? ' is-ai' : ''}">${esc(a.name)}</span>
        · ${esc(fmtDate(e.at))}
      </div>
      ${e.body ? `<div class="tl-body">${e.body}</div>` : ''}
    </div>`;
  }

  const HIST_ICO = { made: 'M12 5v14M5 12h14', who: 'M4 20a8 8 0 0116 0M12 11a4 4 0 100-8 4 4 0 000 8',
    plan: 'M4 6h16M4 12h10M4 18h7', start: 'M7 4l12 8-12 8z', end: 'M6 6h12v12H6z' };
  const histIcon = (k) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${HIST_ICO[k] || HIST_ICO.made}"/></svg>`;

  /* One touchpoint, on the design system's `.timeline`. AiMY's entries are
     visibly AiMY's: the --ai gradient on the actor, never the avatar
     gradient, and a reasoning trace the rep can open. Doctrine Level 6 —
     AiMY's own actions are never disguised as the user's — and Clay's own
     principle, glass box rather than black box. */
  function touchItem(t) {
    const a = actor(t.by);
    const out = BY.outcome[t.outcome];
    const who = DB.conBy[t.on] ? DB.conBy[t.on].name : null;
    return `<div class="tl-item s-touch${t.by === 'aimy' ? ' is-ai' : ''}">
      <span class="tl-dot ${esc(out ? out.tone : 'neutral')}">${chIcon(BY.channel[t.ch].ico)}</span>
      <div class="tl-title">${esc(touchPhrase(t))}${who ? ` <span class="s-touch-who">· ${esc(who)}</span>` : ''}</div>
      <div class="tl-time">
        <span class="s-touch-by${a.isAi ? ' is-ai' : ''}">${esc(a.name)}</span>
        · ${esc(fmtDate(t.at))}
        ${out ? ` · <span class="tone-${esc(out.tone)}">${esc(out.label)}</span>` : ''}
        ${t.list ? ` · ${esc(campName(t.list))}` : ''}
      </div>
      <div class="tl-body">${esc(t.note)}</div>
      ${t.note2 ? `<div class="s-touch-note"><span class="s-touch-note-who">${esc(actor(t.note2.by).name)}</span> ${esc(t.note2.text)}</div>` : ''}
      ${t.by === 'aimy' && !t.note2 ? `<button class="btn btn-ghost btn-sm s-touch-add" type="button" data-annotate="${esc(t.id)}">Add what you know</button>` : ''}
      ${t.steps ? `<details class="s-trace">
        <summary class="s-trace-sum s-ai-btn">${aiMark()}What AiMY did</summary>
        <div class="agent-steps">
          ${t.steps.map((s) => `<div class="agent-step ${s.ok ? 'done' : 'pending'}">
            <span class="agent-step-ico">${s.ok ? '✓' : '–'}</span>
            <span class="s-step-text"><span class="agent-step-label">${esc(s.t)}</span><span class="agent-step-meta">${esc(s.d)}</span></span>
          </div>`).join('')}
        </div>
      </details>` : ''}
    </div>`;
  }

  function talkTitle() {
    if (S.lead) { const r = recBy(S.lead); return r ? r.name : 'This record'; }
    if (SEL.size) return `${plural(SEL.size, 'record')} picked`;
    return 'AiMY';
  }
  function talkEmpty() {
    if (S.lead) {
      const r = recBy(S.lead);
      const ts = r ? touchesFor(r) : [];
      return `<p class="s-talk-empty">${ts.length
        ? `${esc(plural(ts.length, 'touchpoint'))} on ${esc(r.name)}, below. Write here to add one.`
        : `Nothing has happened with ${esc(r ? r.name : 'this lead')} yet. Write what did.`}</p>`;
    }
    if (SEL.size) return `<p class="s-talk-empty">${esc(plural(SEL.size, 'record'))} picked. Ask AiMY to list them, share them, or work out which are worth calling.</p>`;
    return `<p class="s-talk-empty">Ask about what is on screen. Anything you change shows up here with a way back.</p>`;
  }

  /* What AiMY understood, as chips that write the URL. Removing one narrows
     the surface behind the rail — which is the whole reason the rail is a
     rail and not an overlay. */
  function talkChips() {
    const chips = [];
    const add = (k, v, t) => chips.push([k, v, t]);
    S.campaign.forEach((v) => add('list', v, campName(v)));
    S.status.forEach((v) => add('status', v, label('status', v)));
    S.industry.forEach((v) => add('industry', v, label('industry', v)));
    S.size.forEach((v) => add('size', v, label('size', v)));
    S.src.forEach((v) => add('src', v, label('src', v)));
    S.svc.forEach((v) => add('svc', v, label('service', v)));
    if (S.q) add('q', '', `“${S.q}”`);
    if (S.due) add('due', '', DUE[S.due] ? DUE[S.due].label : S.due);
    if (S.touched) add('touched', '', touchedLabel(S.touched));
    if (!chips.length) return '';
    return `<div class="s-talk-chips">
      ${chips.map(([k, v, t]) => `<button class="chip active s-chip" type="button" data-drop-key="${esc(k)}" data-drop-val="${esc(v)}">
        ${esc(t)}<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>`).join('')}
      <span class="s-talk-count">${esc(plural(filtered().length, S.on === 'contacts' ? 'contact' : 'account'))}</span>
    </div>`;
  }

  function turnHtml(t, i) {
    if (t.who === 'you') return `<div class="s-turn is-you"><div class="s-turn-body">${esc(t.text)}</div></div>`;
    if (t.who === 'change') {
      /* A write, in the thread, with its own way back. This is the half V1
         has nowhere: it shows the conversation and never what it did. */
      return `<div class="s-turn is-change">
        <div class="s-change">
          <span class="s-change-mark" aria-hidden="true">±</span>
          <span class="s-change-text">${t.text}</span>
          ${t.undo ? `<button class="s-change-undo" type="button" data-turn-undo="${i}">Undo</button>` : ''}
        </div>
      </div>`;
    }
    /* A question you have already answered keeps its options on screen —
       the thread is a record and deleting the alternatives would hide what
       you chose between — but they are spent. Live buttons on an answered
       turn let you re-answer step one while standing in step two, which
       walks the filters somewhere neither turn agreed to. */
    return `<div class="s-turn is-aimy"><div class="s-turn-body">${t.html || esc(t.text)}</div>
      ${t.opts ? `<div class="s-turn-opts${t.done ? ' is-spent' : ''}">${t.opts.map((o) => `<button class="entry-action em-prompt s-turn-opt${t.done && t.chose === o.v ? ' is-chosen' : ''}" type="button"
        ${t.done ? 'disabled' : `data-turn-pick="${esc(o.v)}"`}>${esc(o.t)}</button>`).join('')}</div>` : ''}
    </div>`;
  }

  const touchedLabel = (k) => (TOUCHED[k] ? TOUCHED[k].label : k.includes('..') ? k.split('..').map((d) => fmtDate(d)).join(' – ') : k);

  /* THE BUILD RUNS IN THE CANVAS, AND NOTHING DOWNSTREAM KNOWS.

     `say`, `noteChange` and `spendTurn` are the only three things that touch
     a thread, so routing them here means `answerTurn`, `askTurn`, `spendTurn`
     and the `data-turn-pick` handler are untouched by the move — and
     `turnHtml` renders the canvas's turns with the rail's exact vocabulary,
     because it was already a pure function of a turn object. */
  const BUILD_THREAD = [];
  const liveThread = () => (BUILDING ? BUILD_THREAD : thread$());
  const paintLive = () => (BUILDING ? paintBuild() : paintTalk());

  function say(who, text, extra) {
    liveThread().push(Object.assign({ who, text }, extra || {}));
    paintLive();
  }

  /* Every write announces itself in the thread of whatever it happened to,
     so the record of a change lives beside the conversation that caused it.
     Called by `toast()` so no write can forget. */
  function noteChange(text, undo) {
    liveThread().push({ who: 'change', text, undo });
    paintLive();
  }

  /* ═══════════════════════════════════════════════
     GUIDED LIST BUILDING

     V1's flow is the best thing in it: *what kind of campaign?* → *how should I
     handle prospects already in your CRM?* → extracted filter chips → a
     **List Criteria** card → **Run Search**. Two turns of three buttons get
     a rep to a scoped query they could not have spelled in one sentence.

     THE ONE CHANGE: every answer writes a URL filter. V1's chips are a
     second store that happens to look like filters; here they ARE the
     filters, and the filter row lights up behind the rail as you answer.
     The List Criteria card is a read-out of `S`, not a copy of it, so it
     cannot fall out of step with the surface it claims to describe.

     The turns are buttons, not free text, because a question with three
     answers is a control.
  ═══════════════════════════════════════════════ */

  let BUILDING = false;
  let BUILD_STEP = 0;

  /* TWO QUESTIONS, AND THE SECOND ASKS SOMETHING THE FIRST DID NOT.

     It used to ask "how should I handle prospects somebody has already
     worked?", whose middle answer applied `status: ['untouched']` — the
     identical filter the first question's commonest answer had just applied.
     Measured: 118 → 47 on the first, 47 → 47 on the second. The code knew,
     and printed "That is already true of what is on screen" rather than a
     change. A step whose likeliest answer is guaranteed to do nothing is a
     click charged for no reason.

     So the second question asks the axis the first cannot reach: WHO they
     are. Every option narrows, and the one that does not says so honestly
     rather than pretending to be a step. */
  const BUILD_TURNS = [
    {
      ask: 'What kind of campaign is this?',
      opts: [
        { v: 'net-new', t: 'Net new prospects', apply: { status: ['untouched'] } },
        { v: 'warm', t: 'People we have already spoken to', apply: { status: ['awaiting-us', 'awaiting-them'] } },
        { v: 'revive', t: 'Ones that went quiet', apply: { status: ['going-cold', 'stalled'] } },
        { v: 'existing', t: 'Work one that already exists', apply: {}, pick: 'camp' },
      ],
    },
    {
      ask: 'Who are you after?',
      opts: [
        { v: 'fin', t: 'Banking & finance', apply: { industry: ['banking'] } },
        { v: 'soft', t: 'Software & manufacturing', apply: { industry: ['software', 'industry'] } },
        { v: 'big', t: 'The large ones, any industry', apply: { size: ['ent'] } },
        { v: 'anyone', t: 'Anyone — I will narrow it myself', apply: {} },
      ],
    },
  ];

  /* ── What the flow is narrowing, and how much of it there is ──
     Every axis that cuts the account list. `on`, `view`, `page` and the rest
     of SCALAR are how you are LOOKING at it, not what is in it. */
  const FILTER_KEYS = ['status', 'campaign', 'industry', 'region', 'size', 'rev',
    'title', 'src', 'owner', 'shared', 'icp', 'svc', 'client', 'inc', 'exc', 'ids'];
  const anyFilter = () => FILTER_KEYS.some((k) => (S[k] || []).length) || !!S.q || !!S.due || !!S.touched;
  const corpusAll = () => maySee(DB.acc).filter((a) => !a.arch).length;
  function clearedFilters() {
    const c = {};
    FILTER_KEYS.forEach((k) => (c[k] = []));
    c.q = ''; c.due = ''; c.touched = '';
    return c;
  }

  /* TURN 0 — ASKED, NOT DECIDED, AND ONLY WHEN THERE IS SOMETHING TO INHERIT.

     Pressing Build while already filtered used to silently ADD the flow's
     answers to your filters, so "net new prospects" could mean something
     different every time depending on what you had on screen. Deciding for
     you either way throws something away: start clean and you lose the
     narrowing you just did; start from it and you may not have meant to.
     So it asks — and only when a filter is actually set, because a question
     with one possible answer is a click charged for no reason. */
  function startTurn() {
    return {
      ask: `You already have ${plural(filtered().length, 'account')} on screen.`,
      opts: [
        { v: 'keep', t: `Start from these ${filtered().length}`, apply: {} },
        { v: 'clean', t: `Start from all ${corpusAll()}`, apply: {}, clear: true },
      ],
    };
  }

  /* The turns for THIS run, so turn 0 can come and go without the fixed
     array or `BUILD_STEP` having to know about it. */
  let TURNS = [];

  function startBuild() {
    /* Through the surface manager, so `cameFrom` records where Build was
       pressed and Cancel can put it back — including the tab and the
       filters this flow is about to rewrite. */
    openSurface('canvas', () => {
      BUILDING = true;
      BUILD_STEP = 0;
      BUILD_THREAD.length = 0;
      BUILD_PAINTED = 0;
      const old = $('.s-build-msg');
      if (old) old.remove();
      openCanvas();
      TURNS = anyFilter() ? [startTurn()].concat(BUILD_TURNS) : BUILD_TURNS.slice();
      /* PINNED TO ACCOUNTS, because the audience IS accounts. The flow wrote
         account filters and `filtered()` reads `S.on`, so building from the
         campaigns tab watched a list of campaigns not change while the card
         counted accounts — measured, 7 campaigns before and after, card
         saying 1 account. The set it counts is now the set it builds from. */
      if (S.on !== 'accounts' || S.lead || S.camp) go({ on: 'accounts', lead: '', camp: '' });
      askTurn();
    });
  }

  /* ── The audience, inside the surface that is building it ──

     The canvas blurs the corpus out — measured, `blur(28px) brightness(0.85)`
     over 67% of the viewport — so the old promise that "the filter row lights
     up behind the rail" could not survive the move. It was not surviving
     where it was, either. So the audience comes WITH the flow: how many, what
     shape they are in, and who the first of them are.

     Sticky, so it stays put while the turns scroll under it — you can always
     see what the question you are answering is doing. */
  function audiencePanel() {
    const list = filtered();
    const n = list.length;
    const all = corpusAll();
    const by = {};
    list.forEach((a) => (by[statusOf(a)] = (by[statusOf(a)] || 0) + 1));
    const bars = TAX.status.filter((x) => by[x.k]);
    return `<div class="s-aud">
      <div class="s-aud-head">
        <span class="s-aud-n">${esc(plural(n, 'account'))}</span>
        ${n < all ? `<span class="s-aud-of">of ${all}</span>` : ''}
      </div>
      ${n ? `<div class="s-camp-dist s-aud-dist" role="img" aria-label="${esc(bars.map((x) => `${by[x.k]} ${x.label.toLowerCase()}`).join(', '))}">
        ${bars.map((x) => `<span class="s-camp-seg tone-${esc(x.tone)}" style="width:${Math.round((by[x.k] / n) * 100)}%"></span>`).join('')}
      </div>
      <div class="s-seed-list s-aud-names">${list.slice(0, 6).map((a) => `<span class="chip default">${esc(a.name)}</span>`).join('')}${n > 6 ? `<span class="s-none s-aud-more">and ${n - 6} more</span>` : ''}</div>`
      : `<p class="s-aud-none">Nothing matches these filters yet.</p>`}
    </div>`;
  }

  /* Appended at the END of the canvas thread, not the top: a build is a new
     topic in a conversation that may already have had one, and the commit
     block that ends it lands underneath in the same order it happened. */
  /* Turns painted so far, so a repaint can be told from an append. */
  let BUILD_PAINTED = 0;

  function paintBuild() {
    const th = $('#overlayThread');
    if (!th) return;
    let host = $('#buildTurns');
    if (!host) {
      /* THE SAME WRAPPER EVERY OTHER THING IN THE THREAD GETS.

         This used to insert a bare `<div>`, which made it the only child of
         `.overlay-thread` that is not a `.chat-msg`. The thread is a 720px
         flex column with 24px padding; `.chat-msg` caps at 640px and
         `.msg-bubble` adds `10px 14px`. So the build turns rendered 32px
         wider and 14px further left than the commit block that follows them
         in the same thread, and the two never lined up — reported as
         "everything is shifted".

         Same markup as `pushMsg`, so there is one grid, not two. */
      th.insertAdjacentHTML('beforeend',
        '<div class="chat-msg aimy s-build-msg"><div class="msg-bubble">'
        + '<div class="s-build" id="buildTurns"></div></div></div>');
      host = $('#buildTurns');
    }
    host.innerHTML = `${audiencePanel()}<div class="s-build-turns">${BUILD_THREAD.map(turnHtml).join('')}</div>`;

    /* ONLY WHEN SOMETHING WAS ADDED. Scrolling on every paint meant that
       repainting the audience after an answer — or anything else that
       re-rendered the same turns — yanked the reader to the bottom. */
    if (BUILD_THREAD.length > BUILD_PAINTED) th.scrollTop = th.scrollHeight;
    BUILD_PAINTED = BUILD_THREAD.length;
  }

  /* "n of 2" on every turn. A flow with no stated length is a flow you cannot
     decide to start — the reported question was literally "when does it
     end?", and nothing on screen answered it. */
  function askTurn() {
    const turn = TURNS[BUILD_STEP];
    if (!turn) { finishBuild(); return; }
    say('aimy', `${BUILD_STEP + 1} of ${TURNS.length} · ${turn.ask}`, { opts: turn.opts.map((o) => ({ v: o.v, t: o.t })) });
  }

  /* Spend the last unanswered turn in the thread. */
  function spendTurn(v) {
    const th = liveThread();
    for (let i = th.length - 1; i >= 0; i--) {
      if (th[i].opts && !th[i].done) { th[i].done = true; th[i].chose = v; return; }
    }
  }

  function answerTurn(v) {
    const turn = TURNS[BUILD_STEP];
    if (!turn) return;
    const opt = turn.opts.find((o) => o.v === v);
    if (!opt) return;

    spendTurn(v);
    say('you', opt.t);
    if (opt.clear) {
      const before = filtered().length;
      go(Object.assign(clearedFilters(), { lead: '', camp: '' }));
      noteChange(`Started fresh — <strong>${esc(plural(filtered().length, 'account'))}</strong>, up from ${before}.`, null);
      BUILD_STEP++; askTurn();
      return;
    }
    if (opt.pick === 'camp') {
      /* Naming a campaign is a filter too — it is the one filter that
         carries a description with it. */
      say('aimy', 'Which one?', { opts: DB.camp.filter((c) => campState(c) !== 'finished').map((c) => ({ v: 'camp:' + c.k, t: c.name })) });
      return;
    }
    if (Object.keys(opt.apply).length) {
      /* Only claim a change when the surface actually moved. Both turns can
         land on `status=untouched` — "net new" and "exclude anyone
         contacted" are the same filter said twice — and logging the second
         one wrote "Filtered to 42 accounts" under a surface that was
         already showing 42. A change log that reports changes that did not
         happen is worth less than no change log. */
      const before = filtered().length;
      go(Object.assign({ lead: '', camp: '' }, opt.apply));
      const after = filtered().length;
      if (after !== before) {
        noteChange(`Filtered to <strong>${esc(plural(after, S.on === 'contacts' ? 'contact' : 'account'))}</strong>.`, null);
      } else {
        say('aimy', `That is already true of what is on screen — still ${plural(after, S.on === 'contacts' ? 'contact' : 'account')}.`);
      }
    }
    BUILD_STEP++;
    askTurn();
  }

  /* ONE FORM, NOT TWO.

     The criteria card asked "Call it" and then handed off to a canvas form
     that asked "Name" again — the same form, twice, for one fact. Worse, the
     handoff settled the card to "Built from 1 account" BEFORE the form ran,
     so refusing the form left the flow permanently claiming a campaign that
     did not exist. Measured: card said built, `DB.camp` still held 7.

     Now the flow ends by opening the commit itself. `canvasWork`'s `run`
     settles AFTER the write and a refused `run` returns false, so there is
     no longer a path that can report an outcome that did not happen. */
  function finishBuild() {
    const ids = ordered(filtered()).map((r) => r.id);
    createCampaign(ids, '', { criteria: criteriaRows() });
  }

  /* The read-out of `S` that used to head the criteria card. Still a
     read-out, so it cannot describe a set other than the one being built. */
  function criteriaRows() {
    const rows = [];
    const add = (l, v) => v && rows.push([l, v]);
    add('Where they are', S.region.map((v) => label('region', v)).join(', ') || 'Netherlands');
    add('Industry', S.industry.map((v) => label('industry', v)).join(', '));
    add('Size', S.size.map((v) => label('size', v)).join(', '));
    add('They would buy', S.svc.map((v) => label('service', v)).join(', '));
    add('Where they came from', S.src.map((v) => label('src', v)).join(', '));
    add('Where they stand', S.status.map((v) => label('status', v)).join(', '));
    add('Matching', S.q);
    return rows;
  }

  /* `criteriaCard()` lived here. It was the first of two forms asking for
     one name, and the thing that settled before the write. Its rows are
     `criteriaRows()` above; its count and preview are `audiencePanel()`.
     Nothing replaced its buttons, because they were the duplicate. */

  function endBuild() { BUILDING = false; BUILD_STEP = 0; }

  /* A BUILD IS ABOUT A LIST, SO IT DOES NOT SURVIVE WALKING INTO A PAGE.

     Measured: opening a record while building left the canvas up with two
     live options over an open record page — a three-turn flow describing a
     filtered set, floating above a single account, with the rail docked to
     the record underneath. Three surfaces, and its audience panel counting
     something nobody was looking at.

     Called from the two controls that open a page. Not from `paint`, which
     also runs during the create's own navigation to the campaign it just
     made — ending the flow there would drop the block mid-settle. */
  function leaveBuild() {
    if (!BUILDING) return;
    endBuild();
    dropWork();
    closeCanvas();
  }

  /* `settleCrit()` lived here, and it is not needed any more. It existed
     to retire a card that had been used; there is now one block, and
     `settleWork` retires it from inside the write it performed. */

  /* ═══════════════════════════════════════════════
     WORK IN THE CANVAS

     The doctrine's rule: CANVAS when it needs comparison, evidence or a set;
     IN PLACE when it changes one record and the change shows on that record.

     Four surfaces were modals and should not have been. Merging compares two
     audiences and counts their overlap. Adding contacts is forty candidates
     with dedupe warnings. Building from a selection is a form and the
     audience it is built from. Re-engage-or-drop is a judgement that needs
     the record's history in view — and the modal was covering it.

     A work block is not a modal in a different place. It stays in the thread
     after it runs, its result lands under it as a change entry, and the
     conversation that produced it is still there to read. A modal's whole
     contract is that it disappears and takes its reasoning with it.
  ═══════════════════════════════════════════════ */

  let workRun = null;
  let workSeq = 0;

  function canvasWork(o) {
    openSurface('canvas', () => renderWork(o));
  }

  function renderWork(o) {
    openCanvas();
    /* Only one block can be live at a time — `workRun` holds exactly one —
       so asking for something else while a block is open leaves the old one
       on screen with a confirm button that silently does nothing. It gets
       settled instead, which is what actually happened: you left it. Found
       when the four verbs made it easy to stack three of them. */
    if (workRun) settleWork(workRun.id, 'Left undone — you asked for something else.');
    const id = 'wk' + ++workSeq;
    /* `writes` defaults to true because almost every work block does. A
       read-only block opts out, and the opt-out is explicit so nobody adds
       a writing block that quietly leaves the glass up. */
    workRun = { id, run: o.run, writes: o.writes !== false };
    /* A CONFIRM THAT REFUSES IS A CONFIRM THAT SHOULD HAVE BEEN DISABLED.
       An unnamed campaign used to be caught by `run` and answered with a
       toast — after you had committed. `o.needs` names a field that has to
       carry something, and `gateWork` keeps the button honest as you type,
       the same bargain `gateCommit` makes on the modal. */
    pushMsg('aimy', `<div class="s-work" id="${id}">
      <div class="s-work-head">
        <span class="s-work-mark">${aiMark()}</span>
        <span class="s-work-title">${esc(o.title)}</span>
      </div>
      ${o.lede ? `<p class="s-work-lede">${esc(o.lede)}</p>` : ''}
      <div class="s-work-body">${o.body}</div>
      <div class="s-effects">
        <div class="s-effects-title">What this changes</div>
        ${o.effects.filter(Boolean).map((e) => `<div class="s-effect is-${esc(e[0])}"${e[2] ? ` data-effect="${esc(e[2])}"` : ''}>${esc(e[1])}</div>`).join('')}
      </div>
      ${/* THREE EXITS ONLY WHERE THREE ARE REAL. Cancel puts back what you
             had; the alt makes nothing but keeps what the flow narrowed to;
             the confirm writes. Two of those are "no campaign", and merging
             them would throw away the filters — which is the whole point of
             the one people actually use. Blocks that have two exits still
             render two. */ ''}
      <div class="s-work-actions${o.alt ? ' has-alt' : ''}">
        <button class="s-work-cancel" type="button" data-work-cancel="${id}">Cancel</button>
        ${o.alt ? `<button class="btn btn-ghost btn-sm" type="button" data-work-alt="${id}">${esc(o.alt)}</button>` : ''}
        <button class="btn btn-brand btn-sm" type="button" data-work-go="${id}"${o.needs ? ' disabled aria-disabled="true"' : ''}>${esc(o.confirm)}</button>
      </div>
    </div>`);
    gateWork(o, id);
  }

  /* Named-field gate for a canvas block. Never traps: a `needs` pointing at
     a field that is not in this body releases the button rather than leaving
     it disabled forever — the same refusal-to-trap `gateCommit` makes. */
  function gateWork(o, id) {
    if (!o.needs) return;
    const sync = () => {
      const f = $('#' + id + ' ' + o.needs);
      const go = $('[data-work-go="' + id + '"]');
      if (!go) return;
      const ok = !f || !!String(f.value || '').trim();
      go.disabled = !ok;
      go.setAttribute('aria-disabled', String(!ok));
    };
    const f = $('#' + id + ' ' + o.needs);
    if (f) f.addEventListener('input', sync);
    sync();
  }

  /* Remove the block that is still live, without touching any settled one
     above it. Redrawing a live block is not a new turn in the conversation. */
  function dropWork() {
    const el = workRun && $('#' + workRun.id);
    if (el) el.closest('.chat-msg').remove();
    workRun = null;
  }

  /* The confirm carries the count, as V1's "Add Selected (12)" does, and it
     tracks the ticks rather than the list it was drawn with. */
  function paintAddCount() {
    const n = $$('.s-add-tick:checked').length;
    const btn = $('[data-work-go]');
    if (btn) btn.textContent = `Add selected (${n})`;
    const line = $('[data-effect="addCount"]');
    if (line) line.textContent = n
      ? `Adds ${plural(toAccountIds($$('.s-add-tick:checked').map((i) => recBy(i.value)).filter(Boolean)).length, 'account')}. Every contact at them joins too.`
      : 'Nothing is ticked, so nothing would be added.';
  }

  /* A work block that has run stops being a control and becomes a record of
     what was done — its actions collapse into one line. Leaving live buttons
     on finished work invites running it twice. */
  function settleWork(id, said) {
    const el = $('#' + id);
    if (!el) return;
    el.classList.add('is-done');
    const body = $('.s-work-body', el);
    if (body) body.remove();
    const acts = $('.s-work-actions', el);
    if (acts) acts.outerHTML = `<div class="s-work-said">${esc(said)}</div>`;
  }

  /* The AiMY mark. Anything AiMY authored or is about to do carries it —
     an AiMY affordance that looks like an ordinary button is the same
     defect as an AiMY touchpoint attributed to a rep. */
  const aiMark = () => `<svg viewBox="0 0 18 20" width="13" height="14" aria-hidden="true"><use href="#aimy-logo-small"/></svg>`;

  /* ── The canvas ── */
  function openCanvas() {
    const ov = $('#aimyOverlay');
    if (ov) ov.classList.add('open');
    /* No body lock here, and no `scrollTo`. Both were added last pass on the
       theory that the document was scrolling; `body` is already
       `height: 100vh; overflow: hidden`, so they could never have done
       anything. The real scroller is this thread, and it is handled where it
       actually scrolls — `pushMsg` and `paintBuild`. A rule that does nothing
       is worse than no rule: it reads as protection and sends the next
       person looking in the wrong place. */
    const sug = $('#overlaySuggestions');
    if (sug) sug.remove();
    paintContext();
  }
  function closeCanvas() {
    const ov = $('#aimyOverlay');
    if (ov) ov.classList.remove('open');
  }
  function pushMsg(who, html) {
    const th = $('#overlayThread');
    if (!th) return;
    th.insertAdjacentHTML('beforeend', `<div class="chat-msg ${who === 'user' ? 'user' : 'aimy'}"><div class="msg-bubble">${html}</div></div>`);
    /* A FORM IS READ FROM ITS TOP. Pinning the thread to the bottom put the
       commit block's footer on screen and everything else above the fold —
       measured, the required Name field 321px out of sight and the block's
       own title 479px. Scroll to where the block STARTS instead; it is
       capped and scrolls internally, so its actions stay reachable. */
    const last = th.lastElementChild;
    if (last && $('.s-work', last)) th.scrollTop = last.offsetTop - th.offsetTop;
    else th.scrollTop = th.scrollHeight;
    th.classList.add('is-at-end');
  }

  /* The canvas shows its basis without being asked. It is the filter state,
     phrased — so the conversation and the surface behind the glass can
     never be talking about different sets. */
  function paintContext() {
    const host = $('#overlayContextTags');
    if (!host) return;
    const tags = [];
    if (S.campaign.length) tags.push(campName(S.campaign[0]));
    if (S.status.length) tags.push(label('status', S.status[0]));
    if (S.owner.length) tags.push(S.owner[0] === 'mine' ? 'mine' : S.owner[0] === 'team' ? 'my team' : actor(S.owner[0]).name);

    if (S.q) tags.push(`“${S.q}”`);
    tags.push(plural(filtered().length, S.on === 'contacts' ? 'contact' : 'account'));
    host.innerHTML = tags.map((t) => `<span class="overlay-context-tag">${esc(t)}</span>`).join('');
  }

  /* ═══════════════════════════════════════════════
     NON-HAPPY STATES

     `?state=loading | error | ai-down`. AI-unavailable is the interesting
     one: filters, grid, table and the record are all state reads
     and keep working. Only the parse and the canvas degrade, and the input
     says so rather than swallowing what you typed.
  ═══════════════════════════════════════════════ */

  const aiDown = () => S.state === 'ai-down';

  function stateScreen() {
    if (S.state === 'loading') {
      /* THE SKELETON HAS THE SHAPE OF WHAT IT REPLACES.

         It was one blank block per card. Knowledge's is a card outline with
         four lines of graduated width that mirror its real anatomy, and the
         difference is not decoration: a skeleton that shows how many lines
         are coming and how long they run tells you what is loading, and one
         grey rectangle tells you only that something is.

         The widths follow this card, not Knowledge's — type row, name,
         subtitle, then the meta line under its rule. */
      const rows = S.on === 'tasks'
        ? [['34%', 10], ['74%', 15], ['58%', 11]]
        : [['30%', 10], ['66%', 15], ['48%', 12], ['86%', 11]];
      return `<div class="s-skel s-stagger" aria-busy="true" aria-label="Loading">${Array.from({ length: 6 }, (_, i) =>
        `<div class="s-skel-card" style="--i:${i}">${rows.map(([w, h], j) =>
          `<div class="skeleton s-skel-line${j === rows.length - 1 ? ' is-meta' : ''}" style="width:${w};height:${h}px"></div>`).join('')}</div>`).join('')}</div>`;
    }
    if (S.state === 'error') {
      return `<div class="error-state s-error">
        <div class="empty-state-title">The lead store did not answer</div>
        <p class="empty-state-desc">Nothing was lost — no write was in flight. The filters and the URL are still exactly as you left them, so retrying lands on the same surface.</p>
        <button class="btn btn-brand" type="button" data-quick="state=">Try again</button>
      </div>`;
    }
    return null;
  }

  function aiBanner() {
    if (!aiDown()) return '';
    return `<div class="ai-unavailable is-degraded s-aidown">
      <span class="aiu-mark">AiMY</span>
      <div>
        <div class="aiu-title">AiMY cannot be reached</div>
        <p class="aiu-body">Everything that reads the record still works: the filters, the table, every lead and its whole touchpoint history. You can still log a touchpoint — it is written here, not by AiMY.</p>
        <p class="aiu-fallback">What is off: asking questions, and reading a filter out of a sentence. Type a filter into the controls instead.</p>
        <p class="aiu-note">No campaign step will send while this lasts. Nothing queued is lost.</p>
      </div>
    </div>`;
  }

  /* ═══════════════════════════════════════════════
     THE PROTOTYPE CONTROL — scaffolding, not product

     Its contents are built from the LIVE CORPUS rather than hard-coded, so
     every link resolves to a record that really is in that state, and a
     link that cannot resolve is not rendered — the same rule the product
     holds itself to.

     The empty-state triggers force the REAL condition by mutating the
     corpus, never by faking markup, so what you see is what a person would
     see. None of them reloads: a reload re-runs the fixtures and would put
     back the very thing the trigger just took away.
  ═══════════════════════════════════════════════ */

  function proto() {
    const panel = $('#protoPanel');
    if (!panel) return;

    const pick1 = (fn) => maySee(DB.acc.concat(DB.con)).find(fn);
    const byStatus = TAX.status.map((s) => {
      const r = pick1((x) => !x.arch && statusOf(x) === s.k);
      return r ? [s.label, `?lead=${r.id}${DB.conBy[r.id] ? '&on=contacts' : ''}`] : null;
    }).filter(Boolean);

    const byChannel = TAX.channel.map((c) => {
      const t = DB.touch.find((x) => x.ch === c.k);
      return t ? [c.label, `?lead=${t.acc}`] : null;
    }).filter(Boolean);

    const sec = (title, rows) => rows.length ? `<div class="proto-sec">
      <div class="proto-h">${esc(title)}</div>
      ${rows.map((r) => Array.isArray(r)
        ? `<a class="proto-link" href="${esc(r[1])}">${esc(r[0])}</a>`
        : r).join('')}
    </div>` : '';

    panel.innerHTML =
      /* WHICH BUILD IS ACTUALLY LOADED.

         A defect was reported four times that could not be reproduced at the
         reporter's own viewport, URL and click path — because the page was
         being opened over `file://`, where the browser can serve a cached
         script long after the file on disk has changed. There was no way to
         tell a stale page from a live one by looking at it, so every report
         and every fix was arguing about different code.

         Read out of this script's OWN url rather than written as a constant,
         so the stamp cannot disagree with the file it came from: a constant
         says what the source claims, this says what the browser loaded. */
      `<div class="proto-build">Build <strong>${esc(BUILD)}</strong> · ${esc(location.protocol)}</div>` +
      sec('One record in each status', byStatus) +
      sec('One record per channel', byChannel) +
      sec('The four input routes', [
        ['filter · untouched leads in amsterdam', '#'].concat(),
      ].length ? [
        `<button class="proto-link" type="button" data-proto-in="untouched leads in amsterdam">filter — untouched in amsterdam</button>`,
        `<button class="proto-link" type="button" data-proto-in="${esc(DB.acc[0].name)}">open — ${esc(DB.acc[0].name)}</button>`,
        `<button class="proto-link" type="button" data-proto-in="which campaigns are stalling?">ask — which campaigns are stalling?</button>`,
        `<button class="proto-link" type="button" data-proto-in="log a call with ${esc(DB.acc[0].name)}, positive, next step demo Tuesday">write — log a call</button>`,
        `<button class="proto-link" type="button" data-proto-in="what is our policy on office dogs?">ask — something it cannot answer</button>`,
      ] : []) +
      sec('Every surface', [
        ['cards', '?'],
        ['table', '?view=table'],
        ['contacts', '?on=contacts'],
        ['a campaign brief', '?on=campaigns&camp=q3-nl'],
        ['a closed campaign', '?on=campaigns&camp=edu-nl'],
      ]) +
      sec('Non-happy states', [
        ['loading', '?state=loading'],
        ['error', '?state=error'],
        ['AiMY unavailable', '?state=ai-down'],
      ]) +
      sec('Empty states — the real condition, not fake markup', [
        `<button class="proto-link" type="button" data-empty="results">no results</button>`,
        `<button class="proto-link" type="button" data-empty="quiet">a quiet briefing</button>`,
        `<button class="proto-link" type="button" data-empty="thread">a lead with no touchpoints</button>`,
        `<button class="proto-link" type="button" data-empty="nobell">nothing waiting on you</button>`,
        `<button class="proto-link" type="button" data-empty="corpus">an empty book</button>`,
        `<button class="proto-link" type="button" data-empty="reset">put it all back</button>`,
      ]);
  }

  /* Each of these makes the condition true. Faking the markup would show a
     picture of an empty state rather than the empty state. */
  function forceEmpty(which) {
    switch (which) {
      case 'results':
        go({ q: 'zzzzz', status: [], campaign: [], lead: '', view: 'cards' });
        return;
      case 'quiet': {
        /* Everything answered, nothing overdue, nothing cold, nothing
           bounced, nothing shared with me, nothing left unreviewed.

           AiMY's sends go BACK rather than forward. The first version set
           every touchpoint to two days ago, which made "AiMY sent 42
           messages in the last fortnight" true of all of them — a trigger
           that fed the entry it was supposed to clear. */
        DB.touch.forEach((t) => {
          if (t.dir === 'in') t.dir = 'out';
          if (t.outcome === 'bounced') t.outcome = 'neutral';
          t.at = iso(shift(TODAY, t.by === 'aimy' ? -45 : -2));
        });
        reindex();
        DB.acc.concat(DB.con).forEach((r) => {
          if (r.next) r.next.due = iso(shift(TODAY, 21));
          r.shared = r.shared.filter((s) => s !== me().id);
          if (statusOf(r) === 'untouched' && accOf(r).src === 'scrape') accOf(r).src = 'list';
          /* A record whose only history is an old AiMY send has no `next`
             to move, so the date shuffle above leaves it going cold. Give
             it one — that IS what "nothing is drifting" means, and forcing
             the condition beats hiding the entry. */
          if (statusOf(r) === 'going-cold') r.next = { what: 'Follow up', due: iso(shift(TODAY, 21)), by: r.owner };
        });
        reindex(); paint(); paintChrome();
        toast('Briefing emptied. Reload, or “put it all back”.');
        return;
      }
      case 'thread': {
        const r = DB.acc.find((a) => !touchesFor(a).length) || DB.acc[0];
        DB.touch = DB.touch.filter((t) => t.acc !== r.id);
        reindex();
        go({ lead: r.id, on: 'accounts' });
        return;
      }
      case 'nobell':
        DB.acc.concat(DB.con).forEach((x) => {
          if (x.owner === me().id || (x.shared || []).includes(me().id)) {
            if (x.next) x.next.due = iso(shift(TODAY, 21));
          }
        });
        DB.touch.forEach((t) => { if (t.dir === 'in') t.dir = 'out'; });
        reindex(); paint(); paintChrome();
        toast('Nothing is waiting on you now. Open the bell.');
        return;
      case 'corpus':
        DB.acc = []; DB.con = []; DB.touch = [];
        reindex(); paint(); paintChrome();
        return;
      case 'reset':
        build(); paint(); paintChrome();
        toast('Fixtures rebuilt.');
        return;
    }
  }

  /* ═══════════════════════════════════════════════
     RENDER — one entry point, driven by the URL
  ═══════════════════════════════════════════════ */

  function paint() {
    const stage = $('#wbStage');
    if (!stage) return;

    const rec = openRec();
    const camp = openCamp();
    settingsSheet();
    paintTalk();

    /* A record is a page. The rail and the row step aside rather than
       hovering over something that is not on screen — a filter row above an
       open record is a control for a list you are not looking at.

       A campaign is a page on exactly the same terms, so it shares the flag
       and everything that keys off it. */
    document.body.classList.toggle('is-record', !!rec || !!camp);
    /* AND THE GLOBAL FILTER TRAY GOES WITH THEM. It is fixed to the WINDOW,
       so hiding the sidebar and clearing the filter row left it floating over
       every open record and campaign — four chips that filter the corpus,
       hovering over one account, with nothing saying which they applied to.
       That is the reported confusion exactly: "am I filtering inside the
       thing I opened, or globally again?"

       On a page the answer is now structural rather than a label: the only
       filters on screen are the page's own, and they say what they narrow. */

    /* A campaign page. Same region, same rules, same Back. */
    if (camp) {
      $('#filterBar').innerHTML = '';
      $('#chipBar').innerHTML = '';
      /* `campkey`, NOT `camp`. The stage carries a marker so a repaint can
         tell "same campaign redrawn" from "a different one opened" — and
         `[data-camp]` is a live handler selector, so naming the marker
         `camp` made the stage itself match it. Every click anywhere inside
         the page then resolved to "navigate to this campaign" before
         reaching its own handler, and Add contacts silently did nothing.

         This is the second time a state marker has collided with a handler
         selector here — `<body data-page>` did it first, and every
         unhandled click became a navigation. `wiring-audit` now checks for
         it, because twice is a pattern. */
      const freshC = stage.dataset.campkey !== camp.k;
      stage.dataset.campkey = camp.k;
      delete stage.dataset.lead;
      stage.innerHTML = campPage(camp);
      if (freshC) $('#pageScroll').scrollTop = 0;
      floatPlaceholder();
      return;
    }
    delete stage.dataset.campkey;

    /* Asked for a campaign and did not get one. Same two reasons a record
       has, and the same answer under clean scoping: not here. */
    if (S.camp && !camp) {
      $('#filterBar').innerHTML = '';
      $('#chipBar').innerHTML = '';
      stage.innerHTML = `<div class="empty-state s-empty">
        <div class="empty-state-title">That campaign is not here</div>
        <p class="empty-state-desc">The link points at something this workspace does not hold. It may have been merged into another, or removed.</p>
        <button class="btn btn-brand" type="button" data-close-camp>Back to campaigns</button>
      </div>`;
      return;
    }

    if (rec) {
      $('#filterBar').innerHTML = '';
      $('#chipBar').innerHTML = '';
      /* Only on open, never on repaint. Logging a touchpoint used to carry
         you to the top of the record that had just changed. */
      const fresh = stage.dataset.lead !== rec.id;
      stage.dataset.lead = rec.id;
      stage.innerHTML = recordPage(rec);
      if (fresh) $('#pageScroll').scrollTop = 0;
      floatPlaceholder();
      return;
    }

    delete stage.dataset.lead;

    /* A lead was asked for and did not open. Say which of the two reasons it
       was, and leave a way out that is not the back button. */
    const denial = leadDenial();
    if (denial) {
      $('#filterBar').innerHTML = '';
      $('#chipBar').innerHTML = '';
      stage.innerHTML = `<div class="empty-state s-empty s-denied">
        ${lockMark()}
        <div class="empty-state-title">${esc(denial.title)}</div>
        <p class="empty-state-desc">${esc(denial.body)}</p>
        <button class="btn btn-brand btn-sm" type="button" data-quick="lead=">Back to what you can see</button>
      </div>`;
      return;
    }

    /* Loading and error replace the surface; ai-down does not, because
       everything that reads the record still works. */
    const screen = stateScreen();
    if (screen) { $('#filterBar').innerHTML = ''; $('#chipBar').innerHTML = ''; stage.innerHTML = screen; return; }

    const list = onTasks() ? orderedTasks(filteredTasks()) : onCamps() ? orderedCamps(filteredCampaigns()) : onTeam() ? orderedTeam(filteredTeam()) : ordered(filtered());
    /* A selection that survives its own records leaving the surface is a
       scope nobody can see. Drop anything the filters no longer show. */
    if (SEL.size) {
      const here = new Set(list.map((r) => r.id));
      [...SEL].forEach((id) => { if (!here.has(id)) SEL.delete(id); });
    }
    $('#filterBar').innerHTML = filterRow();
    $('#chipBar').innerHTML = chipBar();
    stage.innerHTML = aiBanner() + resultLine(list) + scopeBar() + grid(list);

    const hint = $('.aimy-float-hint');
    if (hint) hint.textContent = aiDown() ? 'Filters only' : 'Enter to run';
    floatPlaceholder();
  }

  /* ONE INPUT, and it says what it will do with what you type here.
     There used to be three — this bar, one in the rail, and a composer on
     the record — which made the first question of every interaction "which
     box?". They all ran the same router, so the answer never mattered, which
     is the definition of a choice not worth offering. */
  function floatPlaceholder() {
    const input = $('#floatInput');
    if (!input) return;
    const rec = S.lead ? recBy(S.lead) : null;
    /* The placeholder is a promise about what pressing Enter will do, so it
       has to know what this account may do. Offering "log a touchpoint" to
       somebody who cannot write is the button-that-refuses defect wearing a
       different hat. */
    input.placeholder = aiDown() ? 'Type a filter — AiMY is unreachable…'
      : !canWrite() ? (rec ? `Ask about ${rec.name}…` : 'Ask or filter — this account does not write…')
      : rec ? `Log a touchpoint on ${rec.name}, or ask about it…`
      : SEL.size ? `What should I do with the ${plural(SEL.size, 'record')} you picked?`
      : 'Ask, filter, name a lead, or log a touchpoint…';
  }

  /* An empty corpus is a state the product has to hold, not an error. */
  function emptyCorpus() {
    return `<div class="empty-state s-empty">
      <div class="empty-state-title">There are no leads yet</div>
      <p class="empty-state-desc">Drop a list of companies anywhere on this page, or ask AiMY to find some — <em>large tech companies in the Netherlands</em> is the query V1 was built around.</p>
    </div>`;
  }

  /* Everything the URL does not decide: the rail, the bell, and the canvas's
     basis. Separated from `paint` because they survive a record opening —
     re-rendering the briefing on every keystroke of a filter would restart
     its entry animation for a list that did not change. */
  function paintChrome() {
    paintWho();
    paintTalk();
    briefing();
    bell();
    paintContext();
    proto();
  }

  /* The pill states the tier, not just the name. "Nour Wael · Product Design"
     says who you are and nothing about what you can see; on a surface where
     two people get two different worlds, the second is the fact that explains
     the first. */
  function paintWho() {
    const w = me();
    const t = TIERS[w.tier];
    const av = $('#userAvatar'); if (av) av.textContent = w.initials;
    const nm = $('#userName'); if (nm) nm.textContent = w.name;
    /* THE ROLE LINE IS THE JOB TITLE, and nothing else. It had the tier
       appended — "Product Design · Admin" — which made a two-word slot into
       a four-word one and put a permission level where a job description
       goes. The tier is in the Looking-as panel below, next to every other
       person's, which is the only place it means anything comparative.

       A client is the exception, because for them the engagement IS the
       context: "Procurement · Upland" says who they are here. */
    const rl = $('#userRole');
    if (rl) rl.textContent = w.tier === 'client' ? `${w.role} · ${clientName(w.client)}` : w.role;

    const list = $('#asList');
    if (!list) return;
    list.innerHTML = REPS.map((p) => {
      const pt = TIERS[p.tier];
      return `<li><button class="as-item${p.id === w.id ? ' is-current' : ''}" type="button" data-as="${esc(p.id)}">
        <span class="avatar avatar-sm">${esc(p.initials)}</span>
        <span class="as-item-text">
          <span class="as-name">${esc(p.name)}${p.id === w.id ? ' <span class="as-you">you</span>' : ''}</span>
          <span class="as-rule">${esc(pt.rule)}</span>
        </span>
        <span class="as-tier">${esc(pt.label)}</span>
      </button></li>`;
    }).join('');
  }

  /* ═══════════════════════════════════════════════
     WIRING — delegated, no inline handlers
  ═══════════════════════════════════════════════ */

  /* One value on a multi-value axis, set from a dropdown: replace rather
     than append. A dropdown names one thing; adding to a set from a control
     that can only show one of them is how the row and the chips come to
     disagree. */
  /* Rows-per-page is a native select — the only one on this surface, and it
     earns the exception: `.v2-dropdown` is a full listbox for three numbers
     that live in a table footer, and the library's own rule is native
     elements first. Noted in ../GAPS.md rather than smuggled. */
  document.addEventListener('change', (e) => {
    if (!e.target.classList) return;
    /* Typing a date of your own clears the quick pick, because the two are
       one control and only one of them can be the answer. */
    if (e.target.classList.contains('s-when-date')) { paintWhen(null); return; }
    if (!e.target.classList.contains('s-per-sel')) return;
    go({ per: e.target.value === '50' ? '' : e.target.value, page: '' });
  });

  document.addEventListener('dd:change', (e) => {
    const dd = e.target.closest('.v2-dropdown');
    if (!dd || !dd.dataset.filterKey) return;
    const key = dd.dataset.filterKey;
    /* The sentinel comes back out here and nowhere else, so `S`, the URL, the
       chip bar and every count only ever see a real value or nothing. */
    const v = e.detail.value === ALL_OPT ? '' : e.detail.value;
    go({ [key]: MULTI.includes(key) ? (v ? [v] : []) : v });
  });

  document.addEventListener('click', (e) => {
    let el;

    if ((el = e.target.closest('[data-on]'))) { go({ on: el.dataset.on, lead: '', task: '', page: '' }); return; }

    /* Looking as someone else resets the record and the page, because both
       are positions inside a world that has just changed size. Landing on
       `?lead=a10` as a client who cannot see a10 would be an empty page with
       no explanation, which is the failure this whole section exists to
       prevent. */
    if ((el = e.target.closest('[data-as]'))) {
      go({ as: el.dataset.as, lead: '', page: '', task: '', camp: '' });
      const who = actor(el.dataset.as);
      toast(`Looking as ${who.name} — ${TIERS[who.tier].label}.`);
      return;
    }
    if ((el = e.target.closest('[data-view]'))) { go({ view: el.dataset.view }); return; }

    if ((el = e.target.closest('[data-drop-key]'))) {
      const key = el.dataset.dropKey;
      const val = el.dataset.dropVal;
      if (MULTI.includes(key)) go({ [key]: (S[key] || []).filter((v) => v !== val) });
      else go({ [key]: '' });
      return;
    }
    if (e.target.closest('[data-clear-all]')) {
      const cleared = {};
      for (const k of MULTI) cleared[k] = [];
      for (const k of SCALAR) if (!['on', 'view'].includes(k)) cleared[k] = '';
      go(cleared);
      return;
    }

    /* The quick chips and the result line's "waiting on a person" both
       write filters, so both go through one parser rather than each
       inventing its own way to say `status=awaiting-us,stalled`. */
    /* SCOPED, NOT GLOBAL. `data-quick` deliberately clears `camp` and
       `lead` — every one of those controls means "go to the list". This one
       is the opposite: it narrows the list you are ALREADY inside, so it
       keeps `camp` and toggles rather than replaces. Two attributes because
       they are two different promises, not one with a flag. */
    if ((el = e.target.closest('[data-cstatus]'))) {
      const k = el.dataset.cstatus;
      go({ in: S.in === k ? '' : k });
      return;
    }
    if ((el = e.target.closest('[data-quick]'))) {
      const [key, raw] = el.dataset.quick.split('=');
      go({ [key]: MULTI.includes(key) ? raw.split(',') : raw, camp: '', lead: '' });
      return;
    }
    /* Two axes at once, from the campaign sheet's status rows. Same parser,
       one more `&` — not a second way of writing a filter. */
    if ((el = e.target.closest('[data-quick2]'))) {
      const over = { camp: '', lead: '' };
      el.dataset.quick2.split('&').forEach((pair) => {
        const [k, v] = pair.split('=');
        over[k] = MULTI.includes(k) ? v.split(',') : v;
      });
      go(over);
      return;
    }

    /* A campaign opens as a page, so this is navigation like `data-open`
       is — not a surface being raised over something. */
    /* `in: ''` on BOTH doors. A narrowing made inside one campaign is not a
       narrowing of the next one, and it is not a filter of the corpus. */
    if ((el = e.target.closest('[data-camp]'))) { leaveBuild(); go({ camp: el.dataset.camp, lead: '', task: '', in: '' }); return; }
    if (e.target.closest('[data-close-camp]')) { go({ camp: '', on: 'campaigns', in: '' }); return; }
    if (e.target.closest('[data-sheet-close]')) { go({ task: '' }); return; }
    if (e.target.classList && e.target.id === 'setOverlay') { go({ task: '' }); return; }

    /* ── Tasks ── */
    if ((el = e.target.closest('[data-task]'))) { go({ task: el.dataset.task }); return; }
    if ((el = e.target.closest('[data-taskpause]'))) { taskPause(el.dataset.taskpause); return; }
    if ((el = e.target.closest('[data-taskstop]'))) { taskStop(el.dataset.taskstop); return; }
    if ((el = e.target.closest('[data-taskundo]'))) { taskUndo(el.dataset.taskundo); return; }
    if ((el = e.target.closest('[data-taskgo]'))) { taskDecide(el.dataset.taskgo); return; }

    /* ── More ── */
    if ((el = e.target.closest('[data-more]'))) {
      const panel = el.nextElementSibling;
      panel.hidden = !panel.hidden;
      el.setAttribute('aria-expanded', String(!panel.hidden));
      return;
    }
    if (e.target.closest('[data-clear-more]')) {
      const cleared = {};
      MORE_AXES().forEach((k) => (cleared[k] = AXES[k].scalar ? '' : []));
      go(cleared);
      return;
    }
    if (!e.target.closest('.s-more-wrap')) {
      const p = $('.s-more-panel');
      if (p && !p.hidden) { p.hidden = true; const b = $('[data-more]'); if (b) b.setAttribute('aria-expanded', 'false'); }
    }

    /* ── Opening and closing a record ── */
    if ((el = e.target.closest('[data-open]'))) {
      leaveBuild();
      const id = el.dataset.open;
      /* A contact opened from an account keeps the surface it came from, so
         Back goes where you were rather than to whichever list the record
         happens to belong to. */
      go({ lead: id, on: DB.conBy[id] ? 'contacts' : 'accounts' });
      return;
    }
    if (e.target.closest('[data-close-rec]')) { go({ lead: '' }); return; }

    /* ── The exits ── */
    if ((el = e.target.closest('[data-exit]'))) { runExit(el.dataset.exit); return; }
    if ((el = e.target.closest('[data-reschedule]'))) { reschedule(el.dataset.reschedule); return; }
    if ((el = e.target.closest('[data-share]'))) { shareRec(el.dataset.share); return; }
    if ((el = e.target.closest('[data-addlist]'))) { addRecToCampaign(el.dataset.addlist); return; }
    if ((el = e.target.closest('[data-addto]'))) { addToCampaign(el.dataset.addto); return; }
    if ((el = e.target.closest('[data-merge]'))) { mergeCampaigns(el.dataset.merge); return; }
    if ((el = e.target.closest('[data-assign]'))) { assignCampaign(el.dataset.assign); return; }
    if ((el = e.target.closest('[data-plan]'))) { givePlan(el.dataset.plan); return; }
    if ((el = e.target.closest('[data-archive]'))) { archiveRec(el.dataset.archive); return; }
    if ((el = e.target.closest('[data-uncamp]'))) { const [i, k] = el.dataset.uncamp.split('|'); removeFromCampaign(i, k); return; }
    if ((el = e.target.closest('[data-stop]'))) { stopCampaign(el.dataset.stop); return; }
    if ((el = e.target.closest('[data-annotate]'))) { annotateTouch(el.dataset.annotate); return; }
    if ((el = e.target.closest('[data-fixaddr]'))) { fixAddress(el.dataset.fixaddr); return; }
    if ((el = e.target.closest('[data-override]'))) { overrideStatus(el.dataset.override); return; }
    if ((el = e.target.closest('[data-kbrev]'))) { askReview(el.dataset.kbrev); return; }
    if ((el = e.target.closest('[data-kbfix]'))) { correctKnowledge(el.dataset.kbfix); return; }
    if (e.target.closest('[data-newlist]')) { createCampaign(selectedIds()); return; }
    if (e.target.closest('[data-clearsel]')) { clearSel(); paint(); return; }
    if (e.target.closest('[data-addsel]')) { pickCampaignForSelection(); return; }

    /* The merge preview is live, because the effects panel says it is.
       V1 shows a static "TOTAL CONTACTS 4,821 +1,200 · DUPLICATE COUNT 142"
       that cannot correspond to a selection you have not made yet. */
    if (e.target.closest('.s-merge-tick')) { paintMergeSum(); }

    /* ── The date range ── */
    if ((el = e.target.closest('[data-cal-open]'))) {
      const panel = el.nextElementSibling;
      panel.hidden = !panel.hidden;
      el.setAttribute('aria-expanded', String(!panel.hidden));
      return;
    }
    if ((el = e.target.closest('[data-cal-mv]'))) {
      calMonth += +el.dataset.calMv;
      if (calMonth < 0) { calMonth = 11; calYear--; }
      if (calMonth > 11) { calMonth = 0; calYear++; }
      $('.s-cal-panel').innerHTML = calBody();
      return;
    }
    if ((el = e.target.closest('[data-cal-day]'))) {
      const d = el.dataset.calDay;
      if (!calFrom) {
        /* HALF A RANGE WRITES NOTHING. Filtering on one end would empty the
           surface in answer to a question that is not finished. */
        calFrom = d;
        $('.s-cal-panel').innerHTML = calBody();
      } else {
        const [a, b] = calFrom <= d ? [calFrom, d] : [d, calFrom];
        calFrom = null;
        /* Written to whichever axis the rule resolved to. One key per axis
           means the URL carries the answer, not the question — nobody has to
           re-run the derivation to know what a pasted link filters. */
        go({ [dateAxis()]: `${a}..${b}`, lead: '' });
      }
      return;
    }
    if (e.target.closest('[data-cal-clear]')) { calFrom = null; go({ [dateAxis()]: '' }); return; }
    if (!e.target.closest('.s-cal-wrap')) {
      const p = $('.s-cal-panel');
      if (p && !p.hidden) { p.hidden = true; calFrom = null; }
    }

    /* ── Pagination and columns ──
       `data-gopage`, not `data-page`: the shell's own `<body data-page=
       "workbench">` is an ancestor of everything, so `closest('[data-page]')`
       matched the body on every click that got this far and navigated to
       `?page=workbench`. A delegated handler must never claim an attribute
       the document root already uses. */
    if ((el = e.target.closest('[data-gopage]'))) {
      if (el.disabled) return;
      go({ page: el.dataset.gopage === '1' ? '' : el.dataset.gopage });
      $('#pageScroll').scrollTop = 0;
      return;
    }
    if ((el = e.target.closest('[data-cols]'))) {
      const panel = el.nextElementSibling;
      panel.hidden = !panel.hidden;
      el.setAttribute('aria-expanded', String(!panel.hidden));
      return;
    }
    if (e.target.closest('[data-cols-auto]')) { go({ cols: [] }); return; }
    if ((el = e.target.closest('.s-cols-panel input'))) {
      /* Ticking anything switches the table off automatic, so `?cols=` now
         holds a choice rather than a coincidence. */
      go({ cols: $$('.s-cols-panel input:checked').map((i) => i.value) });
      return;
    }
    if (!e.target.closest('.s-cols-wrap')) {
      const p = $('.s-cols-panel');
      if (p && !p.hidden) { p.hidden = true; const b = $('[data-cols]'); if (b) b.setAttribute('aria-expanded', 'false'); }
    }

    /* ── Row selection ── */
    if ((el = e.target.closest('.s-tick'))) {
      if (el.checked) SEL.add(el.value); else SEL.delete(el.value);
      /* Repaint rather than toggling a class: the scope bar, the rail's
         placement and the row's own tint all read the same Set, and three
         places updating themselves is three places that can disagree. */
      paint();
      return;
    }
    if ((el = e.target.closest('.s-tick-all'))) {
      /* This page, not every page. A header tick that silently selects 118
         records when 50 are on screen is a scope nobody agreed to. */
      const per = PER();
      const all = ordered(filtered());
      const page = Math.min(PAGE(), Math.max(1, Math.ceil(all.length / per)));
      const rows = all.slice((page - 1) * per, page * per);
      if (el.checked) rows.forEach((r) => SEL.add(r.id));
      else rows.forEach((r) => SEL.delete(r.id));
      paint();
      return;
    }

    if ((el = e.target.closest('[data-call]'))) { logTouch(el.dataset.call, 'phone', ''); return; }

    /* ── The commit surface ──
       The backdrop dismisses only when the click lands ON the backdrop.
       `closest()` walks upward, so a `data-commit-cancel` on the backdrop
       matched every click inside the dialog too — including Confirm, which
       therefore closed the surface and wrote nothing. It looked exactly
       like a commit that refuses and will not say why. */
    if (e.target.dataset && 'commitBackdrop' in e.target.dataset) { cancelSurface(); return; }
    if (e.target.closest('[data-commit-cancel]')) { cancelSurface(); return; }
    if (e.target.closest('[data-commit-go]')) {
      const run = commitRun;
      /* RUN FIRST, THEN CLOSE. Closing first wiped `#commitHost`, so every
         commit that reads its own form — the list name, the not-a-fit
         reason, every checkbox — queried a DOM that no longer existed and
         hit its own "nothing was picked" guard. The surface then reported
         that the user had left the form empty, which is a lie about them
         rather than about itself.

         A commit that fails still says so: sitting there with the button
         live reads as "it refuses and will not tell me why". */
      let ok = true;
      let refused = false;
      /* A RUN THAT REFUSES RETURNS FALSE, AND STAYS OPEN.

         The guards that require a reason — the override, not-a-fit, both
         stops, both Knowledge loops — toast and return without writing. The
         surface closed anyway, so refusing threw away the radio you had
         picked and the words you had started typing, and the correct next
         move was to do the whole thing again. A refusal that costs the
         person their work is worse than the write it prevented. */
      try { if (run) refused = (run() === false); }
      catch (err) { ok = false; toast('That did not go through: ' + err.message); }
      /* Only close what we opened. A run that opens a second surface (the
         going-cold branch) must not have it closed underneath it. */
      if (!refused && (commitRun === run || !ok)) {
        closeCommit();
        /* A CONFIRM DOES NOT RETURN. Cancel goes back because you decided
           against; confirm goes forward, and where it goes is the pass-7
           landing rule — on what you made, or staying on what you edited.
           Forgetting the origin here is what keeps a later cancel from
           jumping to a place this journey has left behind. */
        cameFrom = null;
      }
      return;
    }
    if (e.target.closest('[data-undo]')) {
      const fn = undoFn;
      $('#toastHost').innerHTML = '';
      undoFn = null;
      if (fn) fn();
      return;
    }

    /* A name in the record's body is a way into that name's work. `axis:value`
       rather than a bespoke handler per place, because the same move — this
       fact, as a filter — is what every edge in EDGES affords. */
    if ((el = e.target.closest('[data-gofilter]'))) {
      const [axis, val] = el.dataset.gofilter.split(':');
      go({ [axis]: [val], lead: '' });
      /* `chipText` names every axis already, and it is the phrase the chip
         bar is about to show — so the toast and the chip agree by
         construction rather than by two people writing the same sentence. */
      toast(`Filtered — ${chipText(axis, val)}`);
      return;
    }

    /* Knowledge objects open in the conversation, not in another product.
       The canvas is already the retrieval surface — Knowledge is what it
       answers from — so a hop out was a hop out of the work. The correction
       loop still routes home; reading does not have to. */
    if ((el = e.target.closest('[data-kb]'))) {
      kbRead(el.dataset.kb.split(','));
      return;
    }

    /* The channel picker, now inside the commit surface where what it
       chooses is part of the stated effect. `.seg` is a static component in
       the library, so moving the active state is the product's job. */
    if ((el = e.target.closest('.s-ch-pick [data-ch]'))) {
      $$('.s-ch-pick .seg-btn').forEach((b) => b.classList.remove('active'));
      el.classList.add('active');
      const note = $('.s-ch-note');
      if (note) note.textContent = BY.channel[el.dataset.ch].blurb;
      /* And the effects panel, because it is stating what this control
         chose. A consequence that stops matching its control is worse than
         no consequence — you read it once and then it lies. */
      const line = $('[data-effect="chEffect"]');
      const rec = chPickRec ? recBy(chPickRec) : null;
      if (line && rec) line.textContent = chEffect(el.dataset.ch, rec);
      return;
    }

    /* ── The briefing rail. Every item is a filter link. ── */
    if ((el = e.target.closest('[data-brief]'))) {
      const items = $('#brief')._items || [];
      const it = items[+el.dataset.brief];
      if (!it) return;
      /* One stopped task goes straight to the decision rather than to a
         list of one. A rail item that lands you on a filtered surface with
         a single row in it has made you click twice to reach what it
         already named. */
      if (it.task) { closeCanvas(); taskDecide(it.task); return; }
      const cleared = {};
      for (const k of MULTI) cleared[k] = [];
      for (const k of ['q', 'touched', 'due', 'archived', 'lead', 'camp']) cleared[k] = '';
      closeCanvas();
      go(Object.assign(cleared, it.go));
      return;
    }

    /* ── The bell ── */
    if ((el = e.target.closest('#ntfBell'))) {
      const panel = $('#ntfPanel');
      panel.hidden = !panel.hidden;
      el.setAttribute('aria-expanded', String(!panel.hidden));
      $('#asPanel').hidden = true;
      $('#asBtn').setAttribute('aria-expanded', 'false');
      return;
    }
    if ((el = e.target.closest('#asBtn'))) {
      const panel = $('#asPanel');
      panel.hidden = !panel.hidden;
      el.setAttribute('aria-expanded', String(!panel.hidden));
      $('#ntfPanel').hidden = true;
      $('#ntfBell').setAttribute('aria-expanded', 'false');
      return;
    }
    if ((el = e.target.closest('[data-ntf]'))) {
      readNtf.add(el.dataset.ntf);
      $('#ntfPanel').hidden = true;
      $('#ntfBell').setAttribute('aria-expanded', 'false');
      if (el.dataset.ntfOpen) { go({ on: 'tasks', task: el.dataset.ntfOpen, lead: '' }); return; }
      if (el.dataset.ntfTask) { taskDecide(el.dataset.ntfTask); return; }
      const id = el.dataset.ntfRec;
      go({ lead: id, on: DB.conBy[id] ? 'contacts' : 'accounts' });
      return;
    }
    if (e.target.closest('#ntfClear')) {
      /* Read, not gone. What is outstanding stays outstanding until the
         corpus changes; this only clears the count. */
      ntfRows().forEach((r) => readNtf.add(r.id));
      bell();
      return;
    }
    if (e.target.closest('#ntfAskAll')) {
      $('#ntfPanel').hidden = true;
      stagePrompt('What should I do first?');
      return;
    }
    if (!e.target.closest('.ntf-anchor')) {
      [['#ntfPanel', '#ntfBell'], ['#asPanel', '#asBtn']].forEach(([p, b]) => {
        if ($(p) && !$(p).hidden) { $(p).hidden = true; $(b).setAttribute('aria-expanded', 'false'); }
      });
    }

    /* ── The canvas ── */
    if (e.target.closest('#canvasOpen')) { openCanvas(); $('#overlayInput').focus(); return; }
    /* CLOSING THE CANVAS IS A CANCEL, NOT A DISMISSAL. `cancelSurface`
       restores the URL you had when the surface opened — so abandoning a
       half-built campaign puts back the tab and the filters you arrived
       with, rather than silently leaving you on whatever the flow wrote. */
    if (e.target.closest('[data-overlay-close]')) { cancelSurface(); return; }
    if ((el = e.target.closest('.overlay-sugg-chip'))) { runInput(el.textContent); return; }
    /* A suggested question runs itself. Offering one that has to be retyped
       is the same defect as a dead control, with extra steps. */
    if ((el = e.target.closest('[data-ask]'))) { runInput(el.dataset.ask); return; }
    if ((el = e.target.closest('[data-when]'))) { paintWhen(+el.dataset.when); return; }

    /* An answer's records, put on the surface behind the glass. Reversal is
       explicit — the toast's Undo restores the previous filter state
       exactly — rather than the promotion being explicit. */
    if ((el = e.target.closest('[data-cite]'))) {
      const prev = location.search;
      go({ ids: el.dataset.cite.split(','), lead: '' });
      toast(`${plural(el.dataset.cite.split(',').length, 'record')} on the surface.`, () => {
        history.replaceState(null, '', prev || location.pathname);
        parse(); paint(); paintChrome();
      });
      return;
    }

    if ((el = e.target.closest('#floatSend'))) { submitFloat(); return; }
    if ((el = e.target.closest('#overlaySend'))) { submitOverlay(); return; }

    /* ── Work blocks in the canvas ── */
    if ((el = e.target.closest('[data-work-cancel]'))) {
      settleWork(el.dataset.workCancel, 'Cancelled. Nothing was written.');
      workRun = null; addTo = null;
      /* Cancelling a canvas block returns to where it was launched from, the
         same as cancelling a commit. The settled line stays in the thread —
         it is a record that you looked and chose not to — but the surface
         goes back to the place that asked for it. */
      cancelSurface();
      return;
    }
    if ((el = e.target.closest('[data-work-go]'))) {
      const id = el.dataset.workGo;
      const w = workRun;
      if (!w || w.id !== id) return;
      /* Same contract as the commit surface: run first, settle after. A
         block that clears itself before running queries a DOM that is gone. */
      try { w.run(id); }
      catch (err) { settleWork(id, 'That did not go through: ' + err.message); }
      workRun = null;
      /* THE GLASS COMES DOWN WHEN THE WORK CHANGED SOMETHING.

         The canvas sits over the surface. A block that merges campaigns, adds
         contacts or drops a lead has just changed what is behind it — and
         leaving the pane up hides the result of the thing the person came to
         do, so they close it themselves to check, every time.

         Only for writes. A block that only READS — a Knowledge object opened
         to be looked at — leaves the canvas where it is, because there is
         nothing behind it that changed. */
      if (w.writes !== false) closeCanvas();
      cameFrom = null;
      return;
    }
    /* Add-contacts' own controls redraw the block in place: changing the
       source or the search is not a new decision, it is the same one seen
       differently, so it must not stack a second block in the thread. */
    if ((el = e.target.closest('[data-add-src]'))) {
      if (!addTo) return;
      addTo.src = el.dataset.addSrc;
      dropWork();
      paintAddWork();
      return;
    }
    if (e.target.closest('.s-add-tick')) { paintAddCount(); return; }

    /* ── The docked rail ── */
    if (e.target.closest('[data-talk-close]')) {
      /* Undocking clears whatever was holding it open, rather than pinning
         it shut over work that still needs it. */
      endBuild(); clearSel();
      go({ talk: '', lead: '' });
      return;
    }
    if ((el = e.target.closest('[data-turn-pick]'))) {
      const v = el.dataset.turnPick;
      if (v.startsWith('camp:')) {
        const k = v.slice(5);
        spendTurn(v);
        say('you', campName(k));
        go({ campaign: [k], lead: '', camp: '' });
        noteChange(`Scoped to <strong>${esc(campName(k))}</strong>.`, null);
        BUILD_STEP++; askTurn();
      } else {
        answerTurn(v);
      }
      return;
    }
    if ((el = e.target.closest('[data-turn-undo]'))) {
      const t = thread$()[+el.dataset.turnUndo];
      if (t && t.undo) { t.undo(); t.undo = null; paintTalk(); }
      return;
    }
    /* THE PRIMARY FINISHES THE FLOW IT IS THE PRIMARY OF.

       It used to run `endBuild(); go({ view: 'table' })` — end the flow, show
       a table, create nothing. The audience the person had just spent four
       clicks narrowing to was discarded, and so was the one from the other
       button, which called `createCampaign([])` and made an empty campaign.

       `createCampaign` already takes seed ids, already carries them into
       `members`, already requires a name. The flow only ever had to hand it
       the set it had produced. The name typed on the card is carried across
       so it is not asked for twice. */
    /* `data-run-search` and `data-save-preset` lived here. The first handed
       one form to another and settled before either had run; the second was
       the only one of the pair that ended anything. Both are gone: the flow
       now opens its commit directly, and the commit carries all three exits.

       "JUST SHOW ME THE LIST" is what "Not now" was, said in words. It makes
       nothing and leaves the filters standing, which is a real thing to want
       after describing an audience — but "Not now" named neither half of it. */
    if ((el = e.target.closest('[data-work-alt]'))) {
      const id = el.dataset.workAlt;
      endBuild();
      settleWork(id, 'Left as filters. No campaign was created.');
      workRun = null;
      closeCanvas();
      go({ on: 'accounts', lead: '', camp: '' });
      toast('Nothing was created. The filters are still on the surface.');
      return;
    }
    if (e.target.closest('[data-build]')) { startBuild(); return; }

    /* ── Prototype control ── */
    if ((el = e.target.closest('#protoToggle'))) {
      const p = $('#protoPanel');
      p.hidden = !p.hidden;
      el.setAttribute('aria-expanded', String(!p.hidden));
      return;
    }
    if ((el = e.target.closest('[data-proto-in]'))) {
      $('#protoPanel').hidden = true;
      $('#protoToggle').setAttribute('aria-expanded', 'false');
      const input = $('#floatInput');
      input.value = el.dataset.protoIn;
      input.focus();
      return;
    }
    if ((el = e.target.closest('[data-empty]'))) {
      $('#protoPanel').hidden = true;
      $('#protoToggle').setAttribute('aria-expanded', 'false');
      forceEmpty(el.dataset.empty);
      proto();
      return;
    }

    /* THE WHOLE CARD, AND THE WHOLE ROW, OPEN THE RECORD.
       Genuinely last in the chain — not "near the end". A card contains the
       ICP chip, and a row contains the tick, the name and the action, and
       every one of them is written further down this function than a reader
       expects. The rule is positional, so the only safe position is the end:
       anything with its own meaning has already claimed the click and
       returned. This was a real defect — the ICP chip sat below the row
       handler and opened the record instead of routing to Knowledge. */
    if ((el = e.target.closest('[data-row]'))) {
      const id = el.dataset.row;
      /* ONE HANDLER, FIVE RECORD TYPES — IT KNEW TWO.

         Every card is `<article data-row>` so the whole card is the target,
         and this branched on task-versus-everything-else. Everything else
         meant `go({ lead: id })`. Campaign cards and person cards were added
         in later passes and never reached it, so clicking a campaign card
         anywhere but its title ran `?lead=c107` — a campaign key handed to
         the lead router — and answered "That record is not here" about a
         campaign that had just been created. Two of five types, silently.

         Routed by what the id IS, and an id that matches nothing opens
         nothing rather than accusing the workspace of not holding it. */
      if (DB.taskBy[id]) { go({ task: id }); return; }
      if (DB.campBy[id]) { leaveBuild(); go({ camp: id, lead: '', in: '' }); return; }
      /* A person is not a page — clicking one means "show me their work",
         which is the same place their card title goes. */
      if (REPS.some((pp) => pp.id === id)) { go({ owner: [id], on: 'accounts', lead: '', camp: '' }); return; }
      if (DB.accBy[id] || DB.conBy[id]) {
        leaveBuild();
        go({ lead: id, on: DB.conBy[id] ? 'contacts' : 'accounts' });
      }
      return;
    }
  });

  /* The float bar and the canvas input run the SAME router, so typing a
     filter phrase into the canvas narrows the surface behind the glass
     rather than being read as a question about nothing. */
  function submitFloat() {
    const input = $('#floatInput');
    const v = input.value.trim();
    if (!v) return;
    input.value = '';
    runInput(v);
  }
  function submitOverlay() {
    const box = $('#overlayInput');
    const v = box.value.trim();
    if (!v) return;
    box.value = '';
    box.closest('.overlay-input-bar').classList.remove('is-staged');
    runInput(v);
  }

  /* A gap is the absence of a record, so there is nothing to filter to. It
     stages a prompt instead — AiMY-composed and waiting on you, which the
     bar says rather than looking like text you typed and abandoned. */
  function stagePrompt(text) {
    openCanvas();
    const box = $('#overlayInput');
    box.value = text;
    box.closest('.overlay-input-bar').classList.add('is-staged');
    box.focus();
  }

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.shiftKey) return;
    if (e.target.id === 'floatInput') { e.preventDefault(); submitFloat(); }
  });
  /* aimy-ds.js turns Enter inside [data-submit-on-enter] into this event, so
     the library owns the keystroke and the product owns what it means. */
  document.addEventListener('aimy:submit', (e) => {
    if (e.target.id === 'overlayInput') submitOverlay();
  });

  /* Escape closes whatever is on top. A surface you cannot dismiss from the
     keyboard is a trap, and this fires on the commonest actions here.

     THE CANVAS WAS MISSING FROM THIS LIST. It has never been Escape-closable
     — the chain went commit, then record, and stepped straight over the one
     surface in between. That was survivable while the canvas held a single
     confirm block; it is not now that it hosts a three-turn build, which is
     the longest thing in the product to be stuck inside.

     `cancelSurface`, not `closeCanvas`, so Escape means exactly what the X
     means: put back the filters and the tab you arrived with. Two ways out
     that leave you in different places is one of them being wrong. */
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if ($('#commitHost').innerHTML) { closeCommit(); return; }
    if (surfacesOpen().includes('canvas')) { cancelSurface(); return; }
    if (S.lead) go({ lead: '' });
  });

  /* ═══════════════════════════════════════════════
     THE WRITE ROUTE

     Logging a touchpoint IS the product, so it carries far more traffic
     here than any write in Knowledge did. Every one of these ends in the
     same commit surface, and every one of them is reversible from the
     toast — because the commonest write on this surface is also the one a
     rep is most likely to fire twice.
  ═══════════════════════════════════════════════ */

  const recBy = (id) => DB.accBy[id] || DB.conBy[id];

  /* "A in person touchpoint" is the tell that the article was hardcoded. */
  const article = (w) => (/^[aeiou]/i.test(w) ? 'An' : 'A');
  const chEffect = (ch, rec) => {
    const l = BY.channel[ch].label.toLowerCase();
    return `${article(l)} ${l} touchpoint on ${rec.name}, dated today, by you.`;
  };

  /* What the rep typed, read for the three things a touchpoint needs beyond
     its channel: how it went, and what happens next, and when. This is the
     same parse the float bar runs — one lexicon, not two. */
  function readTouch(text) {
    const t = text.toLowerCase();
    let outcome = 'neutral';
    if (/\b(booked|scheduled|agreed to meet|set up a (call|demo|meeting))\b/.test(t)) outcome = 'meeting-booked';
    else if (/\b(positive|good|keen|interested|went well|promising)\b/.test(t)) outcome = 'positive';
    else if (/\b(negative|not interested|no budget|pushed back|declined)\b/.test(t)) outcome = 'negative';
    else if (/\b(no answer|voicemail|did not (answer|show)|no-show)\b/.test(t)) outcome = 'no-answer';

    let next = null;
    const m = t.match(/next step(?: is)?[: ]+([^.,;]+)/) || t.match(/\b(?:then|follow up with|send)\b[: ]+([^.,;]+)/);
    if (m) {
      const what = m[1].trim();
      const when = readWhen(what);
      next = {
        what: what
          .replace(/\b(on|next|this)?\s*(monday|tuesday|wednesday|thursday|friday|week|month)\b/g, '')
          /* Drop the leading article. "Next step: a demo" is how somebody
             writes it and "A demo" is not how a next step is named. */
          .replace(/^\s*(a|an|the)\s+/, '')
          .trim()
          .replace(/^./, (c) => c.toUpperCase()) || 'Follow up',
        due: iso(shift(TODAY, when)),
        by: me().id,
      };
    }
    return { outcome, next };
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

  function logTouch(id, ch, text) {
    const rec = recBy(id);
    if (!rec) return;
    const acc = accOf(rec);
    const read = readTouch(text);
    const chRow = BY.channel[ch];
    const before = statusOf(rec);

    /* The channel line is written by the same function the picker calls, so
       correcting the picker corrects the sentence. A stated effect that does
       not track the control above it is the merge-preview defect again. */
    const effects = [
      ['ok', chEffect(ch, rec), 'chEffect'],
      ['ok', `Outcome recorded as ${label('outcome', read.outcome).toLowerCase()}.`],
    ];
    if (read.next) effects.push(['ok', `Next step “${read.next.what}”, due ${fmtDate(read.next.due)}.`]);
    else if (rec.next) effects.push(['skip', `“${rec.next.what}” stays where it is — nothing in what you wrote moves it.`]);
    else effects.push(['warn', `No next step. This record will start going cold in ${COLD_DAYS} days.`]);
    /* Attribution is a decision, so it is stated rather than assumed. A
       touchpoint silently credited to a campaign moves that campaign's
       numbers, and nobody asked it to. */
    const camp = (campsOf(rec))[0] || null;
    if (camp) effects.push(['warn', `Credited to ${campName(camp)}, because that is the campaign this lead is in.`]);

    chPickRec = rec.id;
    commit({
      title: `Log a touchpoint on ${rec.name}`,
      /* The channel lives HERE, not on a control beside the input. AiMY
         reads it out of the words — "called", "met", "visited" — and this is
         where it says what it read and lets you correct it, which is the
         same shape every other interpretation on this surface takes. It also
         means the one input stays one input. */
      body: `<p class="s-commit-quote">${esc(text || `${chRow.verb} ${rec.name}.`)}</p>
        <div class="s-field">
          <span class="s-field-label">How it happened</span>
          <div class="seg s-ch-pick" role="group" aria-label="Channel">
            ${TAX.channel.filter((c) => !c.auto).map((c) => `<button class="seg-btn${c.k === ch ? ' active' : ''}" type="button" data-ch="${esc(c.k)}">${esc(c.label)}</button>`).join('')}
          </div>
          <p class="s-ch-note">${esc(chRow.blurb)}</p>
        </div>`,
      effects,
      confirm: 'Log it',
      run() {
        /* Read the picker rather than the argument: you may have corrected
           what AiMY read out of the sentence. */
        const picked = ($('.s-ch-pick .seg-btn.active') || {}).dataset;
        const chosen = (picked && picked.ch) || ch;
        const t = {
          id: 't' + (DB.touch.length + 1000), on: rec.id, acc: acc.id,
          ch: chosen, dir: 'out', at: iso(TODAY), by: me().id,
          outcome: read.outcome, note: text || `${chRow.verb} ${rec.name}.`,
          camp, steps: null,
        };
        DB.touch.push(t);
        const prevNext = rec.next;
        if (read.next) rec.next = read.next;
        reindex();
        paint();
        markChanged('.s-timeline .tl-item:last-child, .s-rec-status');
        const after = statusOf(rec);
        /* "Awaiting them → Awaiting them" is not a transition. Only say it
           moved when it moved. */
        toast(after === before ? 'Logged.' : `Logged. ${label('status', before)} → ${label('status', after)}.`, () => {
          DB.touch = DB.touch.filter((x) => x.id !== t.id);
          rec.next = prevNext;
          reindex();
          paint();
        });
      },
    });
  }

  function runExit(id) {
    const rec = recBy(id);
    if (!rec) return;
    const st = statusOf(rec);

    if (BY.status[st] && BY.status[st].opens === 'record') {
      /* Reachable from the briefing and the bell, which route by record
         rather than by status. No prefill: guessing "Logged a call with…"
         made anyone who had met in person delete the guess first, which is
         worse than an empty box. The placeholder already says what this
         input will do with a record open. */
      if (S.lead !== id) go({ lead: id, on: DB.conBy[id] ? 'contacts' : 'accounts' });
      const box = $('#floatInput');
      if (box) box.focus();
      return;
    }
    if (st === 'stalled') { reschedule(id); return; }
    if (st === 'going-cold') { reEngageOrDrop(rec); return; }
    if (st === 'not-a-fit') { sayWhy(rec); return; }
  }

  /* "MOVE IT" SAID NOTHING ABOUT WHERE.

     It read as a nudge with no destination, silently meant "+7 days", and
     offered no way to pick anything else — so the one question a person has
     when a date slips (to when?) was the one thing the surface would not
     let them answer. It is now Reschedule, it names the new date on its
     face, and the date is a control.

     Its second effect also claimed a transition that was not one. On a
     record already awaiting them it printed "Awaiting them → Awaiting them,
     because nothing is overdue any more" — a stated effect that states a
     change to nothing, which is exactly the kind of line that teaches people
     to stop reading them. */
  function reschedule(id) {
    const rec = recBy(id);
    if (!rec || !rec.next) return;
    const over = daysAgo(rec.next.due);
    const to = iso(shift(TODAY, 7));
    const wouldBe = computedStatus(Object.assign({}, rec, { next: { what: rec.next.what, due: to } }));
    const now = statusOf(rec);
    commit({
      title: `Reschedule “${rec.next.what}”`,
      body: `<p class="s-commit-quote">It was due ${esc(fmtDate(rec.next.due))}${over > 0 ? `, ${esc(plural(over, 'day'))} ago` : ''}.</p>
        <div class="s-field">
          <span class="s-field-label">Move it to</span>
          <div class="s-when">
            <div class="s-when-quick">
              ${[['Tomorrow', 1], ['In a week', 7], ['In two weeks', 14], ['In a month', 30]]
                .map(([lab, d], i) => `<button class="btn btn-ghost btn-sm s-when-btn${i === 1 ? ' is-on' : ''}" type="button" data-when="${d}">${lab}</button>`).join('')}
            </div>
            <input class="field-input s-when-date" type="date" value="${esc(to)}" min="${esc(iso(TODAY))}" aria-label="A date of your own" />
          </div>
        </div>`,
      effects: [
        ['ok', `Due ${fmtDate(to)} instead.`, 'whenDue'],
        /* Only claimed when it is true. */
        now === wouldBe
          ? ['skip', `It stays ${label('status', now).toLowerCase()} — the date moves, the state does not.`, 'whenSt']
          : ['ok', `${label('status', now)} → ${label('status', wouldBe)}, because nothing is overdue any more.`, 'whenSt'],
        ['skip', 'No touchpoint is written. Moving a date is not contact.'],
      ],
      confirm: 'Reschedule it',
      run() {
        const picked = (($('.s-when-date') || {}).value || to);
        const prev = rec.next.due;
        rec.next.due = picked;
        paint();
        markChanged('.s-next, .s-rec-status');
        toast(`Moved to ${fmtDate(picked)}.`, () => { rec.next.due = prev; paint(); });
      },
    });
  }

  /* The quick buttons and the date field are one control with two faces, so
     each keeps the other honest — and the stated effect tracks both, because
     an effect that does not follow the control above it is the defect the
     merge preview was rebuilt to remove. */
  function paintWhen(days) {
    const inp = $('.s-when-date');
    if (!inp) return;
    if (days != null) inp.value = iso(shift(TODAY, +days));
    $$('.s-when-btn').forEach((b) => b.classList.toggle('is-on', days != null && +b.dataset.when === +days));
    const rec = recBy(S.lead) || null;
    const line = $('[data-effect="whenDue"]');
    if (line) line.textContent = `Due ${fmtDate(inp.value)} instead.`;
    const stLine = $('[data-effect="whenSt"]');
    if (stLine && rec && rec.next) {
      const now = statusOf(rec);
      const would = computedStatus(Object.assign({}, rec, { next: { what: rec.next.what, due: inp.value } }));
      stLine.textContent = now === would
        ? `It stays ${label('status', now).toLowerCase()} — the date moves, the state does not.`
        : `${label('status', now)} → ${label('status', would)}, because nothing is overdue any more.`;
      stLine.className = `s-effect is-${now === would ? 'skip' : 'ok'}`;
      stLine.dataset.effect = 'whenSt';
    }
  }

  /* A genuine choice between two consequences, so it is a decision zone and
     not a button: Accept · Edit · Reject with Edit not optional (§3). */
  /* ── Re-engage or drop ──
     Two different consequences, so it is a decision zone rather than a
     button — and it runs in the canvas because the judgement needs the
     record's history in view, which a modal was covering. */
  function reEngageOrDrop(rec) {
    const ts = touchesFor(rec);
    const last = ts[0];
    canvasWork({
      title: `${rec.name} is going cold`,
      lede: `Nothing since ${last ? fmtAgo(last.at) : 'ever'}, and nothing scheduled.`,
      body: `
        ${ts.length ? `<div class="s-work-evidence">
          <div class="s-work-ev-h">What has happened</div>
          <div class="timeline s-timeline">${ts.slice(0, 4).reverse().map(touchItem).join('')}</div>
        </div>` : ''}
        <div class="decision-zone">
          <div class="dz-prompt">Is this worth another go?</div>
          <div class="dz-consequence">Re-engaging schedules a follow-up for next week and leaves it live. Dropping records it as not a fit, which takes it out of every campaign and teaches the ICP.</div>
          <div class="dz-actions">
            <label class="ds-choice"><input type="radio" name="cold" value="keep" data-say="Re-engage them" checked /><span>Re-engage — follow up next week</span></label>
            <label class="ds-choice"><input type="radio" name="cold" value="drop" data-say="Drop them" /><span>Drop it — record why</span></label>
          </div>
        </div>`,
      effects: [
        ['ok', 'Re-engaging writes a next step for next week and nothing else.'],
        ['warn', 'Dropping asks for a reason and will not proceed without one.'],
        ['skip', 'Either way, no touchpoint is written. Deciding is not contact.'],
      ],
      /* THE CONFIRM SAYS WHICH OF THE TWO. "Do it" under a decision zone
         asks you to hold the choice in your head and trust the button to
         have the same one — which is the whole thing a decision zone exists
         to avoid. It follows the radio instead. */
      confirm: 'Re-engage them',
      run(id) {
        const pick = ($('input[name="cold"]:checked') || {}).value;
        if (pick === 'drop') { settleWork(id, 'Dropping it — say why.'); sayWhy(rec); return; }
        const prev = rec.next;
        rec.next = { what: 'Re-engage', due: iso(shift(TODAY, 7)), by: me().id };
        paint(); paintChrome();
        markChanged('.s-next, .s-rec-status');
        settleWork(id, 'Follow-up set for next week.');
        toast('Follow-up set for next week.', () => { rec.next = prev; paint(); paintChrome(); });
      },
    });
  }

  /* Disqualifying without a reason is the defect, not the disqualification:
     the ICP never learns anything and the next scrape brings the lead back.
     Gated until there is something to send. */
  function sayWhy(rec) {
    const acc = accOf(rec);
    commit({
      title: `Why is ${rec.name} not a fit?`,
      body: `<textarea class="ds-textarea s-why" rows="3" spellcheck="false"
        placeholder="Under the ICP floor · already contracted · public tender only…"
        aria-label="Why this lead is not a fit"></textarea>`,
      effects: [
        ['ok', `${rec.name} is recorded as not a fit, and drops out of every view that is not asking for one.`],
        ['ok', acc.icp ? `The reason goes to ${KB_BY[acc.icp].title} in Knowledge, which is what stops the next scrape bringing it back.` : 'The reason is kept on the record. No ICP matched, so there is nothing in Knowledge to teach.'],
        ['skip', 'Nothing is removed. An archived lead is still searchable.'],
      ],
      needs: '.s-why', needsSay: 'Say why before recording it.',
      confirm: 'Record it',
      run() {
        const why = ($('.s-why') || {}).value;
        const text = (why || '').trim();
        if (!text) { toast('Nothing was recorded — a reason with no reason in it is the defect.'); return false; }
        const prev = { outcome: rec.outcome, why: rec.outcomeWhy };
        rec.outcome = 'not-a-fit';
        rec.outcomeWhy = text;
        paint();
        markChanged('.s-rec-status, .s-card');
        toast('Recorded as not a fit.', () => {
          rec.outcome = prev.outcome; rec.outcomeWhy = prev.why; paint();
        });
      },
    });
  }

  function shareRec(id) {
    const rec = recBy(id);
    if (!rec) return;
    const others = REPS.filter((p) => p.id !== rec.owner && !(rec.shared || []).includes(p.id));
    commit({
      title: `Share ${rec.name}`,
      body: `<div class="s-pick">${others.map((p) => `<label class="ds-choice s-pick-row">
        <input type="checkbox" value="${esc(p.id)}" />
        <span>${esc(p.name)} <span class="s-pick-role">${esc(p.role)}</span></span>
      </label>`).join('')}</div>`,
      effects: [
        ['ok', 'They see the record, its touchpoints and its campaigns, and it appears under Mine for them.'],
        ['warn', 'Sharing does not move ownership. The next step stays with ' + actor(rec.owner).name + '.'],
      ],
      confirm: 'Share it',
      run() {
        const ids = $$('.s-pick input:checked').map((i) => i.value);
        if (!ids.length) { toast('Nobody was picked, so nothing was shared.'); return false; }
        const prev = (rec.shared || []).slice();
        rec.shared = prev.concat(ids);
        paint();
        markChanged('.s-share');
        toast(`Shared with ${ids.map((i) => actor(i).name).join(' and ')}.`, () => { rec.shared = prev; paint(); });
      },
    });
  }

  /* ═══════════════════════════════════════════════
     LIST OPERATIONS

     V1 has four: create, add contacts, merge, assign. All four go through
     the same commit surface every other write here uses — none of them
     needs a confirmation pattern of its own, and inventing one per dialog
     is how V1 ended up with a merge that states its conflict rule as a
     sentence and offers no way to see or change it.

     Membership is written on the LIST and `reindex()` derives the record's
     side, so every one of these is an array operation on one object.
  ═══════════════════════════════════════════════ */

  /* Which account ids a set of records resolves to. Lists are assembled at
     account level — you target a company, then find the people in it — so a
     contact contributes its account. */
  const toAccountIds = (recs) => [...new Set(recs.map((r) => accOf(r).id))];

  function addRecToCampaign(id) {
    const rec = recBy(id);
    if (!rec) return;
    const mine = campsOf(rec);
    const open = DB.camp.filter((c) => campState(c) !== 'finished' && !mine.includes(c.k));
    if (!open.length) { toast(`${rec.name} is already in every open campaign.`); return false; }

    commit({
      title: `Add ${rec.name} to a campaign`,
      body: `<div class="s-pick">${open.map((l) => `<label class="ds-choice s-pick-row">
        <input type="radio" name="list" value="${esc(l.k)}" />
        <span>${esc(l.name)} <span class="s-pick-role">${esc(l.plan ? l.plan.map((p) => label('channel', p)).join(' · ') : 'draft — nothing sends yet')}</span></span>
      </label>`).join('')}</div>`,
      effects: [
        ['ok', `${accOf(rec).name} joins it. Every contact there joins with it.`],
        ['warn', 'A running campaign with an AiMY step will send. Those touchpoints are logged as AiMY’s, never as yours.'],
      ],
      confirm: 'Add it',
      run() {
        const p = $('.s-pick input:checked');
        if (!p) { toast('No campaign was picked, so nothing changed.'); return false; }
        const l = DB.campBy[p.value];
        const accId = accOf(rec).id;
        l.members.push(accId);
        reindex(); paint();
        markChanged('.s-camps');
        go({ on: 'campaigns', camp: l.k, lead: '' });
        toast(`Added to ${l.name}.`, () => {
          l.members = l.members.filter((m) => m !== accId);
          reindex(); paint();
        });
      },
    });
  }

  /* ── Create ──
     V1's dialog: name, description, owner, assignees, and a banner reading
     "Creating from 25 selected contacts". Ours states the same, and adds the
     thing V1 leaves implicit: assignment is not ownership. */
  /* ── Create ──
     V1's dialog: name, description, owner, assignees, and a banner reading
     "Creating from 25 selected contacts". In the canvas because the audience
     it is built from belongs beside the form, not behind it. */
  /* `named` carries a name already typed elsewhere — the guided flow asks
     for one on its own card, and asking for the same thing twice in one
     journey is the friction this pass exists to remove. */
  function createCampaign(seedIds, named, opts) {
    const seeds = (seedIds || []).map(recBy).filter(Boolean);
    const accIds = toAccountIds(seeds);
    /* Set when the guided flow opens this rather than a selection. It brings
       the criteria read-out with it, and it earns the third exit — "leave it
       as filters" only means something when filters are what got you here. */
    const built = !!(opts && opts.criteria);

    canvasWork({
      title: built ? 'Name it and it is a campaign' : 'Create a campaign',
      /* The name is REQUIRED, so the confirm is disabled until it carries
         something. It used to be checked inside `run` and answered with a
         toast, which is a button that refuses. */
      needs: '.s-new-name',
      alt: built ? 'Just show me the list' : null,
      lede: accIds.length
        ? `From ${plural(accIds.length, 'account')} you picked. It starts as a draft — nothing sends until you start it.`
        : 'It starts empty and as a draft. Add accounts from the table or from a lead.',
      body: `
        ${built && opts.criteria.length ? `<div class="s-field">
          <span class="s-field-label">What you asked for</span>
          <dl class="s-crit-rows">${opts.criteria.map(([l, v]) => `<dt>${esc(l)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>
        </div>` : ''}
        <label class="ds-field s-field">
          <span class="s-field-label">Name</span>
          <input class="field-input s-new-name" type="text" placeholder="Q4 Netherlands — Voice" value="${esc(named || '')}" />
        </label>
        <label class="ds-field s-field">
          <span class="s-field-label">What it is for</span>
          <textarea class="ds-textarea s-new-desc" rows="2" placeholder="Who is in it and why, in a sentence."></textarea>
        </label>
        ${/* TWELVE STACKED ROWS FOR A DECISION THAT IS USUALLY "ME".

              Six people as radios and then the same six as checkboxes filled
              most of a canvas block, and both answers are nearly always the
              default: you own it, and nobody else is on it yet. The form was
              charging full price for the common case.

              Ownership collapses to one line with a reveal — `<details>`,
              because a control that is closed by default and opens in place
              is exactly what the native element is. Assignment becomes
              wrapping avatar toggles, reusing the vocabulary the campaign
              sheet already shows assignees in, so the form and the sheet
              describe the same fact the same way. */ ''}
        <div class="s-field">
          <span class="s-field-label">Who owns it</span>
          <details class="s-owner">
            <summary class="s-owner-sum">
              <span class="s-assignee is-owner"><span class="avatar avatar-sm">${esc(me().initials)}</span>${esc(me().name)} <span class="s-pick-role">you</span></span>
              <span class="s-owner-swap">someone else</span>
            </summary>
            <div class="s-pick">${SELLERS.map((pp) => `<label class="ds-choice s-pick-row">
              <input type="radio" name="owner" class="s-new-owner" value="${esc(pp.id)}"${pp.id === me().id ? ' checked' : ''} />
              <span>${esc(pp.name)}${pp.id === me().id ? ' (you)' : ''} <span class="s-pick-role">${esc(pp.role)}</span></span>
            </label>`).join('')}</div>
          </details>
        </div>
        <div class="s-field">
          <span class="s-field-label">Assign it to <span class="s-field-note">optional</span></span>
          <div class="s-assign-grid">${SELLERS.filter((pp) => pp.id !== me().id).map((pp) => `<label class="s-assign-chip">
            <input type="checkbox" class="s-new-assign" value="${esc(pp.id)}" />
            <span class="avatar avatar-sm">${esc(pp.initials)}</span>
            <span class="s-assign-name">${esc(pp.name)}<span class="s-pick-role">${esc(pp.role)}</span></span>
          </label>`).join('')}</div>
        </div>${accIds.length ? `
        <div class="s-field">
          <span class="s-field-label">Its ${esc(plural(accIds.length, 'account'))}</span>
          <div class="s-seed-list">${accIds.slice(0, 12).map((a) => `<span class="chip default">${esc(DB.accBy[a].name)}</span>`).join('')}${accIds.length > 12 ? `<span class="s-none">and ${accIds.length - 12} more</span>` : ''}</div>
        </div>` : ''}`,
      effects: [
        ['ok', accIds.length ? `${plural(accIds.length, 'account')} join it, with every contact at them.` : 'It starts empty.'],
        ['warn', 'Assigning is not ownership. Assignees can work it; the owner still answers for it.'],
        ['skip', 'It starts as a draft. Nothing sends until you start it.'],
      ],
      confirm: 'Create it',
      run(id) {
        const name = (($('.s-new-name') || {}).value || '').trim();
        if (!name) { toast('A campaign with no name is one nobody can find. Nothing was created.'); return false; }
        const owner = ($('.s-new-owner:checked') || {}).value || me().id;
        const c = {
          k: 'c' + (DB.camp.length + 100),
          name,
          description: (($('.s-new-desc') || {}).value || '').trim() || 'No description yet.',
          owner,
          assignees: $$('.s-new-assign:checked').map((i) => i.value).filter((a) => a !== owner),
          members: accIds.slice(),
          crit: Object.assign({}, S),
          /* The history's first step needs a date, and a campaign created in
             this session has to carry the same field the fixtures do or its
             rail opens on nothing. */
          made: iso(TODAY),
          plan: null, from: null, to: null, svc: null, kb: null,
        };
        DB.camp.push(c);
        const hadSel = selectedIds();
        clearSel();
        reindex();
        /* LAND ON WHAT YOU MADE. The result is the confirmation — a toast
           has to be believed, a campaign you are looking at does not. Only
           for writes that MAKE something; a write that edits a record in
           place leaves you where you are, because the change is already on
           screen and moving you would cost you your place for nothing. */
        go({ on: 'campaigns', camp: c.k, lead: '', status: [], industry: [], size: [] });
        settleWork(id, `${c.name} created with ${plural(c.members.length, 'account')}.`);
        toast(`${c.name} created.`, () => {
          DB.camp = DB.camp.filter((x) => x.k !== c.k);
          hadSel.forEach((s) => SEL.add(s));
          reindex(); paint(); paintChrome();
        });
      },
    });
  }

  /* ── Add contacts ──
     V1 renders four source tabs and a red banner reading "5 contacts already
     exist in the target campaign", then hides nothing and disables the
     duplicates. That last part is right and is kept: a contact you cannot
     FIND is worse than one you cannot select, because you go looking for it. */
  /* ── Add contacts ──
     V1's dialog, in the canvas where it fits. Four source tabs, a search, a
     badge per row, and a live count in the confirm — and the part V1 gets
     right, which is that existing members are SHOWN AND DISABLED rather
     than hidden. A contact you cannot find is worse than one you cannot
     select, because you go looking for it. */
  let addTo = null;

  function addToCampaign(key) {
    const c = DB.campBy[key];
    if (!c) return;
    addTo = { k: key, src: '', q: '' };
    paintAddWork();
  }

  function addCandidates() {
    const c = DB.campBy[addTo.k];
    let pool = (S.on === 'contacts' ? DB.con : DB.acc).filter((r) => !r.arch);
    if (addTo.src) pool = pool.filter((r) => accOf(r).src === addTo.src);
    if (addTo.q) {
      const q = addTo.q.toLowerCase();
      pool = pool.filter((r) => [r.name, accOf(r).name, r.role].filter(Boolean).join(' ').toLowerCase().includes(q));
    }
    return { c, pool: pool.slice(0, 60) };
  }

  /* NEW · PROSPECT · EXISTING. V1 shows these and they are the only three
     things you need to know before ticking a row: never contacted, being
     worked, or already here. */
  function addBadge(r, c) {
    if (c.members.includes(accOf(r).id)) return ['is-already', 'Already in it'];
    return statusOf(r) === 'untouched' ? ['is-new', 'New'] : ['is-prospect', 'Prospect'];
  }

  function paintAddWork() {
    const { c, pool } = addCandidates();
    const already = pool.filter((r) => c.members.includes(accOf(r).id));
    const fresh = pool.filter((r) => !c.members.includes(accOf(r).id));

    canvasWork({
      title: `Add to ${c.name}`,
      lede: `${campState(c) === 'running' ? 'It is running, so anything you add starts receiving the plan.' : 'It is a draft, so nothing will send until you start it.'}`,
      body: `
        <div class="s-add-tools">
          <div class="seg s-add-src" role="group" aria-label="Where they came from">
            <button class="seg-btn${addTo.src === '' ? ' active' : ''}" type="button" data-add-src="">All sources</button>
            ${TAX.src.map((s) => `<button class="seg-btn${addTo.src === s.k ? ' active' : ''}" type="button" data-add-src="${esc(s.k)}">${esc(s.label)}</button>`).join('')}
          </div>
          <div class="search-field s-add-search">
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>
            <input type="text" class="s-add-q" value="${esc(addTo.q)}" placeholder="Search by name, company or title…" aria-label="Search candidates" />
          </div>
        </div>
        ${already.length ? `<div class="banner warn s-commit-banner">
          <div class="banner-body"><strong>${esc(plural(already.length, 'record'))}</strong> ${already.length === 1 ? 'is' : 'are'} already in this campaign. ${already.length === 1 ? 'It is' : 'They are'} shown and cannot be picked.</div>
        </div>` : ''}
        <div class="s-pick s-pick-scroll">
          ${pool.length ? pool.map((r) => {
            const [cls, badge] = addBadge(r, c);
            const off = cls === 'is-already';
            return `<label class="ds-choice s-pick-row${off ? ' is-already' : ''}">
              <input type="checkbox" value="${esc(r.id)}" ${off ? 'disabled' : 'checked'} class="s-add-tick" />
              <span class="s-add-main">
                <span class="s-add-name">${esc(r.name)}</span>
                <span class="s-pick-role">${esc(r.kind === 'con' ? r.role + ' · ' + accOf(r).name : label('industry', accOf(r).industry) + ' · ' + (fmtSize(accOf(r).emp) || 'size not known'))}</span>
              </span>
              <span class="s-add-badge ${cls}">${esc(badge)}</span>
            </label>`;
          }).join('') : '<p class="s-none">Nothing matches that.</p>'}
        </div>`,
      effects: [
        ['ok', `Adds the ticked records as accounts. Every contact at them joins too.`, 'addCount'],
        already.length ? ['skip', `Skips ${plural(already.length, 'record')} already in it. Adding twice is not adding.`] : null,
        campState(c) === 'running' ? ['warn', `${c.name} is running — anything added starts receiving the plan, including AiMY's step.`] : null,
      ],
      confirm: `Add selected (${fresh.length})`,
      run(id) {
        const ids = $$('.s-add-tick:checked').map((i) => i.value);
        if (!ids.length) { toast('Nothing was ticked, so nothing was added.'); return false; }
        const accIds = toAccountIds(ids.map(recBy).filter(Boolean)).filter((a) => !c.members.includes(a));
        c.members = c.members.concat(accIds);
        addTo = null;
        reindex(); paint(); paintChrome();
        settleWork(id, `${plural(accIds.length, 'account')} added.`);
        toast(`${plural(accIds.length, 'account')} added to ${c.name}.`, () => {
          c.members = c.members.filter((m) => !accIds.includes(m));
          reindex(); paint(); paintChrome();
        });
      },
    });
  }

  /* ── Merge ──
     V1 says "AiMY will automatically prioritize the most recent contact data
     during merge" and gives you no way to see that or change it. The rule is
     named here, the count it applies to is shown, and the other choice is
     offered — which is what makes it a decision rather than an announcement. */
  /* ── Merge ──
     V1 says "AiMY will automatically prioritize the most recent contact data
     during merge" and gives you no way to see that or change it, above a
     fixed "TOTAL CONTACTS 4,821 +1,200 · DUPLICATE COUNT 142" that cannot
     correspond to a selection you have not made yet. Here the rule is a
     choice and the preview counts what is actually ticked. */
  function mergeCampaigns(key) {
    const target = DB.campBy[key];
    if (!target) return;
    const others = DB.camp.filter((c) => c.k !== target.k && campState(c) !== 'finished');
    if (!others.length) { toast('There is no other campaign to merge into it.'); return false; }

    canvasWork({
      title: `Merge into ${target.name}`,
      lede: 'Everybody in the campaigns you pick joins this one. The sources are kept, so this is reversible.',
      body: `
        <div class="s-pick">${others.map((c) => `<label class="ds-choice s-pick-row">
          <input type="checkbox" class="s-merge-tick" value="${esc(c.k)}" />
          <span class="s-add-main">
            <span class="s-add-name">${esc(c.name)}</span>
            <span class="s-pick-role">${esc(plural(c.members.length, 'account'))} · ${esc(CAMP_STATE[campState(c)].label.toLowerCase())}</span>
          </span>
        </label>`).join('')}</div>
        <div class="s-merge-sum" id="mergeSum" data-merge-target="${esc(target.k)}"></div>
        <div class="decision-zone s-merge-rule">
          <div class="dz-prompt">When both campaigns hold the same account, which record wins?</div>
          <div class="dz-consequence">It is the same account either way — what differs is whose next step and owner survive it.</div>
          <div class="dz-actions">
            <label class="ds-choice"><input type="radio" name="rule" value="recent" checked /><span>Whichever was touched most recently</span></label>
            <label class="ds-choice"><input type="radio" name="rule" value="target" /><span>Always ${esc(target.name)}</span></label>
          </div>
        </div>`,
      effects: [
        ['ok', `${target.name} grows by however many accounts are not already in it.`],
        ['skip', 'Duplicates are counted, not added twice. The count above updates as you pick.'],
        ['warn', 'The source campaigns are kept. Deleting them afterwards is not reversible.'],
      ],
      confirm: 'Merge',
      run(id) {
        const picked = $$('.s-merge-tick:checked').map((i) => i.value);
        if (!picked.length) { toast('No campaign was picked, so nothing was merged.'); return false; }
        const incoming = [...new Set(picked.flatMap((k) => DB.campBy[k].members))];
        const fresh = incoming.filter((m) => !target.members.includes(m));
        const dupes = incoming.length - fresh.length;
        const prev = target.members.slice();
        target.members = prev.concat(fresh);
        reindex(); paint(); paintChrome();
        settleWork(id, `${plural(fresh.length, 'account')} merged in${dupes ? `, ${dupes} already there` : ''}.`);
        go({ on: 'campaigns', camp: target.k, lead: '' });
        toast(`${plural(fresh.length, 'account')} merged into ${target.name}.`, () => {
          target.members = prev; reindex(); paint(); paintChrome();
        });
      },
    });
  }

  /* V1's merge dialog shows a fixed "TOTAL CONTACTS 4,821 +1,200 ·
     DUPLICATE COUNT 142" before you have picked anything, which cannot be
     true of a selection that does not exist yet. This counts what is
     actually ticked, and says nothing when nothing is. */
  function paintMergeSum() {
    const host = $('#mergeSum');
    if (!host) return;
    const target = DB.campBy[host.dataset.mergeTarget];
    const picked = $$('.s-merge-tick:checked').map((i) => i.value);
    if (!target || !picked.length) { host.innerHTML = ''; return; }

    const incoming = picked.flatMap((k) => DB.campBy[k].members);
    const uniq = [...new Set(incoming)];
    const fresh = uniq.filter((m) => !target.members.includes(m));
    const dupes = uniq.length - fresh.length;

    host.innerHTML = `
      <div class="s-merge-fig">
        <span class="s-merge-n">${target.members.length + fresh.length}</span>
        <span class="s-merge-lbl">accounts after</span>
        <span class="s-merge-delta">+${fresh.length}</span>
      </div>
      <div class="s-merge-fig${dupes ? ' is-dupe' : ''}">
        <span class="s-merge-n">${dupes}</span>
        <span class="s-merge-lbl">already on both</span>
      </div>`;
  }

  /* ── Assign ──
     The sharing model already built, widened from a record to a list. */
  function assignCampaign(key) {
    const l = DB.campBy[key];
    if (!l) return;
    commit({
      title: `Assign ${l.name}`,
      body: `<div class="s-pick">${REPS.filter((p) => p.id !== l.owner).map((p) => `<label class="ds-choice s-pick-row">
        <input type="checkbox" value="${esc(p.id)}"${l.assignees.includes(p.id) ? ' checked' : ''} />
        <span>${esc(p.name)} <span class="s-pick-role">${esc(p.role)}</span></span>
      </label>`).join('')}</div>`,
      effects: [
        ['ok', `Assignees see the campaign, who is in it and every touchpoint, and it appears under Mine for them.`],
        ['warn', `Assigning is not ownership. ${actor(l.owner).name} still owns it and still holds its next steps.`],
        ['skip', 'Unticking somebody removes their access. It does not remove their touchpoints.'],
      ],
      confirm: 'Assign them',
      run() {
        const prev = l.assignees.slice();
        l.assignees = $$('.s-pick input:checked').map((i) => i.value);
        paint(); paintChrome();
        markChanged('.s-assignees');
        toast(l.assignees.length ? `Assigned to ${l.assignees.map((i) => actor(i).name).join(' and ')}.` : 'Nobody is assigned now.',
          () => { l.assignees = prev; paint(); paintChrome(); });
      },
    });
  }

  /* Adding a SELECTION to an existing campaign. `addToList` works from the
     filter; this works from the ticks, and they converge on one commit. */
  function pickCampaignForSelection() {
    const recs = selectedIds().map(recBy).filter(Boolean);
    const accIds = toAccountIds(recs);
    const open = DB.camp.filter((c) => campState(c) !== 'finished');
    commit({
      title: `Add ${plural(accIds.length, 'account')} to a campaign`,
      body: `<div class="s-pick">${open.map((l) => {
        const dupes = accIds.filter((a) => l.members.includes(a)).length;
        return `<label class="ds-choice s-pick-row">
          <input type="radio" name="list" value="${esc(l.k)}" />
          <span>${esc(l.name)} <span class="s-pick-role">${esc(plural(l.members.length, 'account'))}${dupes ? ` · ${dupes} already there` : ''}</span></span>
        </label>`;
      }).join('')}</div>`,
      effects: [
        ['ok', `The picked accounts join it.`],
        ['skip', 'Any that are already on it are skipped, not added twice.'],
      ],
      confirm: 'Add them',
      run() {
        const p = $('.s-pick input:checked');
        if (!p) { toast('No campaign was picked, so nothing changed.'); return false; }
        const l = DB.campBy[p.value];
        const fresh = accIds.filter((a) => !l.members.includes(a));
        const prev = l.members.slice();
        l.members = prev.concat(fresh);
        clearSel();
        reindex(); paint(); paintChrome();
        toast(`${plural(fresh.length, 'account')} added to ${l.name}${accIds.length - fresh.length ? `, ${accIds.length - fresh.length} skipped` : ''}.`,
          () => { l.members = prev; reindex(); paint(); paintChrome(); });
      },
    });
  }

  /* ═══════════════════════════════════════════════
     THE LOOPS THAT WERE OPEN

     Each of these had a start and no finish — a filter with nothing to fill
     it, a claim in the README with no code behind it, or a field the surface
     reads and nothing writes. An action that begins and cannot end is worse
     than one that was never offered, because the surface has already
     promised it.
  ═══════════════════════════════════════════════ */

  /* `?archived=1` filtered from the first pass and nothing ever archived. */
  function archiveRec(id) {
    const rec = recBy(id);
    if (!rec) return;
    const going = !rec.arch;
    commit({
      title: going ? `Archive ${rec.name}` : `Bring ${rec.name} back`,
      effects: going ? [
        ['ok', `${rec.name} drops out of every view that is not asking for archived records.`],
        ['skip', 'Nothing is deleted. Its touchpoints, campaigns and history stay exactly as they are.'],
        ['warn', campsOf(rec).length ? `It stays in ${plural(campsOf(rec).length, 'campaign')}, and a running one will keep sending to it.` : 'It is in no campaign, so nothing will reach it.'],
      ] : [
        ['ok', `${rec.name} comes back into every view its filters match.`],
        ['skip', 'Nothing was lost while it was away.'],
      ],
      confirm: going ? 'Archive it' : 'Bring it back',
      run() {
        rec.arch = going;
        paint(); paintChrome();
        toast(going ? `${rec.name} archived.` : `${rec.name} is back.`,
          () => { rec.arch = !going; paint(); paintChrome(); });
      },
    });
  }

  /* You could add to a campaign and never take anything out. */
  function removeFromCampaign(id, key) {
    const rec = recBy(id);
    const c = DB.campBy[key];
    if (!rec || !c) return;
    const accId = accOf(rec).id;
    commit({
      title: `Take ${accOf(rec).name} out of ${c.name}`,
      effects: [
        ['ok', `It leaves the campaign, with every contact there.`],
        campState(c) === 'running' ? ['ok', 'Nothing further will be sent to it under this campaign.'] : null,
        ['skip', `Its ${plural(touchesFor(rec).filter((t) => t.list === key).length, 'touchpoint')} from this campaign stay on the record. What happened, happened.`],
      ].filter(Boolean),
      confirm: 'Take it out',
      run() {
        const at = c.members.indexOf(accId);
        c.members = c.members.filter((m) => m !== accId);
        reindex(); paint(); paintChrome();
        markChanged('.s-camps');
        toast(`Out of ${c.name}.`, () => {
          c.members.splice(at < 0 ? c.members.length : at, 0, accId);
          reindex(); paint(); paintChrome();
        });
      },
    });
  }

  /* `campState` read the window and nothing could end a campaign early. */
  function stopCampaign(key) {
    const c = DB.campBy[key];
    if (!c) return;
    const left = c.members.filter((m) => { const a = DB.accBy[m]; return a && !a.outcome; }).length;
    commit({
      title: `Stop ${c.name}`,
      /* Ending a campaign early is a judgement the next person inherits.
         Without a reason the sheet reads "finished 40 days before its window
         closed" and leaves them to guess whether it worked, ran out of
         audience, or was overtaken. */
      body: `<label class="ds-field s-field">
          <span class="s-field-label">Why it is stopping early</span>
          <textarea class="ds-textarea s-why" rows="2" spellcheck="false"
            placeholder="The audience is exhausted · the offer changed · we are folding it into Q4"></textarea>
        </label>`,
      effects: [
        ['ok', `It becomes finished today, ahead of ${fmtDate(c.to)}.`],
        ['ok', 'Your reason sits on the campaign, so the next person reading it knows why it ended when it did.'],
        ['warn', `Nothing more sends — including to the ${plural(left, 'account')} still live in it.`],
        ['skip', 'Members, touchpoints and assignees are all kept. Stopping is not deleting.'],
      ],
      needs: '.s-why', needsSay: 'Say why it is stopping early.',
      confirm: 'Stop it',
      run() {
        const why = (($('.s-why') || {}).value || '').trim();
        if (!why) { toast('Ending it early without saying why leaves the next person guessing. Nothing was stopped.'); return false; }
        const prev = { to: c.to, stopWhy: c.stopWhy };
        c.to = iso(shift(TODAY, -1));
        c.stopWhy = { by: me().id, at: iso(TODAY), why };
        paint(); paintChrome();
        toast(`${c.name} stopped.`, () => { Object.assign(c, prev); paint(); paintChrome(); });
      },
    });
  }

  /* ── Every task has a stop ──

     Pausing is reversible and cheap, so it does not go through the commit
     surface — the toast's undo is the whole of the ceremony it earns.
     Stopping is not, and it does, because the sentence that matters is the
     one about what has ALREADY gone out: a person who believes stopping
     unsends eighteen emails will stop a campaign instead of writing an
     apology. */
  function taskPause(id) {
    const t = DB.taskBy[id];
    if (!t || !canWrite()) return;
    const was = !!t.paused;
    t.paused = !was;
    if (!t.paused) t.pausedWhy = null;
    else t.pausedWhy = `Paused by ${me().name}`;
    paint(); paintChrome();
    toast(was ? `${t.title} is running again.` : `${t.title} is paused. Nothing more goes out until you start it.`,
      () => { t.paused = was; paint(); paintChrome(); });
  }

  function taskStop(id) {
    const t = DB.taskBy[id];
    if (!t) return;
    const left = Math.max(0, t.take - t.done - t.failed);
    commit({
      title: `Stop “${t.title}”?`,
      body: `<label class="ds-field s-field">
          <span class="s-field-label">Why it is stopping</span>
          <textarea class="ds-textarea s-why" rows="2" spellcheck="false"
            placeholder="The list was wrong · we are doing these by hand · the campaign it belongs to is over"></textarea>
        </label>`,
      effects: [
        ['ok', left
          ? `It ends now. The ${left} it has not reached will not be ${TASK_KIND[t.kind].past}.`
          : 'It ends now. It had nothing left to do anyway.'],
        t.done ? ['warn', `The ${t.done} it has already done stay done. Stopping does not undo them — use "Undo what it did" for that.`] : null,
        ['skip', 'Everything it recorded is kept, and the task stays on this list so what happened is still readable.'],
      ],
      needs: '.s-why', needsSay: 'Say why it is stopping.',
      confirm: 'Stop it',
      run() {
        const why = (($('.s-why') || {}).value || '').trim();
        if (!why) { toast('Stopping AiMY mid-run without saying why is the thing this surface exists to stop. Nothing was stopped.'); return false; }
        const prev = { finished: t.finished, paused: t.paused, blocked: t.blocked, take: t.take, stopWhy: t.stopWhy };
        t.finished = iso(TODAY);
        t.paused = false;
        t.blocked = null;
        t.take = t.done + t.failed;
        t.stopWhy = { by: me().id, at: iso(TODAY), why };
        paint(); paintChrome();
        toast(`${t.title} stopped.`, () => { Object.assign(t, prev); paint(); paintChrome(); });
      },
    });
  }

  /* Only offered where the task wrote something, and it says what it will
     take back BEFORE taking it — a task's writes are AiMY's touchpoints on
     real records, and removing them silently would be the audit trail
     lying in the other direction. */
  function taskUndo(id) {
    const t = DB.taskBy[id];
    if (!t || !t.wrote) return;
    const wrote = DB.touch.filter((x) => x.task === t.id);
    commit({
      title: `Undo what "${t.title}" did?`,
      effects: [
        ['ok', `${plural(wrote.length || t.done, 'touchpoint')} AiMY recorded come off the ${plural(t.on.length, 'record')} it touched.`],
        ['warn', 'The messages it already sent were sent. This takes back the record of them here, not the messages themselves.'],
        ['skip', 'The task stays, marked as undone, so the fact it ran is not erased along with its effects.'],
      ],
      confirm: 'Undo it',
      run() {
        const prev = DB.touch.slice();
        const prevT = { done: t.done, undone: t.undone };
        DB.touch = DB.touch.filter((x) => x.task !== t.id);
        t.undone = true;
        t.done = 0;
        reindex(); paint(); paintChrome();
        toast(`Undone. ${t.title} left no touchpoints behind.`, () => {
          DB.touch = prev; Object.assign(t, prevT); t.undone = false;
          reindex(); paint(); paintChrome();
        });
      },
    });
  }

  /* The one task exit that earns a button on the card, because it is the one
     that goes somewhere the card click does not: a judgement with the
     evidence beside it, which is the canvas. Same shape as "re-engage or
     drop" on a going-cold lead. */
  function taskDecide(id) {
    const t = DB.taskBy[id];
    if (!t || !t.blocked) return;
    /* Three surfaces reach this — the card, the bell and the briefing — and a
       guard on two of the three is a guard on none. It opens the task to read
       rather than refusing, because the person asking is entitled to see it;
       they are just not the one who unsticks it. */
    if (!canWrite()) { go({ on: 'tasks', task: id, lead: '' }); return; }
    go({ task: '' });
    const on = maySee(tasksRecords(t));
    canvasWork({
      title: t.title,
      lede: t.blocked.why,
      body: `<div class="s-work-note">
        <p class="s-work-p">It has been stopped since ${esc(fmtAgo(t.blocked.since))}. ${esc(t.done)} of ${esc(t.take)} were done before it stopped.</p>
        ${on.length ? `<div class="s-camps">${on.slice(0, 6).map((r) => `<button class="chip default s-camp-chip" type="button" data-open="${esc(r.id)}">${esc(r.name)}</button>`).join('')}</div>` : ''}
      </div>
      <div class="decision-zone s-task-choice">
        <label class="ds-choice"><input type="radio" name="taskgo" class="s-task-pick" value="go" data-say="Let it carry on" checked /><span>Carry on and let AiMY choose — it will record what it picked and why.</span></label>
        <label class="ds-choice"><input type="radio" name="taskgo" class="s-task-pick" value="skip" data-say="Skip and finish" /><span>Skip the ones it is stuck on and finish the rest.</span></label>
        <label class="ds-choice"><input type="radio" name="taskgo" class="s-task-pick" value="stop" data-say="Stop it here" /><span>Stop it here. What is done is done.</span></label>
      </div>`,
      effects: [
        ['ok', 'Whatever you pick is recorded against the task, so the next person can see it was a decision and not a default.'],
        ['warn', 'Letting AiMY choose is still AiMY choosing. It is attributed to AiMY on every record it touches, never to you.'],
      ],
      confirm: 'Let it carry on',
      run(id) {
        const pick = ($('.s-task-pick:checked') || {}).value || 'go';
        const prev = { blocked: t.blocked, done: t.done, take: t.take, finished: t.finished, decided: t.decided };
        t.decided = { by: me().id, at: iso(TODAY), pick };
        t.blocked = null;
        if (pick === 'stop') { t.finished = iso(TODAY); t.take = t.done + t.failed; }
        else if (pick === 'skip') { t.take = Math.max(t.done, t.take - 3); t.finished = iso(TODAY); }
        else { t.done = t.take - t.failed; t.finished = iso(TODAY); }
        const said = pick === 'stop' ? 'Stopped where it was.'
          : pick === 'skip' ? 'Skipped the three it was stuck on and finished the rest.'
          : 'Carried on. AiMY recorded what it picked on every record it touched.';
        settleWork(id, said);
        paint(); paintChrome();
        toast(said, () => { Object.assign(t, prev); t.decided = null; paint(); paintChrome(); });
      },
    });
  }

  /* The README claimed a rep could annotate AiMY's work. They could not. */
  function annotateTouch(tid) {
    const t = DB.touch.find((x) => x.id === tid);
    if (!t) return;
    commit({
      title: 'Add a note to what AiMY did',
      body: `<p class="s-commit-quote">${esc(t.note)}</p>
        <label class="ds-field s-field">
          <span class="s-field-label">What you know that it does not</span>
          <textarea class="ds-textarea s-note" rows="3" spellcheck="false"
            placeholder="They replied to me directly · wrong contact · already a customer…"></textarea>
        </label>`,
      effects: [
        ['ok', 'Your note sits under the touchpoint, attributed to you.'],
        ['skip', 'AiMY’s own entry is not edited. What it did is what it did, and rewriting the record of it would be the one thing this product refuses to do.'],
      ],
      confirm: 'Add the note',
      run() {
        const text = (($('.s-note') || {}).value || '').trim();
        if (!text) { toast('An empty note is not a note. Nothing was added.'); return false; }
        t.note2 = { by: me().id, at: iso(TODAY), text };
        paint();
        markChanged('.s-timeline');
        toast('Note added.', () => { t.note2 = null; paint(); });
      },
    });
  }

  /* The briefing reported bounces and offered no way to fix one. */
  function fixAddress(id) {
    const rec = recBy(id);
    if (!rec || rec.kind !== 'con') return;
    commit({
      title: `Fix ${rec.name}'s address`,
      body: `<p class="s-commit-quote">${esc(rec.email)} — rejected by the server. Nothing sent to it was delivered.</p>
        <label class="ds-field s-field">
          <span class="s-field-label">The right one</span>
          <input class="field-input s-addr" type="text" placeholder="${esc(rec.email)}" />
        </label>`,
      effects: [
        ['ok', 'The address is corrected and marked as confirmed by a person rather than guessed.'],
        ['ok', 'Anything the campaign still owes them sends to the new address.'],
        ['skip', 'The bounced touchpoints stay on the record. They are what happened.'],
      ],
      confirm: 'Correct it',
      run() {
        const next = (($('.s-addr') || {}).value || '').trim();
        if (!next || !next.includes('@')) { toast('That is not an address. Nothing was changed.'); return false; }
        const prev = { email: rec.email, enrich: rec.enrich.email };
        rec.email = next;
        rec.enrich.email = { conf: 'high', src: `Corrected by ${me().name}`, at: iso(TODAY) };
        paint(); paintChrome();
        markChanged('.s-reach');
        toast('Address corrected.', () => {
          rec.email = prev.email; rec.enrich.email = prev.enrich; paint(); paintChrome();
        });
      },
    });
  }

  /* `rec.override` was read and rendered from the first pass and nothing
     ever wrote it. The escape hatch has to exist — a computed status will
     sometimes be wrong — but it is attributed, so it can never be mistaken
     for the computation. */
  function overrideStatus(id) {
    const rec = recBy(id);
    if (!rec) return;
    const computed = computedStatus(rec);
    commit({
      title: `Set the status on ${rec.name} by hand`,
      body: `<p class="s-commit-quote">It computes to <strong>${esc(label('status', computed))}</strong> — ${esc(because(rec))}.</p>
        <div class="s-pick">${TAX.status.map((s) => `<label class="ds-choice s-pick-row">
          <input type="radio" name="ovr" value="${esc(s.k)}"${s.k === statusOf(rec) ? ' checked' : ''} />
          <span>${esc(s.label)} <span class="s-pick-role">${esc(s.exit || 'nothing left to do')}</span></span>
        </label>`).join('')}</div>
        ${/* THE REASON IS THE POINT, and it was missing.

              This surface argues that a computed status which will not say
              why it is what it is asks to be taken on faith — and this is
              the one place a person overrules the computation. It recorded
              who and when and nothing about why, so the record went from
              "they came back 3 months ago and nobody answered" to "set by
              Nour on 5 Aug", which is strictly less than it knew before.

              Required, not optional. An override with no reason is the
              attestation model this product was built to replace. */ ''}
        <label class="ds-field s-field">
          <span class="s-field-label">Why it is not what it computes to</span>
          <textarea class="ds-textarea s-why" rows="2" spellcheck="false"
            placeholder="They signed on Friday, the paperwork is next week · procurement told me verbally · the reply came to my personal inbox"></textarea>
        </label>`,
      effects: [
        /* AN ENDING IS A FACT, NOT A LABEL OVER ONE.

           Won, Lost and Not a fit were reachable through this picker and
           wrote `rec.override` — a note saying "ignore the computation" —
           while `computedStatus` reads `rec.outcome` first and would have
           taken the same word as truth. So the surface had no way at all to
           record the two most consequential events in sales, and the way it
           looked like it did wrote the wrong field.

           These three now write the outcome. Everything else is still an
           override, because everything else IS a live state the touchpoints
           are entitled to move. */
        ['ok', `The record shows what you pick, attributed to ${me().name}.`],
        ['ok', 'Your reason is kept on the record and shown with the status, so it still explains itself.'],
        ['warn', `Won, Lost and Not a fit are recorded as endings — the record leaves every live view. Anything else is an override, and it stops following the touchpoints until you clear it.`],
        ['skip', 'Nothing is sent and no touchpoint is written. Recording where something stands is not contact.'],
      ],
      needs: '.s-why', needsSay: 'Say why it is not what it computes to.',
      confirm: 'Set it',
      run() {
        const pick = ($('input[name="ovr"]:checked') || {}).value;
        const why = (($('.s-why') || {}).value || '').trim();
        const prev = { override: rec.override, outcome: rec.outcome, outcomeWhy: rec.outcomeWhy };
        const back = () => { Object.assign(rec, prev); paint(); paintChrome(); };
        if (!pick || pick === computed) {
          rec.override = null;
          paint(); paintChrome();
          toast('Back to the computed status.', back);
          return;
        }
        if (!why) { toast('An override with no reason is the thing this replaced. Nothing was set.'); return false; }
        if (ENDINGS.includes(pick)) {
          rec.outcome = pick;
          rec.outcomeWhy = why;
          rec.override = null;
        } else {
          rec.override = { v: pick, by: me().id, at: iso(TODAY), why };
        }
        paint(); paintChrome();
        markChanged('.s-rec-status');
        toast(`${rec.name} is ${label('status', pick).toLowerCase()}.`, back);
      },
    });
  }

  /* "Review due" said something was stale and gave nowhere to go. Reporting
     a problem was the only action, and it is a different claim: a rep with
     no complaint about the content has nothing to report, they just want it
     looked at by whoever owns it.

     Sibling of `correctKnowledge` deliberately — same boundary, same shape,
     different reason — because the two are one loop with two entrances and
     splitting their vocabulary would make the second look like a lesser
     version of the first. */
  function askReview(kbId) {
    const k = KB_BY[kbId];
    if (!k || k.review) return;
    const first = actor(k.owner).name.split(' ')[0];
    commit({
      title: `Ask ${first} to ${k.trust === 'unverified' ? 'verify' : 're-verify'} this`,
      body: `<p class="s-commit-quote">${esc(k.summary)}</p>
        <div class="s-reach-row">
          <span class="s-reach-what">State</span>
          <span class="trust-state ts-${esc(k.trust)}" data-trust-state="${esc(k.trust)}">${esc(TRUST_LABEL[k.trust])}</span>
          <span class="s-reach-val">since ${esc(fmtDate(k.updated))}</span>
        </div>
        <label class="ds-field s-field">
          <span class="s-field-label">Anything they should know <span class="s-field-note">optional</span></span>
          <textarea class="ds-textarea s-kb-why" rows="2" spellcheck="false"
            placeholder="I am about to send this to a bank · the rate card may have moved since April…"></textarea>
        </label>`,
      effects: [
        ['ok', `A review request goes to ${actor(k.owner).name}, who owns it in Knowledge, with where you were when you asked.`],
        ['ok', 'It is marked here immediately, so the next person can see it has already been asked for rather than asking again.'],
        /* The load-bearing line. Without it this reads as a button that
           fixes the trust state, and the next person to look would believe
           a review had happened because Sales said so. */
        ['skip', `The state stays ${TRUST_LABEL[k.trust].toLowerCase()} until ${first} actually reviews it. Only Knowledge can change that, and asking is not reviewing.`],
      ],
      confirm: 'Ask them',
      run() {
        const why = (($('.s-kb-why') || {}).value || '').trim();
        const prev = k.review;
        k.review = { by: me().id, at: iso(TODAY), why };
        paint();
        /* AFTER the toast, not before. `toast()` calls `noteChange()`, which
           appends to the conversation and repaints the rail from its stored
           turn HTML — so a card repainted first is overwritten by the version
           captured when the turn was created, and the button comes back to
           life on a request already sent. */
        toast(`Asked ${actor(k.owner).name} to look at it.`, () => { k.review = prev; paint(); repaintKb(k.id); });
        repaintKb(k.id);
        markChanged(`[data-kbid="${k.id}"], .s-kbline`);
      },
    });
  }

  /* The README claimed a correction opened a request in Knowledge's queue.
     Only a toast existed. Direction §8.1: "a wrong answer discovered inside
     another agent still opens the correction loop… the loop must not break
     at the product boundary." */
  function correctKnowledge(kbId) {
    const k = KB_BY[kbId];
    if (!k) return;
    commit({
      title: `Report a problem with ${k.title}`,
      body: `<p class="s-commit-quote">${esc(k.summary)}</p>
        <label class="ds-field s-field">
          <span class="s-field-label">What is wrong with it</span>
          <textarea class="ds-textarea s-kb-why" rows="3" spellcheck="false"
            placeholder="The rate card is out of date · this story is not ours to tell · the ICP floor moved…"></textarea>
        </label>`,
      effects: [
        ['ok', `A request goes to ${actor(k.owner).name}, who owns it in Knowledge, with what you wrote and where you were when you found it.`],
        ['ok', 'It is flagged here immediately, so nobody else cites it in the meantime.'],
        ['skip', 'The object is not changed. Sales does not write to Knowledge; it reports.'],
      ],
      needs: '.s-kb-why', needsSay: 'Say what is wrong with it.',
      confirm: 'Send it',
      run() {
        const why = (($('.s-kb-why') || {}).value || '').trim();
        if (!why) { toast('A report with nothing in it is the defect this fixes. Nothing was sent.'); return false; }
        const prev = k.flagged;
        k.flagged = { by: me().id, at: iso(TODAY), why };
        paint();
        toast(`Reported to ${actor(k.owner).name} in Knowledge.`, () => { k.flagged = prev; paint(); repaintKb(k.id); });
        repaintKb(k.id);
        markChanged(`[data-kbid="${k.id}"]`);
      },
    });
  }

  /* ── Give it a plan ──
     The one write that turns a list into a campaign. It is the moment the
     object starts acting on its own, so it says so. */
  function givePlan(key) {
    const l = DB.campBy[key];
    if (!l) return;
    commit({
      title: `Start ${l.name}`,
      body: `<div class="s-pick">${TAX.channel.map((c) => `<label class="ds-choice s-pick-row">
        <input type="checkbox" value="${esc(c.k)}" />
        <span>${esc(c.label)} <span class="s-pick-role">${esc(c.auto ? 'AiMY sends these itself' : 'you log these')}</span></span>
      </label>`).join('')}</div>`,
      effects: [
        ['ok', `${l.name} starts running against ${plural(l.members.length, 'account')}, today until ${fmtDate(shift(TODAY, 90))}.`],
        ['warn', 'If AiMY is in the plan it will send without asking again. Every send is logged as AiMY’s and carries its reasoning.'],
        ['skip', 'No touchpoint is written now. A plan is an intention, not a send.'],
      ],
      confirm: 'Start it',
      run() {
        const plan = $$('.s-pick input:checked').map((i) => i.value);
        if (!plan.length) { toast('A campaign with no channels cannot run. Nothing changed.'); return false; }
        l.plan = plan;
        l.from = iso(TODAY);
        l.to = iso(shift(TODAY, 90));
        paint(); paintChrome();
        go({ on: 'campaigns', camp: l.k, lead: '' });
        toast(`${l.name} is running.`, () => { l.plan = null; l.from = null; l.to = null; paint(); paintChrome(); });
      },
    });
  }

  /* ═══════════════════════════════════════════════
     BOOT
  ═══════════════════════════════════════════════ */

  build();
  parse();
  paint();
  paintChrome();

  window.addEventListener('popstate', () => { parse(); paint(); paintChrome(); });
})();
