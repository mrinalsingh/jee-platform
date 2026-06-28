'use client';

import { renderMathString } from '@/lib/katex-render';
import type { AnswerPayload, McqAnswerSpec } from '@/lib/runtime-types';
import { isValidOptionCount, lettersForOptionCount } from '@/lib/runtime-types';

import type { AnswerControlProps } from './AnswerControl';

type Payload = Extract<AnswerPayload, { type: 'MCQ-MC' }>;

export function MCQMultiChoice(
  props: AnswerControlProps<Payload>,
): React.ReactElement {
  const { spec, value, options = [], onChange, disabled } = props;

  // [UPDATED v2 — M9] — derive option count from the spec (was literal 4).
  const mcqSpec = spec as McqAnswerSpec;
  if (!isValidOptionCount(mcqSpec.option_count)) {
    return (
      <div
        role="alert"
        className="rounded-lg border border-red-300 bg-red-50 p-4 text-red-800"
      >
        This MCQ has an unsupported option count ({mcqSpec.option_count}).
        Please contact your teacher.
      </div>
    );
  }
  const LETTERS = lettersForOptionCount(mcqSpec.option_count);

  const toggle = (idx: number): void => {
    const set = new Set(value.selected_options);
    if (set.has(idx)) set.delete(idx);
    else set.add(idx);
    onChange({
      type: 'MCQ-MC',
      selected_options: Array.from(set).sort((a, b) => a - b),
    });
  };

  return (
    <fieldset
      className="space-y-2"
      aria-label="Multi-choice answer (one or more correct)"
      disabled={disabled}
    >
      {LETTERS.map((letter, idx) => {
        const selected = value.selected_options.includes(idx);
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
              type="checkbox"
              className="mt-1 accent-[var(--accent)]"
              checked={selected}
              disabled={disabled}
              onChange={() => toggle(idx)}
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
