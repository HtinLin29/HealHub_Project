import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase env vars: VITE_SUPABASE_URL and/or VITE_SUPABASE_ANON_KEY');
}

if (supabaseUrl.includes('your-project-id')) {
  throw new Error(
    'VITE_SUPABASE_URL is still the template value. Copy healhub/.env.example to healhub/.env and set your real Project URL and anon key from the Supabase dashboard (Settings → API). .env is not committed to git, so each machine needs its own file.',
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
