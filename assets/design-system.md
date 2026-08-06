# AiMY Design System

The shared foundation for the Aimy ecosystem — one token layer, one component library, one AI interaction language. Everything is product-agnostic: any Aimy product builds on it and feels native to the same family.

**Living reference:** `index.html` (interactive, light/dark toggle, every component rendered with states).

---

## Principles

| Principle | Meaning |
|---|---|
| **Token-first** | No hard-coded colors or spacing in product code. Every value is a CSS variable; themes and per-product accents are a single swap. |
| **Product-agnostic** | Components carry no product copy or logic. Each product re-themes `--accent` and supplies content. |
| **Theme-aware** | Every surface works in light and dark. Test both before shipping. |
| **AI-native** | AI states (thinking, streaming, citations, suggestions) are first-class components, not afterthoughts. AI never applies changes silently — always review (accept/reject). |
| **Accessible by default** | `:focus-visible` rings, `prefers-reduced-motion`, AA contrast in both themes. Status is always carried by color **and** text/icon, never color alone. |

---

## 1. Color

### Neutral ramp `--d50 … --d950` (navy-tinted)

`--d50` = strongest text, `--d950` = deepest surface. The ramp **inverts** in light mode, so text/surface roles hold automatically.

| Token | Dark | Light |
|---|---|---|
| `--d50` | `#eef2f6` | `#10151b` |
| `--d100` | `#d8e0e8` | `#1c2630` |
| `--d200` | `#c8d2dc` | `#2a3540` |
| `--d300` | `#b0bcca` | `#3a4653` |
| `--d400` | `#8b9aaa` | `#566472` |
| `--d500` | `#637280` | `#637280` |
| `--d600` | `#4a5b6e` | `#6e7d8d` |
| `--d700` | `#2e3d50` | `#b0bcca` |
| `--d750` | `#233040` | `#c8d2dc` |
| `--d800` | `#1c2630` | `#d8e0e8` |
| `--d850` | `#141b24` | `#e4eaf0` |
| `--d900` | `#0d1117` | `#eef2f6` |
| `--d950` | `#080b10` | `#f7fafc` |

Roles: `--d50` primary text · `--d400` secondary/muted · `--d500` tertiary/placeholder · `--d600` faint labels/separators.

### Brand & accent

| Token | Dark | Light | Use |
|---|---|---|---|
| `--brand` | `#3369ff` | same | Primary CTA, focus rings, links, selection |
| `--brand-dim` / `--brand-glow` | 15% / 25% | 12% / 20% | Tints, focus halos |
| `--accent` | `#8b4ff4` | same | **The one token products re-theme — global, not per-product.** Nav active, chip selection, chat caret, coach marks. There is no `--qa-accent`, `--talent-accent` or any other product-scoped accent: a product sets `--accent` once and the whole system follows |
| `--accent-rgb` / `-dim` / `-glow` | — | — | Derivatives of the accent |
| `--teal` | `#6fdfe2` | `#0d8f95` | Secondary accent; darkened in light for text contrast |
| `--ai` | `linear-gradient(104deg, #0066ff 0%, #61adf1 47%, #6fdfe2 100%)` | same | AI provenance — gradients, model dot, progress fills |
| `--ai-text` | `#61adf1` | `#1f5fd0` | AI-blue text (badges, selected options) |

Rule: **focus is always `--brand`**, never the product accent — focus stays consistent across every Aimy product.

### Semantic status

Text/icon hues darken one step in light mode (dark-mode mid-tones fail contrast on white). Tint backgrounds stay pale.

| Token | Dark | Light | Bg token |
|---|---|---|---|
| `--ok` | `#17b26a` | `#0e9257` | `--ok-bg` green @ 12–14% |
| `--warn` | `#f79009` | `#b26205` | `--warn-bg` amber @ 12–14% |
| `--err` | `#f04438` | `#d92d20` | `--err-bg` red @ 12–14% |
| `--info` | `#0ea5e9` | `#067dc2` | `--info-bg` cyan @ 12–14% |

### Surfaces & helpers

| Token | Dark | Light |
|---|---|---|
| `--body-bg` | `#0f1215` | `#f4f6f9` |
| `--card-bg` | `#141b24` | `#ffffff` |
| `--card-bg-raised` | `#1c2630` | `#f7f9fc` |
| `--card-border` | `rgba(255,255,255,.07)` | `rgba(16,24,40,.10)` |
| `--card-border-hover` | `rgba(255,255,255,.14)` | `rgba(16,24,40,.18)` |
| `--card-border-focus` | `rgba(51,105,255,.4)` | same |
| `--panel-bg` (glass panel) | `rgba(13,17,22,.95)` | `rgba(255,255,255,.96)` |
| `--glass-bg` / `--glass-border` | dark glass | white glass |
| `--text-strong` | `#ffffff` | `#10151b` |
| `--hairline` | white @ 7% | ink @ 9% |
| `--code-bg` | `#0b0f14` | **same — code blocks stay dark in both themes** |

