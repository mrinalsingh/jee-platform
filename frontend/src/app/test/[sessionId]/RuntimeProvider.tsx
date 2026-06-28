'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

import { AnswerEntry } from '@/components/test-runtime/AnswerEntry';
import { AuthErrorBanner } from '@/components/test-runtime/AuthErrorBanner';
import { HintCard } from '@/components/test-runtime/HintCard';
import { MobileBlock } from '@/components/test-runtime/MobileBlock';
import { Palette } from '@/components/test-runtime/Palette';
import { QuestionPane } from '@/components/test-runtime/QuestionPane';
import { SubmitConfirm } from '@/components/test-runtime/SubmitConfirm';
import { Timer } from '@/components/test-runtime/Timer';
import { ViolationBanner } from '@/components/test-runtime/ViolationBanner';
import { installAntiCheat } from '@/lib/anti-cheat';
import type {
  AnswerPayload,
  AutoSubmitSource,
  SessionPayload,
  SlotPayload,
  SnapshotState,
  ViolationType,
} from '@/lib/runtime-types';
import { emptyPayloadFor, statusFor } from '@/lib/runtime-types';
// [UPDATED v3 — NEW-1] — import from `@/lib/session-auth` directly so this
// client component does not transitively pull `next/headers`.
import { SessionAuthError } from '@/lib/session-auth';
import { TelemetryQueue } from '@/lib/telemetry-queue';

export interface RuntimeProviderProps {
  initialSession: SessionPayload;
}

type SubmitState = 'IDLE' | 'COUNTING' | 'AUTO_SUBMITTING' | 'SUBMITTED';

/**
 * Heartbeat poll cadence — Architecture §5.3 endpoint 5 specifies 30 s.
 * We poll once a minute by default to keep server load down at pilot scale,
 * but the threshold for declaring "network is down" stays at 30 s of
 * silence (see NETWORK_FAILURE_WINDOW_MS below).
 *
 * [UPDATED v2 — B3]
 */
const HEARTBEAT_INTERVAL_MS = 60_000;

/**
 * If we have not heard back from the server (heartbeat OR any drain success)
 * for this long AND the timer fires, the runtime falls back to a local
 * NETWORK_FAILURE_FALLBACK auto-submit. PRD-16 US-7 E1.
 *
 * [UPDATED v2 — B2]
 */
const NETWORK_FAILURE_WINDOW_MS = 30_000;

/**
 * RuntimeProvider — the client-side state machine for the active test.
 *
 * Holds:
 *   - per-slot snapshots (mirrored from server)
 *   - the telemetry queue (IndexedDB + drainer)
 *   - the anti-cheat counter + progressive banner state
 *   - the hint reveals (per-slot)
 *   - the timer + heartbeat poll (B3)
 *   - the submit flow (manual / timer / violation-driven / network-fallback)
 *
 * Architecture §8.2 state machine is enforced — the auto-submit latch
 * (`submitState === 'AUTO_SUBMITTING'`) prevents double-fires.
 */
