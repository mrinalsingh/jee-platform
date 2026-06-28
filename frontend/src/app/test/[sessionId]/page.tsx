import { redirect } from 'next/navigation';

import { fetchSession } from '@/lib/session-fetch';

import { RuntimeProvider } from './RuntimeProvider';

/**
 * Active-session runtime route (PRD US-3..US-10).
 *
 * Server component: fetches the slot-indexed session payload (which NEVER
 * carries question_code, correct_answer, or solution per architecture §5.3),
 * hands it to the client RuntimeProvider that owns the state machine.
 */
export default async function TestRuntimePage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}): Promise<React.ReactElement> {
  const { sessionId } = await params;
  const session = await fetchSession(sessionId);
  if (!session) {
    // Not authenticated OR session does not belong to us (server returned 403/404).
    // The architecture-final §5.3 spec says GET returns 200 for owners only.
    redirect('/login?next=/test/' + encodeURIComponent(sessionId));
  }
  if (session.submitted_at) {
    redirect(`/test/${encodeURIComponent(sessionId)}/results`);
  }
  if (!session.started_at) {
    redirect(`/test/${encodeURIComponent(sessionId)}/instructions`);
  }

  return <RuntimeProvider initialSession={session} />;
}
