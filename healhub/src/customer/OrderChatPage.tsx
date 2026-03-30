import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import CustomerLayout from './CustomerLayout';
import OwnerLayout from '../owner/OwnerLayout';
import { supabase } from '../services/supabaseClient';
import {
  getConversationForOrder,
  getOrCreateConversationForOrder,
  listMessages,
  markConversationReadAsCustomer,
  markConversationReadAsOwner,
  sendCustomerMessage,
  sendOwnerMessage,
  type ChatMessage,
  type ChatSenderRole,
} from '../services/orderChatService';
import { createProductImageFallback, resolveProductImageUrl } from '../services/productImageService';

function parseProductPreview(body: string) {
  const startTag = '[product_preview]';
  const endTag = '[/product_preview]';
  if (!body) return null;
  const start = body.indexOf(startTag);
  const end = body.indexOf(endTag);
  if (start === -1 || end === -1 || end <= start) return null;

  const chunk = body.slice(start + startTag.length, end).trim();
  const lines = chunk.split('\n').map((l) => l.trim());
  const nameLine = lines.find((l) => l.toLowerCase().startsWith('name:'));
  const imageLine = lines.find((l) => l.toLowerCase().startsWith('image:'));
  const name = nameLine ? nameLine.slice('name:'.length).trim() : '';
  const imageUrl = imageLine ? imageLine.slice('image:'.length).trim() : '';
  if (!name && !imageUrl) return null;
  return { name, imageUrl };
}

function roleToSenderRole(role: string | null): ChatSenderRole {
  return role === 'owner' ? 'owner' : 'customer';
}

