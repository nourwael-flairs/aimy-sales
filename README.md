# AiMY Sales — the BDR build

One role, one job. A BDR opens this and sees two things: **people to call**, and
**the campaigns they are on**. Everything else was cut, and comes back when the
role that needs it does.

The previous build is at **`/old/`** and still runs. Nothing here edits it.

```bash
python devserver.py 8098      # then open http://localhost:8098/
node assets/audit.js          # before every commit
```

Do not serve this with `python -m http.server`. The cache-busting stamp lives
inside `index.html`, so a cached document asks for the old assets for ever;
`devserver.py` exists to send `no-store` on HTML and nothing else.

---

## What a BDR does here

**The heading is the switcher.** The block title reads Calls · Campaigns ·
Lists — the one you are on at heading weight, the other two quiet beside it and
pressable. There is no navigation column and no control above the heading: a
product with three surfaces does not need a row of chrome to say which one you
are on. The rail carries the AiMY reading and nothing else.

| surface | url | what it is |
|---|---|---|
| Calls | `/` | the ranked queue, cut six ways, paged |
| Campaigns | `?on=camps` | the ones you are on, paged |
| Lists | `?on=lists` | the ones you built, and the way to build another |

Under those sit the three records: one campaign (`?camp=`), one person
(`?con=`), one list (`?list=`).

**A cut is a rung.** The queue is cut four ways and every one of them is a
place on the ladder, so there is no second vocabulary to learn. They sum to the
whole, because a person stands on exactly one rung.

| cut | the rung it is |
|---|---|
| Callbacks | they asked to be rung back, and the date has come |
| New | nobody has rung them |
| No answer | rung, nobody picked up |
| Answered | you got them, and there is no meeting yet |

Once a meeting is booked they leave the queue — the BDR's part is done until it
happens, and a caller working a list does not want the people they have already
closed in it.

Every row does the same thing, because on this surface there is only one thing
to do, and it says **Call**. It briefly said "Say what happened" on people whose
meeting had passed: a second verb, for a second job, in the middle of a list you
are dialling down. The call logs the touchpoint; a separate step to report the
same call is the step this build exists to remove.

**One worklist per surface, paged. Everything else is context, capped.** Fifteen
is a screenful: ring through it, press once for the next fifteen. A thousand
people behind a scrollbar is not scale, it is an endless list — you cannot tell
where you are in it, cannot come back to the same place, and never finish
anything.

The worklist/context split is not cosmetic. Two pagers on one page either share
a page number or need two, and both are worse than deciding which of the two
lists is the reason you came. So a campaign pages its queue and shows the last
eight things that happened; a person shows their last eight calls; the builder
shows the first eight matches. Every one says what it is showing of what:

```
1–15 of 1,015 people · page 1 of 68
14 campaigns, all of them here
The last 8 of 436 calls
The first 8 of 3,000 matches
```

"The last 8" and "the first 8" are different claims — a feed is newest-first, a
search result is not ordered at all — so the footer is told which end it shows
rather than guessing.

**A call** is a shell region beside the page, not a modal, so you can open the
person or read the campaign's pitch while it runs. Four states: `ready` shows
three lines of preparation and waits, **Start** begins `connecting`, the clock
starts at `live`, and `logging` is where AiMY says what it heard. Telephony is
fixture — a transcript grows a line at a time from a script chosen by the
person's own hidden `fate`, so a demo walked twice tells the same story twice.
The one real handoff is the `tel:` link on the record.

**Logging is a sentence, not a form.** Seven outcomes on one always-visible row
with the one AiMY read already lit, a line to type underneath, and a sentence
saying what pressing Log will do. The note is read as you type and **overrides
the transcript per axis** — read together, a gatekeeper heard on the call would
outrank *"actually I spoke to her"* for ever, because the lexicon ranks by
specificity and not by recency.

**A list** is how anyone new reaches the queue. Describe who to look for, the
sources answer, and what comes back is the list. Two presses to a list, a third
to put it on a campaign.

---

## The ladder

Where one lead stands with this BDR. **It is a stored field**, moved only by
`moveFor` (a call) or `setCheckpoint` (a one-press control).

```
not-called → no-answer → callback → answered → meeting-set → showed-up → interested → handed-over
                                    exits: declined · wrong-number · do-not-call
```

The V3 build derived every status from the touchpoints, which made status
uncontradictable and unsettable. A BDR ladder cannot work that way: *showed up*
and *interested* are things a person observed, and no call record implies them.
Those four rungs are one press each on the record, always visible, and every one
is undoable.