---

## 2. Typography

**Pairing:** **Urbanist** = primary (body, UI, labels) · **Poppins** = display (H1/H2/H3) · **JetBrains Mono** = code/tokens. All loaded 300–800 with italics.

Tokens: `--font-sans` (Urbanist) · `--font-display` (Poppins) · `--font-mono` · `--fst-normal` / `--fst-italic`.

### Scale (`--fs-*`)
`2xs` 10 · `xs` 11 · `sm` 12 · `base` 13 · `md` 14 · `lg` 16 · `xl` 18 · `2xl` 22 · `3xl` 28 · `4xl` 34 · `5xl` 46 (px)

### Weights (`--fw-*`)
light 300 · regular 400 · medium 500 · semibold 600 · bold 700 · extrabold 800

### Line height (`--lh-*`) / tracking (`--ls-*`)
lh: none 1 · tight 1.2 · snug 1.4 · base 1.55 · relaxed 1.75
ls: tighter −0.03em · tight −0.02em · normal 0 · wide 0.04em · wider 0.08em

### Roles

| Role | Font | Size / Weight / Tracking |
|---|---|---|
| Hero H1 | Poppins | 46 / 800 / −0.03em |
| Section H2 | Poppins | 24 / 800 / −0.02em |
| Sub-heading H3 | Poppins | 14 / 700 |
| Page title | Urbanist | 15 / 700 / −0.01em |
| Body | Urbanist | 13 / 500 |
| Card title | Urbanist | 12 / 600 |
| Nav item | Urbanist | 13 / 600 |
| Label / eyebrow | Urbanist | 10 / 700 / +0.1em, uppercase |
| Badge / pill | Urbanist | 9–10 / 700, uppercase |
| Mono | JetBrains | 11–12 / 400–500 |

---

## 3. Spacing, radius, motion, shadow, layout

- **Spacing** — 4px base: `--sp-1…--sp-15` = 4, 8, 12, 16, 20, 24, 32, 40, 48, 60. Card padding 16 (compact) or 20–24 (comfortable).
- **Radius** — `--r-xs` 4 · `--r-sm` 6 · `--r-md` 8 · `--r-lg` 10 · `--r-xl` 12 · `--r-2xl` 16 · `--r-pill` 9999. Radius scales with component size.
- **Motion** — `--t-fast` 150ms · `--t-base` 200ms · `--t-slow` 300ms. `--ease-out: cubic-bezier(.22,1,.36,1)` for enter, `--ease-spring: cubic-bezier(.34,1.56,.64,1)` for feedback. Everything respects `prefers-reduced-motion`.
- **Shadows** — `--shadow-sm/md/lg/xl`; black-based in dark, cool ink-based in light.
- **Layout** — three-zone shell everywhere: fixed topnav (60px, `--topbar-height`) → fixed sidebar (240px, `--sidebar-width`) → scrollable main. Dashboard grids: Tier-1 `repeat(4, 1fr)`, Tier-2 `1.5fr 1fr`.

---

## 4. Theming

- Dark is default. Light mode = `<html data-theme="light">`; toggle persists to `localStorage` (`aimy-ds-theme`), applied pre-paint (no flash).
- Overrides are **token-level** in `:root[data-theme="light"]` plus a small set of scoped chrome/component rules. Never fork component markup per theme.
- Exceptions that stay dark in both themes: code blocks (`--code-bg`).
- Both themes are contrast-audited: no text below 3:1 against its composited background.

---

## 5. Component inventory

### Components (base)
| Component | Classes | Notes |
|---|---|---|
| Buttons | `.btn` + `.btn-brand/ghost/err/warn/ok/accent`, `.btn-sm/.btn-lg` | Contextual color; 13/700; radius `--r-md` |
| Tags & badges | `.tag` + `tag-ok/warn/err/info/teal/ai/accent/neutral`, `.signal-badge` | Uppercase 700; semantic color + border tint |
| Chips & filters | `.chip` (`default/active/brand/ok/warn/err`), `.afs` strip | Active = accent |
| Dropdown | `.v2-dropdown` + `-btn`/`-panel`/`-option`, `.dd-label-text` | **The only select control.** Custom listbox: full keyboard model, typeahead, focus return, `aria-haspopup="listbox"` / `role="listbox"` / `aria-selected`. Never use a native `<select>`, and never rebuild this pattern by hand |
| Cards | `.card`, `.bcard`, `.narrative-card`, `.finding` | One `.tier-primary` per view |
| Form inputs | `.input`, `.field`, masked API-key input | Focus = brand; mask secrets |
| Feeds, donut, score ring, progress bars, chart primitives, annotations | see doc | Chart header = title + controls + stats + legend |
| Identity | `.avatar`, `.user-pill` | Avatar gradient = human; `--ai` gradient = AI actor |
| Overlays | `.modal-backdrop`/`.modal`, `.tooltip-wrap`/`.tooltip` | Destructive modals need confirmation |
| Empty & loading | `.skeleton`, `.empty-state`, spinner | Every surface handles loading / empty / error |

