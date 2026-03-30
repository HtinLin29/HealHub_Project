import { supabase } from './supabaseClient';
import { getOrCreateCurrentCustomerId } from './customerIdentityService';

export type PaymentMethod = {
  id: number;
  provider: string;
  brand: string | null;
  last4: string;
  exp_month: number | null;
  exp_year: number | null;
  cardholder_name: string | null;
  is_default: boolean;
};

function normalize(row: any): PaymentMethod {
  return {
    id: Number(row.id),
    provider: String(row.provider || 'visa'),
    brand: row.brand ?? null,
    last4: String(row.last4 || ''),
    exp_month: row.exp_month === null || row.exp_month === undefined ? null : Number(row.exp_month),
    exp_year: row.exp_year === null || row.exp_year === undefined ? null : Number(row.exp_year),
    cardholder_name: row.cardholder_name ?? null,
    is_default: Boolean(row.is_default),
  };
}

export async function listPaymentMethods(): Promise<PaymentMethod[]> {
  const customerId = await getOrCreateCurrentCustomerId();
  if (!customerId) return [];

  const res = await supabase
    .from('customer_payment_methods')
    .select('id,provider,brand,last4,exp_month,exp_year,cardholder_name,is_default,created_at')
    .eq('customer_id', customerId)
    .order('is_default', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(50);

  if (res.error) throw res.error;
  return (res.data ?? []).map(normalize);
}

export async function fetchDefaultPaymentMethod(): Promise<PaymentMethod | null> {
  const customerId = await getOrCreateCurrentCustomerId();
  if (!customerId) return null;

  const res = await supabase
    .from('customer_payment_methods')
    .select('id,provider,brand,last4,exp_month,exp_year,cardholder_name,is_default')
    .eq('customer_id', customerId)
    .eq('is_default', true)
    .maybeSingle();

  if (res.error) throw res.error;
  return res.data ? normalize(res.data) : null;
}

export async function addCard(input: {
  cardNumber: string;
  expMonth: number;
  expYear: number;
  cardholderName: string;
  brand?: string | null;
}): Promise<PaymentMethod> {
  const customerId = await getOrCreateCurrentCustomerId();
  if (!customerId) throw new Error('You must be signed in to add a card.');

  const digits = String(input.cardNumber || '').replace(/\D/g, '');
  if (digits.length < 12) throw new Error('Card number looks too short.');
  const last4 = digits.slice(-4);

  const expMonth = Number(input.expMonth);
  const expYear = Number(input.expYear);
  if (!Number.isFinite(expMonth) || expMonth < 1 || expMonth > 12) throw new Error('Invalid expiration month.');
  if (!Number.isFinite(expYear) || expYear < 2000 || expYear > 2100) throw new Error('Invalid expiration year.');
  if (!String(input.cardholderName || '').trim()) throw new Error('Cardholder name is required.');

  const payload = {
    customer_id: customerId,
    provider: 'visa',
    brand: input.brand ?? 'VISA',
    last4,
    exp_month: expMonth,
    exp_year: expYear,
    cardholder_name: input.cardholderName.trim(),
    is_default: false,
    updated_at: new Date().toISOString(),
  };

  const res = await supabase
    .from('customer_payment_methods')
    .insert(payload)
    .select('id,provider,brand,last4,exp_month,exp_year,cardholder_name,is_default')
    .single();
  if (res.error) throw res.error;
  return normalize(res.data);
}

export async function deletePaymentMethod(id: number): Promise<void> {
  const res = await supabase.from('customer_payment_methods').delete().eq('id', id);
  if (res.error) throw res.error;
}

export async function setDefaultPaymentMethod(id: number): Promise<void> {
  const customerId = await getOrCreateCurrentCustomerId();
  if (!customerId) throw new Error('You must be signed in.');

  const clearRes = await supabase.from('customer_payment_methods').update({ is_default: false }).eq('customer_id', customerId);
  if (clearRes.error) throw clearRes.error;

  const setRes = await supabase.from('customer_payment_methods').update({ is_default: true }).eq('id', id).eq('customer_id', customerId);
  if (setRes.error) throw setRes.error;
}

