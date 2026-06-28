'use client';

import { useEffect, useState } from 'react';

import { violationLabel } from '@/lib/anti-cheat';
import type { ViolationType } from '@/lib/runtime-types';

export interface ViolationBannerProps {
  /** 1-indexed; banner shows for the *current* count */
  violationsCount: number;
  /** the most recent violation type — drives the label */
  lastType: ViolationType | null;
  /** the banner timestamp; the parent bumps it to re-trigger the auto-dismiss */
  triggeredAt: number | null;
}

/**
 * Progressive escalation per design-lock #6:
 *   - 1 → amber, dark text, informative
 *   - 2 → amber-red, white text, serious
 *   - 3 → saturated red, bold, definitive (auto-submit imminent)
 *
 * Banner displays for 5 s then auto-dismisses; the persistent counter chip in
 * the top-bar shows the running tally.
 *
 * Implementation: visibility is derived from the `triggeredAt` *prop* (the
 * parent re-renders with a new timestamp on each violation). A timer
 * subscribes to that prop and only fires the dismissal callback to the parent
 * — no setState inside an effect for visibility (avoids cascading renders).
 */
export function ViolationBanner(
  props: ViolationBannerProps,
): React.ReactElement | null {
  const { violationsCount, lastType, triggeredAt } = props;
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);

  useEffect(() => {
    if (triggeredAt === null) return;
    const id = setTimeout(() => setDismissedAt(triggeredAt), 5000);
    return () => clearTimeout(id);
  }, [triggeredAt]);

  const visible =
    triggeredAt !== null && triggeredAt !== dismissedAt;
  if (!visible || violationsCount === 0) return null;

  const level = Math.min(violationsCount, 3) as 1 | 2 | 3;
  const bg =
    level === 1
      ? 'bg-[var(--violation-1-bg)] text-[var(--violation-1-text)]'
      : level === 2
        ? 'bg-[var(--violation-2-bg)] text-[var(--violation-2-text)]'
        : 'bg-[var(--violation-3-bg)] text-[var(--violation-3-text)] font-bold';

  return (
    <div
      role="status"
      aria-live="assertive"
      className={`fixed top-0 left-0 right-0 z-50 px-4 py-3 text-center ${bg}`}
    >
      <p>
        Violation {violationsCount} of 3
        {lastType ? ` — ${violationLabel(lastType)} detected.` : '.'}{' '}
        {level === 3
          ? 'Auto-submitting your test now.'
          : 'Your test will be auto-submitted on the 3rd violation.'}
      </p>
    </div>
  );
}
