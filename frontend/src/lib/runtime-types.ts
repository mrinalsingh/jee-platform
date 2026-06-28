/**
 * Shared type contracts between the runtime frontend and the backend session API.
 * Mirrors architecture-final §5.3 + §6.1.
 *
 * The backend may freely add fields; the client treats unknown enum values as
 * hard errors (PRD US-3 AC: "unrecognised answer_type → hard error block").
 */

export type AnswerType =
  | 'MCQ-SC'
  | 'MCQ-MC'
  | 'NUM-INT'
  | 'NUM-DEC'
  | 'MAT-COL';

export type AutoSubmitSource =
  | 'TIMER_EXPIRY'
  | 'VIOLATION_THRESHOLD'
  | 'NETWORK_FAILURE_FALLBACK'
  | 'MANUAL';

export type ViolationType =
  | 'TAB_SWITCH'
  | 'WINDOW_BLUR'
  | 'FULLSCREEN_EXIT'
  | 'RIGHT_CLICK'
  | 'COPY'
  | 'CUT'
  | 'PASTE'
  | 'DEVTOOLS_KEYSTROKE';

export type TargetExam =
  | 'JEE_ADVANCED'
  | 'JEE_MAIN'
  | 'IOQM'
  | 'INMO'
  | 'RMO'
  | 'KVPY'
  | 'COACHING'
  | 'ORIGINAL'
  | 'OTHER';

export interface NumAnswerSpec {
  type: 'NUM-INT' | 'NUM-DEC';
  /** number of decimal places (NUM-DEC); NUM-INT is always 0 */
  precision: number;
  /** inclusive range; defaults to JEE Advanced (-999..999 for NUM-INT) */
  min?: number;
  max?: number;
}

export interface MatColAnswerSpec {
  type: 'MAT-COL';
  list_i_count: number; // typically 4 — but driven by data per PRD US-3
  list_ii_count: number; // typically 5
}

export interface McqAnswerSpec {
  type: 'MCQ-SC' | 'MCQ-MC';
  /**
   * [UPDATED v2 — M9] — was literal `4`. The bank may serve 3/4/5-option MCQs
   * in future MAT-COL / PASSAGE / non-JEE contexts (PRD-16 §10 future-proof).
   * Runtime callers should guard with `isValidOptionCount` before use.
   */
  option_count: number;
}

/**
 * [UPDATED v2 — M9] — runtime guard for the widened `option_count` type.
 * v1 valid range is 3..5; expand here when the design-lock loosens.
 */
export function isValidOptionCount(n: number): boolean {
  return Number.isInteger(n) && n >= 3 && n <= 5;
}

/**
 * [UPDATED v2 — M9] — letter sequence derived from option_count, instead of
 * the v1 hardcoded `['A','B','C','D']`. Up to 8 letters supported for safety;
 * `isValidOptionCount` enforces the design-lock window.
 */
export function lettersForOptionCount(n: number): readonly string[] {
  const ALL = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'] as const;
  const safe = isValidOptionCount(n) ? n : 4;
  return ALL.slice(0, safe);
}

export type AnswerSpec = NumAnswerSpec | MatColAnswerSpec | McqAnswerSpec;

/**
 * One question the server has sliced into the active session. Identity is by
 * slot_index ONLY (Blocker 2) — the client never sees question_code during an
 * active session.
 */
export interface SlotPayload {
  slot_index: number;
  /** KaTeX-friendly markdown — rendered client-side */
  statement: string;
  answer_type: AnswerType;
  answer_spec: AnswerSpec;
  /** signed tokens; client GETs /figures/{token} to fetch bytes */
  figure_signed_tokens: string[];
  /** 0..N — 0 means the Show-hint link is omitted */
  hint_count: number;
  /** zero-indexed options for MCQ-SC / MCQ-MC; LaTeX in entries */
  options?: string[];
  /** for MAT-COL */
  list_i?: string[];
  list_ii?: string[];
}

