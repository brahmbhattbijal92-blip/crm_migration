'use client';

import Link from 'next/link';
import React, { useEffect, useState } from 'react';
import { getSupabaseClient } from '../lib/supabase';

export default function AuthStatus() {
  const [email, setEmail] = useState('');
  const [canManageTeam, setCanManageTeam] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState('');

  useEffect(() => {
    let active = true;
    try {
      const supabase = getSupabaseClient();
      async function updateUser(user: { id: string; email?: string } | null) {
        if (!active) return;
        setEmail(user?.email ?? '');
        setCanManageTeam(false);
        if (!user) return;

        const { data: profile } = await supabase
          .from('profiles')
          .select('default_organization_id')
          .eq('user_id', user.id)
          .maybeSingle();
        if (!active || !profile?.default_organization_id) return;

        const { data: membership } = await supabase
          .from('organization_memberships')
          .select('role')
          .eq('organization_id', profile.default_organization_id)
          .eq('user_id', user.id)
          .maybeSingle();
        if (active) setCanManageTeam(['owner', 'admin'].includes(String(membership?.role)));
      }

      supabase.auth.getUser().then(({ data }) => updateUser(data.user)).catch(() => undefined);
      const { data } = supabase.auth.onAuthStateChange((_event, session) => {
        void updateUser(session?.user ?? null);
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
      {canManageTeam && <Link href="/dashboard/team" className="border border-zinc-700 px-3 py-2 text-sm text-zinc-300 hover:bg-zinc-900">Team</Link>}
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
