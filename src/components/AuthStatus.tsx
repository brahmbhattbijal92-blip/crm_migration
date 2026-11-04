'use client';

import Link from 'next/link';
import React, { useEffect, useState } from 'react';
import { getSupabaseClient } from '../lib/supabase';

export default function AuthStatus() {
  const [email, setEmail] = useState('');
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState('');

  useEffect(() => {
    let active = true;
    try {
      const supabase = getSupabaseClient();
      supabase.auth.getUser().then(({ data }) => {
        if (active) setEmail(data.user?.email ?? '');
      }).catch(() => undefined);
      const { data } = supabase.auth.onAuthStateChange((_event, session) => {
        if (active) setEmail(session?.user.email ?? '');
      });
      return () => {
        active = false;
        data.subscription.unsubscribe();
      };
    } catch {
      return () => { active = false; };
    }
  }, []);

  async function signOut() {
    setIsSigningOut(true);
    setSignOutError('');
    try {
      const { error } = await getSupabaseClient().auth.signOut({ scope: 'global' });
      if (error) throw error;
      window.location.replace('/login');
    } catch (error) {
      setSignOutError(error instanceof Error ? error.message : 'Sign out failed. Please try again.');
      setIsSigningOut(false);
    }
  }

  return email ? (
    <div className="flex flex-wrap items-center gap-2">
      <Link href="/dashboard/team" className="border border-zinc-700 px-3 py-2 text-sm text-zinc-300 hover:bg-zinc-900">Team</Link>
      <span className="hidden max-w-48 truncate text-xs text-zinc-500 lg:inline">{email}</span>
      <button type="button" disabled={isSigningOut} onClick={() => void signOut()} className="border border-zinc-700 px-3 py-2 text-sm text-zinc-300 hover:bg-zinc-900 disabled:opacity-50">
        {isSigningOut ? 'Signing out...' : 'Sign out'}
      </button>
      {signOutError && <span role="alert" className="basis-full text-xs text-rose-300">{signOutError}</span>}
    </div>
  ) : (
    <div className="flex items-center gap-2">
      <Link href="/login" className="border border-zinc-700 px-3 py-2 text-sm text-zinc-300 hover:bg-zinc-900">Sign in</Link>
    </div>
  );
}
