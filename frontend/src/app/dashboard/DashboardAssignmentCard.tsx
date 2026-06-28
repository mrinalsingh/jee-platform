/**
 * Dashboard assignment card — one row per assigned test.
 * [UX Audit v1 loop-back, HIGH-3]
 *
 * Server-component-friendly: pure JSX, no client hooks. The `Begin` link
 * targets the existing `/test/[sessionId]/instructions` route when the
 * session has been created; for OPEN-but-not-yet-started tests, the link
 * still points to the instructions route which knows how to call
 * `POST /api/test-sessions` on the user's behalf (via the runtime layer).
 *
 * For v1 we surface only what the existing dashboard endpoint returns and
 * link to what already exists — no new routes, no new endpoints.
 */

import Link from 'next/link';

import type { DashboardAssignedTest } from '@/lib/session-fetch';

function formatScheduled(windowStartAt: string): string {
  // Stable ISO display avoids locale-dependent test brittleness.
  const d = new Date(windowStartAt);
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mi = String(d.getUTCMinutes()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd} ${hh}:${mi} UTC`;
}

function statusBadgeClass(status: DashboardAssignedTest['status']): string {
  // Tokens only — see globals.css `--status-*` block.
  switch (status) {
    case 'OPEN':
    case 'IN_PROGRESS':
      return 'bg-[var(--status-open-bg)] text-[var(--status-open-text)]';
    case 'UPCOMING':
      return 'bg-[var(--status-upcoming-bg)] text-[var(--status-upcoming-text)]';
    case 'SUBMITTED':
      return 'bg-[var(--status-submitted-bg)] text-[var(--status-submitted-text)]';
    case 'EXPIRED':
      return 'bg-[var(--status-expired-bg)] text-[var(--status-expired-text)]';
  }
}

export interface DashboardAssignmentCardProps {
  test: DashboardAssignedTest;
}

export function DashboardAssignmentCard(
  props: DashboardAssignmentCardProps,
): React.ReactElement {
  const { test } = props;
  const canBegin = test.status === 'OPEN' || test.status === 'IN_PROGRESS';
  const targetHref = test.session_id
    ? `/test/${encodeURIComponent(test.session_id)}/instructions`
    : `/test/${encodeURIComponent(test.test_assignment_id)}/instructions`;

  return (
    <article
      className="flex items-center justify-between gap-4 rounded-xl border border-border-subtle px-4 py-3 hover:bg-surface-1"
      data-testid="dashboard-assignment-card"
    >
      <div className="min-w-0">
        <h3 className="font-medium text-text-primary truncate">
          {test.title}
        </h3>
        <p className="text-sm text-text-secondary">
          Scheduled {formatScheduled(test.window_start_at)} ·{' '}
          {Math.round(test.duration_seconds / 60)} min
        </p>
      </div>
      <div className="flex items-center gap-3">
        <span
          className={`text-xs px-2 py-1 rounded-full ${statusBadgeClass(test.status)}`}
          aria-label={`status ${test.status}`}
        >
          {test.status}
        </span>
        {canBegin ? (
          <Link
            href={targetHref}
            className="px-4 h-9 leading-9 rounded-lg bg-[var(--accent)] text-[var(--accent-on)] hover:bg-[var(--accent-strong)] text-sm"
          >
            Begin
          </Link>
        ) : (
          <span className="px-4 h-9 leading-9 rounded-lg text-sm text-text-tertiary">
            —
          </span>
        )}
      </div>
    </article>
  );
}
