/**
 * IndexedDB-backed telemetry queue.
 *
 * PRD US-3 / US-7 / §5.7: every attempt action is persisted to IndexedDB
 * *before* the UI advances state. A background drainer posts to the server
 * with exponential backoff 5s → 10s → 20s → 40s → 60s (cap).
 *
 * Snapshot writes are UPSERTed server-side by (session_id, slot_index) with
 * the highest `action_seq` winning (architecture §6.2). That means the queue
 * can collapse multiple pending writes for the same slot down to the latest.
 *
 * Storage: `idb-keyval` keyed under `runtime-q::{session_id}`. The value is
 * the JSON array of pending actions; we rewrite the whole array on each
 * mutation. Pilot scale (≤ 100 questions × ≤ 100 actions ≈ 10 KB) makes the
 * whole-rewrite strategy trivially correct and avoids cursor complexity.
 */

import { get, set, del } from 'idb-keyval';

import type { AnswerPayload, ViolationType } from './runtime-types';
// [UPDATED v3 — NEW-1] — import from `./session-auth` directly: `./session-fetch`
// pulls `next/headers`, which Turbopack rejects in the client bundle.
import { SessionAuthError } from './session-auth';

const BACKOFF_SCHEDULE_MS = [5_000, 10_000, 20_000, 40_000, 60_000];

export type QueuedAction =
  | {
      kind: 'snapshot';
      session_id: string;
      slot_index: number;
      action_seq: number;
      client_timestamp_ms: number;
      body: {
        answer_payload: AnswerPayload;
        marked_for_review: boolean;
        time_seconds_delta: number;
        visit_count: number;
        hints_used?: number;
      };
    }
  | {
      kind: 'violation';
      session_id: string;
      action_seq: number;
      client_timestamp_ms: number;
      body: {
        violation_type: ViolationType;
        was_active: boolean;
      };
    };

interface QueueState {
  pending: QueuedAction[];
  // attempts per action (parallel array; mirrors pending.length)
  attempts: number[];
}

const memoryFallback = new Map<string, QueueState>();
let idbAvailable: boolean | null = null;

async function probeIdb(): Promise<boolean> {
  if (idbAvailable !== null) return idbAvailable;
  try {
    if (typeof indexedDB === 'undefined') {
      idbAvailable = false;
      return false;
    }
    await set('idb-probe', 1);
    await del('idb-probe');
    idbAvailable = true;
  } catch {
    idbAvailable = false;
  }
  return idbAvailable;
}

function storageKey(sessionId: string): string {
  return `runtime-q::${sessionId}`;
}

async function loadState(sessionId: string): Promise<QueueState> {
  if (await probeIdb()) {
    const raw = (await get(storageKey(sessionId))) as QueueState | undefined;
    return raw ?? { pending: [], attempts: [] };
  }
  return memoryFallback.get(sessionId) ?? { pending: [], attempts: [] };
}

async function saveState(
  sessionId: string,
  state: QueueState,
): Promise<void> {
  if (await probeIdb()) {
    await set(storageKey(sessionId), state);
  } else {
    memoryFallback.set(sessionId, state);
  }
}

/** Server is the storage authority — only the latest action_seq per slot wins. */
function collapseSnapshots(actions: QueuedAction[]): QueuedAction[] {
  const lastSnapshotIdx = new Map<number, number>(); // slot -> idx in actions
  for (let i = 0; i < actions.length; i++) {
    const a = actions[i];
    if (a.kind === 'snapshot') {
      lastSnapshotIdx.set(a.slot_index, i);
    }
  }
  return actions.filter((a, i) => {
    if (a.kind !== 'snapshot') return true;
    return lastSnapshotIdx.get(a.slot_index) === i;
  });
}

