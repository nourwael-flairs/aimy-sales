# AiMY — Knowledge-to-Action Doctrine

**The canonical interaction and design direction for every AiMY product.**

| | |
|---|---|
| **Status** | Locked interaction principle — implementation specification in progress |
| **Owner** | Ahmed Mahfouz |
| **Scope** | All AiMY agents — new builds and revamps |
| **Supersedes** | Per-product interaction decisions that conflict with this document |
| **Source** | *AiMY — Briefing-to-Canvas UX Specification* (Confluence), locked 2026-07-24 |
| **Last updated** | July 2026 — §6.2, §6.3, §8 L1/L3, §11 and §15 revised 2026-07-28 following the design-system gap audit |
| **Classification** | Confidential — Internal Use |

---

## 0. How to use this file

This document has three jobs, and they are deliberately stacked:

1. **Specification of record.** The Briefing-to-Canvas interaction model, ported faithfully. Sections 2–6 are the locked principle. They are not open for reinterpretation per product.
2. **Ecosystem doctrine.** The model generalised beyond AiMY QA v2, with adoption rules for any agent — Connect, Talent, Finance, Knowledge, Sales, and anything not yet built. Sections 7–8.
3. **Enforceable rules.** Section 11 is written to be read by an implementing agent (human or AI) at the start of every AiMY design or build task. It is a checklist, not prose.

**Reading order for a new product:** §1 → §7 → §2 → §11. **Reading order for a revamp:** §11 → §9 → §3.

**Dependencies.** This document owns *interaction doctrine*. It does not own visual tokens, component specs, or state definitions. Those live in:

- `design-system.md` — tokens, typography, brand, light/dark behaviour
- `design-doc.html` — the implemented component library and the source of truth for class names, anatomy, and states

> **Naming.** In the design-system repository the component library file is named **`index.html`**. `design-doc.html` and `index.html` denote the same artefact; every anchor cited below resolves against it.

Where this document names a component, that name **must** resolve to an entry in `design-doc.html`. If it does not, it is listed in §6.3 as a gap and must not be built ad hoc.

---

## 1. Strategy — Knowledge to Action

**AiMY is not an analytics product with a chatbot attached. It is an operations product that reasons.**

The strategic commitment across the ecosystem is single-sentence:

> **Every piece of knowledge AiMY surfaces must be paired with a contextual action that advances toward resolution.**

This has four hard consequences that govern every screen in every product:

### 1.1 No lonely insights

An observation without a next step is a cost, not a feature. If AiMY can detect it, AiMY must have an opinion about what to do about it. A metric without an interpretation is merely a number wearing office clothes.

### 1.2 No dead ends

Every finding, pattern, exception, and recommendation must terminate in one of exactly four places:
- a completed action,
- a staged action awaiting review,
- a structured destination workflow, or
- an explicit, user-visible reason why no action is available.

"Learn more" is not a destination. "Open" is not an action.

### 1.3 Closed loops

Action state persists until the issue is resolved. AiMY must always be able to answer *what did I do about this, and what happened next.* This is why work state (§2.3) is a first-class field, not a badge style.

### 1.4 Knowledge-to-Action must not invert

The failure mode is routing **write operations** through free-text conversation while pushing **knowledge** into rigid forms. That is the inversion, and it is banned.

- Knowledge, interpretation, investigation, and explanation → **conversational canvas.**
- Writes with operational consequence (activate, approve, deploy, reassign, override, publish) → **structured commit surface** with explicit confirmation.

---

## 2. The Interaction Model — Briefing to Canvas

**Briefing-to-Canvas is the default native AiMY interaction model.** The product first gives the user a concise, role-specific operational briefing, then carries the selected issue, recommendation, or question into a conversational canvas for deeper work.

### 2.1 The problem it solves

Users are attracted to chat, but an empty chat box makes them invent both the problem and the prompt. Conventional dashboards solve orientation but accumulate charts, tables, and drill-down pages without creating deeper engagement.

Briefing-to-Canvas divides the work cleanly:

- the **briefing surface** orients, prioritises, and supports quick action;
- the **context handoff** preserves what the user selected and why it matters;
- the **canvas** handles investigation, judgement, explanation, and multi-step action;
- the **return path** restores the user's place and preserves conversational continuity.

