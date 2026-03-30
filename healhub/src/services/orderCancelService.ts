import { supabase } from './supabaseClient';
import { getOrCreateCurrentCustomerId } from './customerIdentityService';
import { adjustProductStock } from './stockService';

export const CANCEL_REASONS = [
  'I ordered by mistake',
  'I found a better price',
  'I want to change delivery address',
  'I want to change items/quantity',
  'Delivery is taking too long',
  'Other',
] as const;

export type CancelReason = (typeof CANCEL_REASONS)[number];

export async function cancelOrder(orderId: number, reason: string) {
  // Ensure public.users row exists so RLS functions (current_app_user_id) work.
  // Some accounts can exist in Supabase Auth without a users row yet.
  const customerId = await getOrCreateCurrentCustomerId();
  if (!customerId) throw new Error('Please sign in again to cancel this order.');

  const t = new Date().toISOString();
  // Only allow customer cancel when delivery is still pending.
  const check = await supabase.from('orders').select('id,delivery_status,status').eq('id', orderId).single();
  if (check.error) throw check.error;
  const ds = String((check.data as any)?.delivery_status || 'pending');
  if (ds !== 'pending') {
    throw new Error('You can only cancel while the order is pending.');
  }

  const res = await supabase
    .from('orders')
    .update({
      status: 'cancelled',
      delivery_status: 'cancelled',
      cancelled_at: t,
      cancel_reason: String(reason || '').trim() || 'Other',
      updated_at: t,
    })
    .eq('id', orderId)
    .eq('delivery_status', 'pending');
  if (res.error) throw res.error;

  // Restore stock for all items in the cancelled order.
  const itemsRes = await supabase
    .from('order_items')
    .select('product_id,quantity')
    .eq('order_id', orderId);
  if (itemsRes.error) throw itemsRes.error;

  const items = Array.isArray(itemsRes.data) ? itemsRes.data : [];
  for (const item of items as any[]) {
    const productId = Number(item.product_id);
    const qty = Number(item.quantity || 0);
    if (!productId || qty <= 0) continue;
    await adjustProductStock(productId, qty);
  }
}

