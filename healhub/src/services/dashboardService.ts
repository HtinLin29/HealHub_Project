import { supabase } from './supabaseClient';
import type {
  AiConfidence,
  AiDemandForecastRow,
  AiRiskLevel,
  AiReorderSuggestionRow,
  AiRunLogRow,
  AiStockoutAlertRow,
  KpiSummary,
  Order,
  Product,
} from '../types/domain';

const REVENUE_STATUSES = new Set<Order['status']>(['paid', 'packed', 'shipped', 'delivered']);
const REVENUE_STATUS_LIST = ['paid', 'packed', 'shipped', 'delivered'] as const;

export function normalizeOrderStatus(rawStatus: unknown): Order['status'] {
  const raw = String(rawStatus ?? 'pending').toLowerCase();
  if (raw === 'completed' || raw === 'complete') return 'delivered';
  if (raw === 'processing') return 'paid';
  if (raw === 'cancel' || raw === 'canceled') return 'cancelled';
  if (['pending', 'paid', 'packed', 'shipped', 'delivered', 'cancelled'].includes(raw)) {
    return raw as Order['status'];
  }
  return 'pending';
}

export function isRevenueStatus(status: unknown) {
  return REVENUE_STATUSES.has(normalizeOrderStatus(status));
}

function sumRevenueFromOrderRows(rows: { total_price?: unknown; status?: unknown }[]): number {
  return rows.reduce((sum, row) => {
    if (!isRevenueStatus(row.status)) return sum;
    return sum + Number(row.total_price ?? 0);
  }, 0);
}

/**
 * KPIs use `monthly_sales` for total revenue when the view exists (accurate, fast).
 * Otherwise revenue is summed from order rows with revenue statuses.
 */
export async function fetchKpis(): Promise<KpiSummary> {
  const [
    totalOrdersRes,
    monthlySalesRes,
    stockRes,
    revenueOrderRes,
    pendingRes,
    cancelledRes,
    activeProductsRes,
  ] = await Promise.all([
    supabase.from('orders').select('id', { count: 'exact', head: true }),
    supabase.from('monthly_sales').select('revenue'),
    supabase.from('products').select('stock, is_active').eq('is_active', true),
    supabase.from('orders').select('id', { count: 'exact', head: true }).in('status', [...REVENUE_STATUS_LIST]),
    supabase.from('orders').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
    supabase.from('orders').select('id', { count: 'exact', head: true }).eq('status', 'cancelled'),
    supabase.from('products').select('id', { count: 'exact', head: true }).eq('is_active', true),
  ]);

  if (totalOrdersRes.error) throw totalOrdersRes.error;
  if (stockRes.error) throw stockRes.error;
  if (revenueOrderRes.error) throw revenueOrderRes.error;
  if (pendingRes.error) throw pendingRes.error;
  if (cancelledRes.error) throw cancelledRes.error;
  if (activeProductsRes.error) throw activeProductsRes.error;

  let totalRevenue = 0;
  if (!monthlySalesRes.error && monthlySalesRes.data && monthlySalesRes.data.length > 0) {
    totalRevenue = monthlySalesRes.data.reduce((s, r) => s + Number((r as { revenue?: unknown }).revenue ?? 0), 0);
  } else {
    const { data: revRows, error: revErr } = await supabase.from('orders').select('total_price, status');
    if (revErr) throw revErr;
    totalRevenue = sumRevenueFromOrderRows(revRows ?? []);
  }

  const totalStock = (stockRes.data ?? []).reduce((sum, row) => sum + Number((row as { stock?: unknown }).stock ?? 0), 0);

  const revenueOrderCount = revenueOrderRes.count ?? 0;
  const avgOrderValue = revenueOrderCount > 0 ? totalRevenue / revenueOrderCount : 0;

  return {
    totalOrders: totalOrdersRes.count ?? 0,
    totalRevenue,
    totalStock,
    revenueOrderCount,
    pendingOrders: pendingRes.count ?? 0,
    cancelledOrders: cancelledRes.count ?? 0,
    avgOrderValue,
    activeProductCount: activeProductsRes.count ?? 0,
  };
}

export async function fetchProducts(): Promise<Product[]> {
  const { data, error } = await supabase
    .from('products')
    .select('id, name, category, description, price, stock, low_stock_threshold, image_url, is_active')
    .eq('is_active', true)
    .order('id', { ascending: false });

  if (error) throw error;
  return (data ?? []).map((p: Record<string, unknown>) => ({
    ...p,
    low_stock_threshold: Number(p.low_stock_threshold ?? 10),
  })) as Product[];
}

/**
 * Recent orders with customer display name when `users` join works (RLS must allow owner to read users).
 */
export async function fetchRecentOrders(limit = 10): Promise<Order[]> {
  const q = supabase
    .from('orders')
    .select('id, customer_id, total_price, status, created_at, users(full_name, email)')
    .order('created_at', { ascending: false })
    .limit(limit);

  const { data, error } = await q;

  if (error) {
    const fallback = await supabase
      .from('orders')
      .select('id, customer_id, total_price, status, created_at')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (fallback.error) throw fallback.error;
    return (fallback.data ?? []).map((row: Record<string, unknown>) => ({
      id: Number(row.id),
      customer_id: (row.customer_id as string | null) ?? null,
      customer_name: null,
      total_price: Number(row.total_price ?? 0),
      status: normalizeOrderStatus(row.status),
      created_at: row.created_at as string | undefined,
    }));
  }

  return (data ?? []).map((row: Record<string, unknown>) => {
    const u = row.users as { full_name?: string | null; email?: string | null } | null;
    const nameFromUser = u?.full_name?.trim() || u?.email?.trim() || null;
    return {
      id: Number(row.id),
      customer_id: (row.customer_id as string | null) ?? null,
      customer_name: nameFromUser,
      total_price: Number(row.total_price ?? 0),
      status: normalizeOrderStatus(row.status),
      created_at: row.created_at as string | undefined,
    };
  });
}

