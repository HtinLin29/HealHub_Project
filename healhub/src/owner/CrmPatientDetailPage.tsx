import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import OwnerLayout from './OwnerLayout';
import { supabase } from '../services/supabaseClient';

type PatientRow = {
  id: number;
  customer_id: string | null;
  full_name: string;
  age?: number | null;
  gender?: string | null;
  allergy?: string | null;
};

type OrderRow = {
  id: number;
  patient_id?: number | null;
  total_price?: number | null;
  created_at?: string | null;
  status?: string | null;
};

type OrderItemRow = {
  id?: number;
  order_id?: number | null;
  product_id?: number | null;
  quantity?: number | null;
  unit_price?: number | null;
  line_total?: number | null;
};

type ProductRow = {
  id: number;
  name: string;
  category?: string | null;
};

function fmtMoney(n: number) {
  return `฿${Number(n || 0).toFixed(2)}`;
}

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export default function CrmPatientDetailPage() {
  const navigate = useNavigate();
  const { patientId } = useParams();
  const parsedPatientId = Number(patientId);

  const [patient, setPatient] = useState<PatientRow | null>(null);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [items, setItems] = useState<OrderItemRow[]>([]);
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    async function load() {
      if (!Number.isFinite(parsedPatientId) || parsedPatientId <= 0) {
        setError('Invalid patient ID.');
        setLoading(false);
        return;
      }

      try {
        setLoading(true);
        const [patientRes, ordersRes, productsRes] = await Promise.all([
          supabase.from('customer_patients').select('id,customer_id,full_name,age,gender,allergy').eq('id', parsedPatientId).maybeSingle(),
          supabase
            .from('orders')
            .select('id,patient_id,total_price,created_at,status')
            .eq('patient_id', parsedPatientId)
            .order('created_at', { ascending: false })
            .limit(1000),
          supabase.from('products').select('id,name,category').limit(10000),
        ]);

        if (patientRes.error) throw patientRes.error;
        if (ordersRes.error) throw ordersRes.error;
        if (productsRes.error) throw productsRes.error;

        const loadedOrders = (ordersRes.data as OrderRow[]) ?? [];
        const orderIds = loadedOrders.map((o) => o.id).filter((id) => Number.isFinite(id));
        let loadedItems: OrderItemRow[] = [];
        if (orderIds.length > 0) {
          const itemsRes = await supabase.from('order_items').select('id,order_id,product_id,quantity,unit_price,line_total').in('order_id', orderIds);
          if (itemsRes.error) throw itemsRes.error;
          loadedItems = (itemsRes.data as OrderItemRow[]) ?? [];
        }

        setPatient((patientRes.data as PatientRow | null) ?? null);
        setOrders(loadedOrders);
        setItems(loadedItems);
        setProducts((productsRes.data as ProductRow[]) ?? []);
        setError('');
      } catch (e: any) {
        setError(e?.message || 'Failed to load patient detail.');
      } finally {
        setLoading(false);
      }
    }

    void load();
  }, [parsedPatientId]);

  const productMap = useMemo(() => new Map(products.map((p) => [p.id, p] as const)), [products]);
  const orderMap = useMemo(() => new Map(orders.map((o) => [o.id, o] as const)), [orders]);

  const purchaseLines = useMemo(() => {
    return items
      .map((item) => {
        const orderId = Number(item.order_id || 0);
        const order = orderMap.get(orderId);
        const pid = Number(item.product_id || 0);
        const product = productMap.get(pid);
        const quantity = Number(item.quantity || 0);
        const unitPrice = Number(item.unit_price || 0);
        const lineTotal = Number(item.line_total ?? quantity * unitPrice);
        return {
          orderId,
          orderCreatedAt: order?.created_at || null,
          orderStatus: order?.status || '-',
          productId: pid || null,
          productName: product?.name || `Product #${pid}`,
          category: product?.category || '-',
          quantity,
          unitPrice,
          lineTotal,
        };
      })
      .sort((a, b) => {
        const ta = a.orderCreatedAt ? new Date(a.orderCreatedAt).getTime() : 0;
        const tb = b.orderCreatedAt ? new Date(b.orderCreatedAt).getTime() : 0;
        return tb - ta;
      });
  }, [items, orderMap, productMap]);

  const totalSpent = useMemo(() => orders.reduce((sum, o) => sum + Number(o.total_price ?? 0), 0), [orders]);

  function downloadFullPageReport() {
    if (!patient) return;
    const generatedAt = new Date().toLocaleString();
    const rowsHtml = purchaseLines
      .map(
        (line) => `
          <tr>
            <td>${escapeHtml(`#${line.orderId}`)}</td>
            <td>${escapeHtml(line.orderCreatedAt ? new Date(line.orderCreatedAt).toLocaleString() : '-')}</td>
            <td>${escapeHtml(line.orderStatus)}</td>
            <td>${escapeHtml(line.productName)}</td>
            <td>${escapeHtml(line.category)}</td>
            <td style="text-align:right">${escapeHtml(line.quantity)}</td>
            <td style="text-align:right">${escapeHtml(fmtMoney(line.unitPrice))}</td>
            <td style="text-align:right">${escapeHtml(fmtMoney(line.lineTotal))}</td>
          </tr>
        `,
      )
      .join('');

    const html = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>CRM Patient Report - ${escapeHtml(patient.full_name)}</title>
    <style>
      body { font-family: Arial, sans-serif; color: #0f172a; margin: 24px; }
      h1 { margin: 0 0 6px; font-size: 22px; }
      .muted { color: #64748b; font-size: 12px; }
      .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; margin: 14px 0; }
      .card { border: 1px solid #e2e8f0; border-radius: 10px; padding: 10px; }
      .label { font-size: 11px; color: #64748b; text-transform: uppercase; letter-spacing: 0.04em; }
      .value { margin-top: 4px; font-size: 14px; }
      table { width: 100%; border-collapse: collapse; margin-top: 12px; font-size: 13px; }
      th, td { border: 1px solid #e2e8f0; padding: 8px; vertical-align: top; }
      th { background: #f8fafc; text-align: left; }
    </style>
  </head>
  <body>
    <h1>CRM Patient Detail Report</h1>
    <p class="muted">Generated at: ${escapeHtml(generatedAt)}</p>

    <div class="grid">
      <div class="card"><div class="label">Patient Name</div><div class="value">${escapeHtml(patient.full_name || 'Unknown patient')}</div></div>
      <div class="card"><div class="label">Patient ID</div><div class="value">${escapeHtml(`#${patient.id}`)}</div></div>
      <div class="card"><div class="label">Customer ID</div><div class="value">${escapeHtml(patient.customer_id || '-')}</div></div>
      <div class="card"><div class="label">Age / Gender</div><div class="value">${escapeHtml(`${patient.age ?? '-'} / ${patient.gender || '-'}`)}</div></div>
      <div class="card"><div class="label">Allergy</div><div class="value">${escapeHtml(patient.allergy || '-')}</div></div>
      <div class="card"><div class="label">Orders / Product Lines / Total Spent</div><div class="value">${escapeHtml(`${orders.length} / ${purchaseLines.length} / ${fmtMoney(totalSpent)}`)}</div></div>
    </div>

    <h2 style="margin: 18px 0 8px; font-size: 16px;">Purchased Products</h2>
    <table>
      <thead>
        <tr>
          <th>Order</th>
          <th>Date</th>
          <th>Status</th>
          <th>Product</th>
          <th>Category</th>
          <th>Qty</th>
          <th>Unit</th>
          <th>Line Total</th>
        </tr>
      </thead>
      <tbody>
        ${rowsHtml || '<tr><td colspan="8">No purchased product lines found for this patient yet.</td></tr>'}
      </tbody>
    </table>
  </body>
</html>`;

    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `patient-report-${patient.id}-${new Date().toISOString().slice(0, 10)}.html`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <OwnerLayout title="CRM · Patient Detail">
      <div className="mb-4">
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => navigate('/owner/crm')}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700"
          >
            ← Back to CRM
          </button>
          <button
            type="button"
            onClick={downloadFullPageReport}
            className="rounded-lg bg-indigo-600 px-3 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
          >
            Download Full Page
          </button>
        </div>
      </div>

      {loading ? <p className="text-sm text-slate-500">Loading patient detail...</p> : null}
      {!loading && error ? (
        <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800 dark:border-rose-900/50 dark:bg-rose-950/40 dark:text-rose-200">
          {error}
        </p>
      ) : null}

      {!loading && !error && patient ? (
        <>
          <section className="mb-4 rounded-xl border bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800">
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">{patient.full_name || 'Unknown patient'}</h2>
            <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <p className="text-xs uppercase tracking-wide text-slate-500">Patient ID</p>
                <p className="text-sm text-slate-800 dark:text-slate-100">#{patient.id}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-slate-500">Customer ID</p>
                <p className="text-sm text-slate-800 dark:text-slate-100">{patient.customer_id || '-'}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-slate-500">Age / Gender</p>
                <p className="text-sm text-slate-800 dark:text-slate-100">
                  {patient.age ?? '-'} / {patient.gender || '-'}
                </p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-slate-500">Allergy</p>
                <p className="text-sm text-slate-800 dark:text-slate-100">{patient.allergy || '-'}</p>
              </div>
            </div>
          </section>

          <section className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="rounded-xl border bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800">
              <p className="text-xs uppercase tracking-wide text-slate-500">Orders</p>
              <p className="mt-1 text-xl font-bold text-slate-900 dark:text-slate-100">{orders.length}</p>
            </div>
            <div className="rounded-xl border bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800">
              <p className="text-xs uppercase tracking-wide text-slate-500">Products Purchased (lines)</p>
              <p className="mt-1 text-xl font-bold text-slate-900 dark:text-slate-100">{purchaseLines.length}</p>
            </div>
            <div className="rounded-xl border bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800">
              <p className="text-xs uppercase tracking-wide text-slate-500">Total Spent</p>
              <p className="mt-1 text-xl font-bold text-indigo-700 dark:text-indigo-300">{fmtMoney(totalSpent)}</p>
            </div>
          </section>

          <section className="overflow-x-auto rounded-xl border bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b bg-slate-50 text-left dark:border-slate-700 dark:bg-slate-900/50">
                  <th className="px-3 py-2">Order</th>
                  <th className="px-3 py-2">Date</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Product</th>
                  <th className="px-3 py-2">Category</th>
                  <th className="px-3 py-2 text-right">Qty</th>
                  <th className="px-3 py-2 text-right">Unit</th>
                  <th className="px-3 py-2 text-right">Line Total</th>
                </tr>
              </thead>
              <tbody>
                {purchaseLines.length === 0 ? (
                  <tr>
                    <td className="px-3 py-4 text-slate-500 dark:text-slate-400" colSpan={8}>
                      No purchased product lines found for this patient yet.
                    </td>
                  </tr>
                ) : (
                  purchaseLines.map((line, idx) => (
                    <tr key={`${line.orderId}-${line.productId}-${idx}`} className="border-b last:border-0 dark:border-slate-700">
                      <td className="px-3 py-2 font-medium text-slate-900 dark:text-slate-100">#{line.orderId}</td>
                      <td className="px-3 py-2 text-xs text-slate-600 dark:text-slate-300">
                        {line.orderCreatedAt ? new Date(line.orderCreatedAt).toLocaleString() : '-'}
                      </td>
                      <td className="px-3 py-2">
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs capitalize text-slate-700 dark:bg-slate-700 dark:text-slate-100">
                          {line.orderStatus}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-slate-800 dark:text-slate-100">{line.productName}</td>
                      <td className="px-3 py-2 text-slate-600 dark:text-slate-300">{line.category}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-700 dark:text-slate-200">{line.quantity}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-700 dark:text-slate-200">{fmtMoney(line.unitPrice)}</td>
                      <td className="px-3 py-2 text-right font-medium tabular-nums text-slate-900 dark:text-slate-100">{fmtMoney(line.lineTotal)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </section>
        </>
      ) : null}
    </OwnerLayout>
  );
}
