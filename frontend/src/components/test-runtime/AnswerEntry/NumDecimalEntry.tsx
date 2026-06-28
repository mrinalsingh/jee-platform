'use client';

import type { AnswerPayload, NumAnswerSpec } from '@/lib/runtime-types';

import type { AnswerControlProps } from './AnswerControl';
import { NumericInputBase } from './NumericInputBase';

type Payload = Extract<AnswerPayload, { type: 'NUM-DEC' }>;

export function NumDecimalEntry(
  props: AnswerControlProps<Payload>,
): React.ReactElement {
  const { value, onChange, disabled, spec } = props;
  const numSpec = spec as NumAnswerSpec;
  return (
    <NumericInputBase
      value={value.value ?? ''}
      onChange={(next) =>
        onChange({ type: 'NUM-DEC', value: next === '' ? null : next })
      }
      config={{
        kind: 'NUM-DEC',
        precision: numSpec.precision,
        min: numSpec.min ?? Number.NEGATIVE_INFINITY,
        max: numSpec.max ?? Number.POSITIVE_INFINITY,
      }}
      disabled={disabled}
      helperText={`Decimal — up to ${numSpec.precision} decimal place${
        numSpec.precision === 1 ? '' : 's'
      }`}
      ariaLabel="Decimal numeric answer"
    />
  );
}
