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

**Today** ranks everybody callable and says why each one is on the list. Six
cuts, and their counts sum to the whole — one bucket per person, and the bucket
function *is* the ranking, so the chips and the order cannot drift apart.

| bucket | what it means |
|---|---|
| After a meeting | the meeting has been and gone and nobody has said what came of it |
| Due | a callback or a promise falls today, or already has |
| Try again | rung, nobody picked up, and it has been two days |
| Open | you have spoken, nothing is owed |
| Never rung | nobody has tried |

**The queue is worked a page at a time.** Fifteen is a screenful: ring through
it, press once for the next fifteen. A thousand people behind a scrollbar is not
scale, it is an endless list — you cannot tell where you are in it, cannot come
back to the same place, and never finish anything. The total is stated on every
page, so bounding what is drawn never hides how much there is.

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
