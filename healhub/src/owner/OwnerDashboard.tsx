import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useOutletContext } from 'react-router-dom';
import {
  ArcElement,
  BarElement,
  CategoryScale,
  Chart as ChartJS,
  Filler,
  Legend,
  LinearScale,
  LineElement,
  PointElement,
  Title,
  Tooltip,
} from 'chart.js';
import { Doughnut, Line } from 'react-chartjs-2';
import {
  fetchDailyRevenueInPreset,
  fetchKpis,
  fetchMonthlyRevenue,
  fetchOwnerAiPhase1Snapshot,
  fetchOrderStatusBreakdown,
  fetchPeriodMetrics,
  fetchProducts,
  fetchRecentOrders,
  fetchRefundDashboardStats,
  fetchTopProducts,
  type DateRangePreset,
  type OwnerAiPhase1Snapshot,
  type OrderStatusBreakdown,
  type PeriodMetrics,
  type RefundDashboardStats,
  type TopProductRow,
} from '../services/dashboardService';
import type { KpiSummary, Order, Product } from '../types/domain';
import { useTheme } from '../context/ThemeContext';
import type { OwnerShellOutletContext } from './ownerShellOutlet';

ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  LineElement,
  PointElement,
  ArcElement,
  Title,
  Tooltip,
  Legend,
  Filler,
);

const defaultKpis: KpiSummary = {
  totalOrders: 0,
  totalRevenue: 0,
  totalStock: 0,
  revenueOrderCount: 0,
  pendingOrders: 0,
  cancelledOrders: 0,
  avgOrderValue: 0,
  activeProductCount: 0,
};

const defaultPeriodMetrics: PeriodMetrics = {
  revenue: 0,
  orderCount: 0,
  revenueOrderCount: 0,
  previousRevenue: 0,
  previousOrderCount: 0,
  previousRevenueOrderCount: 0,
};

const STATUS_LABELS: Record<string, string> = {
  pending: 'Pending',
  paid: 'Paid',
  packed: 'Packed',
  shipped: 'Shipped',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
};

const RANGE_OPTIONS: { id: DateRangePreset; label: string }[] = [
  { id: '1d', label: '1 day' },
  { id: '7d', label: '7 days' },
  { id: '30d', label: '30 days' },
  { id: '90d', label: '90 days' },
  { id: '1y', label: 'One year' },
  { id: 'all', label: 'All time' },
];

function pctChangeLabel(current: number, previous: number): string {
  if (previous === 0) return current > 0 ? '+∞ vs prior window' : '— vs prior window';
  const p = ((current - previous) / previous) * 100;
  const sign = p >= 0 ? '+' : '';
  return `${sign}${p.toFixed(1)}% vs prior window`;
}

function periodCompareHint(preset: DateRangePreset, current: number, previous: number): string {
  if (preset === 'all') return 'Lifetime · no prior window';
  return pctChangeLabel(current, previous);
}

const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

/** Chart x-axis: month labels for All time (`YYYY-MM`), short dates for daily presets. */
function formatRevenueChartLabel(periodKey: string, preset: DateRangePreset): string {
  if (preset === 'all' && /^\d{4}-\d{2}$/.test(periodKey)) {
    const [y, m] = periodKey.split('-');
    const mi = parseInt(m, 10) - 1;
    if (y && mi >= 0 && mi < 12) return `${MONTH_SHORT[mi]} ${y}`;
  }
  if (periodKey.length >= 10) return periodKey.slice(5);
  return periodKey;
}

function buildOrdersCsvBlob(orders: Order[]): { blob: Blob; filename: string } {
  const headers = ['Order ID', 'Created', 'Customer', 'Total_THB', 'Status'];
  const rows = orders.map((o) => [
    String(o.id),
    o.created_at ?? '',
    o.customer_name ?? '',
    String(o.total_price),
    o.status,
  ]);
  const bom = '\uFEFF';
  const csv = [headers, ...rows].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob([bom + csv], { type: 'text/csv;charset=utf-8;' });
  const filename = `healhub-orders-${new Date().toISOString().slice(0, 10)}.csv`;
  return { blob, filename };
}

/**
 * Avoid `a.click()` without appending — iOS WebView often navigates to the blob URL and shows raw CSV with no back UI.
 */
function downloadOrdersCsvFile(orders: Order[]): void {
  const { blob, filename } = buildOrdersCsvBlob(orders);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  a.setAttribute('rel', 'noopener');
  document.body.appendChild(a);
  a.click();
  requestAnimationFrame(() => {
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  });
}

const CHART_COLORS = {
  doughnut: ['#6366f1', '#22c55e', '#f59e0b', '#3b82f6', '#a855f7', '#ef4444'],
  pie: ['#6366f1', '#0ea5e9', '#14b8a6', '#eab308', '#f97316', '#8b5cf6'],
  line: '#6366f1',
  bar: '#6366f1',
};

function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(' ');
}

