'use client';

import { useEffect, useRef, useState } from 'react';

export interface TimerProps {
  expiresAtMs: number;
  /** ms offset to add to local Date.now() to get server-anchored time */
  serverClockOffsetMs: number;
  onExpiry: () => void;
}

function fmt(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

export function Timer(props: TimerProps): React.ReactElement {
  const { expiresAtMs, serverClockOffsetMs, onExpiry } = props;
  const [remaining, setRemaining] = useState(() =>
    Math.max(
      0,
      Math.floor((expiresAtMs - (Date.now() + serverClockOffsetMs)) / 1000),
    ),
  );
  const firedRef = useRef(false);

  useEffect(() => {
    const id = setInterval(() => {
      const r = Math.max(
        0,
        Math.floor((expiresAtMs - (Date.now() + serverClockOffsetMs)) / 1000),
      );
      setRemaining(r);
      if (r === 0 && !firedRef.current) {
        firedRef.current = true;
        onExpiry();
      }
    }, 500);
    return () => clearInterval(id);
  }, [expiresAtMs, serverClockOffsetMs, onExpiry]);

  const urgent = remaining < 60;
  const warn = remaining < 300;
  // [UX Audit v1 loop-back MED-3] — replace ad-hoc Tailwind palette with
  // design-lock anti-cheat ramp tokens. Urgent uses the violation-3 red
  // (`#dc2626`) defined by design-lock #6 so the colour-source matches.
  const color = urgent
    ? 'text-[var(--violation-3-bg)] animate-pulse'
    : warn
      ? 'text-[var(--warn-fg)]'
      : 'text-[var(--accent)]';

  return (
    <div
      className={`font-mono text-2xl tabular-nums ${color}`}
      role="timer"
      aria-live="off"
      aria-label={`Time remaining ${fmt(remaining)}`}
    >
      {fmt(remaining)}
    </div>
  );
}
