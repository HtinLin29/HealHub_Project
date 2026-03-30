import { supabase } from './supabaseClient';
import { getOrCreateCurrentCustomerId } from './customerIdentityService';

export type ChatSenderRole = 'customer' | 'owner';

export type ChatMessage = {
  id: number;
  conversation_id: number;
  order_id: number;
  sender_role: ChatSenderRole;
  sender_user_id: string | null;
  body: string;
  created_at: string;
};

export type ChatConversationSummary = {
  id: number;
  order_id: number;
  customer_id: string | null;
  last_message_at: string | null;
  last_sender_role: ChatSenderRole | null;
  owner_last_read_at: string | null;
  customer_last_read_at: string | null;
};

type ConversationRow = {
  id: number;
  order_id: number;
  customer_id: string | null;
};

async function getCurrentAppUserId(): Promise<string | null> {
  const { data: sessionData } = await supabase.auth.getSession();
  const authUserId = sessionData.session?.user?.id;
  if (!authUserId) return null;

  const userRes = await supabase.from('users').select('id').eq('auth_user_id', authUserId).maybeSingle();
  if (userRes.error) return null;
  return (userRes.data?.id as string | undefined) ?? null;
}

export async function getConversationForOrder(orderId: number): Promise<ConversationRow | null> {
  const res = await supabase
    .from('order_conversations')
    .select('id,order_id,customer_id')
    .eq('order_id', orderId)
    .maybeSingle();

  if (res.error) throw res.error;
  return (res.data as any as ConversationRow | null) ?? null;
}

export async function listOwnerConversations(): Promise<ChatConversationSummary[]> {
  const res = await supabase
    .from('order_conversations')
    .select('id,order_id,customer_id,last_message_at,last_sender_role,owner_last_read_at,customer_last_read_at')
    .order('last_message_at', { ascending: false })
    .limit(500);

  if (res.error) throw res.error;
  return (res.data ?? []) as any;
}

export async function listCustomerConversations(): Promise<ChatConversationSummary[]> {
  const customerId = await getOrCreateCurrentCustomerId();
  if (!customerId) throw new Error('Not signed in');

  const res = await supabase
    .from('order_conversations')
    .select('id,order_id,customer_id,last_message_at,last_sender_role,owner_last_read_at,customer_last_read_at')
    .eq('customer_id', customerId)
    .order('last_message_at', { ascending: false })
    .limit(500);

  if (res.error) throw res.error;
  return (res.data ?? []) as any;
}

export function isUnreadForOwner(c: ChatConversationSummary) {
  if (c.last_sender_role !== 'customer') return false;
  if (!c.last_message_at) return false;
  const last = new Date(c.last_message_at).getTime();
  const read = c.owner_last_read_at ? new Date(c.owner_last_read_at).getTime() : 0;
  return last > read;
}

export function isUnreadForCustomer(c: ChatConversationSummary) {
  if (c.last_sender_role !== 'owner') return false;
  if (!c.last_message_at) return false;
  const last = new Date(c.last_message_at).getTime();
  const read = c.customer_last_read_at ? new Date(c.customer_last_read_at).getTime() : 0;
  return last > read;
}

export async function getOrCreateConversationForOrder(orderId: number): Promise<ConversationRow> {
  const customerId = await getOrCreateCurrentCustomerId();
  if (!customerId) throw new Error('Please sign in to chat.');

  const now = new Date().toISOString();
  const res = await supabase
    .from('order_conversations')
    .upsert(
      {
        order_id: orderId,
        customer_id: customerId,
        last_message_at: now,
        last_sender_role: 'customer' as ChatSenderRole,
      },
      { onConflict: 'order_id' },
    )
    .select('id,order_id,customer_id')
    .maybeSingle();

  if (res.error) throw res.error;
  if (!res.data) throw new Error('Could not create conversation.');
  return res.data as any as ConversationRow;
}

export async function listMessages(conversationId: number): Promise<ChatMessage[]> {
  const res = await supabase
    .from('order_messages')
    .select('id,conversation_id,order_id,sender_role,sender_user_id,body,created_at')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true })
    .limit(500);

  if (res.error) throw res.error;
  return (res.data ?? []) as any as ChatMessage[];
}

export async function markConversationReadAsCustomer(conversationId: number) {
  const now = new Date().toISOString();
  const res = await supabase.from('order_conversations').update({ customer_last_read_at: now }).eq('id', conversationId);
  if (res.error) throw res.error;
}

export async function markConversationReadAsOwner(conversationId: number) {
  const now = new Date().toISOString();
  const res = await supabase.from('order_conversations').update({ owner_last_read_at: now }).eq('id', conversationId);
  if (res.error) throw res.error;
}

async function sendMessage({
  conversationId,
  orderId,
  senderRole,
  body,
}: {
  conversationId: number;
  orderId: number;
  senderRole: ChatSenderRole;
  body: string;
}) {
  const now = new Date().toISOString();

  if (senderRole === 'customer') {
    const customerId = await getOrCreateCurrentCustomerId();
    if (!customerId) throw new Error('Please sign in.');

    const ins = await supabase.from('order_messages').insert({
      conversation_id: conversationId,
      order_id: orderId,
      sender_role: senderRole,
      sender_user_id: customerId,
      body,
    });
    if (ins.error) throw ins.error;

    const up = await supabase
      .from('order_conversations')
      .update({ last_message_at: now, last_sender_role: senderRole })
      .eq('id', conversationId);
    if (up.error) throw up.error;
    return;
  }

  const ownerAppUserId = await getCurrentAppUserId();
  if (!ownerAppUserId) throw new Error('Owner account missing profile row.');

  const ins = await supabase.from('order_messages').insert({
    conversation_id: conversationId,
    order_id: orderId,
    sender_role: senderRole,
    sender_user_id: ownerAppUserId,
    body,
  });
  if (ins.error) throw ins.error;

  const up = await supabase
    .from('order_conversations')
    .update({ last_message_at: now, last_sender_role: senderRole })
    .eq('id', conversationId);
  if (up.error) throw up.error;
}

export async function sendCustomerMessage(conversationId: number, orderId: number, body: string) {
  const trimmed = String(body ?? '').trim();
  if (!trimmed) throw new Error('Message is empty.');
  return sendMessage({ conversationId, orderId, senderRole: 'customer', body: trimmed });
}

export async function sendOwnerMessage(conversationId: number, orderId: number, body: string) {
  const trimmed = String(body ?? '').trim();
  if (!trimmed) throw new Error('Message is empty.');
  return sendMessage({ conversationId, orderId, senderRole: 'owner', body: trimmed });
}