### Core UI
Tabs `.ds-tabs/.ds-tab` · Segmented `.seg/.seg-btn` · Button group `.btn-group` + `.icon-btn` · Menu `.menu-anchor/.menu/.menu-item` · Switch `.ds-switch` · Checkbox/radio `.ds-choice` · Slider `.ds-range` · Progress `.ds-progress` (+ `.ok/.warn/.err`) · Steps `.steps/.step` (done/active/pending) · Accordion `.acc` (`<details>`) · Breadcrumbs `.crumbs` · Pagination `.pager` · Divider `.ds-divider` (+ `.labeled`) · Banners `.banner.info/ok/warn/err` · Data table `.dtable` · Toolbar `.toolbar` · Split button `.split-btn` · Tree `.tree` (`<details>`) · Command palette `.cmdk` · Settings row `.settings-list/.settings-row` · Links `.link` (`inline/muted`)

### Data Display
Stat card `.stat-card` (semantic `.stat-delta.up/.down`) · List group `.list-group/.list-row` · Description list `.desc-list` (`<dl>`) · Timeline `.timeline/.tl-item` (semantic dots) · Avatar group `.avatar-group/.av` · Rating `.rating/.star.on` · Status & badges `.status-pill/.status-dot` (`online/busy/away/offline`, `.pulse`), `.count-badge` · Kbd `.ds-kbd` · Sparkline `.sparkline` · Gauge (SVG arc) · Progress circle `.pcircle` · Notification `.notif-list/.notif(.unread)` · Comment thread `.comment/.comment-replies` · Profile card `.profile-card`

### Feedback & Overlays
Drawer `.drawer-stage(.open)/.drawer-panel` · Popover `.pop(.open)/.pop-bubble` · Confirmation (popconfirm, `.pop-actions`) · Inline note `.inline-note(.ok/.warn)` · Coach mark `.coach-anchor/.coach-dot/.coach-card` · Loading overlay `.loading-stage/.loading-overlay/.loading-panel` · Error state `.error-state` + `.offline-bar` · Error pages `.error-page/.error-code` (404/500) · Type-to-confirm (modal + gated destructive button)

### Forms & Inputs
Field & states `.ds-field/.field-input` (`.is-error/.is-success` + `.field-help`) · Select → use `.v2-dropdown` (+ `.roster-dd` full-width, `.is-error`); label it with `aria-labelledby` and add `input[type=hidden]` to post a value · Search `.search-field` · Textarea `.ds-textarea` (+ `.is-error`) · Date picker `.cal` (today outlined, selected accent) · Radio cards `.radio-cards/.radio-card` (`:has()`) · Stepper `.stepper` · File upload `.uploader` · Tag input `.tag-input/.tag-token` (+ `.is-error`) · Password `.pw-wrap/.pw-eye/.pw-meter` (weak/mid/good) · OTP `.otp` (+ `.is-error`) · Time picker `.time-picker/.time-panel/.time-opt` · Input group `.input-group/.ig-addon` · Copy field `.copy-field` · Dual range `.drange` · Upload progress `.upload-list/.upload-item` (uploading/done/error) · Error summary `.form-summary` (`role="alert"`, links to fields)

### AI Components
| Component | Classes | Notes |
|---|---|---|
| Thinking indicator | `.ai-thinking` + `.stream-cursor` | Animated dots; blinking cursor while streaming |
| Reasoning disclosure | `.reasoning` | "Thought for Ns", `<details>` |
| Response actions | `.ai-actions` | Copy / regenerate / thumbs (selected = `--ok`) |
| Citations & sources | `.cite`, `.source-list/.source-item` | Inline `[n]` chips → sources footer |
| Agent steps | `.agent-steps/.agent-step(.done/.running/.pending)` | Live tool-call trace with timings |
| Suggestion review | `.ai-suggestion` (`del`/`ins` diff) | **Accept / Reject — AI never applies silently** |
| Context chips | `.ctx-chips/.ctx-chip` | Files/pages/selection visible to prompt, removable |
| Model picker | `.model-picker` | `--ai` gradient dot + capability tag |
| Voice input | `.voice-btn(.recording)/.voice-wave/.voice-timer` | Idle vs recording waveform |
| Inline AI menu | `.ai-menu` | Selection toolbar: Ask AiMY / Improve / Shorten / Translate |
| Usage & disclaimer | `.usage-pill`, `.ai-disclaimer` | Quota + "AiMY can make mistakes" |

