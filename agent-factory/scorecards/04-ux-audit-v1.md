# UX Audit v1 — Test Runtime (PRD-16)

**Stage:** 4 (Testing Loop) · **Iteration:** 1 · **Auditor:** UX Auditor (discriminator)
**Persona:** Rahul, Class XII Panipat, JEE Advanced aspirant. 13" Lenovo IdeaPad. Has done 6+ NTA mock tests on the official portal and 20+ tests on coaching CBT software. About to sit a 3-hour Maths mock at 10:00 Saturday morning.

---

## FLOW A — First-time Login

**Files:** `frontend/src/app/login/page.tsx`, `frontend/src/app/login/LoginForm.tsx`, `backend/src/auth/auth.controller.ts`

**What I see**
I land on a near-empty page. There's a small card centred in the viewport against a faint off-white background (`bg-surface-1`). Inside the card: the words "Sign in" in a medium-weight headline, then two fields labelled "Email" and "Password" in muted grey, then a blue button that says "Sign in". That's it. No logo. No platform name. No "JEE Aspirants Platform" — nothing. No "forgot password" link. No "create account" or "no account, ask your teacher" path. The browser tab title says "jee_platform — test runtime" — which is what tells me I'm in the right place, but I'd only see that if I look up.

**What I expect**
Even a stripped-down coaching portal shows me a logo, the name of the institute, and a "welcome" line. The blank card feels like a Vercel staging deploy, not a polished product. That said: the calm blue button matches what I'd expect from a NotebookLM-style restraint design — so it doesn't feel broken, just minimal.

