import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import CustomerLayout from './CustomerLayout';
import { deleteAddress, listAddresses, saveAddress, setDefaultAddress, type SavedAddress } from '../services/addressService';

export default function AddressPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const returnTo = params.get('returnTo');

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [settingDefaultId, setSettingDefaultId] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const [addresses, setAddresses] = useState<SavedAddress[]>([]);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [label, setLabel] = useState('Home');
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [addressLine1, setAddressLine1] = useState('');
  const [addressLine2, setAddressLine2] = useState('');
  const [makeDefault, setMakeDefault] = useState(true);
  const [showForm, setShowForm] = useState(false);

  const defaultAddressId = useMemo(() => addresses.find((a) => a.is_default)?.id ?? null, [addresses]);

  useEffect(() => {
    listAddresses()
      .then((rows) => {
        setAddresses(rows);
        setError('');
      })
      .catch((e: any) => setError(e?.message || 'Could not load saved addresses.'))
      .finally(() => setLoading(false));
  }, []);

  function resetForm() {
    setEditingId(null);
    setLabel('Home');
    setFullName('');
    setPhone('');
    setAddressLine1('');
    setAddressLine2('');
    setMakeDefault(true);
    setShowForm(false);
  }

  function startEdit(addr: SavedAddress) {
    setEditingId(addr.id);
    setLabel(addr.label || 'Home');
    setFullName(String(addr.full_name || ''));
    setPhone(String(addr.phone || ''));
    setAddressLine1(String(addr.address_line1 || ''));
    setAddressLine2(String(addr.address_line2 || ''));
    setMakeDefault(Boolean(addr.is_default));
    setMessage('');
    setError('');
    setShowForm(true);
  }

  async function reload() {
    const rows = await listAddresses();
    setAddresses(rows);
  }

  async function save() {
    try {
      setSaving(true);
      setError('');
      setMessage('');

      if (!addressLine1.trim()) throw new Error('Address line 1 is required.');

      const saved = await saveAddress({
        id: editingId ?? undefined,
        label: label.trim() || 'Home',
        full_name: fullName.trim() || null,
        phone: phone.trim() || null,
        address_line1: addressLine1.trim(),
        address_line2: addressLine2.trim() || null,
        // Avoid unique constraint violations (only one default per customer).
        // We set default in a separate call below.
        is_default: false,
      });

      if (makeDefault) {
        await setDefaultAddress(saved.id);
      }

      await reload();
      resetForm();
      setMessage('Saved. Your default address will be used automatically at checkout.');
      if (returnTo) {
        navigate(returnTo, { replace: true });
      }
    } catch (e: any) {
      setError(e?.message || 'Could not save address.');
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: number) {
    try {
      setDeletingId(id);
      setError('');
      setMessage('');
      await deleteAddress(id);
      await reload();
      if (editingId === id) resetForm();
      setMessage('Address deleted.');
    } catch (e: any) {
      setError(e?.message || 'Could not delete address.');
    } finally {
      setDeletingId(null);
    }
  }

  async function makeDefaultNow(id: number) {
    try {
      setSettingDefaultId(id);
      setError('');
      setMessage('');
      await setDefaultAddress(id);
      await reload();
      setMessage('Default address updated.');
      if (returnTo) {
        navigate(returnTo, { replace: true });
      }
    } catch (e: any) {
      setError(e?.message || 'Could not set default address.');
    } finally {
      setSettingDefaultId(null);
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
          <h2 className="text-xl font-bold text-slate-900">Your addresses</h2>
        </div>
      </div>

      {loading && (
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-500 shadow-sm">
          Loading address...
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
          <button
            className="flex w-full items-center gap-3 border-b border-slate-200 px-4 py-4 text-left hover:bg-slate-50"
            onClick={() => { resetForm(); setShowForm(true); }}
          >
            <span className="text-xl">＋</span>
            <span className="font-medium text-slate-800">Add address</span>
            <span className="ml-auto text-slate-400">›</span>
          </button>

          {addresses.map((addr) => (
            <div key={addr.id} className="border-b border-slate-100 px-4 py-4">
              <div className="flex items-start justify-between gap-3">
                <button
                  className="min-w-0 flex-1 text-left"
                  onClick={() => makeDefaultNow(addr.id)}
                  disabled={settingDefaultId === addr.id}
                >
                  <p className="text-sm font-semibold text-slate-900">
                    {addr.full_name || addr.label || 'Address'}{addr.phone ? `  ${addr.phone}` : ''}
                  </p>
                  <p className="mt-1 break-words text-sm text-slate-700">{addr.address_line1}</p>
                  {addr.address_line2 && <p className="break-words text-sm text-slate-500">{addr.address_line2}</p>}
                  {addr.is_default && (
                    <span className="mt-2 inline-block rounded bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">
                      Default
                    </span>
                  )}
                </button>

                <div className="flex items-center gap-2">
                  <button className="text-sm font-medium text-indigo-600 hover:underline" onClick={() => startEdit(addr)}>
                    Edit
                  </button>
                  <button
                    className="text-sm font-medium text-rose-600 hover:underline disabled:opacity-60"
                    onClick={() => remove(addr.id)}
                    disabled={deletingId === addr.id}
                  >
                    {deletingId === addr.id ? 'Deleting…' : 'Delete'}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {!loading && showForm && (
        <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-base font-semibold text-slate-800">{editingId ? 'Edit address' : 'Add address'}</h3>
            <button className="rounded px-2 py-1 text-slate-500 hover:bg-slate-100" onClick={resetForm} aria-label="Close">
              ✕
            </button>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <input className="w-full rounded-lg border px-3 py-2 text-sm" placeholder="Label (Home, Work, etc.)" value={label} onChange={(e) => setLabel(e.target.value)} />
            <div />
            <input className="w-full rounded-lg border px-3 py-2 text-sm" placeholder="Full name" value={fullName} onChange={(e) => setFullName(e.target.value)} />
            <input className="w-full rounded-lg border px-3 py-2 text-sm" placeholder="Phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
            <input className="w-full rounded-lg border px-3 py-2 text-sm sm:col-span-2" placeholder="Address line 1" value={addressLine1} onChange={(e) => setAddressLine1(e.target.value)} />
            <input className="w-full rounded-lg border px-3 py-2 text-sm sm:col-span-2" placeholder="Address line 2 (optional)" value={addressLine2} onChange={(e) => setAddressLine2(e.target.value)} />
          </div>

          <label className="mt-3 flex items-center gap-2 text-xs text-slate-600">
            <input type="checkbox" checked={makeDefault || addresses.length === 0 || defaultAddressId === null} onChange={(e) => setMakeDefault(e.target.checked)} />
            Set as default
          </label>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button
              className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-slate-300"
              disabled={saving}
              onClick={save}
            >
              {saving ? 'Saving…' : editingId ? 'Save changes' : 'Save'}
            </button>
          </div>
        </div>
      )}
    </CustomerLayout>
  );
}