### AiMY Canvas (shared chat shell)
Float input bar `.aimy-float-bar/-input/-send` (thinking state) · Filter tray `.filter-tray/.filter-chip` · Canvas overlay `.aimy-overlay(.open)` · Chat messages `.chat-msg.user/.aimy` + `.msg-bubble` · AiMY toast `.aimy-toast` · AiMY badge `.aimy-badge`. Follows the theme (dark glass in dark, light glass in light). User bubble = accent tint; AiMY bubble = card surface.

### AiMY Doctrine Primitives

Components required by the **Knowledge-to-Action Doctrine**. These are not optional garnish — the doctrine's review gate fails a surface that omits them (see §9).

| Component | Classes | Anchor | Doctrine rule |
|---|---|---|---|
| **Work state** | `.work-state` + `.ws-detected/-recommended/-drafted/-staged/-completed/-failed`, `.ws-dot`; pipeline `.ws-track/.ws-step(.is-past/.is-current)/.ws-sep` | `#work-state` | §2.3 — a **required field** on every surfaced item. Canonical value lives on `data-work-state`; `handled`/`blocked` are display aliases for `completed`/`failed` only |
| **Confidence badge** | `.conf-badge` + `.conf-high/-medium/-low`, `.conf-meter`, `.conf-val` | `#sc-conf-badge` | §5.7, Level 5 — show where confidence changes interpretation. Medium and low must also state *what limits them* |
| **Briefing card (extended)** | `.bcard-ack-row`, `.bcard-ack-btn(.is-acked)`, `.bcard-dismiss-picker(.open)`, `.bcard-dismiss-reason` | `#bcard-extended` | §5.9 — every item is dismissible with a captured reason; reversible dismissals offer Undo |
| **Entry modes** | `.entry-action` + `.em-direct/-investigate/-prompt/-review`, `.em-ico`; spec tag `.entry-mode-tag` | `#entry-modes` | §3 — classification is **mandatory and explicit** at design time. An unclassified action fails review |
| **Memory panel** | `.memory-panel`, `.mem-head/.mem-age/.mem-thread/.mem-line/.mem-who/.mem-what/.mem-foot` | `#sc-memory-panel` | §4 continuity — shows what is carried forward and lets the user drop it |
| **Governance change request** | `.gov-cr-card`, `.gov-cr-head/-title/-diff/-current/-proposed/-label/-val/-arrow/-rationale/-blast/-actions` | `#kpihub-cr-card` | §3.1 rung 3 — governed config changes get a diff, a rationale, a blast radius, and an audit note |
| **Decision zone** | `.decision-zone`, `.dz-prompt/.dz-consequence/.dz-actions/.dz-spacer/.dz-meta` | `#disputes-decision` | §3 — **Accept · Edit · Reject**. Edit is not optional |
| **Audit trail** | `.audit-trail`, `.audit-entry(.is-ok/.is-warn/.is-err/.is-ai)`, `.audit-ico/-main/-action/-actor/-who/-side/-time`, `.audit-revert`, `.audit-irreversible` | `#disputes-audit` | Level 6 — every entry names actor, action, time, and reversibility. AiMY's own actions are never disguised as the user's |
| **Modal + wizard** | `.modal` + `.steps/.step(.done/.active)` + carried `.ctx-chips` | `#disputes-modal` | §7.2 — the structured destination. The canvas does not replace workflows that need ordered inputs or a durable record |
| **AI unavailable** | `.ai-unavailable(.is-degraded)`, `.aiu-mark/-title/-body/-fallback/-note` | `#ai-unavailable` | §6.7, Level 7 — a designed state. Must say **what still works** and never lose staged work to an outage |
| **Confirmation ladder** | documentation table (binds rungs to existing components) | `#confirmation-ladder` | §3.1 — confirmation is proportional to consequence; the ladder runs one way only |

### Knowledge v2 Primitives

Built for **AiMY Knowledge v2** (`AiMY_Knowledge_v2_Design_Direction.md`), but none of them are Knowledge-specific — trust state in particular is a shared primitive precisely because it has to render inside other agents' surfaces.

