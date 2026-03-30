export type OllamaChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };

/**
 * Owner AI chat — the bridge at `/api/owner-ai/chat` injects Supabase context + tools server-side.
 * Send only user/assistant turns (no system message).
 */
export async function ownerAiChat(accessToken: string, messages: OllamaChatMessage[]): Promise<string> {
  const r = await fetch('/api/owner-ai/chat', {
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
    throw new Error('Invalid response from Owner AI');
  }
  return text;
}
