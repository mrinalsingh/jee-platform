/**
 * `@jee/numeric-normalise` — frontend mirror.
 *
 * Per PRD §0 Glossary + §10.1: the SAME `roundHalfToEven(value, precision)`
 * algorithm runs in three places (importer, backend answer-compare, diagnostic
 * matcher) and must produce byte-equal output. The frontend uses this module
 * for client-side display equivalence ONLY — the server is still the storage
 * authority (PRD US-3 NUM-DEC "Storage normalisation").
 *
 * Implementation: decimal.js with Decimal.ROUND_HALF_EVEN, `Decimal.toFixed`
 * (NOT `Number.prototype.toFixed` — the latter uses banker's rounding
 * inconsistently across JS engines).
 *
 * The 20-row CI fixture lives at `backend/src/lib/numeric.fixture.ts` and is
 * asserted byte-equal across importer + backend compare + this frontend module.
 */

import Decimal from 'decimal.js';

Decimal.set({ rounding: Decimal.ROUND_HALF_EVEN, precision: 50 });

export function roundHalfToEven(
  value: string | number,
  precision: number,
): string {
  if (!Number.isInteger(precision) || precision < 0) {
    throw new RangeError('precision must be a non-negative integer');
  }
  // Decimal.toFixed honours the rounding-mode set above.
  const out = new Decimal(value).toFixed(precision);
  // Collapse the cosmetic negative-zero (e.g. "-0", "-0.00") to its positive
  // form. PRD-16 §10.1 requires byte-equal output across the importer,
  // backend answer-compare, and this frontend mirror; the backend
  // (`backend/src/lib/numeric.ts`) already does this collapse via its own
  // post-processing, so without it a student typing `-0.5` at p=0 would
  // produce `"-0"` here while the server stored `"0"` — answer-equality
  // would then fail on round-trip. Tester report v1 §10 ("numeric -0
  // cross-side parity") flagged this; UX Audit v1 loop-back asks the
  // frontend to converge to the backend.
  if (out === '-' + new Decimal(0).toFixed(precision)) {
    return new Decimal(0).toFixed(precision);
  }
  return out;
}
