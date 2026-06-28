/**
 * Client-safe session-auth primitives.
 *
 * [UPDATED v3 — NEW-1] — split out from `session-fetch.ts` because the latter
 * imports `next/headers`, which Turbopack forbids in any module that ends up
 * in the client bundle. The runtime (RuntimeProvider + TelemetryQueue) needs
 * the `SessionAuthError` sentinel and the `fetchWithCookies` client helper but
 * MUST NOT pull `next/headers`, so the implementation lives here and is
 * re-exported from `session-fetch.ts` for callers that prefer the original
 * import path.
 *
 * Distinguishing a 401 (server-revoked session cookie) from a network/5xx
 * failure throughout the client is the central correctness fix the code-review
 * v2 demanded (NEW-1) — silent data loss happens otherwise.
 */

/**
 * Sentinel error thrown by client-side runtime fetches whenever the server
 * explicitly rejects the session cookie (HTTP 401). Lives separately so any
 * module that imports fetch helpers gets the canonical class to
 * `instanceof`-check against.
 *
 * Use the static `is(err)` predicate to dodge cross-realm `instanceof` traps
 * (e.g. Vitest's module-graph re-imports during HMR).
 */
export class SessionAuthError extends Error {
  public readonly status = 401;
  public override readonly name = 'SessionAuthError';

  constructor(message = 'Session authentication failed') {
    super(message);
    // Restore the prototype chain after `Error` constructor reassigns it.
    Object.setPrototypeOf(this, SessionAuthError.prototype);
  }

  static is(err: unknown): err is SessionAuthError {
    return (
      err instanceof SessionAuthError ||
      (err instanceof Error && err.name === 'SessionAuthError')
    );
  }
}

/**
 * Thin wrapper around `fetch` that the runtime uses for every same-origin
 * request that depends on the session cookie. Surfaces a 401 as a typed
 * `SessionAuthError` so callers can branch cleanly; all other non-2xx
 * responses fall through to the existing "network failure" handling (the
 * caller throws or returns based on its own status semantics).
 *
 * Why status-alone (no body parsing): the NestJS gateway returns 401 for any
 * cookie failure (missing, expired, signature mismatch, revoked auth_sessions
 * row). The body shape is informational only. Status alone is sufficient and
 * keeps this helper synchronous-fast.
 */
export async function fetchWithCookies(
  input: RequestInfo | URL,
  init: RequestInit = {},
): Promise<Response> {
  const res = await fetch(input, {
    credentials: 'same-origin',
    ...init,
  });
  if (res.status === 401) {
    throw new SessionAuthError(
      `Session auth rejected for ${typeof input === 'string' ? input : input.toString()}`,
    );
  }
  return res;
}
