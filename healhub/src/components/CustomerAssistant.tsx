import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { customerAiChat, type CustomerOllamaChatMessage } from '../services/customerAiChat';

function IconChat({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M8.625 12a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0Zm4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0Zm4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0ZM12 20.25c4.97 0 9-3.694 9-8.25s-4.03-8.25-9-8.25S3 7.444 3 12c0 2.104.859 4.023 2.273 5.48.432.447.74 1.04.586 1.641a4.483 4.483 0 0 1-.923 1.785A17.919 17.919 0 0 1 12 20.25Z"
      />
    </svg>
  );
}

function IconSend({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 12 3.269 3.125A59.769 59.769 0 0 1 21.485 12 59.768 59.768 0 0 1 3.27 20.875L5.999 12Zm0 0h7.5" />
    </svg>
  );
}

function TypingDots() {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2.5 dark:border-slate-700 dark:bg-slate-800">
      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400 [animation-delay:-0.3s]" />
      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400 [animation-delay:-0.15s]" />
      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400" />
    </div>
  );
}

type Message = { role: 'assistant' | 'user'; text: string };
type ChatTurn = { role: 'user' | 'assistant'; text: string };

const CUSTOMER_AI_MAX_TURNS = 14;
const CUSTOMER_AI_STORAGE_KEY = 'healhub-customer-ai-chat-v1';

const WELCOME =
  "Hi — I'm your HealHub shopping assistant. I can suggest products, answer questions about items in our catalog, and help with your orders. What would you like to know?";

function loadPersisted(): { messages: Message[]; turns: ChatTurn[]; open: boolean } | null {
  try {
    const raw = sessionStorage.getItem(CUSTOMER_AI_STORAGE_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as { v?: number; messages?: Message[]; turns?: ChatTurn[]; open?: boolean };
    if (p.v !== 1 || !Array.isArray(p.messages) || p.messages.length === 0) return null;
    const messages = p.messages.filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.text === 'string');
    if (messages.length === 0) return null;
    const turns = Array.isArray(p.turns)
      ? p.turns.filter((t) => t && (t.role === 'user' || t.role === 'assistant') && typeof t.text === 'string')
      : [];
    return { messages, turns, open: Boolean(p.open) };
  } catch {
    return null;
  }
}

function savePersisted(payload: { messages: Message[]; turns: ChatTurn[]; open: boolean }) {
  try {
    sessionStorage.setItem(CUSTOMER_AI_STORAGE_KEY, JSON.stringify({ v: 1, ...payload }));
  } catch {
    // ignore
  }
}

