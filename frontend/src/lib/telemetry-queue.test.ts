import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SessionAuthError } from './session-auth';
import { TelemetryQueue, type TelemetrySender } from './telemetry-queue';

// idb-keyval auto-falls back to memory when indexedDB is undefined (jsdom).

function makeSender(): {
  snapshots: unknown[];
  violations: unknown[];
  sender: TelemetrySender;
  failNext: (n: number) => void;
} {
  const snapshots: unknown[] = [];
  const violations: unknown[] = [];
  let fails = 0;
  return {
    snapshots,
    violations,
    failNext(n) {
      fails = n;
    },
    sender: {
      async postSnapshot(sessionId, slotIndex, body) {
        if (fails > 0) {
          fails--;
          throw new Error('boom');
        }
        snapshots.push({ sessionId, slotIndex, body });
      },
      async postViolation(sessionId, body) {
        violations.push({ sessionId, body });
        return { violations_count: violations.length, will_auto_submit: false };
      },
    },
  };
}

describe('TelemetryQueue', () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it('flushes snapshots in order to the sender', async () => {
    const s = makeSender();
    const q = new TelemetryQueue('S1', { sender: s.sender });
    await q.hydrate();
    await q.enqueueSnapshot(0, {
      answer_payload: { type: 'MCQ-SC', selected_option: 0 },
      marked_for_review: false,
      time_seconds_delta: 1,
      visit_count: 1,
    });
    const ok = await q.drainAndWait(2_000);
    expect(ok).toBe(true);
    expect(s.snapshots).toHaveLength(1);
    expect(q.pendingCount()).toBe(0);
  });

  it('collapses repeated writes to the same slot', async () => {
    const s = makeSender();
    s.sender.postSnapshot = async () => {
      throw new Error('hold'); // prevent drain so we can verify the collapse
    };
    const q = new TelemetryQueue('S2', { sender: s.sender });
    await q.hydrate();
    for (let i = 0; i < 5; i++) {
      await q.enqueueSnapshot(0, {
        answer_payload: { type: 'NUM-DEC', value: String(i) },
        marked_for_review: false,
        time_seconds_delta: 0,
        visit_count: 1,
      });
    }
    expect(q.pendingCount()).toBe(1);
  });

  it('retries snapshots that fail once and eventually succeeds', async () => {
    const s = makeSender();
    s.failNext(1); // first attempt fails, retry succeeds
    const q = new TelemetryQueue('S3', { sender: s.sender });
    await q.hydrate();
    await q.enqueueSnapshot(0, {
      answer_payload: { type: 'MCQ-SC', selected_option: 1 },
      marked_for_review: false,
      time_seconds_delta: 1,
      visit_count: 1,
    });
    const ok = await q.drainAndWait(2_000);
    expect(ok).toBe(true);
    expect(q.pendingCount()).toBe(0);
    expect(s.snapshots).toHaveLength(1);
  });

  it('reports queue depth changes', async () => {
    const onQueueChange = vi.fn();
    const s = makeSender();
    s.sender.postSnapshot = async () => {
      throw new Error('hold');
    };
    const q = new TelemetryQueue('S4', { sender: s.sender, onQueueChange });
    await q.hydrate();
    await q.enqueueSnapshot(0, {
      answer_payload: { type: 'NUM-INT', value: '5' },
      marked_for_review: false,
      time_seconds_delta: 0,
      visit_count: 1,
    });
    expect(onQueueChange).toHaveBeenCalled();
  });

  // [UPDATED v2 — B2 / B3]
  it('fires onSyncSuccess on a successful drain', async () => {
    const s = makeSender();
    const onSyncSuccess = vi.fn();
    const q = new TelemetryQueue('S5', { sender: s.sender, onSyncSuccess });
    await q.hydrate();
    await q.enqueueSnapshot(0, {
      answer_payload: { type: 'MCQ-SC', selected_option: 0 },
      marked_for_review: false,
      time_seconds_delta: 0,
      visit_count: 1,
    });
    const ok = await q.drainAndWait(2_000);
    expect(ok).toBe(true);
    expect(onSyncSuccess).toHaveBeenCalled();
  });

  // [UPDATED v2 — B2]
  it('fires onSyncFailure with attempts count on a failed drain', async () => {
    const s = makeSender();
    s.sender.postSnapshot = async () => {
      throw new Error('network down');
    };
    const onSyncFailure = vi.fn();
    const q = new TelemetryQueue('S6', { sender: s.sender, onSyncFailure });
    await q.hydrate();
    await q.enqueueSnapshot(0, {
      answer_payload: { type: 'MCQ-SC', selected_option: 0 },
      marked_for_review: false,
      time_seconds_delta: 0,
      visit_count: 1,
    });
    // tryDrainOnce is scheduled with delay=0; let one microtask cycle pass
    await new Promise((r) => setTimeout(r, 20));
    expect(onSyncFailure).toHaveBeenCalled();
    const last = onSyncFailure.mock.calls.at(-1)?.[0] as {
      attempts: number;
      error: Error;
    };
    expect(last.attempts).toBeGreaterThanOrEqual(1);
    expect(last.error.message).toBe('network down');
  });

  // [UPDATED v3 — NEW-1]
  it('on 401: fires onSyncAuthError exactly once and does NOT fire onSyncFailure', async () => {
    const s = makeSender();
    s.sender.postSnapshot = async () => {
      throw new SessionAuthError('snapshot PATCH 401');
    };
    const onSyncAuthError = vi.fn();
    const onSyncFailure = vi.fn();
    const onSyncError = vi.fn();
    const q = new TelemetryQueue('S7', {
      sender: s.sender,
      onSyncAuthError,
      onSyncFailure,
      onSyncError,
    });
    await q.hydrate();
    await q.enqueueSnapshot(0, {
      answer_payload: { type: 'MCQ-SC', selected_option: 0 },
      marked_for_review: false,
      time_seconds_delta: 0,
      visit_count: 1,
    });
    await new Promise((r) => setTimeout(r, 30));
    expect(onSyncAuthError).toHaveBeenCalledTimes(1);
    expect(onSyncFailure).not.toHaveBeenCalled();
    expect(onSyncError).not.toHaveBeenCalled();
    expect(q.isDormant()).toBe(true);
    // Queue is dormant: pending item is NOT consumed.
    expect(q.pendingCount()).toBe(1);
  });

  // [UPDATED v3 — NEW-1]
  it('after 401: subsequent enqueues do not fire onSyncFailure (queue dormant)', async () => {
    const s = makeSender();
    s.sender.postSnapshot = async () => {
      throw new SessionAuthError('snapshot PATCH 401');
    };
    const onSyncAuthError = vi.fn();
    const onSyncFailure = vi.fn();
    const q = new TelemetryQueue('S8', {
      sender: s.sender,
      onSyncAuthError,
      onSyncFailure,
    });
    await q.hydrate();
    await q.enqueueSnapshot(0, {
      answer_payload: { type: 'MCQ-SC', selected_option: 0 },
      marked_for_review: false,
      time_seconds_delta: 0,
      visit_count: 1,
    });
    await new Promise((r) => setTimeout(r, 30));
    expect(onSyncAuthError).toHaveBeenCalledTimes(1);

    // Now enqueue more while dormant.
    await q.enqueueSnapshot(1, {
      answer_payload: { type: 'MCQ-SC', selected_option: 1 },
      marked_for_review: false,
      time_seconds_delta: 0,
      visit_count: 1,
    });
    await q.enqueueSnapshot(2, {
      answer_payload: { type: 'MCQ-SC', selected_option: 2 },
      marked_for_review: false,
      time_seconds_delta: 0,
      visit_count: 1,
    });
    await new Promise((r) => setTimeout(r, 30));

    // No further callbacks — queue stayed dormant, items just persisted.
    expect(onSyncAuthError).toHaveBeenCalledTimes(1);
    expect(onSyncFailure).not.toHaveBeenCalled();
    expect(q.isDormant()).toBe(true);
    expect(q.pendingCount()).toBe(3);
  });

  // [UPDATED v3 — NEW-1]
  it('resume() after 401 re-arms the queue and drains pending items', async () => {
    const s = makeSender();
    let raise401 = true;
    s.sender.postSnapshot = async (sessionId, slotIndex, body) => {
      if (raise401) throw new SessionAuthError('snapshot PATCH 401');
      // Once raise401 is cleared, behave as the default recorder.
      s.snapshots.push({ sessionId, slotIndex, body });
    };
    const onSyncAuthError = vi.fn();
    const onSyncSuccess = vi.fn();
    const q = new TelemetryQueue('S9', {
      sender: s.sender,
      onSyncAuthError,
      onSyncSuccess,
    });
    await q.hydrate();
    await q.enqueueSnapshot(0, {
      answer_payload: { type: 'MCQ-SC', selected_option: 0 },
      marked_for_review: false,
      time_seconds_delta: 0,
      visit_count: 1,
    });
    await new Promise((r) => setTimeout(r, 30));
    expect(q.isDormant()).toBe(true);
    expect(q.pendingCount()).toBe(1);

    // Simulate the user signing back in: sender now succeeds; caller resumes.
    raise401 = false;
    q.resume();
    expect(q.isDormant()).toBe(false);

    const ok = await q.drainAndWait(2_000);
    expect(ok).toBe(true);
    expect(s.snapshots).toHaveLength(1);
    expect(onSyncSuccess).toHaveBeenCalled();
  });
});
