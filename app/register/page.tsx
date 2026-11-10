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
  const [isResending, setIsResending] = useState(false);
  const [isExistingAccount, setIsExistingAccount] = useState(false);
  const [canResendConfirmation, setCanResendConfirmation] = useState(false);

  function getConfirmationRedirectUrl(): string {
    return `${window.location.origin}/auth/callback?next=/setup`;
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    setErrorMessage('');
    setSuccessMessage('');
    setIsExistingAccount(false);
    setCanResendConfirmation(false);
    try {
      const { data, error } = await getSupabaseClient().auth.signUp({
        email: email.trim(),
        password,
        options: {
          data: { full_name: fullName.trim() },
          emailRedirectTo: getConfirmationRedirectUrl(),
        },
      });
      if (error) throw error;
      if (data.user?.identities?.length === 0) {
        setIsExistingAccount(true);
        setSuccessMessage('An account with this email already exists. Sign in instead. If an owner deactivated your organization access, ask them to send a reactivation email from Team.');
        return;
      }
      if (data.session) {
        router.replace('/setup');
        router.refresh();
      } else {
        setCanResendConfirmation(true);
        setSuccessMessage('Supabase accepted the signup request. Check your inbox, Spam, and Promotions folders for the confirmation email.');
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Organization registration failed.');
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleResendConfirmation() {
    const normalizedEmail = email.trim();
    if (!normalizedEmail) {
      setErrorMessage('Enter the registration email address before requesting another confirmation email.');
      return;
    }

    setIsResending(true);
    setErrorMessage('');
    try {
      const { error } = await getSupabaseClient().auth.resend({
        type: 'signup',
        email: normalizedEmail,
        options: { emailRedirectTo: getConfirmationRedirectUrl() },
      });
      if (error) throw error;
      setSuccessMessage('Supabase accepted another confirmation request. Check your inbox, Spam, and Promotions. Delivery depends on the project email provider.');
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'The confirmation email could not be resent.');
    } finally {
      setIsResending(false);
    }
  }

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="mx-auto flex min-h-screen max-w-lg flex-col justify-center px-5 py-12">
        <p className="text-xs font-semibold uppercase text-emerald-400">CRM Migration</p>
        <h1 className="mt-2 text-2xl font-semibold">Register your organization</h1>
        <p className="mt-2 text-sm text-zinc-400">Create the owner account first. Invite agents after company setup.</p>
        {errorMessage && <p role="alert" className="mt-5 border border-rose-900 bg-rose-950/40 px-4 py-3 text-sm text-rose-200">{errorMessage}</p>}
        {successMessage && (
          <div role="status" className="mt-5 space-y-3 border border-emerald-900 bg-emerald-950/30 px-4 py-3 text-sm text-emerald-200">
            <p>{successMessage}</p>
            {isExistingAccount ? (
              <Link href="/login" className="inline-block border border-emerald-800 px-3 py-2 text-xs font-medium text-emerald-100 hover:bg-emerald-900/40">Go to sign in</Link>
            ) : canResendConfirmation && (
              <button type="button" disabled={isResending} onClick={() => void handleResendConfirmation()} className="border border-emerald-800 px-3 py-2 text-xs font-medium text-emerald-100 hover:bg-emerald-900/40 disabled:opacity-50">
                {isResending ? 'Resending...' : 'Resend confirmation email'}
              </button>
            )}
          </div>
        )}
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
