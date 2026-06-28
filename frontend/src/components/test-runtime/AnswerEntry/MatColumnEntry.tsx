'use client';

import { renderMathString } from '@/lib/katex-render';
import type { AnswerPayload, MatColAnswerSpec } from '@/lib/runtime-types';

import type { AnswerControlProps } from './AnswerControl';

type Payload = Extract<AnswerPayload, { type: 'MAT-COL' }>;

const LIST_I_LETTERS = ['P', 'Q', 'R', 'S', 'T', 'U'];

/**
 * MAT-COL — two-column matching. Each List-I row gets a dropdown to pick
 * a List-II option. ANSWERED when ALL rows have a selection (PRD US-3 AC).
 *
 * [UPDATED — UX Audit v1 loop-back, HIGH-1]
 * The dropdown can't render LaTeX (native `<option>` is plain-text only),
 * so List-II options are rendered in full above the matching grid as a
 * labelled KaTeX block. The dropdown itself shows ONLY the bare numeric
 * label `(1)`, `(2)`, … — students read the math in the labelled block
 * and pick the matching number in the dropdown. This mirrors how the real
 * JEE Advanced CBT renders MAT-COL problems.
 */
export function MatColumnEntry(
  props: AnswerControlProps<Payload>,
): React.ReactElement {
  const { value, onChange, disabled, spec, list_i = [], list_ii = [] } = props;
  const matSpec = spec as MatColAnswerSpec;
  const rowCount = matSpec.list_i_count ?? list_i.length;

  const choose = (rowIdx: number, optionIdx: number | null): void => {
    const next: Payload = {
      type: 'MAT-COL',
      pairs: { ...value.pairs, [rowIdx]: optionIdx },
    };
    onChange(next);
  };

  return (
    <div className="space-y-4" role="group" aria-label="Match the columns">
      {/* [UX Audit v1 loop-back HIGH-1] — List-II rendered with KaTeX so
         students see math notation. The dropdown below is a label-only
         picker. */}
      {list_ii.length > 0 && (
        <div
          className="rounded-lg border border-border-subtle bg-surface-1 px-3 py-2"
          aria-label="List II options"
        >
          <p className="text-text-secondary text-xs uppercase font-medium mb-2">
            List II
          </p>
          <ul className="flex flex-wrap gap-x-4 gap-y-1 text-text-primary">
            {list_ii.map((opt, optIdx) => (
              <li
                key={optIdx}
                className="flex items-baseline gap-1"
                data-testid={`list-ii-option-${optIdx}`}
              >
                <span className="font-medium">({optIdx + 1})</span>
                <span
                  // KaTeX HTML is sanitised by the renderer; List-II text
                  // comes from our own bank, same trust boundary as the
                  // question statement.
                  dangerouslySetInnerHTML={{
                    __html: renderMathString(opt),
                  }}
                />
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid grid-cols-[80px_1fr_120px] gap-3 items-center text-text-secondary text-sm uppercase font-medium">
        <div>List I</div>
        <div />
        <div>List II pick</div>
      </div>
      {Array.from({ length: rowCount }).map((_, rowIdx) => {
        const letter = LIST_I_LETTERS[rowIdx] ?? String(rowIdx + 1);
        const selected = value.pairs[rowIdx] ?? null;
        return (
          <div
            key={rowIdx}
            className="grid grid-cols-[80px_1fr_120px] gap-3 items-center rounded-lg border border-border-subtle px-3 py-2"
          >
            <div className="font-medium">({letter})</div>
            <div
              className="text-text-primary"
              dangerouslySetInnerHTML={{
                __html: renderMathString(list_i[rowIdx] ?? ''),
              }}
            />
            <select
              className="h-10 px-2 rounded-lg border border-border-subtle bg-surface-0 text-text-primary disabled:opacity-50"
              disabled={disabled}
              value={selected === null ? '' : String(selected)}
              onChange={(e) =>
                choose(
                  rowIdx,
                  e.target.value === '' ? null : Number(e.target.value),
                )
              }
              aria-label={`List II selection for row ${letter}`}
            >
              <option value="">— pick —</option>
              {list_ii.map((_opt, optIdx) => (
                // [UX Audit v1 loop-back HIGH-1] — dropdown is label-only.
                // The KaTeX-rendered List-II block above is the canonical
                // reference for students.
                <option key={optIdx} value={optIdx}>
                  ({optIdx + 1})
                </option>
              ))}
            </select>
          </div>
        );
      })}
    </div>
  );
}
