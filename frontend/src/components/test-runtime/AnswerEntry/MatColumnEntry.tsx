'use client';

import { renderMathString } from '@/lib/katex-render';
import type { AnswerPayload, MatColAnswerSpec } from '@/lib/runtime-types';

import type { AnswerControlProps } from './AnswerControl';

type Payload = Extract<AnswerPayload, { type: 'MAT-COL' }>;

const LIST_I_LETTERS = ['P', 'Q', 'R', 'S', 'T', 'U'];

/**
 * MAT-COL — two-column matching. Each List-I row gets a dropdown to pick
 * a List-II option. ANSWERED when ALL rows have a selection (PRD US-3 AC).
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
    <div className="grid grid-cols-1 gap-3" role="group" aria-label="Match the columns">
      <div className="grid grid-cols-[80px_1fr_160px] gap-3 items-center text-text-secondary text-sm uppercase font-medium">
        <div>List I</div>
        <div />
        <div>List II</div>
      </div>
      {Array.from({ length: rowCount }).map((_, rowIdx) => {
        const letter = LIST_I_LETTERS[rowIdx] ?? String(rowIdx + 1);
        const selected = value.pairs[rowIdx] ?? null;
        return (
          <div
            key={rowIdx}
            className="grid grid-cols-[80px_1fr_160px] gap-3 items-center rounded-lg border border-border-subtle px-3 py-2"
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
              {list_ii.map((opt, optIdx) => (
                <option key={optIdx} value={optIdx}>
                  ({optIdx + 1}) {stripTex(opt)}
                </option>
              ))}
            </select>
          </div>
        );
      })}
    </div>
  );
}

function stripTex(s: string): string {
  // Dropdown can't render math; show a stripped fallback so the picker is
  // still meaningful. The labelled List-II is shown separately above the
  // matching grid in the question pane.
  return s.replace(/\$\$?([^$]+)\$\$?/g, '$1').slice(0, 60);
}