### 2.2 The four stages

| Stage | User experience | System obligation |
|---|---|---|
| **1 — Operational briefing** | The user sees what changed, why it matters, what AiMY has already done, and what needs attention next. | Prioritise by role, urgency, impact, and confidence; expose evidence and action state in plain language. |
| **2 — Selection and handoff** | The user selects an insight, recommendation, chart question, record, or exception. | Package the selected context and choose the correct entry mode: direct action, prepared prompt, automatic investigation, or reviewed action. |
| **3 — Conversational canvas** | A large overlay opens over the current surface and begins from the selected context. | Show what the conversation is based on, retain evidence and scope, support follow-up questions, and expose relevant actions or destination links. |
| **4 — Return and continuity** | Closing the canvas returns the user to the same product state. Re-entry continues the thread when appropriate. | Preserve page position, filters, selected scope, conversation history, and the distinction between completed and pending actions. |

### 2.3 Work state — the six values

AiMY must always declare which of these applies to a surfaced item. This is a required field on every briefing item, not a decoration.

`detected` → `recommended` → `drafted` → `staged` → `completed` | `failed`

`blocked` and `handled` are permitted display labels for `failed` and `completed` respectively where domain language demands it, but the underlying state must be one of the six.

**Rule:** AiMY must distinguish between *detecting, recommending, drafting, staging,* and *completing* work. Collapsing these is a preservation-of-agency violation.

---

## 3. Entry Modes — routing signal to useful action

**The same click must not always produce the same behaviour.** The canvas opens for depth, not for every click.

Routing is decided by **intent + risk**, evaluated against context, permissions, and confidence.

| Mode | When | Behaviour | Returns to |
|---|---|---|---|
| **Direct action** | Obvious, low-risk, one step | Completes **in place**. Do not open the canvas merely because it exists. Must offer Undo. | Same state |
| **Automatic investigation** | Selected item implies a clear, read-only question | Canvas opens and the investigation begins immediately | Same state, thread preserved |
| **Prepared prompt** | Intent is broader or interpretive | Contextual question is composed and staged; user sends it in one step | Same state, thread preserved |
| **Reviewed action** | AiMY proposes a change with operational consequence | Proposed change is shown with **Accept · Edit · Reject**. Never silently applied. | Same state, thread preserved |

**Classification is mandatory and explicit.** Every interactive element on a briefing surface must be deliberately assigned one of these four modes at design time. An unclassified action is an incomplete design and fails review.

**Anti-pattern:** defaulting everything to "open the canvas." That is the AI-native equivalent of routing every click to a detail page.

### 3.1 Confirmation ladder

| Consequence | Confirmation |
|---|---|
| Reversible, single-entity, low blast radius | None — act, then toast with Undo |
| Reversible, multi-entity or cross-team | Inline confirm in the action surface |
| Irreversible, or changes governed configuration | Reviewed action with explicit diff + accept |
| Destructive, or affects scoring/compliance/permissions | Reviewed action + typed confirmation + audit entry |

> The typed-confirmation primitive does not currently exist in `design-doc.html`. See §6.3.

---

## 4. Context Handoff Contract

Every canvas entry must carry enough context that **the user does not have to repeat the prompt.** Context is passed, never reconstructed.

The envelope schema is owned by the Generative UI platform layer and is not yet finalised, but it must represent all seven groups:

| Context group | Required meaning |
|---|---|
| **Origin** | Agent, source surface, selected item identifier and type, and the referring UI control. |
| **User scope** | User role, permissions, organisation or client scope, and any relevant team or ownership boundary. |
| **Analytical scope** | Active filters, time range, comparison period, selected entities, metric definition, current value, target, and severity. |
| **Evidence** | Supporting records, source links, confidence, detected alternatives, and the plain-language reason AiMY surfaced the item. |
| **Work state** | Whether AiMY detected, recommended, drafted, staged, completed, or failed an action. |
| **Next step** | Prompt seed, allowed actions, confirmation level, and any structured destination such as a review queue. |
| **Continuity** | Conversation identifier, prior relevant thread, and whether a memory cue should be shown. |

