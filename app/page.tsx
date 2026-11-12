
'use client';

import Link from 'next/link';
import AuthStatus from '../src/components/AuthStatus';
import { useStorage } from '../src/context/StorageContext';

export default function Home() {
  const { updateStoragePreference } = useStorage();

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="mx-auto flex min-h-screen w-full max-w-3xl flex-col justify-center gap-6 px-4 py-8 sm:px-6 lg:px-8">
        <header>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-emerald-400">
            CRM Migration
          </p>
          <h1 className="text-2xl font-semibold">Migration operations</h1>
          <p className="mt-2 text-sm text-zinc-400">Sign in to your company workspace or register a new organization.</p>
        </header>
        <div className="flex flex-wrap gap-3">
          <AuthStatus showDashboardLink />
          <Link href="/register" className="border border-zinc-700 px-4 py-2.5 text-sm text-zinc-200 hover:bg-zinc-900">Register organization</Link>
          <Link href="/help" className="border border-zinc-700 px-4 py-2.5 text-sm text-zinc-200 hover:bg-zinc-900">Help and how to use the system</Link>
          <Link href="/contact" className="border border-zinc-700 px-4 py-2.5 text-sm text-zinc-200 hover:bg-zinc-900">Contact</Link>
          <Link
            href="/dashboard?mode=local"
            onClick={() => void updateStoragePreference('local')}
            className="border border-zinc-700 px-4 py-2.5 text-sm text-zinc-200 hover:bg-zinc-900"
          >
            Continue in Local mode
          </Link>
        </div>
      </div>
    </main>
  );
}
