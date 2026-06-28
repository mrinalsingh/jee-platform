import { describe, expect, it } from 'vitest';

import { roundHalfToEven } from './numeric';
import { applyKey, applyPaste } from './numeric-input';

// 20-row fixture per PRD §10.1 — must remain byte-identical across the
// importer, backend answer-compare, and the frontend display layer.
const FIXTURE: Array<{ input: string; precision: number; out: string }> = [
  { input: '1.005', precision: 2, out: '1.00' },
  { input: '1.015', precision: 2, out: '1.02' },
  { input: '1.025', precision: 2, out: '1.02' },
  { input: '1.035', precision: 2, out: '1.04' },
  { input: '-0.5', precision: 0, out: '-0' },
  { input: '2.5', precision: 0, out: '2' },
  { input: '3.5', precision: 0, out: '4' },
  { input: '0.5', precision: 0, out: '0' },
  { input: '-2.5', precision: 0, out: '-2' },
  { input: '-3.5', precision: 0, out: '-4' },
  { input: '2.00', precision: 2, out: '2.00' },
  { input: '2', precision: 2, out: '2.00' },
  { input: '0', precision: 2, out: '0.00' },
  { input: '-0.50', precision: 2, out: '-0.50' },
  { input: '3.14159', precision: 2, out: '3.14' },
  { input: '3.14559', precision: 2, out: '3.15' },
  { input: '100', precision: 0, out: '100' },
  { input: '-1', precision: 1, out: '-1.0' },
  { input: '0.005', precision: 2, out: '0.00' },
  { input: '0.015', precision: 2, out: '0.02' },
];

describe('roundHalfToEven', () => {
  for (const row of FIXTURE) {
    it(`${row.input} @ p=${row.precision} → "${row.out}"`, () => {
      expect(roundHalfToEven(row.input, row.precision)).toBe(row.out);
    });
  }
});

describe('numeric-input keystroke cap', () => {
  const cfg = (precision: number) => ({
    kind: 'NUM-DEC' as const,
    precision,
    min: -1e9,
    max: 1e9,
  });

  it('accepts digits up to precision', () => {
    const r = applyKey('2.8', '3', cfg(2));
    expect(r.value).toBe('2.83');
    expect(r.rejected).toBe(false);
  });

  it('rejects the 3rd decimal when precision is 2', () => {
    const r = applyKey('2.83', '7', cfg(2));
    expect(r.value).toBe('2.83');
    expect(r.rejected).toBe(true);
  });

  it('rejects a second decimal point', () => {
    const r = applyKey('2.83', '.', cfg(2));
    expect(r.value).toBe('2.83');
    expect(r.rejected).toBe(true);
  });

  it('allows minus only at position 0', () => {
    expect(applyKey('', '-', cfg(2)).value).toBe('-');
    expect(applyKey('2', '-', cfg(2)).rejected).toBe(true);
  });

  it('NUM-INT rejects the decimal point entirely', () => {
    const intCfg = {
      kind: 'NUM-INT' as const,
      precision: 0,
      min: -999,
      max: 999,
    };
    expect(applyKey('5', '.', intCfg).rejected).toBe(true);
  });

  it('NUM-INT rejects digits past the range', () => {
    const intCfg = {
      kind: 'NUM-INT' as const,
      precision: 0,
      min: -999,
      max: 999,
    };
    expect(applyKey('999', '9', intCfg).rejected).toBe(true);
  });
});

describe('numeric-input paste cap', () => {
  it('truncates fractional past precision', () => {
    const out = applyPaste('3.14159', {
      kind: 'NUM-DEC',
      precision: 2,
      min: -1e9,
      max: 1e9,
    });
    expect(out.value).toBe('3.14');
    expect(out.truncated).toBe(true);
  });

  it('strips non-numeric characters', () => {
    const out = applyPaste('1.2a3', {
      kind: 'NUM-DEC',
      precision: 2,
      min: -1e9,
      max: 1e9,
    });
    expect(out.value).toBe('1.23');
    expect(out.truncated).toBe(true);
  });

  it('rejects NUM-INT decimal entirely', () => {
    const out = applyPaste('3.14', {
      kind: 'NUM-INT',
      precision: 0,
      min: -999,
      max: 999,
    });
    expect(out.value).toBe('3');
    expect(out.truncated).toBe(true);
  });
});
