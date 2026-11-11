import { redirect } from 'next/navigation';
import { connection } from 'next/server';
import type { ReactNode } from 'react';
import { requireOrganizationContext } from '../../../src/lib/supabase/server';

export const instant = false;

export default async function TeamLayout({ children }: { children: ReactNode }) {
  await connection();
  const { role } = await requireOrganizationContext();
  if (role !== 'owner') redirect('/dashboard');
  return children;
}
