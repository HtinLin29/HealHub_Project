import { supabase } from './supabaseClient';

export type DeliveryStatus =
  | 'pending'
  | 'packed'
  | 'out_for_delivery'
  | 'in_transit'
  | 'delivered'
  | 'exception'
  | 'cancelled';

export type DeliveryEvent = {
  id: number;
  order_id: number;
  provider: string;
  event_time: string;
  status: DeliveryStatus;
  message: string | null;
};

function nowIso() {
  return new Date().toISOString();
}

function fakeTrackingId() {
  const n = Math.floor(Math.random() * 9000000) + 1000000;
  return `HH-${n}`;
}

export async function listDeliveryEvents(orderId: number): Promise<DeliveryEvent[]> {
  const res = await supabase
    .from('order_delivery_events')
    .select('id,order_id,provider,event_time,status,message')
    .eq('order_id', orderId)
    .order('event_time', { ascending: false })
    .limit(200);
  if (res.error) throw res.error;
  return (res.data ?? []) as any;
}

export async function markOrderPaid(orderId: number) {
  const res = await supabase.from('orders').update({ status: 'paid' }).eq('id', orderId);
  if (res.error) throw res.error;
}

async function setDeliveryStatus(orderId: number, next: DeliveryStatus, message: string, extraPatch: Record<string, any> = {}) {
  const t = nowIso();
  const patch: any = {
    delivery_status: next,
    delivery_last_event_at: t,
    delivery_last_event_raw: { source: 'demo', action: 'set_status', to: next },
    updated_at: t,
    ...extraPatch,
  };
  if (next === 'packed') patch.packed_at = patch.packed_at || t;
  if (next === 'out_for_delivery') patch.shipped_at = patch.shipped_at || t;
  if (next === 'delivered') patch.delivered_at = patch.delivered_at || t;

  const orderRes = await supabase.from('orders').select('id,courier_provider,tracking_id').eq('id', orderId).single();
  if (orderRes.error) throw orderRes.error;

  const upd = await supabase.from('orders').update(patch).eq('id', orderId);
  if (upd.error) throw upd.error;

  const provider = (orderRes.data as any).courier_provider || 'HealHub Demo';
  const ev = await supabase.from('order_delivery_events').insert({
    order_id: orderId,
    provider,
    event_time: t,
    status: next,
    message,
    raw: { tracking_id: (orderRes.data as any).tracking_id ?? null },
  });
  if (ev.error) throw ev.error;
}

export async function markPacked(orderId: number) {
  await setDeliveryStatus(orderId, 'packed', 'Order packed (demo).');
}

export async function assignFakeCourier(orderId: number, provider = 'HealHub Express') {
  const t = nowIso();
  const trackingId = fakeTrackingId();
  const upd = await supabase
    .from('orders')
    .update({
      courier_provider: provider,
      tracking_id: trackingId,
      tracking_url: `https://example.com/track/${encodeURIComponent(trackingId)}`,
      shipment_id: `SHIP-${trackingId}`,
      delivery_status: 'out_for_delivery',
      shipped_at: t,
      delivery_last_event_at: t,
      delivery_last_event_raw: { source: 'demo', action: 'assign_fake_courier' },
      updated_at: t,
    })
    .eq('id', orderId);
  if (upd.error) throw upd.error;

  const ev = await supabase.from('order_delivery_events').insert({
    order_id: orderId,
    provider,
    event_time: t,
    status: 'out_for_delivery',
    message: 'Courier assigned. Out for delivery (demo).',
    raw: { tracking_id: trackingId },
  });
  if (ev.error) throw ev.error;
}

export async function markInTransit(orderId: number) {
  await setDeliveryStatus(orderId, 'in_transit', 'Package is in transit (demo).');
}

export async function markDelivered(orderId: number) {
  await setDeliveryStatus(orderId, 'delivered', 'Delivered successfully (demo).');
}

function nextStatus(status: string): DeliveryStatus | null {
  const s = String(status || 'pending');
  if (s === 'pending') return 'packed';
  if (s === 'packed') return 'out_for_delivery';
  if (s === 'out_for_delivery') return 'in_transit';
  if (s === 'in_transit') return 'delivered';
  return null;
}

export async function advanceDelivery(orderId: number) {
  const orderRes = await supabase.from('orders').select('id,delivery_status,courier_provider,tracking_id').eq('id', orderId).single();
  if (orderRes.error) throw orderRes.error;
  const current = String((orderRes.data as any).delivery_status || 'pending');
  const next = nextStatus(current);
  if (!next) return;

  const t = nowIso();
  const patch: any = {
    delivery_status: next,
    delivery_last_event_at: t,
    delivery_last_event_raw: { source: 'demo', action: 'advance', from: current, to: next },
    updated_at: t,
  };
  if (next === 'packed') patch.packed_at = t;
  if (next === 'out_for_delivery') patch.shipped_at = t;
  if (next === 'delivered') patch.delivered_at = t;

  const upd = await supabase.from('orders').update(patch).eq('id', orderId);
  if (upd.error) throw upd.error;

  const provider = (orderRes.data as any).courier_provider || 'HealHub Demo';
  const ev = await supabase.from('order_delivery_events').insert({
    order_id: orderId,
    provider,
    event_time: t,
    status: next,
    message:
      next === 'in_transit'
        ? 'Package is in transit (demo).'
        : next === 'delivered'
          ? 'Delivered successfully (demo).'
          : next === 'out_for_delivery'
            ? 'Out for delivery (demo).'
            : 'Status updated (demo).',
    raw: { tracking_id: (orderRes.data as any).tracking_id ?? null },
  });
  if (ev.error) throw ev.error;
}

