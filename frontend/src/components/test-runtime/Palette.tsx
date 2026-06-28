'use client';

import type { PerQuestionStatus } from '@/lib/runtime-types';

export interface PaletteSlot {
  slotPosition: number; // 1-indexed display number
  slotIndex: number;
  status: PerQuestionStatus;
  pendingSync: boolean;
}

export interface PaletteProps {
  slots: PaletteSlot[];
  currentSlotIndex: number;
  onJump: (slotIndex: number) => void;
  /**
   * [UPDATED v2 — M8] — optional callback fired when the student wants to
   * toggle the marked-for-review flag from the palette directly. Bound to
   * a shift-click on the cell. Right-click is reserved for the anti-cheat
   * detector, so a modifier-click is used instead.
   */
  onToggleMark?: (slotIndex: number) => void;
}

function classFor(status: PerQuestionStatus): string {
  switch (status) {
    case 'NOT_VISITED':
      return 'bg-[var(--palette-not-visited-bg)] text-[var(--palette-not-visited-fg)] border border-border-subtle';
    case 'VISITED_NOT_ANSWERED':
      return 'bg-[var(--palette-visited-bg)] text-[var(--palette-visited-fg)]';
    case 'ANSWERED':
      return 'bg-[var(--palette-answered-bg)] text-[var(--palette-answered-fg)]';
    case 'MARKED_FOR_REVIEW':
      return 'bg-[var(--palette-marked-bg)] text-[var(--palette-marked-fg)]';
    case 'ANSWERED_AND_MARKED':
      return 'bg-[var(--palette-marked-bg)] text-[var(--palette-marked-fg)]';
  }
}

function symbolFor(status: PerQuestionStatus): string | null {
  switch (status) {
    case 'ANSWERED':
      return '✓';
    case 'MARKED_FOR_REVIEW':
      return '⚑';
    case 'ANSWERED_AND_MARKED':
      return '⚑';
    default:
      return null;
  }
}

export function Palette(props: PaletteProps): React.ReactElement {
  const { slots, currentSlotIndex, onJump, onToggleMark } = props;
  return (
    <div className="space-y-3" role="grid" aria-label="Question palette">
      {/* PRD §7.5: 8-column grid with 4 px gap on desktop. */}
      <div className="grid grid-cols-8 gap-1">
        {slots.map((s) => {
          const isCurrent = s.slotIndex === currentSlotIndex;
          const sym = symbolFor(s.status);
          const isMarked =
            s.status === 'MARKED_FOR_REVIEW' ||
            s.status === 'ANSWERED_AND_MARKED';
          // [UPDATED v2 — M8] — palette aria-label now hints at the toggle.
          const ariaLabel = onToggleMark
            ? `Question ${s.slotPosition}, ${s.status.toLowerCase().replace(/_/g, ' ')}. Shift-click to ${isMarked ? 'unmark' : 'mark'} for review.`
            : `Question ${s.slotPosition}, ${s.status.toLowerCase().replace(/_/g, ' ')}`;
          return (
            <button
              type="button"
              role="gridcell"
              key={s.slotIndex}
              onClick={(e) => {
                // [UPDATED v2 — M8] — shift-click toggles the marked flag
                // in-place; plain click jumps as before.
                if (onToggleMark && e.shiftKey) {
                  e.preventDefault();
                  onToggleMark(s.slotIndex);
                } else {
                  onJump(s.slotIndex);
                }
              }}
              aria-label={ariaLabel}
              aria-current={isCurrent ? 'true' : undefined}
              className={`relative h-10 w-10 rounded-md text-sm font-medium transition-colors ${classFor(s.status)} ${
                isCurrent ? 'ring-2 ring-[var(--accent)] ring-offset-2 ring-offset-surface-1' : ''
              }`}
            >
              {s.slotPosition}
              {sym && (
                <span
                  aria-hidden="true"
                  className="absolute -top-1 -right-1 text-[10px]"
                >
                  {sym}
                </span>
              )}
              {s.status === 'ANSWERED_AND_MARKED' && (
                <span
                  aria-hidden="true"
                  className="absolute -bottom-1 -right-1 inline-block h-2 w-2 rounded-full bg-[var(--palette-marked-dot)]"
                />
              )}
              {s.pendingSync && (
                <span
                  aria-hidden="true"
                  className="absolute -bottom-1 -left-1 inline-block h-1.5 w-1.5 rounded-full bg-gray-400"
                />
              )}
            </button>
          );
        })}
      </div>
      <PaletteLegend />
      {/* [UPDATED v2 — M8] — hint the shift-click affordance once. */}
      {onToggleMark && (
        <p className="text-[11px] text-text-secondary">
          Tip: shift-click a question to toggle its mark-for-review flag.
        </p>
      )}
    </div>
  );
}

function PaletteLegend(): React.ReactElement {
  const items: Array<{ label: string; cls: string }> = [
    { label: 'Answered', cls: 'bg-[var(--palette-answered-bg)]' },
    { label: 'Not answered', cls: 'bg-[var(--palette-visited-bg)]' },
    { label: 'Marked', cls: 'bg-[var(--palette-marked-bg)]' },
    {
      label: 'Not visited',
      cls: 'bg-[var(--palette-not-visited-bg)] border border-border-subtle',
    },
  ];
  return (
    <ul className="text-xs space-y-1 text-text-secondary">
      {items.map((it) => (
        <li key={it.label} className="flex items-center gap-2">
          <span className={`inline-block h-3 w-3 rounded-sm ${it.cls}`} />
          <span>{it.label}</span>
        </li>
      ))}
    </ul>
  );
}