**Design obligation:** the canvas must *show its basis*. The user must be able to see, without asking, which item, filters, evidence, and confidence the conversation is standing on.

**Known failure to guard against:** during the QA v2 review, a Quality Score question received the previous SLA answer. Visual context handoff existed; **thread binding did not.** Any implementation that renders context cues without binding them to the request is not compliant.

---

## 5. Briefing Surface Requirements

The briefing surface is the landing surface of every AiMY agent. It earns the user's attention before chat asks for it.

1. **Lead with a small, prioritised set of insights** rather than an inventory of all available data.
2. **Stay within budget.** Roughly **seven to nine blocks and no more than two charts.** Anything past that is a candidate for the canvas or an existing structured workflow — not an addition to the briefing.
3. **Every new block displaces one**, or explains why the canvas cannot carry it. This is enforced at review.
4. **Plain-language statements before charts.**
5. **State both the issue and AiMY's work state** — detected, recommended, drafted, staged, handled, or blocked.
6. **Distinguish urgency, caution, and opportunity** without treating every signal as an alarm.
7. **Include evidence, confidence, scope, and time range** wherever they affect interpretation.
8. **Make the next useful step explicit.** Not "Open" or "Learn more" — "Review agents", "Investigate cause", "Approve coaching plan".
9. **Allow dismissal** of irrelevant suggestions, and allow undo of reversible dismissals.
10. **Retain structured workflows** where compliance, dense comparison, or bulk editing genuinely requires them. The canvas is a depth layer, not a crusade against tables.

---

## 6. Canvas Requirements

1. The canvas is a **non-blocking overlay inside the agent surface** — not a generic modal, not a separate destination. The product shell (sidebar, topbar) remains interactive.
2. The underlying operational state remains visible as **blurred context**, reinforcing where the conversation came from.
3. The canvas **shows its basis**: selected item, filters, evidence, confidence, and relevant prior thread.
4. **Suggested questions are contextual** and disappear once the conversation begins.
5. Responses **may link into a dedicated workflow** when structured review is the correct next step.
6. **Escape or the close control restores the previous surface state** exactly.
7. **Loading, error, empty, and AI-unavailable are first-class states**, designed — not afterthoughts.
8. **AI-proposed operational changes use a reviewable suggestion component and explicit confirmation.** Permission checks and audit logging remain server-side responsibilities.
9. **The conversation must produce or advance work**, not merely generate explanatory text.

### 6.1 Dependency layers

The design system defines three layers. **Products consume the layers below them, never the reverse.**

```
tokens  →  components  →  AiMY Canvas
```

`design-system.md` and `design-doc.html` remain the implementation source of truth for visual tokens, states, accessibility, and component behaviour. Exact motion, token, spacing, and component specifications belong there and must not be copied into product implementations.

### 6.2 Responsibility → primitive binding

Each doctrine responsibility maps to named entries in `design-doc.html`. **Use these. Do not create parallel components.**

| Doctrine responsibility | Design-system primitive | `design-doc.html` anchor |
|---|---|---|
| Operational metrics and status | Cards, Badges & Status, Chart Primitives, AiMY Badge | `#cards` · `#badges` · `#chart-primitives` · `#canvas-badge` |
| Briefing item, full anatomy | Briefing Card (`.bcard`) — conclusion, evidence row, action zone, ack/dismiss row, expandable data panel | `#bcard-extended` |
| **Declare AI work state (§2.3)** | **Work State — `.work-state` + six `.ws-*` values, `data-work-state`; pipeline `.ws-track`** | **`#work-state`** |
| **Classify every action (§3)** | **Entry Modes — `.entry-action` + `.em-direct` / `.em-investigate` / `.em-prompt` / `.em-review`; design-time `.entry-mode-tag`** | **`#entry-modes`** |
| AI interpretation within a briefing | AiMY Insight Panel, Chart Annotations, Memory Panel | `#ai-insight-panel` · `#anno-card` · `#sc-memory-panel` |
| Prioritised recommendations | AiMY Action Chips — `urgent` / `caution` / `explore` variants | `#v2-chip` |
| Ambient conversational entry | Float Input Bar, Filter Tray | `#canvas-float` · `#canvas-filter-tray` |
| Explain what AiMY detected | Context Zone — detected state, confidence, alternatives, contextual suggestions | `#context-zone` |
| Hold the active conversation | Canvas Overlay, Chat Messages, thinking indicator (`.typing-dots`) | `#canvas-overlay` · `#canvas-messages` |
| Govern consequential changes | Governance Change Request Card — `.gov-cr-diff`, `.gov-cr-current`, `.gov-cr-proposed`, `.gov-cr-actions`; Decision Zone; Audit Trail; Modal + Wizard | `#kpihub-cr-card` · `#disputes-decision` · `#disputes-audit` · `#disputes-modal` |
| Confidence disclosure | Confidence Badge — `.conf-badge` + `.conf-high` / `.conf-medium` / `.conf-low` | `#sc-conf-badge` |
| **Proportional confirmation (§3.1)** | **Confirmation Ladder — binds each of the four rungs to its component** | **`#confirmation-ladder`** |
| Reversible / completed work | AiMY Toast with `.aimy-toast-undo` | `#canvas-toast` |
| Empty, loading, unavailable | Empty & Loading States; **AI Unavailable — `.ai-unavailable(.is-degraded)`** | `#states` · **`#ai-unavailable`** |

