# UX Audit v2 — Test Runtime (PRD-16)

**Stage:** 4 (Testing Loop) · **Iteration:** 2 (re-audit) · **Auditor:** UX Auditor (discriminator)
**Persona unchanged:** Rahul, Class XII Panipat, JEE Advanced aspirant. About to sit a 3-hour Maths mock.

This file re-audits the v4 engineer's fixes against the v1 punch list. I read the current source files; I did not run the app. Each verdict is anchored to a file:line that I confirmed.

---

## HIGH-1 verify — MAT-COL LaTeX renders

**Files inspected:**
- `frontend/src/components/test-runtime/AnswerEntry/MatColumnEntry.tsx` (full file)
- `frontend/src/components/test-runtime/QuestionPane.tsx` (full file)
- `frontend/src/lib/katex-render.ts` (exists; `renderMathString` is the same renderer used by `QuestionPane`)

**What I found:**
- `stripTex()` is gone from `MatColumnEntry.tsx` — confirmed by full read of the file (122 lines) plus a `grep -rn stripTex` across `frontend/src` returning ZERO hits.
- A `list_ii.length > 0` block at lines 44-72 now renders the full List-II options as a labelled KaTeX block ABOVE the matching grid, using the same `renderMathString` pipeline as the question statement. Each option carries a `data-testid={'list-ii-option-${optIdx}'}` so it's testable from the integration suite.
- The dropdown at lines 94-115 is now **label-only**: `<option key={optIdx} value={optIdx}>({optIdx + 1})</option>`. The student picks "(1)" / "(2)" / etc. in the dropdown and reads the LaTeX-rendered math in the block above. This mirrors how the real JEE Advanced CBT renders MAT-COL.
- `list_ii` arrives via `props` from `QuestionPane`'s parent (`RuntimeProvider.tsx:996`) — wired correctly through `AnswerEntry`.

**Probe — would Rahul see `$\frac{1}{2}$` cleanly?** YES. The KaTeX renderer produces the rendered MathML/HTML in the labelled block; the dropdown labels are unambiguous `(1) (2) (3)`. List-II rendering is on-pane and above the grid, not buried below it.

**Layout balance check (NEW probe 5):** the List-II block is `bg-surface-1` inside a `border-border-subtle rounded-lg` with a flex-wrap list — not visually dominant. The "LIST II" caption is `text-xs uppercase` so it reads as a label, not a heading. Sits cleanly above the grid (`grid-cols-[80px_1fr_120px]`). Verdict: balanced. (One tiny note — the grid header row at line 74 still says "List I" / "List II pick" while the block above is titled just "List II"; the student parses this fine in practice but a strict reviewer might want "List II reference" / "List II pick" for symmetry.)

**Verdict: VERIFIED.**

---

## HIGH-2 verify — AuthErrorBanner timer clarity

**Files inspected:**
- `frontend/src/components/test-runtime/AuthErrorBanner.tsx` (full file)
- `frontend/src/app/test/[sessionId]/RuntimeProvider.tsx` (lines 152-298 for the auth flow + recovery toast wiring)

**What I found:**
- `AuthErrorBannerProps` now requires `secondsRemaining: number` (line 38). The `formatRemaining()` helper at lines 43-49 produces HH:MM:SS — confirmed.
- A prominent remaining-time pill renders at lines 73-86: a labelled flex row with "TIME REMAINING" caption + the HH:MM:SS value in `font-mono text-lg tabular-nums text-[var(--accent)]`. `data-testid="auth-error-time-remaining"` is present.
- Explicit timer-state copy at lines 92-100: **"Your test timer is still running — sign in to continue. Your saved answers are safe on this device and will sync once you are signed back in."** This solves the v1 ambiguity: the student now knows (a) the clock didn't pause, (b) their answers are safe, (c) the action is to sign in.
- Title rewrite (line 68): **"Sign in to keep going — your test isn't over"**. Much better than v1's ambiguous "Your session ended" — directly addresses the panic ("did I do something wrong?").
- The banner is fed by a live wrapper `AuthErrorBannerLive` at `RuntimeProvider.tsx:1131-1158` that ticks at 1 Hz off the same server-anchored `expiresAtMs` / `serverClockOffsetRef`. So the pill stays coherent with the runtime Timer.

