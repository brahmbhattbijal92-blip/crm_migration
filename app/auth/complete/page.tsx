'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { getSupabaseClient } from '../../../src/lib/supabase';

export default function AuthCompletePage() {
  const [hasError, setHasError] = useState(false);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    const requestedPath = new URLSearchParams(window.location.search).get('next');
    const nextPath = requestedPath?.startsWith('/') && !requestedPath.startsWith('//')
      ? requestedPath
      : '/dashboard';
    const fragment = new URLSearchParams(window.location.hash.slice(1));
    if (!fragment.has('access_token') || !fragment.has('refresh_token')) {
      setHasError(true);
      return;
    }

    try {
      void getSupabaseClient().auth.getSession()
        .then(({ data, error }) => {
          if (error || !data.session) {
            setHasError(true);
            return;
          }
          window.location.replace(nextPath);
        })
        .catch(() => setHasError(true));
    } catch {
      setHasError(true);
    }
  }, []);

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="mx-auto flex min-h-screen max-w-lg flex-col justify-center px-5 py-12">
        <p className="text-xs font-semibold uppercase text-emerald-400">CRM Migration</p>
        <h1 className="mt-2 text-2xl font-semibold">Confirming your account</h1>
        {hasError ? (
          <>
            <p role="alert" className="mt-5 border border-rose-900 bg-rose-950/40 px-4 py-3 text-sm text-rose-200">
              This confirmation link is expired, invalid, or already used. Request a new email and try again.
            </p>
            <Link href="/login" className="mt-5 text-sm text-emerald-300 underline underline-offset-4 hover:text-emerald-200">
              Return to sign in
            </Link>
          </>
        ) : (
          <p role="status" className="mt-5 text-sm text-zinc-400">Verifying your email link...</p>
        )}
      </div>
    </main>
  );
}