export interface TelemetrySender {
  postSnapshot(
    sessionId: string,
    slotIndex: number,
    body: Extract<QueuedAction, { kind: 'snapshot' }>['body'] & {
      action_seq: number;
      client_timestamp_ms: number;
    },
  ): Promise<void>;
  postViolation(
    sessionId: string,
    body: Extract<QueuedAction, { kind: 'violation' }>['body'] & {
      action_seq: number;
      client_timestamp_ms: number;
    },
  ): Promise<{ violations_count: number; will_auto_submit: boolean }>;
}

export interface QueueOptions {
  /** Inject for tests; defaults to the standard fetch-based sender. */
  sender?: TelemetrySender;
  /** Called when an unrecoverable error happens (US-7 E1). */
  onSyncError?: (slotIndex: number | null, error: Error) => void;
  /** Called whenever the queue depth changes. */
  onQueueChange?: (pendingCount: number) => void;
  /** Called when a violation drains and the server says auto-submit. */
  onViolationAck?: (info: {
    violations_count: number;
    will_auto_submit: boolean;
  }) => void;
  /**
   * [UPDATED v2 — B2] — fires on every drain attempt that throws
   * (network/5xx). Caller uses this to track `consecutiveSyncFailures`
   * and to decide whether to fall back to NETWORK_FAILURE_FALLBACK at
   * timer expiry. `attempts` is the new failure count (1-based).
   */
  onSyncFailure?: (info: { attempts: number; error: Error }) => void;
  /**
   * [UPDATED v2 — B2 / B3] — fires whenever the queue drains an action
   * successfully. Caller uses this to update `lastSuccessfulHeartbeat`
   * (any successful PATCH counts as proof that the server is reachable).
   */
  onSyncSuccess?: () => void;
  /**
   * [UPDATED v3 — NEW-1] — fires once when the server explicitly rejects
   * the session cookie (HTTP 401). Distinct from `onSyncFailure`, which is
   * for transient network / 5xx errors. After this fires the queue is
   * dormant: pending items remain on disk (so a successful re-auth + call
   * to `resume()` can drain them), but no further timers are scheduled,
   * subsequent `enqueueSnapshot` / `enqueueViolation` calls just append
   * without trying to dispatch, and `onSyncFailure` is NOT called for the
   * triggering 401 (auth failure is a different event class from network
   * failure — see code-review v2 NEW-1).
   */
  onSyncAuthError?: (error: SessionAuthError) => void;
}

export class TelemetryQueue {
  private state: QueueState = { pending: [], attempts: [] };
  private draining = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly sessionId: string;
  private readonly sender: TelemetrySender;
  private readonly opts: QueueOptions;
  private localCounter = 0;
  /**
   * [UPDATED v3 — NEW-1] — when true the queue has stopped because the
   * server returned 401 on the last dispatch. Pending items stay on disk;
   * timers don't fire; further enqueues just persist without dispatch.
   * Cleared by `resume()` after a successful re-auth.
   */
  private dormant = false;

  constructor(sessionId: string, opts: QueueOptions = {}) {
    this.sessionId = sessionId;
    this.sender = opts.sender ?? defaultSender();
    this.opts = opts;
  }

  async hydrate(): Promise<void> {
    this.state = await loadState(this.sessionId);
    this.localCounter = this.state.pending.reduce(
      (m, a) => Math.max(m, a.action_seq),
      0,
    );
    this.opts.onQueueChange?.(this.state.pending.length);
    if (this.state.pending.length > 0) this.scheduleDrain(0);
  }

  /**
   * [UPDATED v3 — NEW-1] — re-arm the queue after a successful re-auth.
   * The RuntimeProvider calls this after the user returns from /login with
   * a fresh cookie. Any pending items (durably persisted while dormant) are
   * dispatched on the next tick.
   */
  resume(): void {
    if (!this.dormant) return;
    this.dormant = false;
    if (this.state.pending.length > 0) this.scheduleDrain(0);
  }

