'use client';

import { useRef, useState } from 'react';

export interface SubmitCounts {
  answered: number;
  marked: number;
  marked_and_answered: number;
  visited_not_answered: number;
  not_visited: number;
  total: number;
}

export interface SubmitConfirmProps {
  open: boolean;
  counts: SubmitCounts;
  timeRemainingLabel: string;
  draining: boolean;
  drainingPending: number;
  onCancel: () => void;
  onConfirm: () => void;
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
        <p className="text-sm text-text-secondary mb-4">
          Time remaining: {timeRemainingLabel}
        </p>
        {unanswered > 0 && (
          <p className="text-sm bg-amber-50 text-amber-900 border border-amber-200 rounded-lg px-3 py-2 mb-4">
            ⚠ You have {unanswered} question{unanswered === 1 ? '' : 's'} you
            haven&apos;t answered. Review before submitting?
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
      <dd className={`text-right ${warn && value > 0 ? 'text-amber-600' : ''}`}>
        {value}
        {warn && value > 0 ? ' ⚠' : ''}
      </dd>
    </>
  );
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
