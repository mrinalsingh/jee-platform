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
  return new Decimal(value).toFixed(precision);
}
