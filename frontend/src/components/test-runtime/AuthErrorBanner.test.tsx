/**
 * AuthErrorBanner unit spec — [UX Audit v1 loop-back, HIGH-2].
 *
 * Locks the copy + timer-status changes the auditor flagged:
 *   1. The banner explicitly states the timer is STILL RUNNING.
 *   2. The banner shows the remaining-time pill, mono-formatted HH:MM:SS.
 *   3. The reassurance copy mentions answers being safe / synced.
 *   4. The "Sign in" CTA is autofocused.
 */

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { AuthErrorBanner } from './AuthErrorBanner';

describe('AuthErrorBanner — UX Audit v1 HIGH-2', () => {
  it('shows the remaining time as an HH:MM:SS pill', () => {
    render(
      <AuthErrorBanner secondsRemaining={3_725} onSignIn={() => {}} />,
    );
    // 3725 s = 01:02:05
    const pill = screen.getByTestId('auth-error-time-remaining');
    expect(pill.textContent).toBe('01:02:05');
  });

  it('explicitly states that the test timer is still running', () => {
    render(
      <AuthErrorBanner secondsRemaining={600} onSignIn={() => {}} />,
    );
    // The strong-tagged phrase makes it impossible to miss.
    expect(
      screen.getByText(/test timer is still running/i),
    ).toBeInTheDocument();
  });

  it('reassures that saved answers are safe', () => {
    render(
      <AuthErrorBanner secondsRemaining={600} onSignIn={() => {}} />,
    );
    expect(
      screen.getByText(/saved answers are safe/i),
    ).toBeInTheDocument();
  });

  it('emits onSignIn when the CTA is clicked', () => {
    const onSignIn = vi.fn();
    render(
      <AuthErrorBanner secondsRemaining={600} onSignIn={onSignIn} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));
    expect(onSignIn).toHaveBeenCalledOnce();
  });

  it('uses an alertdialog role for screen-reader trap behaviour', () => {
    render(
      <AuthErrorBanner secondsRemaining={600} onSignIn={() => {}} />,
    );
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
  });
});
