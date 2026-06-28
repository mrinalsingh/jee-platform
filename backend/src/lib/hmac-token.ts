/**
 * Signed figure-token scheme — architecture §7.
 *
 * Binding contract:
 *   - MAC: HMAC-SHA-256 (Node 22 native `crypto`)
 *   - Key: `test_sessions.session_secret_current` (32 random bytes) XOR-mixed
 *     with the process-level `HMAC_PEPPER` env var (32 hex bytes; §7.3).
 *   - Payload: "{slot_index}|{figure_index}" — both small integers.
 *   - Token format: `base64url(payload) + "." + base64url(HMAC)`.
 *   - Validation: constant-time compare via `crypto.timingSafeEqual`. The
 *     previous secret is tried as a grace-window fallback (§7.2 rotation).
 *
 * Why a custom token instead of JWT: opaque, tiny (no JOSE machinery), no
 * key-rotation footgun, no algorithm-confusion CVE class. Architecture §2
 * explicitly rejected JWT here.
 */

import * as crypto from "crypto";

/** Result of token verification — boolean only, plus the parsed payload on success. */
export interface VerifyResult {
  ok: boolean;
  reason?:
    | "malformed"
    | "mac_mismatch"
    | "slot_mismatch"
    | "figure_mismatch"
    | "grace_expired";
  slotIndex?: number;
  figureIndex?: number;
}

/**
 * Combine the per-session secret with the process-level pepper so a DB-only
 * leak (without env access) can't forge tokens, and an env-only leak (without
 * DB access) can't forge tokens. Both required.
 *
 * The pepper is required — if missing, this is a hard config error in dev too.
 * Architecture §11.1 places HMAC_PEPPER on every backend instance.
 */
function deriveKey(sessionSecret: Buffer): Buffer {
  const pepperHex = process.env.HMAC_PEPPER;
  if (!pepperHex || pepperHex.length === 0) {
    throw new Error(
      "HMAC_PEPPER environment variable is not set; see architecture §7.3 / §11.1. " +
        "Generate with: openssl rand -hex 32",
    );
  }
  let pepper: Buffer;
  try {
    pepper = Buffer.from(pepperHex, "hex");
  } catch (e) {
    throw new Error("HMAC_PEPPER must be valid hex");
  }
  if (pepper.length === 0) {
    throw new Error("HMAC_PEPPER must be non-empty hex");
  }
  // Concatenate session secret || pepper, then HKDF-extract for a single 32-byte
  // key. (Plain concat would also work; HKDF-extract is slightly more robust
  // against weak secrets.)
  const ikm = Buffer.concat([sessionSecret, pepper]);
  // Use HMAC-SHA256 as the extract step (RFC 5869 PRK = HMAC(salt, IKM)).
  // We use a fixed empty salt — the secret is the source of randomness.
  return crypto.createHmac("sha256", Buffer.alloc(32, 0)).update(ikm).digest();
}

