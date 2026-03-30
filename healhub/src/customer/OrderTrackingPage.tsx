import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import CustomerLayout from './CustomerLayout';
import { supabase } from '../services/supabaseClient';
import type { DeliveryEvent, DeliveryStatus } from '../services/deliveryDemoService';
import { listDeliveryEvents } from '../services/deliveryDemoService';
import { createProductImageFallback, resolveProductImageUrl } from '../services/productImageService';
import { CANCEL_REASONS, cancelOrder } from '../services/orderCancelService';
import { REFUND_REASONS, createRefundRequest, fetchRefundRequestsForOrder, type RefundRequest } from '../services/refundService';

type OrderRow = {
  id: number;
  total_price: number;
  status: string;
  delivery_status: DeliveryStatus;
  courier_provider: string | null;
  tracking_id: string | null;
  tracking_url: string | null;
  created_at: string | null;
  items?: {
    id: number;
    quantity: number;
    unit_price: number;
    product: { id: number; name: string; image_url?: string | null } | null;
  }[];
};

const STEPS: { key: DeliveryStatus; label: string }[] = [
  { key: 'packed', label: 'Packed' },
  { key: 'out_for_delivery', label: 'Out for delivery' },
  { key: 'in_transit', label: 'In transit' },
  { key: 'delivered', label: 'Delivered' },
];

function idx(status: DeliveryStatus) {
  const i = STEPS.findIndex((s) => s.key === status);
  return i === -1 ? -1 : i;
}

