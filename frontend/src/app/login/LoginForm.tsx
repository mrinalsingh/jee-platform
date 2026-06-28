'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * [UPDATED v3 — NEW-1] — `returnedFromExpiredTest` shows a small banner
 * above the form so the student understands why they're back at /login
 * mid-test, and `nextUrl` is honoured for `/test/...` round-trips so the
 * runtime resumes cleanly on successful re-auth.
 */
export function LoginForm({
  nextUrl,
  returnedFromExpiredTest = false,
}: {
  nextUrl: string;
  returnedFromExpiredTest?: boolean;
}): React.ReactElement {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/auth/session', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) {
        setError('Invalid email or password.');
        return;
      }
      router.push(nextUrl);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="min-h-screen flex items-center justify-center bg-surface-1 px-6">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-sm bg-surface-0 border border-border-subtle rounded-2xl p-8 space-y-4"
      >
        <h1 className="text-2xl font-semibold">Sign in</h1>
        {/* [UPDATED v3 — NEW-1] — explanatory note when the user was sent
           here by an expired-session detection mid-test. */}
        {returnedFromExpiredTest && (
          <p
            role="status"
            className="text-sm text-text-secondary bg-surface-2 border border-border-subtle rounded-lg px-3 py-2"
          >
            Your test session ended. Sign in to continue.
          </p>
        )}
        <label className="block">
          <span className="text-sm text-text-secondary">Email</span>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1 block w-full h-10 px-3 rounded-lg border border-border-subtle bg-surface-0"
          />
        </label>
        <label className="block">
          <span className="text-sm text-text-secondary">Password</span>
          <input
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 block w-full h-10 px-3 rounded-lg border border-border-subtle bg-surface-0"
          />
        </label>
        {error && <p className="text-sm text-[var(--danger-fg)]">{error}</p>}
        <button
          type="submit"
          disabled={submitting}
          className="w-full h-10 rounded-lg bg-[var(--accent)] text-[var(--accent-on)] hover:bg-[var(--accent-strong)] disabled:opacity-50"
        >
          {submitting ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </main>
  );
}
