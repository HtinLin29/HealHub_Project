import { Link, useLocation, useParams } from 'react-router-dom';
import CustomerLayout from './CustomerLayout';

export default function OrderSuccessPage() {
  const { orderId } = useParams();
  const location = useLocation();
  const state = (location.state || {}) as { total?: number; itemCount?: number; shipping?: string; fullName?: string; remainingCount?: number };

  return (
    <CustomerLayout>
      <div className="mx-auto max-w-2xl">
        <div className="rounded-3xl border border-emerald-200 bg-emerald-50 p-6 shadow-sm">
          <p className="text-xs uppercase tracking-[0.2em] text-emerald-700">Order placed</p>
          <h2 className="mt-2 text-2xl font-bold text-slate-900">Thank you{state.fullName ? `, ${state.fullName}` : ''}.</h2>
          <p className="mt-2 text-sm text-emerald-800">
            Your order has been created successfully and is now <span className="font-semibold">pending</span>.
          </p>
          {typeof state.remainingCount === 'number' && state.remainingCount > 0 && (
            <p className="mt-2 text-sm text-emerald-800">
              Unpaid items are still in your cart: <span className="font-semibold">{state.remainingCount}</span>.
            </p>
          )}
        </div>

        <div className="mt-4 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <h3 className="text-base font-semibold text-slate-900">Order summary</h3>
          <div className="mt-4 grid gap-3 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-slate-500">Order ID</span>
              <span className="font-semibold text-slate-900">#{orderId}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-500">Items</span>
              <span className="font-medium text-slate-800">{state.itemCount ?? '—'}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-500">Shipping</span>
              <span className="font-medium text-slate-800">{state.shipping ?? '—'}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-500">Total</span>
              <span className="text-lg font-bold text-indigo-700">{typeof state.total === 'number' ? `฿${state.total.toFixed(2)}` : '—'}</span>
            </div>
          </div>

          <div className="mt-6 grid gap-2 sm:grid-cols-2">
            <Link className="rounded-xl border border-slate-300 px-4 py-2 text-center text-sm font-medium text-slate-700 hover:bg-slate-50" to="/shop">
              Continue shopping
            </Link>
            <Link className="rounded-xl bg-indigo-600 px-4 py-2 text-center text-sm font-semibold text-white hover:bg-indigo-700" to={orderId ? `/orders/${orderId}` : '/orders'}>
              View order
            </Link>
          </div>

          <p className="mt-3 text-xs text-slate-500">
            Next improvements (like Shopee/Lazada): “My Orders” page, order tracking timeline, and payment integrations.
          </p>
        </div>
      </div>
    </CustomerLayout>
  );
}

