import { supabase } from './supabaseClient';
import { getOrCreateCurrentCustomerId } from './customerIdentityService';

export const REFUND_REASONS = [
  'Did not receive the order',
  'Received wrong item',
  'Item damaged/expired',
  'Changed my mind',
  'Other',
] as const;

export type RefundStatus = 'pending' | 'approved' | 'rejected';

export type RefundRequest = {
  id: number;
  order_id: number;
  customer_id: string;
  status: RefundStatus;
  reason: string;
  note: string | null;
  requested_amount: number | null;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
  resolution_note: string | null;
};

export async function createRefundRequest(orderId: number, reason: string, note?: string, requestedAmount?: number | null) {
  const customerId = await getOrCreateCurrentCustomerId();
  if (!customerId) throw new Error('Please sign in again.');

  // Refund is only allowed after delivery.
  const orderRes = await supabase.from('orders').select('id,delivery_status').eq('id', orderId).single();
  if (orderRes.error) throw orderRes.error;
  if (String((orderRes.data as any)?.delivery_status || '') !== 'delivered') {
    throw new Error('Refund can only be requested after the order is delivered.');
  }

  const now = new Date().toISOString();
  const res = await supabase
    .from('order_refund_requests')
    .insert({
      order_id: orderId,
      customer_id: customerId,
      status: 'pending',
      reason: String(reason || '').trim() || 'Other',
      note: note ? String(note).trim() : null,
      requested_amount: requestedAmount ?? null,
      updated_at: now,
    })
    .select('id,order_id,customer_id,status,reason,note,requested_amount,created_at,updated_at,resolved_at,resolution_note')
    .single();
  if (res.error) throw res.error;
  return res.data as any as RefundRequest;
}

export async function fetchRefundRequestsForOrder(orderId: number): Promise<RefundRequest[]> {
  const res = await supabase
    .from('order_refund_requests')
    .select('id,order_id,customer_id,status,reason,note,requested_amount,created_at,updated_at,resolved_at,resolution_note')
    .eq('order_id', orderId)
    .order('created_at', { ascending: false })
    .limit(50);
  if (res.error) throw res.error;
  return (res.data ?? []) as any;
}

export async function listOwnerRefundRequests(status: RefundStatus | 'all' = 'all'): Promise<RefundRequest[]> {
  let q = supabase
    .from('order_refund_requests')
    .select('id,order_id,customer_id,status,reason,note,requested_amount,created_at,updated_at,resolved_at,resolution_note')
    .order('updated_at', { ascending: false })
    .limit(500);
  if (status !== 'all') q = q.eq('status', status);
  const res = await q;
  if (res.error) throw res.error;
  return (res.data ?? []) as any;
}

export async function ownerResolveRefundRequest(id: number, next: RefundStatus, resolutionNote?: string) {
  const now = new Date().toISOString();
  const res = await supabase
    .from('order_refund_requests')
    .update({
      status: next,
      resolution_note: resolutionNote ? String(resolutionNote).trim() : null,
      resolved_at: now,
      updated_at: now,
    })
    .eq('id', id);
  if (res.error) throw res.error;
}

