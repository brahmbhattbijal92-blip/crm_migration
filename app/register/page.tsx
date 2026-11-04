'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import React, { useState } from 'react';
import { getSupabaseClient } from '../../src/lib/supabase';

export default function RegisterPage() {
  const router = useRouter();
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    setErrorMessage('');
    setSuccessMessage('');
    try {
      const { data, error } = await getSupabaseClient().auth.signUp({
        email: email.trim(),
        password,
        options: {
          data: { full_name: fullName.trim() },
          emailRedirectTo: `${window.location.origin}/auth/callback?next=/setup`,
        },
      });
      if (error) throw error;
      if (data.session) {
        router.replace('/setup');
        router.refresh();
      } else {
        setSuccessMessage('Check your email to confirm the owner account, then continue company setup.');
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Organization registration failed.');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="mx-auto flex min-h-screen max-w-lg flex-col justify-center px-5 py-12">
        <p className="text-xs font-semibold uppercase text-emerald-400">CRM Migration</p>
        <h1 className="mt-2 text-2xl font-semibold">Register your organization</h1>
        <p className="mt-2 text-sm text-zinc-400">Create the owner account first. Invite agents after company setup.</p>
        {errorMessage && <p role="alert" className="mt-5 border border-rose-900 bg-rose-950/40 px-4 py-3 text-sm text-rose-200">{errorMessage}</p>}
        {successMessage && <p role="status" className="mt-5 border border-emerald-900 bg-emerald-950/30 px-4 py-3 text-sm text-emerald-200">{successMessage}</p>}
        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <label className="block space-y-1.5">
            <span className="text-xs text-zinc-400">Owner name</span>
            <input required minLength={2} maxLength={120} autoComplete="name" value={fullName} onChange={(event) => setFullName(event.target.value)} className="w-full border border-zinc-700 bg-zinc-900 px-3 py-2.5 text-sm outline-none focus:border-emerald-500" />
          </label>
          <label className="block space-y-1.5">
            <span className="text-xs text-zinc-400">Work email</span>
            <input required type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} className="w-full border border-zinc-700 bg-zinc-900 px-3 py-2.5 text-sm outline-none focus:border-emerald-500" />
          </label>
          <label className="block space-y-1.5">
            <span className="text-xs text-zinc-400">Password</span>
            <input required type="password" minLength={10} autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} className="w-full border border-zinc-700 bg-zinc-900 px-3 py-2.5 text-sm outline-none focus:border-emerald-500" />
          </label>
          <button type="submit" disabled={isSubmitting || Boolean(successMessage)} className="w-full bg-emerald-500 px-4 py-2.5 text-sm font-semibold text-zinc-950 hover:bg-emerald-400 disabled:opacity-50">
            {isSubmitting ? 'Creating account...' : 'Create owner account'}
          </button>
        </form>
        <p className="mt-5 text-sm text-zinc-400">Already registered? <Link href="/login" className="text-emerald-300 hover:text-emerald-200">Sign in</Link></p>
      </div>
    </main>
  );
}
