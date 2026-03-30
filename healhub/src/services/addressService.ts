import { supabase } from './supabaseClient';
import { getOrCreateCurrentCustomerId } from './customerIdentityService';

export type SavedAddress = {
  id: number;
  label: string;
  full_name: string | null;
  phone: string | null;
  address_line1: string;
  address_line2: string | null;
  is_default: boolean;
};

function normalizeAddress(row: any): SavedAddress {
  return {
    id: Number(row.id),
    label: String(row.label || 'Home'),
    full_name: row.full_name ?? null,
    phone: row.phone ?? null,
    address_line1: String(row.address_line1 ?? ''),
    address_line2: row.address_line2 ?? null,
    is_default: Boolean(row.is_default),
  };
}

export async function fetchDefaultAddress(): Promise<SavedAddress | null> {
  const customerId = await getOrCreateCurrentCustomerId();
  if (!customerId) return null;

  const res = await supabase
    .from('customer_addresses')
    .select('id,label,full_name,phone,address_line1,address_line2,is_default')
    .eq('customer_id', customerId)
    .eq('is_default', true)
    .maybeSingle();

  if (res.error) throw res.error;
  if (!res.data) return null;

  return normalizeAddress(res.data);
}

export async function listAddresses(): Promise<SavedAddress[]> {
  const customerId = await getOrCreateCurrentCustomerId();
  if (!customerId) return [];

  const res = await supabase
    .from('customer_addresses')
    .select('id,label,full_name,phone,address_line1,address_line2,is_default,created_at')
    .eq('customer_id', customerId)
    .order('is_default', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(50);

  if (res.error) throw res.error;
  return (res.data ?? []).map(normalizeAddress);
}

export async function saveAddress(input: Omit<SavedAddress, 'id'> & { id?: number }): Promise<SavedAddress> {
  const customerId = await getOrCreateCurrentCustomerId();
  if (!customerId) {
    throw new Error('You must be signed in to save an address.');
  }

  const payload: any = {
    customer_id: customerId,
    label: String(input.label || 'Home'),
    full_name: input.full_name ?? null,
    phone: input.phone ?? null,
    address_line1: String(input.address_line1 || '').trim(),
    address_line2: input.address_line2 ?? null,
    updated_at: new Date().toISOString(),
  };

  if (!payload.address_line1) {
    throw new Error('Address line 1 is required.');
  }

  if (typeof input.id === 'number' && Number.isFinite(input.id)) {
    const res = await supabase
      .from('customer_addresses')
      .update(payload)
      .eq('id', input.id)
      .select('id,label,full_name,phone,address_line1,address_line2,is_default')
      .single();
    if (res.error) throw res.error;
    return normalizeAddress(res.data);
  }

  const res = await supabase
    .from('customer_addresses')
    .insert({ ...payload, is_default: Boolean(input.is_default) })
    .select('id,label,full_name,phone,address_line1,address_line2,is_default')
    .single();
  if (res.error) throw res.error;
  return normalizeAddress(res.data);
}

export async function deleteAddress(addressId: number): Promise<void> {
  const res = await supabase.from('customer_addresses').delete().eq('id', addressId);
  if (res.error) throw res.error;
}

export async function setDefaultAddress(addressId: number): Promise<void> {
  const customerId = await getOrCreateCurrentCustomerId();
  if (!customerId) throw new Error('You must be signed in.');

  const clearRes = await supabase.from('customer_addresses').update({ is_default: false }).eq('customer_id', customerId);
  if (clearRes.error) throw clearRes.error;

  const setRes = await supabase.from('customer_addresses').update({ is_default: true }).eq('id', addressId).eq('customer_id', customerId);
  if (setRes.error) throw setRes.error;
}