### 6.3 Named gaps — resolved

*Updated after the design-system audit of 2026-07-28. The five primitives previously listed here as missing all exist. The gap register in `design-system.md` §10 holds the evidence and the remaining open items.*

| Previously cited as missing | Status | Resolves to |
|---|---|---|
| **Suggestion Review** | ✅ Implemented | `#ai-suggestion` — `.ai-suggestion` with `del`/`ins` diff and Accept / Reject / Edit |
| **Type-to-Confirm** | ✅ Implemented | `#confirm-destructive` — modal + gated destructive button. The top rung of §3.1 is no longer blocked |
| **Context Chips** | ✅ Implemented | `#context-chips` — `.ctx-chips` / `.ctx-chip`, removable |
| **Stat Card** | ✅ Implemented | `#stat-card` — `.stat-card`, `.stat-delta.up/.down` |
| **Response Actions** | ✅ Implemented | `#ai-actions` — copy / regenerate / thumbs |

The audit also found eleven primitives this document *names* that the library did not implement. Those have since been built and are bound in §6.2 — most consequentially **Work State** (`#work-state`), without which §2.3 could not be satisfied at all, and **Entry Modes** (`#entry-modes`), without which §3's mandatory classification had no visual expression.

**Use the lighter component first.** Suggestion Review and the Governance Change Request Card are not duplicates: `.ai-suggestion` is for message-level edits, `.gov-cr-card` for governed configuration where a rationale, blast radius and audit note are required.

**Retracted token flag:** this section previously flagged `--qa-accent` as a QA-specific placeholder that had to be swapped before QA v2 shipped. That flag is withdrawn. **Accents are global.** The design system exposes one `--accent` token that each product re-themes; there is no per-product accent token, so there is nothing QA-specific to swap and no collision with Talent to resolve. See `design-system.md` §1.

**Retracted scale flag:** this section previously stated that `--d200` was undefined in the dark scale and fell back to black. That was incorrect. `--d200` is defined in both themes — dark `#c8d2dc`, light `#2a3540` — and is a documented step of the neutral ramp. It is safe to use. See `design-system.md` §10.2.

---

## 7. Adopting the model in a new or revamped agent

The interaction contract and components are shared. Briefings, evidence, actions, and judgement remain domain-specific. **This is not a fixed product template.**

An agent adopts Briefing-to-Canvas by supplying six things and inheriting everything else:

| The agent supplies | The platform / design system supplies |
|---|---|
| Role definitions and what each role needs to see first | Canvas runtime and overlay behaviour |
| Prioritisation logic — urgency, impact, confidence | Context handoff contract and thread continuity |
| Domain evidence and its plain-language framing | Tokens, components, states, motion, accessibility |
| Prompt seeds per item type | Tool/action rendering and observability |
| The action inventory, each classified into an entry mode | Toast, confirmation, and audit-aware destination patterns |
| Destination workflows for structured review | Light/dark and responsive behaviour |

### 7.1 Adoption sequence

