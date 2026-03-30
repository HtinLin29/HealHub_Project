import { Link, useLocation, useNavigate } from 'react-router-dom';
import type { PropsWithChildren } from 'react';
import { lazy, Suspense, useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { readCustomerAiFeatureEnabled } from '../env';
import { isUnreadForCustomer, listCustomerConversations } from '../services/orderChatService';
import { supabase } from '../services/supabaseClient';

const CustomerAssistant = lazy(() => import('../components/CustomerAssistant'));

export default function CustomerLayout({
  children,
  topSlot,
  showMobileMenu = true,
  /** Owner viewing `/shop` as a design preview — no customer nav, tabs, or inbox. */
  previewMode = false,
}: PropsWithChildren<{ topSlot?: React.ReactNode; showMobileMenu?: boolean; previewMode?: boolean }>) {
  const { signOut, role } = useAuth();
  const { mode } = useTheme();
  const isDark = mode === 'dark';
  const navigate = useNavigate();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [unreadInbox, setUnreadInbox] = useState(0);
  const [toast, setToast] = useState<{ orderId: number; text: string } | null>(null);

  async function loadUnread() {
    try {
      const convos = await listCustomerConversations();
      setUnreadInbox(convos.filter(isUnreadForCustomer).length);
    } catch {
      setUnreadInbox(0);
    }
  }

  useEffect(() => {
    if (!showMobileMenu) setMenuOpen(false);
  }, [showMobileMenu]);

  useEffect(() => {
    if (previewMode) {
      setUnreadInbox(0);
      return;
    }
    void loadUnread();
    const channel = supabase
      .channel('customer-inbox-badge')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'order_messages' }, () => void loadUnread())
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewMode]);

  useEffect(() => {
    if (previewMode) return;
    const channel = supabase
      .channel('customer-owner-message-toast')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'order_messages',
          filter: 'sender_role=eq.owner',
        },
        (payload) => {
          const orderId = Number((payload.new as any)?.order_id);
          if (!orderId || Number.isNaN(orderId)) return;
          // Skip toast if user is already in a chat screen.
          if (location.pathname.includes('/chat')) return;
          setToast({ orderId, text: `Owner sent a new message on Order #${orderId}` });
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [location.pathname, previewMode]);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 4500);
    return () => window.clearTimeout(t);
  }, [toast]);

  return (
    <div className={`min-h-screen ${isDark ? 'bg-slate-900' : 'bg-slate-100'}`}>
      {toast && !previewMode && (
        <div className="fixed left-0 right-0 top-2 z-[60] flex justify-center px-3">
          <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-lg">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-slate-900">{toast.text}</p>
                <p className="mt-0.5 text-xs text-slate-500">Tap to open Inbox.</p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  className="rounded-lg bg-indigo-600 px-3 py-2 text-xs font-semibold text-white hover:bg-indigo-700"
                  onClick={() => {
                    setToast(null);
                    navigate('/inbox');
                  }}
                >
                  Open
                </button>
                <button className="rounded-lg px-2 py-2 text-slate-500 hover:bg-slate-100" onClick={() => setToast(null)}>
                  ✕
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      <header className={`border-b ${isDark ? 'border-slate-800 bg-slate-950' : 'border-slate-200 bg-white'} sticky top-0 z-40`}>
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-3 md:px-6">
          <div className="hidden md:block">
            <p className="text-xs uppercase tracking-[0.2em] text-slate-500">HealHub</p>
            <h1 className={`text-lg font-bold ${isDark ? 'text-slate-100' : 'text-slate-800'}`}>
              {previewMode ? 'Storefront preview' : 'Customer Shop'}
            </h1>
            {previewMode ? (
              <p className={`mt-0.5 text-xs ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>Owner view — same layout customers see</p>
            ) : null}
          </div>
          {previewMode ? (
            <div className="hidden items-center gap-2 md:flex">
              <Link
                to="/owner"
                className="rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-sm font-semibold text-indigo-800 hover:bg-indigo-100 dark:border-indigo-500/40 dark:bg-indigo-950/50 dark:text-indigo-100 dark:hover:bg-indigo-950/70"
              >
                ← Owner home
              </Link>
            </div>
          ) : (
            <div className="hidden items-center gap-2 md:flex">
              <Link to="/shop" className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">
                Home
              </Link>
              <Link to="/orders" className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">
                My Orders
              </Link>
              <Link to="/account/patients" className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">
                Patients
              </Link>
              <Link to="/account/address" className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">
                Address
              </Link>
              <Link to="/account/payment" className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">
                Payment
              </Link>
              <button className="rounded-lg bg-indigo-600 px-3 py-2 text-sm text-white hover:bg-indigo-700" onClick={() => signOut()}>
                Sign out
              </button>
            </div>
          )}
        </div>

        {topSlot && (
          <div className={`${isDark ? 'bg-slate-950' : 'bg-white'} border-t ${isDark ? 'border-slate-800' : 'border-slate-200'}`}>
            <div className="mx-auto max-w-7xl px-4 py-3 md:px-6">
              <div className="flex items-start gap-2">
                {showMobileMenu && (
                  <button
                    type="button"
                    className={`rounded-lg border px-3 py-2 text-lg leading-none ${isDark ? 'border-slate-700 bg-slate-900 text-slate-100' : 'border-slate-300 bg-white text-slate-700'} md:hidden`}
                    onClick={() => setMenuOpen((v) => !v)}
                    aria-expanded={menuOpen}
                    aria-label="Open menu"
                  >
                    ☰
                  </button>
                )}
                <div className="min-w-0 flex-1">{topSlot}</div>
              </div>
            </div>
          </div>
        )}

        {menuOpen && showMobileMenu && (
          <div className={`md:hidden ${isDark ? 'bg-slate-950' : 'bg-white'} border-t ${isDark ? 'border-slate-800' : 'border-slate-200'}`}>
            <div className="mx-auto grid max-w-7xl gap-2 px-4 py-3 md:px-6">
              {previewMode ? (
                <Link
                  to="/owner"
                  className={`rounded-lg border px-3 py-2 text-sm font-semibold ${isDark ? 'border-indigo-500/40 bg-indigo-950/50 text-indigo-100' : 'border-indigo-200 bg-indigo-50 text-indigo-800'} hover:bg-indigo-100 dark:hover:bg-indigo-950/70`}
                  onClick={() => setMenuOpen(false)}
                >
                  ← Owner home
                </Link>
              ) : (
                <>
                  <Link
                    to="/shop"
                    className={`rounded-lg border px-3 py-2 text-sm ${isDark ? 'border-slate-800 text-slate-100' : 'border-slate-300 text-slate-700'} hover:bg-slate-50`}
                    onClick={() => setMenuOpen(false)}
                  >
                    Home
                  </Link>
                  <Link
                    to="/orders"
                    className={`rounded-lg border px-3 py-2 text-sm ${isDark ? 'border-slate-800 text-slate-100' : 'border-slate-300 text-slate-700'} hover:bg-slate-50`}
                    onClick={() => setMenuOpen(false)}
                  >
                    My Orders
                  </Link>
                  <Link
                    to="/account/patients"
                    className={`rounded-lg border px-3 py-2 text-sm ${isDark ? 'border-slate-800 text-slate-100' : 'border-slate-300 text-slate-700'} hover:bg-slate-50`}
                    onClick={() => setMenuOpen(false)}
                  >
                    Patients
                  </Link>
                  <Link
                    to="/account/address"
                    className={`rounded-lg border px-3 py-2 text-sm ${isDark ? 'border-slate-800 text-slate-100' : 'border-slate-300 text-slate-700'} hover:bg-slate-50`}
                    onClick={() => setMenuOpen(false)}
                  >
                    Address
                  </Link>
                  <Link
                    to="/account/payment"
                    className={`rounded-lg border px-3 py-2 text-sm ${isDark ? 'border-slate-800 text-slate-100' : 'border-slate-300 text-slate-700'} hover:bg-slate-50`}
                    onClick={() => setMenuOpen(false)}
                  >
                    Payment
                  </Link>
                  <button
                    className="rounded-lg bg-indigo-600 px-3 py-2 text-left text-sm text-white hover:bg-indigo-700"
                    onClick={() => {
                      setMenuOpen(false);
                      void signOut();
                    }}
                  >
                    Sign out
                  </button>
                </>
              )}
            </div>
          </div>
        )}
      </header>

      <main className="mx-auto max-w-7xl px-2 py-2 pb-32 md:px-6 md:py-8 md:pb-8">
        <div className={`${isDark ? 'text-slate-100' : 'text-slate-800'} md:rounded-2xl md:border md:p-6 md:shadow-sm ${isDark ? 'md:border-slate-700 md:bg-slate-800' : 'md:border-slate-200 md:bg-white'}`}>
          {children}
        </div>
      </main>

      {/* Mobile bottom tab bar (Shop + My Orders + Inbox + Profile) — hidden in owner storefront preview */}
      {!previewMode &&
        (location.pathname === '/shop' || location.pathname === '/orders' || location.pathname === '/inbox' || location.pathname === '/profile') && (
        <nav
          className={`fixed bottom-0 left-0 right-0 z-50 border-t md:hidden ${
            isDark ? 'border-slate-800 bg-slate-950' : 'border-slate-200 bg-white'
          }`}
        >
          <div className="mx-auto grid max-w-7xl grid-cols-4 px-4 py-2">
            <Link
              to="/shop"
              className={`flex flex-col items-center gap-1 rounded-lg px-2 py-2 text-xs ${
                isDark ? 'text-slate-100' : 'text-slate-700'
              }`}
            >
              <span className="text-lg">🏠</span>
              Home
            </Link>
            <Link
              to="/orders"
              className={`flex flex-col items-center gap-1 rounded-lg px-2 py-2 text-xs ${
                isDark ? 'text-slate-100' : 'text-slate-700'
              }`}
            >
              <span className="text-lg">📦</span>
              Orders
            </Link>
            <Link
              to="/inbox"
              className={`relative flex flex-col items-center gap-1 rounded-lg px-2 py-2 text-xs ${
                isDark ? 'text-slate-100' : 'text-slate-700'
              }`}
            >
              <span className="text-lg">💬</span>
              Inbox
              {unreadInbox > 0 && (
                <span className="absolute -right-1 -top-1 min-w-5 rounded-full bg-rose-600 px-1.5 text-center text-[10px] font-bold text-white">
                  {unreadInbox > 99 ? '99+' : unreadInbox}
                </span>
              )}
            </Link>
            <Link
              to="/profile"
              className={`flex flex-col items-center gap-1 rounded-lg px-2 py-2 text-xs ${
                isDark ? 'text-slate-100' : 'text-slate-700'
              }`}
            >
              <span className="text-lg">👤</span>
              Profile
            </Link>
          </div>
        </nav>
      )}

      {!previewMode && readCustomerAiFeatureEnabled() && role === 'customer' ? (
        <Suspense fallback={null}>
          <CustomerAssistant />
        </Suspense>
      ) : null}
    </div>
  );
}
