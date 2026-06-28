/**
 * NUM-INT / NUM-DEC keystroke + paste filter.
 *
 * PRD US-3 (Blocker 1 fix): the keypad and keydown handler REFUSE any keystroke
 * that would extend the value past `precision` decimal places. Paste is
 * truncated at `precision` and logged.
 *
 * This module is pure (no DOM) so the unit tests can hammer it directly.
 */

import { roundHalfToEven } from './numeric';

export interface KeyAttemptResult {
  /** the new value to commit (may equal current — a rejected keystroke is a no-op) */
  value: string;
  /** true if the keystroke was rejected (UI should flash the ghost-hint) */
  rejected: boolean;
}

const DIGIT_RE = /^[0-9]$/;

function decimalCount(value: string): number {
  const dot = value.indexOf('.');
  if (dot === -1) return 0;
  return value.length - dot - 1;
}

function hasDecimal(value: string): boolean {
  return value.includes('.');
}

function hasMinus(value: string): boolean {
  return value.startsWith('-');
}

function withinIntRange(value: string, min: number, max: number): boolean {
  if (value === '' || value === '-' || value === '.') return true;
  const n = Number(value);
  if (Number.isNaN(n)) return false;
  return n >= min && n <= max;
}

export interface NumericInputConfig {
  /** 'NUM-INT' or 'NUM-DEC' */
  kind: 'NUM-INT' | 'NUM-DEC';
  /** decimal places allowed (0 for NUM-INT) */
  precision: number;
  /** inclusive min — JEE Advanced default for NUM-INT is -999 */
  min: number;
  /** inclusive max — JEE Advanced default for NUM-INT is 999 */
  max: number;
}

/**
 * Apply one keystroke (digit, '.', '-', 'Backspace', 'Clear').
 * Returns the new value + a `rejected` flag for UI to highlight.
 */
export function applyKey(
  current: string,
  key: string,
  config: NumericInputConfig,
): KeyAttemptResult {
  // Normalise inputs
  if (key === 'Backspace') {
    return { value: current.slice(0, -1), rejected: false };
  }
  if (key === 'Clear' || key === 'Delete') {
    return { value: '', rejected: false };
  }

  if (key === '-') {
    // minus only at position 0, only once
    if (current.length > 0 || hasMinus(current)) {
      return { value: current, rejected: true };
    }
    return { value: '-', rejected: false };
  }

  if (key === '.') {
    if (config.kind === 'NUM-INT' || config.precision === 0) {
      return { value: current, rejected: true };
    }
    if (hasDecimal(current)) return { value: current, rejected: true };
    // allow leading "." only after a digit (avoid "." or "-." being a hanging state)
    if (current === '' || current === '-') {
      // Per JEE Advanced UI: leading dot is rejected; user must type a digit first.
      return { value: current, rejected: true };
    }
    return { value: current + '.', rejected: false };
  }

  if (DIGIT_RE.test(key)) {
    // Precision cap: if we're already at precision decimals, reject
    if (hasDecimal(current) && decimalCount(current) >= config.precision) {
      return { value: current, rejected: true };
    }
    const proposed = current + key;
    // Range check (NUM-INT only; NUM-DEC range is open-ended in the bank)
    if (config.kind === 'NUM-INT') {
      if (!withinIntRange(proposed, config.min, config.max)) {
        return { value: current, rejected: true };
      }
    }
    return { value: proposed, rejected: false };
  }

  // any other key is silently ignored — not a rejection (no UI flash)
  return { value: current, rejected: false };
}

/**
 * Paste handler: strip non-`[0-9.\-]`, truncate fractional part to precision,
 * normalise the leading minus. Returns the cleaned value + `truncated: true`
 * if anything was dropped (UI shows the 2 s ghost hint per PRD).
 */
export function applyPaste(
  pasted: string,
  config: NumericInputConfig,
): { value: string; truncated: boolean } {
  // Strip invalid chars
  const raw = pasted.replace(/[^0-9.\-]/g, '');
  let dropped = raw.length !== pasted.length;

  // Normalise minus (only at position 0)
  const negative = raw.startsWith('-');
  let body = raw.replace(/-/g, '');

  // Keep only the first decimal point
  const firstDot = body.indexOf('.');
  if (firstDot !== -1) {
    body =
      body.slice(0, firstDot + 1) +
      body.slice(firstDot + 1).replace(/\./g, '');
  }

  // Truncate fractional part
  if (config.kind === 'NUM-INT' || config.precision === 0) {
    if (body.includes('.')) {
      body = body.slice(0, body.indexOf('.'));
      dropped = true;
    }
  } else if (body.includes('.')) {
    const [intPart, fracPart] = body.split('.');
    if (fracPart.length > config.precision) {
      body = intPart + '.' + fracPart.slice(0, config.precision);
      dropped = true;
    }
  }

  const value = (negative ? '-' : '') + body;

  // Range clamp for NUM-INT
  if (config.kind === 'NUM-INT' && value !== '' && value !== '-') {
    const n = Number(value);
    if (!Number.isNaN(n) && (n < config.min || n > config.max)) {
      return { value: '', truncated: true };
    }
  }
  return { value, truncated: dropped };
}

/** Final display value — runs the same round-half-to-even the backend will. */
export function canonicaliseForDisplay(
  raw: string | null,
  precision: number,
): string | null {
  if (raw === null || raw === '' || raw === '-' || raw === '.') return null;
  try {
    return roundHalfToEven(raw, precision);
  } catch {
    return null;
  }
}
