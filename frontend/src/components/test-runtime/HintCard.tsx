'use client';

import { renderMathString } from '@/lib/katex-render';

export interface HintCardProps {
  /** revealed hints in order (1..N) */
  revealed: { level: number; text: string }[];
  hintCount: number;
  /** false while a fetch is in-flight to avoid double-click */
  pending: boolean;
  /** null in normal flow; surfaced as a toast on offline (PRD US-10 E) */
  error: string | null;
  onReveal: () => void;
  onDismiss: () => void;
  /**
   * Layout mode — overlay on ≥ 1024 px (design-lock #7), push-down on tablet
   * < 1024 px. The parent picks via a media query.
   */
  layout: 'overlay' | 'push-down';
}

export function HintCard(props: HintCardProps): React.ReactElement | null {
  const { revealed, hintCount, pending, error, onReveal, onDismiss, layout } =
    props;
  if (hintCount === 0) return null;
  const remaining = hintCount - revealed.length;

  const baseClasses =
    layout === 'overlay'
      ? 'absolute right-0 top-0 z-20 w-full max-w-md p-4 bg-surface-0/95 backdrop-blur-sm border-l border-border-subtle shadow-lg'
      : 'mt-4 p-4 bg-surface-1 border border-border-subtle rounded-lg';

  return (
    <aside
      className={baseClasses}
      aria-label="Question hints"
      aria-live="polite"
    >
      <header className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-text-secondary">
          Hints
        </h3>
        {revealed.length > 0 && (
          <button
            type="button"
            onClick={onDismiss}
            className="text-xs text-text-secondary underline hover:text-text-primary"
            aria-label="Hide hints"
          >
            Got it, hide hint
          </button>
        )}
      </header>

      {revealed.map((h) => (
        <div
          key={h.level}
          className="mb-3 p-3 rounded-md bg-surface-2 border border-border-subtle"
        >
          <p className="text-xs uppercase tracking-wide text-text-secondary mb-1">
            Hint {h.level}
          </p>
          <div
            className="text-text-primary leading-relaxed"
            dangerouslySetInnerHTML={{ __html: renderMathString(h.text) }}
          />
        </div>
      ))}

      {error && (
        <p className="text-sm text-[var(--danger-fg)] mb-2" role="alert">
          {error}
        </p>
      )}

      {remaining > 0 ? (
        <button
          type="button"
          onClick={onReveal}
          disabled={pending}
          className="text-sm text-[var(--accent)] underline hover:text-[var(--accent-strong)] disabled:opacity-50"
          aria-label={`Reveal hint ${revealed.length + 1} of ${hintCount}`}
        >
          {pending
            ? 'Loading hint…'
            : revealed.length === 0
              ? `Show hint (0 / ${hintCount} used)`
              : `Show next hint (${revealed.length} / ${hintCount} used)`}
        </button>
      ) : (
        <p className="text-sm text-text-secondary">All hints revealed</p>
      )}
    </aside>
  );
}
