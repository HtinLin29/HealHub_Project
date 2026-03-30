import { supabase } from './supabaseClient';

/** Preferred saved address for delivery (default first, then newest). */
export type DeliveryAddressDisplay = {
  label: string;
  contactName: string | null;
  phone: string | null;
  line1: string;
  line2: string | null;
  /** From checkout optional note (stored on order snapshot). */
  checkoutNote?: string | null;
};

/** Columns persisted at checkout (see orders.delivery_*). */
export type OrderDeliverySnapshotRow = {
  delivery_name?: string | null;
  delivery_phone?: string | null;
  delivery_address?: unknown;
};

/** Prefer order snapshot from checkout; use for display when present. */
export function deliveryDisplayFromOrderSnapshot(row: OrderDeliverySnapshotRow | null | undefined): DeliveryAddressDisplay | null {
  if (!row) return null;
  const j = row.delivery_address as {
    label?: string | null;
    address_line1?: string | null;
    address_line2?: string | null;
    checkout_note?: string | null;
  } | null;
  const line1 = String(j?.address_line1 ?? '').trim();
  const line2 = String(j?.address_line2 ?? '').trim();
  const note = String(j?.checkout_note ?? '').trim();
  if (!line1 && !line2 && !note) return null;
  return {
    label: String(j?.label || 'Delivery'),
    contactName: row.delivery_name?.trim() || null,
    phone: row.delivery_phone?.trim() || null,
    line1: line1 || line2 || note,
    line2: line1 && line2 ? line2 : null,
    checkoutNote: note || null,
  };
}

/** One-line summary for fulfillment list: order snapshot first. */
export function oneLineDeliverySummaryFromOrder(row: OrderDeliverySnapshotRow | null | undefined): string | null {
  const j = row?.delivery_address as {
    address_line1?: string | null;
    address_line2?: string | null;
    checkout_note?: string | null;
  } | null;
  const a1 = j?.address_line1?.trim();
  const a2 = j?.address_line2?.trim();
  const note = j?.checkout_note?.trim();
  const main = a1 && a2 ? `${a1}, ${a2}` : a1 || a2 || '';
  if (!main && !note) return null;
  return note && main ? `${main} · ${note}` : main || note || null;
}

export async function fetchCustomerDeliveryAddress(customerId: string): Promise<DeliveryAddressDisplay | null> {
  const res = await supabase
    .from('customer_addresses')
    .select('label, full_name, phone, address_line1, address_line2, is_default, id')
    .eq('customer_id', customerId)
    .order('is_default', { ascending: false })
    .order('id', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (res.error || !res.data) return null;

  const row = res.data as {
    label?: string | null;
    full_name?: string | null;
    phone?: string | null;
    address_line1?: string | null;
    address_line2?: string | null;
  };

  const line1 = String(row.address_line1 ?? '').trim();
  const line2 = String(row.address_line2 ?? '').trim();
  const primary = line1 || line2;
  if (!primary) return null;

  return {
    label: String(row.label || 'Address'),
    contactName: row.full_name?.trim() || null,
    phone: row.phone?.trim() || null,
    line1: line1 || line2,
    line2: line1 && line2 ? line2 : null,
  };
}

/** One-line summary per customer for table rows (default address preferred). */
export async function fetchDeliveryAddressSummariesByCustomerIds(customerIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const ids = [...new Set(customerIds.filter(Boolean))];
  if (ids.length === 0) return out;

  const res = await supabase
    .from('customer_addresses')
    .select('customer_id, address_line1, address_line2, is_default, id')
    .in('customer_id', ids);

  if (res.error || !res.data?.length) return out;

  type Row = { customer_id: string; address_line1?: string | null; address_line2?: string | null; is_default?: boolean; id?: number };
  const byCustomer = new Map<string, Row[]>();
  for (const row of res.data as Row[]) {
    const cid = row.customer_id;
    if (!byCustomer.has(cid)) byCustomer.set(cid, []);
    byCustomer.get(cid)!.push(row);
  }

  for (const [cid, rows] of byCustomer) {
    const sorted = [...rows].sort((a, b) => Number(!!b.is_default) - Number(!!a.is_default) || Number(b.id ?? 0) - Number(a.id ?? 0));
    const top = sorted[0];
    const a1 = top.address_line1?.trim();
    const a2 = top.address_line2?.trim();
    const summary = a1 && a2 ? `${a1}, ${a2}` : a1 || a2 || '';
    if (summary) out.set(cid, summary);
  }

  return out;
}