/**
 * Uses `monthly_sales` view when present (correct monthly totals). Falls back to client aggregation.
 */
export async function fetchMonthlyRevenue(): Promise<{ month: string; revenue: number }[]> {
  const { data: viewData, error: viewErr } = await supabase.from('monthly_sales').select('month, revenue').order('month', { ascending: true });

  if (!viewErr && viewData && viewData.length > 0) {
    return viewData.map((r) => ({
      month: String((r as { month: unknown }).month),
      revenue: Number((r as { revenue: unknown }).revenue ?? 0),
    }));
  }

  const { data: rows, error } = await supabase
    .from('orders')
    .select('created_at, total_price, status')
    .order('created_at', { ascending: true });

  if (error) throw error;

  const grouped = new Map<string, number>();
  for (const row of rows ?? []) {
    if (!isRevenueStatus((row as { status?: unknown }).status)) continue;
    const createdAt = String((row as { created_at?: unknown }).created_at ?? '');
    if (!createdAt) continue;
    const dt = new Date(createdAt);
    if (Number.isNaN(dt.getTime())) continue;
    const month = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`;
    grouped.set(month, (grouped.get(month) ?? 0) + Number((row as { total_price?: unknown }).total_price ?? 0));
  }

  return Array.from(grouped.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, revenue]) => ({ month, revenue }));
}

export type OrderStatusBreakdown = Record<string, number>;

export async function fetchOrderStatusBreakdown(preset: DateRangePreset = 'all'): Promise<OrderStatusBreakdown> {
  const statuses = ['pending', 'paid', 'packed', 'shipped', 'delivered', 'cancelled'] as const;
  const since = presetToSinceIso(preset);
  const results = await Promise.all(
    statuses.map(async (s) => {
      let q = supabase.from('orders').select('id', { count: 'exact', head: true }).eq('status', s);
      if (since) q = q.gte('created_at', since);
      const { count, error } = await q;
      if (error) return [s, 0] as const;
      return [s, count ?? 0] as const;
    }),
  );
  return Object.fromEntries(results);
}

/** Preset for period strip + top products + daily chart. */
export type DateRangePreset = '1d' | '7d' | '30d' | '90d' | '1y' | 'all';

function presetToDays(preset: DateRangePreset): number | null {
  switch (preset) {
    case '1d':
      return 1;
    case '7d':
      return 7;
    case '30d':
      return 30;
    case '90d':
      return 90;
    case '1y':
      return 365;
    case 'all':
      return null;
    default: {
      const _exhaustive: never = preset;
      return _exhaustive;
    }
  }
}

/**
 * Start of local day at midnight for rolling windows. For `all`, returns `null` (no lower date bound).
 */
export function presetToSinceIso(preset: DateRangePreset): string | null {
  const days = presetToDays(preset);
  if (days === null) return null;
  const d = new Date();
  d.setDate(d.getDate() - days);
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

export type PeriodMetrics = {
  revenue: number;
  orderCount: number;
  revenueOrderCount: number;
  previousRevenue: number;
  previousOrderCount: number;
  previousRevenueOrderCount: number;
};

/**
 * Rolling window vs same-length window before, or **lifetime totals** for `all` (no prior window).
 */
export async function fetchPeriodMetrics(preset: DateRangePreset): Promise<PeriodMetrics> {
  if (preset === 'all') {
    const [monthlySalesRes, totalOrdersRes, revenueOrdersRes, ordersFallbackRes] = await Promise.all([
      supabase.from('monthly_sales').select('revenue'),
      supabase.from('orders').select('id', { count: 'exact', head: true }),
      supabase.from('orders').select('id', { count: 'exact', head: true }).in('status', [...REVENUE_STATUS_LIST]),
      supabase.from('orders').select('total_price, status'),
    ]);

    if (totalOrdersRes.error) throw totalOrdersRes.error;
    if (revenueOrdersRes.error) throw revenueOrdersRes.error;

    let revenue = 0;
    if (!monthlySalesRes.error && monthlySalesRes.data && monthlySalesRes.data.length > 0) {
      revenue = monthlySalesRes.data.reduce((s, r) => s + Number((r as { revenue?: unknown }).revenue ?? 0), 0);
    } else {
      if (ordersFallbackRes.error) throw ordersFallbackRes.error;
      revenue = sumRevenueFromOrderRows(ordersFallbackRes.data ?? []);
    }

    return {
      revenue,
      orderCount: totalOrdersRes.count ?? 0,
      revenueOrderCount: revenueOrdersRes.count ?? 0,
      previousRevenue: 0,
      previousOrderCount: 0,
      previousRevenueOrderCount: 0,
    };
  }
  const days = presetToDays(preset);
  if (days === null) {
    throw new Error('fetchPeriodMetrics: invalid preset');
  }
  const now = Date.now();
  const ms = days * 86_400_000;
  const curStart = new Date(now - ms).toISOString();
  const prevStart = new Date(now - 2 * ms).toISOString();
  const prevEnd = curStart;

  const [curRes, prevRes] = await Promise.all([
    supabase.from('orders').select('total_price, status, created_at').gte('created_at', curStart),
    supabase.from('orders').select('total_price, status, created_at').gte('created_at', prevStart).lt('created_at', prevEnd),
  ]);

  if (curRes.error) throw curRes.error;
  if (prevRes.error) throw prevRes.error;

  function agg(rows: { total_price?: unknown; status?: unknown }[]) {
    let revenue = 0;
    let orderCount = 0;
    let revenueOrderCount = 0;
    for (const r of rows) {
      orderCount += 1;
      if (isRevenueStatus(r.status)) {
        revenue += Number(r.total_price ?? 0);
        revenueOrderCount += 1;
      }
    }
    return { revenue, orderCount, revenueOrderCount };
  }

  const cur = agg(curRes.data ?? []);
  const prev = agg(prevRes.data ?? []);
  return {
    revenue: cur.revenue,
    orderCount: cur.orderCount,
    revenueOrderCount: cur.revenueOrderCount,
    previousRevenue: prev.revenue,
    previousOrderCount: prev.orderCount,
    previousRevenueOrderCount: prev.revenueOrderCount,
  };
}

/**
 * Revenue series for charts: **daily** buckets for rolling windows, **monthly** buckets for `all`
 * (same chart components; `day` is `YYYY-MM-DD` or `YYYY-MM`).
 */
export async function fetchDailyRevenueInPreset(preset: DateRangePreset): Promise<{ day: string; revenue: number }[]> {
  if (preset === 'all') {
    const monthly = await fetchMonthlyRevenue();
    return monthly.map(({ month, revenue }) => ({ day: month, revenue }));
  }
  const since = presetToSinceIso(preset);
  if (!since) return [];

  const { data, error } = await supabase.from('orders').select('created_at, total_price, status').gte('created_at', since);
  if (error) throw error;

  const map = new Map<string, number>();
  for (const r of data ?? []) {
    if (!isRevenueStatus((r as { status?: unknown }).status)) continue;
    const createdAt = String((r as { created_at?: unknown }).created_at ?? '');
    if (!createdAt) continue;
    const day = createdAt.slice(0, 10);
    map.set(day, (map.get(day) ?? 0) + Number((r as { total_price?: unknown }).total_price ?? 0));
  }

  return Array.from(map.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, revenue]) => ({ day, revenue }));
}

export type RefundDashboardStats = {
  pendingCount: number;
  totalCount: number;
  pendingAmount: number;
};

export async function fetchRefundDashboardStats(): Promise<RefundDashboardStats | null> {
  try {
    const [pendingList, totalRes] = await Promise.all([
      supabase.from('order_refund_requests').select('requested_amount').eq('status', 'pending'),
      supabase.from('order_refund_requests').select('id', { count: 'exact', head: true }),
    ]);
    if (pendingList.error || totalRes.error) return null;
    let pendingAmount = 0;
    for (const r of pendingList.data ?? []) {
      pendingAmount += Number((r as { requested_amount?: unknown }).requested_amount ?? 0);
    }
    return {
      pendingCount: (pendingList.data ?? []).length,
      totalCount: totalRes.count ?? 0,
      pendingAmount,
    };
  } catch {
    return null;
  }
}

const DELIVERY_STATUSES = ['pending', 'packed', 'out_for_delivery', 'in_transit', 'delivered', 'exception', 'cancelled'] as const;

export type DeliveryStatusBreakdown = Record<string, number>;

export async function fetchDeliveryStatusBreakdown(): Promise<DeliveryStatusBreakdown | null> {
  try {
    const results = await Promise.all(
      DELIVERY_STATUSES.map(async (s) => {
        const { count, error } = await supabase.from('orders').select('id', { count: 'exact', head: true }).eq('delivery_status', s);
        if (error) return [s, 0] as const;
        return [s, count ?? 0] as const;
      }),
    );
    return Object.fromEntries(results);
  } catch {
    return null;
  }
}

export type TopProductRow = {
  productId: number;
  name: string;
  units: number;
  revenue: number;
};

export type ForecastProductRow = {
  productId: number;
  name: string;
  predictedUnits: number;
  predictedRevenue: number;
  basedOnMonth: string;
};

/** Best sellers in period (preset); aggregates order_items with optional date filter via orders.created_at. */
export async function fetchTopProducts(limit = 8, preset: DateRangePreset): Promise<TopProductRow[]> {
  const since = presetToSinceIso(preset);
  const { data, error } = await supabase
    .from('order_items')
    .select('quantity, line_total, product_id, products(name), orders(created_at)')
    .limit(10000);

  if (error) return [];

  const map = new Map<number, { name: string; units: number; revenue: number }>();

  for (const row of data ?? []) {
    const ord = row.orders as { created_at?: string } | null;
    const created = ord?.created_at;
    if (since && created && new Date(created) < new Date(since)) continue;

    const pid = Number((row as { product_id?: unknown }).product_id ?? 0);
    if (!pid) continue;
    const name = String((row as { products?: { name?: string } | null }).products?.name ?? 'Product').trim() || 'Product';
    const qty = Number((row as { quantity?: unknown }).quantity ?? 0);
    const line = Number((row as { line_total?: unknown }).line_total ?? 0);

    const cur = map.get(pid) ?? { name, units: 0, revenue: 0 };
    cur.units += qty;
    cur.revenue += line;
    cur.name = name;
    map.set(pid, cur);
  }

  return [...map.entries()]
    .map(([productId, v]) => ({ productId, name: v.name, units: v.units, revenue: v.revenue }))
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, limit);
}

/**
 * Predict next-month best sellers from last year's same calendar month.
 * Example: if now is March 2026, use April 2025 sales.
 */
export async function fetchNextMonthBestSellers(limit = 5, targetMonthIndex?: number): Promise<ForecastProductRow[]> {
  const now = new Date();
  const nextMonthIndex = (now.getMonth() + 1) % 12;
  const selectedMonth = typeof targetMonthIndex === 'number' && targetMonthIndex >= 0 && targetMonthIndex <= 11 ? targetMonthIndex : nextMonthIndex;
  const yearForReference = now.getFullYear() - 1;
  const monthStart = new Date(Date.UTC(yearForReference, selectedMonth, 1, 0, 0, 0, 0));
  const monthEnd = new Date(Date.UTC(yearForReference, selectedMonth + 1, 1, 0, 0, 0, 0));

  const { data, error } = await supabase
    .from('order_items')
    .select('quantity, line_total, product_id, products(name), orders(created_at, status)')
    .limit(10000);

  if (error) return [];

  const map = new Map<number, { name: string; units: number; revenue: number }>();

  for (const row of data ?? []) {
    const ord = row.orders as { created_at?: string; status?: unknown } | null;
    const createdAt = ord?.created_at;
    if (!createdAt) continue;
    const created = new Date(createdAt);
    if (Number.isNaN(created.getTime())) continue;
    if (created < monthStart || created >= monthEnd) continue;
    if (!isRevenueStatus(ord?.status)) continue;

    const pid = Number((row as { product_id?: unknown }).product_id ?? 0);
    if (!pid) continue;

    const name = String((row as { products?: { name?: string } | null }).products?.name ?? 'Product').trim() || 'Product';
    const qty = Number((row as { quantity?: unknown }).quantity ?? 0);
    const line = Number((row as { line_total?: unknown }).line_total ?? 0);

    const cur = map.get(pid) ?? { name, units: 0, revenue: 0 };
    cur.units += qty;
    cur.revenue += line;
    cur.name = name;
    map.set(pid, cur);
  }

  const basedOnMonth = `${yearForReference}-${String(selectedMonth + 1).padStart(2, '0')}`;

  return [...map.entries()]
    .map(([productId, v]) => ({
      productId,
      name: v.name,
      predictedUnits: v.units,
      predictedRevenue: v.revenue,
      basedOnMonth,
    }))
    .sort((a, b) => b.predictedRevenue - a.predictedRevenue)
    .slice(0, limit);
}

export type SalesInsightProduct = {
  productId: number;
  name: string;
  units: number;
  revenue: number;
  monthKey: string;
};

export type SeasonalDiseaseSignal = {
  disease: string;
  reason: string;
};

export type SalesTrendInsights = {
  previousMonthTopSeller: SalesInsightProduct | null;
  sameMonthLastYearTopSeller: SalesInsightProduct | null;
  predictedCurrentMonthBestSeller: (SalesInsightProduct & { confidence: AiConfidence }) | null;
  seasonalDiseaseOutlook: SeasonalDiseaseSignal[];
};

function monthKeyFromDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function monthStartUtc(year: number, monthIndex0: number): Date {
  return new Date(Date.UTC(year, monthIndex0, 1, 0, 0, 0, 0));
}

function seasonalDiseasesForMonth(monthIndex0: number): SeasonalDiseaseSignal[] {
  const generic: SeasonalDiseaseSignal[] = [
    { disease: 'Influenza / common respiratory infection', reason: 'Seasonal circulation is common; monitor fever, cough, sore throat trends.' },
    { disease: 'Viral gastroenteritis', reason: 'Food and water contamination risk can increase during weather swings.' },
  ];
  const monthMap: Record<number, SeasonalDiseaseSignal[]> = {
    0: [
      { disease: 'Influenza', reason: 'Cool-season respiratory spread can remain elevated.' },
      { disease: 'Pneumonia risk', reason: 'Older adults and chronic patients often need closer monitoring in cooler months.' },
    ],
    1: [
      { disease: 'Influenza', reason: 'Late cool-season transmission can continue.' },
      { disease: 'Sinus / upper respiratory infection', reason: 'Dry air and temperature changes can trigger symptoms.' },
    ],
    2: [
      { disease: 'Heat-related illness', reason: 'Rising temperature increases dehydration and heat exhaustion risk.' },
      { disease: 'Allergic rhinitis', reason: 'Airborne allergens and dust may rise in hot/dry conditions.' },
    ],
    3: [
      { disease: 'Heat stroke / dehydration', reason: 'Peak summer heat can increase emergency risk groups.' },
      { disease: 'Food poisoning', reason: 'High ambient temperature raises spoilage risk.' },
    ],
    4: [
      { disease: 'Dengue fever', reason: 'Rainy season vector activity tends to increase.' },
      { disease: 'Leptospirosis', reason: 'Flood/wet exposure can increase risk in some communities.' },
    ],
    5: [
      { disease: 'Dengue fever', reason: 'Mosquito breeding activity may remain high with rainfall.' },
      { disease: 'Viral conjunctivitis', reason: 'Humid weather can correlate with cluster outbreaks.' },
    ],
    6: [
      { disease: 'Hand-Foot-Mouth disease', reason: 'School-age transmission can increase during wet months.' },
      { disease: 'Dengue fever', reason: 'Vector season can remain active.' },
    ],
    7: [
      { disease: 'Diarrheal illness', reason: 'Ongoing wet-season contamination risk.' },
      { disease: 'Dengue fever', reason: 'Mosquito density can still be elevated.' },
    ],
    8: [
      { disease: 'Upper respiratory infection', reason: 'Rainy season respiratory clusters may rise.' },
      { disease: 'Dengue fever', reason: 'Late rainy-season risk can persist.' },
    ],
    9: [
      { disease: 'Influenza (seasonal transition)', reason: 'Weather transition can trigger respiratory surges.' },
      { disease: 'Asthma exacerbation', reason: 'Humidity and particulate changes may worsen symptoms.' },
    ],
    10: [
      { disease: 'Common cold / influenza-like illness', reason: 'Cooler seasonal transition supports respiratory spread.' },
      { disease: 'Allergic flare', reason: 'Air quality and seasonal allergen shifts can worsen symptoms.' },
    ],
    11: [
      { disease: 'Influenza', reason: 'Early cool season often increases influenza activity.' },
      { disease: 'Pneumonia risk', reason: 'High-risk groups may have more severe respiratory outcomes.' },
    ],
  };
  return [...(monthMap[monthIndex0] ?? []), ...generic];
}

/**
 * Last-2-year sales intelligence for owner dashboard.
 */
export async function fetchSalesTrendInsights(targetMonthIndex?: number): Promise<SalesTrendInsights> {
  const now = new Date();
  const selectedMonth = typeof targetMonthIndex === 'number' && targetMonthIndex >= 0 && targetMonthIndex <= 11 ? targetMonthIndex : now.getMonth();
  const currentMonthStart = monthStartUtc(now.getFullYear(), selectedMonth);
  const nextMonthStart = monthStartUtc(now.getFullYear(), selectedMonth + 1);
  const previousMonthStart = monthStartUtc(now.getFullYear(), selectedMonth - 1);
  const sameMonthLastYearStart = monthStartUtc(now.getFullYear() - 1, selectedMonth);
  const twoYearsAgoStart = monthStartUtc(now.getFullYear() - 2, selectedMonth);

  const { data, error } = await supabase
    .from('order_items')
    .select('quantity, line_total, product_id, products(name), orders(created_at, status)')
    .limit(50000);
  if (error) {
    return {
      previousMonthTopSeller: null,
      sameMonthLastYearTopSeller: null,
      predictedCurrentMonthBestSeller: null,
      seasonalDiseaseOutlook: seasonalDiseasesForMonth(selectedMonth),
    };
  }

  const byMonthProduct = new Map<string, Map<number, { name: string; units: number; revenue: number }>>();
  for (const row of data ?? []) {
    const ord = row.orders as { created_at?: string; status?: unknown } | null;
    const createdAt = ord?.created_at;
    if (!createdAt || !isRevenueStatus(ord?.status)) continue;
    const created = new Date(createdAt);
    if (Number.isNaN(created.getTime())) continue;
    if (created < twoYearsAgoStart || created >= nextMonthStart) continue;

    const mk = monthKeyFromDate(created);
    const pid = Number((row as { product_id?: unknown }).product_id ?? 0);
    if (!pid) continue;
    const name = String((row as { products?: { name?: string } | null }).products?.name ?? 'Product').trim() || 'Product';
    const qty = Number((row as { quantity?: unknown }).quantity ?? 0);
    const line = Number((row as { line_total?: unknown }).line_total ?? 0);

    const monthMap = byMonthProduct.get(mk) ?? new Map<number, { name: string; units: number; revenue: number }>();
    const cur = monthMap.get(pid) ?? { name, units: 0, revenue: 0 };
    cur.name = name;
    cur.units += qty;
    cur.revenue += line;
    monthMap.set(pid, cur);
    byMonthProduct.set(mk, monthMap);
  }

  function topSellerForMonth(monthStart: Date): SalesInsightProduct | null {
    const mk = monthKeyFromDate(monthStart);
    const monthMap = byMonthProduct.get(mk);
    if (!monthMap || monthMap.size === 0) return null;
    const top = [...monthMap.entries()]
      .map(([productId, v]) => ({ productId, name: v.name, units: v.units, revenue: v.revenue, monthKey: mk }))
      .sort((a, b) => (b.revenue - a.revenue) || (b.units - a.units))[0];
    return top ?? null;
  }

  const previousMonthTopSeller = topSellerForMonth(previousMonthStart);
  const sameMonthLastYearTopSeller = topSellerForMonth(sameMonthLastYearStart);

  const currentKey = monthKeyFromDate(currentMonthStart);
  const previousKey = monthKeyFromDate(previousMonthStart);
  const lastYearKey = monthKeyFromDate(sameMonthLastYearStart);
  const twoYearsAgoKey = monthKeyFromDate(twoYearsAgoStart);
  const currentMonthMap = byMonthProduct.get(currentKey) ?? new Map<number, { name: string; units: number; revenue: number }>();
  const previousMonthMap = byMonthProduct.get(previousKey) ?? new Map<number, { name: string; units: number; revenue: number }>();
  const lastYearSameMonthMap = byMonthProduct.get(lastYearKey) ?? new Map<number, { name: string; units: number; revenue: number }>();
  const twoYearsAgoSameMonthMap = byMonthProduct.get(twoYearsAgoKey) ?? new Map<number, { name: string; units: number; revenue: number }>();

  const allProductIds = new Set<number>([
    ...currentMonthMap.keys(),
    ...previousMonthMap.keys(),
    ...lastYearSameMonthMap.keys(),
    ...twoYearsAgoSameMonthMap.keys(),
  ]);

  const predictedCurrentMonthBestSeller = (() => {
    if (allProductIds.size === 0) return null;
    const scored = [...allProductIds].map((pid) => {
      const cur = currentMonthMap.get(pid);
      const prev = previousMonthMap.get(pid);
      const y1 = lastYearSameMonthMap.get(pid);
      const y2 = twoYearsAgoSameMonthMap.get(pid);
      const name = cur?.name || prev?.name || y1?.name || y2?.name || `Product #${pid}`;

      const weightedRevenue =
        Number(cur?.revenue ?? 0) * 0.45 +
        Number(y1?.revenue ?? 0) * 0.35 +
        Number(prev?.revenue ?? 0) * 0.15 +
        Number(y2?.revenue ?? 0) * 0.05;
      const weightedUnits =
        Number(cur?.units ?? 0) * 0.45 +
        Number(y1?.units ?? 0) * 0.35 +
        Number(prev?.units ?? 0) * 0.15 +
        Number(y2?.units ?? 0) * 0.05;
      const evidenceCount = [cur, prev, y1, y2].filter(Boolean).length;
      const confidence: AiConfidence = evidenceCount >= 3 ? 'high' : evidenceCount === 2 ? 'medium' : 'low';
      return {
        productId: pid,
        name,
        units: Math.round(weightedUnits),
        revenue: Number(weightedRevenue.toFixed(2)),
        monthKey: currentKey,
        confidence,
      };
    });

    return scored.sort((a, b) => (b.revenue - a.revenue) || (b.units - a.units))[0] ?? null;
  })();

  return {
    previousMonthTopSeller,
    sameMonthLastYearTopSeller,
    predictedCurrentMonthBestSeller,
    seasonalDiseaseOutlook: seasonalDiseasesForMonth(selectedMonth),
  };
}

