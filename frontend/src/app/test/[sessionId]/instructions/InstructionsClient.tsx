'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import { requestRuntimeFullscreen } from '@/lib/anti-cheat';

export interface InstructionsClientProps {
  sessionId: string;
  testTitle: string;
  durationMinutes: number;
  sectionLabel: string;
  markingSchemeSummary: string;
  hintsAvailable: boolean;
  totalQuestions: number;
}

export function InstructionsClient(
  props: InstructionsClientProps,
): React.ReactElement {
  const {
    sessionId,
    testTitle,
    durationMinutes,
    sectionLabel,
    markingSchemeSummary,
    hintsAvailable,
    totalQuestions,
  } = props;
  const router = useRouter();
  const [acknowledged, setAcknowledged] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onStart = async (): Promise<void> => {
    if (!acknowledged) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/test-sessions/${encodeURIComponent(sessionId)}/state`,
        {
          method: 'PUT',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'START' }),
        },
      );
      if (!res.ok) {
        setError(
          res.status === 410
            ? 'This test window has closed.'
            : "Couldn't start your test — please try again.",
        );
        return;
      }
      // Fire-and-forget fullscreen — must run synchronously inside the user
      // gesture (the click handler) per browser policy.
      void requestRuntimeFullscreen();
      router.push(`/test/${encodeURIComponent(sessionId)}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="min-h-screen bg-surface-1 flex justify-center px-6 py-12">
      <article className="w-full max-w-2xl bg-surface-0 border border-border-subtle rounded-2xl p-8 space-y-6">
        <header>
          <h1 className="text-3xl font-semibold">{testTitle}</h1>
          <p className="text-text-secondary mt-1">
            {sectionLabel} · {durationMinutes} minutes · {totalQuestions}{' '}
            questions
          </p>
        </header>

        <section>
          <h2 className="text-lg font-medium mb-2">Marking scheme</h2>
          <p className="text-text-secondary">{markingSchemeSummary}</p>
        </section>

        <section>
          <h2 className="text-lg font-medium mb-2">Palette colour key</h2>
          <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
            <LegendItem
              color="bg-[var(--palette-answered-bg)]"
              label="Answered"
            />
            <LegendItem
              color="bg-[var(--palette-visited-bg)]"
              label="Visited, not answered"
            />
            <LegendItem
              color="bg-[var(--palette-marked-bg)]"
              label="Marked for review"
            />
            <LegendItem
              color="bg-[var(--palette-not-visited-bg)] border border-border-subtle"
              label="Not visited"
            />
          </ul>
        </section>

        {/* [UX Audit v1 MED-4 + MED-3] — UI walkthrough mockup so first-time
           students know what each region of the runtime does. PRD US-2 AC:
           "a labelled diagram of the test runtime UI (palette, question
           pane, action buttons)". */}
        <section aria-label="Runtime UI walkthrough">
          <h2 className="text-lg font-medium mb-2">What the test screen looks like</h2>
          <RuntimeWalkthrough />
          <p className="text-xs text-text-secondary mt-2">
            Left: question and answer entry. Right: numbered palette + timer + Submit.
          </p>
        </section>

        <section className="bg-[var(--warn-bg)] border border-[var(--warn-border)] rounded-lg p-4">
          <h2 className="text-base font-semibold text-[var(--warn-text)] mb-2">
            Anti-cheat notice
          </h2>
          <p className="text-sm text-[var(--warn-text)]">
            This is a proctored test. Right-click, copy, paste, and tab-switching
            are disabled. <strong>Three violations will auto-submit your
            test.</strong> Please close all other tabs before starting.
          </p>
        </section>

        {hintsAvailable && (
          <section className="bg-[var(--info-bg)] border border-[var(--info-border)] rounded-lg p-4">
            <h2 className="text-base font-semibold text-[var(--info-text)] mb-2">
              Hints
            </h2>
            <p className="text-sm text-[var(--info-text)]">
              Each question has 1–4 hints. Using a hint is logged and shown to
              your teacher. Hints are not solutions — they nudge you toward the
              idea.
            </p>
          </section>
        )}

        {error && (
          <p role="alert" className="text-sm text-[var(--danger-fg)]">
            {error}
          </p>
        )}

        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={acknowledged}
            onChange={(e) => setAcknowledged(e.target.checked)}
            className="mt-1 accent-[var(--accent)]"
            aria-label="Acknowledge instructions"
          />
          <span className="text-text-primary">
            I have read and understood the instructions.
          </span>
        </label>

        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => void onStart()}
            disabled={!acknowledged || submitting}
            className="px-6 h-10 rounded-lg bg-[var(--accent)] text-[var(--accent-on)] disabled:opacity-50 disabled:cursor-not-allowed hover:bg-[var(--accent-strong)]"
          >
            {submitting ? 'Starting…' : 'Start Test'}
          </button>
        </div>
      </article>
    </main>
  );
}

