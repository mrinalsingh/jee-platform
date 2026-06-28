'use client';

import Link from 'next/link';

/**
 * Hard mobile block per design-lock #4: viewports < 768 px get a clean
 * refusal-with-explanation screen. The runtime page mounts this when the
 * `useLayoutEffect`-measured viewport is below the breakpoint.
 *
 * Honesty: the screen explains the *why* (multi-pane layout, anti-cheat
 * unreliability on mobile browsers, precision-cap UX on virtual keyboards)
 * rather than just saying "no".
 */
export function MobileBlock(): React.ReactElement {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center p-6 text-center bg-surface-0">
      <div className="max-w-sm space-y-4">
        <h1 className="text-2xl font-medium">Use a larger screen</h1>
        <p className="text-text-secondary">
          The test runtime requires a laptop or tablet at least 768 px wide.
          The question palette, answer entry, and timer don&apos;t fit
          comfortably on a phone.
        </p>
        <p className="text-text-secondary text-sm">
          You can still view your dashboard and past results on your phone.
        </p>
        <Link
          href="/dashboard"
          className="inline-block mt-4 px-6 h-10 leading-10 rounded-lg bg-[var(--accent)] text-[var(--accent-on)]"
        >
          Back to dashboard
        </Link>
      </div>
    </main>
  );
}
