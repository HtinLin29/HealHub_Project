import { supabase } from './supabaseClient';
import type { Order, OrderItem } from '../types/domain';
import { adjustProductStock } from './stockService';

// Canonical stock rule (current app flow):
// - stock is consumed immediately at checkout creation
// - status transitions (pending/paid/packed/shipped/delivered) DO NOT change stock
// - when an order becomes cancelled, stock is restored
// - if a cancelled order is reopened to non-cancelled, stock is consumed again
function shouldDeduct(prev: Order['status'], next: Order['status']) {
  return prev === 'cancelled' && next !== 'cancelled';
}

function shouldRestore(prev: Order['status'], next: Order['status']) {
  return prev !== 'cancelled' && next === 'cancelled';
}

async function getOrderItems(orderId: number) {
  const itemsRes = await supabase
    .from('order_items')
    .select('id,order_id,product_id,quantity,unit_price,line_total')
    .eq('order_id', orderId);

  if (itemsRes.error) throw itemsRes.error;

  return ((itemsRes.data as OrderItem[] | null) || []).filter((i) => !!i.product_id && Number(i.quantity || 0) > 0);
}

export async function syncStockForOrderStatusChange(orderId: number, prevStatus: Order['status'], nextStatus: Order['status']) {
  if (!shouldDeduct(prevStatus, nextStatus) && !shouldRestore(prevStatus, nextStatus)) {
    return { changed: false, direction: 0 as const };
  }

  const direction = shouldDeduct(prevStatus, nextStatus) ? -1 : 1;
  const items = await getOrderItems(orderId);

  if (items.length === 0) {
    throw new Error(`Order #${orderId} has no order_items, so stock cannot be synchronized safely.`);
  }

  for (const item of items) {
    const productId = Number(item.product_id);
    const qty = Number(item.quantity || 0);
    if (!productId || qty <= 0) continue;

    await adjustProductStock(productId, direction < 0 ? -qty : qty);
  }

  return { changed: true, direction };
}
