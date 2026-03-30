import { useState, type ComponentType } from 'react';
import OwnerLayout from './OwnerLayout';
import { useTheme } from '../context/ThemeContext';

function IconSun({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v2.25m6.364.386-1.591 1.591M21 12h-2.25m-.386 6.364-1.591-1.591M12 18.75V21m-4.773-4.227-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0Z" />
    </svg>
  );
}

function IconMoon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M21.752 15.002A9.72 9.72 0 0 1 18 15.75c-5.385 0-9.75-4.365-9.75-9.75 0-1.33.266-2.597.748-3.752A9.753 9.753 0 0 0 3 11.25C3 16.635 7.365 21 12.75 21a9.753 9.753 0 0 0 9.002-5.998Z" />
    </svg>
  );
}

function IconDatabase({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 6.375c0 2.278-3.694 4.125-8.25 4.125S3.75 8.653 3.75 6.375m16.5 0c0-2.278-3.694-4.125-8.25-4.125S3.75 4.097 3.75 6.375m16.5 0v11.25c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125V6.375m16.5 0v3.75m-16.5-3.75v3.75m16.5 0v3.75C20.25 16.153 16.556 18 12 18s-8.25-1.847-8.25-4.125v-3.75m16.5 0c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125" />
    </svg>
  );
}

function IconWrench({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M11.42 15.17 17.25 21A2.652 2.652 0 0 0 21 17.25l-5.877-5.877M11.42 15.17l2.496-3.03c.317-.384.74-.626 1.208-.766M11.42 15.17l-4.655 5.653a2.548 2.548 0 1 1-3.586-3.586l6.837-5.63m5.108-.233c.55-.164 1.163-.188 1.743-.14a4.5 4.5 0 0 0 4.486-6.336l-3.276 3.277a3.004 3.004 0 0 0-2.25-2.25l3.276-3.276a4.5 4.5 0 0 0-6.336 4.486c.091 1.076-.071 2.264-.904 2.95l-.102.085m-1.745 1.437L5.909 7.5H4.5L2.25 3.75l1.5-1.5L7.5 4.5v1.409l4.26 4.26" />
    </svg>
  );
}

