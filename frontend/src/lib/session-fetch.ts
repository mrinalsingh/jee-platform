/**
 * Server-side fetch helpers for the runtime route.
 * Uses the cookie header forwarded from the inbound request.
 *
 * [UPDATED v3 — NEW-1] — also re-exports `SessionAuthError` and the client-
 * side `fetchWithCookies` helper (implementation lives in `./session-auth`
 * because Turbopack forbids `next/headers` in any module that ends up in the
 * client bundle, and the runtime needs those primitives). Importers can
 * continue to `import { SessionAuthError } from '@/lib/session-fetch'` if
 * they prefer the original path, or pull them directly from `./session-auth`.
 *
 * The fix distinguishes server-revoked sessions (401) from network failures
 * throughout the client so the runtime can route 401 to the AuthErrorBanner +
 * re-auth flow instead of the NETWORK_FAILURE_FALLBACK "submitted locally"
 * path that caused silent data loss (Stage-3 code-review v2 NEW-1).
 */

import { cookies } from 'next/headers';

import type { SessionPayload } from './runtime-types';

export { SessionAuthError, fetchWithCookies } from './session-auth';

const API_BASE = process.env.BACKEND_API_BASE ?? 'http://localhost:3001';

async function forwardCookie(): Promise<string> {
  const jar = await cookies();
  const pairs = jar.getAll().map((c) => `${c.name}=${c.value}`);
  return pairs.join('; ');
}

export async function fetchSession(
  sessionId: string,
): Promise<SessionPayload | null> {
  const cookieHeader = await forwardCookie();
  const res = await fetch(
    `${API_BASE}/api/test-sessions/${encodeURIComponent(sessionId)}`,
    {
      cache: 'no-store',
      headers: cookieHeader ? { Cookie: cookieHeader } : {},
      credentials: 'include',
    },
  );
  if (!res.ok) return null;
  return (await res.json()) as SessionPayload;
}

export interface SessionResultsPayload {
  session_id: string;
  test_title: string;
  total_score: number;
  max_score: number;
  duration_used_seconds: number;
  auto_submit_source: string | null;
  per_question: Array<{
    slot_position: number;
    question_code: string;
    statement: string;
    your_answer: string | null;
    correct_answer: string | null;
    score_delta: number;
    time_seconds: number;
    visit_count: number;
    marked_for_review: boolean;
    hints_used: number;
    hint_levels_revealed: number[];
    wrong_paths_match: {
      failure_modes: string[];
      one_line_label: string | null;
    } | null;
    solution: string | null;
    status: 'CORRECT' | 'WRONG' | 'UNANSWERED' | 'SLOW_BUT_CORRECT';
  }>;
  violations: Array<{ violation_type: string; violation_timestamp: string }>;
}

export async function fetchResults(
  sessionId: string,
): Promise<SessionResultsPayload | null> {
  const cookieHeader = await forwardCookie();
  const res = await fetch(
    `${API_BASE}/api/test-sessions/${encodeURIComponent(sessionId)}/results`,
    {
      cache: 'no-store',
      headers: cookieHeader ? { Cookie: cookieHeader } : {},
      credentials: 'include',
    },
  );
  if (!res.ok) return null;
  return (await res.json()) as SessionResultsPayload;
}

/** Used by the instructions page to detect whether a session has been STARTed. */
export async function readSessionStatus(
  sessionId: string,
): Promise<{ started_at: string | null; submitted_at: string | null } | null> {
  const cookieHeader = await forwardCookie();
  const res = await fetch(
    `${API_BASE}/api/test-sessions/${encodeURIComponent(sessionId)}`,
    {
      cache: 'no-store',
      headers: cookieHeader ? { Cookie: cookieHeader } : {},
      credentials: 'include',
    },
  );
  if (!res.ok) return null;
  const body = (await res.json()) as {
    started_at: string | null;
    submitted_at: string | null;
  };
  return body;
}

