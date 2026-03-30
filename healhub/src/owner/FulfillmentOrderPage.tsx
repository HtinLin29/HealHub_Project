import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import OwnerLayout from './OwnerLayout';
import { supabase } from '../services/supabaseClient';
import { advanceDelivery, assignFakeCourier, listDeliveryEvents, markDelivered, markInTransit, markPacked } from '../services/deliveryDemoService';
import { cancelOrder } from '../services/orderCancelService';
import {
  deliveryDisplayFromOrderSnapshot,
  fetchCustomerDeliveryAddress,
  type DeliveryAddressDisplay,
} from '../services/ownerFulfillmentAddressService';

type OrderRow = {
  id: number;
  status: string;
  delivery_status: string;
  total_price: number;
  customer_id: string | null;
  tracking_id: string | null;
  courier_provider: string | null;
  created_at: string | null;
  payment_method?: string | null;
  delivery_name?: string | null;
  delivery_phone?: string | null;
  delivery_address?: unknown;
};

type PackLineItem = {
  id: number;
  quantity: number;
  unit_price: number;
  line_total: number | null;
  productName: string;
};

/** Resolved from public.users via orders.customer_id */
type CustomerAccount = {
  fullName: string | null;
  email: string | null;
};

function formatCustomerDisplay(account: CustomerAccount | null, customerId: string | null): { title: string; subtitle: string | null } {
  if (!customerId) return { title: '—', subtitle: null };
  if (!account) return { title: 'Customer', subtitle: customerId };
  const name = account.fullName?.trim();
  if (name) return { title: name, subtitle: account.email ?? null };
  if (account.email?.trim()) return { title: account.email.trim(), subtitle: null };
  return { title: 'Customer', subtitle: customerId };
}

function badge(status: string, paymentMethod?: string | null) {
  const pm = String(paymentMethod || '').toLowerCase();
  if (pm === 'cod') {
    return <span className="rounded-full bg-amber-100 px-2 py-1 text-xs font-semibold text-amber-800 dark:bg-amber-900/40 dark:text-amber-100">COD</span>;
  }

  const s = String(status || 'pending');
  const cls =
    s === 'delivered'
      ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-200'
      : s === 'in_transit'
        ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-200'
        : s === 'out_for_delivery'
          ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-200'
          : s === 'packed'
            ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-200'
            : 'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-200';
  return (
    <span className={`rounded-full px-2 py-1 text-xs font-semibold ${cls}`}>{s.replaceAll('_', ' ')}</span>
  );
}

