import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import OwnerLayout from './OwnerLayout';
import { supabase } from '../services/supabaseClient';
import { advanceDelivery } from '../services/deliveryDemoService';
import {
  fetchDeliveryAddressSummariesByCustomerIds,
  oneLineDeliverySummaryFromOrder,
} from '../services/ownerFulfillmentAddressService';

type OrderRow = {
  id: number;
  status: string;
  delivery_status: string;
  total_price: number;
  customer_id: string | null;
  /** Display: users.full_name, else email, else — */
  customerLabel: string | null;
  /** Order snapshot at checkout, else one line from customer_addresses */
  customerLocation: string | null;
  tracking_id: string | null;
  courier_provider: string | null;
  created_at: string | null;
  payment_method?: string | null;
  delivery_name?: string | null;
  delivery_phone?: string | null;
  delivery_address?: unknown;
};

function labelFromUser(u: { full_name?: string | null; email?: string | null }): string {
  const name = u.full_name?.trim();
  if (name) return name;
  const em = u.email?.trim();
  if (em) return em;
  return '';
}

export default function FulfillmentPage() {
  const navigate = useNavigate();
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [autoSim, setAutoSim] = useState(false);

  async function loadOrders() {
    const res = await supabase
      .from('orders')
      .select(
        'id,status,payment_method,delivery_status,total_price,customer_id,tracking_id,courier_provider,created_at,delivery_name,delivery_phone,delivery_address',
      )
      .order('id', { ascending: false })
      .limit(5000);
    if (res.error) throw res.error;
    const raw = (res.data ?? []) as Omit<OrderRow, 'customerLabel' | 'customerLocation'>[];
    const ids = [...new Set(raw.map((r) => r.customer_id).filter(Boolean))] as string[];
    let nameById = new Map<string, string>();
    let locationById = new Map<string, string>();
    if (ids.length > 0) {
      const [ur, locMap] = await Promise.all([
        supabase.from('users').select('id, full_name, email').in('id', ids),
        fetchDeliveryAddressSummariesByCustomerIds(ids),
      ]);
      if (!ur.error && ur.data) {
        nameById = new Map(
          (ur.data as { id: string; full_name?: string | null; email?: string | null }[]).map((u) => {
            const label = labelFromUser(u);
            return [u.id, label || 'Customer'] as const;
          }),
        );
      }
      locationById = locMap;
    }
    setOrders(
      raw.map((r) => ({
        ...r,
        customerLabel: r.customer_id ? nameById.get(r.customer_id) ?? null : null,
        customerLocation:
          oneLineDeliverySummaryFromOrder(r) ?? (r.customer_id ? locationById.get(r.customer_id) ?? null : null),
      })),
    );
  }

  useEffect(() => {
    setLoading(true);
    loadOrders()
      .then(() => setError(''))
      .catch((e: unknown) => {
        const msg = String(e instanceof Error ? e.message : e);
        if (msg.includes('column') && msg.includes('delivery_status')) {
          setError('Your Supabase database is missing delivery columns. Run the delivery SQL (schema) first, then refresh.');
          return;
        }
        if (msg.includes('permission') || msg.includes('RLS')) {
          setError('Supabase blocked reading orders (RLS). Make sure your owner account has role=owner in public.users, then refresh.');
          return;
        }
        setError(msg || 'Failed to load orders');
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const channel = supabase
      .channel('owner-fulfillment-list')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, () => {
        void loadOrders();
      })
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, []);

  useEffect(() => {
    if (!autoSim) return;
    const t = window.setInterval(() => {
      const candidates = orders.filter((o) =>
        ['packed', 'out_for_delivery', 'in_transit', 'pending'].includes(String(o.delivery_status || 'pending')),
      );
      const pick = candidates[Math.floor(Math.random() * Math.max(1, candidates.length))];
      if (pick?.id) {
        void advanceDelivery(pick.id).catch(() => {});
      }
    }, 5000);
    return () => window.clearInterval(t);
  }, [autoSim, orders]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return orders.filter((o) => {
      const matchText =
        !q ||
        String(o.id).includes(q) ||
        String(o.customer_id || '').toLowerCase().includes(q) ||
        String(o.customerLabel || '').toLowerCase().includes(q) ||
        String(o.customerLocation || '').toLowerCase().includes(q) ||
        String(o.tracking_id || '').toLowerCase().includes(q);

      const matchStatus =
        statusFilter === 'all' ||
        (statusFilter === 'paid'
          ? String(o.status) === 'paid' || String(o.payment_method) === 'cod'
          : String(o.delivery_status) === statusFilter);

      return matchText && matchStatus;
    });
  }, [orders, query, statusFilter]);

  function badge(status: string, paymentMethod?: string | null) {
    const pm = String(paymentMethod || '').toLowerCase();
    if (pm === 'cod') {
      return <span className="rounded-full bg-amber-100 px-2 py-1 text-xs font-semibold text-amber-800">COD</span>;
    }

    const s = String(status || 'pending');
    const cls =
      s === 'delivered'
        ? 'bg-emerald-100 text-emerald-700'
        : s === 'in_transit'
          ? 'bg-blue-100 text-blue-700'
          : s === 'out_for_delivery'
            ? 'bg-indigo-100 text-indigo-700'
            : s === 'packed'
              ? 'bg-amber-100 text-amber-700'
              : 'bg-slate-100 text-slate-700';
    return <span className={`rounded-full px-2 py-1 text-xs font-semibold ${cls}`}>{s.replaceAll('_', ' ')}</span>;
  }

  return (
    <OwnerLayout title="Delivery Management (Demo)">
      {error && <div className="mb-4 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-950/40 dark:text-rose-200">{error}</div>}

      <div className="mb-4 grid gap-2 md:grid-cols-3">
        <input
          className="rounded border px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
          placeholder="Search order / name / address / tracking"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select
          className="rounded border px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
        >
          <option value="paid">Paid orders (order.status)</option>
          <option value="all">All</option>
          <option value="pending">Delivery: pending</option>
          <option value="packed">Delivery: packed</option>
          <option value="out_for_delivery">Delivery: out for delivery</option>
          <option value="in_transit">Delivery: in transit</option>
          <option value="delivered">Delivery: delivered</option>
        </select>
        <label className="flex items-center gap-2 rounded border px-3 py-2 text-sm dark:border-slate-600">
          <input type="checkbox" checked={autoSim} onChange={(e) => setAutoSim(e.target.checked)} />
          Auto-simulate status every 5s
        </label>
      </div>

      <p className="mb-3 text-xs text-slate-500 md:hidden dark:text-slate-400">
        Tap <strong className="text-slate-700 dark:text-slate-200">anywhere on a row</strong> to open that order&apos;s delivery page.
      </p>

      {loading ? (
        <div className="text-sm text-slate-500">Loading...</div>
      ) : (
        <div className="overflow-hidden rounded-xl border dark:border-slate-600">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b bg-slate-50 text-left dark:border-slate-600 dark:bg-slate-800/80">
                <th className="px-3 py-2">Order</th>
                <th className="px-3 py-2">Customer</th>
                <th className="hidden px-3 py-2 lg:table-cell">Address</th>
                <th className="px-3 py-2">Paid</th>
                <th className="px-3 py-2">Delivery</th>
                <th className="px-3 py-2">Tracking</th>
                <th className="px-3 py-2">Total</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((o) => (
                <tr
                  key={o.id}
                  role="button"
                  tabIndex={0}
                  aria-label={`Open delivery for order ${o.id}`}
                  onClick={() => navigate(`/owner/fulfillment/${o.id}`)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      navigate(`/owner/fulfillment/${o.id}`);
                    }
                  }}
                  className="cursor-pointer border-b transition-colors hover:bg-slate-50 active:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800/80 dark:active:bg-slate-800 touch-manipulation select-none"
                >
                  <td className="min-h-[52px] px-3 py-3 align-top">
                    <span className="text-base font-semibold text-indigo-700 dark:text-indigo-300">#{o.id}</span>
                    <div className="text-xs text-slate-500 dark:text-slate-400">
                      {o.created_at ? new Date(o.created_at).toLocaleString() : ''}
                    </div>
                  </td>
                  <td className="min-h-[52px] max-w-[10rem] px-3 py-3 align-middle text-sm text-slate-800 dark:text-slate-200">
                    <span className="line-clamp-2" title={o.customerLabel || undefined}>
                      {o.customerLabel || '—'}
                    </span>
                  </td>
                  <td className="hidden max-w-[14rem] px-3 py-3 align-middle text-xs text-slate-600 lg:table-cell dark:text-slate-300">
                    <span className="line-clamp-3" title={o.customerLocation || undefined}>
                      {o.customerLocation || '—'}
                    </span>
                  </td>
                  <td className="min-h-[52px] px-3 py-3 align-middle">{badge(o.status, o.payment_method)}</td>
                  <td className="min-h-[52px] px-3 py-3 align-middle">{badge(o.delivery_status)}</td>
                  <td className="min-h-[52px] px-3 py-3 align-middle text-xs">{o.tracking_id || '-'}</td>
                  <td className="min-h-[52px] px-3 py-3 align-middle font-medium">฿{Number(o.total_price || 0).toFixed(2)}</td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td className="px-3 py-4 text-slate-500" colSpan={7}>
                    No matching orders.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </OwnerLayout>
  );
}
