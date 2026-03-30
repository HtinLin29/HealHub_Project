import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import CustomerLayout from './CustomerLayout';
import { addCard, setDefaultPaymentMethod } from '../services/paymentService';

function formatCardNumber(value: string) {
  const digits = value.replace(/\D/g, '').slice(0, 19);
  return digits.replace(/(\d{4})(?=\d)/g, '$1 ');
}

function parseExpiry(value: string) {
  const digits = value.replace(/\D/g, '').slice(0, 4);
  const mm = digits.slice(0, 2);
  const yy = digits.slice(2, 4);
  const display = yy ? `${mm}/${yy}` : mm;
  const month = mm.length === 2 ? Number(mm) : null;
  const year = yy.length === 2 ? Number(`20${yy}`) : null;
  return { display, month, year };
}

function maskLast4(cardNumber: string) {
  const digits = cardNumber.replace(/\D/g, '');
  return digits.length >= 4 ? digits.slice(-4) : '';
}

export default function AddCardPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const returnTo = params.get('returnTo');

  const [cardNumber, setCardNumber] = useState('');
  const [expiry, setExpiry] = useState('');
  const [cvv, setCvv] = useState('');
  const [cardholderName, setCardholderName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const expiryParsed = useMemo(() => parseExpiry(expiry), [expiry]);
  const last4 = useMemo(() => maskLast4(cardNumber), [cardNumber]);

  async function submit() {
    try {
      setSaving(true);
      setError('');

      if (!expiryParsed.month || !expiryParsed.year) throw new Error('Please enter a valid expiration date.');
      if (String(cvv || '').replace(/\D/g, '').length < 3) throw new Error('Please enter a valid security code.');

      // CVV is NEVER stored; it is for UX parity only (demo).
      const saved = await addCard({
        cardNumber,
        expMonth: expiryParsed.month,
        expYear: expiryParsed.year,
        cardholderName,
        brand: 'VISA',
      });
      await setDefaultPaymentMethod(saved.id);

      navigate(returnTo || '/account/payment', { replace: true });
    } catch (e: any) {
      setError(e?.message || 'Could not add card.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <CustomerLayout>
      <div className="mx-auto max-w-md">
        <div className="mb-4 flex items-center gap-3">
          <button className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50" onClick={() => navigate(-1)}>
            ← Back
          </button>
          <h2 className="text-xl font-bold text-slate-900">Add card</h2>
        </div>

        {error && (
          <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {error}
          </div>
        )}

        <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div>
            <div className="mb-1 flex items-center justify-between">
              <label className="text-sm font-medium text-slate-800">Card number</label>
              <span className="text-xs font-semibold text-slate-500">VISA</span>
            </div>
            <div className="flex items-center gap-2 rounded-xl border px-3 py-2">
              <input
                className="w-full text-sm outline-none"
                placeholder="Enter card number"
                inputMode="numeric"
                value={cardNumber}
                onChange={(e) => setCardNumber(formatCardNumber(e.target.value))}
              />
              <div className="rounded-lg border px-2 py-1 text-xs text-slate-500">Scan</div>
            </div>
            {last4 && <p className="mt-1 text-xs text-slate-500">Last 4: {last4}</p>}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-800">Expiration date</label>
              <input
                className="w-full rounded-xl border px-3 py-2 text-sm"
                placeholder="MM/YY"
                inputMode="numeric"
                value={expiry}
                onChange={(e) => setExpiry(parseExpiry(e.target.value).display)}
              />
            </div>
            <div>
              <div className="mb-1 flex items-center justify-between">
                <label className="text-sm font-medium text-slate-800">Security code</label>
                <span className="text-xs text-slate-400">CVV/CVC</span>
              </div>
              <input
                className="w-full rounded-xl border px-3 py-2 text-sm"
                placeholder="CVV/CVC"
                inputMode="numeric"
                value={cvv}
                onChange={(e) => setCvv(e.target.value.replace(/\D/g, '').slice(0, 4))}
              />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-slate-800">Cardholder name</label>
            <input
              className="w-full rounded-xl border px-3 py-2 text-sm"
              placeholder="Full name"
              value={cardholderName}
              onChange={(e) => setCardholderName(e.target.value)}
            />
          </div>

          <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-3 text-sm text-emerald-900">
            <p className="font-semibold">We keep your card information secure and encrypted.</p>
            <p className="mt-1 text-xs text-emerald-800">Your card’s security code (CVV/CVC) will not be stored. You can remove your card at any time.</p>
          </div>

          <p className="text-xs text-slate-500">
            To verify that your card is valid, a temporary charge might be made (demo). It will be refunded immediately once your card is verified.
          </p>

          <button
            className="w-full rounded-xl bg-indigo-600 px-4 py-3 text-sm font-semibold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-slate-300"
            disabled={saving}
            onClick={submit}
          >
            {saving ? 'Saving…' : 'Done'}
          </button>
        </div>
      </div>
    </CustomerLayout>
  );
}

