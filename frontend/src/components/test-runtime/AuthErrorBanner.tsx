'use client';

/**
 * AuthErrorBanner — full-screen, layered card shown when the server has
 * explicitly rejected the session cookie mid-test (HTTP 401 from the heartbeat
 * poll or the telemetry queue dispatch).
 *
 * [UPDATED v3 — NEW-1]
 * [UPDATED — UX Audit v1 loop-back, HIGH-2]
 *
 * Why a separate component (not ViolationBanner):
 *   • This is NOT a cheating / violation event — the student did nothing
 *     wrong, so the colour is neutral (slate / accent), never red.
 *   • The flow halts the runtime: the telemetry queue is dormant and the
 *     only sensible next action is to re-authenticate. So the card is
 *     blocking, not the 5-s auto-dismiss pattern that ViolationBanner uses.
 *   • Mobile-responsive: the card centres in the viewport and shrinks to
 *     the available width with a comfortable max-width on desktop.
 *
 * Why the timer-status copy (HIGH-2 fix):
 *   • The test timer is SERVER-ANCHORED — it does NOT pause during the
 *     re-auth detour (the server-side cron will still notice T=0). The
 *     student must know this so they don't lose the test by taking their
 *     time at the login form. Showing the remaining time prominently calms
 *     the panic about "what's happening to my clock".
 *
 * Why the "answers safe" reassurance:
 *   • All snapshots are already on the server (synced before the 401) AND
 *     persisted to IndexedDB for any items the queue hadn't flushed.
 *
 * The `onSignIn` callback is wired by the parent to navigate to
 * `/login?return_to=/test/[sessionId]` so the user can resume the test on
 * successful re-auth.
 */
export interface AuthErrorBannerProps {
  onSignIn: () => void;
  /** Seconds remaining on the server-anchored test timer. */
  secondsRemaining: number;
  /** Optional explanation override — defaults to the standard copy. */
  message?: string;
}

function formatRemaining(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

export function AuthErrorBanner(
  props: AuthErrorBannerProps,
): React.ReactElement {
  const { onSignIn, message, secondsRemaining } = props;
  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="auth-error-title"
      aria-describedby="auth-error-desc"
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 backdrop-blur-sm px-4"
    >
      <div className="w-full max-w-md bg-surface-0 border border-border-subtle rounded-2xl p-6 sm:p-8 shadow-xl">
        <h2
          id="auth-error-title"
          className="text-xl font-semibold text-text-primary"
        >
          Sign in to keep going — your test isn&apos;t over
        </h2>

        {/* Prominent remaining-time pill so the student knows the clock is
            still running. */}
        <div
          className="mt-4 flex items-baseline justify-between rounded-lg bg-surface-2 border border-border-subtle px-3 py-2"
          aria-label={`Test timer remaining ${formatRemaining(secondsRemaining)}`}
        >
          <span className="text-xs uppercase font-medium text-text-secondary">
            Time remaining
          </span>
          <span
            className="font-mono text-lg tabular-nums text-[var(--accent)]"
            data-testid="auth-error-time-remaining"
          >
            {formatRemaining(secondsRemaining)}
          </span>
        </div>

        <p
          id="auth-error-desc"
          className="mt-4 text-sm text-text-secondary leading-relaxed"
        >
          {message ?? (
            <>
              <strong className="text-text-primary">
                Your test timer is still running
              </strong>{' '}
              — sign in to continue. Your saved answers are safe on this
              device and will sync once you are signed back in.
            </>
          )}
        </p>
        <div className="mt-6 flex justify-end">
          <button
            type="button"
            onClick={onSignIn}
            className="px-4 h-10 rounded-lg bg-[var(--accent)] text-[var(--accent-on)] hover:bg-[var(--accent-strong)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
            autoFocus
          >
            Sign in
          </button>
        </div>
      </div>
    </div>
  );
}
