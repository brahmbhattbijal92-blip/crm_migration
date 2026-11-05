'use client';

import Link from 'next/link';
import React, { useState } from 'react';
import { getSupabaseClient } from '../../src/lib/supabase';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [emailSent, setEmailSent] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    setErrorMessage('');
    try {
      const { error } = await getSupabaseClient().auth.resetPasswordForEmail(email.trim(), {
        redirectTo: `${window.location.origin}/auth/callback?next=/reset-password`,
      });
      if (error) throw error;
      setEmailSent(true);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Password reset request failed.');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="mx-auto flex min-h-screen max-w-lg flex-col justify-center px-5 py-12">
        <p className="text-xs font-semibold uppercase text-emerald-400">CRM Migration</p>
        <h1 className="mt-2 text-2xl font-semibold">Reset your password</h1>
        <p className="mt-2 text-sm text-zinc-400">Enter your work email and we’ll send a password reset link.</p>
        {errorMessage && <p role="alert" className="mt-5 border border-rose-900 bg-rose-950/40 px-4 py-3 text-sm text-rose-200">{errorMessage}</p>}
        {emailSent ? (
          <p role="status" className="mt-6 border border-emerald-900 bg-emerald-950/30 px-4 py-3 text-sm text-emerald-200">If an account exists for that address, a password reset link is on its way.</p>
        ) : (
          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            <label className="block space-y-1.5">
              <span className="text-xs text-zinc-400">Work email</span>
              <input required type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} className="w-full border border-zinc-700 bg-zinc-900 px-3 py-2.5 text-sm outline-none focus:border-emerald-500" />
            </label>
            <button type="submit" disabled={isSubmitting} className="w-full bg-emerald-500 px-4 py-2.5 text-sm font-semibold text-zinc-950 hover:bg-emerald-400 disabled:opacity-50">
              {isSubmitting ? 'Sending link...' : 'Send reset link'}
            </button>
          </form>
        )}
        <p className="mt-5 text-sm text-zinc-400"><Link href="/login" className="text-emerald-300 hover:text-emerald-200">Back to sign in</Link></p>
      </div>
    </main>
  );
}