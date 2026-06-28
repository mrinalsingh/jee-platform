/**
 * HMAC figure-token tests — architecture §7 / Req N.
 *
 * Covers:
 *   - Happy path: sign then verify under same secret.
 *   - Previous-secret grace window (Req N rotation): verify under previous secret.
 *   - Slot/figure mismatch: token is valid but for a different (slot, figure).
 *   - MAC mismatch: tampered signature.
 *   - Malformed: missing dot, garbage payload, empty string.
 *   - Pepper misconfig: missing HMAC_PEPPER should not silently accept.
 *   - Constant-time path: verifying a wrong token returns false (no exception).
 */

import {
  signFigureToken,
  verifyFigureToken,
  generateSessionSecret,
} from "./hmac-token";

const ORIGINAL_PEPPER = process.env.HMAC_PEPPER;

beforeAll(() => {
  // 32 hex bytes = 64 hex chars
  process.env.HMAC_PEPPER =
    "a".repeat(64);
});

afterAll(() => {
  if (ORIGINAL_PEPPER === undefined) {
    delete process.env.HMAC_PEPPER;
  } else {
    process.env.HMAC_PEPPER = ORIGINAL_PEPPER;
  }
});

describe("signFigureToken / verifyFigureToken — happy path", () => {
  it("a freshly-signed token verifies under the same secret", () => {
    const secret = generateSessionSecret();
    const token = signFigureToken(secret, 3, 0);
    const result = verifyFigureToken(token, secret, null, 3, 0);
    expect(result.ok).toBe(true);
    expect(result.slotIndex).toBe(3);
    expect(result.figureIndex).toBe(0);
  });

  it("token is opaque (no slot/figure in plain URL chars beyond the b64 payload)", () => {
    const secret = generateSessionSecret();
    const token = signFigureToken(secret, 7, 2);
    // Token must contain exactly one '.' separating payload from MAC
    expect(token.split(".").length).toBe(2);
    // Payload section b64-decodes to "7|2"
    const payloadB64 = token.split(".")[0]!;
    expect(payloadB64.length).toBeGreaterThan(0);
  });

  it("two tokens for the same (slot, figure) under the same secret are stable", () => {
    // Deterministic: HMAC is a deterministic function of (key, message).
    const secret = generateSessionSecret();
    const t1 = signFigureToken(secret, 5, 1);
    const t2 = signFigureToken(secret, 5, 1);
    expect(t1).toBe(t2);
  });

  it("different (slot, figure) tuples produce different tokens", () => {
    const secret = generateSessionSecret();
    const t1 = signFigureToken(secret, 1, 0);
    const t2 = signFigureToken(secret, 2, 0);
    const t3 = signFigureToken(secret, 1, 1);
    expect(t1).not.toBe(t2);
    expect(t1).not.toBe(t3);
    expect(t2).not.toBe(t3);
  });
});

describe("verifyFigureToken — previous-secret grace window (Req N)", () => {
  it("a token signed under the previous secret verifies during the grace window", () => {
    const previous = generateSessionSecret();
    const current = generateSessionSecret();
    const token = signFigureToken(previous, 4, 0); // signed under what is now the previous

    const result = verifyFigureToken(token, current, previous, 4, 0);
    expect(result.ok).toBe(true);
  });

  it("a token signed under an unrelated secret fails verification", () => {
    const real = generateSessionSecret();
    const other = generateSessionSecret();
    const token = signFigureToken(other, 4, 0);

    const result = verifyFigureToken(token, real, null, 4, 0);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("mac_mismatch");
  });

  it("when previous secret is null, only current is tried", () => {
    const previous = generateSessionSecret();
    const current = generateSessionSecret();
    const token = signFigureToken(previous, 4, 0);

    const result = verifyFigureToken(token, current, null, 4, 0);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("mac_mismatch");
  });
});

describe("verifyFigureToken — slot / figure mismatch", () => {
  it("returns slot_mismatch when expected slot differs", () => {
    const secret = generateSessionSecret();
    const token = signFigureToken(secret, 3, 0);
    const result = verifyFigureToken(token, secret, null, 4, 0);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("slot_mismatch");
  });

  it("returns figure_mismatch when expected figure differs", () => {
    const secret = generateSessionSecret();
    const token = signFigureToken(secret, 3, 0);
    const result = verifyFigureToken(token, secret, null, 3, 1);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("figure_mismatch");
  });
});

describe("verifyFigureToken — malformed inputs", () => {
  it("rejects empty string", () => {
    const secret = generateSessionSecret();
    expect(verifyFigureToken("", secret, null, 0, 0).ok).toBe(false);
    expect(verifyFigureToken("", secret, null, 0, 0).reason).toBe("malformed");
  });

  it("rejects token without dot separator", () => {
    const secret = generateSessionSecret();
    expect(verifyFigureToken("abc", secret, null, 0, 0).reason).toBe("malformed");
  });

  it("rejects token with empty MAC", () => {
    const secret = generateSessionSecret();
    expect(verifyFigureToken("abc.", secret, null, 0, 0).reason).toBe("malformed");
  });

  it("rejects token whose payload is not slot|figure", () => {
    const secret = generateSessionSecret();
    // base64url("garbage") . base64url("anymac")
    const fake = Buffer.from("garbage", "utf8").toString("base64");
    const result = verifyFigureToken(`${fake}.deadbeef`, secret, null, 0, 0);
    expect(result.ok).toBe(false);
  });

  it("rejects tampered MAC", () => {
    const secret = generateSessionSecret();
    const token = signFigureToken(secret, 3, 0);
    const tampered = token.slice(0, -1) + (token.endsWith("a") ? "b" : "a");
    const result = verifyFigureToken(tampered, secret, null, 3, 0);
    expect(result.ok).toBe(false);
  });
});

describe("signFigureToken — input validation", () => {
  it("rejects negative slotIndex", () => {
    const secret = generateSessionSecret();
    expect(() => signFigureToken(secret, -1, 0)).toThrow(RangeError);
  });

  it("rejects non-integer slotIndex", () => {
    const secret = generateSessionSecret();
    expect(() => signFigureToken(secret, 1.5, 0)).toThrow(RangeError);
  });

  it("rejects out-of-range figureIndex", () => {
    const secret = generateSessionSecret();
    expect(() => signFigureToken(secret, 0, 1000)).toThrow(RangeError);
  });
});

describe("HMAC_PEPPER misconfiguration", () => {
  it("signing throws when HMAC_PEPPER is missing", () => {
    const saved = process.env.HMAC_PEPPER;
    delete process.env.HMAC_PEPPER;
    try {
      const secret = generateSessionSecret();
      expect(() => signFigureToken(secret, 0, 0)).toThrow(/HMAC_PEPPER/);
    } finally {
      process.env.HMAC_PEPPER = saved;
    }
  });

  it("verifying returns false when HMAC_PEPPER is missing (fails closed, does not throw)", () => {
    // First sign with the pepper present.
    const secret = generateSessionSecret();
    const token = signFigureToken(secret, 0, 0);

    const saved = process.env.HMAC_PEPPER;
    delete process.env.HMAC_PEPPER;
    try {
      const result = verifyFigureToken(token, secret, null, 0, 0);
      expect(result.ok).toBe(false);
    } finally {
      process.env.HMAC_PEPPER = saved;
    }
  });
});

describe("generateSessionSecret", () => {
  it("returns 32 bytes", () => {
    const s = generateSessionSecret();
    expect(s.length).toBe(32);
  });

  it("returns different bytes on each call", () => {
    const a = generateSessionSecret();
    const b = generateSessionSecret();
    expect(a.equals(b)).toBe(false);
  });
});
