'use client';

/**
 * AuthErrorBanner — full-screen, layered card shown when the server has
 * explicitly rejected the session cookie mid-test (HTTP 401 from the heartbeat
 * poll or the telemetry queue dispatch).
 *
 * [UPDATED v3 — NEW-1]
 *
 * Why a separate component (not ViolationBanner):
 *   • This is NOT a cheating / violation event — the student did nothing
 *     wrong, so the colour is neutral (slate / amber accent), never red.
 *   • The flow halts the runtime: the timer no longer auto-submits, the
 *     telemetry queue is dormant, and the only sensible next action is to
 *     re-authenticate. So the card is blocking, not the 5-s auto-dismiss
 *     pattern that ViolationBanner uses.
 *   • Mobile-responsive: the card centres in the viewport and shrinks to
 *     the available width with a comfortable max-width on desktop.
 *
 * The `onSignIn` callback is wired by the parent to navigate to
 * `/login?return_to=/test/[sessionId]` so the user can resume the test on
 * successful re-auth.
 */
export interface AuthErrorBannerProps {
  onSignIn: () => void;
  /** Optional explanation override — defaults to the standard copy. */
  message?: string;
}

export function AuthErrorBanner(
  props: AuthErrorBannerProps,
): React.ReactElement {
  const { onSignIn, message } = props;
  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="auth-error-title"
      aria-describedby="auth-error-desc"
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 px-4"
    >
      <div className="w-full max-w-md bg-surface-0 border border-border-subtle rounded-2xl p-6 sm:p-8 shadow-xl">
        <h2
          id="auth-error-title"
          className="text-xl font-semibold text-text-primary"
        >
          Your session ended
        </h2>
        <p
          id="auth-error-desc"
          className="mt-3 text-sm text-text-secondary leading-relaxed"
        >
          {message ??
            'Please sign in again to continue this test. Your answers so far are saved on this device and will sync once you are signed back in.'}
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