1. **Define roles.** Who lands here, and what is the one thing each must not miss?
2. **Draft the briefing at budget.** Seven to nine blocks, ≤2 charts. If it doesn't fit, the surface is wrong, not the budget.
3. **Write each item as a sentence,** not a metric. What changed · why it matters · work state · next step.
4. **Inventory every action and classify it** — direct / automatic investigation / prepared prompt / reviewed action. No unclassified actions.
5. **Specify the context envelope per item type** against all seven groups in §4.
6. **Identify structured destinations.** What must stay a real workflow because of compliance, bulk edit, or dense comparison?
7. **Design the four non-happy states** — loading, error, empty, AI-unavailable.
8. **Run the 7-level review gate (§8).**

### 7.2 Boundaries and non-goals

- **Not a chat-first homepage.** The briefing earns attention before chat asks for it.
- **Does not remove operational dashboards.** It narrows their job to orientation, prioritisation, monitoring, and quick action.
- **Not permission to open the canvas for every interaction.**
- **Not a fixed template.** Shared contract, domain-specific judgement.
- **AiMY Copilot is out of scope.** Copilot is a browser-panel surface embedded in third-party helpdesks — not a right-panel variant of a native AiMY agent.
- **The canvas does not replace structured workflows** where comparison, compliance, bulk editing, or formal approval requires dedicated controls.

---

## 8. The 7-Level Design Review Gate

Every AiMY design — new screen or revamp — passes through seven ascending levels. **A level does not pass until every level beneath it passes.** Reviewing pixels before checking action integrity is wasted effort.

> **Note:** this gate is codified here from the specification's own concerns and the ecosystem audit dimensions. If a canonical seven-level definition exists elsewhere in FlairsTech documentation, reconcile and replace this section.

### Level 1 — Foundation
Tokens, colour, typography, spacing, radius, elevation.
- Every value resolves to a token. Zero off-scale hardcoded colours.
- Urbanist. Type scale respected.
- Dark mode is *designed*, not inverted. Dark is the default for new screens.
- **Fails on:** ad hoc hex values, gradient text, decorative `border-left` stripes, top-edge accent stripes.

### Level 2 — Composition
Layout, hierarchy, density, budget.
- The screen is readable in two seconds. The eye lands where it should.
- Briefing surface is within budget — 7–9 blocks, ≤2 charts — or each overage is justified item by item.
- Grid is consistent; alignment is locked.
- Reduction filter applied: can it be removed without losing meaning? Then remove it.
- **Fails on:** budget overrun without justification, visual weight disproportionate to functional importance.

### Level 3 — Component integrity
- Every element resolves to a real `design-doc.html` component. **No invented components.**
- All states specified: default, hover, focus, active, selected, disabled, loading, error.
- No native `<select>` — use `.v2-dropdown`, the system's only select control.
- Iconography is one cohesive set; AiMY mark is always `#aimy-logo-small`.
- **Fails on:** parallel one-off components, missing states, mixed icon libraries.

### Level 4 — Interaction and motion
- Transitions use explicit compositor-safe property lists. Never `transition: all`.
- `transform` and `opacity` only. 300ms ceiling. `prefers-reduced-motion` guard present.
- Bar/progress fills animate `transform: scaleX()` with `transform-origin: left`, never `width`.
- No `onclick=""` string attributes — `data-*` plus delegated listeners.
- **Fails on:** layout-thrashing animation, gratuitous motion, pulsing decorative dots.

### Level 5 — Intelligence legibility
The first AI-native level. Everything below this is craft; this is where AiMY earns trust.
- Every surfaced item states **what changed, why it matters, scope, confidence, and work state.**
- Evidence is reachable and attributable.
- Confidence and detected alternatives are exposed where they affect interpretation.
- The canvas **shows its basis** — item, filters, evidence, prior thread.
- Context arrives without user restatement; thread binding is verified, not assumed.
- **Fails on:** lonely insights, unexplained numbers, unbound threads, invisible provenance.

