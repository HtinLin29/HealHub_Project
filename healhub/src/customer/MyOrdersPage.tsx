import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import CustomerLayout from './CustomerLayout';
import { supabase } from '../services/supabaseClient';
import { createProductImageFallback, resolveProductImageUrl } from '../services/productImageService';

type OrderRow = {
  id: number;
  total_price: number;
  status: string;
  delivery_status: string;
  tracking_id: string | null;
  courier_provider: string | null;
  created_at: string | null;
  total_items: number;
  first_product?: { name: string; image_url?: string | null } | null;
};

export default function MyOrdersPage() {
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<'all' | 'in_progress' | 'delivered'>('all');

  async function load() {
    const res = await supabase
      .from('orders')
      .select(
        `
          id,
          total_price,
          status,
          delivery_status,
          tracking_id,
          courier_provider,
          created_at,
          order_items:order_items (
            quantity,
            product:products (
              name,
              image_url
            )
          )
        `,
      )
      .order('id', { ascending: false })
      .limit(200);
    if (res.error) throw res.error;
    const mapped = (res.data ?? []).map((row: any) => {
      const items = Array.isArray(row.order_items) ? row.order_items : [];
      const totalItems = items.reduce((sum: number, it: any) => sum + Number(it?.quantity || 0), 0);
      const first = items.find((it: any) => it?.product)?.product ?? null;
      return {
        id: Number(row.id),
        total_price: Number(row.total_price ?? 0),
        status: String(row.status || 'pending'),
        delivery_status: String(row.delivery_status || 'pending'),
        tracking_id: row.tracking_id ?? null,
        courier_provider: row.courier_provider ?? null,
        created_at: row.created_at ?? null,
        total_items: totalItems,
        first_product: first,
      } satisfies OrderRow;
    });
    setOrders(mapped);
  }

  useEffect(() => {
    setLoading(true);
    load()
      .then(() => setError(''))
      .catch((e: any) => setError(e?.message || 'Could not load orders'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const channel = supabase
      .channel('customer-orders-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, () => {
        void load();
      })
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, []);

  const filtered = useMemo(() => {
    if (filter === 'all') return orders;
    if (filter === 'delivered') return orders.filter((o) => String(o.delivery_status) === 'delivered');
    return orders.filter((o) => String(o.delivery_status) !== 'delivered' && String(o.status) !== 'cancelled');
  }, [orders, filter]);

  function badge(status: string) {
    const s = String(status || 'pending');
    const cls =
      s === 'delivered' ? 'bg-emerald-100 text-emerald-700'
      : s === 'in_transit' ? 'bg-blue-100 text-blue-700'
      : s === 'out_for_delivery' ? 'bg-indigo-100 text-indigo-700'
      : s === 'packed' ? 'bg-amber-100 text-amber-700'
      : 'bg-slate-100 text-slate-700';
    return <span className={`rounded-full px-2 py-1 text-xs font-semibold ${cls}`}>{s.replaceAll('_', ' ')}</span>;
  }

  return (
    <CustomerLayout>
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Customer</p>
          <h2 className="text-xl font-bold text-slate-900">My Orders</h2>
        </div>
        <select className="rounded-lg border px-3 py-2 text-sm" value={filter} onChange={(e) => setFilter(e.target.value as any)}>
          <option value="all">All</option>
          <option value="in_progress">In progress</option>
          <option value="delivered">Delivered</option>
        </select>
      </div>

      {error && <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>}

      {loading ? (
        <div className="text-sm text-slate-500">Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-600 shadow-sm">
          No orders yet.
          <div className="mt-3">
            <Link className="inline-flex items-center rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700" to="/shop">
              Shop now
            </Link>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((o) => (
            <Link key={o.id} to={`/orders/${o.id}`} className="block rounded-2xl border border-slate-200 bg-white p-4 shadow-sm hover:bg-slate-50">
              <div className="flex items-start gap-3">
                <div className="h-16 w-16 flex-none overflow-hidden rounded-xl border bg-slate-100">
                  <img
                    src={o.first_product ? resolveProductImageUrl(o.first_product) : createProductImageFallback('HealHub Order')}
                    alt={o.first_product?.name || `Order ${o.id}`}
                    className="h-full w-full object-cover"
                    onError={(e) => {
                      (e.currentTarget as HTMLImageElement).src = createProductImageFallback(o.first_product?.name || 'HealHub Order');
                    }}
                  />
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-slate-900">Order #{o.id}</p>
                      <p className="mt-1 text-xs text-slate-500">{o.created_at ? new Date(o.created_at).toLocaleString() : ''}</p>
                    </div>
                    <p className="text-sm font-bold text-indigo-700">฿{Number(o.total_price || 0).toFixed(2)}</p>
                  </div>

                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    {badge(o.delivery_status)}
                    <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700">
                      {Math.max(0, Number(o.total_items || 0))} item{Number(o.total_items || 0) === 1 ? '' : 's'}
                    </span>
                    {o.tracking_id && <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700">Tracking: {o.tracking_id}</span>}
                  </div>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </CustomerLayout>
  );
}