export default function CustomerAssistant() {
  const { session, role } = useAuth();
  const { mode } = useTheme();
  const isDark = mode === 'dark';
  const messagesScrollRef = useRef<HTMLDivElement>(null);

  const persisted = typeof window !== 'undefined' ? loadPersisted() : null;
  const [open, setOpen] = useState(persisted?.open ?? false);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>(persisted?.messages ?? [{ role: 'assistant', text: WELCOME }]);
  const [turns, setTurns] = useState<ChatTurn[]>(
    persisted?.turns?.length
      ? persisted.turns
      : [{ role: 'assistant', text: WELCOME }],
  );

  useEffect(() => {
    savePersisted({ messages, turns, open });
  }, [messages, turns, open]);

  useEffect(() => {
    if (!open) return;
    const el = messagesScrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, loading, open]);

  async function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || loading) return;

    const nextTurns = [...turns, { role: 'user' as const, text: trimmed }];
    setTurns(nextTurns);
    setMessages((prev) => [...prev, { role: 'user', text: trimmed }]);
    setInput('');
    setLastError(null);
    setLoading(true);

    const turnsForServer = nextTurns.slice(-CUSTOMER_AI_MAX_TURNS);
    const ollamaMessages: CustomerOllamaChatMessage[] = turnsForServer.map((t) => ({
      role: t.role,
      content: t.text,
    }));

    try {
      if (!session?.access_token) throw new Error('Sign in required.');
      if (role !== 'customer') throw new Error('Customer account required.');

      const reply = await customerAiChat(session.access_token, ollamaMessages);
      setTurns((prev) => [...prev, { role: 'assistant', text: reply }]);
      setMessages((prev) => [...prev, { role: 'assistant', text: reply }]);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Request failed';
      setLastError(msg);
      const hint =
        'Tip: Run Ollama and `npm run server:dev` in the healhub folder, then try again.';
      setTurns((prev) => [...prev, { role: 'assistant', text: `Sorry — I couldn’t reach the assistant (${msg}).\n\n${hint}` }]);
      setMessages((prev) => [...prev, { role: 'assistant', text: `Sorry — I couldn’t reach the assistant (${msg}).\n\n${hint}` }]);
    } finally {
      setLoading(false);
    }
  }

  if (!session || role !== 'customer') return null;

  return (
    <>
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={open ? 'Close shopping assistant' : 'Open shopping assistant'}
        className="fixed bottom-24 right-4 z-[80] flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3.5 py-2.5 text-sm font-medium text-slate-800 shadow-md transition hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-400 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700 md:bottom-5 md:right-5"
        style={{
          paddingBottom: 'max(0.625rem, env(safe-area-inset-bottom, 0px))',
          paddingRight: 'max(0.75rem, env(safe-area-inset-right, 0px))',
        }}
        onClick={() => setOpen((v) => !v)}
      >
        <IconChat className="h-5 w-5 text-slate-600 dark:text-slate-300" />
        {open ? 'Close' : 'Assistant'}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="HealHub shopping assistant"
          className="fixed bottom-[7.5rem] right-4 z-[80] flex h-[min(34rem,78vh)] w-[min(24rem,calc(100vw-1.25rem))] flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl sm:right-5 md:bottom-24 dark:border-slate-700 dark:bg-slate-900 dark:shadow-black/30"
          style={{
            marginBottom: 'env(safe-area-inset-bottom, 0px)',
            marginRight: 'max(0px, env(safe-area-inset-right, 0px))',
          }}
        >
          <header className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3 dark:border-slate-700 dark:bg-slate-900">
            <div>
              <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Shopping assistant</h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">HealHub · Products & orders</p>
            </div>
            <button
              type="button"
              className="rounded-lg p-1.5 text-slate-500 transition hover:bg-slate-200 hover:text-slate-800 dark:hover:bg-slate-800 dark:hover:text-slate-200"
              onClick={() => setOpen(false)}
              aria-label="Close"
            >
              <span className="block text-lg leading-none">×</span>
            </button>
          </header>

          {lastError ? (
            <div className="shrink-0 border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-100">
              <span className="font-medium">Connection issue.</span> {lastError}
            </div>
          ) : null}

          <div
            ref={messagesScrollRef}
            className={`min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3 ${isDark ? 'bg-slate-950' : 'bg-slate-50'}`}
          >
            {messages.map((message, idx) => (
              <div key={idx} className={`flex w-full ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                {message.role === 'assistant' ? (
                  <div className="max-w-[90%] whitespace-pre-line rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm leading-relaxed text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100">
                    {message.text}
                  </div>
                ) : (
                  <div className="max-w-[88%] whitespace-pre-line rounded-lg bg-slate-800 px-3 py-2 text-sm leading-relaxed text-white dark:bg-slate-600">
                    {message.text}
                  </div>
                )}
              </div>
            ))}
            {loading ? <TypingDots /> : null}
          </div>

          <div className="shrink-0 border-t border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center gap-2">
              <label className="sr-only" htmlFor="customer-ai-input">
                Message
              </label>
              <input
                id="customer-ai-input"
                className="min-h-[42px] flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:border-slate-500 dark:focus:ring-slate-600"
                placeholder="Ask about products or your orders…"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    void send(input);
                  }
                }}
                disabled={loading}
                autoComplete="off"
              />
              <button
                type="button"
                aria-label="Send"
                className="flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-lg bg-indigo-600 text-white transition hover:bg-indigo-700 disabled:opacity-40 dark:bg-indigo-500 dark:hover:bg-indigo-400"
                onClick={() => void send(input)}
                disabled={loading || !input.trim()}
              >
                <IconSend className="h-5 w-5" />
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
