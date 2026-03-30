import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import OwnerLayout from './OwnerLayout';
import { useTheme } from '../context/ThemeContext';
import { supabase } from '../services/supabaseClient';

type PatientRow = {
  id: number;
  customer_id: string;
  full_name: string;
  age?: number | null;
  gender?: string | null;
  allergy?: string | null;
};

function matchesGlobalSearch(p: PatientRow, query: string): boolean {
  const raw = query.trim();
  if (!raw) return true;
  const hay = [p.full_name, p.customer_id, p.allergy, p.gender, String(p.age ?? ''), String(p.id)]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  const tokens = raw
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  return tokens.every((t) => hay.includes(t));
}

type OrderRow = {
  id: number;
  customer_id?: string | null;
  patient_id?: number | null;
  total_price?: number | null;
  created_at?: string | null;
  status?: string | null;
};

export default function CrmPage() {
  const { mode } = useTheme();
  const isDark = mode === 'dark';

  const [patients, setPatients] = useState<PatientRow[]>([]);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  /** One box: searches name, customer ID, patient ID, age, gender, allergy */
  const [searchQuery, setSearchQuery] = useState('');

  const [nameFilter, setNameFilter] = useState('');
  const [idFilter, setIdFilter] = useState('');
  const [ageFilter, setAgeFilter] = useState('');
  const [genderFilter, setGenderFilter] = useState('all');
  const [allergyFilter, setAllergyFilter] = useState('');

  useEffect(() => {
    async function load() {
      try {
        setLoading(true);
        const [patientsRes, ordersRes] = await Promise.all([
          supabase.from('customer_patients').select('id,customer_id,full_name,age,gender,allergy').limit(10000),
          supabase.from('orders').select('id,customer_id,patient_id,total_price,created_at,status').limit(20000),
        ]);

        if (patientsRes.error) throw patientsRes.error;
        if (ordersRes.error) throw ordersRes.error;

        setPatients((patientsRes.data as PatientRow[]) || []);
        setOrders((ordersRes.data as OrderRow[]) || []);
        setError('');
      } catch (e: any) {
        setError(e?.message || 'Failed to load CRM data');
      } finally {
        setLoading(false);
      }
    }

    load();
  }, []);

  const ordersByPatient = useMemo(() => {
    const map = new Map<number, OrderRow[]>();
    for (const o of orders) {
      if (!o.patient_id) continue;
      const pid = Number(o.patient_id);
      if (!pid) continue;
      if (!map.has(pid)) map.set(pid, []);
      map.get(pid)!.push(o);
    }
    return map;
  }, [orders]);

  const filteredPatients = useMemo(() => {
    return patients.filter((p) => {
      if (!matchesGlobalSearch(p, searchQuery)) return false;

      const nm = (p.full_name || '').toLowerCase();
      const al = (p.allergy || '').toLowerCase();

      const nameMatch = !nameFilter.trim() || nm.includes(nameFilter.toLowerCase());
      const idMatch = !idFilter.trim() || String(p.customer_id || '').toLowerCase().includes(idFilter.toLowerCase());
      const ageMatch = !ageFilter.trim() || String(p.age ?? '').includes(ageFilter.trim());
      const genderMatch = genderFilter === 'all' || (p.gender || '').toLowerCase() === genderFilter.toLowerCase();
      const allergyMatch = !allergyFilter.trim() || al.includes(allergyFilter.toLowerCase());

      return nameMatch && idMatch && ageMatch && genderMatch && allergyMatch;
    });
  }, [patients, searchQuery, nameFilter, idFilter, ageFilter, genderFilter, allergyFilter]);

  const rows = useMemo(() => {
    return filteredPatients.map((p) => {
      const patientOrders = ordersByPatient.get(p.id) || [];
      const purchaseHistory = patientOrders.length;
      const totalSpent = patientOrders.reduce((sum, o) => sum + Number(o.total_price ?? 0), 0);
      const lastPurchaseDate = patientOrders.map((o) => o.created_at).filter(Boolean).sort().reverse()[0] || null;

      return {
        ...p,
        purchaseHistory,
        totalSpent,
        lastPurchaseDate,
      };
    });
  }, [filteredPatients, ordersByPatient]);

  const resultLabel = useMemo(() => {
    if (loading) return '';
    const n = filteredPatients.length;
    const total = patients.length;
    if (searchQuery.trim() || nameFilter || idFilter || ageFilter || allergyFilter || genderFilter !== 'all') {
      return `${n} of ${total} patients match`;
    }
    return `${total} patient${total === 1 ? '' : 's'}`;
  }, [loading, filteredPatients.length, patients.length, searchQuery, nameFilter, idFilter, ageFilter, allergyFilter, genderFilter]);

  return (
    <OwnerLayout title="CRM">
      <p className="mb-2 text-sm text-slate-600 dark:text-slate-400">
        Customer profiles and purchase history. Use <strong className="text-slate-800 dark:text-slate-200">Search</strong> to find by name, customer ID,
        patient ID, age, gender, or allergy (multiple words = all must match).
      </p>

      {error && (
        <div className="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800 dark:border-rose-900/50 dark:bg-rose-950/40 dark:text-rose-200">
          {error}
        </div>
      )}

      <section className="mb-4 space-y-2">
        <label className="sr-only" htmlFor="crm-search">
          Search patients
        </label>
        <div
          className={`flex flex-wrap items-stretch gap-2 rounded-2xl border-2 px-3 py-2 shadow-sm ${
            isDark ? 'border-indigo-500/40 bg-slate-800/80' : 'border-indigo-200 bg-white'
          }`}
        >
          <span className="flex shrink-0 items-center text-lg text-slate-400" aria-hidden>
            🔍
          </span>
          <input
            id="crm-search"
            type="search"
            autoComplete="off"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search name, customer ID, patient ID, age, gender, allergy…"
            className={`min-w-[200px] flex-1 border-0 bg-transparent py-2 text-sm outline-none ring-0 ${
              isDark ? 'text-slate-100 placeholder:text-slate-500' : 'text-slate-900 placeholder:text-slate-400'
            }`}
          />
          {searchQuery ? (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className={`shrink-0 rounded-lg px-3 py-2 text-xs font-semibold ${
                isDark ? 'text-slate-300 hover:bg-slate-700' : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              Clear
            </button>
          ) : null}
        </div>
        {resultLabel ? <p className="text-xs font-medium text-indigo-600 dark:text-indigo-400">{resultLabel}</p> : null}
      </section>

      <details className="mb-4 rounded-xl border border-slate-200 bg-slate-50/80 open:pb-3 dark:border-slate-600 dark:bg-slate-800/40">
        <summary className="cursor-pointer select-none px-3 py-2 text-sm font-semibold text-slate-700 dark:text-slate-200">
          Advanced filters (optional)
        </summary>
        <div className="grid grid-cols-2 gap-2 px-3 pb-1 pt-1 md:grid-cols-5">
          <input
            className="rounded border border-slate-200 bg-white px-2 py-2 text-sm dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
            placeholder="Name"
            value={nameFilter}
            onChange={(e) => setNameFilter(e.target.value)}
          />
          <input
            className="rounded border border-slate-200 bg-white px-2 py-2 text-sm dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
            placeholder="Customer ID"
            value={idFilter}
            onChange={(e) => setIdFilter(e.target.value)}
          />
          <input
            className="rounded border border-slate-200 bg-white px-2 py-2 text-sm dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
            placeholder="Age"
            value={ageFilter}
            onChange={(e) => setAgeFilter(e.target.value)}
          />
          <select
            className="rounded border border-slate-200 bg-white px-2 py-2 text-sm dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
            value={genderFilter}
            onChange={(e) => setGenderFilter(e.target.value)}
          >
            <option value="all">All genders</option>
            <option value="male">Male</option>
            <option value="female">Female</option>
            <option value="other">Other</option>
          </select>
          <input
            className="rounded border border-slate-200 bg-white px-2 py-2 text-sm dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
            placeholder="Allergy"
            value={allergyFilter}
            onChange={(e) => setAllergyFilter(e.target.value)}
          />
        </div>
      </details>

      {!loading && !error && (
        <section className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-3">
          <div className="rounded-xl border bg-white p-4 shadow-sm">
            <p className="text-xs uppercase tracking-wide text-slate-500">Patients</p>
            <p className="mt-1 text-2xl font-bold text-slate-800">{patients.length}</p>
          </div>
          <div className="rounded-xl border bg-white p-4 shadow-sm">
            <p className="text-xs uppercase tracking-wide text-slate-500">Linked orders</p>
            <p className="mt-1 text-2xl font-bold text-indigo-700">{orders.filter((o) => !!o.patient_id).length}</p>
          </div>
          <div className="rounded-xl border bg-white p-4 shadow-sm">
            <p className="text-xs uppercase tracking-wide text-slate-500">Pending CRM work</p>
            <p className="mt-1 text-sm text-slate-600">Ask customers to select a patient profile at checkout (age, allergy, gender).</p>
          </div>
        </section>
      )}

      <section className="overflow-x-auto rounded-xl border">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b bg-slate-50 text-left">
              <th className="px-3 py-2">Patient Name</th>
              <th className="px-3 py-2">Customer ID</th>
              <th className="px-3 py-2">Age</th>
              <th className="px-3 py-2">Gender</th>
              <th className="px-3 py-2">Allergy</th>
              <th className="px-3 py-2">Purchase History</th>
              <th className="px-3 py-2">Purchase Date</th>
              <th className="px-3 py-2">Sales</th>
              <th className="px-3 py-2">Details</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td className="px-3 py-3 text-slate-500" colSpan={9}>Loading...</td></tr>
            ) : rows.length === 0 ? (
              <tr>
                <td className="px-3 py-4 text-slate-500 dark:text-slate-400" colSpan={9}>
                  {patients.length === 0 ? (
                    <>
                      No patient profiles yet. Customers need to create patient profiles and place orders linked to{' '}
                      <span className="font-medium">patient_id</span>.
                    </>
                  ) : (
                    <>
                      No patients match your search or filters. Try clearing the search box or{' '}
                      <button
                        type="button"
                        className="font-semibold text-indigo-600 underline hover:text-indigo-800 dark:text-indigo-400"
                        onClick={() => {
                          setSearchQuery('');
                          setNameFilter('');
                          setIdFilter('');
                          setAgeFilter('');
                          setAllergyFilter('');
                          setGenderFilter('all');
                        }}
                      >
                        reset filters
                      </button>
                      .
                    </>
                  )}
                </td>
              </tr>
            ) : (
              rows.map((c) => (
                <tr key={c.id} className="border-b">
                  <td className="px-3 py-2">
                    <Link
                      to={`/owner/crm/patient/${c.id}`}
                      className="font-medium text-indigo-700 hover:underline dark:text-indigo-300"
                    >
                      {c.full_name || 'Unknown'}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-xs">{c.customer_id ? `${String(c.customer_id).slice(0, 8)}...` : '-'}</td>
                  <td className="px-3 py-2">{c.age ?? '-'}</td>
                  <td className="px-3 py-2">{c.gender || '-'}</td>
                  <td className="px-3 py-2">{c.allergy || '-'}</td>
                  <td className="px-3 py-2">{c.purchaseHistory}</td>
                  <td className="px-3 py-2 text-xs">{c.lastPurchaseDate ? new Date(c.lastPurchaseDate).toLocaleDateString() : '-'}</td>
                  <td className="px-3 py-2">${c.totalSpent.toFixed(2)}</td>
                  <td className="px-3 py-2">
                    <Link
                      to={`/owner/crm/patient/${c.id}`}
                      className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700"
                    >
                      View
                    </Link>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </section>
    </OwnerLayout>
  );
}
