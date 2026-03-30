import { supabase } from './supabaseClient';
import { getOrCreateCurrentCustomerId } from './customerIdentityService';

export type Patient = {
  id: number;
  full_name: string;
  age: number | null;
  gender: string | null;
  allergy: string | null;
  is_default: boolean;
};

function normalize(row: any): Patient {
  return {
    id: Number(row.id),
    full_name: String(row.full_name || ''),
    age: row.age === null || row.age === undefined ? null : Number(row.age),
    gender: row.gender ?? null,
    allergy: row.allergy ?? null,
    is_default: Boolean(row.is_default),
  };
}

export async function listPatients(): Promise<Patient[]> {
  const customerId = await getOrCreateCurrentCustomerId();
  if (!customerId) return [];

  const res = await supabase
    .from('customer_patients')
    .select('id,full_name,age,gender,allergy,is_default,created_at')
    .eq('customer_id', customerId)
    .order('is_default', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(50);

  if (res.error) throw res.error;
  return (res.data ?? []).map(normalize);
}

export async function fetchDefaultPatient(): Promise<Patient | null> {
  const customerId = await getOrCreateCurrentCustomerId();
  if (!customerId) return null;

  const res = await supabase
    .from('customer_patients')
    .select('id,full_name,age,gender,allergy,is_default')
    .eq('customer_id', customerId)
    .eq('is_default', true)
    .maybeSingle();

  if (res.error) throw res.error;
  return res.data ? normalize(res.data) : null;
}

export async function savePatient(input: Omit<Patient, 'id' | 'is_default'> & { id?: number; make_default?: boolean }): Promise<Patient> {
  const customerId = await getOrCreateCurrentCustomerId();
  if (!customerId) throw new Error('You must be signed in to save a patient.');

  const payload: any = {
    customer_id: customerId,
    full_name: String(input.full_name || '').trim(),
    age: input.age === null || input.age === undefined || input.age === ('' as any) ? null : Number(input.age),
    gender: input.gender ?? null,
    allergy: input.allergy ?? null,
    updated_at: new Date().toISOString(),
  };

  if (!payload.full_name) throw new Error('Patient name is required.');
  if (payload.age !== null && (!Number.isFinite(payload.age) || payload.age < 0 || payload.age > 130)) {
    throw new Error('Age must be between 0 and 130.');
  }

  if (typeof input.id === 'number' && Number.isFinite(input.id)) {
    const res = await supabase
      .from('customer_patients')
      .update(payload)
      .eq('id', input.id)
      .select('id,full_name,age,gender,allergy,is_default')
      .single();
    if (res.error) throw res.error;
    return normalize(res.data);
  }

  const res = await supabase
    .from('customer_patients')
    .insert({ ...payload, is_default: false })
    .select('id,full_name,age,gender,allergy,is_default')
    .single();
  if (res.error) throw res.error;
  return normalize(res.data);
}

export async function deletePatient(patientId: number): Promise<void> {
  const res = await supabase.from('customer_patients').delete().eq('id', patientId);
  if (res.error) throw res.error;
}

export async function setDefaultPatient(patientId: number): Promise<void> {
  const customerId = await getOrCreateCurrentCustomerId();
  if (!customerId) throw new Error('You must be signed in.');

  const clearRes = await supabase.from('customer_patients').update({ is_default: false }).eq('customer_id', customerId);
  if (clearRes.error) throw clearRes.error;

  const setRes = await supabase.from('customer_patients').update({ is_default: true }).eq('id', patientId).eq('customer_id', customerId);
  if (setRes.error) throw setRes.error;
}

