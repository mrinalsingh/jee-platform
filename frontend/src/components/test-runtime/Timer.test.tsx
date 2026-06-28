import { render, screen, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Timer } from './Timer';

describe('Timer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders remaining time in HH:MM:SS', () => {
    const now = Date.now();
    render(
      <Timer
        expiresAtMs={now + 3725 * 1000}
        serverClockOffsetMs={0}
        onExpiry={() => {}}
      />,
    );
    expect(screen.getByRole('timer')).toHaveTextContent('01:02:05');
  });

  it('fires onExpiry exactly once when time reaches zero', () => {
    const now = Date.now();
    const onExpiry = vi.fn();
    render(
      <Timer
        expiresAtMs={now + 1000}
        serverClockOffsetMs={0}
        onExpiry={onExpiry}
      />,
    );
    expect(onExpiry).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(1100);
    });
    expect(onExpiry).toHaveBeenCalledTimes(1);
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(onExpiry).toHaveBeenCalledTimes(1);
  });

  it('uses server clock offset', () => {
    const now = Date.now();
    // server thinks it is 10s in the future of the client → effective remaining shrinks by 10s
    render(
      <Timer
        expiresAtMs={now + 60 * 1000}
        serverClockOffsetMs={10_000}
        onExpiry={() => {}}
      />,
    );
    expect(screen.getByRole('timer')).toHaveTextContent('00:00:50');
  });
});