export type OwnerAiPhase1Snapshot = {
  generatedAt: string;
  monthIndex: number;
  salesInsights: SalesTrendInsights;
  demandForecast: AiDemandForecastRow[];
  stockoutAlerts: AiStockoutAlertRow[];
  reorderSuggestions: AiReorderSuggestionRow[];
};

type ProductSalesAggregate = {
  productId: number;
  name: string;
  currentMonthUnits: number;
  currentMonthRevenue: number;
  previousMonthUnits: number;
  previousMonthRevenue: number;
  sameMonthLastYearUnits: number;
  sameMonthLastYearRevenue: number;
  sameMonthTwoYearsAgoUnits: number;
  sameMonthTwoYearsAgoRevenue: number;
};

function computeConfidenceByEvidence(evidenceCount: number): AiConfidence {
  if (evidenceCount >= 3) return 'high';
  if (evidenceCount === 2) return 'medium';
  return 'low';
}

function uniqueMonthEvidence(points: Array<{ monthKey: string; units: number; revenue: number }>): string[] {
  return points
    .filter((p) => p.units > 0 || p.revenue > 0)
    .map((p) => p.monthKey);
}

async function resolveOwnerProfileId(): Promise<string> {
  const { data: sessionData } = await supabase.auth.getSession();
  const authId = sessionData.session?.user?.id;
  if (!authId) throw new Error('Owner sign-in required.');

  const { data: ownerUser, error } = await supabase
    .from('users')
    .select('id, role')
    .eq('auth_user_id', authId)
    .maybeSingle();
  if (error) throw error;
  if (!ownerUser || String((ownerUser as { role?: unknown }).role) !== 'owner') {
    throw new Error('Owner access required.');
  }
  return String((ownerUser as { id: unknown }).id);
}

