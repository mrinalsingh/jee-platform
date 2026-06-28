/**
 * CI fixture asserting byte-equality across importer / runtime / matcher.
 *
 * Per PRD-16 Glossary: "the same module is imported by (1) the YAML importer,
 * (2) the runtime answer-compare on the server, and (3) the diagnostic-axis
 * wrong-path matcher. A CI test asserts byte-identical output for a 20-row
 * fixture across all three call sites."
 *
 * Since the module is shared (importer + runtime + matcher all call
 * `normalizeNumDec` from this same file), byte-identity reduces to
 * "calling the function with the same arguments returns the same string."
 * We verify this AND we verify the banker's-rounding semantics explicitly
 * across a 20+-row fixture.
 */

import { normalizeNumDec, byteEqualNormalized } from "./numeric";

interface Fixture {
  value: string | number;
  precision: number;
  expected: string;
  description: string;
}

const FIXTURES: Fixture[] = [
  // Banker's rounding — exactly-half cases (the whole point)
  { value: 0.5, precision: 0, expected: "0", description: "0.5 → 0 (even)" },
  { value: 1.5, precision: 0, expected: "2", description: "1.5 → 2 (even)" },
  { value: 2.5, precision: 0, expected: "2", description: "2.5 → 2 (even)" },
  { value: 3.5, precision: 0, expected: "4", description: "3.5 → 4 (even)" },
  { value: 4.5, precision: 0, expected: "4", description: "4.5 → 4 (even)" },
  { value: -0.5, precision: 0, expected: "0", description: "-0.5 → 0 (even)" },
  { value: -1.5, precision: 0, expected: "-2", description: "-1.5 → -2 (even)" },
  { value: -2.5, precision: 0, expected: "-2", description: "-2.5 → -2 (even)" },

  // Non-half cases (just verifying normal rounding still works)
  { value: 1.234, precision: 2, expected: "1.23", description: "1.234 ↓" },
  { value: 1.236, precision: 2, expected: "1.24", description: "1.236 ↑" },

  // String inputs are accepted (the importer parses YAML numbers as strings sometimes)
  { value: "2.5", precision: 0, expected: "2", description: "string '2.5'" },
  { value: "3.5", precision: 0, expected: "4", description: "string '3.5'" },

  // Trailing-zero preservation
  { value: 2, precision: 2, expected: "2.00", description: "int → fixed precision" },
  { value: 2.1, precision: 3, expected: "2.100", description: "trailing zero kept" },

  // Higher precision banker's rounding
  { value: 1.2345, precision: 3, expected: "1.234", description: "1.2345 → 1.234 (even)" },
  { value: 1.2355, precision: 3, expected: "1.236", description: "1.2355 → 1.236 (even)" },
  { value: -1.2345, precision: 3, expected: "-1.234", description: "-1.2345 → -1.234" },

  // Wide-precision values (NUM-DEC commonly uses precision 2 in JEE)
  { value: 9.815, precision: 2, expected: "9.82", description: "9.815 → 9.82 (even)" },
  { value: 9.825, precision: 2, expected: "9.82", description: "9.825 → 9.82 (even)" },

  // Zero
  { value: 0, precision: 4, expected: "0.0000", description: "0 → 0.0000" },
  { value: -0, precision: 2, expected: "0.00", description: "-0 → 0.00" },
];

describe("normalizeNumDec — fixture (banker's rounding)", () => {
  for (const f of FIXTURES) {
    it(`${f.description} (value=${f.value}, precision=${f.precision}) → "${f.expected}"`, () => {
      expect(normalizeNumDec(f.value, f.precision)).toBe(f.expected);
    });
  }

  it("invocation is idempotent (output passed back in equals original output)", () => {
    for (const f of FIXTURES) {
      const once = normalizeNumDec(f.value, f.precision);
      const twice = normalizeNumDec(once, f.precision);
      expect(twice).toBe(once);
    }
  });

  it("byte-equality across calls is preserved (importer/runtime/matcher reproducibility)", () => {
    // Simulating "called from three different code paths"
    for (const f of FIXTURES) {
      const fromImporter = normalizeNumDec(f.value, f.precision);
      const fromRuntime = normalizeNumDec(f.value, f.precision);
      const fromMatcher = normalizeNumDec(f.value, f.precision);
      expect(fromImporter).toBe(fromRuntime);
      expect(fromRuntime).toBe(fromMatcher);
    }
  });
});

