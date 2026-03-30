import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import CustomerLayout from './CustomerLayout';
import { supabase } from '../services/supabaseClient';
import { useAuth } from '../context/AuthContext';
import { listAddresses, type SavedAddress } from '../services/addressService';
import { listPaymentMethods, type PaymentMethod } from '../services/paymentService';
import { useTheme } from '../context/ThemeContext';

export default function CustomerProfilePage() {
  const { role, signOut } = useAuth();
  const { mode, setMode } = useTheme();
  const [fullName, setFullName] = useState('');
  const [draftFullName, setDraftFullName] = useState('');
  const [editing, setEditing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const roleLabel = useMemo(() => {
    if (!role) return '—';
    return String(role).toUpperCase();
  }, [role]);

  useEffect(() => {
    async function load() {
      try {
        setLoading(true);
        setError('');
        setMessage('');
        const { data: sessionData } = await supabase.auth.getSession();
        const authUserId = sessionData.session?.user?.id;
        if (!authUserId) return;

        const res = await supabase.from('users').select('full_name').eq('auth_user_id', authUserId).maybeSingle();
        if (res.error) throw res.error;

        const value = String((res.data as any)?.full_name || '');
        setFullName(value);
        setDraftFullName(value);
      } catch (e: any) {
        setError(e?.message || 'Could not load profile.');
      } finally {
        setLoading(false);
      }
    }

    void load();
  }, []);

  async function handleSave() {
    try {
      setSaving(true);
      setError('');
      setMessage('');

      const trimmed = fullName.trim();
      const { data: sessionData } = await supabase.auth.getSession();
      const authUserId = sessionData.session?.user?.id;
      if (!authUserId) throw new Error('Please sign in again.');

      const res = await supabase
        .from('users')
        .update({ full_name: trimmed })
        .eq('auth_user_id', authUserId);
      if (res.error) throw res.error;

      setMessage('Profile saved.');
    } catch (e: any) {
      setError(e?.message || 'Failed to save profile.');
    } finally {
      setSaving(false);
    }
  }

  const [addresses, setAddresses] = useState<SavedAddress[]>([]);
  const [addressesLoading, setAddressesLoading] = useState(true);
  const [payments, setPayments] = useState<PaymentMethod[]>([]);
  const [paymentsLoading, setPaymentsLoading] = useState(true);

  const defaultAddress = useMemo(() => addresses.find((a) => a.is_default) ?? null, [addresses]);
  const defaultPayment = useMemo(() => payments.find((p) => p.is_default) ?? null, [payments]);

  useEffect(() => {
    async function loadAccountBasics() {
      try {
        setAddressesLoading(true);
        setPaymentsLoading(true);
        const [addrRows, payRows] = await Promise.all([listAddresses(), listPaymentMethods()]);
        setAddresses(addrRows);
        setPayments(payRows);
      } catch {
        // Ignore summary errors; user can still manage addresses/payment.
      } finally {
        setAddressesLoading(false);
        setPaymentsLoading(false);
      }
    }
    void loadAccountBasics();
  }, []);

  return (
    <CustomerLayout>
      <div className="mb-4">
        <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Profile</p>
        <div className="mt-1 flex items-center justify-between gap-3">
          <h2 className="text-xl font-bold text-slate-900">My Profile</h2>
          <button
            type="button"
            className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
            onClick={() => setMode(mode === 'dark' ? 'light' : 'dark')}
            aria-label="Toggle theme"
            title="Toggle theme"
          >
            <span>Mode:</span>
            <span className="text-lg leading-none" aria-hidden="true">
              {mode === 'dark' ? '🌙' : '☀️'}
            </span>
            <span className="sr-only">Toggle theme</span>
          </button>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-700 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-semibold text-slate-900">{editing ? 'Edit profile' : 'My profile'}</p>
            <p className="mt-1 text-xs text-slate-500">Role: {roleLabel}</p>
          </div>
          {!editing ? (
            <button
              type="button"
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
              onClick={() => {
                setError('');
                setMessage('');
                setDraftFullName(fullName);
                setEditing(true);
              }}
              disabled={loading || saving}
            >
              Edit profile
            </button>
          ) : null}
        </div>

        {!editing ? (
          <div className="mt-4">
            <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Full name</label>
            <p className="mt-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900">
              {loading ? 'Loading…' : fullName || '—'}
            </p>
          </div>
        ) : (
          <div className="mt-4 space-y-3">
            <div>
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Full name</label>
              <input
                className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                value={draftFullName}
                onChange={(e) => setDraftFullName(e.target.value)}
                placeholder="Enter your full name"
                disabled={loading || saving}
              />
            </div>

            {error && (
              <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>
            )}
            {message && (
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{message}</div>
            )}

            <div className="flex gap-2">
              <button
                type="button"
                className="flex-1 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                onClick={() => {
                  setError('');
                  setMessage('');
                  setDraftFullName(fullName);
                  setEditing(false);
                }}
                disabled={saving}
              >
                Cancel
              </button>
              <button
                type="button"
                className="flex-1 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60 disabled:cursor-not-allowed"
                onClick={() => {
                  setFullName(draftFullName);
                  void handleSave();
                }}
                disabled={loading || saving}
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-700 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <p className="font-semibold text-slate-900">Address</p>
          <Link to="/account/address" className="text-sm font-medium text-indigo-600 hover:underline">
            Manage
          </Link>
        </div>

        <div className="mt-3">
          {addressesLoading ? (
            <p className="text-sm text-slate-500">Loading…</p>
          ) : defaultAddress ? (
            <>
              <p className="text-sm font-semibold text-slate-800">{defaultAddress.label}</p>
              <p className="mt-1 text-sm text-slate-600 break-words">{defaultAddress.address_line1}</p>
              {defaultAddress.address_line2 && (
                <p className="mt-1 text-sm text-slate-500 break-words">{defaultAddress.address_line2}</p>
              )}
            </>
          ) : (
            <p className="text-sm text-slate-500">No saved address yet.</p>
          )}
        </div>
      </div>

      <div className="mt-3 rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-700 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <p className="font-semibold text-slate-900">Payment</p>
          <Link to="/account/payment" className="text-sm font-medium text-indigo-600 hover:underline">
            Manage
          </Link>
        </div>

        <div className="mt-3">
          {paymentsLoading ? (
            <p className="text-sm text-slate-500">Loading…</p>
          ) : defaultPayment ? (
            <>
              <p className="text-sm font-semibold text-slate-800">{(defaultPayment.brand || defaultPayment.provider || 'VISA').toUpperCase()} •••• {defaultPayment.last4}</p>
              <p className="mt-1 text-sm text-slate-600">
                {defaultPayment.cardholder_name ? defaultPayment.cardholder_name : 'Card'}
              </p>
            </>
          ) : (
            <p className="text-sm text-slate-500">No saved payment method yet.</p>
          )}
        </div>
      </div>

      <div className="mt-3">
        <button
          type="button"
          className="w-full rounded-xl border border-rose-300 bg-rose-50 px-4 py-2 text-sm font-semibold text-rose-700 hover:bg-rose-100"
          onClick={() => void signOut()}
        >
          Sign out
        </button>
      </div>
    </CustomerLayout>
  );
}

