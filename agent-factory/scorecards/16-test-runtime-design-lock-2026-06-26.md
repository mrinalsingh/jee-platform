# Test-runtime PRD — design lock-ins (2026-06-26)

> Locks the 11 open UX paint-level questions from PRD v2 so the Stage-2 Architect
> + downstream Engineer agents have zero ambiguity. Applies on top of
> `16-test-runtime-prd-final.md` — no PRD edit needed; this file is canonical for
> these 7 decisions.

---

## 1. Accent colour → `#3754C5` (calm blue, NotebookLM-aligned)

NotebookLM uses a Google-blue accent (closer to `#1A73E8 / #3754C5` family than the warm-orange option). Adopted.

- Primary action / focus ring / link colour: `#3754C5`.
- Hover: `#2A40A1` (darker 12%).
- Disabled: `#3754C5` at 32% opacity.
- Light-mode background: `#FFFFFF` / `#F8F9FB` (subtle off-white surface).
- Dark-mode background: `#1A1D24` / `#252830`.
- Use as the SOLE accent — everything else neutral. No second accent for warnings (use the anti-cheat ramp in §6 below).

## 2. Font family → **Inter** (variable)

Both Geist and Inter are excellent. Inter wins for this product because:

- It was designed by Rasmus Andersson specifically for screen text legibility (variable optical sizes, deliberately wide aperture).
- Students will read questions for **up to 3 hours straight** during a mock — reading fatigue is a real cost; Inter has more empirical reading-test wins than Geist.
- Inter ships excellent math-adjacent character coverage (rare-Greek, math operators inline) which matters when problem stems mix LaTeX and prose.
- Geist is slightly more "designer-cool" and more associated with marketing / SaaS landing pages than reading-heavy interfaces.

Loaded via `next/font/google` with `variable: "--font-inter"`, weights 400/500/600/700, with `display: "swap"` for instant render.

## 3. Palette colour intensity → **HYBRID per user direction**

> "JEE-standard for jee advanced mock test; otherwise notebooklm" — MS.

Implementation: the runtime accepts a `palette_intensity: "exam_muscle_memory" | "calm"` prop on the test session, defaulted from the test's `target_exam` field:

| target_exam | palette intensity | Reasoning |
|---|---|---|
| `JEE_ADVANCED` | `exam_muscle_memory` (saturated standard) | Real exam-day muscle memory matters |
| `JEE_MAIN` | `exam_muscle_memory` | Same colour codes on NTA portal |
| All others (IOQM / INMO / RMO / KVPY / COACHING / ORIGINAL / OTHER) | `calm` (NotebookLM-ish) | Olympiad / practice formats don't carry the exam-day muscle-memory cost |

Standard saturated palette (JEE-Advanced match):
- Not visited: `#9CA3AF` (grey)
- Visited not answered: `#DC2626` (saturated red)
- Answered: `#16A34A` (saturated green)
- Marked for review: `#7C3AED` (purple)
- Answered + marked: `#7C3AED` with a `#16A34A` dot

NotebookLM-ish calm palette:
- Not visited: `#E5E7EB`
- Visited not answered: `#F59E0B` (calm amber, less alarming)
- Answered: `#10B981` (calm emerald, less neon)
- Marked: `#8B5CF6` (calm violet)
- Answered + marked: same with green dot

Both palettes share the same five status meanings; only the chroma changes.

## 4. Mobile runtime → **soft-block on the dashboard, hard-block on the actual test**

(Orchestrator call given "as you prefer".)

- **Dashboard, problem browse, post-test review**: fully mobile-responsive; works on a phone ≥ 360 px wide. Useful for a student to glance at upcoming-test windows on their phone.
- **The actual test runtime (`/test/:session_id`)**: hard-block on viewports < 768 px. Show a clean "Please switch to a laptop or tablet to take this test" screen with a link back to the dashboard. Rationale:
  - The question palette + question + answer-entry + timer + violation banner together demand horizontal space; cramming them onto a phone produces a worse UX than just refusing.
  - Anti-cheat detection is unreliable on mobile browsers (no fullscreen API on iOS Safari for non-installed PWAs, touch-event noise indistinguishable from tab-switch).
  - The keystroke-time precision cap (Blocker 1 fix) doesn't work cleanly with virtual keyboards on small screens.
