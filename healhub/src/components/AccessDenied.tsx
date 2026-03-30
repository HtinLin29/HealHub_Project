import { Link } from 'react-router-dom';

export default function AccessDenied({ reason }: { reason?: string }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 px-4">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm">
        <p className="text-xs uppercase tracking-[0.2em] text-slate-500">HealHub</p>
        <h1 className="mt-2 text-2xl font-bold text-slate-800">Access denied</h1>
        <p className="mt-3 text-sm text-slate-600">{reason || 'You do not have permission to open this page.'}</p>
        <div className="mt-5 flex items-center justify-center gap-3">
          <Link to="/" className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50">Home</Link>
          <Link to="/shop" className="rounded-lg bg-indigo-600 px-4 py-2 text-sm text-white hover:bg-indigo-700">Open Shop</Link>
        </div>
      </div>
    </div>
  );
}
