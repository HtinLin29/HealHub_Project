import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import CustomerLayout from './CustomerLayout';
import { deletePaymentMethod, listPaymentMethods, setDefaultPaymentMethod, type PaymentMethod } from '../services/paymentService';

function formatExp(mm: number | null, yy: number | null) {
  if (!mm || !yy) return '';
  const two = String(yy).slice(-2);
  return `${String(mm).padStart(2, '0')}/${two}`;
}

export default function PaymentMethodsPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const returnTo = params.get('returnTo');

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [methods, setMethods] = useState<PaymentMethod[]>([]);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [settingDefaultId, setSettingDefaultId] = useState<number | null>(null);

  const defaultId = useMemo(() => methods.find((m) => m.is_default)?.id ?? null, [methods]);

  async function reload() {
    const rows = await listPaymentMethods();
    setMethods(rows);
  }

  useEffect(() => {
    listPaymentMethods()
      .then((rows) => {
        setMethods(rows);
        setError('');
      })
      .catch((e: any) => setError(e?.message || 'Could not load payment methods.'))
      .finally(() => setLoading(false));
  }, []);

  async function chooseDefault(id: number) {
    try {
      setSettingDefaultId(id);
      setError('');
      setMessage('');
      await setDefaultPaymentMethod(id);
      await reload();
      if (returnTo) {
        navigate(returnTo, { replace: true });
        return;
      }
      setMessage('Default card updated.');
    } catch (e: any) {
      setError(e?.message || 'Could not set default card.');
    } finally {
      setSettingDefaultId(null);
    }
  }

  async function remove(id: number) {
    try {
      setDeletingId(id);
      setError('');
      setMessage('');
      await deletePaymentMethod(id);
      await reload();
      setMessage('Card removed.');
    } catch (e: any) {
      setError(e?.message || 'Could not remove card.');
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <CustomerLayout>
      <div className="mb-4 flex items-center gap-3">
        <button className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50" onClick={() => navigate(returnTo || '/shop')}>
          ← Back
        </button>
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Account</p>
          <h2 className="text-xl font-bold text-slate-900">Payment methods</h2>
        </div>
      </div>

      {loading && (
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-500 shadow-sm">
          Loading payment methods...
        </div>
      )}

      {!loading && error && (
        <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </div>
      )}

      {!loading && message && (
        <div className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          {message}
        </div>
      )}

      {!loading && (
        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <Link
            to={`/account/payment/add-card${returnTo ? `?returnTo=${encodeURIComponent(returnTo)}` : ''}`}
            className="flex w-full items-center gap-3 border-b border-slate-200 px-4 py-4 text-left hover:bg-slate-50"
          >
            <span className="text-xl">＋</span>
            <span className="font-medium text-slate-800">Add card</span>
            <span className="ml-auto text-slate-400">›</span>
          </Link>

          {methods.length === 0 ? (
            <div className="px-4 py-6 text-sm text-slate-600">No cards saved yet.</div>
          ) : (
            methods.map((m) => (
              <div key={m.id} className="border-b border-slate-100 px-4 py-4">
                <div className="flex items-start justify-between gap-3">
                  <button className="min-w-0 flex-1 text-left" onClick={() => chooseDefault(m.id)} disabled={settingDefaultId === m.id}>
                    <p className="text-sm font-semibold text-slate-900">
                      {(m.brand || 'VISA').toUpperCase()} •••• {m.last4}
                    </p>
                    <p className="mt-1 text-sm text-slate-700">
                      {m.cardholder_name || 'Cardholder'} {formatExp(m.exp_month, m.exp_year) ? `• Exp ${formatExp(m.exp_month, m.exp_year)}` : ''}
                    </p>
                    {m.is_default && (
                      <span className="mt-2 inline-block rounded bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">
                        Default
                      </span>
                    )}
                  </button>

                  <button
                    className="text-sm font-medium text-rose-600 hover:underline disabled:opacity-60"
                    onClick={() => remove(m.id)}
                    disabled={deletingId === m.id}
                  >
                    {deletingId === m.id ? 'Removing…' : 'Remove'}
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {!loading && methods.length > 0 && defaultId === null && (
        <p className="mt-3 text-xs text-slate-500">
          Tip: tap a card to set it as default for checkout.
        </p>
      )}
    </CustomerLayout>
  );
}