| Component | Classes | Anchor | Requirement |
|---|---|---|---|
| **Trust state** | `.trust-state` + `.ts-verified/-due/-expired/-unverified/-superseded`, `.is-excluded`, `data-trust-state`; `.trust-line` | `#trust-state` | Knowledge §6.2 (D1) — required on every knowledge object. **A second axis, independent of work state**: an object can be `drafted` and `expired` at once. Uses semantic tokens only, **never `--accent`**, so it reads identically when cited inside a re-themed host surface |
| **Answer trust disclosure** | `.trust-disclosure(.has-exclusion)`, `.td-row(.is-ok/.is-warn/.is-err)`, `.td-text`, `.td-action` | `#trust-disclosure` | Knowledge §7.4 — every answer states its grounding. The exclusion case must never be silent, or a governance gap is indistinguishable from a corpus gap |
| **Citation preview** | `.cite-wrap`, `.cite-preview(.is-open)`, `.cp-head/-title/-passage/-foot/-src`, `.cite-action(.is-flag/.is-flagged)`, `.cite.is-flagged/.is-excluded` | `#cite-preview` | Knowledge §7.3, §7.5 (D2) — verification rung 3, the one carrying the most traffic. Opens on hover **and** `:focus-within`; feedback is captured **per citation**, not per answer |
| **Set-scope operations** | `.set-scope-bar`, `.ss-count/-num/-scope/-actions/-clear`, `.ss-preview`, `.ss-effect(.is-ok/.is-warn/.is-skip)` | `#set-scope` | Knowledge §4 (D3) — bulk work over a filtered collection. The scope statement and the skip line are both mandatory: a bulk op that silently no-ops on part of its selection reports success the user has no reason to distrust |
| **Aggregate briefing card** | `.bcard.is-aggregate`, `.agg-summary/-stat`, `.agg-list/-row/-label/-val/-bar/-more` | `#bcard-aggregate` | Knowledge §10.3 blocks 3 and 7 (D4) — a briefing item whose subject is a cluster, not a record. `.agg-more` is required when the list is truncated, or a broad problem reads as a narrow one |
| **Type cards** | `.type-card(.is-compact)`, `.tc-head/-type/-title/-summary/-body/-fields/-list(.is-negative)/-quote/-tags/-gov/-action`, `.tc-approval(.is-approved/.is-pending/.is-internal)` | `#type-cards` | Knowledge §6.3 (G1) — eight templates over one **fixed governance row**. Type by icon + label, never colour. `.is-compact` is the embedded form required by §8.1 |
| **Document viewer** | `.doc-view`, `.dv-head/-meta/-title/-gov/-gov-item/-notice/-body/-rel/-rel-item/-actions` | `#doc-view` | Knowledge §6.4 (G2) — trust state **above the body** in a fixed position. Carries the relationship set (related · superseded-by · contradicts) named in §6.1 but absent from the library |
| **Version history & restore** | `.ver-list/.ver-item(.is-current/.is-ai)`, `.ver-mark/-label/-author/-time/-tag`, `.ver-compare/.vc-*`, `.ver-restore/.vr-effect` | `#version-history` | Knowledge §6.5 (G3) — AI edits are **ordinary versions with an AI author**, never a parallel history. Restore is a commit surface stating its effect, and is additive |

---

## 6. States

Every interactive component documents its states statically (for Figma capture) via helper classes that mirror the real pseudo-states:

- `.is-hover` / `.is-active` / `.is-focus` — mirrors `:hover` / `:active` / `:focus-visible`
- `.open` / `.visible` / `.selected` / `.is-open` — forced-open overlays
- Coverage: buttons (5 states), inputs (default/focus/error/success/disabled), selection controls, nav/tabs/chips, all overlays open (menu, popover, confirm, tooltip, drawer, modal), row components (tree/notification/palette/time), error variants (select, textarea, tag input, OTP), strength meter, upload statuses.

---

## 7. Accessibility

- WCAG 2.1 AA target; both themes audited to ≥3:1 for all text (≥4.5:1 for body).
- Focus: `:focus-visible` only, 2px `--brand` outline, 2px offset. Never remove without replacement; never use the accent for focus.
- Native elements first: `<details>` accordions/trees, native checkbox/radio/range where possible. **Select is the deliberate exception** — `.v2-dropdown` is a custom listbox chosen for cross-platform visual consistency, and it therefore carries its own keyboard model, focus management and ARIA (§10.3).
- `prefers-reduced-motion: reduce` disables shimmer, pulses, spinners, lifts.
- Error summaries use `role="alert"` and receive focus on submit; every error state pairs color with text.
- Mask sensitive fields (API keys, passwords) by default.

