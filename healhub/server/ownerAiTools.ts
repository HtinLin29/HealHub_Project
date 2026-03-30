/**
 * Allowlisted Supabase reads for Owner AI (runs with owner JWT — RLS applies).
 */
import type { SupabaseClient } from '@supabase/supabase-js';

const REVENUE_STATUSES = new Set(['paid', 'packed', 'shipped', 'delivered']);

/** Same display rule as `dashboardService.fetchRecentOrders`: linked user full_name, else email; optional order.customer_name if present in DB. */
function customerDisplayFromOrderRow(row: {
  customer_name?: unknown;
  users?: { full_name?: string | null; email?: string | null } | null;
}): string | null {
  const u = row.users;
  const nameFromUser = u?.full_name?.trim() || u?.email?.trim() || null;
  const nameFromOrder =
    row.customer_name != null && String(row.customer_name).trim() ? String(row.customer_name).trim() : null;
  return nameFromUser || nameFromOrder;
}

const OWNER_AI_RECENT_ORDERS_LIMIT = Math.min(200, Math.max(12, Number(process.env.OWNER_AI_RECENT_ORDERS_LIMIT || 45)));

/** Max size of JSON payload object (analytics + tools + hints) before joining instruction header. */
const OWNER_AI_PAYLOAD_JSON_MAX = Number(process.env.OWNER_AI_PAYLOAD_JSON_MAX || 8_800);

function normalizeOrderStatus(raw: unknown): string {
  const rawStr = String(raw ?? 'pending').toLowerCase();
  if (rawStr === 'completed' || rawStr === 'complete') return 'delivered';
  if (rawStr === 'processing') return 'paid';
  if (rawStr === 'cancel' || rawStr === 'canceled') return 'cancelled';
  if (['pending', 'paid', 'packed', 'shipped', 'delivered', 'cancelled'].includes(rawStr)) return rawStr;
  return 'pending';
}

function isRevenueStatus(status: unknown): boolean {
  return REVENUE_STATUSES.has(normalizeOrderStatus(status) as 'paid');
}

function daysAgoIso(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString();
}

export type AnalyticsSnapshot = {
  generatedAt: string;
  source: 'supabase';
  kpis: { totalOrders: number; totalRevenue: number; totalStock: number };
  monthlyRevenue: { month: string; revenue: number }[];
  /** Same columns as Owner Analytics recent-orders table (customer = display name in UI). */
  recentOrders: { id: number; status: string; total: number; created_at: string | null; customer: string | null }[];
  orders: {
    byStatus: Record<string, number>;
    last7DaysRevenue: number;
    last30DaysRevenue: number;
    last30DaysOrderCount: number;
  };
  products: {
    activeCount: number;
    inactiveCount: number;
    totalStockUnits: number;
    /** Sum(price × stock) over ALL product rows — same as owner Inventory page total. */
    inventoryValueAtListPrice: number;
    lowStockSample: { name: string; stock: number; threshold: number }[];
    inactiveProductsSample: {
      id: number;
      name: string;
      category: string | null;
      stock: number;
      price: number;
    }[];
    byCategory: Record<string, number>;
  };
  refunds: { pending: number; total: number } | null;
  /** Each pending refund with customer display name when available — use for "who" / "names" questions. */
  pendingRefundRequests: {
    refundId: number;
    orderId: number;
    customerDisplayName: string | null;
    reason: string;
    requestedAmount: number | null;
    createdAt: string | null;
  }[];
  customers: { count: number } | null;
  /** Total rows in customer_patients — use for "how many patients in CRM" (same scope as CRM patient list). */
  patients: { count: number } | null;
  chat: { conversations: number } | null;
  topProductsByUnits: { name: string; units: number }[];
  /** Precomputed in Node — prefer these for math instead of asking the model to divide large numbers. */
  derived: {
    revenueEligibleOrderCount: number;
    avgRevenuePerRevenueOrder: number;
    last7Days: { revenueOrderCount: number; avgRevenuePerRevenueOrder: number };
    last30Days: { revenueOrderCount: number; avgRevenuePerRevenueOrder: number };
    monthlyRevenueMomChangePct: number | null;
  };
  /** Global latest order by id (not limited to recentOrders window). */
  meta: {
    highestOrderId: number | null;
    highestOrderCreatedAt: string | null;
  };
  /** Live HealHub owner data (same DB as the owner app; RLS applies). */
  crmNotesRecent: { id: number; customerId: string; notePreview: string; createdAt: string | null }[];
  ownerTodosRecent: { id: number; title: string; status: string; priority: string; dueAt: string | null; createdAt: string | null }[];
  /** May be empty if RLS only allows customers to read their own patients. */
  patientsSample: {
    id: number;
    customerId: string;
    fullName: string;
    age: number | null;
    gender: string | null;
    allergy: string | null;
    /** Orders linked to this patient (same idea as CRM purchase history count). */
    purchaseOrderCount: number;
  }[];
  /** Product lines per pending refund order — always loaded when pendingRefundRequests is non-empty. */
  pendingRefundOrderLines: { refundId: number; orderId: number; lines: { productName: string; quantity: number }[] }[];
};

async function fetchKpis(supabase: SupabaseClient) {
  const [{ count: totalOrders }, revenueRes, stockRes] = await Promise.all([
    supabase.from('orders').select('id', { count: 'exact', head: true }),
    supabase.from('orders').select('total_price, status'),
    supabase.from('products').select('stock, is_active').eq('is_active', true),
  ]);

  const revenueRows = revenueRes.data ?? [];
  const totalRevenue = revenueRows.reduce((sum, row: { total_price?: unknown; status?: unknown }) => {
    if (!isRevenueStatus(row.status)) return sum;
    return sum + Number(row.total_price ?? 0);
  }, 0);

  const stockRows = stockRes.data ?? [];
  const totalStock = stockRows.reduce((sum, row: { stock?: unknown }) => sum + Number(row.stock ?? 0), 0);

  return {
    totalOrders: totalOrders ?? 0,
    totalRevenue,
    totalStock,
  };
}