export interface SectionPayload {
  section_id: number;
  subject: string;
  slots: SlotPayload[];
}

/** Shape of `answer_payload` per answer_type. JSON-serialisable. */
export type AnswerPayload =
  | { type: 'MCQ-SC'; selected_option: number | null }
  | { type: 'MCQ-MC'; selected_options: number[] }
  | { type: 'NUM-INT'; value: string | null }
  | { type: 'NUM-DEC'; value: string | null }
  | { type: 'MAT-COL'; pairs: Record<number, number | null> } // list_i_index -> list_ii_index
  | null;

export interface SnapshotState {
  slot_index: number;
  answer_payload: AnswerPayload;
  marked_for_review: boolean;
  /** server-cumulative seconds on this slot */
  time_seconds: number;
  visit_count: number;
  hints_used: number;
  /** server-validated monotonic per session */
  action_seq: number;
  last_action_at: string | null;
  /** revealed hint text, level-indexed (1..N) — populated as student clicks */
  revealed_hints?: { level: number; text: string }[];
  /** local-only flag — UI repaints palette dot when sync hasn't landed */
  pending_sync?: boolean;
}

export interface MarkingScheme {
  scheme_version: 1;
  per_answer_type: {
    'MCQ-SC': { correct: number; wrong: number; unanswered: number };
    'MCQ-MC': Record<string, number>;
    'NUM-INT': { correct: number; wrong: number; unanswered: number };
    'NUM-DEC': { correct: number; wrong: number; unanswered: number };
    'MAT-COL': Record<string, number>;
  };
  section_overrides?: Record<string, MarkingScheme['per_answer_type']>;
}

export interface SessionPayload {
  session_id: string;
  test_id: number;
  test_title: string;
  /** drives palette-intensity per design-lock #3 */
  target_exam: TargetExam;
  started_at: string;
  expires_at: string;
  submitted_at: string | null;
  duration_seconds: number;
  marking_scheme: MarkingScheme;
  sections: SectionPayload[];
  snapshots: SnapshotState[];
  multi_device_warning: boolean;
  violations_count: number;
  /** server time at the moment this payload was issued — for clock-skew correction */
  server_now: string;
}

export type PerQuestionStatus =
  | 'NOT_VISITED'
  | 'VISITED_NOT_ANSWERED'
  | 'ANSWERED'
  | 'MARKED_FOR_REVIEW'
  | 'ANSWERED_AND_MARKED';

/** Compute palette status from a snapshot + marked flag. */
export function statusFor(
  snap: SnapshotState | undefined,
  isCurrent: boolean,
): PerQuestionStatus {
  if (!snap || (snap.visit_count === 0 && !isCurrent)) return 'NOT_VISITED';
  const answered = isAnswered(snap.answer_payload);
  if (snap.marked_for_review && answered) return 'ANSWERED_AND_MARKED';
  if (snap.marked_for_review) return 'MARKED_FOR_REVIEW';
  if (answered) return 'ANSWERED';
  return 'VISITED_NOT_ANSWERED';
}

export function isAnswered(payload: AnswerPayload): boolean {
  if (!payload) return false;
  switch (payload.type) {
    case 'MCQ-SC':
      return payload.selected_option !== null;
    case 'MCQ-MC':
      return payload.selected_options.length > 0;
    case 'NUM-INT':
    case 'NUM-DEC':
      return payload.value !== null && payload.value !== '';
    case 'MAT-COL':
      return (
        Object.keys(payload.pairs).length > 0 &&
        Object.values(payload.pairs).every((v) => v !== null && v !== undefined)
      );
  }
}

export function emptyPayloadFor(type: AnswerType): AnswerPayload {
  switch (type) {
    case 'MCQ-SC':
      return { type, selected_option: null };
    case 'MCQ-MC':
      return { type, selected_options: [] };
    case 'NUM-INT':
      return { type, value: null };
    case 'NUM-DEC':
      return { type, value: null };
    case 'MAT-COL':
      return { type, pairs: {} };
  }
}