export function RuntimeProvider(
  props: RuntimeProviderProps,
): React.ReactElement {
  const { initialSession } = props;
  const router = useRouter();

  // -------- mobile hard block (design-lock #4) --------
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)');
    const update = (): void => setNarrow(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);
  const [tablet, setTablet] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 1023px)');
    const update = (): void => setTablet(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);

  // -------- session payload, snapshots, current slot --------
  const [session] = useState<SessionPayload>(initialSession);
  const [snapshots, setSnapshots] = useState<Record<number, SnapshotState>>(
    () => {
      const map: Record<number, SnapshotState> = {};
      for (const s of initialSession.snapshots) map[s.slot_index] = s;
      return map;
    },
  );

  const flatSlots = useMemo<SlotPayload[]>(
    () => session.sections.flatMap((sec) => sec.slots),
    [session],
  );
  const slotByIndex = useMemo(() => {
    const m = new Map<number, SlotPayload>();
    for (const s of flatSlots) m.set(s.slot_index, s);
    return m;
  }, [flatSlots]);

  const [currentSlotIndex, setCurrentSlotIndex] = useState<number>(
    flatSlots[0]?.slot_index ?? 0,
  );
  const currentSlot = slotByIndex.get(currentSlotIndex);

  // -------- server-clock skew + timer --------
  // [UPDATED v2 — B3] — `serverClockOffsetRef` is re-anchored by the
  // heartbeat poll below every HEARTBEAT_INTERVAL_MS. Without that, a
  // 3-hour test on a sleeping laptop drifts and the timer fires either
  // late (autosubmit collides with server-cron) or early (premature cut).
  const serverClockOffsetRef = useRef(0);
  useEffect(() => {
    serverClockOffsetRef.current =
      new Date(session.server_now).getTime() - Date.now();
  }, [session.server_now]);
  const expiresAtMs = new Date(session.expires_at).getTime();

  // -------- telemetry queue --------
  const queueRef = useRef<TelemetryQueue | null>(null);
  const [queueDepth, setQueueDepth] = useState(0);
  const [syncError, setSyncError] = useState<string | null>(null);

  // [UPDATED v2 — B2] — connection health bookkeeping. Both refs are
  // touched by the queue callbacks AND by the heartbeat effect; the timer
  // expiry handler reads them to decide NETWORK_FAILURE_FALLBACK.
  const consecutiveSyncFailuresRef = useRef(0);
  const lastSuccessfulHeartbeatRef = useRef<number>(Date.now());
  // Mirror for the UI banner — only set when health degrades.
  const [networkDegraded, setNetworkDegraded] = useState(false);

  // [UPDATED v3 — NEW-1] — auth-error state machine. Distinct from
  // networkDegraded: this is set when the server explicitly rejects the
  // session cookie (HTTP 401), so the right next action is a re-auth, not
  // a NETWORK_FAILURE_FALLBACK autosubmit. When set:
  //   • the timer-expiry handler short-circuits (no autosubmit on T=0)
  //   • the telemetry queue is dormant (it stopped itself on the 401)
  //   • a blocking AuthErrorBanner offers the "Sign in" CTA
  // The ref mirror lets non-React callbacks (heartbeat tick) check the
  // current value without re-creating the effect on state change.
  const [authError, setAuthError] = useState<'expired_session' | null>(null);
  const authErrorRef = useRef<'expired_session' | null>(null);

  // -------- anti-cheat counter + banner --------
  const [violationsCount, setViolationsCount] = useState(
    session.violations_count ?? 0,
  );
  const [lastViolation, setLastViolation] = useState<ViolationType | null>(
    null,
  );
  const [violationBumpAt, setViolationBumpAt] = useState<number | null>(null);

  // -------- submit state machine --------
  const [submitState, setSubmitState] = useState<SubmitState>('IDLE');
  const [submitOpen, setSubmitOpen] = useState(false);
  const [submitDraining, setSubmitDraining] = useState(false);
  // [UPDATED v2 — B2] — when true, the post-submit banner says "submitted
  // locally; will sync when you reconnect" instead of routing to results.
  const [localFallbackPosted, setLocalFallbackPosted] = useState(false);

  // -------- hint reveals (per slot) --------
  const [revealedHints, setRevealedHints] = useState<
    Record<number, { level: number; text: string }[]>
  >({});
  const [hintPending, setHintPending] = useState(false);
  const [hintError, setHintError] = useState<string | null>(null);
  const [hintCardOpen, setHintCardOpen] = useState(false);

  // -------- visit-tracking per slot --------
  // [UPDATED v2 — M11] — visit_count semantics aligned with backend:
  //   • mount: first slot is NOT auto-counted as a visit. It increments on
  //     first user interaction or first PATCH (whichever lands first).
  //   • subsequent jumps to a new slot ARE counted on arrival (matches
  //     v1 behavior for non-first slots).
  // This avoids the v1 off-by-one where the very first PATCH for slot 0
  // would arrive with visit_count: 2 (one increment at mount + one at the
  // PATCH itself via `Math.max(1, …)`).
  const visitStartRef = useRef<number>(0);
  const visitedSetRef = useRef<Set<number>>(new Set()); // empty at mount per M11
  useEffect(() => {
    visitStartRef.current = Date.now();
  }, []);

  // -------- ref bridge to the late-declared submit fns --------
  // autoSubmit is declared lower in this component (depends on helpers that
  // need to be declared in dependency order for the React Compiler). The
  // anti-cheat install effect needs to call it, so we bridge via a ref the
  // current-render assigns into.
  const autoSubmitRef = useRef<((s: AutoSubmitSource) => Promise<void>) | null>(
    null,
  );

  // [UPDATED v3 — NEW-1] — central auth-failure transition. Idempotent: if
  // we're already in the auth-error state, subsequent calls are no-ops.
  // Clears connection-health degradation (it's not a network problem) and
  // suppresses the network-fallback path so the timer-expiry handler won't
  // autosubmit while the cookie is the real problem.
  const handleAuthFailure = (): void => {
    if (authErrorRef.current) return;
    authErrorRef.current = 'expired_session';
    setAuthError('expired_session');
    setNetworkDegraded(false);
    // Cleanest signal to handleTimerExpiry: silence is recent because the
    // server isn't unreachable — it's just rejecting us.
    lastSuccessfulHeartbeatRef.current = Date.now();
    consecutiveSyncFailuresRef.current = 0;
  };

  // -------- queue init + anti-cheat handlers --------
  useEffect(() => {
    const q = new TelemetryQueue(session.session_id, {
      onQueueChange: setQueueDepth,
      onSyncError: (slot, e) => {
        setSyncError(
          slot !== null
            ? `Could not save answer for Q${slot + 1}: ${e.message}`
            : `Sync error: ${e.message}`,
        );
      },
      // [UPDATED v2 — B2] — drainer ping-pong wires the connection-health
      // counters used by the timer-expiry fallback path.
      onSyncFailure: ({ attempts }) => {
        consecutiveSyncFailuresRef.current = attempts;
        if (attempts >= 3) setNetworkDegraded(true);
      },
      onSyncSuccess: () => {
        consecutiveSyncFailuresRef.current = 0;
        lastSuccessfulHeartbeatRef.current = Date.now();
        setNetworkDegraded(false);
      },
      // [UPDATED v3 — NEW-1] — server rejected the cookie. The queue has
      // stopped itself; pending items stay on disk; we route the user to
      // re-auth. NEVER count this as a network failure.
      onSyncAuthError: () => {
        handleAuthFailure();
      },
      onViolationAck: ({ violations_count, will_auto_submit }) => {
        setViolationsCount(violations_count);
        if (will_auto_submit) {
          void autoSubmitRef.current?.('VIOLATION_THRESHOLD');
        }
      },
    });
    queueRef.current = q;
    void q.hydrate();

    const dispose = installAntiCheat({
      onViolation: (type, wasActive) => {
        void q.enqueueViolation(type, wasActive);
        setLastViolation(type);
        setViolationsCount((c) => {
          const next = c + 1;
          if (next >= 3) {
            void autoSubmitRef.current?.('VIOLATION_THRESHOLD');
          }
          return next;
        });
        setViolationBumpAt(Date.now());
      },
      numericInputSelector: '.numeric-input',
    });

    return () => {
      dispose();
    };
  }, [session.session_id]);

  // -------- heartbeat poll (B3) --------
  // [UPDATED v2 — B3]
  // Every HEARTBEAT_INTERVAL_MS we re-fetch `GET /api/test-sessions/:id`
  // and re-anchor `serverClockOffsetRef` from `server_now`. We also bump
  // `lastSuccessfulHeartbeatRef` on success and the failure counter on
  // failure. Paused when `document.hidden` to avoid background-tab spam
  // (the next focus event re-runs the effect cleanly).
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;

    const tick = async (): Promise<void> => {
      if (cancelled) return;
      if (typeof document !== 'undefined' && document.hidden) return;
      // [UPDATED v3 — NEW-1] — once we're in auth-error state, the cookie
      // is the problem. Polling again would just generate more 401s and
      // confuse network-health bookkeeping. Stop until resume.
      if (authErrorRef.current) return;
      try {
        const res = await fetch(
          `/api/test-sessions/${encodeURIComponent(session.session_id)}`,
          { credentials: 'same-origin', cache: 'no-store' },
        );
        // [UPDATED v3 — NEW-1] — 401 is auth, not network. Take the
        // auth-failure transition INSTEAD of bumping the failure counter.
        // lastSuccessfulHeartbeatRef stays at its current value (untouched
        // here) and consecutiveSyncFailuresRef does not increment, so the
        // timer-expiry handler won't pick NETWORK_FAILURE_FALLBACK.
        if (res.status === 401) {
          if (!cancelled) handleAuthFailure();
          return;
        }
        if (!res.ok) throw new Error(`heartbeat ${res.status}`);
        const body = (await res.json()) as { server_now?: string };
        if (body.server_now) {
          serverClockOffsetRef.current =
            new Date(body.server_now).getTime() - Date.now();
        }
        lastSuccessfulHeartbeatRef.current = Date.now();
        consecutiveSyncFailuresRef.current = 0;
        if (!cancelled) setNetworkDegraded(false);
      } catch {
        consecutiveSyncFailuresRef.current += 1;
        if (consecutiveSyncFailuresRef.current >= 3 && !cancelled) {
          setNetworkDegraded(true);
        }
      }
    };

    // Run one immediately so a degraded network is detected before the
    // first 60 s window elapses.
    void tick();
    timer = setInterval(() => {
      void tick();
    }, HEARTBEAT_INTERVAL_MS);

    const onVisibility = (): void => {
      if (!document.hidden) void tick();
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [session.session_id]);

  // ---------- helpers (declared before callers so the React Compiler is happy) ----------

  const computeTimeDelta = (): number => {
    const now = Date.now();
    const deltaSec = Math.max(
      0,
      Math.min(60, Math.floor((now - visitStartRef.current) / 1000)),
    );
    visitStartRef.current = now;
    return deltaSec;
  };

  const jumpTo = (slotIndex: number): void => {
    // Bump visit_count of new slot on first visit
    if (!visitedSetRef.current.has(slotIndex)) {
      visitedSetRef.current.add(slotIndex);
      setSnapshots((s) => {
        const prev =
          s[slotIndex] ??
          ({
            slot_index: slotIndex,
            answer_payload: null,
            marked_for_review: false,
            time_seconds: 0,
            visit_count: 0,
            hints_used: 0,
            action_seq: 0,
            last_action_at: null,
            pending_sync: false,
          } as SnapshotState);
        return {
          ...s,
          [slotIndex]: { ...prev, visit_count: prev.visit_count + 1 },
        };
      });
    } else {
      setSnapshots((s) => {
        const prev = s[slotIndex];
        if (!prev) return s;
        return {
          ...s,
          [slotIndex]: { ...prev, visit_count: prev.visit_count + 1 },
        };
      });
    }
    visitStartRef.current = Date.now();
    setCurrentSlotIndex(slotIndex);
    setHintCardOpen(false);
    setHintError(null);
  };

  const advance = (): void => {
    const idx = flatSlots.findIndex((s) => s.slot_index === currentSlotIndex);
    if (idx < flatSlots.length - 1) {
      jumpTo(flatSlots[idx + 1].slot_index);
    }
  };

  const saveSnapshot = async (
    slotIndex: number,
    mutator: (prev: SnapshotState) => SnapshotState,
    opts: { advance?: boolean } = {},
  ): Promise<void> => {
    if (!queueRef.current) return;
    const prev =
      snapshots[slotIndex] ??
      ({
        slot_index: slotIndex,
        answer_payload: null,
        marked_for_review: false,
        time_seconds: 0,
        visit_count: 0,
        hints_used: 0,
        action_seq: 0,
        last_action_at: null,
        pending_sync: false,
      } as SnapshotState);

    // [UPDATED v2 — M11] — first user interaction on the current slot is
    // the moment the slot becomes "visited". This converges with the
    // backend's expectation (PATCH count == visit_count, modulo replays).
    const isFirstTouch = !visitedSetRef.current.has(slotIndex);
    if (isFirstTouch) {
      visitedSetRef.current.add(slotIndex);
    }
    const nextVisitCount = isFirstTouch
      ? Math.max(1, prev.visit_count + 1)
      : Math.max(1, prev.visit_count);

    const draftAfterMutator = mutator(prev);
    const next: SnapshotState = {
      ...draftAfterMutator,
      visit_count: nextVisitCount,
      pending_sync: true,
    };
    setSnapshots((s) => ({ ...s, [slotIndex]: next }));

    const delta = computeTimeDelta();
    const action_seq = await queueRef.current.enqueueSnapshot(slotIndex, {
      answer_payload: next.answer_payload,
      marked_for_review: next.marked_for_review,
      time_seconds_delta: delta,
      visit_count: nextVisitCount,
      hints_used: next.hints_used,
    });
    setSnapshots((s) => ({
      ...s,
      [slotIndex]: { ...next, action_seq, pending_sync: false },
    }));

    if (opts.advance) {
      advance();
    }
  };

  // ---------- action handlers ----------

  const onAnswerChange = (next: AnswerPayload): void => {
    void saveSnapshot(currentSlotIndex, (prev) => ({
      ...prev,
      answer_payload: next,
    }));
  };

  const onClear = (): void => {
    if (!currentSlot) return;
    void saveSnapshot(currentSlotIndex, (prev) => ({
      ...prev,
      answer_payload: emptyPayloadFor(currentSlot.answer_type),
    }));
  };

  const onSaveAndNext = (): void => {
    void saveSnapshot(currentSlotIndex, (prev) => prev, { advance: true });
  };

  const onMarkAndNext = (): void => {
    void saveSnapshot(
      currentSlotIndex,
      (prev) => ({ ...prev, marked_for_review: true }),
      { advance: true },
    );
  };

  // [UPDATED v2 — M8] — single-click toggle: mark ↔ unmark on the current
  // slot, no advance. The Palette + the action row both call this.
  const onToggleMarkForReview = (): void => {
    void saveSnapshot(currentSlotIndex, (prev) => ({
      ...prev,
      marked_for_review: !prev.marked_for_review,
    }));
  };

  // ---------- hints ----------

  const revealHint = async (): Promise<void> => {
    if (!currentSlot) return;
    const current = revealedHints[currentSlotIndex] ?? [];
    const nextLevel = current.length + 1;
    if (nextLevel > currentSlot.hint_count) return;
    setHintPending(true);
    setHintError(null);
    try {
      const res = await fetch(
        `/api/test-sessions/${encodeURIComponent(session.session_id)}/questions/${currentSlotIndex}/hints/${nextLevel}`,
        { credentials: 'same-origin' },
      );
      if (!res.ok) {
        if (res.status === 404)
          setHintError("This hint isn't available — please report to your teacher.");
        else
          setHintError(
            "Couldn't fetch hint — try again when you're back online.",
          );
        return;
      }
      const body = (await res.json()) as { level: number; text: string };
      setRevealedHints((m) => ({
        ...m,
        [currentSlotIndex]: [...current, { level: body.level, text: body.text }],
      }));
      setHintCardOpen(true);
      // bump local hints_used so the snapshot row carries it at submit
      setSnapshots((s) => {
        const prev = s[currentSlotIndex];
        if (!prev) return s;
        return {
          ...s,
          [currentSlotIndex]: { ...prev, hints_used: nextLevel },
        };
      });
    } catch {
      setHintError(
        "Couldn't fetch hint — try again when you're back online.",
      );
    } finally {
      setHintPending(false);
    }
  };

  // ---------- submit ----------

  const autoSubmit = async (source: AutoSubmitSource): Promise<void> => {
    // One-way latch — design-lock + arch §8.2.
    if (submitState === 'AUTO_SUBMITTING' || submitState === 'SUBMITTED') {
      return;
    }
    // [UPDATED v3 — NEW-1] — never autosubmit while the session cookie is
    // rejected. Belt-and-braces with handleTimerExpiry's short-circuit:
    // even if a stale callback (e.g. queued violation ack) tries to fire
    // VIOLATION_THRESHOLD, the submit POST would 401 and we'd risk
    // localFallbackPosted=true (silent data loss).
    if (authErrorRef.current) {
      return;
    }
    setSubmitState('AUTO_SUBMITTING');
    setSubmitOpen(true);
    setSubmitDraining(true);
    await queueRef.current?.drainAndWait(10_000);
    try {
      const res = await fetch(
        `/api/test-sessions/${encodeURIComponent(session.session_id)}/submit`,
        {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            auto_submit: true,
            auto_submit_source: source,
            client_final_state_hash: 'auto',
          }),
        },
      );
      // [UPDATED v3 — NEW-1] — if the submit POST itself returns 401,
      // route to re-auth INSTEAD of falling through to the localFallback
      // branch. NETWORK_FAILURE_FALLBACK semantics are for connectivity,
      // not credentials.
      if (res.status === 401) {
        handleAuthFailure();
        setSubmitState('IDLE');
        setSubmitOpen(false);
        return;
      }
      if (!res.ok && res.status !== 409) {
        // [UPDATED v2 — B2] — if the submit itself fails and we already
        // KNOW the network has been degraded for ≥ N seconds, we degrade
        // gracefully into the "local fallback" path: enqueue a final
        // synthetic snapshot batch (the queue will replay on reconnect)
        // and tell the student their submission is staged. The server-
        // side cron will reconcile this session on next reachability.
        if (source === 'NETWORK_FAILURE_FALLBACK') {
          setLocalFallbackPosted(true);
          setSubmitState('SUBMITTED');
          return;
        }
        setSyncError(`Submit failed (status ${res.status}). Retrying…`);
        return;
      }
      setSubmitState('SUBMITTED');
      await queueRef.current?.clear();
      router.push(`/test/${session.session_id}/results`);
    } catch (e) {
      // [UPDATED v3 — NEW-1] — typed auth error from a fetch helper takes
      // priority over the network-fallback path.
      if (SessionAuthError.is(e)) {
        handleAuthFailure();
        setSubmitState('IDLE');
        setSubmitOpen(false);
        return;
      }
      // [UPDATED v2 — B2] — same graceful-degrade path for thrown errors
      // when the trigger source was already the fallback.
      if (source === 'NETWORK_FAILURE_FALLBACK') {
        setLocalFallbackPosted(true);
        setSubmitState('SUBMITTED');
        return;
      }
      setSyncError(
        `Network error during submit. Will retry: ${(e as Error).message}`,
      );
    } finally {
      setSubmitDraining(false);
    }
  };

  const manualSubmit = async (): Promise<void> => {
    if (submitState === 'AUTO_SUBMITTING' || submitState === 'SUBMITTED') {
      return;
    }
    setSubmitState('AUTO_SUBMITTING');
    setSubmitDraining(true);
    await queueRef.current?.drainAndWait(30_000);
    try {
      const res = await fetch(
        `/api/test-sessions/${encodeURIComponent(session.session_id)}/submit`,
        {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            auto_submit: false,
            auto_submit_source: 'MANUAL',
            client_final_state_hash: 'manual',
          }),
        },
      );
      // [UPDATED v3 — NEW-1] — same 401 routing as autoSubmit. Manual
      // submit never falls through to localFallbackPosted, but we still
      // need to surface the re-auth UX rather than a generic "Submit
      // failed (status 401)" toast that gives the user no recovery path.
      if (res.status === 401) {
        handleAuthFailure();
        setSubmitState('IDLE');
        return;
      }
      if (!res.ok) {
        setSyncError(`Submit failed (status ${res.status}).`);
        setSubmitState('IDLE');
        return;
      }
      setSubmitState('SUBMITTED');
      await queueRef.current?.clear();
      router.push(`/test/${session.session_id}/results`);
    } catch (e) {
      // [UPDATED v3 — NEW-1] — typed auth error path.
      if (SessionAuthError.is(e)) {
        handleAuthFailure();
        setSubmitState('IDLE');
        return;
      }
      setSyncError(`Network error during submit: ${(e as Error).message}`);
      setSubmitState('IDLE');
    } finally {
      setSubmitDraining(false);
    }
  };

  // Bridge: make the current-render autoSubmit available to the anti-cheat
  // effect that was set up at mount. Assigning inside an effect (rather than
  // during render) keeps render side-effect-free per React strict rules.
  useEffect(() => {
    autoSubmitRef.current = autoSubmit;
  });

  // [UPDATED v2 — B2] — timer-expiry handler now branches on connection
  // health. If we've heard nothing from the server for ≥
  // NETWORK_FAILURE_WINDOW_MS, we fire NETWORK_FAILURE_FALLBACK; otherwise
  // the normal TIMER_EXPIRY path.
  //
  // [UPDATED v3 — NEW-1] — auth-error trumps both: if the cookie has been
  // rejected we MUST NOT autosubmit. NETWORK_FAILURE_FALLBACK on a 401
  // would set `localFallbackPosted=true` (silent data loss); plain
  // TIMER_EXPIRY would also hit 401 on the submit POST. Instead, do
  // nothing — the AuthErrorBanner is already telling the student to sign
  // back in. The timer keeps counting visually but won't fire autosubmit.
  const handleTimerExpiry = (): void => {
    if (authErrorRef.current) {
      return;
    }
    const silenceMs = Date.now() - lastSuccessfulHeartbeatRef.current;
    const networkDown =
      silenceMs > NETWORK_FAILURE_WINDOW_MS ||
      consecutiveSyncFailuresRef.current >= 3;
    void autoSubmit(networkDown ? 'NETWORK_FAILURE_FALLBACK' : 'TIMER_EXPIRY');
  };

  // ---------- counts for the submit modal + section strip ----------

  const counts = useMemo(() => {
    let answered = 0,
      marked = 0,
      marked_and_answered = 0,
      visited_not_answered = 0,
      not_visited = 0;
    for (const slot of flatSlots) {
      const snap = snapshots[slot.slot_index];
      const isCurrent = slot.slot_index === currentSlotIndex;
      const status = statusFor(snap, isCurrent);
      switch (status) {
        case 'ANSWERED':
          answered++;
          break;
        case 'ANSWERED_AND_MARKED':
          marked_and_answered++;
          break;
        case 'MARKED_FOR_REVIEW':
          marked++;
          break;
        case 'VISITED_NOT_ANSWERED':
          visited_not_answered++;
          break;
        case 'NOT_VISITED':
          not_visited++;
          break;
      }
    }
    return {
      answered,
      marked,
      marked_and_answered,
      visited_not_answered,
      not_visited,
      total: flatSlots.length,
    };
  }, [snapshots, flatSlots, currentSlotIndex]);

  const paletteSlots = useMemo(() => {
    return flatSlots.map((slot, pos) => {
      const snap = snapshots[slot.slot_index];
      return {
        slotPosition: pos + 1,
        slotIndex: slot.slot_index,
        status: statusFor(snap, slot.slot_index === currentSlotIndex),
        pendingSync: Boolean(snap?.pending_sync),
      };
    });
  }, [flatSlots, snapshots, currentSlotIndex]);

  const slotPosition =
    flatSlots.findIndex((s) => s.slot_index === currentSlotIndex) + 1;

  // -------- early returns --------

  if (narrow) return <MobileBlock />;
  if (!currentSlot) {
    return (
      <main className="p-8" role="alert">
        This test has no questions. Please contact your teacher.
      </main>
    );
  }

  // [UPDATED v3 — NEW-1] — also lock inputs while auth-error is shown;
  // any answer changes during this window would just enqueue items into a
  // dormant queue. We let them resume after sign-in (queue durably holds
  // pre-401 state on disk for resume()), but disallow new writes from a
  // student who hasn't yet sat back down at the auth modal.
  const inputsDisabled =
    submitState === 'AUTO_SUBMITTING' ||
    submitState === 'SUBMITTED' ||
    authError === 'expired_session';
  const currentSnap = snapshots[currentSlotIndex];
  const currentMarked = Boolean(currentSnap?.marked_for_review);
  const currentRevealed = revealedHints[currentSlotIndex] ?? [];

  // -------- render --------

  return (
    <div
      className="min-h-screen flex flex-col bg-surface-1"
      data-palette={
        session.target_exam === 'JEE_ADVANCED' ||
        session.target_exam === 'JEE_MAIN'
          ? 'exam_muscle_memory'
          : 'calm'
      }
    >
      <ViolationBanner
        violationsCount={violationsCount}
        lastType={lastViolation}
        triggeredAt={violationBumpAt}
      />

      {/* [UPDATED v3 — NEW-1] — auth-error blocking card. Renders on top of
         the runtime; the user's only sensible next action is to re-auth. */}
      {authError === 'expired_session' && (
        <AuthErrorBanner
          onSignIn={() => {
            const returnTo = `/test/${session.session_id}`;
            router.push(
              `/login?return_to=${encodeURIComponent(returnTo)}`,
            );
          }}
        />
      )}

      {/* top bar */}
      <header className="h-16 flex items-center justify-between gap-4 px-6 border-b border-border-subtle bg-surface-0">
        <div className="flex items-center gap-3 min-w-0">
          <h1 className="text-lg font-semibold truncate">
            {session.test_title}
          </h1>
        </div>
        <div className="flex items-center gap-4">
          {violationsCount > 0 && (
            <span
              className="px-2 py-1 text-xs rounded-md bg-amber-50 text-amber-800 border border-amber-200"
              aria-label={`${violationsCount} violations of 3`}
            >
              Violations: {violationsCount}/3
            </span>
          )}
          {queueDepth > 0 && (
            <span
              className="px-2 py-1 text-xs rounded-md bg-surface-2 text-text-secondary"
              aria-label={`${queueDepth} pending sync`}
            >
              Sync: {queueDepth}
            </span>
          )}
          {/* [UPDATED v2 — B2] connectivity indicator */}
          {networkDegraded && (
            <span
              className="px-2 py-1 text-xs rounded-md bg-amber-50 text-amber-800 border border-amber-200"
              role="status"
              aria-label="Network connection unreliable"
            >
              Offline — answers saved locally
            </span>
          )}
          <Timer
            expiresAtMs={expiresAtMs}
            serverClockOffsetMs={serverClockOffsetRef.current}
            onExpiry={handleTimerExpiry}
          />
          <button
            type="button"
            onClick={() => setSubmitOpen(true)}
            disabled={inputsDisabled}
            className="px-4 h-9 rounded-lg bg-[var(--accent)] text-[var(--accent-on)] hover:bg-[var(--accent-strong)] disabled:opacity-50"
          >
            Submit Test
          </button>
        </div>
      </header>

      {syncError && (
        <div
          role="alert"
          className="px-6 py-2 bg-red-50 text-red-800 text-sm border-b border-red-200"
        >
          {syncError}
        </div>
      )}

      {/* [UPDATED v2 — B2] local-fallback banner */}
      {localFallbackPosted && (
        <div
          role="alert"
          className="px-6 py-3 bg-amber-50 text-amber-900 text-sm border-b border-amber-200"
        >
          Submitted locally; will sync when you reconnect.
        </div>
      )}

      {/* main two-pane layout */}
      <div className="flex-1 grid grid-cols-[1fr_280px] gap-0">
        <section className="relative p-6 overflow-y-auto">
          <QuestionPane
            slot={currentSlot}
            slotPosition={slotPosition}
            totalSlots={flatSlots.length}
            hintsUsed={currentRevealed.length}
            sessionId={session.session_id}
          />

          {hintCardOpen && (
            <HintCard
              revealed={currentRevealed}
              hintCount={currentSlot.hint_count}
              pending={hintPending}
              error={hintError}
              onReveal={() => void revealHint()}
              onDismiss={() => setHintCardOpen(false)}
              layout={tablet ? 'push-down' : 'overlay'}
            />
          )}

          <div className="mt-6 max-w-2xl">
            <AnswerEntry
              answerType={currentSlot.answer_type}
              spec={currentSlot.answer_spec}
              value={currentSnap?.answer_payload ?? null}
              options={currentSlot.options}
              list_i={currentSlot.list_i}
              list_ii={currentSlot.list_ii}
              onChange={onAnswerChange}
              onClear={onClear}
              disabled={inputsDisabled}
            />
          </div>

          <div className="mt-6 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={onSaveAndNext}
              disabled={inputsDisabled}
              className="px-4 h-9 rounded-lg bg-[var(--accent)] text-[var(--accent-on)] hover:bg-[var(--accent-strong)] disabled:opacity-50"
            >
              Save &amp; Next
            </button>
            <button
              type="button"
              onClick={onMarkAndNext}
              disabled={inputsDisabled}
              className="px-4 h-9 rounded-lg border border-border-subtle text-text-primary hover:bg-surface-2 disabled:opacity-50"
            >
              Save &amp; Mark for Review &amp; Next
            </button>
            {/* [UPDATED v2 — M8] single-click toggle — replaces the v1
               two-button unmark flow. The label flips so the affordance
               is obvious. */}
            <button
              type="button"
              onClick={onToggleMarkForReview}
              disabled={inputsDisabled}
              aria-pressed={currentMarked}
              className="px-4 h-9 rounded-lg border border-border-subtle text-text-primary hover:bg-surface-2 disabled:opacity-50"
            >
              {currentMarked ? 'Unmark Review' : 'Mark for Review'}
            </button>
            <button
              type="button"
              onClick={onClear}
              disabled={inputsDisabled}
              className="px-4 h-9 rounded-lg text-[var(--accent)] hover:underline disabled:opacity-50"
            >
              Clear Response
            </button>
            {currentSlot.hint_count > 0 && !hintCardOpen && (
              <button
                type="button"
                onClick={() => {
                  setHintCardOpen(true);
                  if (currentRevealed.length === 0) void revealHint();
                }}
                disabled={inputsDisabled}
                className="px-4 h-9 rounded-lg text-sm text-text-secondary underline hover:text-text-primary disabled:opacity-50"
              >
                Show hint ({currentRevealed.length} / {currentSlot.hint_count}{' '}
                used)
              </button>
            )}
          </div>

          <p className="mt-4 text-sm text-text-secondary">
            Answered: {counts.answered} · Marked &amp; Answered:{' '}
            {counts.marked_and_answered} · Marked: {counts.marked} · Visited not
            answered: {counts.visited_not_answered} · Not visited:{' '}
            {counts.not_visited}
          </p>
        </section>

        <aside className="border-l border-border-subtle bg-surface-0 p-4 overflow-y-auto">
          {/* [UPDATED v2 — M8] palette accepts the per-slot unmark
             callback so right-clicking a marked dot toggles it. */}
          <Palette
            slots={paletteSlots}
            currentSlotIndex={currentSlotIndex}
            onJump={jumpTo}
            onToggleMark={(slotIndex) => {
              setCurrentSlotIndex(slotIndex);
              void saveSnapshot(slotIndex, (prev) => ({
                ...prev,
                marked_for_review: !prev.marked_for_review,
              }));
            }}
          />
        </aside>
      </div>

      <SubmitConfirm
        open={submitOpen}
        counts={counts}
        timeRemainingLabel={formatRemaining(
          expiresAtMs,
          serverClockOffsetRef.current,
        )}
        draining={submitDraining}
        drainingPending={queueDepth}
        onCancel={() => setSubmitOpen(false)}
        onConfirm={() => void manualSubmit()}
      />
    </div>
  );
}

function formatRemaining(
  expiresAtMs: number,
  serverClockOffsetMs: number,
): string {
  const s = Math.max(
    0,
    Math.floor((expiresAtMs - (Date.now() + serverClockOffsetMs)) / 1000),
  );
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}
