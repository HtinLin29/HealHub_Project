import { supabase } from './supabaseClient';
import type { Product } from '../types/domain';
import { getOrCreateCurrentCustomerId } from './customerIdentityService';
import { adjustProductStock } from './stockService';

type CheckoutItem = { product: Product; qty: number; unit_price?: number };
type PaymentMethod = 'visa' | 'mobile_banking' | 'cod';

/** Snapshot of the address used at checkout (stored on orders.delivery_*). */
export type CheckoutDeliverySnapshot = {
  label: string;
  full_name: string | null;
  phone: string | null;
  address_line1: string;
  address_line2: string | null;
};

type CheckoutOptions = {
  patientId?: number | null;
  orderTotal?: number;
  paymentMethod?: PaymentMethod;
  /** If set, persisted to orders.delivery_name / delivery_phone / delivery_address (jsonb). */
  delivery?: CheckoutDeliverySnapshot | null;
  /** Optional checkout note (stored inside delivery_address.checkout_note). */
  checkoutNote?: string | null;
};

function normalizeCheckoutItems(items: CheckoutItem[]) {
  const merged = new Map<number, CheckoutItem>();

  for (const item of items) {
    const productId = Number(item.product.id);
    const qty = Number(item.qty);
    const unitPrice = item.unit_price === undefined || item.unit_price === null ? null : Number(item.unit_price);

    if (!Number.isFinite(productId) || productId <= 0) {
      throw new Error('Invalid product in cart');
    }

    if (!Number.isFinite(qty) || qty <= 0) {
      throw new Error(`Invalid quantity for ${item.product.name}`);
    }
    if (unitPrice !== null && (!Number.isFinite(unitPrice) || unitPrice < 0)) {
      throw new Error(`Invalid unit price for ${item.product.name}`);
    }

    const existing = merged.get(productId);
    merged.set(productId, {
      product: item.product,
      qty: (existing?.qty || 0) + qty,
      unit_price: unitPrice ?? existing?.unit_price ?? undefined,
    });
  }

  return Array.from(merged.values());
}

export async function createCheckoutOrder(items: CheckoutItem[], opts: CheckoutOptions = {}) {
  if (!items.length) throw new Error('Cart is empty');

  const normalizedItems = normalizeCheckoutItems(items);

  for (const item of normalizedItems) {
    if (item.qty > Number(item.product.stock || 0)) {
      throw new Error(`Not enough stock for ${item.product.name}`);
    }
  }

  const computedTotal = normalizedItems.reduce((sum, item) => {
    const unit = item.unit_price === undefined ? Number(item.product.price) : Number(item.unit_price);
    return sum + unit * Number(item.qty);
  }, 0);
  const total = typeof opts.orderTotal === 'number' ? Number(opts.orderTotal) : computedTotal;

  if (!Number.isFinite(total) || total < 0) {
    throw new Error('Invalid order total');
  }

  const customerId = await getOrCreateCurrentCustomerId();

  const paymentStatus: 'pending' | 'paid' =
    opts.paymentMethod === 'visa' || opts.paymentMethod === 'mobile_banking' ? 'paid' : 'pending';

  const d = opts.delivery;
  const raw1 = d ? String(d.address_line1 || '').trim() : '';
  const raw2 = d ? String(d.address_line2 || '').trim() : '';
  // Persist if line1 and/or line2 has text (some users put only line 2).
  const noteTrim = (opts.checkoutNote ?? '').trim();
  const deliveryAddressJson =
    d && (raw1 || raw2)
      ? {
          label: d.label,
          address_line1: raw1 || raw2,
          address_line2: raw1 && raw2 ? raw2 : null,
          ...(noteTrim ? { checkout_note: noteTrim } : {}),
        }
      : noteTrim && d
        ? {
            label: d.label,
            address_line1: noteTrim,
            address_line2: null,
          }
        : null;

  const orderInsert = await supabase
    .from('orders')
    .insert({
      customer_id: customerId,
      patient_id: opts.patientId ?? null,
      total_price: total,
      status: paymentStatus,
      payment_method: opts.paymentMethod ?? null,
      delivery_name: d?.full_name?.trim() || null,
      delivery_phone: d?.phone?.trim() || null,
      delivery_address: deliveryAddressJson,
    })
    .select('id')
    .single();

  if (orderInsert.error) throw orderInsert.error;

  const orderId = Number(orderInsert.data.id);
  const stockAdjusted: Array<{ productId: number; qty: number }> = [];

  try {
    const payload = normalizedItems.map((item) => ({
      order_id: orderId,
      product_id: item.product.id,
      quantity: Number(item.qty),
      unit_price: Number(item.unit_price === undefined ? item.product.price : item.unit_price),
    }));

    const itemsInsert = await supabase.from('order_items').insert(payload);
    if (itemsInsert.error) throw itemsInsert.error;

    // Reserve stock immediately when customer places order.
    for (const item of normalizedItems) {
      const productId = Number(item.product.id);
      const qty = Number(item.qty);
      await adjustProductStock(productId, -qty);
      stockAdjusted.push({ productId, qty });
    }

    return { orderId, total, itemCount: normalizedItems.reduce((sum, item) => sum + item.qty, 0) };
  } catch (error) {
    // Roll back any stock deductions if order creation flow fails midway.
    for (const row of stockAdjusted) {
      try {
        await adjustProductStock(row.productId, row.qty);
      } catch {
        // Keep original error; this best-effort rollback avoids masking root cause.
      }
    }
    await supabase.from('orders').delete().eq('id', orderId);
    throw error;
  }
}
