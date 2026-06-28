/**
 * Numeric normalisation — shared across importer, runtime answer-compare,
 * diagnostic-axis wrong-path matcher.
 *
 * Binding spec:
 *   - PRD-16 v2 Glossary `@jee/numeric-normalise`
 *   - PRD-01 §6 answer comparison
 *   - Architecture §2 ("decimal.js@10.x in shared workspace package")
 *
 * Why decimal.js: JS `Number.toFixed` is round-half-away-from-zero (NOT banker's
 * rounding). The architecture pins round-half-to-even (banker's) so that
 *   - importer-stored canonical string,
 *   - server runtime answer-compare, and
 *   - diagnostic wrong-path matcher
 * all produce byte-identical strings for the same (value, precision) inputs.
 * The CI test in `numeric.test.ts` asserts this byte equivalence.
 *
 * Canonical output rule: NO trailing-zero strip.
 *   normalizeNumDec("2", 2)   === "2.00"
 *   normalizeNumDec(2.5, 0)   === "2"        // banker's rounds .5 to nearest even → 2
 *   normalizeNumDec(3.5, 0)   === "4"        //                                    → 4
 *   normalizeNumDec(-2.345, 2) === "-2.34"   // banker's: .345 -> .34 (4 is even)
 */

import Decimal from "decimal.js";

// Pin the rounding mode globally for this module's Decimal instances.
// We construct a local namespace clone so we don't mutate global Decimal config
// that other consumers might depend on.
const LocalDecimal = Decimal.clone({ rounding: Decimal.ROUND_HALF_EVEN });

/**
 * Round a value to `precision` decimal places using banker's rounding
 * (round-half-to-even) and return the canonical string with exactly `precision`
 * fractional digits.
 *
 * Throws on:
 *   - NaN / Infinity
 *   - non-finite or unparseable input
 *   - precision < 0 or non-integer precision
 */
export function normalizeNumDec(
  value: string | number,
  precision: number,
): string {
  if (!Number.isInteger(precision) || precision < 0) {
    throw new RangeError(
      `normalizeNumDec: precision must be a non-negative integer, got ${String(
        precision,
      )}`,
    );
  }

  // Guard non-finite numeric inputs before they reach Decimal (which would
  // throw a less-helpful error).
  if (typeof value === "number" && !Number.isFinite(value)) {
    throw new RangeError(
      `normalizeNumDec: value must be finite, got ${String(value)}`,
    );
  }

  let dec: Decimal;
  try {
    dec = new LocalDecimal(value);
  } catch (e) {
    throw new TypeError(
      `normalizeNumDec: cannot parse value ${JSON.stringify(value)} as a decimal`,
    );
  }

  if (!dec.isFinite()) {
    throw new RangeError(`normalizeNumDec: value must be finite, got ${String(value)}`);
  }

  // toFixed on decimal.js respects the rounding mode configured on the clone.
  const out = dec.toFixed(precision);

  // Canonicalise "-0" (and "-0.00...") to "0". decimal.js preserves sign for
  // values that round to zero from the negative side; we collapse them so the
  // byte-equality contract is sign-stable (mathematical zero is one value).
  if (out.startsWith("-")) {
    // The string after '-' is all digits / dot / zeros — quick test.
    const tail = out.slice(1);
    if (/^0+(\.0+)?$/.test(tail)) {
      return tail;
    }
  }
  return out;
}

/**
 * Constant-time-ish byte-equal comparison after normalisation.
 *
 * Used by:
 *  - the runtime answer-compare to decide `attempts.correct`
 *  - the wrong-path matcher to map a student's NUM-DEC answer onto an authored
 *    diagnostic_tag bucket
 *
 * Returns true iff `normalizeNumDec(a, precision) === normalizeNumDec(b, precision)`.
 *
 * Note: this is not a cryptographic equality (no timing-attack surface here —
 * the value space is small ints) but the name documents the contract that both
 * sides go through the SAME normaliser so comparisons are reproducible.
 */
export function byteEqualNormalized(
  answer: string | number,
  candidate: string | number,
  precision: number,
): boolean {
  // If either side throws, propagate — callers want to know about garbage input.
  const a = normalizeNumDec(answer, precision);
  const b = normalizeNumDec(candidate, precision);
  return a === b;
}
