'use client';

import Link from 'next/link';
import React, { useEffect, useState } from 'react';
import { getCurrentOrganizationRole } from '../../app/dashboard/team/actions';
import { useAuthSession } from '../context/AuthSessionContext';
import AuthStatus from './AuthStatus';

interface NavigationLink {
  label: string;
  href: string;
}

const GUEST_LINKS: NavigationLink[] = [
  { label: 'Home', href: '/' },
  { label: 'Help', href: '/help' },
  { label: 'Contact', href: '/contact' },
];

const WORKSPACE_LINKS: NavigationLink[] = [
  { label: 'Dashboard', href: '/dashboard' },
  { label: 'Archived clients', href: '/dashboard/archived' },
  { label: 'Inactive accounts', href: '/dashboard/data-lifecycle' },
  { label: 'Help', href: '/help' },
  { label: 'Contact', href: '/contact' },
];

const linkClass = 'whitespace-nowrap px-3 py-2 text-sm text-zinc-300 transition-colors hover:bg-zinc-900 hover:text-white';

export default function AppNavigation() {
  const { user, isLoading } = useAuthSession();
  const [teamRole, setTeamRole] = useState<{ userId: string; canManage: boolean } | null>(null);
  const userId = user?.id;
  const canManageTeam = teamRole !== null && teamRole.userId === userId && teamRole.canManage;
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    let active = true;

    if (!userId) return () => {
      active = false;
    };

    void getCurrentOrganizationRole()
      .then((role) => {
        if (active) {
          setTeamRole({
            userId,
            canManage: role === 'owner',
          });
        }
      })
      .catch(() => {
        if (active) {
          setTeamRole({
            userId,
            canManage: false,
          });
        }
      });

    return () => {
      active = false;
    };
   }, [userId]);

  useEffect(() => {
    if (!menuOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [menuOpen]);

  const links = isLoading ? [] : user
    ? [...WORKSPACE_LINKS, ...(canManageTeam ? [{ label: 'Team access', href: '/dashboard/team' }] : [])]
    : GUEST_LINKS;

  function renderLinks(mobile = false) {
    return links.map((link) => (
      <Link
        key={link.href}
        href={link.href}
        onClick={() => setMenuOpen(false)}
        className={mobile ? `${linkClass} block border-b border-zinc-800/80` : linkClass}
      >
        {link.label}
      </Link>
    ));
  }

  return (
    <header className="sticky top-0 z-50 border-b border-zinc-800 bg-zinc-950/95 text-zinc-100 backdrop-blur">
      <div className="mx-auto flex min-h-16 max-w-7xl items-center gap-3 px-4 sm:px-6 lg:px-8">
        <Link href={user ? '/dashboard' : '/'} className="flex shrink-0 items-center gap-2.5" onClick={() => setMenuOpen(false)}>
          <span aria-hidden="true" className="grid h-8 w-8 place-items-center border border-emerald-500/60 text-[10px] font-bold text-emerald-300">CRM</span>
          <span className="text-sm font-semibold text-zinc-100">Migration</span>
        </Link>

        <nav aria-label="Main navigation" className="ml-4 hidden min-w-0 flex-1 items-center gap-1 lg:flex">
          {renderLinks()}
        </nav>

        <div className="ml-auto flex shrink-0 items-center gap-2">
          <AuthStatus showTeamLink={false} />
          <button
            type="button"
            aria-label={menuOpen ? 'Close navigation menu' : 'Open navigation menu'}
            aria-controls="mobile-site-navigation"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((open) => !open)}
            className="grid h-10 w-10 place-items-center border border-zinc-700 text-zinc-200 hover:border-zinc-500 hover:bg-zinc-900 lg:hidden"
          >
            <span className="flex w-4 flex-col gap-1" aria-hidden="true">
              <span className={`h-0.5 w-full bg-current transition-transform ${menuOpen ? 'translate-y-1.5 rotate-45' : ''}`} />
              <span className={`h-0.5 w-full bg-current transition-opacity ${menuOpen ? 'opacity-0' : ''}`} />
              <span className={`h-0.5 w-full bg-current transition-transform ${menuOpen ? '-translate-y-1.5 -rotate-45' : ''}`} />
            </span>
          </button>
        </div>
      </div>

      {menuOpen && (
        <nav id="mobile-site-navigation" aria-label="Mobile navigation" className="border-t border-zinc-800 bg-zinc-950 px-4 py-2 lg:hidden">
          {renderLinks(true)}
        </nav>
      )}
    </header>
  );
}