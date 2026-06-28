import { LoginForm } from './LoginForm';

/**
 * Sign-in stub (PRD §6 Out of Scope: auth UI is a separate scope, but a
 * navigation target is required so the runtime's "401 → redirect to /login"
 * flow resolves cleanly in dev / pilot).
 *
 * [UPDATED v3 — NEW-1] — additionally honours `return_to`, set by the
 * runtime when an in-test 401 boots the student here. Only paths that
 * point back to the test runtime are accepted (`/test/...`) to avoid an
 * open-redirect surface from external referrers. A small note above the
 * form tells the student what happened.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; return_to?: string }>;
}): Promise<React.ReactElement> {
  const { next, return_to } = await searchParams;
  // Tight allow-list: only `/test/...` paths may round-trip via return_to.
  // Anything else (or absent) → fall back to `next`, then to /dashboard.
  const safeReturnTo =
    typeof return_to === 'string' && return_to.startsWith('/test/')
      ? return_to
      : null;
  return (
    <LoginForm
      nextUrl={safeReturnTo ?? next ?? '/dashboard'}
      returnedFromExpiredTest={safeReturnTo !== null}
    />
  );
}
