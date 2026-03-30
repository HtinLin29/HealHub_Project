import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import OwnerLayout from './OwnerLayout';
import { supabase } from '../services/supabaseClient';
import { isUnreadForOwner, listOwnerConversations, type ChatConversationSummary } from '../services/orderChatService';

type CustomerRow = { id: string; full_name: string | null };

export default function OwnerChatInboxPage() {
  const [convos, setConvos] = useState<ChatConversationSummary[]>([]);
  const [customerNames, setCustomerNames] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [unreadChat, setUnreadChat] = useState(0);

  async function load() {
    const rows = await listOwnerConversations();
    setConvos(rows);
    setUnreadChat(rows.filter(isUnreadForOwner).length);

    const customerIds = Array.from(
      new Set(rows.map((c) => c.customer_id).filter((v): v is string => typeof v === 'string' && v.length > 0)),
    );

    if (customerIds.length === 0) {
      setCustomerNames(new Map());
      return;
    }

    const nameRes = await supabase.from('users').select('id,full_name').in('id', customerIds);
    if (nameRes.error) throw nameRes.error;

    const m = new Map<string, string>();
    for (const r of (nameRes.data ?? []) as CustomerRow[]) {
      m.set(r.id, r.full_name || 'Customer');
    }
    setCustomerNames(m);
  }

  useEffect(() => {
    setLoading(true);
    load()
      .then(() => setError(''))
      .catch((e: any) => setError(e?.message || 'Could not load chat inbox'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const channel = supabase
      .channel('owner-chat-inbox')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'order_messages' }, () => {
        void load().catch(() => {});
      })
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const items = useMemo(() => convos, [convos]);

  return (
    <OwnerLayout title="Chat Inbox">
      {error && <div className="mb-4 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>}

      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="text-sm font-semibold text-slate-800">
          {items.length === 0 ? 'No chats yet.' : `Chats (${items.length})`}
        </p>
        {unreadChat > 0 && (
          <span className="rounded-full bg-rose-600 px-3 py-1 text-[11px] font-bold text-white">{unreadChat} new</span>
        )}
      </div>

      {loading ? (
        <div className="text-sm text-slate-500">Loading…</div>
      ) : items.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-600 shadow-sm">No chats yet.</div>
      ) : (
        <div className="space-y-3">
          {items.map((c) => (
            <Link
              key={c.id}
              to={`/orders/${c.order_id}/chat`}
              className="block rounded-2xl border border-slate-200 bg-white p-4 shadow-sm hover:bg-slate-50"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-900">Order #{c.order_id}</p>
                  <p className="mt-1 truncate text-xs text-slate-500">Customer: {c.customer_id ? customerNames.get(c.customer_id) || 'Customer' : '—'}</p>
                  <p className="mt-1 text-xs text-slate-500">
                    Last: {c.last_message_at ? new Date(c.last_message_at).toLocaleString() : '—'}
                  </p>
                </div>
                {isUnreadForOwner(c) && <span className="rounded-full bg-rose-600 px-2 py-0.5 text-[11px] font-bold text-white">NEW</span>}
              </div>
            </Link>
          ))}
        </div>
      )}
    </OwnerLayout>
  );
}