function LegendItem({
  color,
  label,
}: {
  color: string;
  label: string;
}): React.ReactElement {
  return (
    <li className="flex items-center gap-2">
      <span className={`inline-block h-4 w-4 rounded ${color}`} />
      <span>{label}</span>
    </li>
  );
}

/**
 * Inline SVG walkthrough of the runtime layout. Kept under 30 lines of JSX
 * per spec. Uses design tokens via `currentColor` and inline rgb(var()) so
 * the diagram themes automatically with the rest of the page.
 */
function RuntimeWalkthrough(): React.ReactElement {
  return (
    <svg
      role="img"
      aria-label="Diagram of the test runtime layout"
      viewBox="0 0 480 200"
      className="w-full h-auto border border-border-subtle rounded-lg bg-surface-1"
    >
      <rect x="0" y="0" width="480" height="28" fill="var(--surface-2)" />
      <text x="10" y="18" fontSize="10" fill="var(--text-secondary)">Top bar — title · timer · Submit</text>
      <rect x="6" y="36" width="320" height="158" fill="var(--surface-0)" stroke="var(--border-subtle)" />
      <text x="14" y="54" fontSize="10" fill="var(--text-primary)" fontWeight="600">Question pane</text>
      <text x="14" y="72" fontSize="9" fill="var(--text-secondary)">Statement + KaTeX math</text>
      <rect x="14" y="86" width="290" height="38" rx="4" fill="var(--accent-subtle-bg)" stroke="var(--accent)" />
      <text x="22" y="108" fontSize="9" fill="var(--text-primary)">Answer entry (A/B/C/D, numeric, MAT-COL)</text>
      <rect x="14" y="138" width="70" height="20" rx="4" fill="var(--accent)" />
      <text x="22" y="152" fontSize="9" fill="var(--accent-on)">Save &amp; Next</text>
      <rect x="92" y="138" width="120" height="20" rx="4" fill="var(--surface-0)" stroke="var(--border-subtle)" />
      <text x="100" y="152" fontSize="9" fill="var(--text-primary)">Mark for Review</text>
      <rect x="334" y="36" width="140" height="158" fill="var(--surface-0)" stroke="var(--border-subtle)" />
      <text x="344" y="54" fontSize="10" fill="var(--text-primary)" fontWeight="600">Palette</text>
      {Array.from({ length: 16 }).map((_, i) => (
        <rect key={i} x={344 + (i % 8) * 16} y={62 + Math.floor(i / 8) * 16} width="12" height="12" rx="2" fill={i < 5 ? 'var(--palette-answered-bg)' : 'var(--palette-not-visited-bg)'} stroke="var(--border-subtle)" />
      ))}
      <text x="344" y="118" fontSize="9" fill="var(--text-secondary)">Click a number to jump.</text>
      <text x="344" y="138" fontSize="9" fill="var(--text-secondary)">Shift-click to mark.</text>
    </svg>
  );
}