### Level 6 — Action integrity
- Every action is deliberately classified as direct / automatic investigation / prepared prompt / reviewed action.
- Direct actions stay direct — the canvas is not opened merely because it exists.
- Consequential changes are permission-checked, reviewable, auditable, recoverable.
- Confirmation level matches the confirmation ladder (§3.1).
- Writes are not routed through free-text. Knowledge-to-Action is not inverted.
- Every item terminates in a completed action, a staged action, a structured destination, or a stated reason none exists.
- **Fails on:** silent application of AI-proposed changes, dead-end insights, unclassified actions.

### Level 7 — Outcome and resilience
- Loading, error, empty, and AI-unavailable states are designed.
- Close and reopen preserve product state *and* conversation state.
- Keyboard, focus order, ARIA, contrast, screen-reader flow, reduced-motion verified.
- Light and dark both verified. Responsive at every supported viewport; touch targets sized.
- Instrumentation distinguishes **useful outcomes from message volume.**
- **Fails on:** undesigned failure states, lost state on return, analytics that count messages.

### 8.1 Review output format

Findings are compiled into three phases, in this order, and **nothing is implemented before sign-off**:

- **Phase 1 — Critical:** Levels 5–7 failures, plus hierarchy and usability breaks that actively hurt users.
- **Phase 2 — Refinement:** Levels 2–4 — spacing, typography, colour, alignment, component states, motion.
- **Phase 3 — Polish:** micro-interaction, transition detail, empty-state craft, subtleties.

Each finding names: the level it fails, the rule it violates, the affected surface, and an implementation note precise enough to execute without interpretation.

---

## 9. Rollout Acceptance Checklist

A surface is not shippable until every line is true.

- [ ] The landing surface provides useful orientation without requiring a prompt.
- [ ] Every surfaced item explains what happened, why it matters, scope, confidence, and work state.
- [ ] The briefing surface is within budget — roughly 7–9 blocks, no more than 2 charts — or each overage is justified item by item.
- [ ] Each action is deliberately classified as direct, automatic investigation, prepared prompt, or reviewed action.
- [ ] Canvas entry carries context without requiring user restatement.
- [ ] Closing and reopening preserve the appropriate product and conversation state.
- [ ] Consequential actions are permission-checked, reviewable, auditable, and recoverable.
- [ ] Loading, error, empty, and AI-unavailable states are designed.
- [ ] Light, dark, keyboard, focus, reduced-motion, and screen-reader behaviour are verified.
- [ ] Analytics distinguish useful outcomes from message volume.
- [ ] A new static drill-down view is added only when the canvas or an existing structured workflow is insufficient.
- [ ] Every component used resolves to `design-doc.html`. Nothing was invented.

---

## 10. Principles

The nine sentences. If the rest of this document is lost, these survive.

1. **Brief first; converse for depth.**
2. **Context is passed, not reconstructed.**
3. **Direct actions stay direct.**
4. **AI work state is explicit.**
5. **Conversation continues; the user does not restart.**
6. **Shared interaction, agent-specific judgement.**
7. **Review before consequence.**
8. **Every new block displaces one.**
9. **Accessible, theme-aware, and responsive by default.**

---

## 11. Enforceable Rules

Read this section at the start of every AiMY design or implementation task.

### Always

- Default to **dark mode** for new screens unless told otherwise.
- Resolve every component to `design-doc.html` before using it.
- Consult `design-system.md` for tokens; `design-doc.html` for component anatomy and class names.
- Classify every action into one of the four entry modes, explicitly, at design time.
- Pair every insight with a contextual next step.
- Declare work state on every surfaced item.
- Route generative content, workflow confirmation, and detail drill-through to the **AiMY canvas** — it is the universal action/peek surface.
- Use structured commit surfaces for writes with operational consequence.
- Preserve `backdrop-filter` on the canvas overlay — visual quality wins over GPU optimisation here.
- Use the `#aimy-logo-small` SVG symbol for the AiMY mark.
- Run the 7-level gate and present a numbered, phased plan. **Wait for sign-off before implementing.**

### Never