  /** [UPDATED v3 — NEW-1] — test/debug helper; not used in production paths. */
  isDormant(): boolean {
    return this.dormant;
  }

  /** Returns the action_seq used so the caller can store it on the snapshot. */
  async enqueueSnapshot(
    slotIndex: number,
    body: Extract<QueuedAction, { kind: 'snapshot' }>['body'],
    clientTimestampMs: number = Date.now(),
  ): Promise<number> {
    this.localCounter += 1;
    const action: QueuedAction = {
      kind: 'snapshot',
      session_id: this.sessionId,
      slot_index: slotIndex,
      action_seq: this.localCounter,
      client_timestamp_ms: clientTimestampMs,
      body,
    };
    await this.append(action);
    return this.localCounter;
  }

  async enqueueViolation(
    violationType: ViolationType,
    wasActive: boolean,
    clientTimestampMs: number = Date.now(),
  ): Promise<number> {
    this.localCounter += 1;
    const action: QueuedAction = {
      kind: 'violation',
      session_id: this.sessionId,
      action_seq: this.localCounter,
      client_timestamp_ms: clientTimestampMs,
      body: { violation_type: violationType, was_active: wasActive },
    };
    await this.append(action);
    return this.localCounter;
  }

  private async append(action: QueuedAction): Promise<void> {
    this.state.pending.push(action);
    this.state.attempts.push(0);
    // Collapse same-slot snapshots (architecture §6.2 — latest action_seq wins)
    const before = this.state.pending.length;
    this.state.pending = collapseSnapshots(this.state.pending);
    if (this.state.pending.length !== before) {
      // realign attempts — for any kept action, keep its attempts; we just
      // reset attempts for surviving snapshots since their predecessors are
      // gone (this is fine: server upsert is idempotent on action_seq).
      this.state.attempts = this.state.pending.map(() => 0);
    }
    await saveState(this.sessionId, this.state);
    this.opts.onQueueChange?.(this.state.pending.length);
    this.scheduleDrain(0);
  }

  /**
   * Block until the queue empties, capped at maxWaitMs. Used by submit (US-5,
   * US-6) which needs the queue drained before the submit POST fires.
   * Returns true if drained cleanly, false on timeout.
   */
  async drainAndWait(maxWaitMs: number): Promise<boolean> {
    const deadline = Date.now() + maxWaitMs;
    while (this.state.pending.length > 0 && Date.now() < deadline) {
      await this.tryDrainOnce();
      if (this.state.pending.length > 0) {
        await new Promise((r) => setTimeout(r, 200));
      }
    }
    return this.state.pending.length === 0;
  }

  pendingCount(): number {
    return this.state.pending.length;
  }

  /** Force-clear (used at submit success and at session END). */
  async clear(): Promise<void> {
    this.state = { pending: [], attempts: [] };
    if (await probeIdb()) await del(storageKey(this.sessionId));
    else memoryFallback.delete(this.sessionId);
    this.opts.onQueueChange?.(0);
  }

