import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import CustomerLayout from './CustomerLayout';
import { deletePatient, listPatients, savePatient, setDefaultPatient, type Patient } from '../services/patientService';

export default function PatientsPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const returnTo = params.get('returnTo');

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [settingDefaultId, setSettingDefaultId] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const [patients, setPatients] = useState<Patient[]>([]);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [showForm, setShowForm] = useState(false);

  const [fullName, setFullName] = useState('');
  const [age, setAge] = useState('');
  const [gender, setGender] = useState('unknown');
  const [allergy, setAllergy] = useState('');
  const [makeDefault, setMakeDefault] = useState(true);

  const defaultPatientId = useMemo(() => patients.find((p) => p.is_default)?.id ?? null, [patients]);

  async function reload() {
    const rows = await listPatients();
    setPatients(rows);
  }

  useEffect(() => {
    listPatients()
      .then((rows) => {
        setPatients(rows);
        setError('');
      })
      .catch((e: any) => setError(e?.message || 'Could not load patients.'))
      .finally(() => setLoading(false));
  }, []);

  function resetForm() {
    setEditingId(null);
    setFullName('');
    setAge('');
    setGender('unknown');
    setAllergy('');
    setMakeDefault(true);
    setShowForm(false);
  }

  function startEdit(p: Patient) {
    setEditingId(p.id);
    setFullName(p.full_name);
    setAge(p.age === null || p.age === undefined ? '' : String(p.age));
    setGender((p.gender || 'unknown').toLowerCase());
    setAllergy(String(p.allergy || ''));
    setMakeDefault(Boolean(p.is_default));
    setShowForm(true);
    setMessage('');
    setError('');
  }

  async function chooseDefault(id: number) {
    try {
      setSettingDefaultId(id);
      setError('');
      setMessage('');
      await setDefaultPatient(id);
      await reload();
      if (returnTo) {
        navigate(returnTo, { replace: true });
        return;
      }
      setMessage('Default patient updated.');
    } catch (e: any) {
      setError(e?.message || 'Could not set default patient.');
    } finally {
      setSettingDefaultId(null);
    }
  }

  async function remove(id: number) {
    try {
      setDeletingId(id);
      setError('');
      setMessage('');
      await deletePatient(id);
      await reload();
      if (editingId === id) resetForm();
      setMessage('Patient deleted.');
    } catch (e: any) {
      setError(e?.message || 'Could not delete patient.');
    } finally {
      setDeletingId(null);
    }
  }

  async function save() {
    try {
      setSaving(true);
      setError('');
      setMessage('');

      const saved = await savePatient({
        id: editingId ?? undefined,
        full_name: fullName.trim(),
        age: age.trim() ? Number(age.trim()) : null,
        gender: gender === 'unknown' ? null : gender,
        allergy: allergy.trim() || null,
        make_default: false,
      } as any);

      if (makeDefault || patients.length === 0 || defaultPatientId === null) {
        await setDefaultPatient(saved.id);
      }

      await reload();
      resetForm();
      if (returnTo) {
        navigate(returnTo, { replace: true });
        return;
      }
      setMessage('Saved.');
    } catch (e: any) {
      setError(e?.message || 'Could not save patient.');
    } finally {
      setSaving(false);
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
          <h2 className="text-xl font-bold text-slate-900">Patients</h2>
        </div>
      </div>

      {loading && (
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-500 shadow-sm">
          Loading patients...
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
            onClick={() => {
              resetForm();
              setShowForm(true);
            }}
          >
            <span className="text-xl">＋</span>
            <span className="font-medium text-slate-800">Add patient</span>
            <span className="ml-auto text-slate-400">›</span>
          </button>

          {patients.map((p) => (
            <div key={p.id} className="border-b border-slate-100 px-4 py-4">
              <div className="flex items-start justify-between gap-3">
                <button className="min-w-0 flex-1 text-left" onClick={() => chooseDefault(p.id)} disabled={settingDefaultId === p.id}>
                  <p className="text-sm font-semibold text-slate-900">
                    {p.full_name} {p.age !== null && p.age !== undefined ? `(${p.age})` : ''}
                  </p>
                  <p className="mt-1 break-words text-sm text-slate-700">
                    {p.gender ? `Gender: ${p.gender}` : 'Gender: —'}{p.allergy ? ` • Allergy: ${p.allergy}` : ''}
                  </p>
                  {p.is_default && (
                    <span className="mt-2 inline-block rounded bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">
                      Default
                    </span>
                  )}
                </button>

                <div className="flex items-center gap-2">
                  <button className="text-sm font-medium text-indigo-600 hover:underline" onClick={() => startEdit(p)}>
                    Edit
                  </button>
                  <button
                    className="text-sm font-medium text-rose-600 hover:underline disabled:opacity-60"
                    onClick={() => remove(p.id)}
                    disabled={deletingId === p.id}
                  >
                    {deletingId === p.id ? 'Deleting…' : 'Delete'}
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
            <h3 className="text-base font-semibold text-slate-800">{editingId ? 'Edit patient' : 'Add patient'}</h3>
            <button className="rounded px-2 py-1 text-slate-500 hover:bg-slate-100" onClick={resetForm} aria-label="Close">
              ✕
            </button>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <input className="w-full rounded-lg border px-3 py-2 text-sm" placeholder="Patient name" value={fullName} onChange={(e) => setFullName(e.target.value)} />
            <input className="w-full rounded-lg border px-3 py-2 text-sm" placeholder="Age" value={age} onChange={(e) => setAge(e.target.value)} />
            <select className="w-full rounded-lg border px-3 py-2 text-sm" value={gender} onChange={(e) => setGender(e.target.value)}>
              <option value="unknown">Gender (optional)</option>
              <option value="male">Male</option>
              <option value="female">Female</option>
              <option value="other">Other</option>
            </select>
            <input className="w-full rounded-lg border px-3 py-2 text-sm" placeholder="Allergy (optional)" value={allergy} onChange={(e) => setAllergy(e.target.value)} />
          </div>

          <label className="mt-3 flex items-center gap-2 text-xs text-slate-600">
            <input type="checkbox" checked={makeDefault || patients.length === 0 || defaultPatientId === null} onChange={(e) => setMakeDefault(e.target.checked)} />
            Set as default
          </label>

          <div className="mt-4">
            <button
              className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-slate-300"
              disabled={saving}
              onClick={save}
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      )}
    </CustomerLayout>
  );
}

