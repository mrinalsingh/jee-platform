'use client';

import type { AnswerPayload, NumAnswerSpec } from '@/lib/runtime-types';

import type { AnswerControlProps } from './AnswerControl';
import { NumericInputBase } from './NumericInputBase';

type Payload = Extract<AnswerPayload, { type: 'NUM-INT' }>;

export function NumIntegerEntry(
  props: AnswerControlProps<Payload>,
): React.ReactElement {
  const { value, onChange, disabled, spec } = props;
  const numSpec = spec as NumAnswerSpec;
  return (
    <NumericInputBase
      value={value.value ?? ''}
      onChange={(next) =>
        onChange({ type: 'NUM-INT', value: next === '' ? null : next })
      }
      config={{
        kind: 'NUM-INT',
        precision: 0,
        min: numSpec.min ?? -999,
        max: numSpec.max ?? 999,
      }}
      disabled={disabled}
      helperText={`Integer between ${numSpec.min ?? -999} and ${numSpec.max ?? 999}`}
      ariaLabel="Integer numeric answer"
    />
  );
}