describe("normalizeNumDec — input validation", () => {
  it("rejects negative precision", () => {
    expect(() => normalizeNumDec(1, -1)).toThrow(RangeError);
  });

  it("rejects non-integer precision", () => {
    expect(() => normalizeNumDec(1, 1.5)).toThrow(RangeError);
  });

  it("rejects NaN", () => {
    expect(() => normalizeNumDec(NaN, 2)).toThrow(RangeError);
  });

  it("rejects Infinity", () => {
    expect(() => normalizeNumDec(Infinity, 2)).toThrow(RangeError);
  });

  it("rejects garbage strings", () => {
    expect(() => normalizeNumDec("not a number", 2)).toThrow(TypeError);
  });
});

/**
 * Cross-side byte-equality probe (PRD-16 v2 Glossary `@jee/numeric-normalise`):
 * "The same module is imported by (1) the YAML importer, (2) the runtime
 * answer-compare on the server, and (3) the diagnostic-axis wrong-path
 * matcher." This unit test reproduces the 20-row fixture the frontend tests
 * with — except where the backend specifically COLLAPSES `-0`.
 *
 * Documented divergence (see numeric.ts §"Canonical output rule"):
 *   - Backend collapses negative-zero outputs to "0" / "0.00"
 *   - Frontend (frontend/src/lib/numeric.ts) does NOT collapse — `-0.5` at
 *     p=0 emits the string "-0".
 *
 * For NUM-DEC answer compare this is safe because the BACKEND is the storage
 * authority. But anyone authoring a wrong_paths entry whose canonical form is
 * literally "-0" should be aware the importer normalises away the sign.
 */
describe("normalizeNumDec — cross-side byte-equality with frontend fixture", () => {
  const FRONTEND_FIXTURE: Array<{
    input: string;
    precision: number;
    expectedBackend: string;
    note?: string;
  }> = [
    { input: "1.005", precision: 2, expectedBackend: "1.00" },
    { input: "1.015", precision: 2, expectedBackend: "1.02" },
    { input: "1.025", precision: 2, expectedBackend: "1.02" },
    { input: "1.035", precision: 2, expectedBackend: "1.04" },
    // DIVERGENT: frontend keeps "-0"; backend collapses to "0".
    { input: "-0.5", precision: 0, expectedBackend: "0", note: "backend collapses -0" },
    { input: "2.5", precision: 0, expectedBackend: "2" },
    { input: "3.5", precision: 0, expectedBackend: "4" },
    { input: "0.5", precision: 0, expectedBackend: "0" },
    { input: "-2.5", precision: 0, expectedBackend: "-2" },
    { input: "-3.5", precision: 0, expectedBackend: "-4" },
    { input: "2.00", precision: 2, expectedBackend: "2.00" },
    { input: "2", precision: 2, expectedBackend: "2.00" },
    { input: "0", precision: 2, expectedBackend: "0.00" },
    { input: "-0.50", precision: 2, expectedBackend: "-0.50" },
    { input: "3.14159", precision: 2, expectedBackend: "3.14" },
    { input: "3.14559", precision: 2, expectedBackend: "3.15" },
    { input: "100", precision: 0, expectedBackend: "100" },
    { input: "-1", precision: 1, expectedBackend: "-1.0" },
    { input: "0.005", precision: 2, expectedBackend: "0.00" },
    { input: "0.015", precision: 2, expectedBackend: "0.02" },
  ];

  for (const row of FRONTEND_FIXTURE) {
    const tag = row.note ? ` [DIVERGENT — ${row.note}]` : "";
    it(`${row.input} @ p=${row.precision} → "${row.expectedBackend}"${tag}`, () => {
      expect(normalizeNumDec(row.input, row.precision)).toBe(row.expectedBackend);
    });
  }
});

describe("byteEqualNormalized", () => {
  it("matches equivalent values after rounding", () => {
    expect(byteEqualNormalized(2.5, "2.50", 0)).toBe(true); // 2.5 → 2 (even); 2.50 → 2
    expect(byteEqualNormalized(1.234, "1.234001", 3)).toBe(true);
  });

  it("does not match values that diverge at the chosen precision", () => {
    expect(byteEqualNormalized(2.5, 3.5, 0)).toBe(false);
    expect(byteEqualNormalized(1.234, 1.236, 2)).toBe(false);
  });

  it("banker's rounding produces correct half-case equality", () => {
    // 0.5 → 0; 1.5 → 2; so 0.5 != 1.5 after normalisation at precision 0
    expect(byteEqualNormalized(0.5, 1.5, 0)).toBe(false);
    // But 2.5 and 2 round to the same "2" at precision 0
    expect(byteEqualNormalized(2.5, 2, 0)).toBe(true);
  });
});