- Never invent a component that should exist in the design system. Flag it as a gap (§6.3) and escalate.
- Never open the canvas merely because it exists.
- Never silently apply an AI-proposed operational change.
- Never add a briefing block without displacing one or justifying the overage.
- Never use "Open" or "Learn more" where the real action has a name.
- Never route a write operation through free-text conversation.
- Never use `transition: all`, `onclick=""` string attributes, native `<select>`, decorative `border-left` stripes, top-edge accent stripes, gradient text, pulsing decorative dots, or off-scale hardcoded colours.
- Never rebuild the dropdown pattern by hand. `.v2-dropdown` carries the keyboard model, focus management and ARIA that a custom listbox has to supply in place of the native control; a one-off reimplementation will omit them.
- Never animate anything but `transform` and `opacity`; never exceed 300ms; never omit the `prefers-reduced-motion` guard.
- Never silently fix a pre-existing bug or shell artifact — flag it.
- Never expand scope. When matching a design from another page, copy the visual style, not the content inventory.
- Never add a new static drill-down view when the canvas or an existing structured workflow can carry it.

---

## 12. Ownership

| Owner | Responsibility |
|---|---|
| **AiMY Design System** | Tokens, shared components, interaction states, motion, accessibility, light/dark behaviour, visual consistency. |
| **Generative UI platform layer** | Context handoff contract, canvas runtime, thread continuity, tool/action rendering, observability. |
| **Individual agent team** | Role-specific briefing logic, prioritisation, domain evidence, prompt seeds, actions, destination workflows. |
| **Backend action owner** | Authorisation, validation, idempotency, audit trail, failure handling, recovery for consequential actions. |

---

## 13. Success Measures

Measure whether the model produces **useful work**, not whether it produces more messages.

- Time from landing to first relevant action
- Briefing-item-to-canvas conversion
- Rate at which users must restate context after entering the canvas
- Completion rate for investigations and recommended actions
- Abandonment and successful resume rate
- Acceptance, edit, rejection, and undo rates for AI suggestions
- Repeat meaningful usage by role
- Reduction in bespoke drill-down screens required per agent

Targets remain to be established after baseline instrumentation.

---

## 14. Reference Implementation

**AiMY QA v2** is the reference implementation of the interaction model as reached in July 2026:

- the opening screen functions as an operational-quality briefing rather than a blank chat;
- priority issues show severity, operational impact, and work already handled or staged by AiMY;
- selecting the SLA issue opens the canvas and begins a context-specific investigation;
- chart-level "Ask AiMY" prepares a relevant question before entering the same canvas;
- context cues explain what the canvas is based on;
- the conversation persists across entries, and closing the canvas returns to the dashboard;
- responses can hand off to a structured destination such as Reviews.

**The prototype proves the interaction sequence, not production completeness.** The known gap: visual context handoff exists, but backend context, response, and thread binding must be formalised before rollout.

---

## 15. Open Implementation Items

These do **not** reopen the interaction principle.

- Final context-envelope schema and ownership
- Policy for automatic investigation versus prepared prompts
- Thread persistence and cross-session continuity boundaries
- Confirmation levels for operational actions
- Fallback behaviour when AI or a downstream action is unavailable
- Responsive behaviour for constrained viewports
- Instrumentation events and baseline success measures
- Rollout order after QA v2
- ~~**Design-system gaps in §6.3**~~ — **closed 2026-07-28.** All five cited primitives existed; the eleven primitives this document names that the library genuinely lacked have been built and bound in §6.2. See `design-system.md` §9–§10.
- ~~**`--qa-accent` token swap**~~ — **closed.** Accents are global: one `--accent` token, re-themed per product. There is no QA-specific accent token.
- ~~**`.ds-select` vs `.v2-dropdown`**~~ — **closed.** `.v2-dropdown` is now the system's only select control; the styled native select has been retired. See `design-system.md` §10.3.
- **Canonical 7-level framework reconciliation** (§8)

---

## 16. Provenance

- *Briefing-to-Canvas Interaction Model*, locked by Ahmed Mahfouz, 2026-07-24
- *AiMY — Briefing-to-Canvas UX Specification*, Confluence, July 2026
- *AiMY QA v2 Prototype — Briefing-to-Canvas Design Review*, 2026-07-25 — source of the briefing surface budget
- `design-system.md` — tokens, brand, typography
- `design-doc.html` — implemented component library, source of truth for class names and anatomy
- Visual 1 — *Briefing to Canvas* end-to-end journey
- Visual 2 — *From Signal to Useful Action* routing model
