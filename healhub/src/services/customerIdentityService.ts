import { supabase } from './supabaseClient';

// Returns public.users.id for the current Supabase Auth user.
// Creates a customer row lazily if it doesn't exist yet.
export async function getOrCreateCurrentCustomerId(): Promise<string | null> {
  try {
    const { data: sessionData } = await supabase.auth.getSession();
    const authUserId = sessionData.session?.user?.id;
    if (!authUserId) return null;

    const email = sessionData.session?.user?.email ?? null;
    const fullName = (sessionData.session?.user?.user_metadata as any)?.full_name ?? null;

    const userRes = await supabase.from('users').select('id').eq('auth_user_id', authUserId).maybeSingle();
    if (userRes.error) return null;
    if (userRes.data?.id) return (userRes.data.id as string) ?? null;

    if (!email) return null;

    const upsertRes = await supabase.from('users').upsert(
      {
        auth_user_id: authUserId,
        email,
        full_name: fullName,
        role: 'customer',
      },
      { onConflict: 'auth_user_id' },
    );
    if (upsertRes.error) return null;

    const recheck = await supabase.from('users').select('id').eq('auth_user_id', authUserId).maybeSingle();
    if (recheck.error) return null;
    return (recheck.data?.id as string | undefined) ?? null;
  } catch {
    return null;
  }
}

