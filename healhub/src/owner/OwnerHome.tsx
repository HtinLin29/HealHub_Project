import { Link } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { useTheme } from '../context/ThemeContext';
import { supabase } from '../services/supabaseClient';
import { isUnreadForOwner, listOwnerConversations } from '../services/orderChatService';
type Feature = {
  name: string;
  icon: string;
  path: string;
  description: string;
};

const features: Feature[] = [
  { name: 'To-do', icon: '📝', path: '/owner/todo', description: 'Tasks and reminders' },
  { name: 'CRM', icon: '👥', path: '/owner/crm', description: 'Customer relationships' },
  { name: 'Sale', icon: '💸', path: '/owner/sale', description: 'Sales operations' },
  { name: 'Delivery', icon: '🚚', path: '/owner/fulfillment', description: 'Order fulfillment (demo)' },
  { name: 'Chat', icon: '💬', path: '/owner/chat', description: 'Customer order messages' },
  { name: 'Refunds', icon: '💸', path: '/owner/refunds', description: 'Refund requests (demo)' },
  { name: 'Dashboard', icon: '📊', path: '/owner/analytics', description: 'KPIs and charts' },
  { name: 'Storefront', icon: '🏪', path: '/shop', description: 'Customer shopping experience' },
  { name: 'Inventory', icon: '📦', path: '/owner/inventory', description: 'Stock management' },
  { name: 'Settings', icon: '⚙️', path: '/owner/settings', description: 'System configuration' },
];

export default function OwnerHome() {
  const { mode } = useTheme();
  const isDark = mode === 'dark';
  const [unreadChat, setUnreadChat] = useState(0);

  useEffect(() => {
    async function loadUnread() {
      try {
        const convos = await listOwnerConversations();
        setUnreadChat(convos.filter(isUnreadForOwner).length);
      } catch {
        setUnreadChat(0);
      }
    }

    void loadUnread();
    const channel = supabase
      .channel('owner-home-chat-badge')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'order_messages' }, () => void loadUnread())
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, []);

  return (
    <div className={`min-h-screen p-4 md:p-8 ${isDark ? 'bg-slate-900' : 'bg-slate-100'}`}>
      <div className="mx-auto max-w-7xl">
        <header className="rounded-2xl bg-gradient-to-r from-indigo-700 via-blue-700 to-cyan-600 px-5 py-8 text-white md:px-8">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-blue-100">HealHub Owner</p>
            <h1 className="mt-2 text-2xl font-bold md:text-3xl">Owner Dashboard</h1>
            <p className="mt-1 text-sm text-blue-100">This is the first screen after owner login.</p>
          </div>
        </header>

        <section className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {features.map((feature) => (
            <Link
              key={feature.name}
              to={feature.path}
              className={`rounded-2xl border p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md ${
                isDark ? 'border-slate-700 bg-slate-800' : 'border-slate-200 bg-white'
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="text-2xl">{feature.icon}</div>
                {feature.path === '/owner/chat' && unreadChat > 0 && (
                  <span className="rounded-full bg-rose-600 px-2 py-0.5 text-[11px] font-bold text-white">
                    {unreadChat > 99 ? '99+' : unreadChat}
                  </span>
                )}
              </div>
              <h3 className={`mt-2 text-sm font-semibold ${isDark ? 'text-slate-100' : 'text-slate-800'}`}>{feature.name}</h3>
              <p className={`mt-1 text-xs ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>{feature.description}</p>
            </Link>
          ))}
        </section>
      </div>
    </div>
  );
}