async function fetchProducts(supabase: SupabaseClient) {
  const { data, error } = await supabase
    .from('products')
    .select('id, name, category, price, stock, low_stock_threshold, is_active')
    .eq('is_active', true)
    .order('id', { ascending: false });

  if (error) throw error;
  return (data ?? []).map((p: { low_stock_threshold?: unknown; [k: string]: unknown }) => ({
    ...p,
    low_stock_threshold: Number(p.low_stock_threshold ?? 10),
  }));
}

async function fetchHighestOrderMeta(supabase: SupabaseClient) {
  const { data, error } = await supabase.from('orders').select('id, created_at').order('id', { ascending: false }).limit(1).maybeSingle();
  if (error || !data) return { highestOrderId: null as number | null, highestOrderCreatedAt: null as string | null };
  const row = data as { id?: unknown; created_at?: unknown };
  const id = Number(row.id ?? 0);
  return {
    highestOrderId: Number.isFinite(id) && id > 0 ? id : null,
    highestOrderCreatedAt: row.created_at != null ? String(row.created_at) : null,
  };
}

/** Matches owner `dashboardService.fetchRecentOrders` — do not select columns that may not exist on `orders` (e.g. customer_name). */
async function fetchRecentOrdersForAi(supabase: SupabaseClient, limit: number) {
  const q = supabase
    .from('orders')
    .select('id, total_price, status, created_at, users(full_name, email)')
    .order('created_at', { ascending: false })
    .limit(limit);

  const { data, error } = await q;

  if (error) {
    const fb = await supabase
      .from('orders')
      .select('id, total_price, status, created_at')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (fb.error) throw fb.error;
    return (fb.data ?? []).map((row: Record<string, unknown>) => ({
      id: Number(row.id),
      status: normalizeOrderStatus(row.status),
      total_price: Number(row.total_price ?? 0),
      created_at: row.created_at as string | null,
      customer: null,
    }));
  }

  return (data ?? []).map((row: Record<string, unknown>) => ({
    id: Number(row.id),
    status: normalizeOrderStatus(row.status),
    total_price: Number(row.total_price ?? 0),
    created_at: row.created_at as string | null,
    customer: customerDisplayFromOrderRow({
      customer_name: row.customer_name,
      users: row.users as { full_name?: string | null; email?: string | null } | null,
    }),
  }));
}

