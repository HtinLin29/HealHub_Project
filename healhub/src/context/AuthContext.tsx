import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { PropsWithChildren } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../services/supabaseClient';
import type { UserRole } from '../types/domain';

type AuthContextValue = {
  session: Session | null;
  loading: boolean;
  roleLoading: boolean;
  role: UserRole | null;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, fullName?: string) => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: PropsWithChildren) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [roleLoading, setRoleLoading] = useState(true);
  const [role, setRole] = useState<UserRole | null>(null);

  async function loadRole(userId: string | undefined) {
    setRoleLoading(true);

    if (!userId) {
      setRole(null);
      setRoleLoading(false);
      return;
    }

    try {
      const { data, error } = await supabase.from('users').select('role').eq('auth_user_id', userId).maybeSingle();
      if (error) {
        setRole('customer');
        return;
      }

      setRole((data?.role as UserRole | undefined) || 'customer');
    } catch {
      setRole('customer');
    } finally {
      setRoleLoading(false);
    }
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session ?? null);
      setLoading(false);
      void loadRole(data.session?.user?.id);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession ?? null);
      setLoading(false);
      void loadRole(nextSession?.user?.id);
    });

    return () => sub.subscription.unsubscribe();
  }, []);

  async function signIn(email: string, password: string) {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
  }

  async function signUp(email: string, password: string, fullName?: string) {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: fullName || null },
      },
    });
    if (error) throw error;

    const userId = data.user?.id;
    if (userId) {
      await supabase.from('users').upsert({
        auth_user_id: userId,
        email,
        full_name: fullName || null,
        role: 'customer',
      });
    }
  }

  async function signOut() {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
  }

  const value = useMemo(() => ({ session, loading, roleLoading, role, signIn, signUp, signOut }), [session, loading, roleLoading, role]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
