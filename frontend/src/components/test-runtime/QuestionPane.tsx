'use client';

import { useMemo } from 'react';

import { renderMathString } from '@/lib/katex-render';
import type { SlotPayload } from '@/lib/runtime-types';

export interface QuestionPaneProps {
  slot: SlotPayload;
  slotPosition: number; // 1-indexed
  totalSlots: number;
  hintsUsed: number;
  sessionId: string;
}

export function QuestionPane(props: QuestionPaneProps): React.ReactElement {
  const { slot, slotPosition, totalSlots, hintsUsed, sessionId } = props;

  const rendered = useMemo(
    () => renderMathString(slot.statement),
    [slot.statement],
  );

  return (
    <article className="space-y-4">
      <header className="flex items-baseline justify-between">
        <h2 className="text-xl font-medium text-text-primary">
          Question {slotPosition} of {totalSlots}
        </h2>
        {slot.hint_count > 0 && (
          <p className="text-sm text-text-secondary">
            Hints used: {hintsUsed} / {slot.hint_count}
          </p>
        )}
      </header>
      <div className="h-px bg-border-subtle" />
      <div
        className="prose-runtime no-select text-text-primary text-lg leading-relaxed"
        // KaTeX HTML is sanitised by KaTeX itself; statements come from our own bank.
        dangerouslySetInnerHTML={{ __html: rendered }}
      />

      {slot.figure_signed_tokens.length > 0 && (
        <div className="flex flex-wrap gap-3">
          {slot.figure_signed_tokens.map((tok) => (
            // Native <img> on purpose: figure URLs are per-session signed
            // tokens (architecture §7) — next/image's optimisation pipeline
            // can't proxy them, and we MUST keep them session-scoped.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={tok}
              src={`/api/test-sessions/${encodeURIComponent(sessionId)}/figures/${encodeURIComponent(tok)}`}
              alt="Figure for this question"
              className="max-w-full max-h-72 rounded-lg border border-border-subtle no-select"
              draggable={false}
            />
          ))}
        </div>
      )}
    </article>
  );
}
