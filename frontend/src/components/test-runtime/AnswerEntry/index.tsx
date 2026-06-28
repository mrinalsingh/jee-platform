'use client';

import type { AnswerPayload, AnswerSpec, AnswerType } from '@/lib/runtime-types';

import { MatColumnEntry } from './MatColumnEntry';
import { MCQMultiChoice } from './MCQMultiChoice';
import { MCQSingleChoice } from './MCQSingleChoice';
import { NumDecimalEntry } from './NumDecimalEntry';
import { NumIntegerEntry } from './NumIntegerEntry';

export interface AnswerEntryProps {
  answerType: AnswerType;
  spec: AnswerSpec;
  value: AnswerPayload;
  options?: string[];
  list_i?: string[];
  list_ii?: string[];
  onChange: (next: AnswerPayload) => void;
  onClear: () => void;
  disabled: boolean;
}

/**
 * Dispatcher for the five v1 answer-types. Unknown types render the hard
 * error block per PRD US-3 (Vision Update §10 future-proofing).
 */
export function AnswerEntry(props: AnswerEntryProps): React.ReactElement {
  const { answerType, value } = props;

  switch (answerType) {
    case 'MCQ-SC': {
      const v: Extract<AnswerPayload, { type: 'MCQ-SC' }> =
        value && value.type === 'MCQ-SC'
          ? value
          : { type: 'MCQ-SC', selected_option: null };
      return (
        <MCQSingleChoice
          {...props}
          value={v}
          onChange={(p) => props.onChange(p)}
        />
      );
    }
    case 'MCQ-MC': {
      const v: Extract<AnswerPayload, { type: 'MCQ-MC' }> =
        value && value.type === 'MCQ-MC'
          ? value
          : { type: 'MCQ-MC', selected_options: [] };
      return (
        <MCQMultiChoice
          {...props}
          value={v}
          onChange={(p) => props.onChange(p)}
        />
      );
    }
    case 'NUM-INT': {
      const v: Extract<AnswerPayload, { type: 'NUM-INT' }> =
        value && value.type === 'NUM-INT'
          ? value
          : { type: 'NUM-INT', value: null };
      return (
        <NumIntegerEntry
          {...props}
          value={v}
          onChange={(p) => props.onChange(p)}
        />
      );
    }
    case 'NUM-DEC': {
      const v: Extract<AnswerPayload, { type: 'NUM-DEC' }> =
        value && value.type === 'NUM-DEC'
          ? value
          : { type: 'NUM-DEC', value: null };
      return (
        <NumDecimalEntry
          {...props}
          value={v}
          onChange={(p) => props.onChange(p)}
        />
      );
    }
    case 'MAT-COL': {
      const v: Extract<AnswerPayload, { type: 'MAT-COL' }> =
        value && value.type === 'MAT-COL'
          ? value
          : { type: 'MAT-COL', pairs: {} };
      return (
        <MatColumnEntry
          {...props}
          value={v}
          onChange={(p) => props.onChange(p)}
        />
      );
    }
    default:
      return (
        <div
          role="alert"
          className="rounded-lg border border-red-300 bg-red-50 p-4 text-red-800"
        >
          Unsupported question type. Please contact your teacher.
        </div>
      );
  }
}
