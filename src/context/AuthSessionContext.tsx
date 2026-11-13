'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import { getSupabaseClient } from '../lib/supabase';

interface AuthSessionValue {
  user: User | null;
  isLoading: boolean;
}

const AuthSessionContext = createContext<AuthSessionValue | null>(null);

export function AuthSessionProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let active = true;
    let authEventCount = 0;
    try {
      const supabase = getSupabaseClient();
      const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
        authEventCount += 1;
        if (!active) return;
        setUser(session?.user ?? null);
        setIsLoading(false);
      });

      void supabase.auth.getSession()
        .then(({ data, error }) => {
          if (!active || authEventCount > 0) return;
          setUser(error ? null : data.session?.user ?? null);
          setIsLoading(false);
        })
        .catch(() => {
          if (!active || authEventCount > 0) return;
          setUser(null);
          setIsLoading(false);
        });

      return () => {
        active = false;
        subscription.unsubscribe();
      };
     } catch {
      queueMicrotask(() => {
        if (active) {
          setUser(null);
          setIsLoading(false);
        }
      });

      return () => { active = false; };
    }
  }, []);

  return (
    <AuthSessionContext.Provider value={{ user, isLoading }}>
      {children}
    </AuthSessionContext.Provider>
  );
}

export function useAuthSession(): AuthSessionValue {
  const context = useContext(AuthSessionContext);
  if (!context) throw new Error('useAuthSession must be used within AuthSessionProvider.');
  return context;
}