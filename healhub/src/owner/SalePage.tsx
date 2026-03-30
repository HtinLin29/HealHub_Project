import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArcElement,
  BarElement,
  CategoryScale,
  Chart as ChartJS,
  Legend,
  LineElement,
  LinearScale,
  PointElement,
  Title,
  Tooltip,
} from 'chart.js';
import { Bar, Doughnut, Line } from 'react-chartjs-2';
import OwnerLayout from './OwnerLayout';
import { useTheme } from '../context/ThemeContext';
import { fetchRecentOrders } from '../services/dashboardService';
import { supabase } from '../services/supabaseClient';
import type { Order } from '../types/domain';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, BarElement, ArcElement, Title, Tooltip, Legend);

type ProductRow = { id: number; name: string; category?: string | null };
type OrderItemRow = { id?: number; order_id?: number | null; product_id?: number | null; quantity?: number | null; unit_price?: number | null; line_total?: number | null };

const statuses: Order['status'][] = ['pending', 'paid', 'packed', 'shipped', 'delivered', 'cancelled'];
const CATEGORY_LIST = ['Prescription', 'OTC', 'Supplements', 'Personal Care'] as const;

function formatMoney(value: number) {
  return `฿${Number(value || 0).toFixed(2)}`;
}

function escapeCsvCell(s: string): string {
  const t = String(s ?? '');
  if (/[",\n\r]/.test(t)) return `"${t.replace(/"/g, '""')}"`;
  return t;
}

function orderInDatePreset(createdAt: string | undefined, preset: '7d' | '30d' | '90d' | 'all'): boolean {
  if (preset === 'all') return true;
  if (!createdAt) return true;
  const t = new Date(createdAt).getTime();
  if (!Number.isFinite(t)) return true;
  const days = preset === '7d' ? 7 : preset === '30d' ? 30 : 90;
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  return t >= cutoff;
}

function cx(...parts: Array<string | false | undefined>) {
  return parts.filter(Boolean).join(' ');
}

function monthKey(d?: string) {
  if (!d) return 'Unknown';
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return 'Unknown';
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`;
}

function dayKey(d?: string) {
  if (!d) return 'Unknown';
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return 'Unknown';
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

function inferCategory(p: ProductRow) {
  const raw = (p.category || '').toLowerCase();
  if (raw.includes('prescription')) return 'Prescription';
  if (raw.includes('supplement') || raw.includes('vitamin')) return 'Supplements';
  if (raw.includes('care') || raw.includes('skin') || raw.includes('cosmetic')) return 'Personal Care';
  const name = p.name.toLowerCase();
  if (name.includes('vitamin') || name.includes('fish oil') || name.includes('collagen')) return 'Supplements';
  if (name.includes('cream') || name.includes('lotion') || name.includes('cleanser')) return 'Personal Care';
  return 'OTC';
}

function isBranded(name: string) {
  const brandHints = ['tylenol', 'panadol', 'sara', 'tiffy', 'blackmores', 'centrum', 'vistra', 'berocca', 'nivea', 'bioderma', 'cetaphil', 'cerave'];
  const n = name.toLowerCase();
  return brandHints.some((b) => n.includes(b));
}

function getPreviousKey(key: string, axis: 'day' | 'month', mode: 'prevMonth' | 'prevYear') {
  const parts = key.split('-').map(Number);
  if (axis === 'month' && parts.length >= 2) {
    let y = parts[0];
    let m = parts[1];
    if (mode === 'prevYear') return `${y - 1}-${String(m).padStart(2, '0')}`;
    m -= 1;
    if (m <= 0) {
      y -= 1;
      m = 12;
    }
    return `${y}-${String(m).padStart(2, '0')}`;
  }
  if (axis === 'day' && parts.length >= 3) {
    const dt = new Date(parts[0], parts[1] - 1, parts[2]);
    if (mode === 'prevYear') dt.setFullYear(dt.getFullYear() - 1);
    else dt.setMonth(dt.getMonth() - 1);
    return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
  }
  return key;
}

type OrderSortKey = 'date' | 'total' | 'id';

export default function SalePage() {
  const navigate = useNavigate();
  const { mode } = useTheme();
  const isDark = mode === 'dark';

  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [orderItems, setOrderItems] = useState<OrderItemRow[]>([]);
  const [timeAxis, setTimeAxis] = useState<'day' | 'month'>('month');
  const [compareMode, setCompareMode] = useState<'prevMonth' | 'prevYear'>('prevMonth');
  const [topMetric, setTopMetric] = useState<'revenue' | 'quantity'>('revenue');
  const [statusFilter, setStatusFilter] = useState<'all' | Order['status']>('all');
  const [orderQuery, setOrderQuery] = useState('');
  const [datePreset, setDatePreset] = useState<'7d' | '30d' | '90d' | 'all'>('30d');
  const [sortKey, setSortKey] = useState<OrderSortKey>('date');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  async function loadOrders() {
    try {
      setLoading(true);
      const [ordersData, productsRes, orderItemsRes] = await Promise.all([
        fetchRecentOrders(500),
        supabase.from('products').select('id,name,category').eq('is_active', true).limit(10000),
        supabase.from('order_items').select('*').limit(20000),
      ]);
      setOrders(ordersData);
      setProducts((productsRes.data as ProductRow[]) || []);
      setOrderItems(orderItemsRes.error ? [] : ((orderItemsRes.data as OrderItemRow[]) || []));
      setError('');
    } catch (e: any) {
      setOrders([]);
      setError(e?.message || 'Failed to load orders');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadOrders();
  }, []);

  const productMap = useMemo(() => new Map(products.map((p) => [p.id, p] as const)), [products]);

  const orderItemsByOrder = useMemo(() => {
    const map = new Map<number, OrderItemRow[]>();
    for (const item of orderItems) {
      const orderId = Number(item.order_id);
      if (!orderId) continue;
      if (!map.has(orderId)) map.set(orderId, []);
      map.get(orderId)!.push(item);
    }
    return map;
  }, [orderItems]);

  const orderSummaries = useMemo(() => {
    return orders.map((order) => {
      const items = orderItemsByOrder.get(order.id) || [];
      const itemCount = items.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
      const itemLines = items.map((item) => {
        const product = productMap.get(Number(item.product_id));
        const quantity = Number(item.quantity || 0);
        const unitPrice = Number(item.unit_price || 0);
        const lineTotal = Number(item.line_total ?? quantity * unitPrice);
        return {
          ...item,
          quantity,
          unitPrice,
          lineTotal,
          productName: product?.name || `Product #${item.product_id}`,
          productCategory: product?.category || null,
        };
      });

      return {
        ...order,
        itemCount,
        itemized: itemLines.length > 0,
        itemLines,
      };
    });
  }, [orders, orderItemsByOrder, productMap]);

  const orderSummariesInRange = useMemo(
    () => orderSummaries.filter((o) => orderInDatePreset(o.created_at, datePreset)),
    [orderSummaries, datePreset],
  );

  const orderIdsInRange = useMemo(() => new Set(orderSummariesInRange.map((o) => o.id)), [orderSummariesInRange]);

  const orderItemsInRange = useMemo(
    () => orderItems.filter((i) => orderIdsInRange.has(Number(i.order_id))),
    [orderItems, orderIdsInRange],
  );

  const stats = useMemo(() => {
    const paid = orderSummariesInRange.filter((o) => ['paid', 'packed', 'shipped', 'delivered'].includes(o.status)).length;
    const pending = orderSummariesInRange.filter((o) => o.status === 'pending').length;
    const totalRevenue = orderSummariesInRange
      .filter((o) => ['paid', 'packed', 'shipped', 'delivered'].includes(o.status))
      .reduce((sum, o) => sum + Number(o.total_price || 0), 0);
    return { paid, pending, totalRevenue };
  }, [orderSummariesInRange]);

  const itemizedOrdersCount = useMemo(() => orderSummariesInRange.filter((o) => o.itemized).length, [orderSummariesInRange]);

  const filteredOrders = useMemo(() => {
    const q = orderQuery.trim().toLowerCase();
    return orderSummariesInRange.filter((order) => {
      const statusMatch = statusFilter === 'all' || order.status === statusFilter;
      const queryMatch = !q
        || String(order.id).includes(q)
        || String(order.customer_id || '').toLowerCase().includes(q)
        || String(order.customer_name || '').toLowerCase().includes(q)
        || order.itemLines.some((item) => item.productName.toLowerCase().includes(q));
      return statusMatch && queryMatch;
    });
  }, [orderSummariesInRange, statusFilter, orderQuery]);

  const sortedFilteredOrders = useMemo(() => {
    const arr = [...filteredOrders];
    arr.sort((a, b) => {
      let cmp = 0;
      if (sortKey === 'date') {
        const ta = a.created_at ? new Date(a.created_at).getTime() : 0;
        const tb = b.created_at ? new Date(b.created_at).getTime() : 0;
        cmp = ta - tb;
      } else if (sortKey === 'total') {
        cmp = Number(a.total_price || 0) - Number(b.total_price || 0);
      } else {
        cmp = a.id - b.id;
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return arr;
  }, [filteredOrders, sortKey, sortDir]);

  const exportOrdersCsv = useCallback(() => {
    const header = ['order_id', 'created_at', 'status', 'total', 'customer_id', 'customer_name', 'items_count', 'itemized'];
    const lines = [
      header.join(','),
      ...sortedFilteredOrders.map((o) =>
        [
          o.id,
          escapeCsvCell(o.created_at || ''),
          o.status,
          Number(o.total_price || 0).toFixed(2),
          escapeCsvCell(String(o.customer_id || '')),
          escapeCsvCell(o.customer_name || ''),
          o.itemCount,
          o.itemized ? 'yes' : 'no',
        ].join(','),
      ),
    ];
    const blob = new Blob([lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `healhub-sales-orders-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [sortedFilteredOrders]);

  function toggleSort(key: OrderSortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir(key === 'id' ? 'asc' : 'desc');
    }
  }

  const salesTrend = useMemo(() => {
    const group = new Map<string, number>();
    for (const o of orderSummariesInRange) {
      const k = timeAxis === 'day' ? dayKey(o.created_at) : monthKey(o.created_at);
      if (k === 'Unknown') continue;
      group.set(k, (group.get(k) || 0) + Number(o.total_price || 0));
    }
    const labels = Array.from(group.keys()).sort();
    const values = labels.map((k) => group.get(k) || 0);
    const prevValues = labels.map((k) => group.get(getPreviousKey(k, timeAxis, compareMode)) || 0);
    return {
      labels,
      datasets: [
        { label: 'Sales', data: values, borderColor: '#2563eb', backgroundColor: '#2563eb', tension: 0.25 },
        { label: compareMode === 'prevYear' ? 'Previous Year' : 'Previous Month', data: prevValues, borderColor: '#94a3b8', backgroundColor: '#94a3b8', borderDash: [6, 4], tension: 0.25 },
      ],
    };
  }, [orderSummariesInRange, timeAxis, compareMode]);

  const salesByCategory = useMemo(() => {
    const sums: Record<string, number> = { Prescription: 0, OTC: 0, Supplements: 0, 'Personal Care': 0 };
    for (const item of orderItemsInRange) {
      const p = productMap.get(Number(item.product_id));
      if (!p) continue;
      const cat = inferCategory(p);
      sums[cat] += Number(item.line_total ?? (Number(item.quantity || 0) * Number(item.unit_price || 0)));
    }
    return {
      labels: [...CATEGORY_LIST],
      datasets: [{ label: 'Sales by Category', data: CATEGORY_LIST.map((c) => sums[c] || 0), backgroundColor: ['#2563eb', '#10b981', '#f59e0b', '#ec4899'] }],
    };
  }, [productMap, orderItemsInRange]);

  const top10Products = useMemo(() => {
    const qtyMap = new Map<number, number>();
    const revMap = new Map<number, number>();
    for (const item of orderItemsInRange) {
      const pid = Number(item.product_id);
      if (!pid || !productMap.has(pid)) continue;
      qtyMap.set(pid, (qtyMap.get(pid) || 0) + Number(item.quantity || 0));
      revMap.set(pid, (revMap.get(pid) || 0) + Number(item.line_total || 0));
    }
    const top = Array.from(productMap.keys())
      .map((pid) => ({ pid, name: productMap.get(pid)?.name || `#${pid}`, qty: qtyMap.get(pid) || 0, rev: revMap.get(pid) || 0 }))
      .filter((x) => x.qty > 0 || x.rev > 0)
      .sort((a, b) => (topMetric === 'quantity' ? b.qty - a.qty : b.rev - a.rev))
      .slice(0, 10);
    return {
      labels: top.map((t) => t.name),
      datasets: [{ label: topMetric === 'quantity' ? 'Quantity' : 'Revenue', data: topMetric === 'quantity' ? top.map((t) => t.qty) : top.map((t) => t.rev), backgroundColor: '#6366f1' }],
    };
  }, [productMap, orderItemsInRange, topMetric]);

  const genericVsBranded = useMemo(() => {
    let genericSales = 0;
    let brandedSales = 0;
    for (const item of orderItemsInRange) {
      const p = productMap.get(Number(item.product_id));
      if (!p) continue;
      const amount = Number(item.line_total ?? (Number(item.quantity || 0) * Number(item.unit_price || 0)));
      if (isBranded(p.name)) brandedSales += amount;
      else genericSales += amount;
    }
    return {
      labels: ['% Generic Sales', '% Branded Sales'],
      datasets: [{ data: [genericSales, brandedSales], backgroundColor: ['#0ea5e9', '#8b5cf6'] }],
    };
  }, [productMap, orderItemsInRange]);

  const datePresetLabel =
    datePreset === 'all' ? 'All loaded orders' : datePreset === '7d' ? 'Last 7 days' : datePreset === '30d' ? 'Last 30 days' : 'Last 90 days';

  return (
    <OwnerLayout title="Sale">
      <div className="mb-4 space-y-2">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">Sales</p>
        <p className="text-sm text-slate-600 dark:text-slate-300">
          Charts and KPIs use the <strong className="text-slate-800 dark:text-slate-100">date range</strong> below. Up to 500 recent orders are loaded.
        </p>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Period:</span>
        {(['7d', '30d', '90d', 'all'] as const).map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => setDatePreset(p)}
            className={cx(
              'rounded-full px-3 py-1.5 text-xs font-semibold transition',
              datePreset === p
                ? 'bg-indigo-600 text-white shadow-sm'
                : isDark
                  ? 'bg-slate-700 text-slate-200 hover:bg-slate-600'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200',
            )}
          >
            {p === '7d' ? '7d' : p === '30d' ? '30d' : p === '90d' ? '90d' : 'All'}
          </button>
        ))}
      </div>

      {error && (
        <p className="mb-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800 dark:border-rose-900/50 dark:bg-rose-950/40 dark:text-rose-200">
          {error}
        </p>
      )}
      {!error && !loading && orders.length === 0 && <p className="mb-3 text-sm text-amber-700">No sales/orders data yet.</p>}
      {!error && !loading && orders.length > 0 && itemizedOrdersCount === 0 && (
        <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Orders exist, but <span className="font-semibold">order_items</span> is still empty. Item-level analytics stay limited, and stock-safe status changes are blocked until orders are itemized properly.
        </div>
      )}

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className={cx('rounded-xl border p-3', isDark ? 'border-slate-600 bg-slate-800/50' : 'border-slate-200 bg-slate-50')}>
          <p className="text-xs text-slate-500 dark:text-slate-400">Orders ({datePresetLabel})</p>
          <p className="text-xl font-bold text-slate-900 dark:text-white">{orderSummariesInRange.length}</p>
        </div>
        <div className={cx('rounded-xl border p-3', isDark ? 'border-slate-600 bg-slate-800/50' : 'border-slate-200 bg-slate-50')}>
          <p className="text-xs text-slate-500 dark:text-slate-400">Paid pipeline</p>
          <p className="text-xl font-bold text-indigo-700 dark:text-indigo-300">{stats.paid}</p>
        </div>
        <div className={cx('rounded-xl border p-3', isDark ? 'border-slate-600 bg-slate-800/50' : 'border-slate-200 bg-slate-50')}>
          <p className="text-xs text-slate-500 dark:text-slate-400">Pending</p>
          <p className="text-xl font-bold text-amber-700 dark:text-amber-300">{stats.pending}</p>
        </div>
        <div className={cx('rounded-xl border p-3', isDark ? 'border-slate-600 bg-slate-800/50' : 'border-slate-200 bg-slate-50')}>
          <p className="text-xs text-slate-500 dark:text-slate-400">Revenue (paid+)</p>
          <p className="text-xl font-bold text-emerald-700 dark:text-emerald-300">{formatMoney(stats.totalRevenue)}</p>
        </div>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-2">
        <div className={cx('rounded-xl border p-3', isDark ? 'border-slate-600 bg-slate-800/50' : 'border-slate-200 bg-white')}>
          <p className="text-xs text-slate-500 dark:text-slate-400">Itemized in period</p>
          <p className="text-lg font-bold text-slate-800 dark:text-slate-100">{itemizedOrdersCount}</p>
        </div>
        <div className={cx('rounded-xl border p-3', isDark ? 'border-slate-600 bg-slate-800/50' : 'border-slate-200 bg-white')}>
          <p className="text-xs text-slate-500 dark:text-slate-400">Loaded (max 500)</p>
          <p className="text-lg font-bold text-slate-800 dark:text-slate-100">{orders.length}</p>
        </div>
      </div>

      <section className={cx('mb-3 rounded-xl border p-3 text-sm', isDark ? 'border-slate-600 bg-slate-800/40 text-slate-300' : 'border-slate-200 bg-white text-slate-600')}>
        <p>
          <span className="font-semibold text-slate-800 dark:text-slate-100">Order model:</span> charts follow the selected period. Product-level analytics use{' '}
          <span className="font-medium">order_items</span> for orders in that period.
        </p>
      </section>

      <section className="mb-5 rounded-xl border p-3">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">Sales Trend (Line Chart)</h3>
          <div className="flex gap-2">
            <select className="rounded border px-2 py-1 text-xs" value={timeAxis} onChange={(e) => setTimeAxis(e.target.value as 'day' | 'month')}>
              <option value="day">Axis: Day</option>
              <option value="month">Axis: Month</option>
            </select>
            <select className="rounded border px-2 py-1 text-xs" value={compareMode} onChange={(e) => setCompareMode(e.target.value as 'prevMonth' | 'prevYear')}>
              <option value="prevMonth">Previous Month</option>
              <option value="prevYear">Previous Year</option>
            </select>
          </div>
        </div>
        <Line data={salesTrend} />
      </section>

      <section className="grid gap-5 lg:grid-cols-2">
        <div className="rounded-xl border p-3">
          <h3 className="mb-2 text-sm font-semibold">Sales by Category</h3>
          <Bar data={salesByCategory} />
        </div>

        <div className="rounded-xl border p-3">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold">Top 10 Products</h3>
            <select className="rounded border px-2 py-1 text-xs" value={topMetric} onChange={(e) => setTopMetric(e.target.value as 'revenue' | 'quantity')}>
              <option value="revenue">Revenue</option>
              <option value="quantity">Quantity</option>
            </select>
          </div>
          <Bar data={top10Products} options={{ indexAxis: 'y' }} />
        </div>

        <div className="rounded-xl border p-3 lg:col-span-2">
          <h3 className="mb-2 text-sm font-semibold">Generic vs Branded (Donut)</h3>
          <div className="mx-auto max-w-xs"><Doughnut data={genericVsBranded} /></div>
        </div>
      </section>

      {loading ? (
        <p className="mt-4 text-sm text-slate-500">Loading orders...</p>
      ) : (
        <section className="mt-5">
          <div className="rounded-xl border bg-white p-3 shadow-sm dark:border-slate-700 dark:bg-slate-800">
            <div className="mb-3 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Order Management</h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">Search, filter, sort, export, and update status ({datePresetLabel}).</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  className="rounded-lg border border-slate-300 px-3 py-2 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700"
                  disabled={sortedFilteredOrders.length === 0}
                  onClick={exportOrdersCsv}
                  type="button"
                >
                  Export CSV
                </button>
                <button
                  className="rounded-lg border border-slate-300 px-3 py-2 text-xs text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700"
                  onClick={loadOrders}
                  type="button"
                >
                  Refresh
                </button>
              </div>
            </div>

            <div className="mb-3 grid gap-2 md:grid-cols-[1fr_180px]">
              <input
                className="rounded border px-3 py-2 text-sm"
                placeholder="Search by order ID, customer, or product"
                value={orderQuery}
                onChange={(e) => setOrderQuery(e.target.value)}
              />
              <select
                className="rounded border px-3 py-2 text-sm"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as 'all' | Order['status'])}
              >
                <option value="all">All statuses</option>
                {statuses.map((status) => (
                  <option key={status} value={status}>{status}</option>
                ))}
              </select>
            </div>

            <div className="mb-3 text-xs text-slate-500 dark:text-slate-400">
              {sortedFilteredOrders.length} listed · {orderSummariesInRange.length} in {datePresetLabel}
              {orderQuery.trim() || statusFilter !== 'all' ? ' (search/status applied)' : ''}
            </div>

            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-slate-500 dark:text-slate-400">
                    <th className="py-2">
                      <button type="button" className="font-semibold hover:text-indigo-600 dark:hover:text-indigo-400" onClick={() => toggleSort('id')}>
                        Order {sortKey === 'id' ? (sortDir === 'asc' ? '↑' : '↓') : ''}
                      </button>
                    </th>
                    <th>
                      <button type="button" className="font-semibold hover:text-indigo-600 dark:hover:text-indigo-400" onClick={() => toggleSort('date')}>
                        Created {sortKey === 'date' ? (sortDir === 'asc' ? '↑' : '↓') : ''}
                      </button>
                    </th>
                    <th>Items</th>
                    <th>
                      <button type="button" className="font-semibold hover:text-indigo-600 dark:hover:text-indigo-400" onClick={() => toggleSort('total')}>
                        Total {sortKey === 'total' ? (sortDir === 'asc' ? '↑' : '↓') : ''}
                      </button>
                    </th>
                    <th>Status</th>
                    <th>Details</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedFilteredOrders.map((order) => (
                    <tr
                      key={order.id}
                      className="border-b last:border-0"
                    >
                      <td className="py-2 font-medium text-slate-800">#{order.id}</td>
                      <td className="text-xs text-slate-500">{order.created_at ? new Date(order.created_at).toLocaleString() : 'N/A'}</td>
                      <td className="text-xs text-slate-700">{order.itemized ? `${order.itemCount} item(s)` : 'Not itemized'}</td>
                      <td className="font-medium text-slate-800">{formatMoney(order.total_price)}</td>
                      <td>
                        <span className="rounded-full bg-slate-100 px-2 py-1 text-xs capitalize text-slate-700">{order.status}</span>
                      </td>
                      <td>
                        <button
                          type="button"
                          className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-700 hover:bg-slate-50"
                          onClick={() => navigate(`/owner/sale/${order.id}`)}
                        >
                          View
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      )}
    </OwnerLayout>
  );
}