async function persistAiRunLogs(logs: AiRunLogRow[]): Promise<void> {
  if (logs.length === 0) return;
  try {
    const insertPayload = logs.map((l) => ({
      run_id: l.id,
      action: l.action,
      status: l.status,
      message: l.message,
      payload: l.payload,
      created_at: l.createdAt,
    }));
    const res = await supabase.from('ai_run_log').insert(insertPayload);
    if (!res.error) return;
  } catch {
    // ignore and fallback
  }

  if (typeof window !== 'undefined') {
    const key = 'healhub-ai-run-log';
    try {
      const existingRaw = window.localStorage.getItem(key);
      const existing = existingRaw ? (JSON.parse(existingRaw) as AiRunLogRow[]) : [];
      window.localStorage.setItem(key, JSON.stringify([...logs, ...existing].slice(0, 300)));
    } catch {
      // ignore fallback failures
    }
  }
}

export async function fetchOwnerAiPhase1Snapshot(targetMonthIndex?: number): Promise<OwnerAiPhase1Snapshot> {
  const now = new Date();
  const selectedMonth = typeof targetMonthIndex === 'number' && targetMonthIndex >= 0 && targetMonthIndex <= 11 ? targetMonthIndex : now.getMonth();
  const currentMonthStart = monthStartUtc(now.getFullYear(), selectedMonth);
  const nextMonthStart = monthStartUtc(now.getFullYear(), selectedMonth + 1);
  const previousMonthStart = monthStartUtc(now.getFullYear(), selectedMonth - 1);
  const sameMonthLastYearStart = monthStartUtc(now.getFullYear() - 1, selectedMonth);
  const twoYearsAgoStart = monthStartUtc(now.getFullYear() - 2, selectedMonth);

  const [productsRes, salesInsights] = await Promise.all([
    supabase.from('products').select('id, name, stock, is_active').eq('is_active', true).limit(20000),
    fetchSalesTrendInsights(selectedMonth),
  ]);
  if (productsRes.error) throw productsRes.error;

  const products = (productsRes.data ?? []) as Array<{ id?: unknown; name?: unknown; stock?: unknown }>;
  const productMap = new Map<number, { name: string; stock: number }>();
  for (const p of products) {
    const id = Number(p.id ?? 0);
    if (!id) continue;
    productMap.set(id, {
      name: String(p.name ?? 'Product').trim() || 'Product',
      stock: Number(p.stock ?? 0),
    });
  }

  const { data, error } = await supabase
    .from('order_items')
    .select('quantity, line_total, product_id, products(name), orders(created_at, status)')
    .limit(60000);
  if (error) throw error;

  const currentKey = monthKeyFromDate(currentMonthStart);
  const previousKey = monthKeyFromDate(previousMonthStart);
  const y1Key = monthKeyFromDate(sameMonthLastYearStart);
  const y2Key = monthKeyFromDate(twoYearsAgoStart);

  const byProductMonth = new Map<number, Map<string, { units: number; revenue: number; name: string }>>();
  for (const row of data ?? []) {
    const ord = row.orders as { created_at?: string; status?: unknown } | null;
    const createdAt = ord?.created_at;
    if (!createdAt || !isRevenueStatus(ord?.status)) continue;
    const created = new Date(createdAt);
    if (Number.isNaN(created.getTime())) continue;
    if (created < twoYearsAgoStart || created >= nextMonthStart) continue;
    const monthKey = monthKeyFromDate(created);
    const pid = Number((row as { product_id?: unknown }).product_id ?? 0);
    if (!pid) continue;
    const fallback = productMap.get(pid);
    const name = String((row as { products?: { name?: string } | null }).products?.name ?? fallback?.name ?? 'Product').trim() || 'Product';
    const qty = Number((row as { quantity?: unknown }).quantity ?? 0);
    const line = Number((row as { line_total?: unknown }).line_total ?? 0);
    const monthMap = byProductMonth.get(pid) ?? new Map<string, { units: number; revenue: number; name: string }>();
    const cur = monthMap.get(monthKey) ?? { units: 0, revenue: 0, name };
    cur.units += qty;
    cur.revenue += line;
    cur.name = name;
    monthMap.set(monthKey, cur);
    byProductMonth.set(pid, monthMap);
    if (!productMap.has(pid)) productMap.set(pid, { name, stock: 0 });
  }

  const aggregates: ProductSalesAggregate[] = [...productMap.entries()].map(([productId, meta]) => {
    const m = byProductMonth.get(productId) ?? new Map<string, { units: number; revenue: number; name: string }>();
    return {
      productId,
      name: meta.name,
      currentMonthUnits: Number(m.get(currentKey)?.units ?? 0),
      currentMonthRevenue: Number(m.get(currentKey)?.revenue ?? 0),
      previousMonthUnits: Number(m.get(previousKey)?.units ?? 0),
      previousMonthRevenue: Number(m.get(previousKey)?.revenue ?? 0),
      sameMonthLastYearUnits: Number(m.get(y1Key)?.units ?? 0),
      sameMonthLastYearRevenue: Number(m.get(y1Key)?.revenue ?? 0),
      sameMonthTwoYearsAgoUnits: Number(m.get(y2Key)?.units ?? 0),
      sameMonthTwoYearsAgoRevenue: Number(m.get(y2Key)?.revenue ?? 0),
    };
  });

  const demandForecast: AiDemandForecastRow[] = aggregates
    .map((a) => {
      const weightedUnits = a.currentMonthUnits * 0.45 + a.sameMonthLastYearUnits * 0.35 + a.previousMonthUnits * 0.15 + a.sameMonthTwoYearsAgoUnits * 0.05;
      const weightedRevenue =
        a.currentMonthRevenue * 0.45 +
        a.sameMonthLastYearRevenue * 0.35 +
        a.previousMonthRevenue * 0.15 +
        a.sameMonthTwoYearsAgoRevenue * 0.05;
      const evidence = uniqueMonthEvidence([
        { monthKey: currentKey, units: a.currentMonthUnits, revenue: a.currentMonthRevenue },
        { monthKey: y1Key, units: a.sameMonthLastYearUnits, revenue: a.sameMonthLastYearRevenue },
        { monthKey: previousKey, units: a.previousMonthUnits, revenue: a.previousMonthRevenue },
        { monthKey: y2Key, units: a.sameMonthTwoYearsAgoUnits, revenue: a.sameMonthTwoYearsAgoRevenue },
      ]);
      const confidence = computeConfidenceByEvidence(evidence.length);
      return {
        productId: a.productId,
        name: a.name,
        currentStock: Number(productMap.get(a.productId)?.stock ?? 0),
        predictedUnitsNext30: Math.max(0, Math.round(weightedUnits)),
        predictedRevenueNext30: Number(Math.max(0, weightedRevenue).toFixed(2)),
        confidence,
        basedOn: evidence,
      };
    })
    .filter((r) => r.predictedUnitsNext30 > 0 || r.predictedRevenueNext30 > 0)
    .sort((a, b) => b.predictedRevenueNext30 - a.predictedRevenueNext30)
    .slice(0, 15);

  const stockoutAlerts: AiStockoutAlertRow[] = demandForecast
    .map((r) => {
      const daily = r.predictedUnitsNext30 / 30;
      const daysToStockout = daily > 0 ? Number((r.currentStock / daily).toFixed(1)) : Number.POSITIVE_INFINITY;
      const riskLevel: AiRiskLevel = daysToStockout <= 7 ? 'high' : daysToStockout <= 14 ? 'medium' : 'low';
      const targetQty = Math.ceil(Math.max(0, r.predictedUnitsNext30 * 1.2 - r.currentStock));
      return {
        productId: r.productId,
        name: r.name,
        currentStock: r.currentStock,
        predictedDailyUnits: Number(daily.toFixed(2)),
        daysToStockout,
        riskLevel,
        recommendedReorderQty: Math.min(500, targetQty),
      };
    })
    .filter((r) => Number.isFinite(r.daysToStockout))
    .filter((r) => r.riskLevel !== 'low')
    .sort((a, b) => a.daysToStockout - b.daysToStockout)
    .slice(0, 20);

  const reorderSuggestions: AiReorderSuggestionRow[] = stockoutAlerts
    .filter((a) => a.recommendedReorderQty > 0)
    .map((a) => {
      const forecast = demandForecast.find((d) => d.productId === a.productId);
      const estimatedDaysCoverage = a.predictedDailyUnits > 0
        ? Number(((a.currentStock + a.recommendedReorderQty) / a.predictedDailyUnits).toFixed(1))
        : 999;
      return {
        productId: a.productId,
        name: a.name,
        currentStock: a.currentStock,
        suggestedQty: a.recommendedReorderQty,
        estimatedDaysCoverage,
        confidence: forecast?.confidence ?? 'low',
        reason: `Risk ${a.riskLevel}: projected stockout in ~${a.daysToStockout} day(s).`,
      };
    })
    .sort((a, b) => b.suggestedQty - a.suggestedQty);

  return {
    generatedAt: new Date().toISOString(),
    monthIndex: selectedMonth,
    salesInsights,
    demandForecast,
    stockoutAlerts,
    reorderSuggestions,
  };
}