A call never moves a lead **backwards**, and never climbs out of an exit — only
Undo does that. Past `handed-over` it stops being a BDR lead, which is why the
ladder ends there.

**One write, two places it shows.** A touchpoint and a rung are the whole of it;
everything a campaign reports — how many are left to call, callbacks due,
meetings set, its rung tally, its feed — is derived from those two, so a person's
record and the campaign they are on cannot disagree about what just happened.

---

## How it is built

`index.html` is the V3 document with four asset paths changed. `assets/sales.css`
is copied across whole. **The shell, the components, the background, the rail,
the briefing card, the queue row, the toast and the canvas are the ones that
already existed** — this is a new process over the existing design, not a new
design.

| file | what it is |
|---|---|
| `assets/bdr.js` | the whole product: corpus, store, derivations, surfaces, call flow |
| `assets/bdr.css` | an **appendix**, not a stylesheet — only what did not exist before |
| `assets/sales.css` | the V3 stylesheet, copied, unedited |
| `assets/aimy-ds.css` | the design system, copied, never edited |
| `assets/audit.js` | eight checks over what breaks silently here |

If `bdr.css` starts redefining what `sales.css` already says, that is the
mistake: delete the rule and use the one that is there.

### The store holds the delta, not the corpus

Six thousand people and twenty-one thousand calls serialise past the ~5MB
localStorage quota, so a full save would fail and fail late. The corpus is
regenerated from one seed on every load (about 390ms for the whole navigation),
and only **what you changed** is persisted. A moved checkpoint costs 147 bytes.
Reset is one `removeItem`.

Seed dates are relative to the real clock, so a link opened next month still
shows callbacks due today. Ids come from indices and never from dates, which is
what lets a stored delta survive the corpus being rebuilt on a different day.

Keys: `aimy-sales-bdr:db:v1`, `aimy-sales-bdr:ui`. The theme is the shared
library's `aimy-ds-theme`.

### The windowed list

Every list is a `vlist`: the host is as tall as the whole list, the rows inside
it are positioned by arithmetic, and about thirty exist at a time. Measured on
six thousand rows: 362 DOM nodes against 36,176.

**It measures in layout pixels, not visual ones.** The shell carries `zoom` on
`<body>`, so `getBoundingClientRect` returns layout pixels times the UI scale
while a row height in CSS does not. Mixing them puts the window wrong by a
*factor* on every screen that is not exactly the 1536 anchor. `offsetTop`,
`scrollTop` and `clientHeight` are all layout pixels — which is why
`.page-scroll` is positioned: it is the terminus of the `offsetParent` walk.

### Keys

`Enter` means the obvious next thing at every state — dial the next one, start
this one, hang up, log it and move on. `1`–`7` pick an outcome and end the call
if it is still running. `N` jumps to the note, `S` skips, `Esc` closes the
innermost thing that is open, `/` puts the cursor in the composer, `j`/`k`/`o`
move through the list and open a row.

---

## What is cut

Manager, exec, client and stakeholder surfaces; financials; funnel analytics;
the campaign builder; sequences; the meetings calendar; the odds ladder; the
role switcher (`?as=` survives as a prototype control only). All of it is at
`/old/` and none of it was deleted.

## Known, and not this build's

`aimy-ds.css:627` sets `.evidence-pill .val { color: #fff }` — a hard-coded
white the design system's own Level 1 gate bans. In light mode the pill's ground
is near-white, so the number on every rail card is white on white. The V3 build
has the same line. It is overridden in `bdr.css` §9 rather than edited in the
library, and it belongs in the library's gap register.

## Traps this repo has already sprung

- **The shell eats backslashes**, quoted heredocs included. `commas` lost the
  escapes out of its regular expression twice; the damaged form is still *valid*
  and matches nothing, so every number silently lost its separators with no
  error anywhere. Use the editor, not the shell, for anything with a backslash.
- **The `?v=` stamp makes assets immutable.** Change a file without bumping it
  and the browser keeps serving the old one. Force a revalidation, or bump.
- **A hidden browser pane reports a zero viewport**, which collapses the height
  chain and leaves the scroller unbounded — a windowed list then measures as
  broken when the measurement is what is broken.
- **`.s-home` is a two-column grid** above the anchor width. A block without
  `.s-block-wide` lands in one column and leaves a hole where the other should
  be, which reads as a layout bug rather than a missing class.
- **The audit checks whether an attribute is drawn, not whether a value is.** A
  `data-start="lists"` branch sat in the router with nothing rendering that
  value, and the whole Lists surface was unreachable, with the audit green.