- **Tablet (768 – 1024 px)**: allowed with a reduced palette (4 cols instead of 5) + slightly smaller question pane.

## 5. Auto-submit cron cadence → **30 s**

(Orchestrator call given "as u prefer".)

The server job that picks up sessions whose timer expired but the client never reached the auto-submit handshake. 30 s is right because:
- A 30 s lag between actual T=0 and forced server-side submit is invisible to the student (their UI already locked at T=0).
- 10 s would 3× the cron load with no measurable user benefit at our scale.
- Designed for 1 lakh students per binding doc — at scale, 30 s × 1k concurrent expirers = 33 sessions/s steady-state; trivially handled. 10 s would be 100/s — still fine but no benefit.
- The integrity guarantee is "session WILL auto-submit, latency ≤ 30 s post-expiry", which is the SLA the PRD §5.2 should encode.

## 6. Anti-cheat warning colour intensity → **progressive escalation**

(Orchestrator call given "ur call".)

- **Violation 1** — amber banner `#F59E0B` background, dark text. Tone: informative.
- **Violation 2** — amber-red `#F97316` background, white text. Tone: serious warning.
- **Violation 3** (the auto-submit moment) — saturated red `#DC2626` background, white text, bold. Tone: definitive.

Each banner displays for 5 seconds (auto-dismiss), is non-blocking (student can keep working), but the violation counter chip in the header is persistent and shows the running tally.

Reasoning: a single-intensity warning (e.g., all-red) habituates the student and they tune it out. Progressive escalation matches how a real proctor would respond — first nudge, then firm warning, then enforcement.

## 7. Hint display position with figures → **right-side slide-in card**

(Orchestrator call given "as u prefer".)

When a problem has a figure (image or rendered SVG):

- The question pane has its standard left-of-palette layout.
- Clicking "Show hint" slides in a hint card from the right side of the question pane (not the global right rail — the palette stays put).
- The card overlays the answer-entry control with a translucent backdrop (so the figure stays fully visible). Card has a "Got it, hide hint" button.
- Multiple hint reveals stack — Hint 1 visible, then "Show next hint" reveals Hint 2 *below* Hint 1, not replacing it. One-way; a student can re-hide them but cannot un-reveal.
- On viewports < 1024 px (tablet), the hint card pushes the answer-entry down instead of overlaying (more space-efficient on narrow viewports).

Reasoning: students compare figure + hint while solving; modal that obscures figure is hostile, inline-below-figure consumes scarce vertical space.

---

## Summary table (the 7 locks)

| # | Question | Decision | Source |
|---|---|---|---|
| 1 | Accent colour | `#3754C5` calm blue (NotebookLM-aligned) | User direction |
| 2 | Font family | **Inter** (Variable, via `next/font/google`) | Orchestrator — readability under load |
| 3 | Palette intensity | **Hybrid** — JEE-standard for `JEE_ADVANCED` / `JEE_MAIN`; NotebookLM-calm for everything else | User direction |
| 4 | Mobile runtime | **Hybrid** — dashboard responsive; runtime hard-blocked < 768 px | Orchestrator |
| 5 | Auto-submit cron | **30 s** | Orchestrator |
| 6 | Anti-cheat warning intensity | **Progressive** — amber → amber-red → red | Orchestrator |
| 7 | Hint display with figures | **Right-side slide-in card** (overlay on desktop, push-down on tablet) | Orchestrator |

---

*End of design lock — 2026-06-26. Any future divergence by Engineer agents requires user sign-off.*