---

## 8. Files

| File | Purpose |
|---|---|
| `index.html` | The design system — tokens, components, states, themes, live demos |
| `design-system.md` | This reference |
| `00_AiMY_Knowledge_to_Action_Doctrine.md` | Interaction doctrine — owns *behaviour*, not tokens or component anatomy |

> **Naming note.** The doctrine refers to the component library as **`design-doc.html`**. In this repository that file is **`index.html`** — the two names denote the same artefact. Every `design-doc.html` anchor cited in the doctrine resolves against `index.html`.

---

## 9. Doctrine binding

The doctrine's §0 binding rule: *"Where this document names a component, that name must resolve to an entry in `design-doc.html`."* Every §6.2 responsibility now resolves:

| Doctrine responsibility | Primitive | Anchor |
|---|---|---|
| Operational metrics and status | Cards, Badges & Status, Chart Primitives, AiMY Badge | `#cards` · `#badges` · `#chart-primitives` · `#canvas-badge` |
| Briefing item, full anatomy | Briefing Card — Extended | `#bcard-extended` |
| AI interpretation within a briefing | AiMY Insight Panel · Chart Annotations · Memory Panel | `#ai-insight-panel` · `#anno-card` · `#sc-memory-panel` |
| Prioritised recommendations | AiMY Action Chips | `#v2-chip` |
| Ambient conversational entry | Float Input Bar · Filter Tray | `#canvas-float` · `#canvas-filter-tray` |
| Explain what AiMY detected | Context Zone | `#context-zone` |
| Hold the active conversation | Canvas Overlay · Chat Messages | `#canvas-overlay` · `#canvas-messages` |
| Govern consequential changes | Governance Change Request · Decision Zone · Audit Trail · Modal + Wizard | `#kpihub-cr-card` · `#disputes-decision` · `#disputes-audit` · `#disputes-modal` |
| Confidence disclosure | Confidence Badge | `#sc-conf-badge` |
| Reversible / completed work | AiMY Toast with `.aimy-toast-undo` | `#canvas-toast` |
| Empty, loading, unavailable | Empty & Loading States · AI Unavailable | `#states` · `#ai-unavailable` |
| Declare AI work state (§2.3) | Work State | `#work-state` |
| Classify actions (§3) | Entry Modes | `#entry-modes` |
| Proportional confirmation (§3.1) | Confirmation Ladder | `#confirmation-ladder` |

---

## 10. Doctrine gap register

Discrepancies between the doctrine text and the implemented library, recorded for the doctrine owner.

### 10.1 §6.3 gaps that were already closed

The doctrine listed five primitives as "missing — do not improvise". All five existed in the library at the time of the audit; the doctrine was stale, not the implementation.

| Cited as missing | Actually implemented at | Classes |
|---|---|---|
| Suggestion Review | `#ai-suggestion` | `.ai-suggestion` with `del`/`ins` diff, Accept / Reject / Edit |
| Type-to-Confirm | `#confirm-destructive` | Modal + gated destructive button |
| Context Chips | `#context-chips` | `.ctx-chips` / `.ctx-chip`, removable |
| Stat Card | `#stat-card` | `.stat-card`, `.stat-delta.up/.down` |
| Response Actions | `#ai-actions` | Copy / regenerate / thumbs |

**Note on Suggestion Review vs. Governance Change Request.** They are not duplicates. `.ai-suggestion` handles message-level edits; `.gov-cr-card` handles governed configuration, where a rationale, a blast radius and an audit note are required. Use the lighter one unless the change touches governed config.

### 10.2 `--d200` — the doctrine's claim is incorrect

The doctrine's "Open scale flag" states `--d200` is undefined in the dark scale and that `fill: var(--d200)` silently falls back to black, and §11 accordingly bans the token. **This is false.** `--d200` is defined in both themes and is a documented step of the neutral ramp (§1):

| | Value | Defined at |
|---|---|---|
| Dark | `#c8d2dc` | `index.html:32` |
| Light | `#2a3540` | `index.html:189` |

`--d200` is safe to use. The ban should be lifted.

### 10.3 `<select>` — resolved in favour of the custom dropdown

The doctrine's Level 3 said *"No native `<select>` — use `.v2-dropdown`"*, while this system's accessibility policy (§7) said *native elements first* and shipped `.ds-select`, a styled native select. Two components claimed the same job.

**Resolved: `.v2-dropdown` is the system's only select control.** `.ds-select` and every native `<select>` have been removed; there are now zero `<select>` elements in the library.

