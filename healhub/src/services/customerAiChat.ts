import { customerAiChatEndpoint } from '../lib/aiBridgeUrl';

export type CustomerOllamaChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };

/**
 * Customer AI — the bridge at `/api/customer-ai/chat` injects catalog + your orders server-side.
 * Send only user/assistant turns (no system message).
 */
export async function customerAiChat(accessToken: string, messages: CustomerOllamaChatMessage[]): Promise<string> {
  const r = await fetch(customerAiChatEndpoint(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ messages }),
  });

  const data = (await r.json().catch(() => ({}))) as {
    error?: string;
    detail?: string;
    message?: { content?: string };
  };

  if (!r.ok) {
    const detail = typeof data.detail === 'string' && data.detail.trim() ? ` — ${data.detail.trim()}` : '';
    throw new Error((data.error || `Request failed (${r.status})`) + detail);
  }

  const text = data.message?.content;
  if (typeof text !== 'string') {
    throw new Error('Invalid response from Customer AI');
  }
  return text;
}
