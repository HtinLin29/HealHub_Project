import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../services/supabaseClient';

type Audience = 'customer' | 'owner';

function getAudience(value: string | undefined): Audience {
  return value === 'owner' ? 'owner' : 'customer';
}

export default function AuthPage() {
  const { signIn, signUp } = useAuth();
  const navigate = useNavigate();
  const { audience: audienceParam } = useParams();
  const audience = getAudience(audienceParam);
  const [mode, setMode] = useState<'login' | 'signup'>(audience === 'owner' ? 'login' : 'login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  const RESET_COOLDOWN_KEY = 'healhub_pw_reset_cooldown_until';

  const [resetOpen, setResetOpen] = useState(false);
  const [resetEmail, setResetEmail] = useState('');
  const [resetCode, setResetCode] = useState('');
  const [resetNewPassword, setResetNewPassword] = useState('');
  const [resetConfirmPassword, setResetConfirmPassword] = useState('');
  const [resetStep, setResetStep] = useState<'send' | 'verify'>('send');
  const [resetLoading, setResetLoading] = useState(false);
  const [resetError, setResetError] = useState('');
  const [resetMessage, setResetMessage] = useState('');
  const [resetCooldownUntil, setResetCooldownUntil] = useState(() => {
    try {
      if (typeof window === 'undefined') return 0;
      const raw = window.localStorage.getItem(RESET_COOLDOWN_KEY);
      const n = raw ? Number(raw) : 0;
      return Number.isFinite(n) ? n : 0;
    } catch {
      return 0;
    }
  });

  function setCooldownUntil(ts: number) {
    setResetCooldownUntil(ts);
    try {
      window.localStorage.setItem(RESET_COOLDOWN_KEY, String(ts));
    } catch {
      // ignore
    }
  }

  const isOwner = audience === 'owner';
  const pageTitle = useMemo(() => {
    if (isOwner) return 'Owner sign in';
    return mode === 'login' ? 'Customer sign in' : 'Customer sign up';
  }, [isOwner, mode]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    try {
      setLoading(true);
      setError('');
      setMessage('');

      if (mode === 'login') {
        await signIn(email, password);

        const { data: sessionData } = await supabase.auth.getSession();
        const userId = sessionData.session?.user?.id;

        let signedInRole: Audience = 'customer';
        if (userId) {
          const { data: roleRow } = await supabase
            .from('users')
            .select('role')
            .eq('auth_user_id', userId)
            .maybeSingle();

          if (roleRow?.role === 'owner') {
            signedInRole = 'owner';
          }
        }

        navigate(signedInRole === 'owner' ? '/owner' : '/shop');
        return;
      }

      if (isOwner) {
        throw new Error('Owner accounts are created by the developer. Please sign in with your assigned owner account.');
      }

      await signUp(email, password, fullName);
      setMessage('Customer account created. If email confirmation is enabled, please verify your email before logging in.');
      setMode('login');
    } catch (err: any) {
      setError(err?.message || 'Authentication failed');
    } finally {
      setLoading(false);
    }
  }

  async function sendResetCode() {
    try {
      const now = Date.now();
      // Read latest cooldown in case another tab/device triggered it.
      try {
        const raw = window.localStorage.getItem(RESET_COOLDOWN_KEY);
        const stored = raw ? Number(raw) : 0;
        if (Number.isFinite(stored)) setResetCooldownUntil(stored);
      } catch {
        // ignore
      }
      const effectiveCooldownUntil = Number.isFinite(resetCooldownUntil) ? resetCooldownUntil : 0;
      if (now < effectiveCooldownUntil) {
        const seconds = Math.ceil((effectiveCooldownUntil - now) / 1000);
        throw new Error(`Please wait ${seconds} seconds before sending again.`);
      }
      setResetLoading(true);
      setResetError('');
      setResetMessage('');

      const targetEmail = resetEmail.trim() || email.trim();
      if (!targetEmail) throw new Error('Please enter your email.');

      // OTP-based recovery flow (no browser link needed).
      const { error: otpErr } = await supabase.auth.signInWithOtp({
        email: targetEmail,
        options: {
          shouldCreateUser: false,
        },
      });
      if (otpErr) throw otpErr;

      setResetStep('verify');
      setResetMessage('If an account exists for that email, we sent a code. Enter the code and your new password.');
      setCooldownUntil(Date.now() + 60_000);
    } catch (err: any) {
      const msg = String(err?.message || '');
      const lower = msg.toLowerCase();
      if (lower.includes('rate limit')) {
        // GoTrue/email providers often throttle; apply a longer cooldown.
        const until = Date.now() + 10 * 60_000;
        setCooldownUntil(until);
        const minutes = 10;
        setResetError(`Too many reset requests. Please try again in ~${minutes} minutes.`);
      } else if (lower.includes('please wait')) {
        setResetError(msg || 'Please wait before sending again.');
      } else {
        setResetError(msg || 'Could not send reset email.');
      }
    } finally {
      setResetLoading(false);
    }
  }

  async function verifyCodeAndResetPassword() {
    try {
      setResetLoading(true);
      setResetError('');
      setResetMessage('');

      const targetEmail = resetEmail.trim() || email.trim();
      const code = resetCode.trim();
      const nextPassword = resetNewPassword.trim();
      const confirmPassword = resetConfirmPassword.trim();

      if (!targetEmail) throw new Error('Please enter your email.');
      if (!code) throw new Error('Please enter the verification code.');
      if (!nextPassword) throw new Error('Please enter a new password.');
      if (nextPassword.length < 6) throw new Error('Password must be at least 6 characters.');
      if (nextPassword !== confirmPassword) throw new Error('Passwords do not match.');

      const { error: verifyErr } = await supabase.auth.verifyOtp({
        email: targetEmail,
        token: code,
        type: 'email',
      });
      if (verifyErr) throw verifyErr;

      const { error: updateErr } = await supabase.auth.updateUser({ password: nextPassword });
      if (updateErr) throw updateErr;

      await supabase.auth.signOut();
      setResetMessage('Password updated successfully. Please sign in with your new password.');
      setResetCode('');
      setResetNewPassword('');
      setResetConfirmPassword('');
      setResetStep('send');
      setResetOpen(false);
    } catch (err: any) {
      const msg = String(err?.message || '');
      setResetError(msg || 'Could not reset password.');
    } finally {
      setResetLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-100 px-4 py-12">
      <div className="mx-auto max-w-md rounded-3xl border border-slate-200 bg-white shadow-xl">
        <div className="bg-gradient-to-r from-indigo-700 via-blue-700 to-cyan-600 px-6 py-8 text-white">
          <p className="text-xs uppercase tracking-[0.2em] text-blue-100">HealHub</p>
          <h1 className="mt-2 text-3xl font-bold">{pageTitle}</h1>
          <p className="mt-2 text-sm text-blue-100">
            {isOwner ? 'Only approved owner accounts can access the owner side.' : 'Browse products, shop, and use the customer assistant. Owner accounts will still be routed to the dashboard after sign in.'}
          </p>
        </div>
        <form className="space-y-4 px-6 py-8" onSubmit={handleSubmit}>
          {!isOwner && mode === 'signup' && (
            <input className="w-full rounded-lg border px-3 py-2 text-sm" placeholder="Full name" value={fullName} onChange={(e) => setFullName(e.target.value)} />
          )}
          <input className="w-full rounded-lg border px-3 py-2 text-sm" placeholder="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          <input className="w-full rounded-lg border px-3 py-2 text-sm" placeholder="Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />

          {!isOwner && mode === 'login' && (
            <div className="flex justify-end">
              <button
                type="button"
                className="text-sm font-medium text-indigo-600 hover:text-indigo-700"
                onClick={() => {
                  setResetOpen(true);
                  setResetEmail(email);
                  setResetError('');
                  setResetMessage('');
                }}
              >
                Forgot password?
              </button>
            </div>
          )}

          {error && <div className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>}
          {message && <div className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{message}</div>}
          <button className="w-full rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white disabled:bg-slate-300" disabled={loading}>
            {loading ? 'Please wait...' : mode === 'login' ? 'Sign in' : 'Create customer account'}
          </button>

          {!isOwner && (
            <div className="text-center text-sm text-slate-500">
              {mode === 'login' ? 'Need a customer account?' : 'Already have a customer account?'}{' '}
              <button type="button" className="font-medium text-indigo-600" onClick={() => setMode(mode === 'login' ? 'signup' : 'login')}>
                {mode === 'login' ? 'Sign up' : 'Sign in'}
              </button>
            </div>
          )}

          <div className="text-center text-sm">
            <Link to="/" className="text-slate-500 hover:text-slate-700">Back to first screen</Link>
          </div>
        </form>
      </div>

      {resetOpen && !isOwner && (
        <div className="fixed inset-0 z-[100] flex items-end justify-center bg-black/40 p-3">
          <div className="w-full max-w-md overflow-hidden rounded-2xl bg-white p-4 shadow-xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Reset password</p>
                <h3 className="mt-1 text-base font-bold text-slate-900">
                  {resetStep === 'send' ? 'Send verification code' : 'Verify code and set new password'}
                </h3>
              </div>
              <button className="rounded-lg px-2 py-1 text-slate-500 hover:bg-slate-100" onClick={() => setResetOpen(false)}>
                ✕
              </button>
            </div>

            <div className="mt-3">
              <input
                className="w-full rounded-lg border px-3 py-2 text-sm"
                placeholder="Email"
                type="email"
                value={resetEmail}
                onChange={(e) => setResetEmail(e.target.value)}
              />
            </div>

            {resetStep === 'verify' && (
              <div className="mt-3 space-y-2">
                <input
                  className="w-full rounded-lg border px-3 py-2 text-sm"
                  placeholder="Verification code"
                  value={resetCode}
                  onChange={(e) => setResetCode(e.target.value)}
                />
                <input
                  className="w-full rounded-lg border px-3 py-2 text-sm"
                  placeholder="New password"
                  type="password"
                  value={resetNewPassword}
                  onChange={(e) => setResetNewPassword(e.target.value)}
                />
                <input
                  className="w-full rounded-lg border px-3 py-2 text-sm"
                  placeholder="Confirm new password"
                  type="password"
                  value={resetConfirmPassword}
                  onChange={(e) => setResetConfirmPassword(e.target.value)}
                />
              </div>
            )}

            {resetError && <div className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{resetError}</div>}
            {resetMessage && <div className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{resetMessage}</div>}

            <div className="mt-4 flex gap-2">
              <button
                type="button"
                className="flex-1 rounded-xl border px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                onClick={() => setResetOpen(false)}
                disabled={resetLoading}
              >
                Back
              </button>
              <button
                type="button"
                className="flex-1 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60"
                onClick={() => void (resetStep === 'send' ? sendResetCode() : verifyCodeAndResetPassword())}
                disabled={resetLoading || (resetStep === 'send' && Date.now() < resetCooldownUntil)}
              >
                {resetLoading
                  ? 'Sending...'
                  : resetStep === 'send' && Date.now() < resetCooldownUntil
                    ? `Wait ${Math.ceil((resetCooldownUntil - Date.now()) / 1000)}s`
                    : resetStep === 'send'
                      ? 'Send code'
                      : 'Verify & Reset'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
