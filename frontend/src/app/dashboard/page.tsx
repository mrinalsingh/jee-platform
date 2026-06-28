/**
 * Dashboard stub — [UX Audit v1 loop-back, HIGH-3].
 *
 * Every "happy path" exit from the runtime (login redirect, mobile-block
 * "Back to dashboard", post-auth-recovery return-to-default) targets
 * `/dashboard`. Until then this route was missing, so first-time logins,
 * mobile users, and re-authed students all landed on 404. This stub closes
 * the gap with the minimum viable surface:
 *
 *   • Welcome line
 *   • List of TestAssignment rows the student can act on (calls the
 *     existing backend `GET /api/dashboard/assigned-tests` endpoint —
 *     no new backend surface)
 *   • Per-assignment "Begin" CTA → `/test/[sessionId]/instructions`
 *     when status is OPEN, or a status badge when not
 *   • Empty state when the student has no scheduled tests
 *
 * Styling follows design-lock #3: this is NOT the test runtime, so we use
 * the NotebookLM-calm palette (no JEE-saturated colours).
 *
 * Dashboard product scope is intentionally out of scope for this loop-back
 * — a separate spec loop will define the full dashboard UX. This stub
 * exists only to prevent broken exits from the runtime.
 */

import Link from 'next/link';
import { redirect } from 'next/navigation';

import {
  fetchAssignedTests,
  type DashboardAssignedTest,
} from '@/lib/session-fetch';

import { DashboardAssignmentCard } from './DashboardAssignmentCard';

export default async function DashboardPage(): Promise<React.ReactElement> {
  const tests = await fetchAssignedTests();
  if (tests === null) {
    // Backend rejected the cookie (or is unreachable). Send the student to
    // login; `next` brings them back here on success.
    redirect('/login?next=/dashboard');
  }

  return (
    <main className="min-h-screen bg-surface-1 px-6 py-12">
      <div className="mx-auto w-full max-w-3xl space-y-8">
        <header>
          <h1 className="text-3xl font-semibold text-text-primary">
            Welcome back
          </h1>
          <p className="mt-1 text-text-secondary">
            Your scheduled tests are listed below.
          </p>
        </header>

        <section
          aria-label="Assigned tests"
          className="bg-surface-0 border border-border-subtle rounded-2xl p-6"
        >
          <h2 className="text-lg font-medium mb-4">Tests assigned to you</h2>
          {tests.length === 0 ? (
            <p className="text-text-secondary" data-testid="dashboard-empty">
              No tests scheduled yet. Your teacher will assign one soon.
            </p>
          ) : (
            <ul className="space-y-3" data-testid="dashboard-list">
              {tests.map((t) => (
                <li key={t.test_assignment_id}>
                  <DashboardAssignmentCard test={t} />
                </li>
              ))}
            </ul>
          )}
        </section>

        <footer className="text-xs text-text-tertiary">
          <Link href="/login" className="underline hover:text-text-secondary">
            Sign out
          </Link>
        </footer>
      </div>
    </main>
  );
}

export type { DashboardAssignedTest };
