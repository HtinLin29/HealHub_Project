import type { PostgrestError } from '@supabase/supabase-js';
import { supabase } from './supabaseClient';
import { fetchProducts, fetchRecentOrders } from './dashboardService';
import { listOwnerRefundRequests } from './refundService';

/** Supabase client returns PostgrestError objects — not `instanceof Error` — so UI must normalize. */
function throwIfError(err: PostgrestError | null): asserts err is null {
  if (!err) return;
  const e = new Error(err.message || 'Database request failed');
  (e as Error & { code?: string; details?: string; hint?: string }).code = err.code;
  (e as Error & { details?: string }).details = err.details;
  (e as Error & { hint?: string }).hint = err.hint;
  throw e;
}

export type OwnerTodoPriority = 'low' | 'normal' | 'high';
export type OwnerTodoStatus = 'open' | 'done';
export type OwnerTodoSource = 'manual' | 'suggested';

export type OwnerTodo = {
  id: number;
  owner_user_id: string;
  title: string;
  notes: string | null;
  priority: OwnerTodoPriority;
  due_at: string | null;
  status: OwnerTodoStatus;
  source: OwnerTodoSource;
  linked_type: string | null;
  linked_id: string | null;
  created_at: string;
  completed_at: string | null;
};

export type TodoSuggestion = {
  key: string;
  title: string;
  subtitle: string;
  priority: OwnerTodoPriority;
  linked_type: string;
  linked_id: string;
  linkTo: string;
};

async function requireOwnerUserId(): Promise<string> {
  const { data: sessionData } = await supabase.auth.getSession();
  const authId = sessionData.session?.user?.id;
  if (!authId) throw new Error('Please sign in.');

  const { data: row, error } = await supabase.from('users').select('id, role').eq('auth_user_id', authId).maybeSingle();
  throwIfError(error);
  if (!row || String((row as { role?: unknown }).role) !== 'owner') {
    throw new Error('Owner access required.');
  }
  return String((row as { id: unknown }).id);
}

export async function listOwnerTodos(): Promise<OwnerTodo[]> {
  const ownerId = await requireOwnerUserId();
  const res = await supabase
    .from('owner_todos')
    .select('*')
    .eq('owner_user_id', ownerId)
    .order('created_at', { ascending: false })
    .limit(500);
  throwIfError(res.error);
  return (res.data ?? []) as OwnerTodo[];
}

export async function createOwnerTodo(input: {
  title: string;
  notes?: string | null;
  priority?: OwnerTodoPriority;
  due_at?: string | null;
  source?: OwnerTodoSource;
  linked_type?: string | null;
  linked_id?: string | null;
}): Promise<OwnerTodo> {
  const ownerId = await requireOwnerUserId();
  const res = await supabase
    .from('owner_todos')
    .insert({
      owner_user_id: ownerId,
      title: String(input.title).trim(),
      notes: input.notes ? String(input.notes).trim() : null,
      priority: input.priority ?? 'normal',
      due_at: input.due_at ?? null,
      status: 'open',
      source: input.source ?? 'manual',
      linked_type: input.linked_type ?? null,
      linked_id: input.linked_id ?? null,
    })
    .select()
    .single();
  throwIfError(res.error);
  return res.data as OwnerTodo;
}

export async function updateOwnerTodo(
  id: number,
  patch: Partial<{
    title: string;
    notes: string | null;
    priority: OwnerTodoPriority;
    due_at: string | null;
    status: OwnerTodoStatus;
  }>,
): Promise<void> {
  const ownerId = await requireOwnerUserId();
  const payload: Record<string, unknown> = {};
  if (patch.title !== undefined) payload.title = patch.title;
  if (patch.notes !== undefined) payload.notes = patch.notes;
  if (patch.priority !== undefined) payload.priority = patch.priority;
  if (patch.due_at !== undefined) payload.due_at = patch.due_at;
  if (patch.status !== undefined) {
    payload.status = patch.status;
    if (patch.status === 'done') payload.completed_at = new Date().toISOString();
    if (patch.status === 'open') payload.completed_at = null;
  }
  const res = await supabase.from('owner_todos').update(payload).eq('id', id).eq('owner_user_id', ownerId);
  throwIfError(res.error);
}

export async function deleteOwnerTodo(id: number): Promise<void> {
  const ownerId = await requireOwnerUserId();
  const res = await supabase.from('owner_todos').delete().eq('id', id).eq('owner_user_id', ownerId);
  throwIfError(res.error);
}

function hasOpenLink(open: OwnerTodo[], linked_type: string, linked_id: string): boolean {
  return open.some((t) => t.status === 'open' && t.linked_type === linked_type && t.linked_id === linked_id);
}

function fmtMoney(n: number): string {
  return `฿${Number(n || 0).toFixed(2)}`;
}

/**
 * Suggested tasks from live shop data (not inserted until owner adds them).
 */
export async function buildTodoSuggestions(openTodos: OwnerTodo[]): Promise<TodoSuggestion[]> {
  const open = openTodos.filter((t) => t.status === 'open');

  const [products, refunds, orders] = await Promise.all([
    fetchProducts(),
    listOwnerRefundRequests('pending'),
    fetchRecentOrders(50),
  ]);

  const suggestions: TodoSuggestion[] = [];

  for (const p of products) {
    if (p.stock <= p.low_stock_threshold) {
      const linked_type = 'product';
      const linked_id = String(p.id);
      if (hasOpenLink(open, linked_type, linked_id)) continue;
      suggestions.push({
        key: `product-${p.id}`,
        title: `Restock: ${p.name}`,
        subtitle: `Stock ${p.stock} · threshold ${p.low_stock_threshold}`,
        priority: p.stock === 0 ? 'high' : 'high',
        linked_type,
        linked_id,
        linkTo: '/owner/inventory',
      });
    }
  }

  for (const r of refunds) {
    const linked_type = 'refund';
    const linked_id = String(r.id);
    if (hasOpenLink(open, linked_type, linked_id)) continue;
    suggestions.push({
      key: `refund-${r.id}`,
      title: `Review refund #${r.id}`,
      subtitle: `Order #${r.order_id} · ${r.requested_amount != null ? fmtMoney(Number(r.requested_amount)) : 'amount TBD'}`,
      priority: 'high',
      linked_type,
      linked_id,
      linkTo: '/owner/refunds',
    });
  }

  const pendingOrders = orders.filter((o) => o.status === 'pending').slice(0, 15);
  for (const o of pendingOrders) {
    const linked_type = 'order';
    const linked_id = String(o.id);
    if (hasOpenLink(open, linked_type, linked_id)) continue;
    suggestions.push({
      key: `order-${o.id}`,
      title: `Follow up order #${o.id}`,
      subtitle: `Pending payment · ${fmtMoney(o.total_price)}`,
      priority: 'normal',
      linked_type,
      linked_id,
      linkTo: '/owner/fulfillment',
    });
  }

  return suggestions;
}