async function fetchMonthlyRevenue(supabase: SupabaseClient) {
  const { data, error } = await supabase.from('orders').select('created_at, total_price, status').order('created_at', { ascending: true }).limit(10000);

  if (error) throw error;

  const grouped = new Map<string, number>();
  for (const row of data ?? []) {
    const r = row as { created_at?: string; total_price?: unknown; status?: unknown };
    if (!isRevenueStatus(r.status)) continue;
    const createdAt = String(r.created_at ?? '');
    if (!createdAt) continue;
    const dt = new Date(createdAt);
    if (Number.isNaN(dt.getTime())) continue;
    const month = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`;
    grouped.set(month, (grouped.get(month) ?? 0) + Number(r.total_price ?? 0));
  }

  return Array.from(grouped.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, revenue]) => ({ month, revenue }));
}

async function countOrdersByStatus(supabase: SupabaseClient): Promise<Record<string, number>> {
  const statuses = ['pending', 'paid', 'packed', 'shipped', 'delivered', 'cancelled'] as const;
  const results = await Promise.all(
    statuses.map(async (s) => {
      const { count, error } = await supabase.from('orders').select('id', { count: 'exact', head: true }).eq('status', s);
      if (error) return [s, 0] as const;
      return [s, count ?? 0] as const;
    }),
  );
  return Object.fromEntries(results);
}

async function sumRevenueSince(supabase: SupabaseClient, iso: string) {
  const { data, error } = await supabase.from('orders').select('total_price, status, created_at').gte('created_at', iso).limit(15000);

  if (error || !data) return { revenue: 0, orderCount: 0, revenueOrderCount: 0 };

  let revenue = 0;
  let orderCount = 0;
  let revenueOrderCount = 0;
  for (const row of data) {
    orderCount += 1;
    if (isRevenueStatus((row as { status?: unknown }).status)) {
      revenue += Number((row as { total_price?: unknown }).total_price ?? 0);
      revenueOrderCount += 1;
    }
  }
  return { revenue, orderCount, revenueOrderCount };
}

async function fetchRefundStats(supabase: SupabaseClient) {
  const [pendingRes, totalRes] = await Promise.all([
    supabase.from('order_refund_requests').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
    supabase.from('order_refund_requests').select('id', { count: 'exact', head: true }),
  ]);
  if (pendingRes.error || totalRes.error) return null;
  return { pending: pendingRes.count ?? 0, total: totalRes.count ?? 0 };
}

async function fetchPendingRefundDetails(supabase: SupabaseClient): Promise<AnalyticsSnapshot['pendingRefundRequests']> {
  const { data, error } = await supabase
    .from('order_refund_requests')
    .select('id, order_id, reason, requested_amount, created_at, customer_id')
    .eq('status', 'pending')
    .order('created_at', { ascending: false })
    .limit(100);

  if (error || !data?.length) return [];

  const customerIds = [...new Set(data.map((r: { customer_id?: string | null }) => r.customer_id).filter(Boolean))] as string[];
  let nameById = new Map<string, string | null>();
  if (customerIds.length > 0) {
    const { data: userRows, error: uErr } = await supabase.from('users').select('id, full_name').in('id', customerIds);
    if (!uErr && userRows) {
      nameById = new Map(
        (userRows as { id: string; full_name?: string | null }[]).map((u) => [u.id, u.full_name?.trim() ? u.full_name.trim() : null]),
      );
    }
  }

  return (data as { id: unknown; order_id: unknown; reason?: unknown; requested_amount?: unknown; created_at?: unknown; customer_id?: string | null }[]).map(
    (r) => ({
      refundId: Number(r.id),
      orderId: Number(r.order_id),
      customerDisplayName: r.customer_id ? nameById.get(r.customer_id) ?? null : null,
      reason: String(r.reason ?? ''),
      requestedAmount: r.requested_amount != null && r.requested_amount !== '' ? Number(r.requested_amount) : null,
      createdAt: r.created_at != null ? String(r.created_at) : null,
    }),
  );
}

async function fetchCustomerCount(supabase: SupabaseClient): Promise<number | null> {
  const { count, error } = await supabase.from('users').select('id', { count: 'exact', head: true }).eq('role', 'customer');
  if (error) return null;
  return count ?? 0;
}

async function fetchPatientCount(supabase: SupabaseClient): Promise<number | null> {
  const { count, error } = await supabase.from('customer_patients').select('id', { count: 'exact', head: true });
  if (error) return null;
  return count ?? 0;
}

async function fetchConversationCount(supabase: SupabaseClient): Promise<number | null> {
  const { count, error } = await supabase.from('order_conversations').select('id', { count: 'exact', head: true });
  if (error) return null;
  return count ?? 0;
}

async function fetchInactiveProductCount(supabase: SupabaseClient): Promise<number> {
  const { count, error } = await supabase.from('products').select('id', { count: 'exact', head: true }).eq('is_active', false);
  if (error) return 0;
  return count ?? 0;
}

async function fetchInactiveProductsSample(supabase: SupabaseClient, limit: number): Promise<AnalyticsSnapshot['products']['inactiveProductsSample']> {
  const { data, error } = await supabase
    .from('products')
    .select('id, name, category, stock, price')
    .eq('is_active', false)
    .order('id', { ascending: false })
    .limit(limit);
  if (error || !data) return [];
  return (data as { id?: unknown; name?: unknown; category?: unknown; stock?: unknown; price?: unknown }[]).map((p) => ({
    id: Number(p.id ?? 0),
    name: String(p.name ?? ''),
    category: p.category != null && String(p.category).trim() ? String(p.category).trim() : null,
    stock: Number(p.stock ?? 0),
    price: Number(p.price ?? 0),
  }));
}

async function fetchTopProductsByUnits(supabase: SupabaseClient, limit: number) {
  const { data, error } = await supabase.from('order_items').select('quantity, product_id, products(name)').limit(12000);

  if (error || !data?.length) return [];

  const map = new Map<string, number>();
  for (const row of data as { quantity?: number; products?: { name?: string } | null }[]) {
    const q = Number(row.quantity ?? 0);
    if (q <= 0) continue;
    const name = String(row.products?.name ?? 'Unknown product').trim() || 'Unknown product';
    map.set(name, (map.get(name) ?? 0) + q);
  }

  return [...map.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([name, units]) => ({ name, units }));
}

function categoryBreakdown(products: { category?: string | null }[]): Record<string, number> {
  const totals = new Map<string, number>();
  for (const p of products) {
    const c = (p.category ?? '').trim() || 'Uncategorized';
    totals.set(c, (totals.get(c) ?? 0) + 1);
  }
  return Object.fromEntries(totals);
}

/** Matches InventoryPage total: Σ (price × stock) for every row in products (active + inactive). */
async function fetchInventoryValueAtListPrice(supabase: SupabaseClient): Promise<number> {
  const { data, error } = await supabase.from('products').select('price, stock');
  if (error || !data?.length) return 0;
  let sum = 0;
  for (const row of data as { price?: unknown; stock?: unknown }[]) {
    sum += Number(row.price ?? 0) * Number(row.stock ?? 0);
  }
  return Math.round(sum * 100) / 100;
}

async function fetchCrmNotesRecent(supabase: SupabaseClient, limit: number): Promise<AnalyticsSnapshot['crmNotesRecent']> {
  const { data, error } = await supabase
    .from('crm_notes')
    .select('id, customer_id, note, created_at')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error || !data?.length) return [];

  return (data as { id?: unknown; customer_id?: unknown; note?: unknown; created_at?: unknown }[]).map((r) => ({
    id: Number(r.id),
    customerId: String(r.customer_id ?? ''),
    notePreview: String(r.note ?? '').slice(0, 400),
    createdAt: r.created_at != null ? String(r.created_at) : null,
  }));
}

async function fetchOwnerTodosRecent(supabase: SupabaseClient, limit: number): Promise<AnalyticsSnapshot['ownerTodosRecent']> {
  const { data, error } = await supabase
    .from('owner_todos')
    .select('id, title, status, priority, due_at, created_at')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error || !data?.length) return [];

  return (data as { id?: unknown; title?: unknown; status?: unknown; priority?: unknown; due_at?: unknown; created_at?: unknown }[]).map((r) => ({
    id: Number(r.id),
    title: String(r.title ?? ''),
    status: String(r.status ?? ''),
    priority: String(r.priority ?? ''),
    dueAt: r.due_at != null ? String(r.due_at) : null,
    createdAt: r.created_at != null ? String(r.created_at) : null,
  }));
}

async function fetchOrderCountsByPatientIds(supabase: SupabaseClient, patientIds: number[]): Promise<Map<number, number>> {
  const map = new Map<number, number>();
  if (patientIds.length === 0) return map;
  const { data, error } = await supabase.from('orders').select('patient_id').in('patient_id', patientIds);
  if (error || !data) return map;
  for (const row of data as { patient_id?: unknown }[]) {
    const pid = Number(row.patient_id);
    if (!Number.isFinite(pid) || pid <= 0) continue;
    map.set(pid, (map.get(pid) ?? 0) + 1);
  }
  return map;
}

async function fetchPatientsSample(supabase: SupabaseClient, limit: number): Promise<AnalyticsSnapshot['patientsSample']> {
  const { data, error } = await supabase
    .from('customer_patients')
    .select('id, customer_id, full_name, age, gender, allergy')
    .order('id', { ascending: false })
    .limit(limit);

  if (error || !data?.length) return [];

  const rows = (data as { id?: unknown; customer_id?: unknown; full_name?: unknown; age?: unknown; gender?: unknown; allergy?: unknown }[]).map((r) => ({
    id: Number(r.id),
    customerId: String(r.customer_id ?? ''),
    fullName: String(r.full_name ?? ''),
    age: r.age != null && r.age !== '' ? Number(r.age) : null,
    gender: r.gender != null && String(r.gender).trim() ? String(r.gender).trim() : null,
    allergy: r.allergy != null && String(r.allergy).trim() ? String(r.allergy).trim() : null,
    purchaseOrderCount: 0,
  }));

  const ids = rows.map((r) => r.id);
  const counts = await fetchOrderCountsByPatientIds(supabase, ids);
  return rows.map((r) => ({
    ...r,
    purchaseOrderCount: counts.get(r.id) ?? 0,
  }));
}

function escapeIlikePattern(fragment: string): string {
  return fragment.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

async function fetchPatientLookupByName(supabase: SupabaseClient, hint: string): Promise<NonNullable<ToolResults['patientLookup']>['matches']> {
  const q = hint.trim().replace(/_/g, ' ');
  if (q.length < 2) return [];

  const { data, error } = await supabase
    .from('customer_patients')
    .select('id, customer_id, full_name, age, gender, allergy')
    .ilike('full_name', `%${escapeIlikePattern(q)}%`)
    .limit(20);

  if (error || !data?.length) return [];

  const rows = (data as { id?: unknown; customer_id?: unknown; full_name?: unknown; age?: unknown; gender?: unknown; allergy?: unknown }[]).map((r) => ({
    patientId: Number(r.id),
    customerId: String(r.customer_id ?? ''),
    fullName: String(r.full_name ?? ''),
    age: r.age != null && r.age !== '' ? Number(r.age) : null,
    gender: r.gender != null && String(r.gender).trim() ? String(r.gender).trim() : null,
    allergy: r.allergy != null && String(r.allergy).trim() ? String(r.allergy).trim() : null,
    purchaseOrderCount: 0,
  }));

  const ids = rows.map((r) => r.patientId);
  const counts = await fetchOrderCountsByPatientIds(supabase, ids);
  return rows.map((r) => ({
    ...r,
    purchaseOrderCount: counts.get(r.patientId) ?? 0,
  }));
}

/** Extract a person name from transcript (e.g. Htin_Lin, Htin Lin) for patient lookup. */
function extractPatientNameHint(blob: string): string | null {
  const under = blob.match(/\b([A-Za-z]{2,}(?:_[A-Za-z]+)+)\b/g);
  if (under?.length) {
    return under[under.length - 1].replace(/_/g, ' ').trim();
  }
  const cap = [...blob.matchAll(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\b/g)];
  if (cap.length) return cap[cap.length - 1][1];
  return null;
}

/** Follow-ups like "his allergy" or explicit questions about a named patient's profile / purchase count. */
function wantsPatientLookupIntent(lastUser: string, transcript: string): boolean {
  const blob = `${lastUser}\n${transcript}`.toLowerCase();
  return /\ballergy|allergies|allergic|gender|purchase\s+history|purchase\s+count|purchases?\b|how\s+many\s+(purchases?|orders?)|patient\s+profile|his\b|her\b|their\b/i.test(blob);
}

export async function fetchAnalyticsSnapshot(supabase: SupabaseClient): Promise<AnalyticsSnapshot> {
  const generatedAt = new Date().toISOString();

  const [
    kpis,
    products,
    recentOrderRows,
    monthlyRevenue,
    byStatus,
    last7,
    last30,
    inactiveCount,
    inactiveProductsSample,
    refunds,
    pendingRefundRequests,
    customerCount,
    patientCount,
    chatCount,
    topProductsByUnits,
    highestMeta,
    inventoryValueAtListPrice,
    crmNotesRecent,
    ownerTodosRecent,
    patientsSample,
  ] = await Promise.all([
    fetchKpis(supabase),
    fetchProducts(supabase),
    fetchRecentOrdersForAi(supabase, OWNER_AI_RECENT_ORDERS_LIMIT),
    fetchMonthlyRevenue(supabase),
    countOrdersByStatus(supabase),
    sumRevenueSince(supabase, daysAgoIso(7)),
    sumRevenueSince(supabase, daysAgoIso(30)),
    fetchInactiveProductCount(supabase),
    fetchInactiveProductsSample(supabase, 20),
    fetchRefundStats(supabase),
    fetchPendingRefundDetails(supabase),
    fetchCustomerCount(supabase),
    fetchPatientCount(supabase),
    fetchConversationCount(supabase),
    fetchTopProductsByUnits(supabase, 12),
    fetchHighestOrderMeta(supabase),
    fetchInventoryValueAtListPrice(supabase),
    fetchCrmNotesRecent(supabase, 12),
    fetchOwnerTodosRecent(supabase, 12),
    fetchPatientsSample(supabase, 40),
  ]);

  const lowStockSample = [...products]
    .filter((p: { stock: number; low_stock_threshold: number }) => p.stock <= (p.low_stock_threshold ?? 10))
    .sort((a: { stock: number }, b: { stock: number }) => Number(a.stock) - Number(b.stock))
    .slice(0, 10)
    .map((p: { name: string; stock: number; low_stock_threshold: number }) => ({
      name: p.name,
      stock: p.stock,
      threshold: p.low_stock_threshold ?? 10,
    }));

  const revenueEligibleOrderCount =
    (byStatus.paid ?? 0) + (byStatus.packed ?? 0) + (byStatus.shipped ?? 0) + (byStatus.delivered ?? 0);
  const avgRevenuePerRevenueOrder =
    revenueEligibleOrderCount > 0 ? kpis.totalRevenue / revenueEligibleOrderCount : 0;

  const last7Avg = last7.revenueOrderCount > 0 ? last7.revenue / last7.revenueOrderCount : 0;
  const last30Avg = last30.revenueOrderCount > 0 ? last30.revenue / last30.revenueOrderCount : 0;

  let monthlyRevenueMomChangePct: number | null = null;
  if (monthlyRevenue.length >= 2) {
    const a = monthlyRevenue[monthlyRevenue.length - 2]?.revenue ?? 0;
    const b = monthlyRevenue[monthlyRevenue.length - 1]?.revenue ?? 0;
    if (a > 0) monthlyRevenueMomChangePct = ((b - a) / a) * 100;
  }

  const pendingRefundOrderLines =
    pendingRefundRequests.length > 0
      ? await fetchPendingRefundOrderLines(supabase, pendingRefundRequests, 12)
      : [];

  return {
    generatedAt,
    source: 'supabase',
    kpis,
    monthlyRevenue,
    recentOrders: recentOrderRows.map((o) => ({
      id: o.id,
      status: o.status,
      total: o.total_price,
      created_at: o.created_at ?? null,
      customer: o.customer ?? null,
    })),
    orders: {
      byStatus,
      last7DaysRevenue: last7.revenue,
      last30DaysRevenue: last30.revenue,
      last30DaysOrderCount: last30.orderCount,
    },
    products: {
      activeCount: products.length,
      inactiveCount,
      totalStockUnits: kpis.totalStock,
      inventoryValueAtListPrice,
      lowStockSample,
      inactiveProductsSample,
      byCategory: categoryBreakdown(products),
    },
    refunds,
    pendingRefundRequests,
    customers: customerCount === null ? null : { count: customerCount },
    patients: patientCount === null ? null : { count: patientCount },
    chat: chatCount === null ? null : { conversations: chatCount },
    topProductsByUnits,
    derived: {
      revenueEligibleOrderCount,
      avgRevenuePerRevenueOrder,
      last7Days: { revenueOrderCount: last7.revenueOrderCount, avgRevenuePerRevenueOrder: last7Avg },
      last30Days: { revenueOrderCount: last30.revenueOrderCount, avgRevenuePerRevenueOrder: last30Avg },
      monthlyRevenueMomChangePct,
    },
    meta: {
      highestOrderId: highestMeta.highestOrderId,
      highestOrderCreatedAt: highestMeta.highestOrderCreatedAt,
    },
    crmNotesRecent,
    ownerTodosRecent,
    patientsSample,
    pendingRefundOrderLines,
  };
}

/** Mask email for AI context: j***@d***.com style */
function maskEmail(email: string | null | undefined): string | null {
  if (!email || !email.includes('@')) return null;
  const [local, domain] = email.split('@');
  if (!local || !domain) return null;
  const dParts = domain.split('.');
  const domMain = dParts[0] ?? '';
  const localMask = local.length <= 1 ? '*' : `${local.slice(0, 1)}***`;
  return `${localMask}@${domMain.slice(0, 1)}***.${dParts.slice(1).join('.') || '***'}`;
}

export type ToolResults = {
  orderDetail?: {
    order: Record<string, unknown>;
    lines: { productName: string; quantity: number; lineTotal: number }[];
    linesSum?: number;
    orderTotal?: number;
  };
  ordersInRange?: {
    from: string;
    to: string;
    rows: { id: number; status: string; total: number; created_at: string | null }[];
    aggregate?: { count: number; sumTotal: number; avgTotal: number };
  };
  customerSummary?: {
    userId: string;
    role: string | null;
    emailMasked: string | null;
    fullName: string | null;
    orderCount: number;
    lastOrderAt: string | null;
  };
  customerOfOrder?: {
    orderId: number;
    customerId: string | null;
    customerName: string | null;
    emailMasked: string | null;
  };
  /** Recent orders with delivery fields — for fulfillment / tracking questions */
  deliveryBoard?: {
    rows: {
      id: number;
      status: string;
      delivery_status: string | null;
      total: number;
      tracking_id: string | null;
      courier_provider: string | null;
      created_at: string | null;
    }[];
  };
  /** Name search (allergy / purchase history follow-ups) */
  patientLookup?: {
    queryUsed: string;
    matches: {
      patientId: number;
      customerId: string;
      fullName: string;
      age: number | null;
      gender: string | null;
      allergy: string | null;
      purchaseOrderCount: number;
    }[];
  };
};

function slimToolResultsPayload(tools: ToolResults): ToolResults {
  const t: ToolResults = { ...tools };
  if (t.deliveryBoard?.rows?.length) {
    t.deliveryBoard = { rows: t.deliveryBoard.rows.slice(0, 10) };
  }
  if (t.ordersInRange?.rows?.length) {
    t.ordersInRange = { ...t.ordersInRange, rows: t.ordersInRange.rows.slice(0, 20) };
  }
  if (t.orderDetail?.lines?.length) {
    t.orderDetail = { ...t.orderDetail, lines: t.orderDetail.lines.slice(0, 24) };
  }
  if (t.patientLookup?.matches?.length) {
    t.patientLookup = { ...t.patientLookup, matches: t.patientLookup.matches.slice(0, 6) };
  }
  return t;
}

/** Last-mentioned order id in transcript (follow-ups: "what products" after "order #59"). */
function extractLastOrderId(blob: string): number | null {
  const patterns = [/\b(?:order\s*#?|#)\s*(\d{1,12})\b/gi, /\border\s+(?:no\.?|number|id)\s*(\d{1,12})\b/gi];
  let best: number | null = null;
  let bestEnd = -1;
  for (const reSrc of patterns) {
    const r = new RegExp(reSrc.source, reSrc.flags);
    let m: RegExpExecArray | null;
    while ((m = r.exec(blob)) !== null) {
      const end = m.index + m[0].length;
      if (end > bestEnd) {
        bestEnd = end;
        best = parseInt(m[1], 10);
      }
    }
  }
  return best;
}

function extractLastUuid(blob: string): string | null {
  const re = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
  let best: string | null = null;
  let bestEnd = -1;
  let m: RegExpExecArray | null;
  while ((m = re.exec(blob)) !== null) {
    const end = m.index + m[0].length;
    if (end > bestEnd) {
      bestEnd = end;
      best = m[0];
    }
  }
  return best;
}

function parseUuid(text: string): string | null {
  const m = text.match(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i);
  return m ? m[0] : null;
}

function parseRelativeDateRange(text: string): { from: string; to: string } | null {
  const lower = text.toLowerCase();
  const now = new Date();
  const to = now.toISOString();
  if (/\blast\s+7\s+days?\b|\bpast\s+week\b|\blast\s+week\b/.test(lower)) {
    const d = new Date(now);
    d.setDate(d.getDate() - 7);
    return { from: d.toISOString(), to };
  }
  if (/\blast\s+30\s+days?\b|\bpast\s+month\b|\blast\s+month\b/.test(lower)) {
    const d = new Date(now);
    d.setDate(d.getDate() - 30);
    return { from: d.toISOString(), to };
  }
  if (/\blast\s+24\s+hours?\b|\btoday\b|\bthis\s+day\b/.test(lower)) {
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);
    return { from: d.toISOString(), to };
  }
  return null;
}

function wantsOrderListIntent(text: string): boolean {
  const lower = text.toLowerCase();
  return (
    /\borders?\s+(in|from|during|between|last)\b/.test(lower) ||
    /\borders?\s+last\b/.test(lower) ||
    /\blist\s+orders?\b/.test(lower) ||
    /\border\s+history\b/.test(lower) ||
    (parseRelativeDateRange(text) !== null && /\border/.test(lower))
  );
}

function wantsCustomerIntent(text: string): boolean {
  const lower = text.toLowerCase();
  return /\bcustomer\b/.test(lower) || /\buser\b/.test(lower) || parseUuid(text) !== null;
}

function wantsLastOrderReference(text: string): boolean {
  const lower = text.toLowerCase();
  return /\b(last|latest)\s+(order|sale)\b/.test(lower) || /\bthat\s+(order|sale)\b/.test(lower);
}

function wantsDeliveryIntent(text: string): boolean {
  const lower = text.toLowerCase();
  return (
    /\b(delivery|deliver|delivered|shipping|ship|fulfillment|fulfil|tracking|track|courier|packed|transit|dispatch)\b/.test(lower) ||
    (/\blast\b/.test(lower) && /\b(order|orders)\b/.test(lower) && /\b(deliver|ship|fulfill|dispatch)\b/.test(lower))
  );
}

async function fetchDeliveryBoard(supabase: SupabaseClient, limit: number): Promise<NonNullable<ToolResults['deliveryBoard']>> {
  const { data, error } = await supabase
    .from('orders')
    .select('id, status, total_price, created_at, delivery_status, tracking_id, courier_provider')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error || !data) {
    console.warn('[owner-ai] deliveryBoard query failed', error?.message ?? 'no data');
    return { rows: [] };
  }

  return {
    rows: (data as Record<string, unknown>[]).map((row) => ({
      id: Number(row.id),
      status: normalizeOrderStatus(row.status),
      delivery_status: row.delivery_status != null ? String(row.delivery_status) : null,
      total: Number(row.total_price ?? 0),
      tracking_id: row.tracking_id != null ? String(row.tracking_id) : null,
      courier_provider: row.courier_provider != null ? String(row.courier_provider) : null,
      created_at: row.created_at != null ? String(row.created_at) : null,
    })),
  };
}

async function fetchPendingRefundOrderLines(
  supabase: SupabaseClient,
  pending: AnalyticsSnapshot['pendingRefundRequests'],
  maxOrders: number,
): Promise<AnalyticsSnapshot['pendingRefundOrderLines']> {
  if (!pending?.length) return [];
  const slice = pending.slice(0, maxOrders);
  const orderIds = slice.map((p) => p.orderId);
  const { data, error } = await supabase.from('order_items').select('order_id, quantity, products(name)').in('order_id', orderIds);

  if (error || !data) return [];

  const byOrder = new Map<number, { productName: string; quantity: number }[]>();
  for (const row of data as { order_id?: unknown; quantity?: unknown; products?: { name?: string } | null }[]) {
    const oid = Number(row.order_id);
    const name = String(row.products?.name ?? 'Unknown').trim() || 'Unknown';
    const qty = Number(row.quantity ?? 0);
    if (!byOrder.has(oid)) byOrder.set(oid, []);
    byOrder.get(oid)!.push({ productName: name, quantity: qty });
  }

  return slice.map((p) => ({
    refundId: p.refundId,
    orderId: p.orderId,
    lines: byOrder.get(p.orderId) ?? [],
  }));
}

export async function runOwnerAiTools(
  supabase: SupabaseClient,
  lastUserText: string,
  conversationContext = '',
): Promise<{ systemContent: string }> {
  const analyticsSnapshot = await fetchAnalyticsSnapshot(supabase);
  const tools: ToolResults = {};

  const trimmed = (lastUserText || '').trim();
  const transcript = `${conversationContext}\n${trimmed}`.trim();

  const parsedOrderId = extractLastOrderId(transcript);
  const effectiveOrderId = parsedOrderId ?? (wantsLastOrderReference(trimmed) ? analyticsSnapshot.meta.highestOrderId : null);
  if (effectiveOrderId !== null) {
    let ord: Record<string, unknown> | null = null;
    let ordErr: { message?: string } | null = null;
    const withJoin = await supabase
      .from('orders')
      .select('id, status, total_price, created_at, delivery_status, customer_id, users(full_name, email)')
      .eq('id', effectiveOrderId)
      .maybeSingle();
    if (withJoin.error) {
      const plain = await supabase
        .from('orders')
        .select('id, status, total_price, created_at, delivery_status, customer_id')
        .eq('id', effectiveOrderId)
        .maybeSingle();
      ordErr = plain.error;
      ord = (plain.data as Record<string, unknown>) ?? null;
    } else {
      ord = (withJoin.data as Record<string, unknown>) ?? null;
    }

    if (!ordErr && ord) {
      const { data: items, error: itemsErr } = await supabase
        .from('order_items')
        .select('quantity, unit_price, line_total, products(name)')
        .eq('order_id', effectiveOrderId);

      const lines =
        itemsErr || !items
          ? []
          : (items as { quantity?: number; unit_price?: number; line_total?: number; products?: { name?: string } | null }[]).map((it) => ({
              productName: String(it.products?.name ?? 'Unknown'),
              quantity: Number(it.quantity ?? 0),
              lineTotal: Number(it.line_total ?? 0),
            }));

      const orderTotal = Number((ord as { total_price?: unknown }).total_price ?? 0);
      const linesSum = lines.reduce((s, l) => s + l.lineTotal, 0);
      tools.orderDetail = {
        order: ord as Record<string, unknown>,
        lines,
        linesSum,
        orderTotal,
      };

      if (wantsCustomerIntent(trimmed)) {
        const ordObj = ord as {
          id?: unknown;
          customer_id?: unknown;
          customer_name?: unknown;
          users?: { full_name?: string | null; email?: string | null } | null;
        };
        const customerId = ordObj.customer_id ? String(ordObj.customer_id) : null;
        const resolvedCustomerName = customerDisplayFromOrderRow({
          customer_name: ordObj.customer_name,
          users: ordObj.users ?? null,
        });
        let resolvedEmailMasked: string | null = null;
        if (customerId && !ordObj.users) {
          const { data: u } = await supabase
            .from('users')
            .select('full_name, email')
            .eq('id', customerId)
            .maybeSingle();
          if (u) resolvedEmailMasked = maskEmail((u as { email?: string | null }).email ?? null);
        } else if (ordObj.users) {
          resolvedEmailMasked = maskEmail(ordObj.users.email ?? null);
        }

        tools.customerOfOrder = {
          orderId: Number(ordObj.id ?? effectiveOrderId),
          customerId,
          customerName: resolvedCustomerName,
          emailMasked: resolvedEmailMasked,
        };
      }
    }
  }

  const range = parseRelativeDateRange(trimmed);
  if (range && (wantsOrderListIntent(trimmed) || (tools.orderDetail === undefined && /\border/.test(trimmed.toLowerCase())))) {
    const { data: rows, error } = await supabase
      .from('orders')
      .select('id, status, total_price, created_at')
      .gte('created_at', range.from)
      .lte('created_at', range.to)
      .order('id', { ascending: false })
      .limit(80);

    if (!error && rows) {
      const mapped = rows.map((r: { id?: unknown; status?: unknown; total_price?: unknown; created_at?: unknown }) => ({
        id: Number(r.id),
        status: normalizeOrderStatus(r.status),
        total: Number(r.total_price ?? 0),
        created_at: (r.created_at as string) ?? null,
      }));
      const sumTotal = mapped.reduce((s, r) => s + r.total, 0);
      const count = mapped.length;
      tools.ordersInRange = {
        from: range.from,
        to: range.to,
        rows: mapped,
        aggregate: { count, sumTotal, avgTotal: count > 0 ? sumTotal / count : 0 },
      };
    }
  }

  const uuid = wantsCustomerIntent(trimmed) ? extractLastUuid(transcript) : null;
  if (uuid) {
    const { data: u, error: uErr } = await supabase.from('users').select('id, role, email, full_name').eq('id', uuid).maybeSingle();

    if (!uErr && u) {
      const { count: oc } = await supabase.from('orders').select('id', { count: 'exact', head: true }).eq('customer_id', uuid);

      const { data: lastOrd } = await supabase
        .from('orders')
        .select('created_at')
        .eq('customer_id', uuid)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      tools.customerSummary = {
        userId: uuid,
        role: (u as { role?: string }).role ?? null,
        emailMasked: maskEmail((u as { email?: string }).email),
        fullName: (u as { full_name?: string | null }).full_name ?? null,
        orderCount: oc ?? 0,
        lastOrderAt: (lastOrd as { created_at?: string } | null)?.created_at ?? null,
      };
    }
  }

  if (wantsDeliveryIntent(trimmed)) {
    tools.deliveryBoard = await fetchDeliveryBoard(supabase, 25);
  }

  const nameHint = extractPatientNameHint(trimmed) ?? extractPatientNameHint(transcript);
  if (nameHint && wantsPatientLookupIntent(trimmed, transcript)) {
    const matches = await fetchPatientLookupByName(supabase, nameHint);
    if (matches.length) {
      tools.patientLookup = { queryUsed: nameHint, matches };
    }
  }

  // Keep injected system context bounded to avoid "Message too long after injecting context".
  let compactAnalytics: AnalyticsSnapshot = {
    ...analyticsSnapshot,
    monthlyRevenue: analyticsSnapshot.monthlyRevenue.slice(-18),
    recentOrders: analyticsSnapshot.recentOrders.slice(
      0,
      Math.min(40, OWNER_AI_RECENT_ORDERS_LIMIT),
    ),
    topProductsByUnits: analyticsSnapshot.topProductsByUnits.slice(0, 6),
    pendingRefundRequests: analyticsSnapshot.pendingRefundRequests.slice(0, 12),
    products: {
      ...analyticsSnapshot.products,
      inactiveProductsSample: analyticsSnapshot.products.inactiveProductsSample.slice(0, 6),
      byCategory: analyticsSnapshot.products.byCategory,
    },
    crmNotesRecent: analyticsSnapshot.crmNotesRecent.slice(0, 6),
    ownerTodosRecent: analyticsSnapshot.ownerTodosRecent.slice(0, 6),
    patientsSample: analyticsSnapshot.patientsSample.slice(0, 12),
    pendingRefundOrderLines: analyticsSnapshot.pendingRefundOrderLines.slice(0, 6),
  };

  let toolResultsPayload: ToolResults | null =
    Object.keys(tools).length > 0 ? slimToolResultsPayload(tools) : null;

  const toolHints = {
    orderIdParsed: effectiveOrderId,
    orderIdSource: 'last_mention_in_transcript',
    dateRangeParsed: range,
    customerUuidParsed: uuid,
    patientNameHint: nameHint,
  };

  let payloadJsonLen = 0;
  let guard = 0;
  let payloadFinal:
    | {
        analyticsSnapshot: AnalyticsSnapshot;
        toolResults: ToolResults | null;
        toolHints: typeof toolHints;
      }
    | undefined;
  while (guard++ < 40) {
    const payloadTry = {
      analyticsSnapshot: compactAnalytics,
      toolResults: toolResultsPayload && Object.keys(toolResultsPayload).length ? toolResultsPayload : null,
      toolHints,
    };
    payloadJsonLen = JSON.stringify(payloadTry).length;
    if (payloadJsonLen <= OWNER_AI_PAYLOAD_JSON_MAX) {
      payloadFinal = payloadTry;
      break;
    }
    if (compactAnalytics.recentOrders.length > 20) {
      compactAnalytics = {
        ...compactAnalytics,
        recentOrders: compactAnalytics.recentOrders.slice(0, Math.max(20, Math.floor(compactAnalytics.recentOrders.length * 0.7))),
      };
      continue;
    }
    if (compactAnalytics.recentOrders.length > 12) {
      compactAnalytics = { ...compactAnalytics, recentOrders: compactAnalytics.recentOrders.slice(0, 12) };
      continue;
    }
    if (compactAnalytics.recentOrders.length > 8) {
      compactAnalytics = { ...compactAnalytics, recentOrders: compactAnalytics.recentOrders.slice(0, 8) };
      continue;
    }
    if (compactAnalytics.patientsSample.length > 0) {
      compactAnalytics = { ...compactAnalytics, patientsSample: [] };
      continue;
    }
    if (compactAnalytics.monthlyRevenue.length > 10) {
      compactAnalytics = { ...compactAnalytics, monthlyRevenue: compactAnalytics.monthlyRevenue.slice(-10) };
      continue;
    }
    if (toolResultsPayload?.deliveryBoard?.rows && toolResultsPayload.deliveryBoard.rows.length > 5) {
      toolResultsPayload = slimToolResultsPayload({
        ...toolResultsPayload,
        deliveryBoard: { rows: toolResultsPayload.deliveryBoard.rows.slice(0, 5) },
      });
      continue;
    }
    if (toolResultsPayload?.ordersInRange?.rows && toolResultsPayload.ordersInRange.rows.length > 10) {
      toolResultsPayload = slimToolResultsPayload({
        ...toolResultsPayload,
        ordersInRange: {
          ...toolResultsPayload.ordersInRange,
          rows: toolResultsPayload.ordersInRange.rows.slice(0, 10),
        },
      });
      continue;
    }
    if (toolResultsPayload && Object.keys(toolResultsPayload).length > 0) {
      const { customerOfOrder, orderDetail } = toolResultsPayload;
      toolResultsPayload =
        customerOfOrder || orderDetail ? ({ ...(customerOfOrder ? { customerOfOrder } : {}), ...(orderDetail ? { orderDetail } : {}) } as ToolResults) : null;
      continue;
    }
    compactAnalytics = { ...compactAnalytics, pendingRefundOrderLines: [], crmNotesRecent: [], ownerTodosRecent: [] };
    if (guard > 35) break;
  }

  const payload = payloadFinal ?? {
    analyticsSnapshot: compactAnalytics,
    toolResults: toolResultsPayload && Object.keys(toolResultsPayload).length ? toolResultsPayload : null,
    toolHints,
  };

  const systemContent = [
    'OUTPUT STYLE: Use straight ASCII double quotes " like this, not curly/smart quotes. When you mention identifier names in prose, use underscores: user_Id, Order_ID, Refund_ID, Customer_ID (not camelCase like userId or orderId).',
    'END-USER LANGUAGE (CRITICAL): The chat is for the shop owner, not engineers. In your reply text, NEVER mention or expose: JSON, .json, "snapshot", analyticsSnapshot, toolResults, toolHints, field paths, "the injected context", "provided data structure", API routes, table names, RLS, Supabase, database jargon, or "according to the JSON". Speak in plain business language only (e.g. "You have 2 pending refunds" not "pending count in the snapshot is 2"). You may use the technical block below internally to compute answers — do not describe it to the user.',
    'You are the HealHub OWNER assistant for this pharmacy. Use ONLY the technical facts in the block at the end of this message for numbers; never invent figures.',
    'You have access to this shop’s HealHub information. Do not claim you cannot access CRM, inventory, orders, or refunds when the facts exist in the technical block.',
    'If a detail is missing from that block, say briefly that you do not have that information here and suggest opening the relevant screen in HealHub (e.g. Refunds, Inventory) — without naming JSON or developers.',
    'Rules: Do not invent product names, Order_IDs, prices, or order statuses.',
    'CUSTOMER FACTS (critical): Never invent customer names. For "who is the customer" questions, answer from toolResults.customerOfOrder (preferred) or customerSummary only. If customerName is missing, say customer name is not available.',
    'PATIENTS / CRM (critical): For "how many patients", "patient count", or similar, answer with analyticsSnapshot.patients.count when it is a number (that is the total patient profiles in CRM). Do not say you lack that information when patients.count is present. patientsSample and toolResults.patientLookup are samples / name matches with allergy, gender, and purchaseOrderCount (orders linked to that patient). If allergy is null or empty, say no allergy is recorded for that patient (not "check the profile") unless the lists are empty.',
    'CRM (internal map): crmNotesRecent = recent CRM notes; ownerTodosRecent = owner tasks.',
    'DASHBOARD ORDERS (critical): analyticsSnapshot.recentOrders lists recent rows in the same shape as Owner Analytics — Order_ID, customer (same display rule as the UI: linked user full name, else email, else name on order), total, created_at, status. For WHO is the customer for Order X, find that Order_ID here or in toolResults.customerOfOrder; do not guess names.',
    'LATEST ORDER (internal): meta.highestOrderId = newest order number overall; recentOrders is a larger sample (see limit in data).',
    'ORDER STATUS (owner UI): Owner Analytics shows a single "Status" column = order.status. In every order answer use exactly one status line: "Status: …" from order.status. Never add a separate "Delivery status", "Delivery Status", or delivery_status bullet/line — the owner UI does not show that column in order summaries; omit it even when tool data includes it.',
    'PAYMENT QUESTIONS: If the owner asks whether an order is paid, answer from order.status only.',
    'CURRENCY: Express amounts in Thai Baht as ฿XXX.XX (match owner dashboards), not US dollars.',
    'TRACKING (optional): orderDetail may include tracking_id and courier_provider. Mention those only if the owner explicitly asks about tracking, shipment, or carrier — without any "Delivery status" heading or shipment-stage label.',
    'INVENTORY (internal): products.inventoryValueAtListPrice = total stock value at list price; totalStockUnits = units for active products.',
    'INVENTORY DISAMBIGUATION (critical): if user says "inactive order" while discussing inventory/inactive items, interpret it as "inactive product" (not sales order). Use products.inactiveProductsSample and products.inactiveCount to answer with product details (name, Product_ID, stock, price, category) when available.',
    'REFUNDS (internal): refunds.pending = count of pending refund requests; pendingRefundRequests lists them; pendingRefundOrderLines = line items when pending exist. requestedAmount may be blank in data — say "amount not recorded" not "null".',
    'POLICY: Do not invent store policies. If unknown, say the policy is not stated here.',
    'CALCULATIONS: You may compute percentages from the numbers in the technical block.',
    'Be concise. Prefer bullet points.',
    '--- Technical facts for this turn (do not quote structure names to the user) ---',
    JSON.stringify(payload),
  ].join('\n');

  return { systemContent };
}