function SectionHeader({
  icon: Icon,
  iconBg,
  title,
  description,
}: {
  icon: ComponentType<{ className?: string }>;
  iconBg: string;
  title: string;
  description: string;
}) {
  return (
    <div className="flex gap-4">
      <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl shadow-inner ${iconBg}`}>
        <Icon className="h-6 w-6" />
      </div>
      <div className="min-w-0 flex-1 pt-0.5">
        <h3 className="text-base font-semibold tracking-tight text-slate-900 dark:text-white">{title}</h3>
        <p className="mt-1 text-sm leading-relaxed text-slate-500 dark:text-slate-400">{description}</p>
      </div>
    </div>
  );
}

const navItems = [
  { id: 'settings-appearance', label: 'Appearance' },
  { id: 'settings-data', label: 'Data' },
  { id: 'settings-reset', label: 'Reset' },
] as const;

export default function SettingsPage() {
  const [toast, setToast] = useState('');
  const { mode, setMode } = useTheme();
  const isDark = mode === 'dark';

  function showToast(msg: string) {
    setToast(msg);
    window.setTimeout(() => setToast(''), 2200);
  }

  function clearCustomerCartCache() {
    localStorage.removeItem('healhub-cart');
    localStorage.removeItem('healhub-checkout-selection');
    localStorage.removeItem('healhub-open-cart');
    showToast('Cart data cleared from this browser.');
  }

  function clearQuickSearchHistory() {
    localStorage.removeItem('healhub-shop-search');
    showToast('Shop search history cleared from this browser.');
  }

  function resetAppPreferences() {
    setMode('light');
    localStorage.setItem('healhub-theme', 'light');
    localStorage.removeItem('healhub-cart');
    localStorage.removeItem('healhub-checkout-selection');
    localStorage.removeItem('healhub-open-cart');
    localStorage.removeItem('healhub-shop-search');
    showToast('App preferences reset on this device (theme light, local data cleared).');
  }

  const cardBase = `overflow-hidden rounded-2xl border transition-shadow duration-200 ${
    isDark
      ? 'border-slate-700/80 bg-slate-800/40 shadow-lg shadow-black/20 hover:shadow-xl hover:shadow-black/25'
      : 'border-slate-200/90 bg-white shadow-md shadow-slate-200/50 hover:shadow-lg'
  }`;

  return (
    <OwnerLayout title="Settings">
      <div className="mx-auto max-w-4xl space-y-8 pb-4">
        {/* Hero */}
        <div
          className={`relative overflow-hidden rounded-3xl px-6 py-8 md:px-10 md:py-10 ${
            isDark
              ? 'bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-950 ring-1 ring-white/10'
              : 'bg-gradient-to-br from-slate-700 via-indigo-600 to-violet-700 shadow-xl shadow-indigo-500/20'
          }`}
        >
          <div className="pointer-events-none absolute -right-20 -top-20 h-64 w-64 rounded-full bg-white/10 blur-3xl" />
          <div className="pointer-events-none absolute -bottom-16 -left-16 h-48 w-48 rounded-full bg-cyan-400/15 blur-3xl" />
          <div className="relative">
            <p className="text-xs font-semibold uppercase tracking-[0.25em] text-white/70">HealHub</p>
            <h2 className="mt-2 text-2xl font-bold tracking-tight text-white md:text-3xl">App settings</h2>
            <p className="mt-3 max-w-xl text-sm leading-relaxed text-white/85 md:text-base">
              Control how this app looks and what is stored in <strong className="font-semibold text-white">this browser</strong>. These options do not change your catalog or orders in the cloud.
            </p>
          </div>
        </div>

        {toast ? (
          <div
            className={`rounded-2xl border px-4 py-3 text-sm font-medium ${
              isDark ? 'border-emerald-800/80 bg-emerald-950/50 text-emerald-200' : 'border-emerald-200 bg-emerald-50 text-emerald-900'
            }`}
            role="status"
          >
            {toast}
          </div>
        ) : null}

        {/* Mobile quick nav */}
        <div className="-mt-2 flex gap-2 overflow-x-auto pb-1 lg:hidden [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {navItems.map((item) => (
            <a
              key={item.id}
              href={`#${item.id}`}
              className={`shrink-0 rounded-full border px-3.5 py-1.5 text-xs font-semibold transition ${
                isDark
                  ? 'border-slate-600 bg-slate-800/80 text-slate-300 hover:border-indigo-500 hover:text-indigo-300'
                  : 'border-slate-200 bg-white text-slate-600 shadow-sm hover:border-indigo-300 hover:text-indigo-700'
              }`}
            >
              {item.label}
            </a>
          ))}
        </div>

        <div className="flex flex-col gap-8 lg:flex-row lg:items-start lg:gap-10">
          <nav
            className={`hidden shrink-0 lg:sticky lg:top-24 lg:block lg:w-44 ${
              isDark ? 'text-slate-400' : 'text-slate-500'
            }`}
            aria-label="Settings sections"
          >
            <p className="mb-3 text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500">On this page</p>
            <ul className="space-y-1 border-l border-slate-200 dark:border-slate-700">
              {navItems.map((item) => (
                <li key={item.id}>
                  <a
                    href={`#${item.id}`}
                    className="-ml-px block border-l-2 border-transparent py-1.5 pl-4 text-sm font-medium text-slate-600 transition hover:border-indigo-400 hover:text-indigo-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 dark:text-slate-400 dark:hover:border-indigo-500 dark:hover:text-indigo-300"
                  >
                    {item.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>

          <div className="min-w-0 flex-1 space-y-6">
            {/* Appearance */}
            <section id="settings-appearance" className={`scroll-mt-24 ${cardBase}`}>
              <div className="space-y-5 p-5 md:p-6">
                <SectionHeader
                  icon={mode === 'dark' ? IconMoon : IconSun}
                  iconBg="bg-gradient-to-br from-violet-500 to-fuchsia-600 text-white"
                  title="Appearance"
                  description="Light or dark theme for the owner dashboard and customer shop on this device."
                />
                <div
                  className={`inline-flex rounded-2xl p-1.5 ${
                    isDark ? 'bg-slate-900 ring-1 ring-slate-600' : 'bg-slate-100 ring-1 ring-slate-200'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => setMode('light')}
                    className={`flex items-center gap-2 rounded-xl px-5 py-3 text-sm font-semibold transition ${
                      mode === 'light'
                        ? 'bg-white text-indigo-700 shadow-md dark:bg-slate-700 dark:text-white'
                        : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'
                    }`}
                  >
                    <IconSun className="h-5 w-5" />
                    Light
                  </button>
                  <button
                    type="button"
                    onClick={() => setMode('dark')}
                    className={`flex items-center gap-2 rounded-xl px-5 py-3 text-sm font-semibold transition ${
                      mode === 'dark'
                        ? 'bg-slate-800 text-white shadow-md ring-1 ring-slate-600'
                        : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'
                    }`}
                  >
                    <IconMoon className="h-5 w-5" />
                    Dark
                  </button>
                </div>
              </div>
            </section>

            {/* Local data */}
            <section id="settings-data" className={`scroll-mt-24 ${cardBase}`}>
              <div className="space-y-5 p-5 md:p-6">
                <SectionHeader
                  icon={IconDatabase}
                  iconBg="bg-gradient-to-br from-sky-500 to-indigo-600 text-white"
                  title="Data on this device"
                  description="Clear cached data stored in your browser. Signing out or using another device does not affect these local files."
                />
                <div className="flex flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={clearCustomerCartCache}
                    className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                  >
                    Clear cart & checkout cache
                  </button>
                  <button
                    type="button"
                    onClick={clearQuickSearchHistory}
                    className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                  >
                    Clear shop search history
                  </button>
                </div>
              </div>
            </section>

            {/* Reset */}
            <section id="settings-reset" className={`scroll-mt-24 ${cardBase}`}>
              <div className="space-y-5 p-5 md:p-6">
                <SectionHeader
                  icon={IconWrench}
                  iconBg="bg-gradient-to-br from-slate-600 to-slate-800 text-white"
                  title="Reset app on this device"
                  description="Sets theme to light and removes local cart, checkout, and search data. Your account and server data are unchanged."
                />
                <button
                  type="button"
                  onClick={resetAppPreferences}
                  className="rounded-xl border border-amber-300/90 bg-gradient-to-br from-amber-50 to-orange-50 px-5 py-3 text-sm font-semibold text-amber-900 shadow-sm transition hover:from-amber-100 hover:to-orange-100 dark:border-amber-700 dark:from-amber-950/50 dark:to-orange-950/30 dark:text-amber-100 dark:hover:from-amber-900/40"
                >
                  Reset app preferences
                </button>
              </div>
            </section>
          </div>
        </div>
      </div>
    </OwnerLayout>
  );
}