export default function OrderTrackingPage() {
  const { orderId } = useParams();
  const id = Number(orderId);
  const navigate = useNavigate();
  const [order, setOrder] = useState<OrderRow | null>(null);
  const [events, setEvents] = useState<DeliveryEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState<string>(CANCEL_REASONS[0]);
  const [cancelNote, setCancelNote] = useState('');
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState('');
  const [refunds, setRefunds] = useState<RefundRequest[]>([]);
  const [refundOpen, setRefundOpen] = useState(false);
  const [refundReason, setRefundReason] = useState<string>(REFUND_REASONS[0]);
  const [refundNote, setRefundNote] = useState('');
  const [requestingRefund, setRequestingRefund] = useState(false);
  const [refundError, setRefundError] = useState('');

  async function loadOrder() {
    const res = await supabase
      .from('orders')
      .select(
        `
          id,
          total_price,
          status,
          delivery_status,
          courier_provider,
          tracking_id,
          tracking_url,
          created_at,
          order_items:order_items (
            id,
            quantity,
            unit_price,
            product:products (
              id,
              name,
              image_url
            )
          )
        `,
      )
      .eq('id', id)
      .single();
    if (res.error) throw res.error;
    const row: any = res.data;
    setOrder({
      id: Number(row.id),
      total_price: Number(row.total_price ?? 0),
      status: String(row.status || 'pending'),
      delivery_status: (String(row.delivery_status || 'pending') as any) satisfies DeliveryStatus,
      courier_provider: row.courier_provider ?? null,
      tracking_id: row.tracking_id ?? null,
      tracking_url: row.tracking_url ?? null,
      created_at: row.created_at ?? null,
      items: Array.isArray(row.order_items) ? row.order_items : [],
    });
  }

  async function loadEvents() {
    const rows = await listDeliveryEvents(id);
    setEvents(rows.slice().reverse());
  }

  async function loadRefunds() {
    const rows = await fetchRefundRequestsForOrder(id);
    setRefunds(rows);
  }

  useEffect(() => {
    if (!id || Number.isNaN(id)) {
      setError('Invalid order id');
      setLoading(false);
      return;
    }
    setLoading(true);
    Promise.all([loadOrder(), loadEvents(), loadRefunds()])
      .then(() => setError(''))
      .catch((e: any) => setError(e?.message || 'Could not load order'))
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    if (!id || Number.isNaN(id)) return;
    const channel = supabase
      .channel(`customer-tracking-${id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders', filter: `id=eq.${id}` }, () => {
        void loadOrder();
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'order_delivery_events', filter: `order_id=eq.${id}` }, () => {
        void loadEvents();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'order_refund_requests', filter: `order_id=eq.${id}` }, () => {
        void loadRefunds();
      })
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [id]);

  const progress = useMemo(() => {
    const s = order?.delivery_status || 'pending';
    return idx(s);
  }, [order?.delivery_status]);

  const statusLabel = useMemo(() => {
    const ds = String(order?.delivery_status || 'pending');
    if (ds === 'cancelled' || String(order?.status || '') === 'cancelled') return 'Order cancelled';
    return ds.replaceAll('_', ' ');
  }, [order?.delivery_status, order?.status]);

  function buyAgain() {
    if (!order) return;
    const items = (order.items ?? []).filter((it) => it.product?.id && Number(it.quantity || 0) > 0);
    if (items.length === 0) return;

    let existing: Record<number, number> = {};
    try {
      existing = JSON.parse(localStorage.getItem('healhub-cart') || '{}') || {};
      if (!existing || typeof existing !== 'object') existing = {};
    } catch {
      existing = {};
    }

    for (const it of items) {
      const pid = Number(it.product!.id);
      const qty = Number(it.quantity || 0);
      existing[pid] = Number(existing[pid] || 0) + qty;
    }

    localStorage.setItem('healhub-cart', JSON.stringify(existing));
    localStorage.setItem('healhub-checkout-selection', JSON.stringify(items.map((it) => Number(it.product!.id))));
    navigate('/checkout');
  }

  return (
    <CustomerLayout>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Tracking</p>
          <h2 className="text-xl font-bold text-slate-900">Order {order ? `#${order.id}` : ''}</h2>
        </div>
        <Link to="/orders" className="rounded-lg border px-3 py-2 text-sm hover:bg-slate-50">
          ← My Orders
        </Link>
      </div>

      {error && <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>}

      {loading ? (
        <div className="text-sm text-slate-500">Loading…</div>
      ) : !order ? (
        <div className="text-sm text-slate-600">Order not found.</div>
      ) : (
        <div className="space-y-4">
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-slate-900">{statusLabel}</p>
                <p className="mt-1 text-xs text-slate-500">{order.created_at ? new Date(order.created_at).toLocaleString() : ''}</p>
              </div>
              <p className="text-sm font-bold text-indigo-700">฿{Number(order.total_price || 0).toFixed(2)}</p>
            </div>
            <div className="mt-3 grid gap-1 text-xs text-slate-600">
              <p>Courier: <span className="font-medium text-slate-800">{order.courier_provider || '—'}</span></p>
              <p>Tracking: <span className="font-medium text-slate-800">{order.tracking_id || '—'}</span></p>
              {order.tracking_url && (
                <a className="text-indigo-700 underline" href={order.tracking_url} target="_blank" rel="noreferrer">
                  Open tracking link (demo)
                </a>
              )}
              <div className="flex flex-wrap gap-2 pt-2">
                {String(order.delivery_status) === 'delivered' && (
                  <button
                    className="inline-flex items-center rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                    onClick={() => setRefundOpen(true)}
                  >
                    Request refund
                  </button>
                )}
                {(String(order.delivery_status) === 'cancelled' || String(order.status) === 'cancelled') ? (
                  <button
                    className="inline-flex items-center rounded-lg bg-indigo-600 px-3 py-2 text-xs font-semibold text-white hover:bg-indigo-700"
                    onClick={buyAgain}
                  >
                    Buy again
                  </button>
                ) : String(order.delivery_status) === 'pending' && String(order.status) !== 'cancelled' && (
                  <button
                    className="inline-flex items-center rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700 hover:bg-rose-100"
                    onClick={() => setCancelOpen(true)}
                  >
                    Cancel order
                  </button>
                )}
                {String(order.delivery_status) === 'pending' && String(order.status) !== 'cancelled' && (
                  <Link
                    to={`/orders/${order.id}/chat`}
                    className="inline-flex items-center rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    💬 Chat with owner
                  </Link>
                )}
              </div>
            </div>
          </div>

          {refunds.length > 0 && (
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <h3 className="text-sm font-semibold text-slate-900">Refund</h3>
              <div className="mt-2 space-y-2">
                {refunds.map((r) => (
                  <div key={r.id} className="rounded-xl border border-slate-200 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-slate-800">Status: {r.status}</p>
                        <p className="mt-1 text-xs text-slate-500">{new Date(r.created_at).toLocaleString()}</p>
                      </div>
                      {typeof r.requested_amount === 'number' && (
                        <p className="text-xs font-semibold text-slate-800">฿{Number(r.requested_amount).toFixed(2)}</p>
                      )}
                    </div>
                    <p className="mt-2 text-xs text-slate-700"><span className="font-semibold">Reason:</span> {r.reason}</p>
                    {r.note && <p className="mt-1 text-xs text-slate-600">{r.note}</p>}
                    {r.resolution_note && <p className="mt-2 text-xs text-slate-700"><span className="font-semibold">Owner:</span> {r.resolution_note}</p>}
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <h3 className="text-sm font-semibold text-slate-900">Items in this order</h3>
            <div className="mt-3 space-y-3">
              {(order.items ?? []).length === 0 ? (
                <p className="text-sm text-slate-500">No items found.</p>
              ) : (
                (order.items ?? []).map((it) => {
                  const name = it.product?.name || 'Product';
                  const qty = Number(it.quantity || 0);
                  const unit = Number(it.unit_price || 0);
                  const line = Math.max(0, qty * unit);
                  const imgSrc = it.product ? resolveProductImageUrl(it.product) : createProductImageFallback(name);
                  return (
                    <div key={it.id} className="flex items-start gap-3">
                      <div className="h-16 w-16 flex-none overflow-hidden rounded-xl border bg-slate-100">
                        <img
                          src={imgSrc}
                          alt={name}
                          className="h-full w-full object-cover"
                          onError={(e) => {
                            (e.currentTarget as HTMLImageElement).src = createProductImageFallback(name);
                          }}
                        />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-slate-900">{name}</p>
                        <p className="mt-1 text-xs text-slate-500">
                          x{qty} · ฿{unit.toFixed(2)}
                        </p>
                      </div>
                      <p className="text-sm font-bold text-slate-800">฿{line.toFixed(2)}</p>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <h3 className="text-sm font-semibold text-slate-900">Progress</h3>
            <div className="mt-3 grid gap-2">
              {STEPS.map((s, i) => {
                const done = progress >= i;
                return (
                  <div key={s.key} className="flex items-center gap-3">
                    <div className={`h-3 w-3 rounded-full ${done ? 'bg-indigo-600' : 'bg-slate-300'}`} />
                    <div className="min-w-0">
                      <p className={`text-sm ${done ? 'font-semibold text-slate-900' : 'text-slate-500'}`}>{s.label}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <h3 className="text-sm font-semibold text-slate-900">Timeline</h3>
            <div className="mt-3 space-y-2">
              {events.length === 0 ? (
                <p className="text-sm text-slate-500">No delivery events yet.</p>
              ) : (
                events.map((ev) => (
                  <div key={ev.id} className="rounded-xl border border-slate-200 p-3">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-xs font-semibold text-slate-800">{String(ev.status).replaceAll('_', ' ')}</p>
                      <p className="text-xs text-slate-500">{ev.event_time ? new Date(ev.event_time).toLocaleString() : ''}</p>
                    </div>
                    {ev.message && <p className="mt-1 text-xs text-slate-600">{ev.message}</p>}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {cancelOpen && (
        <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/40 p-3">
          <div className="max-h-[calc(100vh-1rem)] w-full max-w-lg overflow-y-auto overscroll-contain rounded-2xl bg-white p-4 pb-24 shadow-xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Cancel order</p>
                <h3 className="mt-1 text-base font-bold text-slate-900">Why do you want to cancel?</h3>
                <p className="mt-1 text-xs text-slate-500">This helps the owner understand and improve service.</p>
              </div>
              <button className="rounded-lg px-2 py-1 text-slate-500 hover:bg-slate-100" onClick={() => setCancelOpen(false)}>
                ✕
              </button>
            </div>

            {cancelError && <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{cancelError}</div>}

            <div className="mt-3 space-y-2">
              {CANCEL_REASONS.map((r) => (
                <label key={r} className="flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm">
                  <input
                    type="radio"
                    name="cancelReason"
                    checked={cancelReason === r}
                    onChange={() => setCancelReason(r)}
                  />
                  <span className="text-slate-800">{r}</span>
                </label>
              ))}
              <textarea
                value={cancelNote}
                onChange={(e) => setCancelNote(e.target.value)}
                placeholder="Optional note (ex: please change address, wrong items...)"
                className="mt-2 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                rows={3}
              />
            </div>

            <div className="mt-4 flex gap-2">
              <button className="flex-1 rounded-xl border px-4 py-2 text-sm font-semibold hover:bg-slate-50" onClick={() => setCancelOpen(false)}>
                Back
              </button>
              <button
                className="flex-1 rounded-xl bg-rose-600 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-700 disabled:opacity-60"
                disabled={cancelling}
                onClick={async () => {
                  try {
                    setCancelling(true);
                    setError('');
                    setCancelError('');
                    const reason = `${cancelReason}${cancelNote.trim() ? ` — ${cancelNote.trim()}` : ''}`;
                    await cancelOrder(id, reason);
                    setCancelOpen(false);
                    setCancelNote('');
                    await loadOrder();
                  } catch (e: any) {
                    setCancelError(e?.message || 'Failed to cancel');
                  } finally {
                    setCancelling(false);
                  }
                }}
              >
                Confirm cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {refundOpen && (
        <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/40 p-3">
          <div className="max-h-[calc(100vh-1rem)] w-full max-w-lg overflow-y-auto overscroll-contain rounded-2xl bg-white p-4 pb-24 shadow-xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Refund request</p>
                <h3 className="mt-1 text-base font-bold text-slate-900">Why do you want a refund?</h3>
              </div>
              <button className="rounded-lg px-2 py-1 text-slate-500 hover:bg-slate-100" onClick={() => setRefundOpen(false)}>
                ✕
              </button>
            </div>

            {refundError && <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{refundError}</div>}

            <div className="mt-3 space-y-2">
              {REFUND_REASONS.map((r) => (
                <label key={r} className="flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm">
                  <input type="radio" name="refundReason" checked={refundReason === r} onChange={() => setRefundReason(r)} />
                  <span className="text-slate-800">{r}</span>
                </label>
              ))}
              <textarea
                value={refundNote}
                onChange={(e) => setRefundNote(e.target.value)}
                placeholder="Optional note (ex: photos, issue details...)"
                className="mt-2 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                rows={3}
              />
            </div>

            <div className="mt-4 flex gap-2">
              <button className="flex-1 rounded-xl border px-4 py-2 text-sm font-semibold hover:bg-slate-50" onClick={() => setRefundOpen(false)}>
                Back
              </button>
              <button
                className="flex-1 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60"
                disabled={requestingRefund}
                onClick={async () => {
                  try {
                    setRequestingRefund(true);
                    setRefundError('');
                    await createRefundRequest(id, refundReason, refundNote.trim() || undefined, null);
                    await loadRefunds();
                    setRefundOpen(false);
                    setRefundNote('');
                  } catch (e: any) {
                    setRefundError(e?.message || 'Failed to request refund');
                  } finally {
                    setRequestingRefund(false);
                  }
                }}
              >
                Submit request
              </button>
            </div>
          </div>
        </div>
      )}
    </CustomerLayout>
  );
}