The audit also found that `.v2-dropdown` was a **phantom component** — its anatomy table and code sample documented `.v2-dropdown-btn`, `.v2-dropdown-panel`, `.v2-dropdown-option` and `.dd-label-text`, but none of those classes had CSS and the control had no behaviour at all; the specimen was an inline-styled mockup. The doctrine's Level 3 rule pointed at something that did not exist. It has now been built:

| Supplied | Detail |
|---|---|
| Styling | Classes match the previously documented anatomy exactly; the original specimen's visual is unchanged |
| States | default · hover · focus-visible · open · selected · keyboard-active · disabled · error · full-width (`.roster-dd`) |
| Keyboard | ↓/↑ open and move · Enter/Space select · Home/End · Esc closes and returns focus · Tab closes · letter typeahead (500ms buffer) |
| ARIA | `aria-haspopup="listbox"` + `aria-expanded` on the trigger; `role="listbox"` + `aria-activedescendant` on the panel; `role="option"` + `aria-selected` on rows. Missing attributes are normalised at load |
| Forms | Optional `input[type=hidden]` receives the value and fires `change`; the wrapper emits a bubbling `dd:change` |
| Light mode | Panel, hovers and selection tints all flip |

**The tradeoff is now explicit rather than implicit.** A custom listbox gives one appearance on every platform at the cost of re-implementing what the browser used to provide — keyboard, focus, and screen-reader semantics. That work lives in this one component, which is exactly why products must use it rather than rebuild the pattern: a hand-rolled copy will look right and be unusable without a mouse.

### 10.4 Gate violations found and fixed in the library

Found while closing the gaps above; all were pre-existing.

| Violation | Count | Gate | Fix |
|---|---|---|---|
| `prefers-reduced-motion` documented as a code sample but **never implemented** | — | L4 + L7 | Real `@media (prefers-reduced-motion: reduce)` block added. Motion that carries meaning (spinners, the toast timer) is frozen rather than removed, so the signal survives |
| `transition: all` | 12 | L4 | Replaced with explicit property lists |
| `onclick=""` string attributes | 116 | L4 | Converted to `data-*` attributes with a single delegated listener. Beyond tidiness: inline handlers are blocked by a strict CSP, so markup copied from this page could not previously ship into a CSP-enforcing product |
| Toast progress bar animating `width` | 1 | L4 | Now `transform: scaleX()` with `transform-origin: left` |
| `onmouseover`/`onmouseout` inline style writes | 3 | L4 | Replaced with CSS `:hover` (`.icon-btn`, `.lift-demo`) |
| Native `<select>` elements | 7 | L3 | All migrated to `.v2-dropdown`; `.ds-select` retired. Zero `<select>` elements remain |
| Duplicated `<!-- END MAIN -->` comment | 1 | — | Removed |
| Light-mode neutral fill flattening semantic tints on `.conf-badge` and `.audit-ico` | 2 | L1 | Light override scoped with `:not()` so level and status modifiers keep their tint |
| `.progress-bar-fill` animating `width` at **600ms** | 1 | L4 | Now `transform: scaleX(var(--fill))` with `transform-origin: left`, 300ms. **Breaking change** — set the level with `--fill` (0–1), not `style="width:%"`. The five in-page usages and the code sample were migrated |
| `.score-ring-fill` transitioning `stroke-dashoffset` at **800ms** | 1 | L4 | Reduced to `--t-slow` (300ms). `stroke-dashoffset` is retained — it is the only way to draw an SVG arc — but the ceiling still applies |
| `.ds-switch .thumb` animating `left` | 1 | L4 | Now `transform: translateX()`; `left` relayouts, `transform` composites |
| Inline `onkeydown=""` on the canvas textarea | 1 | L4 | Missed by the first sweep, which matched `onclick` only. Now `data-submit-on-enter` + a delegated `keydown` listener. **Zero inline event handlers of any kind remain** |

### 10.5 Still open

- **Canonical 7-level framework reconciliation** — the doctrine's §8 notes its gate is codified locally and should be reconciled with any canonical FlairsTech definition.

### 10.6 AiMY Knowledge v2 — open dependency register

Against `AiMY_Knowledge_v2_Design_Direction.md` §12. Every component binding in that document's §9.4 resolved on audit **except trust state**, which the document itself flagged.

