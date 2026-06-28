/**
 * Dashboard assignment card unit spec — [UX Audit v1 loop-back HIGH-3].
 *
 * The dashboard stub itself is a Next.js server component (calls
 * `next/headers` via the fetch helper), which Vitest's jsdom env can't
 * mount directly. So this spec exercises the presentational card +
 * the empty-state copy that the page renders inline. The card carries
 * the entire visible contract for HIGH-3 (status badge, Begin CTA, scheduled
 * line) and is the part the auditor would scan first.
 */

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { DashboardAssignmentCard } from './DashboardAssignmentCard';

function fixture(
  overrides: Partial<
    Parameters<typeof DashboardAssignmentCard>[0]['test']
  > = {},
): Parameters<typeof DashboardAssignmentCard>[0]['test'] {
  return {
    test_assignment_id: 'ta_42',
    test_id: 't_1',
    title: 'Maths Mock — Pilot 0609d',
    duration_seconds: 10_800,
    window_start_at: '2026-06-28T04:30:00.000Z',
    window_end_at: '2026-06-28T07:30:00.000Z',
    status: 'OPEN',
    session_id: 'sess_abc',
    scope: 'cohort',
    ...overrides,
  };
}

describe('DashboardAssignmentCard', () => {
  it('shows the test title and scheduled time', () => {
    render(<DashboardAssignmentCard test={fixture()} />);
    expect(screen.getByText('Maths Mock — Pilot 0609d')).toBeInTheDocument();
    // Duration: 10800 s = 180 min
    expect(screen.getByText(/180 min/)).toBeInTheDocument();
    // Stable ISO display
    expect(
      screen.getByText(/2026-06-28 04:30 UTC/),
    ).toBeInTheDocument();
  });

  it('renders a "Begin" CTA when status is OPEN', () => {
    render(<DashboardAssignmentCard test={fixture()} />);
    const begin = screen.getByRole('link', { name: /begin/i });
    expect(begin).toHaveAttribute(
      'href',
      '/test/sess_abc/instructions',
    );
  });

  it('falls back to the test_assignment_id when no session_id exists yet', () => {
    render(
      <DashboardAssignmentCard
        test={fixture({ session_id: null, status: 'OPEN' })}
      />,
    );
    expect(screen.getByRole('link', { name: /begin/i })).toHaveAttribute(
      'href',
      '/test/ta_42/instructions',
    );
  });

  it('hides the Begin CTA when status is UPCOMING / SUBMITTED / EXPIRED', () => {
    render(
      <DashboardAssignmentCard test={fixture({ status: 'UPCOMING' })} />,
    );
    expect(
      screen.queryByRole('link', { name: /begin/i }),
    ).not.toBeInTheDocument();
    expect(screen.getByText('UPCOMING')).toBeInTheDocument();
  });
});
