/**
 * SubmitConfirm spec — [UX Audit v1 loop-back MED-1].
 *
 * Locks the per-question chip grid + summary text + jump-on-click behaviour
 * the auditor demanded for PRD US-6 AC compliance.
 */

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { SubmitConfirm, type SubmitChip, type SubmitCounts } from './SubmitConfirm';

function makeCounts(over: Partial<SubmitCounts> = {}): SubmitCounts {
  return {
    answered: 16,
    marked: 1,
    marked_and_answered: 0,
    visited_not_answered: 1,
    not_visited: 0,
    total: 18,
    ...over,
  };
}

const chips: SubmitChip[] = [
  { slotIndex: 0, slotPosition: 1, status: 'ANSWERED' },
  { slotIndex: 1, slotPosition: 2, status: 'ANSWERED' },
  { slotIndex: 2, slotPosition: 3, status: 'MARKED_FOR_REVIEW' },
  { slotIndex: 3, slotPosition: 4, status: 'VISITED_NOT_ANSWERED' },
  { slotIndex: 4, slotPosition: 5, status: 'NOT_VISITED' },
];

describe('SubmitConfirm — per-question chip grid (MED-1)', () => {
  it('renders one chip per slot when chips are provided', () => {
    render(
      <SubmitConfirm
        open
        counts={makeCounts({
          answered: 2,
          marked: 1,
          visited_not_answered: 1,
          not_visited: 1,
          total: 5,
        })}
        timeRemainingLabel="01:23:45"
        draining={false}
        drainingPending={0}
        onCancel={() => {}}
        onConfirm={() => {}}
        chips={chips}
        onJumpToSlot={() => {}}
      />,
    );
    expect(screen.getByTestId('submit-chip-grid')).toBeInTheDocument();
    expect(screen.getAllByTestId(/submit-chip-\d+/)).toHaveLength(5);
  });

  it('shows the X answered / Y unanswered / Z marked summary', () => {
    render(
      <SubmitConfirm
        open
        counts={makeCounts({
          answered: 2,
          marked: 1,
          visited_not_answered: 1,
          not_visited: 1,
          total: 5,
        })}
        timeRemainingLabel="01:23:45"
        draining={false}
        drainingPending={0}
        onCancel={() => {}}
        onConfirm={() => {}}
        chips={chips}
        onJumpToSlot={() => {}}
      />,
    );
    expect(
      screen.getByText(/2 answered, 2 unanswered, 1 marked for review/i),
    ).toBeInTheDocument();
  });

  it('jumps to a slot when a chip is clicked', () => {
    const onJump = vi.fn();
    const onCancel = vi.fn();
    render(
      <SubmitConfirm
        open
        counts={makeCounts()}
        timeRemainingLabel="01:23:45"
        draining={false}
        drainingPending={0}
        onCancel={onCancel}
        onConfirm={() => {}}
        chips={chips}
        onJumpToSlot={onJump}
      />,
    );
    fireEvent.click(screen.getByTestId('submit-chip-3'));
    expect(onJump).toHaveBeenCalledWith(3);
    // Modal should close: the parent handles step reset by re-mounting on
    // next open, so we verify the cancel side-effect.
    expect(onCancel).toHaveBeenCalled();
  });

  it('omits the chip grid when no chips prop is supplied', () => {
    render(
      <SubmitConfirm
        open
        counts={makeCounts()}
        timeRemainingLabel="01:23:45"
        draining={false}
        drainingPending={0}
        onCancel={() => {}}
        onConfirm={() => {}}
      />,
    );
    expect(screen.queryByTestId('submit-chip-grid')).not.toBeInTheDocument();
  });
});
