'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import React, { useEffect, useState } from 'react';
import { getPostLoginPath } from '../../src/lib/authPaths';
import { getSupabaseClient } from '../../src/lib/supabase';

function LoadingSpinner() {
  return <span aria-hidden="true" className="h-4 w-4 animate-spin rounded-full border-2 border-current border-r-transparent" />;
}

export default function LoginPage() {
  const router = useRouter();
  const [errorMessage, setErrorMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(() => {
      if (!active) return;
      const error = new URLSearchParams(window.location.search).get('error');
      if (error === 'configuration') {
        setErrorMessage('Secure sign-in is unavailable because the authentication service is not configured.');
      } else if (error === 'confirmation') {
        setErrorMessage('The confirmation link could not be verified. Request a new email and try again.');
      }
    }, 0);

    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, []);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    let isNavigating = false;
    const formData = new FormData(event.currentTarget);
    const email = String(formData.get('email') ?? '').trim();
    const password = String(formData.get('password') ?? '');
    setIsSubmitting(true);
    setErrorMessage('');
    try {
      const { error } = await getSupabaseClient().auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (error) throw error;
      const requestedPath = new URLSearchParams(window.location.search).get('next');
      isNavigating = true;
      router.replace(getPostLoginPath(requestedPath));
      router.refresh();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Sign in failed.');
    } finally {
      if (!isNavigating) setIsSubmitting(false);
    }
  }

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="mx-auto flex min-h-screen max-w-lg flex-col justify-center px-5 py-12">
        <nav aria-label="Support navigation" className="mb-6 flex flex-wrap gap-4 text-sm text-zinc-400">
          <Link href="/" className="hover:text-white">Home</Link>
          <Link href="/help" className="hover:text-white">Help</Link>
          <Link href="/contact" className="hover:text-white">Contact</Link>
        </nav>
        <p className="text-xs font-semibold uppercase text-emerald-400">CRM Migration</p>
        <h1 className="mt-2 text-2xl font-semibold">Sign in</h1>
        <p className="mt-2 text-sm text-zinc-400">Access your organization’s migration workspace.</p>
        {errorMessage && <p role="alert" className="mt-5 border border-rose-900 bg-rose-950/40 px-4 py-3 text-sm text-rose-200">{errorMessage}</p>}
        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <label className="block space-y-1.5">
            <span className="text-xs text-zinc-400">Work email</span>
            <input required type="email" name="email" autoComplete="username" className="w-full border border-zinc-700 bg-zinc-900 px-3 py-2.5 text-sm outline-none focus:border-emerald-500" />
          </label>
          <label className="block space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-xs text-zinc-400">Password</span>
              <Link href="/forgot-password" className="text-sm font-medium text-emerald-300 underline underline-offset-4 hover:text-emerald-200">Forgot password?</Link>
            </div>
            <input required type="password" name="password" autoComplete="current-password" className="w-full border border-zinc-700 bg-zinc-900 px-3 py-2.5 text-sm outline-none focus:border-emerald-500" />
          </label>
          <button type="submit" disabled={isSubmitting} aria-busy={isSubmitting} className="w-full bg-emerald-500 px-4 py-2.5 text-sm font-semibold text-zinc-950 hover:bg-emerald-400 disabled:cursor-wait disabled:opacity-60">
            {isSubmitting ? (
              <span role="status" className="inline-flex items-center justify-center gap-2">
                <LoadingSpinner />
                Signing in and opening your workspace...
              </span>
            ) : 'Sign in'}
          </button>
        </form>
        <p className="mt-5 text-sm text-zinc-400">New company? <Link href="/register" className="text-emerald-300 hover:text-emerald-200">Register your organization</Link></p>
      </div>
    </main>
  );
}