  private scheduleDrain(delayMs: number): void {
    // [UPDATED v3 — NEW-1] — dormant queue: do not schedule new dispatch
    // attempts. Items remain on disk; `resume()` will re-arm us.
    if (this.dormant) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      void this.tryDrainOnce();
    }, delayMs);
  }

  private async tryDrainOnce(): Promise<void> {
    if (this.draining) return;
    // [UPDATED v3 — NEW-1] — dormant queue: bail out without dispatching.
    if (this.dormant) return;
    this.draining = true;
    try {
      while (this.state.pending.length > 0) {
        // [UPDATED v3 — NEW-1] — re-check dormant inside the loop in case
        // a prior dispatch in this batch tripped 401 and set the flag.
        if (this.dormant) return;
        const action = this.state.pending[0];
        const attempts = this.state.attempts[0];
        try {
          await this.dispatch(action);
          this.state.pending.shift();
          this.state.attempts.shift();
          await saveState(this.sessionId, this.state);
          this.opts.onQueueChange?.(this.state.pending.length);
          // [UPDATED v2 — B2/B3] — successful drain is the canonical
          // signal that the server is reachable. Caller uses this to
          // reset `consecutiveSyncFailures` and refresh
          // `lastSuccessfulHeartbeat`.
          this.opts.onSyncSuccess?.();
        } catch (e) {
          // [UPDATED v3 — NEW-1] — auth failure is a different class of
          // event from network failure. Halt the queue (do not retry, do
          // not consume the head item, do not call onSyncFailure), fire
          // onSyncAuthError exactly once, and exit. Pending items stay on
          // disk in case re-auth succeeds and resume() is called.
          if (SessionAuthError.is(e)) {
            this.dormant = true;
            if (this.timer) {
              clearTimeout(this.timer);
              this.timer = null;
            }
            this.opts.onSyncAuthError?.(e as SessionAuthError);
            return;
          }
          // network or 5xx — bump attempts, back off, stop draining this round
          this.state.attempts[0] = attempts + 1;
          await saveState(this.sessionId, this.state);
          const idx = Math.min(attempts, BACKOFF_SCHEDULE_MS.length - 1);
          this.scheduleDrain(BACKOFF_SCHEDULE_MS[idx]);
          const err = e instanceof Error ? e : new Error(String(e));
          // [UPDATED v2 — B2] — every failure pings the caller so the
          // RuntimeProvider can decide whether to fall back at timer
          // expiry to NETWORK_FAILURE_FALLBACK.
          this.opts.onSyncFailure?.({ attempts: attempts + 1, error: err });
          // For chronic failures (≥ 5 attempts), surface to UI
          if (attempts >= BACKOFF_SCHEDULE_MS.length - 1) {
            this.opts.onSyncError?.(
              action.kind === 'snapshot' ? action.slot_index : null,
              err,
            );
          }
          return;
        }
      }
    } finally {
      this.draining = false;
    }
  }

  private async dispatch(action: QueuedAction): Promise<void> {
    if (action.kind === 'snapshot') {
      await this.sender.postSnapshot(action.session_id, action.slot_index, {
        ...action.body,
        action_seq: action.action_seq,
        client_timestamp_ms: action.client_timestamp_ms,
      });
    } else {
      const ack = await this.sender.postViolation(action.session_id, {
        ...action.body,
        action_seq: action.action_seq,
        client_timestamp_ms: action.client_timestamp_ms,
      });
      this.opts.onViolationAck?.(ack);
    }
  }
}

/** Default `fetch`-based sender — same-origin per architecture §5. */
function defaultSender(): TelemetrySender {
  return {
    async postSnapshot(sessionId, slotIndex, body) {
      const res = await fetch(
        `/api/test-sessions/${encodeURIComponent(sessionId)}/snapshots/${slotIndex}`,
        {
          method: 'PATCH',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
      );
      // [UPDATED v3 — NEW-1] — 401 must surface as the typed sentinel so
      // the queue's catch-block can halt instead of treating it as a
      // transient network failure (which would loop forever and end in a
      // silent NETWORK_FAILURE_FALLBACK).
      if (res.status === 401) {
        throw new SessionAuthError(`snapshot PATCH 401`);
      }
      if (!res.ok) {
        throw new Error(`snapshot PATCH ${res.status}`);
      }
    },
    async postViolation(sessionId, body) {
      const res = await fetch(
        `/api/test-sessions/${encodeURIComponent(sessionId)}/violations`,
        {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
      );
      // [UPDATED v3 — NEW-1] — see postSnapshot above.
      if (res.status === 401) {
        throw new SessionAuthError(`violation POST 401`);
      }
      if (!res.ok) throw new Error(`violation POST ${res.status}`);
      return (await res.json()) as {
        violations_count: number;
        will_auto_submit: boolean;
      };
    },
  };
}
