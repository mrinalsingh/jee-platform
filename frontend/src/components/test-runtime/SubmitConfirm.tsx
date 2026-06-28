'use client';

import { useRef, useState } from 'react';

import type { PerQuestionStatus } from '@/lib/runtime-types';

export interface SubmitCounts {
  answered: number;
  marked: number;
  marked_and_answered: number;
  visited_not_answered: number;
  not_visited: number;
  total: number;
}

export interface SubmitChip {
  slotIndex: number;
  slotPosition: number;
  status: PerQuestionStatus;
}

export interface SubmitConfirmProps {
  open: boolean;
  counts: SubmitCounts;
  timeRemainingLabel: string;
  draining: boolean;
  drainingPending: number;
  onCancel: () => void;
  onConfirm: () => void;
  /**
   * [UX Audit v1 loop-back MED-1] — per-question chips for the step-1
   * modal. When provided, clicking a chip closes the modal and jumps to
   * that slot via `onJumpToSlot`. PRD US-6 AC.
   */
  chips?: SubmitChip[];
  onJumpToSlot?: (slotIndex: number) => void;
}

/**
 * Two-step submit confirm (PRD US-6).
 *   Step 1: section summary + warn on unanswered.
 *   Step 2: definitive "you cannot return" confirmation; default focus on
 *           Cancel so the Enter key does NOT submit by accident.
 */
export function SubmitConfirm(props: SubmitConfirmProps): React.ReactElement | null {
  const {
    open,
    counts,
    timeRemainingLabel,
    draining,
    drainingPending,
    onCancel,
    onConfirm,
    chips,
    onJumpToSlot,
  } = props;
  const [step, setStep] = useState<1 | 2>(1);
  const cancelRef = useRef<HTMLButtonElement | null>(null);

  if (!open) return null;

  const unanswered =
    counts.visited_not_answered + counts.not_visited + counts.marked;

  if (draining) {
    return (
      <Modal>
        <h2 className="text-xl font-medium mb-2">
          Saving your answers…
        </h2>
        <p className="text-text-secondary mb-4">
          {drainingPending} answer{drainingPending === 1 ? '' : 's'} pending.
          Please do not close this tab.
        </p>
      </Modal>
    );
  }

  if (step === 1) {
    const answeredTotal = counts.answered + counts.marked_and_answered;
    return (
      <Modal>
        <h2 className="text-xl font-medium mb-3">Submit your test?</h2>
        <dl className="grid grid-cols-2 gap-y-1 text-sm mb-3">
          <Row label="Answered" value={counts.answered} />
          <Row label="Marked & Answered" value={counts.marked_and_answered} />
          <Row label="Marked for Review" value={counts.marked} warn />
          <Row
            label="Visited not answered"
            value={counts.visited_not_answered}
            warn
          />
          <Row label="Not visited" value={counts.not_visited} warn />
        </dl>
        <p className="text-sm text-text-secondary mb-3">
          Time remaining: {timeRemainingLabel}
        </p>

        {/* [UX Audit v1 loop-back MED-1] — PRD US-6 AC: per-question chip
            grid + summary. Clicking a chip closes the modal and jumps to
            that question. Colour matches the runtime palette: green for
            answered, grey for unanswered, amber for marked-for-review. */}
        {chips && chips.length > 0 && (
          <div className="mb-4" data-testid="submit-chip-grid">
            <p className="text-xs text-text-secondary mb-2">
              {answeredTotal} answered, {counts.visited_not_answered + counts.not_visited}{' '}
              unanswered, {counts.marked} marked for review
            </p>
            <div className="grid grid-cols-10 gap-1">
              {chips.map((c) => (
                <button
                  type="button"
                  key={c.slotIndex}
                  onClick={() => {
                    if (onJumpToSlot) onJumpToSlot(c.slotIndex);
                    setStep(1);
                    onCancel();
                  }}
                  className={`h-7 w-7 rounded-md text-xs font-medium border ${chipClass(c.status)}`}
                  aria-label={`Question ${c.slotPosition}, ${c.status.toLowerCase().replace(/_/g, ' ')}. Click to jump.`}
                  data-testid={`submit-chip-${c.slotIndex}`}
                >
                  {c.slotPosition}
                </button>
              ))}
            </div>
          </div>
        )}

        {unanswered > 0 && (
          <p className="text-sm bg-[var(--warn-bg)] text-[var(--warn-text)] border border-[var(--warn-border)] rounded-lg px-3 py-2 mb-4">
            <span aria-hidden="true">⚠</span> You have {unanswered} question
            {unanswered === 1 ? '' : 's'} you haven&apos;t answered. Review
            before submitting?
          </p>
        )}
        <div className="flex justify-end gap-3">
          <button
            type="button"
            ref={cancelRef}
            onClick={() => {
              setStep(1);
              onCancel();
            }}
            className="px-4 h-9 rounded-lg border border-border-subtle text-text-primary hover:bg-surface-2"
          >
            Continue test
          </button>
          <button
            type="button"
            onClick={() => setStep(2)}
            className="px-4 h-9 rounded-lg bg-[var(--accent)] text-[var(--accent-on)] hover:bg-[var(--accent-strong)]"
          >
            Submit now
          </button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal>
      <h2 className="text-xl font-medium mb-2">
        You are about to submit
      </h2>
      <p className="text-text-secondary mb-4">
        After submitting you cannot return to the test. Please confirm.
      </p>
      <div className="flex justify-end gap-3">
        <button
          type="button"
          ref={cancelRef}
          autoFocus
          onClick={() => {
            setStep(1);
            onCancel();
          }}
          className="px-4 h-9 rounded-lg border border-border-subtle text-text-primary hover:bg-surface-2"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onConfirm}
          className="px-4 h-9 rounded-lg bg-[var(--accent)] text-[var(--accent-on)] hover:bg-[var(--accent-strong)]"
        >
          Confirm submit
        </button>
      </div>
    </Modal>
  );
}

function Row({
  label,
  value,
  warn,
}: {
  label: string;
  value: number;
  warn?: boolean;
}): React.ReactElement {
  return (
    <>
      <dt className="text-text-secondary">{label}</dt>
      <dd
        className={`text-right ${warn && value > 0 ? 'text-[var(--warn-fg)]' : ''}`}
      >
        {value}
        {warn && value > 0 ? ' ⚠' : ''}
      </dd>
    </>
  );
}

function chipClass(status: PerQuestionStatus): string {
  // Submit-modal chips reuse the palette-status semantics:
  //   ANSWERED + ANSWERED_AND_MARKED → green (using --palette-answered-bg)
  //   MARKED_FOR_REVIEW              → amber (--warn-bg) per PRD US-6
  //   VISITED_NOT_ANSWERED / NOT_VISITED → neutral grey
  switch (status) {
    case 'ANSWERED':
    case 'ANSWERED_AND_MARKED':
      return 'bg-[var(--palette-answered-bg)] text-[var(--palette-answered-fg)] border-transparent';
    case 'MARKED_FOR_REVIEW':
      return 'bg-[var(--warn-bg-strong)] text-[var(--warn-text)] border-[var(--warn-border)]';
    case 'VISITED_NOT_ANSWERED':
    case 'NOT_VISITED':
      return 'bg-surface-2 text-text-secondary border-border-subtle';
  }
}

function Modal({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4"
    >
      <div className="w-full max-w-md rounded-2xl bg-surface-0 p-8 shadow-xl border border-border-subtle">
        {children}
      </div>
    </div>
  );
}
