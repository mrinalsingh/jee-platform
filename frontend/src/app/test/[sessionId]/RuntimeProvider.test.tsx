/**
 * [UPDATED v3 — NEW-1] — RuntimeProvider integration test focused on the
 * auth-error path that the v2 review flagged:
 *
 *   1. heartbeat tick returns 401  →  AuthErrorBanner renders, timer
 *      expiry does NOT fire NETWORK_FAILURE_FALLBACK
 *   2. timer reaches T=0 while in auth-error state  →  /submit is never
 *      called (no silent data loss disguised as success)
 *
 * Mocks: `next/navigation` (router), global `fetch` (sequence of canned
 * responses), and `isomorphic-dompurify` (the real one tries to read a
 * full DOMPurify polyfill that jsdom doesn't fully satisfy in the strict
 * test runner — its absence does not affect this test).
 */

import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { SessionPayload } from '@/lib/runtime-types';

import { RuntimeProvider } from './RuntimeProvider';

// Mock the Next router so push() is observable + no real navigation.
const pushMock = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock, replace: pushMock, prefetch: vi.fn() }),
}));

// Minimal session fixture: one MCQ-SC slot, expires 2 s in the future so we
// can fast-forward the timer to 0 inside the test.
function makeSession(): SessionPayload {
  const now = new Date();
  const expires = new Date(now.getTime() + 2_000);
  return {
    session_id: 'sess_v3_authtest',
    test_id: 1,
    test_title: 'NEW-1 Auth Regression',
    target_exam: 'JEE_ADVANCED',
    started_at: now.toISOString(),
    expires_at: expires.toISOString(),
    submitted_at: null,
    duration_seconds: 2,
    marking_scheme: {
      scheme_version: 1,
      per_answer_type: {
        'MCQ-SC': { correct: 4, wrong: -1, unanswered: 0 },
        'MCQ-MC': {},
        'NUM-INT': { correct: 4, wrong: 0, unanswered: 0 },
        'NUM-DEC': { correct: 4, wrong: 0, unanswered: 0 },
        'MAT-COL': {},
      },
    },
    sections: [
      {
        section_id: 1,
        subject: 'Maths',
        slots: [
          {
            slot_index: 0,
            statement: 'What is 1 + 1?',
            answer_type: 'MCQ-SC',
            answer_spec: { type: 'MCQ-SC', option_count: 4 },
            figure_signed_tokens: [],
            hint_count: 0,
            options: ['1', '2', '3', '4'],
          },
        ],
      },
    ],
    snapshots: [],
    multi_device_warning: false,
    violations_count: 0,
    server_now: now.toISOString(),
  };
}

// Force a wider viewport so we don't hit the mobile hard-block.
function setDesktopViewport(): void {
  Object.defineProperty(window, 'innerWidth', {
    configurable: true,
    value: 1440,
  });
  window.matchMedia = vi.fn().mockImplementation((q: string) => ({
    matches: false, // both `(max-width: 767px)` and `(max-width: 1023px)` are false
    media: q,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
}

interface FetchCall {
  url: string;
  init: RequestInit | undefined;
}

function installFetchMock(handler: (call: FetchCall) => Response): {
  calls: FetchCall[];
} {
  const calls: FetchCall[] = [];
  globalThis.fetch = vi
    .fn()
    .mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      const call = { url, init };
      calls.push(call);
      return Promise.resolve(handler(call));
    }) as unknown as typeof fetch;
  return { calls };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('RuntimeProvider — NEW-1 auth-error path', () => {
  beforeEach(() => {
    pushMock.mockReset();
    setDesktopViewport();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders AuthErrorBanner when the heartbeat returns 401', async () => {
    const { calls } = installFetchMock(({ url }) => {
      if (url.includes('/api/test-sessions/')) {
        return jsonResponse(401, { error: 'unauthorized' });
      }
      return jsonResponse(200, {});
    });

    await act(async () => {
      render(<RuntimeProvider initialSession={makeSession()} />);
    });
    // Let the immediate heartbeat tick fire + react.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    // [UX Audit v1 HIGH-2] — headline was rewritten from "Your session
    // ended" (auditor flagged it as scary/ambiguous) to a reassurance:
    // "Sign in to keep going — your test isn't over".
    expect(
      screen.getByText(/sign in to keep going/i),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /sign in/i }),
    ).toBeInTheDocument();

    // Sanity: at least one heartbeat call was made.
    expect(
      calls.some((c) => c.url.includes('/api/test-sessions/')),
    ).toBe(true);
  });

  it('on heartbeat 401, NETWORK_FAILURE_FALLBACK does NOT fire at T=0', async () => {
    vi.useFakeTimers({ now: Date.now() });
    const { calls } = installFetchMock(({ url }) => {
      if (url.endsWith('/submit')) {
        // If we get here, the test failed: submit must NOT be called.
        return jsonResponse(200, {});
      }
      if (url.includes('/api/test-sessions/')) {
        return jsonResponse(401, { error: 'unauthorized' });
      }
      return jsonResponse(200, {});
    });

    await act(async () => {
      render(<RuntimeProvider initialSession={makeSession()} />);
    });
    // Pump microtasks so the initial heartbeat completes and sets authError.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });

    // Advance past the 2-s expiry to trigger Timer.onExpiry, which calls
    // handleTimerExpiry — the auth-error short-circuit must prevent any
    // /submit POST.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
    });

    const submitCalls = calls.filter((c) =>
      c.url.endsWith(`/sess_v3_authtest/submit`),
    );
    expect(submitCalls).toHaveLength(0);

    // And the AuthErrorBanner is still showing.
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
  });
});
