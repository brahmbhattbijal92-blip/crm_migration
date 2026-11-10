import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { requireOrganizationContext } from '../../../src/lib/supabase/server';

export default async function TeamLayout({ children }: { children: ReactNode }) {
  const { role } = await requireOrganizationContext();
  if (!['owner', 'admin'].includes(role)) redirect('/dashboard');
  return children;
}