function fmtBaht(n: number) {
  return `฿${Number(n || 0).toFixed(2)}`;
}

function fmtDate(iso?: string) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
  } catch {
    return '—';
  }
}

function KpiCard({
  title,
  value,
  hint,
}: {
  title: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded-2xl border border-slate-200/90 bg-white p-4 shadow-sm ring-1 ring-slate-900/5 dark:border-slate-700 dark:bg-slate-800/90 dark:ring-white/5">
      <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500 dark:text-slate-400">{title}</p>
      <p className="mt-2 text-2xl font-bold tabular-nums tracking-tight text-slate-900 dark:text-white">{value}</p>
      {hint ? <p className="mt-1.5 text-xs leading-snug text-slate-500 dark:text-slate-400">{hint}</p> : null}
    </div>
  );
}

function Panel({ title, subtitle, children, action }: { title: string; subtitle?: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-slate-200/90 bg-white p-4 shadow-sm ring-1 ring-slate-900/5 dark:border-slate-700 dark:bg-slate-800/90 dark:ring-white/5 md:p-5">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold text-slate-900 dark:text-white">{title}</h2>
          {subtitle ? <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{subtitle}</p> : null}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function chartFontColor(isDark: boolean) {
  return isDark ? '#e2e8f0' : '#475569';
}

function chartGridColor(isDark: boolean) {
  return isDark ? 'rgba(148,163,184,0.15)' : 'rgba(100,116,139,0.12)';
}

export default function OwnerDashboard() {
  const { registerOwnerAiPageData } = useOutletContext<OwnerShellOutletContext>();
  const { mode } = useTheme();
  const isDark = mode === 'dark';

  const [kpis, setKpis] = useState<KpiSummary>(defaultKpis);
  const [products, setProducts] = useState<Product[]>([]);
  const [recentOrders, setRecentOrders] = useState<Order[]>([]);
  const [monthlyRevenue, setMonthlyRevenue] = useState<{ month: string; revenue: number }[]>([]);
  const [statusBreakdown, setStatusBreakdown] = useState<OrderStatusBreakdown>({});
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [lastLoaded, setLastLoaded] = useState<Date | null>(null);
  const [overviewRange, setOverviewRange] = useState<DateRangePreset>('30d');
  const [revenueRange, setRevenueRange] = useState<DateRangePreset>('30d');
  const [statusRange, setStatusRange] = useState<DateRangePreset>('30d');
  const [topProductsRange, setTopProductsRange] = useState<DateRangePreset>('30d');
  const [periodMetrics, setPeriodMetrics] = useState<PeriodMetrics>(defaultPeriodMetrics);
  const [dailyRevenue, setDailyRevenue] = useState<{ day: string; revenue: number }[]>([]);
  const [refundStats, setRefundStats] = useState<RefundDashboardStats | null>(null);
  const [topProducts, setTopProducts] = useState<TopProductRow[]>([]);
  const [aiMonth, setAiMonth] = useState<number>(new Date().getMonth());
  const [aiSnapshot, setAiSnapshot] = useState<OwnerAiPhase1Snapshot | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState('');
  const [exportPreviewOpen, setExportPreviewOpen] = useState(false);
  const [periodLoading, setPeriodLoading] = useState(false);
  const [revenueLoading, setRevenueLoading] = useState(false);
  const [statusLoading, setStatusLoading] = useState(false);
  const [topProductsLoading, setTopProductsLoading] = useState(false);

  useEffect(() => {
    if (!exportPreviewOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [exportPreviewOpen]);

  const loadDashboard = useCallback(async () => {
    try {
      setLoading(true);
      const [
        kpiData,
        productData,
        orderData,
        monthlyData,
        refundData,
      ] = await Promise.all([
        fetchKpis(),
        fetchProducts(),
        fetchRecentOrders(12),
        fetchMonthlyRevenue(),
        fetchRefundDashboardStats(),
      ]);
      setKpis(kpiData);
      setProducts(productData);
      setRecentOrders(orderData);
      setMonthlyRevenue(monthlyData);
      setRefundStats(refundData);
      setError('');
      setLastLoaded(new Date());
    } catch (e) {
      console.error(e);
      setError('Could not load dashboard data. Check Supabase keys, RLS, and that the monthly_sales view exists.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);

  useEffect(() => {
    let cancelled = false;
    async function loadPeriodMetricsPanel() {
      try {
        setPeriodLoading(true);
        const periodData = await fetchPeriodMetrics(overviewRange);
        if (!cancelled) setPeriodMetrics(periodData);
      } finally {
        if (!cancelled) setPeriodLoading(false);
      }
    }
    void loadPeriodMetricsPanel();
    return () => {
      cancelled = true;
    };
  }, [overviewRange]);

  useEffect(() => {
    let cancelled = false;
    async function loadRevenuePanel() {
      try {
        setRevenueLoading(true);
        const dailyData = await fetchDailyRevenueInPreset(revenueRange);
        if (!cancelled) setDailyRevenue(dailyData);
      } finally {
        if (!cancelled) setRevenueLoading(false);
      }
    }
    void loadRevenuePanel();
    return () => {
      cancelled = true;
    };
  }, [revenueRange]);

  useEffect(() => {
    let cancelled = false;
    async function loadStatusPanel() {
      try {
        setStatusLoading(true);
        const statusData = await fetchOrderStatusBreakdown(statusRange);
        if (!cancelled) setStatusBreakdown(statusData);
      } finally {
        if (!cancelled) setStatusLoading(false);
      }
    }
    void loadStatusPanel();
    return () => {
      cancelled = true;
    };
  }, [statusRange]);

  useEffect(() => {
    let cancelled = false;
    async function loadTopProductsPanel() {
      try {
        setTopProductsLoading(true);
        const topData = await fetchTopProducts(8, topProductsRange);
        if (!cancelled) setTopProducts(topData);
      } finally {
        if (!cancelled) setTopProductsLoading(false);
      }
    }
    void loadTopProductsPanel();
    return () => {
      cancelled = true;
    };
  }, [topProductsRange]);

  useEffect(() => {
    let cancelled = false;
    async function loadAiPanel() {
      try {
        setAiLoading(true);
        const data = await fetchOwnerAiPhase1Snapshot(aiMonth);
        if (!cancelled) {
          setAiSnapshot(data);
          setAiError('');
        }
      } catch {
        if (!cancelled) {
          setAiSnapshot(null);
          setAiError('Could not load AI operations insights.');
        }
      } finally {
        if (!cancelled) setAiLoading(false);
      }
    }
    void loadAiPanel();
    return () => {
      cancelled = true;
    };
  }, [aiMonth]);

  useEffect(() => {
    return () => registerOwnerAiPageData(null);
  }, [registerOwnerAiPageData]);

  useEffect(() => {
    if (loading) return;
    if (error) {
      registerOwnerAiPageData(null);
      return;
    }
    registerOwnerAiPageData({ kpis, products, recentOrders, monthlyRevenue });
  }, [registerOwnerAiPageData, loading, error, kpis, products, recentOrders, monthlyRevenue]);

  const lowStockProducts = useMemo(
    () => products.filter((p) => p.stock <= (p.low_stock_threshold ?? 10)),
    [products],
  );

  const statusDoughnutData = useMemo(() => {
    const entries = Object.entries(statusBreakdown).filter(([, n]) => n > 0);
    const labels = entries.map(([k]) => STATUS_LABELS[k] ?? k);
    const data = entries.map(([, n]) => n);
    return {
      labels,
      datasets: [
        {
          data,
          backgroundColor: CHART_COLORS.doughnut.slice(0, labels.length),
          borderWidth: 0,
        },
      ],
    };
  }, [statusBreakdown]);

  const dailyLineData = useMemo(() => {
    return {
      labels: dailyRevenue.map((d) => formatRevenueChartLabel(d.day, revenueRange)),
      datasets: [
        {
          label: 'Revenue',
          data: dailyRevenue.map((d) => d.revenue),
          borderColor: CHART_COLORS.line,
          backgroundColor: isDark ? 'rgba(99,102,241,0.12)' : 'rgba(99,102,241,0.08)',
          fill: true,
          tension: revenueRange === 'all' ? 0.25 : 0.35,
          pointRadius: 3,
          pointHoverRadius: 5,
        },
      ],
    };
  }, [dailyRevenue, revenueRange, isDark]);

  const overviewLabel = RANGE_OPTIONS.find((r) => r.id === overviewRange)?.label ?? overviewRange;
  const revenueLabel = RANGE_OPTIONS.find((r) => r.id === revenueRange)?.label ?? revenueRange;
  const statusLabel = RANGE_OPTIONS.find((r) => r.id === statusRange)?.label ?? statusRange;
  const topProductsLabel = RANGE_OPTIONS.find((r) => r.id === topProductsRange)?.label ?? topProductsRange;

  const lineOptions = useMemo(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx: { parsed?: { y?: number | null } }) => fmtBaht(Number(ctx.parsed?.y ?? 0)),
          },
        },
      },
      scales: {
        x: {
          ticks: { color: chartFontColor(isDark), maxRotation: 45, minRotation: 0 },
          grid: { color: chartGridColor(isDark) },
        },
        y: {
          ticks: { color: chartFontColor(isDark) },
          grid: { color: chartGridColor(isDark) },
        },
      },
    }),
    [isDark],
  );

  const doughnutOptions = useMemo(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'bottom' as const,
          labels: { color: chartFontColor(isDark), boxWidth: 12, padding: 12 },
        },
        tooltip: {
          callbacks: {
            label: (ctx: { label?: string; parsed?: number }) => `${ctx.label ?? ''}: ${ctx.parsed ?? 0}`,
          },
        },
      },
    }),
    [isDark],
  );

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 dark:bg-slate-950">
        <div className="flex flex-col items-center gap-3">
          <div className="h-10 w-10 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent" aria-hidden />
          <p className="text-sm font-medium text-slate-600 dark:text-slate-300">Loading dashboard…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      <div className="mx-auto max-w-7xl px-3 py-4 md:px-6 md:py-8">
        <main className="space-y-6">
          <header className="overflow-hidden rounded-2xl border border-slate-200/90 bg-white shadow-sm ring-1 ring-slate-900/5 dark:border-slate-700 dark:bg-slate-900 dark:ring-white/5">
            <div className="relative border-b border-slate-100 bg-gradient-to-r from-indigo-600 to-violet-600 px-4 py-5 md:px-6 md:py-6">
              <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between md:gap-6">
                <div className="min-w-0">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-indigo-100/90">Analytics</p>
                  <h1 className="mt-1 text-2xl font-bold tracking-tight text-white md:text-3xl">Dashboard</h1>
                  <p className="mt-1 max-w-xl text-sm text-indigo-100/95">
                    Revenue from completed pipeline orders. Totals use the <code className="rounded bg-white/10 px-1">monthly_sales</code> view when
                    available.
                  </p>
                </div>
                <div className="flex flex-shrink-0 flex-wrap items-center gap-2 md:justify-end">
                  <Link
                    to="/owner"
                    className="rounded-xl bg-white/15 px-3 py-2 text-sm font-medium text-white backdrop-blur hover:bg-white/25"
                  >
                    ← Home
                  </Link>
                  <button
                    type="button"
                    onClick={() => void loadDashboard()}
                    className="rounded-xl bg-white/15 px-3 py-2 text-sm font-medium text-white backdrop-blur hover:bg-white/25"
                  >
                    <span className="md:hidden">Refresh</span>
                    <span className="hidden md:inline">Refresh data</span>
                  </button>
                </div>
              </div>
            </div>
            {lastLoaded && (
              <p className="px-4 py-2 text-xs text-slate-500 dark:text-slate-400 md:px-6">
                Last updated: {lastLoaded.toLocaleString()}
              </p>
            )}
          </header>

          {error && (
            <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800 dark:border-rose-900/50 dark:bg-rose-950/40 dark:text-rose-200">
              {error}
            </div>
          )}

          <section className="rounded-2xl border-2 border-indigo-200 bg-white p-4 shadow-md ring-1 ring-indigo-500/10 dark:border-indigo-700 dark:bg-slate-800/95 dark:ring-indigo-400/10">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between sm:gap-4">
              <div className="min-w-0 flex-1 space-y-2">
                <p className="text-xs font-bold uppercase tracking-wide text-indigo-700 dark:text-indigo-300">Overview KPI filter</p>
                <div className="relative sm:max-w-xs">
                  <label htmlFor="dashboard-date-range" className="sr-only">
                    Date range
                  </label>
                  <select
                    id="dashboard-date-range"
                    value={overviewRange}
                    onChange={(e) => setOverviewRange(e.target.value as DateRangePreset)}
                    className={cx(
                      'w-full appearance-none rounded-xl border border-slate-200 bg-slate-50 py-2 pl-3 pr-10 text-sm font-medium text-slate-800 shadow-sm outline-none ring-indigo-500/0 transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100',
                    )}
                  >
                    {RANGE_OPTIONS.map((opt) => (
                      <option key={opt.id} value={opt.id}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                  <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 dark:text-slate-400" aria-hidden>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setExportPreviewOpen(true)}
                className="shrink-0 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800 sm:self-end"
              >
                Export orders CSV
              </button>
            </div>
          </section>

          <section className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Overview period · {overviewLabel}{' '}
              <span className="font-normal normal-case text-slate-400">
                {overviewRange === 'all' ? '(lifetime · vs prior N/A)' : '(vs previous same-length window)'}
              </span>
            </p>
            {periodLoading ? (
              <p className="text-sm text-slate-500">Loading overview KPIs…</p>
            ) : (
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <KpiCard
                  title="Period revenue"
                  value={fmtBaht(periodMetrics.revenue)}
                  hint={periodCompareHint(overviewRange, periodMetrics.revenue, periodMetrics.previousRevenue)}
                />
                <KpiCard
                  title="Revenue orders (period)"
                  value={String(periodMetrics.revenueOrderCount)}
                  hint={periodCompareHint(overviewRange, periodMetrics.revenueOrderCount, periodMetrics.previousRevenueOrderCount)}
                />
                <KpiCard
                  title="All orders (period)"
                  value={String(periodMetrics.orderCount)}
                  hint={periodCompareHint(overviewRange, periodMetrics.orderCount, periodMetrics.previousOrderCount)}
                />
                <KpiCard
                  title="Avg order (period)"
                  value={fmtBaht(periodMetrics.revenueOrderCount > 0 ? periodMetrics.revenue / periodMetrics.revenueOrderCount : 0)}
                  hint="Revenue ÷ revenue-status orders"
                />
              </div>
            )}
          </section>

          <section className="grid grid-cols-1 gap-5">
            <Panel
              title="AI operations center"
              subtitle={`Forecast and risk analysis for ${MONTH_SHORT[aiMonth]}`}
              action={
                <div className="flex flex-wrap items-center gap-2">
                  <div className="relative min-w-[9rem]">
                    <select
                      aria-label="AI month"
                      value={aiMonth}
                      onChange={(e) => setAiMonth(Number(e.target.value))}
                      className={cx(
                        'w-full appearance-none rounded-lg border border-slate-200 bg-slate-50 py-1.5 pl-2 pr-8 text-xs font-medium text-slate-700 outline-none ring-indigo-500/0 transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100',
                      )}
                    >
                      {MONTH_SHORT.map((label, index) => (
                        <option key={label} value={index}>
                          {label}
                        </option>
                      ))}
                    </select>
                    <span
                      className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 dark:text-slate-400"
                      aria-hidden
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </span>
                  </div>
                </div>
              }
            >
              {aiLoading ? (
                <p className="text-sm text-slate-500">Loading AI insights…</p>
              ) : aiError ? (
                <p className="text-sm text-rose-600 dark:text-rose-300">{aiError}</p>
              ) : !aiSnapshot ? (
                <p className="text-sm text-slate-500">No AI insights available for this month yet.</p>
              ) : (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                    <div className="rounded-xl border border-slate-100 bg-gradient-to-br from-slate-50 to-white p-3 dark:border-slate-700 dark:from-slate-900/50 dark:to-slate-900/20">
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">1) Previous month top seller</p>
                      {aiSnapshot.salesInsights.previousMonthTopSeller ? (
                        <>
                          <p className="mt-1 text-base font-semibold text-slate-900 dark:text-slate-100">
                            {aiSnapshot.salesInsights.previousMonthTopSeller.name}
                          </p>
                          <p className="mt-0.5 text-xs text-slate-600 dark:text-slate-300">
                            {aiSnapshot.salesInsights.previousMonthTopSeller.monthKey} · {aiSnapshot.salesInsights.previousMonthTopSeller.units} units ·{' '}
                            {fmtBaht(aiSnapshot.salesInsights.previousMonthTopSeller.revenue)}
                          </p>
                        </>
                      ) : (
                        <p className="mt-1 text-xs text-slate-500">No data.</p>
                      )}
                    </div>

                    <div className="rounded-xl border border-slate-100 bg-gradient-to-br from-slate-50 to-white p-3 dark:border-slate-700 dark:from-slate-900/50 dark:to-slate-900/20">
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">2) Same month last year top seller</p>
                      {aiSnapshot.salesInsights.sameMonthLastYearTopSeller ? (
                        <>
                          <p className="mt-1 text-base font-semibold text-slate-900 dark:text-slate-100">
                            {aiSnapshot.salesInsights.sameMonthLastYearTopSeller.name}
                          </p>
                          <p className="mt-0.5 text-xs text-slate-600 dark:text-slate-300">
                            {aiSnapshot.salesInsights.sameMonthLastYearTopSeller.monthKey} · {aiSnapshot.salesInsights.sameMonthLastYearTopSeller.units} units ·{' '}
                            {fmtBaht(aiSnapshot.salesInsights.sameMonthLastYearTopSeller.revenue)}
                          </p>
                        </>
                      ) : (
                        <p className="mt-1 text-xs text-slate-500">No data.</p>
                      )}
                    </div>

                    <div className="rounded-xl border border-indigo-100 bg-gradient-to-br from-indigo-50 to-violet-50 p-3 dark:border-indigo-900/50 dark:from-indigo-950/40 dark:to-violet-950/30">
                      <p className="text-xs font-semibold uppercase tracking-wide text-indigo-600 dark:text-indigo-300">3) Predicted current month best-seller</p>
                      {aiSnapshot.salesInsights.predictedCurrentMonthBestSeller ? (
                        <>
                          <p className="mt-1 text-base font-semibold text-slate-900 dark:text-slate-100">
                            {aiSnapshot.salesInsights.predictedCurrentMonthBestSeller.name}
                          </p>
                          <p className="mt-0.5 text-xs text-slate-600 dark:text-slate-300">
                            {aiSnapshot.salesInsights.predictedCurrentMonthBestSeller.monthKey} · {aiSnapshot.salesInsights.predictedCurrentMonthBestSeller.units} units ·{' '}
                            {fmtBaht(aiSnapshot.salesInsights.predictedCurrentMonthBestSeller.revenue)}
                          </p>
                          <p className="mt-1 text-[11px] font-medium text-indigo-700 dark:text-indigo-300">
                            Confidence: {aiSnapshot.salesInsights.predictedCurrentMonthBestSeller.confidence}
                          </p>
                        </>
                      ) : (
                        <p className="mt-1 text-xs text-slate-500">No data.</p>
                      )}
                    </div>
                  </div>

                  <div className="rounded-xl border border-emerald-100 bg-emerald-50/40 p-3 dark:border-emerald-900/40 dark:bg-emerald-950/20">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                      4) Predicted seasonal disease signals ({MONTH_SHORT[aiMonth]})
                    </p>
                    {aiSnapshot.salesInsights.seasonalDiseaseOutlook.length === 0 ? (
                      <p className="mt-2 text-sm text-slate-500">No seasonal signals available.</p>
                    ) : (
                      <ul className="mt-2 space-y-1.5 text-sm">
                        {aiSnapshot.salesInsights.seasonalDiseaseOutlook.map((signal) => (
                          <li key={signal.disease} className="text-slate-700 dark:text-slate-200">
                            <span className="font-semibold">{signal.disease}:</span> {signal.reason}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>

                  <div className="rounded-xl border border-slate-100 p-3 dark:border-slate-700">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                      Demand forecast (next 30 days)
                    </p>
                    {aiSnapshot.demandForecast.length === 0 ? (
                      <p className="mt-2 text-sm text-slate-500">No forecastable product sales yet.</p>
                    ) : (
                      <div className="mt-2 overflow-x-auto">
                        <table className="min-w-full text-sm">
                          <thead>
                            <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-500 dark:border-slate-700 dark:text-slate-400">
                              <th className="px-2 py-1.5">Product</th>
                              <th className="px-2 py-1.5 text-right">Stock</th>
                              <th className="px-2 py-1.5 text-right">Pred. units</th>
                              <th className="px-2 py-1.5 text-right">Pred. revenue</th>
                              <th className="px-2 py-1.5 text-right">Confidence</th>
                            </tr>
                          </thead>
                          <tbody>
                            {aiSnapshot.demandForecast.slice(0, 8).map((r) => (
                              <tr key={r.productId} className="border-b border-slate-50 last:border-0 dark:border-slate-800">
                                <td className="max-w-[14rem] truncate px-2 py-1.5 text-slate-900 dark:text-slate-100">{r.name}</td>
                                <td className="px-2 py-1.5 text-right tabular-nums text-slate-700 dark:text-slate-200">{r.currentStock}</td>
                                <td className="px-2 py-1.5 text-right tabular-nums text-slate-700 dark:text-slate-200">{r.predictedUnitsNext30}</td>
                                <td className="px-2 py-1.5 text-right tabular-nums font-medium text-slate-900 dark:text-slate-100">{fmtBaht(r.predictedRevenueNext30)}</td>
                                <td className="px-2 py-1.5 text-right text-xs font-semibold uppercase text-indigo-700 dark:text-indigo-300">{r.confidence}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>

                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                    <div className="rounded-xl border border-rose-100 bg-rose-50/40 p-3 dark:border-rose-900/40 dark:bg-rose-950/20">
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Stockout risk alerts</p>
                      {aiSnapshot.stockoutAlerts.length === 0 ? (
                        <p className="mt-2 text-sm text-slate-500">No stockout risk alerts for this month.</p>
                      ) : (
                        <ul className="mt-2 space-y-1.5 text-sm">
                          {aiSnapshot.stockoutAlerts.slice(0, 6).map((a) => (
                            <li key={a.productId} className="text-slate-700 dark:text-slate-200">
                              <span className="font-semibold">{a.name}</span> · {a.riskLevel} risk · ~{a.daysToStockout} days to stockout
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>

                    <div className="rounded-xl border border-amber-100 bg-amber-50/40 p-3 dark:border-amber-900/40 dark:bg-amber-950/20">
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Reorder suggestions</p>
                      {aiSnapshot.reorderSuggestions.length === 0 ? (
                        <p className="mt-2 text-sm text-slate-500">No reorder suggestions currently.</p>
                      ) : (
                        <ul className="mt-2 space-y-1.5 text-sm">
                          {aiSnapshot.reorderSuggestions.slice(0, 6).map((s) => (
                            <li key={s.productId} className="text-slate-700 dark:text-slate-200">
                              <span className="font-semibold">{s.name}</span> · +{s.suggestedQty} units · coverage ~{s.estimatedDaysCoverage} days
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </div>

                </div>
              )}
            </Panel>
          </section>

          <section className="grid grid-cols-1 gap-5">
            <Panel
              title={revenueRange === 'all' ? 'Revenue trend (monthly)' : 'Revenue trend'}
              subtitle={
                revenueRange === 'all' ? `${revenueLabel} · revenue-status orders` : `${revenueLabel} · paid pipeline only`
              }
              action={
                <select
                  aria-label="Revenue chart range"
                  value={revenueRange}
                  onChange={(e) => setRevenueRange(e.target.value as DateRangePreset)}
                  className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5 text-xs font-medium text-slate-700 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
                >
                  {RANGE_OPTIONS.map((opt) => (
                    <option key={opt.id} value={opt.id}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              }
            >
              <div className="h-64">
                {revenueLoading ? (
                  <p className="text-sm text-slate-500">Loading revenue chart…</p>
                ) : dailyRevenue.length ? (
                  <Line data={dailyLineData} options={lineOptions} />
                ) : (
                  <p className="text-sm text-slate-500">
                    {revenueRange === 'all' ? 'No monthly revenue data yet.' : 'No revenue in this window yet.'}
                  </p>
                )}
              </div>
            </Panel>
          </section>

          <section className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            <Panel
              title="Orders by status"
              subtitle={`${statusLabel} · share of orders`}
              action={
                <select
                  aria-label="Order status chart range"
                  value={statusRange}
                  onChange={(e) => setStatusRange(e.target.value as DateRangePreset)}
                  className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5 text-xs font-medium text-slate-700 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
                >
                  {RANGE_OPTIONS.map((opt) => (
                    <option key={opt.id} value={opt.id}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              }
            >
              <div className="h-64">
                {statusLoading ? (
                  <p className="text-sm text-slate-500">Loading status chart…</p>
                ) : statusDoughnutData.labels.length ? (
                  <Doughnut data={statusDoughnutData} options={doughnutOptions} />
                ) : (
                  <p className="text-sm text-slate-500">No orders yet.</p>
                )}
              </div>
            </Panel>

            <Panel
              title="Refunds"
              subtitle="Requests in your store"
              action={
                <Link to="/owner/refunds" className="text-xs font-semibold text-indigo-600 hover:underline dark:text-indigo-400">
                  Open →
                </Link>
              }
            >
              {refundStats ? (
                <ul className="space-y-2 text-sm">
                  <li className="flex justify-between gap-2">
                    <span className="text-slate-600 dark:text-slate-400">Pending requests</span>
                    <span className="font-semibold text-slate-900 dark:text-white">{refundStats.pendingCount}</span>
                  </li>
                  <li className="flex justify-between gap-2">
                    <span className="text-slate-600 dark:text-slate-400">Total requests</span>
                    <span className="font-semibold text-slate-900 dark:text-white">{refundStats.totalCount}</span>
                  </li>
                  <li className="flex justify-between gap-2">
                    <span className="text-slate-600 dark:text-slate-400">Pending amount</span>
                    <span className="font-semibold text-slate-900 dark:text-white">{fmtBaht(refundStats.pendingAmount)}</span>
                  </li>
                </ul>
              ) : (
                <p className="text-sm text-slate-500">Refund data unavailable (check RLS or table).</p>
              )}
            </Panel>
          </section>

          <section className="grid grid-cols-1 gap-5">
            <Panel
              title="Top products"
              subtitle={`${topProductsLabel} · by line revenue`}
              action={
                <select
                  aria-label="Top products range"
                  value={topProductsRange}
                  onChange={(e) => setTopProductsRange(e.target.value as DateRangePreset)}
                  className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5 text-xs font-medium text-slate-700 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
                >
                  {RANGE_OPTIONS.map((opt) => (
                    <option key={opt.id} value={opt.id}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              }
            >
              {topProductsLoading ? (
                <p className="text-sm text-slate-500">Loading top products…</p>
              ) : topProducts.length === 0 ? (
                <p className="text-sm text-slate-500">No product sales in this range yet.</p>
              ) : (
                <div className="overflow-x-auto rounded-xl border border-slate-100 dark:border-slate-700/80">
                  <table className="min-w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-100 bg-slate-50/80 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:border-slate-700 dark:bg-slate-800/50 dark:text-slate-400">
                        <th className="px-3 py-2">Product</th>
                        <th className="px-3 py-2 text-right">Units</th>
                        <th className="px-3 py-2 text-right">Revenue</th>
                      </tr>
                    </thead>
                    <tbody>
                      {topProducts.map((row) => (
                        <tr key={row.productId} className="border-b border-slate-50 last:border-0 dark:border-slate-800">
                          <td className="max-w-[10rem] truncate px-3 py-2 font-medium text-slate-900 dark:text-white">{row.name}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-slate-700 dark:text-slate-200">{row.units}</td>
                          <td className="px-3 py-2 text-right font-medium tabular-nums text-slate-900 dark:text-white">{fmtBaht(row.revenue)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Panel>
          </section>

          <section className="grid grid-cols-1 gap-5 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <Panel
                title="Recent orders"
                subtitle="Newest first · customer from profile when available"
                action={
                  <span className="flex flex-wrap items-center gap-3">
                    <button
                      type="button"
                      onClick={() => setExportPreviewOpen(true)}
                      className="text-xs font-semibold text-slate-600 hover:underline dark:text-slate-300"
                    >
                      CSV
                    </button>
                    <Link to="/owner/fulfillment" className="text-xs font-semibold text-indigo-600 hover:underline dark:text-indigo-400">
                      Fulfillment →
                    </Link>
                  </span>
                }
              >
                <div className="overflow-x-auto rounded-xl border border-slate-100 dark:border-slate-700/80">
                  <table className="min-w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-100 bg-slate-50/80 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:border-slate-700 dark:bg-slate-800/50 dark:text-slate-400">
                        <th className="px-3 py-2.5">Order</th>
                        <th className="px-3 py-2.5">When</th>
                        <th className="px-3 py-2.5">Customer</th>
                        <th className="px-3 py-2.5">Total</th>
                        <th className="px-3 py-2.5">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {recentOrders.map((order) => (
                        <tr key={order.id} className="border-b border-slate-50 last:border-0 dark:border-slate-800">
                          <td className="px-3 py-2.5 font-semibold text-slate-900 dark:text-white">#{order.id}</td>
                          <td className="whitespace-nowrap px-3 py-2.5 text-slate-600 dark:text-slate-300">{fmtDate(order.created_at)}</td>
                          <td className="max-w-[10rem] truncate px-3 py-2.5 text-slate-700 dark:text-slate-200">
                            {order.customer_name || (order.customer_id ? 'Customer' : 'Guest')}
                          </td>
                          <td className="whitespace-nowrap px-3 py-2.5 font-medium text-slate-900 dark:text-white">{fmtBaht(order.total_price)}</td>
                          <td className="px-3 py-2.5">
                            <span className="inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium capitalize text-slate-700 dark:bg-slate-700 dark:text-slate-100">
                              {order.status}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Panel>
            </div>

            <div>
              <Panel title="Low stock" subtitle="At or below threshold">
                {lowStockProducts.length === 0 ? (
                  <p className="text-sm text-slate-500 dark:text-slate-400">All clear.</p>
                ) : (
                  <ul className="max-h-80 space-y-2 overflow-y-auto text-sm">
                    {lowStockProducts.map((p) => (
                      <li
                        key={p.id}
                        className="rounded-xl border border-amber-200/90 bg-amber-50 px-3 py-2.5 dark:border-amber-900/50 dark:bg-amber-950/30"
                      >
                        <div className="font-medium text-amber-950 dark:text-amber-100">{p.name}</div>
                        <div className="text-xs text-amber-800/90 dark:text-amber-200/90">
                          Stock {p.stock} · threshold {p.low_stock_threshold}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </Panel>
            </div>
          </section>

        </main>
      </div>

      {exportPreviewOpen ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="export-preview-title"
          className="fixed inset-0 z-[200] flex flex-col bg-slate-50 dark:bg-slate-950"
          style={{
            paddingTop: 'env(safe-area-inset-top, 0px)',
            paddingBottom: 'env(safe-area-inset-bottom, 0px)',
            paddingLeft: 'env(safe-area-inset-left, 0px)',
            paddingRight: 'env(safe-area-inset-right, 0px)',
          }}
        >
          <header className="flex shrink-0 flex-col gap-3 border-b border-slate-200 bg-white px-4 py-3 shadow-sm dark:border-slate-700 dark:bg-slate-900">
            <button
              type="button"
              onClick={() => setExportPreviewOpen(false)}
              className="inline-flex min-h-[48px] w-full items-center justify-center rounded-xl bg-indigo-600 px-4 py-3 text-base font-bold text-white shadow-sm active:bg-indigo-700"
            >
              ← Back to dashboard
            </button>
            <div>
              <h2 id="export-preview-title" className="text-lg font-bold text-slate-900 dark:text-white">
                Orders export
              </h2>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Same rows as the CSV download. Tap Back to return to the dashboard.</p>
            </div>
            <button
              type="button"
              onClick={() => downloadOrdersCsvFile(recentOrders)}
              className="inline-flex min-h-[44px] items-center justify-center rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-800 shadow-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
            >
              Download CSV file
            </button>
          </header>

          <div className="min-h-0 flex-1 overflow-auto px-4 py-4">
            <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
                    <th className="px-3 py-3">Order ID</th>
                    <th className="px-3 py-3">Created</th>
                    <th className="px-3 py-3">Customer</th>
                    <th className="px-3 py-3">Total_THB</th>
                    <th className="px-3 py-3">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {recentOrders.map((order) => (
                    <tr key={order.id} className="border-b border-slate-100 last:border-0 dark:border-slate-800">
                      <td className="whitespace-nowrap px-3 py-2.5 font-semibold text-slate-900 dark:text-white">{order.id}</td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-slate-700 dark:text-slate-200">{order.created_at ?? '—'}</td>
                      <td className="max-w-[10rem] truncate px-3 py-2.5 text-slate-700 dark:text-slate-200">
                        {order.customer_name || (order.customer_id ? 'Customer' : 'Guest')}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 tabular-nums text-slate-900 dark:text-white">{order.total_price}</td>
                      <td className="px-3 py-2.5 capitalize text-slate-800 dark:text-slate-100">{order.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