export default function FulfillmentOrderPage() {
  const { orderId: orderIdParam } = useParams<{ orderId: string }>();
  const navigate = useNavigate();
  const orderId = Number(orderIdParam);

  const [order, setOrder] = useState<OrderRow | null>(null);
  const [customerAccount, setCustomerAccount] = useState<CustomerAccount | null>(null);
  const [deliveryAddress, setDeliveryAddress] = useState<DeliveryAddressDisplay | null>(null);
  const [lineItems, setLineItems] = useState<PackLineItem[]>([]);
  const [events, setEvents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const validId = useMemo(() => Number.isFinite(orderId) && orderId > 0, [orderId]);

  async function loadOrder() {
    if (!validId) return;
    const res = await supabase
      .from('orders')
      .select(
        'id,status,payment_method,delivery_status,total_price,customer_id,tracking_id,courier_provider,created_at,delivery_name,delivery_phone,delivery_address',
      )
      .eq('id', orderId)
      .maybeSingle();
    if (res.error) throw res.error;
    const row = (res.data as OrderRow) || null;
    setOrder(row);

    if (row?.customer_id) {
      const cid = row.customer_id;
      const fromOrder = deliveryDisplayFromOrderSnapshot(row);
      const [ur, addrFallback] = await Promise.all([
        supabase.from('users').select('full_name, email').eq('id', cid).maybeSingle(),
        fromOrder ? Promise.resolve(null) : fetchCustomerDeliveryAddress(cid),
      ]);
      if (!ur.error && ur.data) {
        const u = ur.data as { full_name?: string | null; email?: string | null };
        setCustomerAccount({
          fullName: u.full_name ?? null,
          email: u.email ?? null,
        });
      } else {
        setCustomerAccount(null);
      }
      setDeliveryAddress(fromOrder ?? addrFallback);
    } else {
      setCustomerAccount(null);
      setDeliveryAddress(null);
    }
  }

  async function loadLineItems() {
    if (!validId) return;
    const res = await supabase
      .from('order_items')
      .select('id, quantity, unit_price, line_total, products(name)')
      .eq('order_id', orderId)
      .order('id', { ascending: true });
    if (res.error) throw res.error;
    const rows = (res.data ?? []) as {
      id?: unknown;
      quantity?: unknown;
      unit_price?: unknown;
      line_total?: unknown;
      products?: { name?: string | null } | null;
    }[];
    setLineItems(
      rows.map((r) => ({
        id: Number(r.id),
        quantity: Number(r.quantity ?? 0),
        unit_price: Number(r.unit_price ?? 0),
        line_total: r.line_total != null && r.line_total !== '' ? Number(r.line_total) : null,
        productName: String(r.products?.name ?? 'Product').trim() || 'Product',
      })),
    );
  }

  async function loadEvents() {
    if (!validId) return;
    const rows = await listDeliveryEvents(orderId);
    setEvents(rows);
  }

  useEffect(() => {
    if (!validId) {
      setLoading(false);
      setError('Invalid order.');
      return;
    }
    setLoading(true);
    Promise.all([loadOrder(), loadLineItems(), loadEvents()])
      .then(() => setError(''))
      .catch((e: unknown) => {
        const msg = e instanceof Error ? e.message : String(e);
        setError(msg || 'Failed to load order');
      })
      .finally(() => setLoading(false));
  }, [validId, orderId]);

  useEffect(() => {
    if (!validId) return;
    const channel = supabase
      .channel(`owner-fulfillment-order-${orderId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders', filter: `id=eq.${orderId}` }, () => {
        void loadOrder();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'order_items', filter: `order_id=eq.${orderId}` }, () => {
        void loadLineItems();
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'order_delivery_events' }, (payload) => {
        const oid = Number((payload.new as { order_id?: unknown })?.order_id);
        if (oid === orderId) void loadEvents();
      })
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [validId, orderId]);

  async function run(action: () => Promise<void>) {
    try {
      setError('');
      await action();
      await loadOrder();
      await loadLineItems();
      await loadEvents();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Action failed');
    }
  }

  if (!validId) {
    return (
      <OwnerLayout title="Delivery">
        <p className="text-sm text-rose-600">Invalid order link.</p>
        <Link to="/owner/fulfillment" className="mt-4 inline-block text-indigo-600 underline">
          Back to delivery list
        </Link>
      </OwnerLayout>
    );
  }

  return (
    <OwnerLayout title={`Order #${orderId} · Delivery`}>
      <div className="mb-4">
        <button
          type="button"
          onClick={() => navigate('/owner/fulfillment')}
          className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-800 shadow-sm hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
        >
          ← All orders
        </button>
      </div>

      {error ? <div className="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800 dark:border-rose-900/50 dark:bg-rose-950/40 dark:text-rose-200">{error}</div> : null}

      {loading ? (
        <p className="text-sm text-slate-500">Loading order…</p>
      ) : !order ? (
        <div className="rounded-xl border border-dashed border-slate-300 p-6 text-center dark:border-slate-600">
          <p className="text-slate-600 dark:text-slate-300">Order #{orderId} was not found.</p>
          <Link to="/owner/fulfillment" className="mt-3 inline-block font-semibold text-indigo-600 hover:underline dark:text-indigo-400">
            Back to delivery list
          </Link>
        </div>
      ) : (
        <div className="mx-auto max-w-lg space-y-6">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-600 dark:bg-slate-800/80">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">Order</p>
                <h2 className="text-xl font-bold text-slate-900 dark:text-white">#{order.id}</h2>
                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                  {order.created_at ? new Date(order.created_at).toLocaleString() : '—'}
                </p>
              </div>
              <div className="flex flex-col items-end gap-2">
                {badge(order.delivery_status)}
                <span className="text-lg font-semibold text-slate-900 dark:text-white">฿{Number(order.total_price || 0).toFixed(2)}</span>
              </div>
            </div>
            <div className="mt-4 space-y-1 border-t border-slate-100 pt-4 text-sm dark:border-slate-600">
              <p>
                <span className="text-slate-500 dark:text-slate-400">Payment: </span>
                {badge(order.status, order.payment_method)}
              </p>
              <div className="text-slate-700 dark:text-slate-200">
                <span className="text-slate-500 dark:text-slate-400">Customer: </span>
                {(() => {
                  const { title, subtitle } = formatCustomerDisplay(customerAccount, order.customer_id);
                  return (
                    <span className="inline-block align-top">
                      <span className="font-medium text-slate-900 dark:text-white">{title}</span>
                      {subtitle ? (
                        <span className="mt-0.5 block text-xs font-normal text-slate-500 dark:text-slate-400">{subtitle}</span>
                      ) : null}
                    </span>
                  );
                })()}
              </div>
              <div className="text-slate-700 dark:text-slate-200">
                <span className="text-slate-500 dark:text-slate-400">Delivery location: </span>
                {deliveryAddress ? (
                  <span className="mt-1 block rounded-lg bg-slate-50 px-3 py-2 text-slate-800 dark:bg-slate-900/50 dark:text-slate-100">
                    <span className="text-xs text-slate-500 dark:text-slate-400">{deliveryAddress.label}</span>
                    {deliveryAddress.contactName ? (
                      <span className="mt-1 block font-medium text-slate-900 dark:text-white">{deliveryAddress.contactName}</span>
                    ) : null}
                    {deliveryAddress.phone ? (
                      <span className="mt-0.5 block text-sm text-slate-600 dark:text-slate-300">{deliveryAddress.phone}</span>
                    ) : null}
                    <span className="mt-1 block whitespace-pre-line">{deliveryAddress.line1}</span>
                    {deliveryAddress.line2 ? (
                      <span className="mt-0.5 block whitespace-pre-line text-slate-600 dark:text-slate-300">{deliveryAddress.line2}</span>
                    ) : null}
                    {deliveryAddress.checkoutNote ? (
                      <span className="mt-2 block rounded border border-slate-200 bg-white/80 px-2 py-1.5 text-xs text-slate-600 dark:border-slate-600 dark:bg-slate-900/40 dark:text-slate-300">
                        <span className="font-medium text-slate-500 dark:text-slate-400">Order note: </span>
                        {deliveryAddress.checkoutNote}
                      </span>
                    ) : null}
                  </span>
                ) : (
                  <span className="mt-0.5 block text-slate-500 dark:text-slate-400">No saved address for this customer.</span>
                )}
              </div>
              <p className="text-slate-700 dark:text-slate-200">
                <span className="text-slate-500 dark:text-slate-400">Courier: </span>
                {order.courier_provider || '—'}
              </p>
              <p className="text-slate-700 dark:text-slate-200">
                <span className="text-slate-500 dark:text-slate-400">Tracking: </span>
                {order.tracking_id || '—'}
              </p>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-600 dark:bg-slate-800/80">
            <h3 className="mb-1 text-sm font-semibold text-slate-800 dark:text-slate-100">Items to pack</h3>
            <p className="mb-3 text-xs text-slate-500 dark:text-slate-400">Verify products and quantities before marking packed.</p>
            {lineItems.length === 0 ? (
              <p className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-3 py-4 text-center text-sm text-slate-600 dark:border-slate-600 dark:bg-slate-900/40 dark:text-slate-400">
                No line items for this order. If this is an older order, items may not have been stored.
              </p>
            ) : (
              <ul className="divide-y divide-slate-100 dark:divide-slate-600">
                {lineItems.map((item) => {
                  const line = item.line_total != null ? item.line_total : item.quantity * item.unit_price;
                  return (
                    <li key={item.id} className="flex flex-wrap items-start justify-between gap-2 py-3 first:pt-0">
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-slate-900 dark:text-white">{item.productName}</p>
                        <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                          ฿{item.unit_price.toFixed(2)} × {item.quantity}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-semibold tabular-nums text-slate-800 dark:text-slate-100">฿{line.toFixed(2)}</p>
                        <p className="text-xs font-medium text-slate-600 dark:text-slate-300">Qty {item.quantity}</p>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-600 dark:bg-slate-800/80">
            <h3 className="mb-3 text-sm font-semibold text-slate-800 dark:text-slate-100">Actions</h3>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <button
                type="button"
                className="min-h-[48px] rounded-xl border border-slate-300 px-4 py-3 text-sm font-medium hover:bg-slate-50 dark:border-slate-600 dark:hover:bg-slate-700"
                onClick={() => run(() => markPacked(order.id))}
              >
                Mark Packed
              </button>
              <button
                type="button"
                className="min-h-[48px] rounded-xl border border-slate-300 px-4 py-3 text-sm font-medium hover:bg-slate-50 dark:border-slate-600 dark:hover:bg-slate-700"
                onClick={() => run(() => assignFakeCourier(order.id))}
              >
                Assign Fake Courier
              </button>
              <button
                type="button"
                className="min-h-[48px] rounded-xl border border-slate-300 px-4 py-3 text-sm font-medium hover:bg-slate-50 dark:border-slate-600 dark:hover:bg-slate-700"
                onClick={() => run(() => markInTransit(order.id))}
              >
                Mark Transit
              </button>
              <button
                type="button"
                className="min-h-[48px] rounded-xl border border-slate-300 px-4 py-3 text-sm font-medium hover:bg-slate-50 dark:border-slate-600 dark:hover:bg-slate-700"
                onClick={() => run(() => markDelivered(order.id))}
              >
                Mark Delivered
              </button>
              <button
                type="button"
                className="min-h-[48px] rounded-xl border border-rose-300 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-800 hover:bg-rose-100 dark:border-rose-800 dark:bg-rose-950/50 dark:text-rose-200"
                onClick={() => run(() => cancelOrder(order.id, 'Cancelled by owner'))}
              >
                Cancel Order
              </button>
              <Link
                to={`/orders/${order.id}/chat`}
                className="flex min-h-[48px] items-center justify-center rounded-xl border border-slate-300 bg-white px-4 py-3 text-center text-sm font-semibold text-slate-800 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-700"
              >
                💬 Chat
              </Link>
              <button
                type="button"
                className="min-h-[48px] rounded-xl bg-indigo-600 px-4 py-3 text-sm font-semibold text-white hover:bg-indigo-700 sm:col-span-2"
                onClick={() => run(() => advanceDelivery(order.id))}
              >
                Advance Status (auto)
              </button>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-600 dark:bg-slate-800/80">
            <h3 className="mb-3 text-sm font-semibold text-slate-800 dark:text-slate-100">Delivery timeline</h3>
            <div className="space-y-2">
              {events.length === 0 ? (
                <p className="text-sm text-slate-500 dark:text-slate-400">No events yet.</p>
              ) : (
                events.map((ev: { id?: number; status?: string; event_time?: string; message?: string }) => (
                  <div key={ev.id} className="rounded-xl border border-slate-100 p-3 dark:border-slate-600">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-slate-800 dark:text-slate-100">{String(ev.status || '').replaceAll('_', ' ')}</span>
                      <span className="text-xs text-slate-500 dark:text-slate-400">
                        {ev.event_time ? new Date(ev.event_time).toLocaleString() : ''}
                      </span>
                    </div>
                    {ev.message ? <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">{ev.message}</p> : null}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </OwnerLayout>
  );
}
