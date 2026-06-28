'use client';

import { renderMathString } from '@/lib/katex-render';
import type { AnswerPayload, McqAnswerSpec } from '@/lib/runtime-types';
import { isValidOptionCount, lettersForOptionCount } from '@/lib/runtime-types';

import type { AnswerControlProps } from './AnswerControl';

type Payload = Extract<AnswerPayload, { type: 'MCQ-SC' }>;

export function MCQSingleChoice(
  props: AnswerControlProps<Payload>,
): React.ReactElement {
  const { spec, value, options = [], onChange, disabled } = props;

  // [UPDATED v2 — M9] — derive option count from the spec (was literal 4).
  // If the bank misbehaves we fall back to 4 — and surface a console-free
  // visible warning via the `Unsupported` block. Runtime guard prevents
  // crashes from a malformed spec.
  const mcqSpec = spec as McqAnswerSpec;
  if (!isValidOptionCount(mcqSpec.option_count)) {
    return (
      <div
        role="alert"
        className="rounded-lg border border-[var(--danger-border)] bg-[var(--danger-bg)] p-4 text-[var(--danger-text)]"
      >
        This MCQ has an unsupported option count ({mcqSpec.option_count}).
        Please contact your teacher.
      </div>
    );
  }
  const LETTERS = lettersForOptionCount(mcqSpec.option_count);

  return (
    <fieldset
      className="space-y-2"
      aria-label="Single-choice answer"
      disabled={disabled}
    >
      {LETTERS.map((letter, idx) => {
        const selected = value.selected_option === idx;
        return (
          <label
            key={letter}
            className={`flex items-start gap-3 cursor-pointer rounded-lg border px-4 py-3 transition-colors ${
              selected
                ? 'border-accent bg-[var(--accent-subtle-bg)]'
                : 'border-border-subtle hover:bg-surface-2'
            } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
          >
            <input
              type="radio"
              name="mcq-sc"
              className="mt-1 accent-[var(--accent)]"
              checked={selected}
              disabled={disabled}
              onChange={() =>
                onChange({ type: 'MCQ-SC', selected_option: idx })
              }
              aria-label={`Option ${letter}`}
            />
            <span className="font-medium mr-2">({letter})</span>
            <span
              className="flex-1 text-text-primary"
              dangerouslySetInnerHTML={{
                __html: renderMathString(options[idx] ?? ''),
              }}
            />
          </label>
        );
      })}
    </fieldset>
  );
}
