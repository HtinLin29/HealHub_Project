import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import type { KpiSummary, Order, Product } from '../types/domain';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { ownerAiChat, type OllamaChatMessage } from '../services/ownerAiChat';

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
const OWNER_AI_MAX_TURNS_TO_SEND = 14;

const WELCOME_TEXT =
  "Welcome to HealHub! I'm your assistant — I can help you with orders, sales, inventory, and more. Just ask me anything!";

/** Survives route changes, remounts, and dev HMR within the same browser tab */
const OWNER_AI_STORAGE_KEY = 'healhub-owner-ai-chat-v1';

function loadOwnerAiPersisted(): { messages: Message[]; turns: ChatTurn[]; open: boolean } | null {
  try {
    const raw = sessionStorage.getItem(OWNER_AI_STORAGE_KEY);
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

function saveOwnerAiPersisted(payload: { messages: Message[]; turns: ChatTurn[]; open: boolean }) {
  try {
    sessionStorage.setItem(OWNER_AI_STORAGE_KEY, JSON.stringify({ v: 1, ...payload }));
  } catch {
    // quota / private mode
  }
}

/** "Open dashboard", "go to settings", etc. → owner (or shop) routes */
function parseOwnerNavigationCommand(raw: string): { path: string; label: string } | null {
  const q = raw.toLowerCase().replace(/\s+/g, ' ').trim().replace(/[.!?]+$/g, '').trim();
  const prefix = /^(open|go to|navigate to|show(?:\s+me)?|take me to)\s+(?:the\s+)?/i;
  if (!prefix.test(q)) return null;
  const target = q.replace(prefix, '').trim();
  if (!target) return null;

  const routes: { keys: string[]; path: string; label: string }[] = [
    { keys: ['owner home', 'home', 'main menu', 'start'], path: '/owner', label: 'Owner home' },
    { keys: ['dashboard', 'analytics', 'kpis', 'charts', 'kpi'], path: '/owner/analytics', label: 'Dashboard (analytics)' },
    { keys: ['todo', 'to-do', 'tasks', 'task list'], path: '/owner/todo', label: 'To-do' },
    { keys: ['crm', 'customers', 'customer relationships'], path: '/owner/crm', label: 'CRM' },
    { keys: ['sale', 'sales'], path: '/owner/sale', label: 'Sale' },
    { keys: ['delivery', 'fulfillment', 'shipping orders'], path: '/owner/fulfillment', label: 'Delivery / fulfillment' },
    { keys: ['chat', 'messages', 'order chat', 'customer chat'], path: '/owner/chat', label: 'Chat inbox' },
    { keys: ['refunds', 'refund'], path: '/owner/refunds', label: 'Refunds' },
    { keys: ['inventory', 'stock', 'products'], path: '/owner/inventory', label: 'Inventory' },
    { keys: ['settings', 'setting', 'preferences'], path: '/owner/settings', label: 'Settings' },
    { keys: ['storefront', 'customer shop', 'shop', 'store'], path: '/shop', label: 'Storefront (shop)' },
  ];

  for (const r of routes) {
    if (r.keys.some((k) => target === k || target.startsWith(`${k} `))) {
      return { path: r.path, label: r.label };
    }
  }
  return null;
}

function money(n: number) {
  return `฿${Number(n || 0).toFixed(2)}`;
}

function topLowStock(products: Product[]) {
  return [...products]
    .filter((p) => p.stock <= (p.low_stock_threshold ?? 10))
    .sort((a, b) => Number(a.stock) - Number(b.stock))
    .slice(0, 5);
}

function recentRevenue(orders: Order[]) {
  return orders
    .filter((o) => ['paid', 'packed', 'shipped', 'delivered'].includes(o.status))
    .reduce((sum, o) => sum + Number(o.total_price || 0), 0);
}

function extractOrderIdFromOwnerQuestion(raw: string): number | null {
  const m =
    raw.match(/\b(?:order\s*#?\s*|#)\s*(\d{1,12})\b/i)?.[1] ?? raw.match(/\border\s+(\d{1,12})\b/i)?.[1];
  if (!m) return null;
  const n = parseInt(m, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Offline fallback when Ollama / bridge is unavailable */
function answerOwnerQueryLocal(input: string, kpis: KpiSummary, products: Product[], recentOrders: Order[], monthlyRevenue: { month: string; revenue: number }[]) {
  const q = input.toLowerCase().trim();

  if (!q) {
    return 'Ask me about total orders, revenue, stock, low-stock products, recent orders, or monthly sales.';
  }

  const orderIdAsk = extractOrderIdFromOwnerQuestion(input);
  if (orderIdAsk != null) {
    const o = recentOrders.find((r) => r.id === orderIdAsk);
    if (o) {
      const cust = o.customer_name?.trim() || (o.customer_id ? 'Customer' : 'Guest');
      const when = o.created_at ? new Date(o.created_at).toLocaleString() : '—';
      return `From the order list on this dashboard: Order #${o.id}. Customer: ${cust}. Total: ${money(o.total_price)}. Status: ${o.status}. Placed: ${when}.`;
    }
    if (recentOrders.length === 0) {
      return 'No orders are loaded in the assistant yet — wait for the dashboard to finish loading, or start the Owner AI server (`npm run server:dev`).';
    }
    return `Order #${orderIdAsk} is not in the ${recentOrders.length} orders currently shown on this analytics page. Try the Sale page for a full list, or ask about an order ID from the table.`;
  }

  if (q.includes('today')) {
    return `From the currently loaded dashboard data, recent revenue is ${money(recentRevenue(recentOrders))} across ${recentOrders.length} recent order(s).`;
  }

  if (q.includes('revenue') || q.includes('sale') || q.includes('sales')) {
    const latestMonth = monthlyRevenue[monthlyRevenue.length - 1];
    return `Total revenue is ${money(kpis.totalRevenue)}. ${latestMonth ? `Latest reported month is ${latestMonth.month} with ${money(latestMonth.revenue)}.` : 'No monthly revenue rows are loaded yet.'}`;
  }

  if (q.includes('order')) {
    const recent = recentOrders.slice(0, 5).map((o) => `• #${o.id} — ${o.status} — ${money(o.total_price)}`).join('\n');
    return recent ? `Here are recent orders:\n${recent}` : 'No recent orders are loaded right now.';
  }

  if (q.includes('stock') || q.includes('inventory')) {
    const lows = topLowStock(products);
    if (q.includes('low')) {
      return lows.length
        ? `Low-stock products:\n${lows.map((p) => `• ${p.name} — stock ${p.stock} / threshold ${p.low_stock_threshold}`).join('\n')}`
        : 'No low-stock products right now.';
    }
    return `Current stock across active products is ${kpis.totalStock}. ${lows.length ? `${lows.length} product(s) are low on stock.` : 'No low-stock alerts right now.'}`;
  }

  if (q.includes('product') || q.includes('catalog')) {
    return `There are ${products.length} active products loaded in the owner dashboard.`;
  }

  if (q.includes('month')) {
    const lines = monthlyRevenue.slice(-6).map((m) => `• ${m.month} — ${money(m.revenue)}`).join('\n');
    return lines ? `Recent monthly revenue:\n${lines}` : 'No monthly revenue data is loaded yet.';
  }

  return 'I can answer owner-side questions about orders, revenue, stock, low-stock alerts, product count, and monthly sales from the loaded dashboard data.';
}

export default function OwnerAssistant({
  kpis,
  products,
  recentOrders,
  monthlyRevenue,
}: {
  kpis: KpiSummary;
  products: Product[];
  recentOrders: Order[];
  monthlyRevenue: { month: string; revenue: number }[];
}) {
  const { session, role } = useAuth();
  const { mode } = useTheme();
  const isDark = mode === 'dark';
  const location = useLocation();
  const navigate = useNavigate();

  const initialChat = useMemo(() => {
    const p = loadOwnerAiPersisted();
    const hash = typeof window !== 'undefined' && window.location.hash === '#owner-ai';
    return {
      open: hash ? true : p?.open ?? false,
      messages: p?.messages ?? [{ role: 'assistant' as const, text: WELCOME_TEXT }],
      turns: (p?.turns ?? []) as ChatTurn[],
    };
  }, []);

  const [open, setOpen] = useState(initialChat.open);
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<Message[]>(initialChat.messages);
  const [turns, setTurns] = useState<ChatTurn[]>(initialChat.turns);
  const [loading, setLoading] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);

  // Open when navigating from Owner Home "Owner AI" card (/owner#owner-ai)
  useEffect(() => {
    if (location.hash === '#owner-ai') {
      setOpen(true);
      window.history.replaceState(null, '', `${location.pathname}${location.search}`);
    }
  }, [location.hash, location.pathname, location.search]);

  // Keep history when switching routes / remounting (OwnerShell vs Shop owner preview, dev refresh)
  useEffect(() => {
    saveOwnerAiPersisted({ messages, turns, open });
  }, [messages, turns, open]);
  const messagesScrollRef = useRef<HTMLDivElement>(null);

  /** Keep the latest user message + assistant reply in view without manual scrolling */
  useEffect(() => {
    if (!open) return;
    const el = messagesScrollRef.current;
    if (!el) return;
    const run = () => {
      el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    };
    requestAnimationFrame(() => requestAnimationFrame(run));
  }, [open, messages, loading]);

  async function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || loading) return;

    const nav = parseOwnerNavigationCommand(trimmed);
    if (nav) {
      navigate(nav.path);
      const confirm = `Opening ${nav.label}…`;
      setTurns((prev) => [...prev, { role: 'user', text: trimmed }, { role: 'assistant', text: confirm }]);
      setMessages((prev) => [...prev, { role: 'user', text: trimmed }, { role: 'assistant', text: confirm }]);
      setInput('');
      setLastError(null);
      return;
    }

    const nextTurns = [...turns, { role: 'user' as const, text: trimmed }];
    setTurns(nextTurns);
    setMessages((prev) => [...prev, { role: 'user', text: trimmed }]);
    setInput('');
    setLastError(null);
    setLoading(true);

    // Send only recent turns to keep prompt size bounded.
    const turnsForServer = nextTurns.slice(-OWNER_AI_MAX_TURNS_TO_SEND);
    const ollamaMessages: OllamaChatMessage[] = turnsForServer.map((t) => ({
      role: t.role,
      content: t.text,
    }));

    try {
      if (!session?.access_token) {
        throw new Error('Sign in required.');
      }
      if (role !== 'owner') {
        throw new Error('Owner account required for AI chat.');
      }

      const reply = await ownerAiChat(session.access_token, ollamaMessages);
      setTurns((prev) => [...prev, { role: 'assistant', text: reply }]);
      setMessages((prev) => [...prev, { role: 'assistant', text: reply }]);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Request failed';
      const fallback = answerOwnerQueryLocal(trimmed, kpis, products, recentOrders, monthlyRevenue);
      const contextTooLarge = msg.includes('Message too long after injecting context');
      // Same answer as dashboard: show only the helpful text — no scary banner for context-size fallback.
      if (contextTooLarge) {
        setLastError(null);
        setTurns((prev) => [...prev, { role: 'assistant', text: fallback }]);
        setMessages((prev) => [...prev, { role: 'assistant', text: fallback }]);
      } else {
        setLastError(msg);
        const combined = `${fallback}\n\n—\n(Owner AI bridge unavailable: ${msg}. Start Ollama and run \`npm run server:dev\` in the healhub folder, or keep using this offline summary.)`;
        setTurns((prev) => [...prev, { role: 'assistant', text: combined }]);
        setMessages((prev) => [...prev, { role: 'assistant', text: combined }]);
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={open ? 'Close assistant' : 'Open assistant'}
        className="fixed bottom-5 right-5 z-[80] flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3.5 py-2.5 text-sm font-medium text-slate-800 shadow-md transition hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-400 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
        style={{ paddingBottom: 'max(0.625rem, env(safe-area-inset-bottom, 0px))', paddingRight: 'max(0.75rem, env(safe-area-inset-right, 0px))' }}
        onClick={() => setOpen((v) => !v)}
      >
        <IconChat className="h-5 w-5 text-slate-600 dark:text-slate-300" />
        {open ? 'Close' : 'Assistant'}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="HealHub assistant"
          className="fixed bottom-24 right-4 z-[80] flex h-[min(34rem,78vh)] w-[min(24rem,calc(100vw-1.25rem))] flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl sm:right-5 dark:border-slate-700 dark:bg-slate-900 dark:shadow-black/30"
          style={{
            marginBottom: 'env(safe-area-inset-bottom, 0px)',
            marginRight: 'max(0px, env(safe-area-inset-right, 0px))',
          }}
        >
          <header className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3 dark:border-slate-700 dark:bg-slate-900">
            <div>
              <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Assistant</h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">HealHub · Owner tools</p>
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
              <span className="font-medium">Offline mode.</span> {lastError}
            </div>
          ) : null}

          <div
            ref={messagesScrollRef}
            className={`min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3 ${
              isDark ? 'bg-slate-950' : 'bg-slate-50'
            }`}
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
              <label className="sr-only" htmlFor="owner-ai-input">
                Message
              </label>
              <input
                id="owner-ai-input"
                className="min-h-[42px] flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:border-slate-500 dark:focus:ring-slate-600"
                placeholder="Message…"
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
                className="flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-lg bg-slate-900 text-white transition hover:bg-slate-800 disabled:opacity-40 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white"
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