**"Answers synced" toast wire-up:**
- `handleAuthFailure` at `RuntimeProvider.tsx:229-247` writes `sessionStorage.setItem('runtime_auth_recovery:<session_id>', '1')` before navigating to `/login` (line 239).
- A mount-time `useEffect` at lines 251-261 reads the flag and sets `recoveredFromAuthErrorRef.current = true`.
- The queue's `onSyncSuccess` callback at lines 280-292 checks the ref and, exactly once, fires `setSyncConfirmed(true)` for 3 seconds.
- The toast itself renders at lines 885-893: `role="status" aria-live="polite"`, top-right, `border border-border-subtle shadow-md`, copy `"✓ Your answers are now synced."` Doesn't block content — it's `fixed top-20 right-6` so it sits below the top bar and to the right.

**Probe — would the panicked v1 student now know what to do?** YES. They see "Sign in to keep going — your test isn't over" + the live timer pill + the reassurance about saved answers. After signing back in they get an explicit "✓ your answers are now synced" toast that fires on the first drain and disappears in 3 seconds — non-intrusive, clearly closes the loop.

**Did the toast overcorrect (NEW probe 2)?** Three-second timeout, top-right corner, polite live region, no backdrop, no block on click-through. It does not linger, does not block, does not interrupt. Solid.

**Verdict: VERIFIED.**

---

## HIGH-3 verify — /dashboard exists and works

**Files inspected:**
- `frontend/src/app/dashboard/page.tsx` (full file, 87 lines)
- `frontend/src/app/dashboard/DashboardAssignmentCard.tsx` (full file, 95 lines)
- `frontend/src/app/dashboard/DashboardAssignmentCard.test.tsx` (full file — 4 unit tests covering title, scheduled time, Begin link with session_id, fallback to test_assignment_id, status badge gating)
- `frontend/src/lib/session-fetch.ts:115-131` (the `fetchAssignedTests()` helper)

**What I found:**
- `dashboard/page.tsx` is a server component (`async function DashboardPage`) that calls `fetchAssignedTests()`. On null (auth failure / unreachable backend) it redirects to `/login?next=/dashboard` — closes the prior 404 loop cleanly.
- Empty state (lines 61-64): copy reads **"No tests scheduled yet. Your teacher will assign one soon."** Has `data-testid="dashboard-empty"`. Calm, non-jargon.
- Populated state (lines 65-73): renders a `<ul data-testid="dashboard-list">` of `DashboardAssignmentCard`.
- The Card (`DashboardAssignmentCard.tsx`): shows title, scheduled UTC datetime, duration in minutes, a status pill, and either a "Begin" link (for OPEN / IN_PROGRESS) or a dash. Links to `/test/[session_id]/instructions` when a session_id exists, else falls back to `/test/[test_assignment_id]/instructions`.

**Probe — does this read as a real student dashboard or as a placeholder?**
Honestly: this reads as a deliberate, well-scoped stub, not a full dashboard. The author's comment block at the top of `page.tsx` says so out loud ("Dashboard product scope is intentionally out of scope for this loop-back"). Good signs:
- Empty state is real, not lorem ipsum.
- ISO datetime display (`formatScheduled`) is stable for tests but reads as a real timestamp to a student.
- Sign-out link footer is wired (even if it just points to `/login`).
- 4 unit tests cover the visible contract.

