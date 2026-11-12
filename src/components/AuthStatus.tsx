'use client';

import Link from 'next/link';
import React, { useEffect, useState } from 'react';
import { getCurrentOrganizationRole } from '../../app/dashboard/team/actions';
import { getSupabaseClient } from '../lib/supabase';
import { useAuthSession } from '../context/AuthSessionContext';

export default function AuthStatus({
  showDashboardLink = false,
  showTeamLink = true,
  showHomeLinkWhenSignedOut = false,
}: { showDashboardLink?: boolean; showTeamLink?: boolean; showHomeLinkWhenSignedOut?: boolean }) {
  const { user, isLoading } = useAuthSession();
  const email = user?.email ?? '';
  const [canManageTeam, setCanManageTeam] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState('');

  useEffect(() => {
    let active = true;
    setCanManageTeam(false);
    if (!user) return () => { active = false; };
    void getCurrentOrganizationRole()
      .then((role) => {
        if (active) setCanManageTeam(role === 'owner');
      })
      .catch(() => {
        if (active) setCanManageTeam(false);
      });
    return () => { active = false; };
  }, [user?.id]);

  if (isLoading) return null;

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
      {showDashboardLink && <Link href="/dashboard" className="border border-zinc-700 px-3 py-2 text-sm text-zinc-300 hover:bg-zinc-900">Dashboard</Link>}
      {showTeamLink && canManageTeam && <Link href="/dashboard/team" className="border border-zinc-700 px-3 py-2 text-sm text-zinc-300 hover:bg-zinc-900">Team</Link>}
      <span className="hidden max-w-48 truncate text-xs text-zinc-500 lg:inline">{email}</span>
      <button type="button" disabled={isSigningOut} onClick={() => void signOut()} className="border border-zinc-700 px-3 py-2 text-sm text-zinc-300 hover:bg-zinc-900 disabled:opacity-50">
        {isSigningOut ? 'Signing out...' : 'Sign out'}
      </button>
      {signOutError && <span role="alert" className="basis-full text-xs text-rose-300">{signOutError}</span>}
    </div>
  ) : (
    <div className="flex items-center gap-2">
      {showHomeLinkWhenSignedOut && <Link href="/" className="text-sm text-zinc-300 hover:text-white">Home</Link>}
      <Link href="/login" className="border border-zinc-700 px-3 py-2 text-sm text-zinc-300 hover:bg-zinc-900">Sign in</Link>
    </div>
  );
}
