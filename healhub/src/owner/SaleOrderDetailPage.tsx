import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import OwnerLayout from './OwnerLayout';
import { syncStockForOrderStatusChange } from '../services/orderService';
import { supabase } from '../services/supabaseClient';
import type { Order } from '../types/domain';

type ProductRow = { id: number; name: string; category?: string | null };
type OrderItemRow = { id?: number; order_id?: number | null; product_id?: number | null; quantity?: number | null; unit_price?: number | null; line_total?: number | null };
type OrderWithUserRow = Order & { users?: { full_name?: string | null; email?: string | null } | null };

type OrderLine = {
  id?: number;
  product_id?: number | null;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  productName: string;
  productCategory: string | null;
};

const statuses: Order['status'][] = ['pending', 'paid', 'packed', 'shipped', 'delivered', 'cancelled'];

function formatMoney(value: number) {
  return `฿${Number(value || 0).toFixed(2)}`;
}

export default function SaleOrderDetailPage() {
  const navigate = useNavigate();
  const { orderId } = useParams();
  const parsedOrderId = Number(orderId);

  const [order, setOrder] = useState<Order | null>(null);
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [items, setItems] = useState<OrderItemRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [updating, setUpdating] = useState(false);

  useEffect(() => {
    async function load() {
      if (!Number.isFinite(parsedOrderId) || parsedOrderId <= 0) {
        setError('Invalid order ID.');
        setLoading(false);
        return;
      }

      try {
        setLoading(true);
        const [itemsRes, productsRes] = await Promise.all([
          supabase.from('order_items').select('*').eq('order_id', parsedOrderId),
          supabase.from('products').select('id,name,category').eq('is_active', true).limit(10000),
        ]);

        if (itemsRes.error) throw itemsRes.error;
        if (productsRes.error) throw productsRes.error;

        // Try joined customer profile first; fall back to plain order row if join is blocked by RLS.
        const joinedOrderRes = await supabase
          .from('orders')
          .select('*, users(full_name, email)')
          .eq('id', parsedOrderId)
          .single();

        let loadedOrder: Order | null = null;
        if (!joinedOrderRes.error && joinedOrderRes.data) {
          const row = joinedOrderRes.data as OrderWithUserRow;
          const resolvedName = row.customer_name || row.users?.full_name?.trim() || row.users?.email?.trim() || null;
          loadedOrder = {
            ...row,
            customer_name: resolvedName,
          };
        } else {
          const fallbackOrderRes = await supabase.from('orders').select('*').eq('id', parsedOrderId).single();
          if (fallbackOrderRes.error) throw fallbackOrderRes.error;
          loadedOrder = (fallbackOrderRes.data as Order) ?? null;
        }

        setOrder(loadedOrder);
        setItems((itemsRes.data as OrderItemRow[]) ?? []);
        setProducts((productsRes.data as ProductRow[]) ?? []);
        setError('');
      } catch (e: any) {
        setError(e?.message || 'Failed to load order details');
      } finally {
        setLoading(false);
      }
    }

    void load();
  }, [parsedOrderId]);

  const itemLines = useMemo<OrderLine[]>(() => {
    const productMap = new Map(products.map((p) => [p.id, p] as const));
    return items.map((item) => {
      const product = productMap.get(Number(item.product_id));
      const quantity = Number(item.quantity || 0);
      const unitPrice = Number(item.unit_price || 0);
      const lineTotal = Number(item.line_total ?? quantity * unitPrice);
      return {
        id: item.id,
        product_id: item.product_id,
        quantity,
        unitPrice,
        lineTotal,
        productName: product?.name || `Product #${item.product_id}`,
        productCategory: product?.category || null,
      };
    });
  }, [items, products]);

  async function updateOrderStatus(status: Order['status']) {
    if (!order || order.status === status) return;
    try {
      setUpdating(true);
      await syncStockForOrderStatusChange(order.id, order.status, status);
      const { error: updateError } = await supabase.from('orders').update({ status }).eq('id', order.id);
      if (updateError) throw updateError;
      setOrder({ ...order, status });
      setError('');
    } catch (e: any) {
      setError(e?.message || 'Failed to update order status');
    } finally {
      setUpdating(false);
    }
  }

  return (
    <OwnerLayout title="Sale">
      <div className="mb-4">
        <button
          type="button"
          onClick={() => navigate('/owner/sale')}
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700"
        >
          ← Back to Sale
        </button>
      </div>

      {loading ? <p className="text-sm text-slate-500">Loading order...</p> : null}
      {!loading && error ? (
        <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800 dark:border-rose-900/50 dark:bg-rose-950/40 dark:text-rose-200">
          {error}
        </p>
      ) : null}

      {!loading && !error && order ? (
        <div className="rounded-xl border bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800">
          <div className="space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-wide text-slate-500">Selected order</p>
                <h3 className="mt-1 text-lg font-semibold text-slate-800 dark:text-slate-100">Order #{order.id}</h3>
                <p className="mt-1 text-xs text-slate-500">{order.created_at ? new Date(order.created_at).toLocaleString() : 'No timestamp available'}</p>
              </div>
              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs capitalize text-slate-700 dark:bg-slate-700 dark:text-slate-100">{order.status}</span>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-700/40">
                <p className="text-xs uppercase tracking-wide text-slate-500">Customer</p>
                <p className="mt-1 text-sm font-medium text-slate-800 dark:text-slate-100">{order.customer_name || 'Guest / unlinked'}</p>
                <p className="mt-1 text-xs text-slate-500">{order.customer_id || 'No linked customer profile'}</p>
              </div>
              <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-700/40">
                <p className="text-xs uppercase tracking-wide text-slate-500">Order summary</p>
                <p className="mt-1 text-sm font-medium text-slate-800 dark:text-slate-100">{itemLines.length} item(s)</p>
                <p className="mt-1 text-xs text-slate-500">Total: {formatMoney(order.total_price)}</p>
              </div>
            </div>

            <div>
              <label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-slate-500">Update status</label>
              <select
                className="w-full rounded border px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900"
                value={order.status}
                onChange={(e) => void updateOrderStatus(e.target.value as Order['status'])}
                disabled={updating}
              >
                {statuses.map((status) => (
                  <option key={status} value={status}>{status}</option>
                ))}
              </select>
              <p className="mt-2 text-xs text-slate-500">Stock-safe status changes require valid order items.</p>
            </div>

            <div>
              <div className="mb-2 flex items-center justify-between">
                <h4 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Line items</h4>
                <span className="text-xs text-slate-500">{itemLines.length} row(s)</span>
              </div>

              {itemLines.length === 0 ? (
                <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-800">
                  This order has no item rows yet. Add itemized orders before using stock-safe fulfillment changes.
                </div>
              ) : (
                <div className="space-y-2">
                  {itemLines.map((item, index) => (
                    <div key={item.id ?? `${order.id}-${index}`} className="rounded-xl border border-slate-200 p-3 dark:border-slate-700">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-medium text-slate-800 dark:text-slate-100">{item.productName}</p>
                          <p className="text-xs text-slate-500">{item.productCategory || 'Uncategorized'}</p>
                        </div>
                        <p className="text-sm font-semibold text-indigo-700 dark:text-indigo-300">{formatMoney(item.lineTotal)}</p>
                      </div>
                      <div className="mt-2 grid grid-cols-3 gap-2 text-xs text-slate-600 dark:text-slate-300">
                        <div>Qty: <span className="font-medium text-slate-800 dark:text-slate-100">{item.quantity}</span></div>
                        <div>Unit: <span className="font-medium text-slate-800 dark:text-slate-100">{formatMoney(item.unitPrice)}</span></div>
                        <div>ID: <span className="font-medium text-slate-800 dark:text-slate-100">#{item.product_id}</span></div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </OwnerLayout>
  );
}
