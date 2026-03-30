import { useEffect, useMemo, useState } from 'react';
import OwnerLayout from './OwnerLayout';
import { supabase } from '../services/supabaseClient';
import { listOwnerRefundRequests, ownerResolveRefundRequest, type RefundRequest, type RefundStatus } from '../services/refundService';

export default function RefundRequestsPage() {
  const [rows, setRows] = useState<RefundRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<RefundStatus | 'all'>('pending');
  const [busyId, setBusyId] = useState<number | null>(null);

  async function load() {
    const res = await listOwnerRefundRequests(filter);
    setRows(res);
  }

  useEffect(() => {
    setLoading(true);
    load()
      .then(() => setError(''))
      .catch((e: any) => setError(e?.message || 'Could not load refunds'))
      .finally(() => setLoading(false));
  }, [filter]);

  useEffect(() => {
    const channel = supabase
      .channel('owner-refunds')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'order_refund_requests' }, () => {
        void load();
      })
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [filter]);

  const grouped = useMemo(() => rows, [rows]);

  async function resolve(id: number, next: RefundStatus) {
    try {
      setBusyId(id);
      setError('');
      await ownerResolveRefundRequest(id, next, next === 'approved' ? 'Approved (demo).' : 'Rejected (demo).');
      await load();
    } catch (e: any) {
      setError(e?.message || 'Failed to update');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <OwnerLayout title="Refund Requests (Demo)">
      {error && <div className="mb-4 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>}

      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Owner</p>
          <p className="text-sm text-slate-600">Approve or reject customer refund requests.</p>
        </div>
        <select className="rounded-lg border px-3 py-2 text-sm" value={filter} onChange={(e) => setFilter(e.target.value as any)}>
          <option value="pending">Pending</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
          <option value="all">All</option>
        </select>
      </div>

      {loading ? (
        <div className="text-sm text-slate-500">Loading…</div>
      ) : grouped.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-600 shadow-sm">No refund requests.</div>
      ) : (
        <div className="space-y-3">
          {grouped.map((r) => (
            <div key={r.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-slate-900">Order #{r.order_id}</p>
                  <p className="mt-1 text-xs text-slate-500">Customer: {r.customer_id}</p>
                  <p className="mt-1 text-xs text-slate-500">Requested: {new Date(r.created_at).toLocaleString()}</p>
                </div>
                <span className={`rounded-full px-2 py-1 text-xs font-semibold ${
                  r.status === 'pending' ? 'bg-amber-100 text-amber-800'
                  : r.status === 'approved' ? 'bg-emerald-100 text-emerald-800'
                  : 'bg-rose-100 text-rose-800'
                }`}>
                  {r.status}
                </span>
              </div>

              <div className="mt-3 space-y-1 text-sm">
                <p><span className="font-semibold">Reason:</span> {r.reason}</p>
                {r.note && <p className="text-slate-600">{r.note}</p>}
                {typeof r.requested_amount === 'number' && <p className="text-slate-700"><span className="font-semibold">Amount:</span> ฿{Number(r.requested_amount).toFixed(2)}</p>}
                {r.resolution_note && <p className="text-slate-700"><span className="font-semibold">Resolution:</span> {r.resolution_note}</p>}
              </div>

              {r.status === 'pending' && (
                <div className="mt-4 grid grid-cols-2 gap-2">
                  <button
                    className="rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-800 hover:bg-emerald-100 disabled:opacity-60"
                    disabled={busyId === r.id}
                    onClick={() => void resolve(r.id, 'approved')}
                  >
                    Approve
                  </button>
                  <button
                    className="rounded-xl border border-rose-300 bg-rose-50 px-4 py-2 text-sm font-semibold text-rose-800 hover:bg-rose-100 disabled:opacity-60"
                    disabled={busyId === r.id}
                    onClick={() => void resolve(r.id, 'rejected')}
                  >
                    Reject
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </OwnerLayout>
  );
}

