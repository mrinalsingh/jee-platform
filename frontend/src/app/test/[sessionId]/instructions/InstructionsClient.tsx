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

        <section className="bg-amber-50 border border-amber-200 rounded-lg p-4">
          <h2 className="text-base font-semibold text-amber-900 mb-2">
            Anti-cheat notice
          </h2>
          <p className="text-sm text-amber-900">
            This is a proctored test. Right-click, copy, paste, and tab-switching
            are disabled. <strong>Three violations will auto-submit your
            test.</strong> Please close all other tabs before starting.
          </p>
        </section>

        {hintsAvailable && (
          <section className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <h2 className="text-base font-semibold text-blue-900 mb-2">
              Hints
            </h2>
            <p className="text-sm text-blue-900">
              Each question has 1–4 hints. Using a hint is logged and shown to
              your teacher. Hints are not solutions — they nudge you toward the
              idea.
            </p>
          </section>
        )}

        {error && (
          <p role="alert" className="text-sm text-red-700">
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
