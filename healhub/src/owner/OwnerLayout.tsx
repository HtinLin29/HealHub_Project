import { Link, useNavigate } from 'react-router-dom';
import type { PropsWithChildren } from 'react';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';

export default function OwnerLayout({ title, children }: PropsWithChildren<{ title: string }>) {
  const { role, signOut } = useAuth();
  const { mode } = useTheme();
  const isDark = mode === 'dark';
  const navigate = useNavigate();

  function handleBack() {
    navigate(-1);
  }

  return (
    <div className={`min-h-screen p-4 md:p-8 ${isDark ? 'bg-slate-900' : 'bg-slate-100'}`}>
      <div className="mx-auto max-w-6xl space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className={`text-2xl font-bold ${isDark ? 'text-slate-100' : 'text-slate-800'}`}>{title}</h1>
          <div className="flex flex-wrap items-center gap-2">
            {role === 'owner' ? (
              <>
                <button
                  type="button"
                  onClick={handleBack}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
                >
                  ← Back
                </button>
                <Link to="/owner" className="rounded-lg bg-indigo-600 px-3 py-2 text-sm text-white hover:bg-indigo-700">
                  Owner Home
                </Link>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={handleBack}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
                >
                  ← Back
                </button>
                <Link to="/shop" className="rounded-lg bg-indigo-600 px-3 py-2 text-sm text-white hover:bg-indigo-700">
                  Shop
                </Link>
              </>
            )}
            <button
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700"
              onClick={() => signOut()}
            >
              Sign out
            </button>
          </div>
        </div>
        <div className={`rounded-2xl border p-4 shadow-sm md:p-6 ${isDark ? 'border-slate-700 bg-slate-800 text-slate-100' : 'border-slate-200 bg-white text-slate-800'}`}>
          {children}
        </div>
      </div>
    </div>
  );
}