| Dep | Status | Resolution |
|---|---|---|
| **D1 — Trust state primitive**<br>*blocks the card design and the briefing* | ✅ **Built** | `#trust-state` — five values, `data-trust-state`, `.is-excluded` for the retrieval consequence. Built as a **shared** primitive with semantic tokens only and no `--accent` dependency, per Knowledge §1.1/§8.1. The §7.4 answer-level disclosure ships alongside it at `#trust-disclosure` — it was an unnumbered requirement with no component |
| **D2 — Citation hover preview + per-citation feedback**<br>*blocks the answer surface* | ✅ **Built** | `#cite-preview` — the intermediate verification rung. Rungs 1 (`.cite`) and 2 (`.source-list`) already existed; rung 4 is navigation. Preview opens on hover **and** focus, and per-citation flagging routes into the correction loop rather than terminating in a rating |
| **D3 — Set-scope AI operations**<br>*blocks Library bulk curation* | ✅ **Built** | `#set-scope` — selection bar with a mandatory scope statement, effect preview including skips, and explicit binding to the confirmation ladder rungs |
| **D4 — Coverage-gap block shape** | ✅ **Built** | `#bcard-aggregate` — resolved as a `.bcard` variant, as the document anticipated. Same meta row, conclusion, action row and ack/dismiss row; only the evidence zone changes |
| **D5 — Ownership and usage data granularity** | ⬜ **Not a design-system dependency** | Platform data availability. The design system supplies the blocks; whether composition can rank them per user is a data question. If it degrades to entitlement-only, no component changes — the briefing simply renders a shorter set, and `#states` covers the honest empty case |
| **D6 — Permission-aware retrieval** | ⬜ **Not a design-system dependency** | Retrieval-layer capability. It does carry one design obligation: where the guarantee does not hold, the limitation must be stated on-screen. Bind that to `.banner.warn` or `.inline-note.warn`, and use `#trust-disclosure` on answers — both exist |

**Not blockers, but worth stating:** the direction document's §7.1 (one input routed on intent) and §7.2 (scope before query) need no new components — `.search-field`, `.cmdk`, `.aimy-float-bar` and `.filter-tray`/`.filter-chip` cover them. §8's embedded-service contract is a *constraint on usage*, not a component: it is satisfied by the answer-surface components carrying no shell dependency, which is why trust state was built accent-free.

### 10.7 Knowledge v2 — §12.1 component gaps

Second audit, against the revised direction document. Its three declared gaps were confirmed absent and are now built. Its claim that *"everything else resolves today"* was checked item by item and holds, with the two exceptions noted below.

| Gap | Status | Resolution |
|---|---|---|
| **G1 — Eight type card templates**<br>*blocks the workbench, the viewer, and embedded citations* | ✅ **Built** | `#type-cards`. Article · Ticket · ICP · Campaign · Marketing Asset · Success Story · Blog · Web Page, each with a distinct body zone over an identical governance row. `.is-compact` supplies the §8.1 embedded form — title, type, trust, one action |
| **G2 — Document viewer shell**<br>*blocks the viewer* | ✅ **Built** | `#doc-view`. Composes existing primitives into a reading shell: trust in a fixed position above the body, constant governance chrome, type-appropriate body slot, and exclusion / supersession notices that state the consequence **and** the route out of it |
| **G3 — Version comparison and restore**<br>*blocks the editor* | ✅ **Built** | `#version-history`. Single history with AI-authored versions marked rather than segregated, `del`/`ins` comparison reusing the suggestion-review diff shape, and restore as a commit surface stating rollback, downstream effect, and that history is preserved |

**Found in the audit but not listed as a gap.** The object anatomy in §6.1 names a **relationships** set — related objects, superseded-by, contradicts — with no component anywhere in the library, and §6.4 depends on it ("a superseded object resolves to its successor with the relationship stated"). Built as part of G2: `.dv-rel` / `.dv-rel-item`, with `.is-contradiction` reading as a finding rather than a neighbour, and `.is-successor` as the way forward.

**Judgement calls, flagged rather than decided:**

- **Approval state is kept out of trust state.** §12.2 asks whether approval becomes a sixth trust value or stays a separate field. `.tc-approval` is therefore built *outside* `.trust-state` — the conservative choice, since folding it in now would pre-empt the ruling and change a primitive that ships into other agents' surfaces. If the ruling makes it a trust value, the field folds in and the eight templates are unaffected.
- **Retrieval results (§7.1) and displacement notices (§10.3) have no dedicated component.** Both are compositions of existing parts — `.list-group` or `.cmdk` for a ranked result set, `.inline-note` / `.banner` for a displacement statement. Neither was declared a gap and neither needs a new primitive, but neither has a worked reference either. Raise one if the composition proves non-obvious in build.

### 10.8 Closed since the audit

- **`--qa-accent`** — withdrawn. Accents are **global**: one `--accent` token re-themed per product (§1). There is no QA-specific accent token, so there was nothing to swap and no Talent collision to resolve. The doctrine's open flag has been retracted.
- **`.ds-select` vs `.v2-dropdown`** — resolved in favour of the custom dropdown; see §10.3.
