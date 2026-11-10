'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { completeOrganizationAgentReactivation } from '../../dashboard/team/actions';
import { getPostLoginPath } from '../../../src/lib/authPaths';
import { getSupabaseClient } from '../../../src/lib/supabase';

type CompletionStep = 'checking' | 'code' | 'password';

export default function AuthCompletePage() {
  const [step, setStep] = useState<CompletionStep>('checking');
  const [email, setEmail] = useState('');
  const [token, setToken] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirmation, setPasswordConfirmation] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const started = useRef(false);
  const nextPath = useRef('/dashboard');
  const reactivationOrganizationId = useRef('');
  const isReactivation = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    const requestedPath = new URLSearchParams(window.location.search).get('next');
    nextPath.current = getPostLoginPath(requestedPath);
    const searchParams = new URLSearchParams(window.location.search);
    isReactivation.current = searchParams.get('flow') === 'reactivation';
    reactivationOrganizationId.current = searchParams.get('organization_id') ?? '';
    const fragment = new URLSearchParams(window.location.hash.slice(1));
    const hasFragmentSession = fragment.has('access_token') && fragment.has('refresh_token');
    const hasServerVerifiedCallback = searchParams.get('verified') === '1';
    if (!hasFragmentSession && !hasServerVerifiedCallback) {
      setStep('code');
      return;
    }

    try {
      void getSupabaseClient().auth.getSession()
        .then(({ data, error }) => {
          if (error || !data.session) {
            setErrorMessage('This link could not be verified. Enter the one-time code from the email instead.');
            setStep('code');
            return;
          }
          setStep('password');
        })
        .catch(() => {
          setErrorMessage('This link could not be verified. Enter the one-time code from the email instead.');
          setStep('code');
        });
    } catch {
      setErrorMessage('This link could not be verified. Enter the one-time code from the email instead.');
      setStep('code');
    }
  }, []);

  async function handleVerifyCode(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    setErrorMessage('');
    try {
      const { error } = await getSupabaseClient().auth.verifyOtp({
        email: email.trim(),
        token: token.trim(),
        type: isReactivation.current ? 'email' : 'invite',
      });
      if (error) throw error;
      setStep('password');
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'The invitation code could not be verified.');
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleSetPassword(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage('');
    if (password !== passwordConfirmation) {
      setErrorMessage('The passwords do not match.');
      return;
    }

    setIsSubmitting(true);
    try {
      const { error } = await getSupabaseClient().auth.updateUser({ password });
      if (error) throw error;
      if (isReactivation.current) {
        await completeOrganizationAgentReactivation(reactivationOrganizationId.current);
      }
      window.location.replace(nextPath.current);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Your password could not be set.');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="mx-auto flex min-h-screen max-w-lg flex-col justify-center px-5 py-12">
        <p className="text-xs font-semibold uppercase text-emerald-400">CRM Migration</p>
        <h1 className="mt-2 text-2xl font-semibold">
          {step === 'password' ? 'Set your password' : isReactivation.current ? 'Reactivate your account' : 'Accept your invitation'}
        </h1>
        {errorMessage && <p role="alert" className="mt-5 border border-rose-900 bg-rose-950/40 px-4 py-3 text-sm text-rose-200">{errorMessage}</p>}
        {step === 'checking' ? (
          <p role="status" className="mt-5 text-sm text-zinc-400">Verifying your invitation...</p>
        ) : step === 'code' ? (
          <form onSubmit={handleVerifyCode} className="mt-6 space-y-4">
            <label className="block space-y-1.5">
              <span className="text-xs text-zinc-400">Invitation email</span>
              <input required type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} className="w-full border border-zinc-700 bg-zinc-900 px-3 py-2.5 text-sm outline-none focus:border-emerald-500" />
            </label>
            <label className="block space-y-1.5">
                <span className="text-xs text-zinc-400">One-time {isReactivation.current ? 'reactivation' : 'invitation'} code</span>
              <input required inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6,10}" maxLength={10} value={token} onChange={(event) => setToken(event.target.value)} className="w-full border border-zinc-700 bg-zinc-900 px-3 py-2.5 text-sm outline-none focus:border-emerald-500" />
            </label>
            <button type="submit" disabled={isSubmitting} className="w-full bg-emerald-500 px-4 py-2.5 text-sm font-semibold text-zinc-950 hover:bg-emerald-400 disabled:opacity-50">
              {isSubmitting ? 'Verifying code...' : isReactivation.current ? 'Verify and reactivate' : 'Verify invitation'}
            </button>
          </form>
        ) : (
          <form onSubmit={handleSetPassword} className="mt-6 space-y-4">
            <label className="block space-y-1.5">
              <span className="text-xs text-zinc-400">New password</span>
              <input required type="password" minLength={10} autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} className="w-full border border-zinc-700 bg-zinc-900 px-3 py-2.5 text-sm outline-none focus:border-emerald-500" />
            </label>
            <label className="block space-y-1.5">
              <span className="text-xs text-zinc-400">Confirm password</span>
              <input required type="password" minLength={10} autoComplete="new-password" value={passwordConfirmation} onChange={(event) => setPasswordConfirmation(event.target.value)} className="w-full border border-zinc-700 bg-zinc-900 px-3 py-2.5 text-sm outline-none focus:border-emerald-500" />
            </label>
            <button type="submit" disabled={isSubmitting} className="w-full bg-emerald-500 px-4 py-2.5 text-sm font-semibold text-zinc-950 hover:bg-emerald-400 disabled:opacity-50">
              {isSubmitting ? 'Saving password...' : 'Set password and continue'}
            </button>
          </form>
        )}
        <Link href="/login" className="mt-5 text-sm text-emerald-300 underline underline-offset-4 hover:text-emerald-200">Return to sign in</Link>
      </div>
    </main>
  );
}