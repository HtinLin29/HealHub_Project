import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import CustomerLayout from './CustomerLayout';
import { supabase } from '../services/supabaseClient';
import { isUnreadForCustomer, listCustomerConversations, type ChatConversationSummary } from '../services/orderChatService';
import { createProductImageFallback, resolveProductImageUrl } from '../services/productImageService';

type OrderMeta = {
  id: number;
  total_price: number;
  created_at: string | null;
  total_items: number;
  first_product?: { name: string; image_url?: string | null } | null;
};

export default function CustomerInboxPage() {
  const [items, setItems] = useState<ChatConversationSummary[]>([]);
  const [ordersById, setOrdersById] = useState<Map<number, OrderMeta>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  async function load() {
    setLoading(true);
    const rows = await listCustomerConversations();
    setItems(rows);

    const orderIds = rows.map((c) => Number(c.order_id)).filter((n) => Number.isFinite(n));
    if (orderIds.length === 0) {
      setOrdersById(new Map());
      return;
    }

    const res = await supabase
      .from('orders')
      .select(
        `
          id,
          total_price,
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
      .in('id', orderIds);

    if (res.error) throw res.error;

    const map = new Map<number, OrderMeta>();
    for (const r of res.data ?? []) {
      const orderItems = Array.isArray((r as any).order_items) ? (r as any).order_items : [];
      const totalItems = orderItems.reduce((sum: number, it: any) => sum + Number(it?.quantity || 0), 0);
      const first = orderItems.find((it: any) => it?.product)?.product ?? null;

      map.set(Number((r as any).id), {
        id: Number((r as any).id),
        total_price: Number((r as any).total_price ?? 0),
        created_at: (r as any).created_at ?? null,
        total_items: totalItems,
        first_product: first,
      });
    }

    setOrdersById(map);
  }

  useEffect(() => {
    void load()
      .then(() => setError(''))
      .catch((e: any) => setError(e?.message || 'Could not load inbox'))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const channel = supabase
      .channel('customer-chat-inbox')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'order_messages' }, () => {
        void load().catch(() => {});
      })
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const unreadCount = useMemo(() => items.filter(isUnreadForCustomer).length, [items]);

  return (
    <CustomerLayout
      topSlot={undefined}
      showMobileMenu={true}
    >
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Inbox</p>
          <h2 className="text-xl font-bold text-slate-900">Messages</h2>
        </div>
        <Link to="/shop" className="rounded-lg border px-3 py-2 text-sm hover:bg-slate-50">
          ← Shop
        </Link>
      </div>

      {error && <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>}

      {loading ? (
        <div className="text-sm text-slate-500">Loading…</div>
      ) : items.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-600 shadow-sm">No messages yet.</div>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3">
            <p className="text-sm text-slate-700">
              Unread: <span className="font-semibold">{unreadCount}</span>
            </p>
            <p className="text-xs text-slate-500">{items.length} chat(s)</p>
          </div>
          {items.map((c) => {
            const order = ordersById.get(Number(c.order_id));
            const firstProduct = order?.first_product ?? null;
            const fallbackName = firstProduct?.name || `Order ${c.order_id}`;

            return (
              <Link
                key={c.id}
                to={`/orders/${c.order_id}/chat`}
                className="block rounded-2xl border border-slate-200 bg-white p-4 shadow-sm hover:bg-slate-50"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-start gap-3">
                    <div className="h-14 w-14 flex-none overflow-hidden rounded-xl border bg-slate-100">
                      <img
                        src={
                          firstProduct
                            ? resolveProductImageUrl({ name: firstProduct.name, image_url: firstProduct.image_url ?? null })
                            : createProductImageFallback('HealHub Order')
                        }
                        alt={fallbackName}
                        className="h-full w-full object-cover"
                        onError={(e) => {
                          (e.currentTarget as HTMLImageElement).src = createProductImageFallback(fallbackName);
                        }}
                      />
                    </div>

                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-slate-900">
                        {firstProduct?.name || `Order #${c.order_id}`}
                      </p>
                      <p className="mt-1 text-xs text-slate-500">
                        Last: {c.last_message_at ? new Date(c.last_message_at).toLocaleString() : '—'}
                      </p>
                      <p className="mt-1 text-xs text-slate-500">
                        ฿{Number(order?.total_price || 0).toFixed(2)}
                      </p>
                    </div>
                  </div>

                  {isUnreadForCustomer(c) && (
                    <span className="rounded-full bg-rose-600 px-2 py-0.5 text-[11px] font-bold text-white">
                      NEW
                    </span>
                  )}
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </CustomerLayout>
  );
}

