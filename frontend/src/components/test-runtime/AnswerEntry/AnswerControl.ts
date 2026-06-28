/**
 * Shared `AnswerControl<T>` interface for the five answer-types (PRD US-3,
 * Vision Update §10 future-proof shape).
 *
 * The runtime mounts exactly one Answer component per question; switching
 * questions unmounts/remounts (cheap — the warm cache holds the statement).
 */

import type { AnswerPayload, AnswerSpec, AnswerType } from '@/lib/runtime-types';

export interface AnswerControlProps<P extends AnswerPayload> {
  answerType: AnswerType;
  spec: AnswerSpec;
  value: P;
  options?: string[];
  list_i?: string[];
  list_ii?: string[];
  onChange: (next: P) => void;
  onClear: () => void;
  disabled: boolean;
}