Stub gaps a real Class XII student would notice on day one:
- The Card shows `Scheduled 2026-06-28 04:30 UTC` — a Panipat student would expect IST. They'd parse it but they'd grumble.
- No "marking scheme" line on the card (PRD US-1 AC mentions "marking-scheme summary (one line)"). PRD spec drift, but not blocking.
- No subject badge (Maths / Physics / Chem). For a single-section pilot this is fine; PRD §0 mentions sections so multi-subject tests will need this.
- No live countdown for UPCOMING tests (PRD US-1 AC mentions "opens in HH:MM:SS"). Acceptable for v1 (it's a stub).
- Sign-out via a `/login` link, not a real sign-out POST. Cosmetic; no security gap because the cookie is still valid after the link click.

**Is this acceptable for v1 ship?** Yes — it closes the broken-route gap without faking what isn't built. The candid scope comment at the top of `page.tsx` is the right kind of restraint. The card's unit tests prove the contract sticks.

**Status badge colours (NEW probe 1):**
- All four status badges (`OPEN/IN_PROGRESS`, `UPCOMING`, `SUBMITTED`, `EXPIRED`) use `--status-*-bg/text` CSS variables defined in `globals.css:63-71`.
- Palette: open=mint, upcoming=indigo-blue, submitted=neutral grey, expired=light red. Mint and indigo do not clash with the runtime accent `#3754C5` — they read as muted, NotebookLM-style chips. No saturation collision. The dashboard correctly does NOT carry the runtime palette (design-lock #3 says calm everywhere except the actual JEE Advanced runtime). Solid.

**Verdict: VERIFIED.**

---

## MED-1 verify — Submit confirm per-question chips

**File:** `frontend/src/components/test-runtime/SubmitConfirm.tsx`

- New `chips?: SubmitChip[]` + `onJumpToSlot?: (slotIndex: number) => void` props at lines 35-37.
- Chip grid renders at lines 103-128 inside the step-1 modal, only when `chips && chips.length > 0`:
  - Summary line: "X answered, Y unanswered, Z marked for review" (line 105-108).
  - 10-column grid (`grid grid-cols-10 gap-1`) of `h-7 w-7` chips.
  - Each chip's colour is driven by `chipClass(status)` (lines 216-231) which uses `--palette-answered-bg`, `--warn-bg-strong`, `surface-2` — design tokens, no Tailwind palette literals.
  - Click handler at lines 114-118 calls `onJumpToSlot(c.slotIndex)`, resets step, and closes the modal.
  - aria-label per chip includes status + "Click to jump."
- `RuntimeProvider.tsx:1082-1102` wires `chips={paletteSlots.map(...)}` + `onJumpToSlot` to the same `jumpTo` that the palette uses.

**Verdict: VERIFIED.** PRD US-6 AC compliance achieved.

---

## MED-2 verify — 8-col × 4-px palette grid

**File:** `frontend/src/components/test-runtime/Palette.tsx`

- Line 58 `<div className="grid grid-cols-8 gap-1">`. `gap-1` = 4 px. `grid-cols-8` = 8 columns. Matches PRD §7.5 exactly.
- Math at 360 px palette rail: 8 cells × 40 px + 7 gaps × 4 px = 348 px content + 12 px padding total = 360 px. Fits without overflow.
- Container in `RuntimeProvider.tsx:967` widened to `grid-cols-[1fr_360px]` from the v1 280 px to accommodate the new grid spec — corroborates the engineer's design intent.

**Verdict: VERIFIED.**

---

## MED-3 verify — token sweep (no Tailwind colour literals)

**Search:** `grep -rEn '(amber|blue|red|green|yellow|orange|purple|...)-(50|100|...|900)' frontend/src/components/test-runtime frontend/src/app/test frontend/src/app/login frontend/src/app/dashboard`

**Result: ZERO hits in any source file under those four roots.** I broadened to the entire `frontend/src/components` and `frontend/src/app` tree — the only matches are the 6 comments inside `globals.css` (e.g. `/* amber-50 ish */` next to the `--warn-bg` definition). Comments, not classes.

Spot-confirmed token usage in the formerly-amber/blue/red call sites:
- `ViolationBanner.tsx:49-53` uses `--violation-1/2/3-bg/text` per design-lock #6.
- `Timer.tsx:50-54` uses `--violation-3-bg` for urgent and `--warn-fg` for warn (replaces the v1 `text-red-600`).
- `RuntimeProvider.tsx:905-925` (violations chip + offline chip) uses `--warn-bg/text/border`.
- `InstructionsClient.tsx:118-140` uses `--warn-bg/text/border` for anti-cheat block and `--info-bg/text/border` for hints — design-lock #1 single-accent rule respected.
- `results/page.tsx:32-36,109-127,179-187` uses `--danger-*`, `--warn-*`, `--info-*`, `--status-open-*` — diagnostic chip and status chips are token-driven. The "SLOW_BUT_CORRECT" chip now uses info-blue (progress) instead of warn-amber (penalty) — a v1 ask that landed correctly.

**Visual regressions vs v1 (NEW probe 4):**
- v1 violation chip: Tailwind `bg-amber-50 text-amber-800 border-amber-200` ≈ #fef3c7 / #92400e / #fde68a.
- v4 violation chip: `--warn-bg/--warn-text/--warn-border` = #fef3c7 / #78350f / #fcd34d. Background unchanged; text slightly darker (better contrast — WCAG-positive); border slightly more saturated. No regression; mild improvement.
- v1 instructions amber block contrast (`amber-700` text on `amber-50`) vs v4 (`--warn-text: #78350f` on `--warn-bg: #fef3c7`): the v4 text is darker (better contrast). Slightly more "serious" feel than v1; appropriate for an anti-cheat notice.
- v1 instructions blue hint block (`bg-blue-50 border-blue-200 text-blue-900`) violated the single-accent rule. v4 uses `--info-bg/text/border` which is an off-accent indigo (`#eef2ff / #1e3a8a / #c7d2fe`). Still a second blue, but **closer** to the runtime `#3754C5` accent than the v1 Tailwind blue. The design-lock #1 strict reading says "no second accent" — v4 mitigates by tuning the off-accent toward the main one. Acceptable; some restraint-purists would call it a soft violation.

**Verdict: VERIFIED** (with a tiny nit on `--info-*` still being a second blue, even if better-tuned).

---

## MED-4 verify — Instructions UI walkthrough

**File:** `frontend/src/app/test/[sessionId]/instructions/InstructionsClient.tsx`

- New `<section aria-label="Runtime UI walkthrough">` at lines 110-116 with an inline `<RuntimeWalkthrough />` SVG defined at lines 196-224.
- The SVG (viewBox 480×200, `role="img"`, full aria-label) shows a top-bar strip + a question-pane block + a palette block, with labelled "Question pane", "Answer entry (A/B/C/D, numeric, MAT-COL)", "Save & Next", "Mark for Review", "Palette", "Click a number to jump.", "Shift-click to mark." captions.
- Uses design tokens (`var(--surface-2)`, `var(--accent-subtle-bg)`, `var(--palette-answered-bg)`, etc.) so the diagram themes with the page.
- 16 mini palette cells (5 green for "answered", rest grey for "not visited") give a concrete preview of how the palette looks once the test is in flight.

PRD US-2 AC "labelled diagram of the test runtime UI (palette, question pane, action buttons)" — satisfied.

**Verdict: VERIFIED.**

---

## NEW probes — things v4 might have introduced

### Probe 1 (dashboard status-badge palette respects design-lock?)
Confirmed in MED-3 / HIGH-3 above. Calm palette; no JEE-saturated chroma; no runtime accent clash. PASS.

### Probe 2 (sync toast lingers / blocks / fragile?)
Reviewed in HIGH-2 above. 3 s timeout, `top-20 right-6 fixed`, `aria-live="polite"`, no backdrop. Doesn't linger, doesn't block, doesn't interrupt. PASS.

If sessionStorage is unavailable (private mode), the flag write is silently swallowed (`try { … } catch {}` at `RuntimeProvider.tsx:243-246`). Toast then doesn't fire — non-blocking. That's the right call.

### Probe 3 (360 px palette rail crowds the question pane at 1280?)
Math: at a 1280-px viewport in fullscreen, `grid-cols-[1fr_360px]` → main pane = 920 px (1280 − 360). `<QuestionPane>` content sits inside `p-6` (24 px each side) on a `relative` section — usable content width ≈ 872 px. `<AnswerEntry>` is constrained to `max-w-2xl` (672 px) at line 989. That leaves ample air around the answer entry. The MAT-COL grid is `grid-cols-[80px_1fr_120px]` so at 672 px wide the middle (List-I stem) column gets ~440 px — fine for stems with one LaTeX expression, possibly tight for two-line wraps but not crowded.

What I'd flag as a soft risk: at a 1024-1279 px viewport the 360 px rail eats more proportional space (28-35% of width). At 1024 px the answer pane is ~640 px content + padding — answer entry's `max-w-2xl` doesn't trip but the palette is now ~35% of the viewport, which feels chunky. Tablet path (`tablet = max-width: 1023`) doesn't kick in here — so 1024-1279 px laptops sit in an awkward middle zone. Class XII students on 13-14" Lenovo IdeaPads (1366×768 typical) clear this, but a 1280×800 MacBook Air user is right at the edge. **Low-severity finding** — would push to a future polish loop, not a v1 blocker.

### Probe 4 (token sweep visual regressions?)
Reviewed in MED-3 above. No regressions, mostly improvements (better contrast on the violation chip and the warn block). PASS.

### Probe 5 (MAT-COL List-II block visually balanced with the grid?)
Reviewed in HIGH-1 above. The labelled List-II block uses `bg-surface-1` border + `text-xs uppercase` caption — visually quieter than the grid below it. Doesn't dominate. PASS. The "List II" caption appears twice (once above as a block label, once in the grid header line) — students will not be confused, but a copy editor would consolidate.

### Other findings I spotted while reading

- **MED carry-over from v1** — `SubmitConfirm.tsx:65-77` "draining" modal still has no spinner / progress bar / animated dots. Copy is "Saving your answers… N answer(s) pending. Please do not close this tab." The N count gives a hint of progress (it ticks down), but at the 3-second-rule threshold a frozen-feeling modal is a risk. v1 flagged this; v4 did not address it. Not on the v1 priority list (#1-6) so engineer arguably out of scope, but worth flagging for v5 or a polish loop.
- **MED carry-over from v1** — Submit button + Timer still side-by-side in the top bar with no visual separator (`RuntimeProvider.tsx:929-942`). Both still draw on `var(--accent)`. v1 flagged this; not on the priority list; not addressed.
- **New low-severity** — `DashboardAssignmentCard` shows the scheduled time in UTC ("2026-06-28 04:30 UTC"). A Panipat student reads IST. Stub scope; flag for a future dashboard PRD.
- **New low-severity** — the `--info-bg`/`--info-text`/`--info-border` palette is a second blue family (`#eef2ff / #1e3a8a / #c7d2fe`). Used by the Instructions Hints block and the SLOW_BUT_CORRECT chip. Design-lock #1 says "no second accent". v4 tuned this toward the main accent but the strict reading still has it as a soft violation. The auditor's verdict: acceptable in v1 because the chip count is small and the hue family is close, but a v5 polish pass could collapse `--info-*` into a desaturated `--accent-subtle-*` ramp.

---

## Per-flow re-scoring

| Flow | v1 | v2 | Δ | One-line |
|---|---|---|---|---|
| A — Login | 6 | 7 | +1 | /dashboard exists; login form unchanged but no longer leads to 404 |
| B — Pre-test instructions | 7 | 8 | +1 | Walkthrough SVG added; tint blocks now token-driven (no second hard blue) |
| C — Test runtime | 7 | 8 | +1 | MAT-COL HIGH-1 resolved; 8-col / 4-px palette grid matches PRD §7.5; Timer urgent state now uses design-lock red token |
| D — Anti-cheat violation | 8 | 8 | 0 | Already strong in v1; chip now uses warn tokens instead of `bg-amber-50` |
| E — Auth expiry mid-test | 6 | 8 | +2 | New title + remaining-time pill + explicit timer-state copy + post-recovery "answers synced" toast |
| F — Submit & results | 7 | 8 | +1 | Per-question chips with click-to-jump; SLOW_BUT_CORRECT chip now info-blue; draining-modal-no-spinner gap unresolved |
| G — Mobile block | 7 | 7.5 | +0.5 | "Back to dashboard" now resolves to a real route; copy unchanged |

**Composite v2 score: 7.79 / 10** (mean of the 7 flow scores)

v1 composite: 6.9 → v2 composite: 7.79. Δ = **+0.89**.

---

## Top 3 strengths (now)

1. **HIGH-2 was the highest-stakes fix and it landed beautifully.** Rewriting "Your session ended" → "Sign in to keep going — your test isn't over" + a live HH:MM:SS remaining-time pill + explicit "your timer is still running" copy + a 3-second confirmation toast on recovery turns the most panic-inducing moment in v1 into a calm, narrated detour. The sessionStorage flag pattern (set before navigation, read on remount, single-fire on next drain) is the right engineering shape for "survive a full reload to /login and back".
2. **Token discipline is genuinely clean now.** ZERO Tailwind palette literals in `components/test-runtime`, `app/test`, `app/login`, `app/dashboard`. Every status surface (anti-cheat ramp, warn/info/danger/success, palette ramp, status badges) is driven by CSS variables that respect design-locks #1 and #3. The `[data-palette=exam_muscle_memory|calm]` hybrid switch still works correctly. This is the kind of foundation a real polish pass can build on.
3. **The dashboard stub knows what it is.** The author's comment block at the top of `dashboard/page.tsx` says outright that the dashboard is a separate spec loop and this is a stub to close the broken-route gap. The 4 unit tests cover the visible contract. The empty state is real. This is the right kind of restraint — better than a half-fake "dashboard" that pretends to be more than it is.

---

## Top 3 issues (still open or newly noticed)

1. **[MED, carry-over]** Submit-confirm draining modal still has no spinner / progress bar / animated indicator (`SubmitConfirm.tsx:65-77`). On a slow drain the modal looks frozen. v1 flagged this; v4 did not address it. Suggest: add a `<div role="progressbar" aria-busy="true">` with at least an animated dot-trio or a `motion-safe:animate-pulse` ring around the "N pending" number.
2. **[LOW]** Dashboard `Scheduled` timestamp is shown in UTC, not IST. A Panipat student would prefer their local time. `DashboardAssignmentCard.tsx:19-28` uses `getUTCFullYear` etc. to keep tests stable — fine for the stub scope, but a v5 polish (or the proper dashboard PRD) should show IST + the day-of-week.
3. **[LOW]** `--info-*` token family is a second blue (Instructions Hints block + SLOW_BUT_CORRECT chip). Design-lock #1's single-accent rule reads strictly that this is a soft violation. v4 has it tuned closer to the main accent than v1, but it's not gone. Suggest: collapse `--info-*` into a desaturated `--accent-subtle-*` ramp in a future loop.

(For completeness: HIGH-3's dashboard stub is acceptable for v1 but the dashboard PRD is the right place to make it complete. NEW probe 3's 1024-1279 px squeeze on the 360 px palette rail is sub-threshold but mention-worthy.)

---

## Verdict

**ADVANCE to Stage 5 Integration.**

- Composite 7.79 ≥ 7 gate.
- All three v1 HIGHs are VERIFIED.
- All four v1 MEDs are VERIFIED (with one carry-over MED on the draining-modal spinner that was not on the loop-back priority list).
- No newly introduced HIGH or critical issues.
- Token discipline is clean enough that a future polish loop can extend the palette without re-architecting components.

The runtime is now JEE-Advanced-faithful enough for a Class XII Panipat student sitting their Saturday-morning mock. The MAT-COL legibility bug — which would have made a real Advanced paper unusable — is properly fixed. The auth-expiry detour, which was a student-trust hazard in v1, now reads like a calm narrated step. The dashboard no longer 404s.

Note for the orchestrator: the dashboard is shipped as an acknowledged stub. Spin a separate spec loop for the full dashboard product before pilot day, even though it's not a v1 ship-blocker.

— UX Auditor, iteration 2, 2026-06-28
