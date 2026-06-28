import { redirect } from 'next/navigation';

import { fetchSession } from '@/lib/session-fetch';

import { InstructionsClient } from './InstructionsClient';

/**
 * Pre-test instructions (PRD US-2).
 *
 * Server component reads the session (sans question_codes / answers), derives
 * a marking-scheme summary, hands metadata to the client gate.
 */
export default async function InstructionsPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}): Promise<React.ReactElement> {
  const { sessionId } = await params;
  const session = await fetchSession(sessionId);
  if (!session) {
    redirect('/login?next=/test/' + encodeURIComponent(sessionId) + '/instructions');
  }
  if (session.submitted_at) {
    redirect(`/test/${encodeURIComponent(sessionId)}/results`);
  }
  if (session.started_at) {
    redirect(`/test/${encodeURIComponent(sessionId)}`);
  }

  const totalQuestions = session.sections.reduce(
    (n, s) => n + s.slots.length,
    0,
  );
  const sectionLabel =
    session.sections.length === 1
      ? `1 section: ${session.sections[0].subject}`
      : `${session.sections.length} sections: ${session.sections
          .map((s) => s.subject)
          .join(', ')}`;

  const hintsAvailable = session.sections.some((sec) =>
    sec.slots.some((slot) => slot.hint_count > 0),
  );

  return (
    <InstructionsClient
      sessionId={sessionId}
      testTitle={session.test_title}
      durationMinutes={Math.round(session.duration_seconds / 60)}
      sectionLabel={sectionLabel}
      markingSchemeSummary={summariseScheme(session.marking_scheme)}
      hintsAvailable={hintsAvailable}
      totalQuestions={totalQuestions}
    />
  );
}

function summariseScheme(
  scheme: import('@/lib/runtime-types').MarkingScheme,
): string {
  // Canonical one-liner derivation per PRD §8.4: "+4 / −1, partial on MCQ-MC"
  const sc = scheme.per_answer_type['MCQ-SC'];
  const mcPartial = scheme.per_answer_type['MCQ-MC'];
  const head = `+${sc.correct} / ${sc.wrong}`;
  const partial =
    mcPartial && Object.keys(mcPartial).some((k) => k.includes('correct'))
      ? ', partial on MCQ-MC'
      : '';
  return head + partial;
}