/** base64url encode without padding. */
function b64u(buf: Buffer): string {
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

/** base64url decode (accepts unpadded strings). */
function b64uDecode(s: string): Buffer {
  // Pad to a multiple of 4 with `=`.
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const normalized = s.replace(/-/g, "+").replace(/_/g, "/") + pad;
  return Buffer.from(normalized, "base64");
}

function makePayload(slotIndex: number, figureIndex: number): Buffer {
  if (!Number.isInteger(slotIndex) || slotIndex < 0 || slotIndex > 1_000) {
    throw new RangeError(`slotIndex out of range: ${slotIndex}`);
  }
  if (!Number.isInteger(figureIndex) || figureIndex < 0 || figureIndex > 100) {
    throw new RangeError(`figureIndex out of range: ${figureIndex}`);
  }
  return Buffer.from(`${slotIndex}|${figureIndex}`, "utf8");
}

/**
 * Sign a figure token for `(slotIndex, figureIndex)` under `sessionSecret`.
 * Returns the opaque token string suitable for placing in a URL.
 */
export function signFigureToken(
  sessionSecret: Buffer,
  slotIndex: number,
  figureIndex: number,
): string {
  const key = deriveKey(sessionSecret);
  const payload = makePayload(slotIndex, figureIndex);
  const mac = crypto.createHmac("sha256", key).update(payload).digest();
  return `${b64u(payload)}.${b64u(mac)}`;
}

/**
 * Verify a token against `sessionSecretCurrent`, falling back to
 * `sessionSecretPrevious` for the post-submit 5-minute grace window
 * (architecture §7.2). The caller is responsible for enforcing that
 * `secret_rotated_at` is within the 5-minute window — this function only
 * tries both keys with constant-time compare.
 *
 * Returns `{ ok: true, slotIndex, figureIndex }` on success, where
 * `slotIndex`/`figureIndex` were extracted from the signed payload — the
 * caller should compare them against the expected values.
 */
export function verifyFigureToken(
  token: string,
  sessionSecretCurrent: Buffer,
  sessionSecretPrevious: Buffer | null,
  expectedSlot: number,
  expectedFigure: number,
): VerifyResult {
  if (typeof token !== "string" || token.length === 0) {
    return { ok: false, reason: "malformed" };
  }
  const dot = token.indexOf(".");
  if (dot <= 0 || dot === token.length - 1) {
    return { ok: false, reason: "malformed" };
  }
  const payloadB64 = token.substring(0, dot);
  const macB64 = token.substring(dot + 1);

  let payloadBuf: Buffer;
  let macBuf: Buffer;
  try {
    payloadBuf = b64uDecode(payloadB64);
    macBuf = b64uDecode(macB64);
  } catch (e) {
    return { ok: false, reason: "malformed" };
  }

  // Parse the payload to "{slot}|{figure}". We do NOT trust the payload yet
  // — MAC must verify first, then we compare against expected.
  const payloadStr = payloadBuf.toString("utf8");
  const match = /^(\d+)\|(\d+)$/.exec(payloadStr);
  if (!match) {
    return { ok: false, reason: "malformed" };
  }
  const slotIndex = parseInt(match[1]!, 10);
  const figureIndex = parseInt(match[2]!, 10);

  // Try the current secret, then the previous secret (grace window).
  if (verifyOne(sessionSecretCurrent, payloadBuf, macBuf)) {
    if (slotIndex !== expectedSlot) return { ok: false, reason: "slot_mismatch" };
    if (figureIndex !== expectedFigure)
      return { ok: false, reason: "figure_mismatch" };
    return { ok: true, slotIndex, figureIndex };
  }
  if (
    sessionSecretPrevious !== null &&
    sessionSecretPrevious.length > 0 &&
    verifyOne(sessionSecretPrevious, payloadBuf, macBuf)
  ) {
    if (slotIndex !== expectedSlot) return { ok: false, reason: "slot_mismatch" };
    if (figureIndex !== expectedFigure)
      return { ok: false, reason: "figure_mismatch" };
    return { ok: true, slotIndex, figureIndex };
  }
  return { ok: false, reason: "mac_mismatch" };
}

function verifyOne(secret: Buffer, payload: Buffer, mac: Buffer): boolean {
  let key: Buffer;
  try {
    key = deriveKey(secret);
  } catch (e) {
    // Missing pepper is a config error, but verification should fail closed
    // not blow up the request — the caller has already logged it elsewhere.
    return false;
  }
  const expectedMac = crypto.createHmac("sha256", key).update(payload).digest();
  if (expectedMac.length !== mac.length) return false;
  try {
    return crypto.timingSafeEqual(expectedMac, mac);
  } catch (e) {
    return false;
  }
}

/**
 * Generate a fresh 32-byte session secret. Called at session START and at
 * submit-time rotation (architecture §7.2).
 */
export function generateSessionSecret(): Buffer {
  return crypto.randomBytes(32);
}
