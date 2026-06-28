import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { Palette, type PaletteSlot } from './Palette';

const slots: PaletteSlot[] = [
  { slotPosition: 1, slotIndex: 0, status: 'ANSWERED', pendingSync: false },
  {
    slotPosition: 2,
    slotIndex: 1,
    status: 'VISITED_NOT_ANSWERED',
    pendingSync: false,
  },
  { slotPosition: 3, slotIndex: 2, status: 'MARKED_FOR_REVIEW', pendingSync: false },
  {
    slotPosition: 4,
    slotIndex: 3,
    status: 'ANSWERED_AND_MARKED',
    pendingSync: true,
  },
  { slotPosition: 5, slotIndex: 4, status: 'NOT_VISITED', pendingSync: false },
];

describe('Palette', () => {
  it('renders one cell per slot', () => {
    render(
      <Palette slots={slots} currentSlotIndex={0} onJump={() => {}} />,
    );
    // 5 question cells + 4 legend swatches → 9 buttons-or-gridcells; we count cells only
    expect(screen.getAllByRole('gridcell')).toHaveLength(5);
  });

  it('marks the current slot via aria-current', () => {
    render(
      <Palette slots={slots} currentSlotIndex={2} onJump={() => {}} />,
    );
    const cells = screen.getAllByRole('gridcell');
    expect(cells[2]).toHaveAttribute('aria-current', 'true');
    expect(cells[0]).not.toHaveAttribute('aria-current');
  });

  it('emits the slot index on click', () => {
    const onJump = vi.fn();
    render(
      <Palette slots={slots} currentSlotIndex={0} onJump={onJump} />,
    );
    fireEvent.click(screen.getAllByRole('gridcell')[3]);
    expect(onJump).toHaveBeenCalledWith(3);
  });

  it('exposes a meaningful aria-label per cell', () => {
    render(
      <Palette slots={slots} currentSlotIndex={0} onJump={() => {}} />,
    );
    expect(
      screen.getByLabelText(/Question 1, answered/i),
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText(/Question 4, answered and marked/i),
    ).toBeInTheDocument();
  });

  // [UPDATED v2 — M8]
  describe('shift-click toggles mark-for-review', () => {
    it('shift-click on a marked slot calls onToggleMark with that slotIndex', () => {
      const onJump = vi.fn();
      const onToggleMark = vi.fn();
      render(
        <Palette
          slots={slots}
          currentSlotIndex={0}
          onJump={onJump}
          onToggleMark={onToggleMark}
        />,
      );
      const cells = screen.getAllByRole('gridcell');
      // slot index 2 is MARKED_FOR_REVIEW
      fireEvent.click(cells[2], { shiftKey: true });
      expect(onToggleMark).toHaveBeenCalledWith(2);
      expect(onJump).not.toHaveBeenCalled();
    });

    it('plain click still jumps even when onToggleMark is provided', () => {
      const onJump = vi.fn();
      const onToggleMark = vi.fn();
      render(
        <Palette
          slots={slots}
          currentSlotIndex={0}
          onJump={onJump}
          onToggleMark={onToggleMark}
        />,
      );
      fireEvent.click(screen.getAllByRole('gridcell')[1]);
      expect(onJump).toHaveBeenCalledWith(1);
      expect(onToggleMark).not.toHaveBeenCalled();
    });

    it('aria-label hints the action (mark vs unmark)', () => {
      render(
        <Palette
          slots={slots}
          currentSlotIndex={0}
          onJump={() => {}}
          onToggleMark={() => {}}
        />,
      );
      // slot 1 (VISITED_NOT_ANSWERED, not marked) → "to mark"
      expect(screen.getByLabelText(/Question 2,.* to mark/i)).toBeInTheDocument();
      // slot 3 (MARKED_FOR_REVIEW) → "to unmark"
      expect(screen.getByLabelText(/Question 3,.* to unmark/i)).toBeInTheDocument();
    });
  });
});
