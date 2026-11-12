'use client';

import { useRouter } from 'next/navigation';
import React, { useEffect, useState } from 'react';
import { getCurrentOrganizationRole } from '../../app/dashboard/team/actions';

interface SearchDestination {
  title: string;
  category: 'Page' | 'Feature';
  href: string;
  keywords: string[];
}

const DESTINATIONS: SearchDestination[] = [
  { title: 'Dashboard', category: 'Page', href: '/dashboard', keywords: ['clients', 'workspace'] },
  { title: 'Client Profile', category: 'Feature', href: '/dashboard#client-profile', keywords: ['client details', 'new client', 'edit client'] },
  { title: 'Document Staging', category: 'Feature', href: '/dashboard#document-staging', keywords: ['stage', 'upload', 'file'] },
  { title: 'Financial Monitoring', category: 'Feature', href: '/dashboard#financial-monitoring', keywords: ['finance', 'balance', 'activity'] },
  { title: 'Invoices', category: 'Feature', href: '/dashboard#invoice-form', keywords: ['invoice', 'billing', 'payment'] },
  { title: 'Grants', category: 'Feature', href: '/dashboard#grant-form', keywords: ['grant', 'funds', 'ledger'] },
  { title: 'Staged Documents', category: 'Feature', href: '/dashboard#staged-documents', keywords: ['staged', 'documents', 'files'] },
  { title: 'Credentials Vault', category: 'Feature', href: '/dashboard#credentials-vault', keywords: ['credentials', 'vault', 'portal'] },
  { title: 'Data Governance', category: 'Feature', href: '/dashboard#data-governance', keywords: ['purge', 'expiry', 'reminders'] },
  { title: 'Archived Clients', category: 'Page', href: '/dashboard/archived', keywords: ['archived', 'restore', 'purge'] },
  { title: 'Inactive Accounts', category: 'Page', href: '/dashboard/data-lifecycle', keywords: ['inactive', 'lifecycle', 'activity'] },
];

const OWNER_DESTINATIONS: SearchDestination[] = [
  { title: 'Team Access', category: 'Page', href: '/dashboard/team', keywords: ['team', 'agents', 'members'] },
  { title: 'Invite Agent', category: 'Feature', href: '/dashboard/team#invite-agent', keywords: ['invite', 'agent', 'email'] },
  { title: 'Organization Members', category: 'Feature', href: '/dashboard/team#organization-members', keywords: ['team', 'members', 'roles'] },
  { title: 'Removed Agents', category: 'Feature', href: '/dashboard/team#removed-agents', keywords: ['removed', 'restore', 'agents'] },
];

export default function GlobalPageSearch() {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [canAccessTeam, setCanAccessTeam] = useState(false);
  useEffect(() => {
    let active = true;
    void getCurrentOrganizationRole()
      .then((role) => {
        if (active) setCanAccessTeam(role === 'owner');
      })
      .catch(() => {
        if (active) setCanAccessTeam(false);
      });
    return () => { active = false; };
  }, []);

  const destinations = canAccessTeam ? [...DESTINATIONS, ...OWNER_DESTINATIONS] : DESTINATIONS;
  const searchTerm = query.trim().toLocaleLowerCase();
  const matches = destinations.filter((destination) =>
    !searchTerm || [destination.title, ...destination.keywords]
      .some((value) => value.toLocaleLowerCase().includes(searchTerm))
  ).slice(0, 7);

  function selectDestination(destination: SearchDestination) {
    setQuery('');
    setIsOpen(false);
    setActiveIndex(0);
    router.push(destination.href);
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown' && matches.length > 0) {
      event.preventDefault();
      setIsOpen(true);
      setActiveIndex((index) => (index + 1) % matches.length);
    } else if (event.key === 'ArrowUp' && matches.length > 0) {
      event.preventDefault();
      setIsOpen(true);
      setActiveIndex((index) => (index - 1 + matches.length) % matches.length);
    } else if (event.key === 'Enter' && isOpen && matches[activeIndex]) {
      event.preventDefault();
      selectDestination(matches[activeIndex]);
    } else if (event.key === 'Escape') {
      setIsOpen(false);
    }
  }

  return (
    <div className="relative w-full min-w-0">
      <label className="sr-only" htmlFor="global-page-search">Search pages and features</label>
      <span
        aria-hidden="true"
        className="pointer-events-none absolute left-3 top-1/2 z-10 h-3.5 w-3.5 -translate-y-1/2 rounded-full border-2 border-zinc-400 after:absolute after:-bottom-1 after:-right-1 after:h-1.5 after:w-0.5 after:rotate-[-45deg] after:bg-zinc-400 after:content-['']"
      />
      <input
        id="global-page-search"
        type="search"
        role="combobox"
        aria-autocomplete="list"
        aria-controls="global-page-search-results"
        aria-expanded={isOpen}
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setActiveIndex(0);
          setIsOpen(true);
        }}
        onFocus={() => setIsOpen(true)}
        onBlur={() => window.setTimeout(() => setIsOpen(false), 120)}
        onKeyDown={handleKeyDown}
        placeholder="Search pages and features"
        className="h-11 w-full rounded-md border border-zinc-600 bg-zinc-900 px-3 pl-10 text-sm text-zinc-100 shadow-sm outline-none placeholder:text-zinc-400 transition-colors hover:border-zinc-500 focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/20"
      />
      {isOpen && (
        <div
          id="global-page-search-results"
          role="listbox"
          aria-label="Pages and features"
          className="absolute left-0 top-full z-50 mt-1 max-h-80 w-full overflow-y-auto rounded-md border border-zinc-700 bg-zinc-950 py-1 shadow-xl"
        >
          {matches.length === 0 ? (
            <p className="px-3 py-3 text-sm text-zinc-500">No matching pages or features.</p>
          ) : matches.map((destination, index) => (
            <button
              key={destination.title}
              type="button"
              role="option"
              aria-selected={index === activeIndex}
              onMouseEnter={() => setActiveIndex(index)}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => selectDestination(destination)}
              className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-left ${index === activeIndex ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-300 hover:bg-zinc-900'}`}
            >
              <span className="truncate text-sm">{destination.title}</span>
              <span className="shrink-0 text-[10px] uppercase text-zinc-500">{destination.category}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