export default function OrderChatPage() {
  const { orderId } = useParams();
  const id = Number(orderId);
  const { role } = useAuth();

  const [conversationId, setConversationId] = useState<number | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const bottomRef = useRef<HTMLDivElement | null>(null);
  const autoPreviewSentByConversationRef = useRef<Set<number>>(new Set());

  const mySenderRole = useMemo(() => roleToSenderRole(role), [role]);

  async function sendOrderProductPreviews(conversationId: number) {
    if (autoPreviewSentByConversationRef.current.has(conversationId)) return;

    // Mark immediately to prevent double-sending when React effects run twice.
    autoPreviewSentByConversationRef.current.add(conversationId);
    try {
      const existingMsgs = await listMessages(conversationId);
      const existingPreviewNames = new Set<string>();
      for (const m of existingMsgs) {
        const parsed = parseProductPreview(String(m.body || ''));
        const key = String(parsed?.name || '').trim().toLowerCase();
        if (key) existingPreviewNames.add(key);
      }

      // Send one product preview message per purchased product line (deduped by product id).
      const res = await supabase
        .from('orders')
        .select(
          `
            order_items:order_items (
              product:products (
                id,
                name,
                image_url
              )
            )
          `,
        )
        .eq('id', id)
        .maybeSingle();
      if (res.error) throw res.error;

      const orderItems = Array.isArray((res.data as any)?.order_items) ? (res.data as any).order_items : [];
      const unique = new Map<number, { name: string; image_url?: string | null }>();

      for (const it of orderItems) {
        const p = it?.product;
        const pid = p?.id ? Number(p.id) : NaN;
        const name = String(p?.name || '').trim();
        if (!Number.isFinite(pid) || pid <= 0) continue;
        if (!name) continue;
        if (!unique.has(pid)) unique.set(pid, { name, image_url: p?.image_url ?? null });
      }

      if (unique.size === 0) return;

      for (const [, p] of unique) {
        const productKey = String(p.name || '').trim().toLowerCase();
        if (!productKey) continue;
        if (existingPreviewNames.has(productKey)) continue;

        const imageUrl = resolveProductImageUrl({ name: p.name, image_url: p.image_url ?? null });
        const body = [
          '[product_preview]',
          `name:${p.name}`,
          `image:${imageUrl}`,
          '[/product_preview]',
        ].join('\n');
        await sendCustomerMessage(conversationId, id, body);
        existingPreviewNames.add(productKey);
      }

      const msgs = await listMessages(conversationId);
      setMessages(msgs);
    } catch (e) {
      // Allow retry if preview sending fails.
      autoPreviewSentByConversationRef.current.delete(conversationId);
      throw e;
    }
  }

  async function loadConversationAndMessages() {
    if (!id || Number.isNaN(id)) {
      setError('Invalid order id');
      setLoading(false);
      return;
    }

    setLoading(true);
    setError('');
    try {
      let convo: { id: number } | null = null;
      if (role === 'customer') {
        convo = await getOrCreateConversationForOrder(id);
      } else {
        convo = await getConversationForOrder(id);
      }

      if (!convo) {
        setConversationId(null);
        setMessages([]);
        setError(role === 'customer' ? '' : 'No chat yet from the customer.');
        return;
      }

      setConversationId(Number(convo.id));
      const conversationId = Number(convo.id);
      const msgs = await listMessages(conversationId);

      // Customer first entry: auto-send product previews for the order.
      if (role === 'customer' && msgs.length === 0) {
        await sendOrderProductPreviews(conversationId);
      } else {
        setMessages(msgs);
      }
    } catch (e: any) {
      setError(e?.message || 'Could not load chat');
      setConversationId(null);
      setMessages([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadConversationAndMessages();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, role]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  useEffect(() => {
    if (!conversationId) return;

    void (role === 'owner' ? markConversationReadAsOwner(conversationId) : markConversationReadAsCustomer(conversationId)).catch(() => {});

    const channel = supabase
      .channel(`order-chat-${conversationId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'order_messages',
          filter: `conversation_id=eq.${conversationId}`,
        },
        () => {
          void listMessages(conversationId).then(setMessages).catch(() => {});
          void (role === 'owner' ? markConversationReadAsOwner(conversationId) : markConversationReadAsCustomer(conversationId)).catch(() => {});
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [conversationId, role]);

  const grouped = useMemo(() => {
    return messages.map((m) => ({
      ...m,
      mine: m.sender_role === mySenderRole,
    }));
  }, [messages, mySenderRole]);

  async function send() {
    if (!conversationId) {
      setError(role === 'customer' ? 'Start chat first.' : 'Waiting for customer to start chat.');
      return;
    }
    const trimmed = String(text || '').trim();
    if (!trimmed) return;

    try {
      setError('');
      if (role === 'owner') {
        await sendOwnerMessage(conversationId, id, trimmed);
      } else {
        await sendCustomerMessage(conversationId, id, trimmed);
      }
      setText('');
      const msgs = await listMessages(conversationId);
      setMessages(msgs);
    } catch (e: any) {
      setError(e?.message || 'Failed to send');
    }
  }

  const content = (
    <div className="space-y-3">
      <div className="mb-2 flex items-center justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Order chat</p>
          <h2 className="text-xl font-bold text-slate-900">Chat with owner</h2>
        </div>
        <Link
          to={role === 'owner' ? '/owner/chat' : `/orders/${id}`}
          className="rounded-lg border px-3 py-2 text-sm hover:bg-slate-50"
        >
          ← Back
        </Link>
      </div>

      {error && <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>}

      {loading ? (
        <div className="text-sm text-slate-500">Loading…</div>
      ) : (
        <div className="flex h-[70vh] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white">
          <div className="flex-1 space-y-2 overflow-y-auto p-3">
            {grouped.length === 0 ? (
              <div className="py-6 text-center text-sm text-slate-500">
                {conversationId ? 'Say hi to the owner about this order.' : 'Chat is waiting for the customer to start.'}
              </div>
            ) : (
              grouped.map((m) => (
                <div key={m.id} className={`flex ${m.mine ? 'justify-end' : 'justify-start'}`}>
                  <div
                    className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm ${
                      m.mine ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-800'
                    }`}
                  >
                    {parseProductPreview(m.body) ? (
                      (() => {
                        const p = parseProductPreview(m.body);
                        if (!p) return null;
                        return (
                          <div className="space-y-2">
                            {p.imageUrl && (
                              <img
                                src={p.imageUrl}
                                alt={p.name || 'Product'}
                                className="h-16 w-16 rounded-lg object-cover"
                                onError={(e) => {
                                  (e.currentTarget as HTMLImageElement).src = createProductImageFallback(p.name || 'Product');
                                }}
                              />
                            )}
                            {p.name && <p className="font-semibold">{p.name}</p>}
                          </div>
                        );
                      })()
                    ) : (
                      <p className="whitespace-pre-wrap break-words">{m.body}</p>
                    )}
                    <p className={`mt-1 text-[10px] ${m.mine ? 'text-indigo-100' : 'text-slate-500'}`}>
                      {m.created_at ? new Date(m.created_at).toLocaleString() : ''}
                    </p>
                  </div>
                </div>
              ))
            )}
            <div ref={bottomRef} />
          </div>

          <div className="border-t p-3">
            <div className="flex gap-2">
              <input
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder={role === 'owner' ? 'Reply to customer…' : 'Type a message…'}
                className="flex-1 rounded-xl border px-3 py-2 text-sm"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void send();
                }}
                disabled={!conversationId}
              />
              <button
                className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60 disabled:cursor-not-allowed"
                onClick={() => void send()}
                disabled={!conversationId}
              >
                Send
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );

  if (role === 'owner') {
    return <OwnerLayout title={`Order #${id} Chat`}>{content}</OwnerLayout>;
  }
  return <CustomerLayout>{content}</CustomerLayout>;
}