export async function autoApplyOwnerAiReorders(suggestions: AiReorderSuggestionRow[], monthIndex: number): Promise<AiRunLogRow[]> {
  const createdAt = new Date().toISOString();
  const logs: AiRunLogRow[] = [];
  if (suggestions.length === 0) return logs;

  let ownerUserId = '';
  try {
    ownerUserId = await resolveOwnerProfileId();
  } catch (e) {
    logs.push({
      id: `ai-${Date.now()}-owner-missing`,
      action: 'auto_apply_reorder_batch',
      status: 'failed',
      message: e instanceof Error ? e.message : 'Owner profile not resolved.',
      createdAt,
      payload: { suggestions: suggestions.length, monthIndex },
    });
    await persistAiRunLogs(logs);
    return logs;
  }

  for (const s of suggestions) {
    const safeToApply = (s.confidence === 'high' || s.confidence === 'medium') && s.suggestedQty > 0 && s.suggestedQty <= 500;
    const runId = `ai-${Date.now()}-${s.productId}-${Math.random().toString(36).slice(2, 8)}`;
    if (!safeToApply) {
      logs.push({
        id: runId,
        action: 'auto_apply_reorder',
        status: 'skipped',
        message: 'Guardrail blocked auto-apply (low confidence or quantity out of range).',
        createdAt,
        payload: { ...s, monthIndex },
      });
      continue;
    }

    try {
      const title = `AI Reorder: ${s.name} (+${s.suggestedQty})`;
      const notes = `Auto-generated for month index ${monthIndex}. ${s.reason} Coverage target: ~${s.estimatedDaysCoverage} days.`;
      const res = await supabase.from('owner_todos').insert({
        owner_user_id: ownerUserId,
        title,
        notes,
        priority: s.confidence === 'high' ? 'high' : 'normal',
        status: 'open',
        source: 'suggested',
        linked_type: 'ai_reorder',
        linked_id: `${s.productId}-${monthIndex}`,
      });
      if (res.error) throw res.error;
      logs.push({
        id: runId,
        action: 'auto_apply_reorder',
        status: 'applied',
        message: `Created owner todo for ${s.name}.`,
        createdAt,
        payload: { ...s, monthIndex },
      });
    } catch (e) {
      logs.push({
        id: runId,
        action: 'auto_apply_reorder',
        status: 'failed',
        message: e instanceof Error ? e.message : 'Failed creating owner todo.',
        createdAt,
        payload: { ...s, monthIndex },
      });
    }
  }

  await persistAiRunLogs(logs);
  return logs;
}
