import { redirect } from 'next/navigation';

import { renderMathString } from '@/lib/katex-render';
import { fetchResults } from '@/lib/session-fetch';

/**
 * Post-test review (PRD US-8).
 *
 * Read-only server component. Renders score summary, per-question breakdown
 * with the diagnostic-axis failure-mode chip (when the matcher found one),
 * the auto-submit banner if applicable, and the violation timeline.
 */
export default async function ResultsPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}): Promise<React.ReactElement> {
  const { sessionId } = await params;
  const data = await fetchResults(sessionId);
  if (!data) {
    redirect('/login?next=/test/' + encodeURIComponent(sessionId) + '/results');
  }

  const autoSubmitNote = autoSubmitMessage(data.auto_submit_source);

  return (
    <main className="min-h-screen bg-surface-1 px-6 py-10">
      <div className="max-w-3xl mx-auto space-y-6">
        {autoSubmitNote && (
          <div
            role="alert"
            className={`rounded-lg p-4 ${
              data.auto_submit_source === 'VIOLATION_THRESHOLD'
                ? 'bg-red-100 border border-red-300 text-red-900'
                : 'bg-amber-50 border border-amber-200 text-amber-900'
            }`}
          >
            {autoSubmitNote}
          </div>
        )}

        <header className="bg-surface-0 border border-border-subtle rounded-2xl p-6 space-y-2">
          <h1 className="text-2xl font-semibold">{data.test_title}</h1>
          <p className="text-text-secondary">
            Score:{' '}
            <span className="text-text-primary font-medium">
              {data.total_score}
            </span>{' '}
            / {data.max_score}
          </p>
          <p className="text-text-secondary text-sm">
            Time used: {formatDuration(data.duration_used_seconds)}
          </p>
        </header>

        {data.violations.length > 0 && (
          <section className="bg-surface-0 border border-border-subtle rounded-2xl p-6">
            <h2 className="text-lg font-medium mb-2">Violation timeline</h2>
            <ol className="space-y-1 text-sm text-text-secondary">
              {data.violations.map((v, i) => (
                <li key={i}>
                  <time dateTime={v.violation_timestamp}>
                    {new Date(v.violation_timestamp).toLocaleTimeString()}
                  </time>
                  {' — '}
                  {v.violation_type.toLowerCase().replace(/_/g, ' ')}
                </li>
              ))}
            </ol>
          </section>
        )}

        <section className="space-y-4">
          {data.per_question.map((q) => (
            <article
              key={q.slot_position}
              className="bg-surface-0 border border-border-subtle rounded-2xl p-6 space-y-3"
            >
              <header className="flex items-baseline justify-between">
                <h3 className="text-lg font-medium">
                  Question {q.slot_position}
                </h3>
                <StatusChip status={q.status} delta={q.score_delta} />
              </header>
              <div
                className="text-text-primary prose-runtime"
                dangerouslySetInnerHTML={{
                  __html: renderMathString(q.statement),
                }}
              />
              <dl className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-sm">
                <dt className="text-text-secondary">Your answer</dt>
                <dd className="font-mono">{q.your_answer ?? '—'}</dd>
                <dt className="text-text-secondary">Correct</dt>
                <dd className="font-mono">{q.correct_answer ?? '—'}</dd>
                <dt className="text-text-secondary">Time</dt>
                <dd>{q.time_seconds}s</dd>
                <dt className="text-text-secondary">Visits</dt>
                <dd>{q.visit_count}</dd>
                {q.hints_used > 0 && (
                  <>
                    <dt className="text-text-secondary">Hints used</dt>
                    <dd>
                      {q.hints_used} ({q.hint_levels_revealed.join(', ')})
                    </dd>
                  </>
                )}
              </dl>
              {q.wrong_paths_match && (
                <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 text-sm">
                  <p className="font-medium text-amber-900 mb-1">
                    Diagnostic
                  </p>
                  <p className="text-amber-900">
                    {q.wrong_paths_match.one_line_label}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {q.wrong_paths_match.failure_modes.map((mode) => (
                      <span
                        key={mode}
                        className="px-2 py-0.5 text-xs rounded-full bg-amber-100 text-amber-900 border border-amber-300"
                      >
                        {mode}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {q.solution && (
                <details className="text-sm">
                  <summary className="cursor-pointer text-[var(--accent)]">
                    Show solution
                  </summary>
                  <div
                    className="mt-2 text-text-primary"
                    dangerouslySetInnerHTML={{
                      __html: renderMathString(q.solution),
                    }}
                  />
                </details>
              )}
            </article>
          ))}
        </section>
      </div>
    </main>
  );
}

function autoSubmitMessage(src: string | null): string | null {
  switch (src) {
    case 'TIMER_EXPIRY':
      return 'This test was auto-submitted at the timer.';
    case 'VIOLATION_THRESHOLD':
      return 'This test was auto-submitted after 3 anti-cheat violations. Your teacher has been notified.';
    case 'NETWORK_FAILURE_FALLBACK':
      return 'This test was auto-submitted on the network-failure fallback path. Some answers may not have synced.';
    default:
      return null;
  }
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function StatusChip({
  status,
  delta,
}: {
  status: 'CORRECT' | 'WRONG' | 'UNANSWERED' | 'SLOW_BUT_CORRECT';
  delta: number;
}): React.ReactElement {
  const cls =
    status === 'CORRECT'
      ? 'bg-emerald-100 text-emerald-900 border-emerald-200'
      : status === 'SLOW_BUT_CORRECT'
        ? 'bg-yellow-50 text-yellow-900 border-yellow-200'
        : status === 'WRONG'
          ? 'bg-red-100 text-red-900 border-red-200'
          : 'bg-gray-100 text-gray-800 border-gray-200';
  const label =
    status === 'SLOW_BUT_CORRECT' ? 'right answer, slow path' : status;
  const sign = delta > 0 ? '+' : '';
  return (
    <span
      className={`text-xs px-2 py-1 rounded-full border font-medium ${cls}`}
    >
      {label} ({sign}
      {delta})
    </span>
  );
}