**What I'd click / do**
Type my email, tab to password, type, click "Sign in". My muscle memory is to also press Enter — that works (it's a `<form onSubmit>`).

**What confuses me / breaks flow**
- The button shows "Signing in…" with an em-dash and an ellipsis character — looks polished, good.
- On bad creds I get "Invalid email or password." in plain red — clear, no jargon, good.
- BUT: there is NO link to a "/dashboard" landing page in this project — the login redirects me to `/dashboard` on success, but I checked and there is no `/dashboard/page.tsx` in `frontend/src/app/`. So if a teacher hasn't given me a direct test link, I'm going to a 404. That's a silent broken-state for first-time users.
- There's no "forgot password" path. If I mistype my password three times during the rate-limited window (10/min/IP), I just keep getting "Invalid email or password" and have no recovery.

**What looks great**
- `returnedFromExpiredTest` banner copy "Your test session ended. Sign in to continue." — short, calm, no scary jargon. Good for Flow E.
- The `return_to` allow-list (only `/test/...`) is correct — no open-redirect surface.

**Score: 6/10** — works, but minimal to the point of unbranded. The missing `/dashboard` route makes this a blocking issue for cold-start (HIGH severity).

---

## FLOW B — Pre-test Instructions

**Files:** `frontend/src/app/test/[sessionId]/instructions/page.tsx`, `InstructionsClient.tsx`

**What I see**
A clean white card (max-width ~672 px) on the same faint-off-white background. The test title is rendered big — 3xl semibold — so my eye lands on "Maths Mock — Pilot 0609d" or whatever immediately. Below: one grey line of metadata "1 section: Mathematics · 180 minutes · 18 questions". Then a "Marking scheme" section showing "+4 / −1, partial on MCQ-MC". Then a 2-column palette colour key with four little swatches.

Then comes an **amber-tinted block** with "Anti-cheat notice" reading "Three violations will auto-submit your test. Please close all other tabs before starting." Then a blue-tinted block (only if hints are available) explaining hints. Then a single checkbox "I have read and understood the instructions." and a blue "Start Test" button (disabled until I tick the checkbox).

**What I expect**
A coaching-portal instructions page usually has a 30-bullet list of rules. The minimalism here is refreshing but feels almost TOO terse — I want to see the section breakdown (Section 1: Maths, Q1-Q6 single-choice +4/−1, Q7-Q12 multi-choice +4/−2, etc.) which is what the NTA real-exam instructions page shows. PRD US-2 AC says "per-section breakdown (subject + question count + marking scheme)" — this implementation only shows the section LABEL, not the breakdown.

**What I'd click / do**
Read the anti-cheat amber block (the colour pulls my eye there — good restraint, not panicked-red). Check the box. Click "Start Test".

**What confuses me / breaks flow**
- The amber and blue tint blocks use Tailwind's `amber-50` / `amber-200` and `blue-50` / `blue-200` palettes — these are FINE but they break the "single accent + neutrals" design lock #1. The blue-50 hint notice block specifically uses a different blue from `--accent: #3754C5`, so a designer's eye sees TWO blues on the page. (Med severity.)
- The PRD §7.2 spacing scale is "4, 8, 12, 16, 24, 32, 48, 64 px" only. The card uses `p-8` (32 px) and `space-y-6` (24 px) — these match. Good adherence.
- No "labelled diagram of the test runtime UI" as required by PRD US-2 AC (palette + question pane + action buttons walkthrough). A first-time user has to discover what `Save & Mark for Review & Next` means in-test. Med severity.
- The "Marking scheme" summary "+4 / −1, partial on MCQ-MC" — the heuristic in `summariseScheme()` only reads the MCQ-SC row and tests for the SUBSTRING `"correct"` in the MCQ-MC marking_scheme keys. If the JSONB shape doesn't have a key with "correct" in it, the partial note won't show. Fragile but low-severity (the YAML import is canonical).
- No diagram of palette colour codes "in action" — I'd want to see what an ANSWERED cell looks like next to a VISITED cell next to a MARKED cell. The four-swatch legend is small and a bit abstract for a non-tech-savvy student.

**What looks great**
- "Acknowledge instructions" checkbox + disabled "Start Test" button is the correct two-step affordance per PRD US-2 AC. Good restraint.
- `requestRuntimeFullscreen()` is fired synchronously inside the click handler — correctly satisfies the browser user-activation policy. Engineered well.
- If the START call returns 410, the error reads "This test window has closed." — short, plain. Good copy.

**Score: 7/10** — clean and clear, but the missing section breakdown + the rule-of-one-accent violation (amber/blue tint blocks, plus a second blue) chip away at polish. Trustworthy enough that a Class XII student would click Start.

---

## FLOW C — The 3-hour Test Runtime (the centerpiece)

**Files:** `frontend/src/app/test/[sessionId]/RuntimeProvider.tsx`, `page.tsx`, all `frontend/src/components/test-runtime/*`

**What I see — top bar (64 px)**
Left side: test title in a medium-weight 18 px line ("Maths Mock — Pilot 0609d"), truncated if too long. Right side: NO violations chip (since I have 0), NO sync chip (since queue empty), NO offline banner. Then the timer in mono digits "02:59:32" in calm blue (`text-[var(--accent)]`). Then a blue rounded button "Submit Test".

The 64 px top bar respects the design lock for `--topbar-height`. Bottom 1 px border separates it from the body.

**What I see — main body (2-pane CSS grid)**
Left pane (1fr): a question pane that says "Question 1 of 18" as a 20 px medium header (`text-xl`), with "Hints used: 0 / 3" right-aligned. A thin 1 px divider. Then the KaTeX-rendered question statement in body-lg (18 px) leading-relaxed. If figures exist, they render as `<img>` tags with `max-h-72` (288 px) max height and a subtle rounded border.

Below that, the answer entry component. For MCQ-SC: four rows (A, B, C, D), each in a rounded rectangle with a 1 px border. When I select one, the row goes to `--accent-subtle-bg` (4% accent tint) and border becomes accent. The letter "(A)" is rendered in `font-medium` next to the radio button — JEE muscle memory ✓.

Below the answer entry, four action buttons: "Save & Next" (filled blue, primary), "Save & Mark for Review & Next" (outlined), "Mark for Review" or "Unmark Review" (outlined — toggles), "Clear Response" (tertiary, accent-coloured text only). If the question has hints, a 5th button "Show hint (0 / 3 used)" appears in `text-text-secondary` underlined.

Below the buttons, a single grey caption line: "Answered: 0 · Marked & Answered: 0 · Marked: 0 · Visited not answered: 0 · Not visited: 18" — the running counts strip.

Right pane (280 px fixed): the question palette. Header "Question palette". Grid of 5 columns (xl: 6 columns) of 40 × 40 px buttons. Each cell shows its question number, with a small icon (✓ for answered, ⚑ for marked) in the top-right corner. Current question gets a 2 px accent ring with 2 px ring-offset against `--surface-1`. Below the grid, the 4-item legend. Below that, a small tip: "Tip: shift-click a question to toggle its mark-for-review flag."

**What I expect (JEE Advanced muscle memory)**
The official NTA portal has:
- Top bar: candidate name + photo on left, total time + section time on right.
- Section tabs across the top of the question pane (Section 1 Maths, Section 2 Physics, …).
- A horizontal action-button row at the bottom-of-pane that includes "Save & Next", "Mark for Review & Next", "Clear Response", "Save & Mark for Review & Next" — exact JEE muscle memory.
- The palette occupies the FULL right side from top of body to bottom, with the section-summary strip at top of palette (not under the question pane).

**What I'd click / do**
Read the question statement. Click an option row. The radio fills, the row tints. Click "Save & Next". The next question loads, my palette cell turns green with a ✓. Done. The flow works.

**What confuses me / breaks flow**
- **NO section tabs.** The PRD §7.5 design language calls for "section tabs (each tab is 36 px tall, 16 px horizontal padding; active tab has `--accent` bottom border 2 px)". The implementation just flattens `session.sections.flatMap((sec) => sec.slots)` into one linear list. For v1 with only 1 section (Maths), this is honest — but the user-visible "1 section: Mathematics" promise from the instructions page doesn't manifest as a tab on the runtime. The current student is fine; a v2 multi-section student would be lost. (Med severity for future-proofing; LOW for v1.)
- **The palette is 5 cols × N rows in a 280 px-wide pane**, with each cell 40 × 40 px and `gap-2` (8 px). That's 5×40 + 4×8 = 232 px of content in a 280 px container with `p-4` padding — math works but feels CRAMPED. The PRD §7.5 specifies "8-column grid (desktop)" with "4 px gap" — actual implementation is 5-column, 8 px gap. This contradicts the PRD spec. (Med severity.)
- **Section-summary strip is BELOW the answer entry, not above or in the palette rail.** PRD §7.5 says "section header label is `caption` size, uppercased, `--text-secondary` colour" — implementation puts the live counts as a single dot-separated grey line at the bottom of the left pane. Easy to miss. Not where exam muscle-memory expects it (in the palette legend area). (Med severity.)
- **NO subject header anywhere in the question pane.** A student switching focus mid-test wants a tiny "Mathematics" reminder. Currently the test title is the only subject hint, and it's truncated at 480 px width per the PRD spec but at viewport-dependent width per implementation.
- **No `slot.options` rendering of List-II options as labelled chips above the matching grid for MAT-COL** — only the dropdown shows them with `stripTex()` which strips LaTeX. A student looking at the dropdown options on a problem with LaTeX-heavy List-II options will see "(1) " followed by stripped-LaTeX text. This is a real usability gap on a JEE MAT-COL problem with `\frac{1}{2}` or `\sin\theta` in List-II — the dropdown becomes meaningless. The component author flagged this in a comment ("The labelled List-II is shown separately above the matching grid in the question pane") but the QuestionPane component does NOT actually render labelled List-II options above the grid — I checked. **HIGH severity** — JEE MAT-COL questions are unusable.
- **Timer thresholds:** PRD §7.5 says "`--accent` when ≥ 5 min remaining, `--accent-warning` when < 5 min, pulsing 1 Hz when < 1 min". Implementation: `< 60s` → red+animate-pulse, `< 300s` → amber, otherwise accent. The PRD also mentions "30s" and "10s" warning thresholds in your audit checklist — the implementation has only TWO thresholds (5 min, 1 min). No 30 s, no 10 s escalation. The PRD §7.5 actually only specifies 5min+1min, so the implementation is PRD-compliant — but a JEE student would expect more granular warnings (NTA shows a banner at 5 min and another at 1 min).
- **Timer urgent state uses `text-red-600 animate-pulse`** — that's Tailwind's red 600, NOT design-lock #6's violation-3 colour `#dc2626`. They look similar but use different sources. Low severity, but a sign of token-discipline drift.
- **The current-question palette cell uses `ring-2 ring-[var(--accent)] ring-offset-2 ring-offset-surface-1`** — correct accent ring. ✓
- **MAT-COL grid layout:** `grid-cols-[80px_1fr_160px]` — a fixed 160 px right column. On a viewport with the palette at 280 px and the left pane at 1fr, the actual answer area is ~600-900 px wide. The 160 px dropdown is fine, but the left "List I" stem column is `1fr` (~360-660 px). For long stem text, that's spacious. For short stem text it looks empty. Acceptable.
- **`Submit Test` button is in the top bar with no visual separation from the timer** — they sit side-by-side with `gap-4` (16 px). I'd expect a vertical divider or for the Submit button to be smaller / less primary-coloured. Currently the SAME calm-blue accent is on both the timer (text colour) and the Submit button (background) — visually competing for attention. Med severity.
- **No keyboard hint anywhere for "press 1, 2, 3, 4 to select MCQ options"** — JEE students typically use the number keys on the real NTA portal. The implementation has no keyboard shortcut layer for option selection. Not in PRD spec, but a missed muscle-memory affordance.
- **The "Tip: shift-click a question to toggle its mark-for-review flag." line in the palette** is a non-standard UI pattern. JEE Advanced palette is click-to-jump-only. Adding shift-click-to-mark is a clever bonus but it's invisible to students who haven't been told. A pilot student would not discover it. Low severity (it's a bonus, not a blocking gap).

**What looks great**
- The KaTeX font-size bump to `1.05em` in `globals.css` — small detail that meaningfully improves math legibility. NotebookLM-grade polish.
- `prose-runtime no-select text-text-primary text-lg leading-relaxed` on the statement — correct restrained typography. The `no-select` correctly applies the anti-cheat-flavoured CSS `user-select: none`.
- Palette cells use both a colour AND a symbol (✓ / ⚑) — colour-blind safety per PRD §5.2 AC. Properly inclusive.
- The exam-muscle-memory palette intensity switches via `data-palette` attribute on the runtime root — correctly honours design lock #3. ✓
- Sync-pending dot in the bottom-left of the cell is subtle and informative — students who watch closely see "my answer is saving" without being intruded on.
- Action buttons follow the correct hierarchy: primary (Save & Next) → secondary (outlined) → tertiary (text-only for Clear Response). Lock-aligned.
- The 30s heartbeat poll keeps the timer accurate over a 3-hour test — engineered for the real failure mode (sleeping laptop drift).

**Score: 7/10** — the core layout is JEE-Advanced-faithful and the polish is real (KaTeX bump, focus rings, colour-blind safety). But the MAT-COL List-II rendering gap is a HARD usability bug, the missing section tabs are a future-proofing gap, the palette is denser than spec, and the section-summary strip is in the wrong place.

---

## FLOW D — An Anti-Cheat Violation

**Files:** `frontend/src/lib/anti-cheat.ts`, `ViolationBanner.tsx`, `RuntimeProvider.tsx`

**What I see — violation 1 (I tab-switched to check WhatsApp)**
A full-width amber banner slams in across the top of the runtime (above everything). Reads "Violation 1 of 3 — tab switch detected. Your test will be auto-submitted on the 3rd violation." Background `#F59E0B` (warm amber), dark text. After 5 seconds it auto-dismisses. A small amber chip appears in the top-bar "Violations: 1/3" and persists.

**What I see — violation 2 (I tried to right-click)**
The full-width banner re-appears, now in `#F97316` (amber-red), white text. "Violation 2 of 3 — right-click attempt detected. …" Five seconds, auto-dismisses. The chip in top-bar reads "Violations: 2/3".

**What I see — violation 3 (I pressed F12)**
The banner re-appears in `#DC2626` (saturated red), white text, **bold**. "Violation 3 of 3 — devtools shortcut detected. Auto-submitting your test now." The runtime locks inputs. The submit modal opens with "Saving your answers… N answers pending." Then I'm pushed to the results page where I see a red banner explaining the auto-submit and a violation timeline.

**What I expect**
A coaching portal usually slams a red modal at me on violation 1, which I tune out. The progressive escalation here matches a human proctor: nudge → firm warning → enforcement. This is actually well thought-out — I'd respect it more than a one-shot red banner.

**What I'd do**
- Violation 1: oh, oops. Eyes-back-on-screen. Not panicked.
- Violation 2: serious nervousness now. Less likely to test the limits.
- Violation 3: knows it's coming, can prepare.

**What confuses me / breaks flow**
- **The 5 s auto-dismiss is RIGHT at the boundary** of "long enough to read" and "short enough to not be in my way". A student under stress at violation 3 — when the auto-submit is firing — might have the banner dismiss BEFORE they understand what's happening, and then the submit modal appears with "Saving your answers…" and the student panics because the explanation banner is gone. **MED severity.** Suggest: keep violation 3 banner persistent through the submit handshake.
- The PRD §5.2 says the violation banner has `role="status"` and `aria-live="assertive"`. Implementation: `role="status"` + `aria-live="assertive"`. ✓ Correct.
- The PRD says copy should be "Violation N of 3 — <human-readable type> detected. Your test will be auto-submitted on the 3rd violation." Implementation matches this for levels 1-2; level 3 swaps the trailing sentence for "Auto-submitting your test now." Subtle but correct intent.
- **`F12` is captured by the `onKeyDown` handler, BUT the handler ONLY runs if the browser hasn't already trapped F12 to open devtools.** In Chrome, F12 IS captured by the browser before the page's keydown listener fires (depending on focus state). So a determined cheater pressing F12 gets devtools open AND the violation logged (kind of), or just devtools open. Honest scope per PRD §5.9 — but worth noting the student MAY see no banner on F12 in some browsers.
- **Window blur fires `fire('WINDOW_BLUR')` after a 0-ms `setTimeout`** — fine. But what about Windows toast notifications (Outlook ping, Slack ping)? They steal focus for a fraction of a second. The runtime would log this as a violation. Pilot student gets penalised for a system notification they didn't trigger. **MED severity false-positive risk.** PRD §3.2 leading-indicator #6 tracks this, so the team knows to monitor it.
- **`document.hasFocus()` check in `onBlur`** — good, avoids some false positives. But it doesn't catch the case where focus moves to a system-modal that doesn't change `document.hasFocus()`. Acceptable trade-off.
- The "Violations: 1/3" chip in the top-bar uses `bg-amber-50 text-amber-800 border-amber-200` — Tailwind amber palette, NOT the design-lock anti-cheat ramp (`--violation-1-bg`, etc.). Token discipline drift again. Low severity but visible.
- I'd feel fairly treated by the escalation. I would NOT feel railroaded.

**What looks great**
- Progressive escalation matches a real proctor's psychology. NotebookLM-grade restraint applied to a stress scenario.
- The "Violations: N/3" chip persists in the top-bar so I always know my running count — no surprises.
- Auto-submit on violation 3 drains the queue (10 s max) BEFORE posting submit — my answers don't get lost. PRD US-9 AC verified.
- `installAntiCheat()` returns a `dispose` function and is called on cleanup. No leaked listeners. Good engineering.

**Score: 8/10** — the centerpiece UX of anti-cheat is the strongest part of the implementation. Honest about its limits, progressive in its enforcement, and trustworthy in feel. Small token-discipline drift and the 5 s dismissal at violation 3 are the only real issues.

---

## FLOW E — My Session Expires Mid-Test (NEW-1 fix)

**Files:** `frontend/src/components/test-runtime/AuthErrorBanner.tsx`, `RuntimeProvider.tsx`, `session-fetch.ts`, `session-auth.ts`, `frontend/src/lib/telemetry-queue.ts`

**What I see**
I'm on Q15 of 18. My eyes are on the question statement. Suddenly a modal-like card overlays the centre of my screen: "Your session ended" as the headline, then "Please sign in again to continue this test. Your answers so far are saved on this device and will sync once you are signed back in." Then a single blue "Sign in" button (autofocused). Behind the card, the runtime is dimmed by a `bg-black/40` backdrop. The timer is still visibly counting in the (greyed-out) top-bar — it has NOT been paused.

I click "Sign in". I'm taken to `/login?return_to=/test/[sessionId]`. The login form now shows the small grey note "Your test session ended. Sign in to continue." above the email/password fields. I sign in. I'm returned to the test. The queue drains. My answers from Q1-Q14 are still there (yay — `revealedHints`, `snapshots`, etc. are local React state that survived because the page never unmounted… wait, did it?).

**What I expect**
A coaching portal usually just navigates me back to login and I lose everything. I expect to be told whether my answers are SAFE before clicking Sign in.

**What I'd do / think**
- "Your session ended" → "Wait, what does that mean? Did I cheat? Did my internet die?" The copy is ambiguous — it could mean the server cookie expired (the actual cause) or a session timeout, or that I did something wrong. **MED severity** — a student under stress reads this as "I did something wrong".
- "Your answers so far are saved on this device" — this is the reassurance I need. Good. But the word "device" is ambiguous — does my answer survive if I close the tab? (Yes, IndexedDB persists across reload. But the student doesn't know that.)
- I click Sign in. Modal goes away, I land on /login. The "Your test session ended. Sign in to continue." note is reassuring.
- After re-login I'm back on the test. Q15 is where I left off. ✓ — `nextUrl` allow-list correctly only honours `/test/...` paths.

**What confuses me / breaks flow**
- **The timer KEEPS RUNNING during the auth-error window.** Per PRD §5.4 the timer is server-anchored — it doesn't pause for the re-auth detour. Realistically, the student loses 30-60 seconds of clock time to find their password and re-login. This is by-design (the server cron will auto-submit at expiry regardless), and `handleTimerExpiry` short-circuits if `authErrorRef.current` is set so it won't autosubmit while you're authenticating — but the student doesn't know any of this. The visible timer just keeps ticking. **HIGH severity** for student trust: the student needs to know "your test clock has paused" OR "your test clock is STILL running, hurry". Currently neither message is shown. The AuthErrorBanner copy should explicitly say one or the other.
- **Where is the "queued telemetry drains" message after re-login?** The `localFallbackPosted` banner shows "Submitted locally; will sync when you reconnect." but this is for a DIFFERENT branch (NETWORK_FAILURE_FALLBACK). After auth recovery, there's no explicit "✓ your answers are now synced" toast. The student is left wondering whether their Q1-Q14 answers actually made it to the server. **MED severity**.
- **The headline "Your session ended" reads like the test ended, not the auth session.** A non-tech-savvy student doesn't distinguish "auth session" from "test session". Suggested copy: "We need you to sign in again — your answers are safe." or "Sign in to keep going — your test isn't over."
- **The `AuthErrorBanner` doesn't show how much of the test is left** — "you have 1h 23m remaining" — which would calm the student's panic. Just shows the message and the button.
- **The auth-error state suppresses NETWORK_FAILURE_FALLBACK correctly** — good. But if the student CLOSES the modal (they can't, it's `aria-modal="true"`) or clicks the backdrop (they can't, no handler), they're stuck. Good — but the only ESCape is the Sign in button. Acceptable.
- **No Cancel / Continue without saving option.** This is correct — there's no safe path forward without re-auth. But a student in panic might want a "Save my answers to a file" lifeline. Out of scope, but mentionable.
- **The runtime header is partially visible behind the backdrop** — the student CAN see their timer counting, which adds to the anxiety. Suggest: blur the runtime behind the backdrop, or explicitly say "Time will continue to count down. We recommend signing in immediately."

**What looks great**
- The decision to route 401 to `AuthErrorBanner` instead of `NETWORK_FAILURE_FALLBACK` is correct and prevents silent data loss. Engineered well.
- `SessionAuthError` sentinel + `SessionAuthError.is(err)` predicate handles cross-realm `instanceof` traps. Solid TypeScript.
- The login allow-list (only `/test/...`) on `return_to` prevents open-redirect. Security-correct.
- `inputsDisabled` includes `authError === 'expired_session'` — locks the runtime correctly. Good.
- The `/login?return_to=...` round-trip path is the right UX (vs. a "click here to refresh" or a "manually navigate back" detour).

**Score: 6/10** — the engineering is correct; the messaging is not. The student is left wondering whether the timer paused, whether their answers are safe, and whether they did something wrong. A reassurance pass on the AuthErrorBanner copy + an explicit post-recovery "answers synced" toast would lift this to 8.

---

## FLOW F — Submit & Results

**Files:** `frontend/src/components/test-runtime/SubmitConfirm.tsx`, `frontend/src/app/test/[sessionId]/results/page.tsx`

**What I see — Submit confirm step 1**
I click "Submit Test" in the top-bar. A modal opens (centred, max-width 448 px, `rounded-2xl`, `bg-surface-0`, `shadow-xl`). Headline: "Submit your test?" Below: a 2-column dl-list with my counts. "Answered: 16", "Marked & Answered: 0", "Marked for Review: 0", "Visited not answered: 2 ⚠" (in amber), "Not visited: 0 ⚠" (in amber if > 0). Time remaining "Time remaining: 01:23:45". If unanswered > 0, an amber-tinted callout reads "⚠ You have 2 questions you haven't answered. Review before submitting?"

Two buttons bottom-right: "Continue test" (outlined, secondary) and "Submit now" (filled, primary, accent).

**What I see — Submit confirm step 2**
I click "Submit now". The modal swaps to a simpler view: "You are about to submit" headline, body "After submitting you cannot return to the test. Please confirm." Two buttons: "Cancel" (outlined, AUTOFOCUSED) and "Confirm submit" (filled).

**What I expect**
This is exactly the NTA two-step submit pattern. Muscle memory matches. The autofocus on Cancel (so pressing Enter does NOT submit) is the gold-standard pattern.

**What I'd do**
Read the step-1 summary. Notice 2 unanswered → click "Continue test" to go back. Answer them. Hit Submit Test again. Step 1 again, all answered now → "Submit now" → Step 2 → "Confirm submit".

**What confuses me / breaks flow**
- **The "draining" modal that appears after Confirm submit shows "Saving your answers… N answer(s) pending. Please do not close this tab."** Good copy. BUT: it does NOT show a progress indicator (no spinner, no progress bar, no animated dots). Per the Auditor's 3-second rule, if N is large and the drain takes 5+ seconds, the modal looks frozen. **MED severity.**
- The "Visited not answered" and "Not visited" warn-rows use `text-amber-600` from Tailwind, not the design-lock violation/warning tokens. Token drift.
- The step-1 modal lists "Marked for Review" (purple in palette) but renders it as amber-warn `⚠` colour. The PRD US-6 says purple banner — implementation uses amber for warning. Visual inconsistency between palette colour (purple) and submit-modal colour (amber). MED severity.
- No "Q3, Q7, Q11" per-question chip list in the unanswered callout, only a count. PRD US-6 AC says "those questions are listed with a count and a per-question chip (slot 3, slot 7, slot 11 — displayed as 'Q3, Q7, Q11')". Implementation skips this. **MED severity** — a student wanting to "just check Q7 and Q11" can't tell which ones are unanswered without scanning the palette.
- The `unanswered = counts.visited_not_answered + counts.not_visited + counts.marked` formula INCLUDES `marked` — but a student who marked-and-answered a question doesn't have it counted as unanswered (`marked_and_answered` is separate). However, a question that is MARKED but not answered IS counted. PRD US-6 has separate yellow and purple banners for these two cases. Implementation collapses them into one amber bar. LOW–MED severity.

**What I see — Results page**
A clean stacked layout. If auto-submitted: a top alert banner (red for violation-threshold, amber for timer/network-fallback). Below: a white card with the test title, score "16 / 18", time used "1h 23m 45s". Below that, if there were violations, a violation timeline card. Below that, a stack of per-question cards.

Each question card has: "Question N" header with a status chip (CORRECT in green / WRONG in red / SLOW_BUT_CORRECT in yellow / UNANSWERED in grey). The chip shows the score delta "(+4)" or "(−1)" or "(+0)". Below, the KaTeX statement re-rendered. Below, a 4-column grid: Your answer / Correct / Time / Visits (and Hints used if > 0). If wrong with a `wrong_paths_match`, an amber-tinted "Diagnostic" callout shows the one-line label + failure-mode chips. A `<details>` collapsible "Show solution" expands to reveal the model solution.

**What I'd think**
"OK. 16/18, +60, beat last week." I scroll. I see a wrong question with the Diagnostic callout: "Algebra-slip while expanding (1-x)^4". I read it. I understand what I did. I click "Show solution" — the model solution unfolds. I learned something.

**What confuses me / breaks flow**
- The "Show solution" `<details>` element is the native browser disclosure widget — no styling on the marker triangle. A `summary` with `cursor-pointer` and accent text — passable but not polished. The native triangle on Safari vs Chrome looks different. Low severity polish issue.
- The Diagnostic callout uses `bg-amber-50 border-amber-200` and amber text. Even for a CORRECT answer in SLOW_BUT_CORRECT state, the diagnostic uses warning-amber. A "right answer, slow path" should feel like progress, not penalty. Suggest a different token for SLOW vs WRONG. MED severity.
- The status chip says "right answer, slow path (+4)" for SLOW_BUT_CORRECT — good copy. Other statuses show the raw uppercase ("CORRECT (+4)", "WRONG (−1)", "UNANSWERED (+0)"). Inconsistent style (mixed case vs upper). LOW severity.
- The per-question card has no "Try similar drill" link. PRD-01 references this as a follow-up; for v1 it's out of scope, but a student finishing the review with no next-action feels strung.
- The total-score line "Score: 16 / 18" is buried in the header card, not BIG. PRD US-8 AC says "total score, per-section score, time used per section". Implementation shows total score in a 2xl semibold headline but no PER-SECTION score breakdown. For v1 single-section, this is honest; for v2 multi-section, students need to see "Maths 28/36, Physics 24/36, Chem 20/36" prominently. LOW severity for v1.
- The violation timeline doesn't show how the violations were distributed across questions — just timestamps and types. A student who got auto-submitted might want to know "I lost the test at Q12" not just "I tab-switched at 11:42 AM". LOW severity.

**What looks great**
- The two-step submit pattern is JEE-Advanced-faithful and the autofocus on Cancel is correct.
- The diagnostic-axis card (when present) is the killer feature — surfaces the failure mode in plain language. This is what differentiates the platform.
- StatusChip with score delta inline ("+4") gives me instant signal per question. Good.
- The "marked & answered" count is correctly displayed as separate from "marked" (per PRD §0 glossary).
- "Time used: 1h 23m 45s" formatting — clean, plain English.

**Score: 7/10** — works, satisfying enough for a 3-hour test, with the diagnostic card being the standout. Loses points on missing per-question unanswered chips, monochrome warning treatment for SLOW_BUT_CORRECT, and the un-styled `<details>` solution toggle.

---

## FLOW G — Mobile (< 768 px)

**Files:** `frontend/src/components/test-runtime/MobileBlock.tsx`

**What I see**
On my Realme C25 phone in the Saturday-morning hostel (laptop battery dead), I navigate to `/test/abc123`. The runtime detects `(max-width: 767px)` and renders `MobileBlock` instead. A clean centred card with "Use a larger screen" headline, a paragraph explaining the runtime needs ≥ 768 px ("The question palette, answer entry, and timer don't fit comfortably on a phone."), a quieter line "You can still view your dashboard and past results on your phone.", and a blue button "Back to dashboard".

**What I expect**
A coaching portal usually just renders broken layout. The clean refusal-with-explanation is way more polished. ✓ Matches design-lock #4.

**What I'd do / think**
"OK, my phone won't work. The explanation is reasonable. Let me find a laptop." Click "Back to dashboard" → land on /dashboard (which doesn't exist in this project — same broken-dashboard issue as Flow A).

**What confuses me / breaks flow**
- "Back to dashboard" — same /dashboard route that doesn't have a `page.tsx`. Broken link. **HIGH severity** since this is the ONLY action the student can take from the mobile-block screen.
- The copy is good but doesn't acknowledge the student's situation: "If your laptop is unavailable right now, please contact your teacher about rescheduling." would close the loop.
- No timer / countdown showing on the mobile block — student doesn't know if their test window is already running and they're burning the clock by trying their phone first. Med severity.

**What looks great**
- The hard-block decision (not graceful-degrade) is correct per design-lock #4. Anti-cheat reliability on mobile is genuinely poor.
- Honest explanation of WHY (palette + answer entry + timer don't fit). Doesn't just say "no".
- The button is full-width-feeling (px-6, h-10) and the only affordance — clear next step (even if broken).

**Score: 7/10** — the screen itself is well-designed but the "Back to dashboard" goes nowhere.

---

## Composite & Summary

| Flow | Score | One-line |
|---|---|---|
| A — First-time login | 6/10 | Works, unbranded, dashboard route missing |
| B — Pre-test instructions | 7/10 | Clear, but breaks single-accent rule and skips section breakdown |
| C — Test runtime | 7/10 | JEE-faithful core, MAT-COL List-II rendering bug, missing section tabs |
| D — Anti-cheat violation | 8/10 | Strongest flow; well-thought-out escalation |
| E — Auth expiry mid-test | 6/10 | Engineering correct, messaging poor; student trust at risk |
| F — Submit & results | 7/10 | Two-step submit good; diagnostic card excellent; minor polish gaps |
| G — Mobile block | 7/10 | Honest, calm — but "Back to dashboard" is a dead link |

**Composite: 6.9 / 10**

---

## Top 3 Strengths

1. **The anti-cheat progressive escalation (Flow D) is genuinely well-designed.** Amber → amber-red → red matches a real proctor's psychology, the persistent N/3 chip removes surprise, queue-drain-before-submit prevents data loss. The strongest UX call in the build.
2. **The diagnostic-axis card on results (Flow F) is the killer differentiator.** A wrong answer with a one-line failure-mode label + chips beats every coaching portal's score-only feedback. This justifies the entire platform.
3. **Design-token discipline is mostly held: `data-palette` switches hybrid intensity, KaTeX is bumped to 1.05em, `no-select` is correctly applied, focus rings use `--accent`.** The NotebookLM-restraint goal is visible in the runtime's silhouette.

---

## Top 3 Issues That Affect Student Trust or Flow

1. **[HIGH] MAT-COL dropdown options use `stripTex()` which strips LaTeX.** Any MAT-COL problem with `$\frac{1}{2}$` or `$\sin\theta$` in List-II becomes literally illegible in the dropdown. The author's comment says labelled List-II appears separately above the matching grid, but `QuestionPane.tsx` does NOT render labelled List-II options anywhere. JEE Advanced MAT-COL questions are a core question type — this would block a real Advanced mock.
   Source: `frontend/src/components/test-runtime/AnswerEntry/MatColumnEntry.tsx:67-69, 79-83` + missing render in `frontend/src/components/test-runtime/QuestionPane.tsx`.

2. **[HIGH] Auth-error timer behaviour invisible to student (Flow E).** The visible timer keeps ticking during the re-auth detour; the student doesn't know if the clock is paused or running. PRD §5.4 + Architecture make it server-anchored (so it IS running) but the student needs to be told. A panicked student loses 30-60 s of test-clock to a server-revoked cookie they didn't cause and they have no context about what's happening to their answers OR their time.
   Source: `frontend/src/components/test-runtime/AuthErrorBanner.tsx:51-55` (copy doesn't mention timer state; no time-remaining shown).

3. **[HIGH] `/dashboard` route does not exist** (Flow A, Flow E post-login, Flow G mobile-block). Every "happy path" exit from the runtime points to `/dashboard`, but `frontend/src/app/dashboard/page.tsx` does not exist. A first-time login lands on 404. A mobile-blocked student lands on 404. A re-authed student MAY land on 404 unless `return_to` is set to a `/test/...` path.
   Source: `frontend/src/app/login/LoginForm.tsx:40`, `frontend/src/app/login/page.tsx:28`, `frontend/src/components/test-runtime/MobileBlock.tsx:28`.

---

## Honourable Mentions (MED severity, do not block)

- Section-summary strip is below the answer entry instead of in the palette rail (PRD §7.5 placement spec drift).
- Palette is 5-col / 8 px gap, not 8-col / 4 px gap as PRD §7.5 specifies. Feels cramped.
- Submit-confirm modal doesn't list which questions are unanswered (no "Q3, Q7, Q11" chips).
- Instructions page uses two distinct blues (the design-lock accent `#3754C5` AND Tailwind's `blue-50`/`blue-200` tint blocks). Single-accent rule violation.
- "Submit Test" button and timer in top bar visually compete (both in accent colour).
- Window-blur fires violations on Windows system toasts — false-positive risk.
- Violation banner at level 3 auto-dismisses at 5 s — likely too short while auto-submit is firing.

---

## Verdict

**LOOP BACK to Engineer.** The composite of 6.9 is below the agent-factory's 7/10 gate threshold, and there are three HIGH-severity issues that genuinely damage student trust on first contact (MAT-COL legibility, auth-error timer ambiguity, and the broken /dashboard route).

**Priority order for the loop-back fix list (do in order):**

1. **Create `/dashboard/page.tsx`** OR change every redirect target to a route that DOES exist. This is a 1-day fix and is currently a blocking broken-state.
2. **Render labelled List-II options above the MAT-COL grid in `QuestionPane.tsx`** so the dropdown's stripped-LaTeX is just a picker reference, not the only place students see List-II content.
3. **Rewrite the `AuthErrorBanner` copy** to (a) say explicitly whether the timer pauses or continues, (b) show time remaining, (c) confirm answers are durably stored, (d) add a post-recovery "answers synced" toast.
4. Add per-question unanswered chips to the Submit-confirm step-1 modal (PRD US-6 AC compliance).
5. Add the labelled-diagram UI walkthrough to the Instructions page (PRD US-2 AC compliance).
6. Replace Tailwind `amber-*` / `blue-*` ad-hoc colours with the design-lock `--violation-*` and `--accent-subtle-bg` tokens for token-discipline consistency.

The architecture and engineer have delivered a runtime that is, on the whole, a meaningful step up from coaching-portal alternatives. But it's not yet JEE-Advanced-grade polish. One more loop will get it there.

— UX Auditor, iteration 1, 2026-06-28
