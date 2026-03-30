/**
 * Owner AI + Customer AI bridges: Supabase JWT, role checks, allowlisted reads, then Ollama.
 * Run: npm run server:dev (from healhub root). Requires Ollama on OLLAMA_URL.
 */
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { createClient } from '@supabase/supabase-js';
import { runOwnerAiTools } from './ownerAiTools';
import { runCustomerAiTools } from './customerAiTools';
import { formatOwnerAiReply } from './ownerAiMessageFormat';
import { formatCustomerAiReply } from './customerAiMessageFormat';

const app = express();

const PORT = Number(process.env.OWNER_AI_PORT || process.env.PORT || 8787);
const OLLAMA_URL = (process.env.OLLAMA_URL || 'http://127.0.0.1:11434').replace(/\/$/, '');
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'llama3.2';
/** Lower = more factual; 0.15–0.35 recommended for owner data Q&A */
const OLLAMA_TEMPERATURE = Number(process.env.OLLAMA_TEMPERATURE ?? 0.22);
/** Slightly higher default for friendly customer shopping tone */
const CUSTOMER_AI_TEMPERATURE = Number(process.env.CUSTOMER_AI_TEMPERATURE ?? 0.4);
/** Per-message cap after the server builds the system context; keep below model context limits. */
const MAX_MESSAGE_CHARS = (() => {
  const n = Number(process.env.OWNER_AI_MAX_MESSAGE_CHARS || 16_000);
  return Number.isFinite(n) && n >= 10_000 ? Math.min(n, 100_000) : 16_000;
})();
const OLLAMA_TIMEOUT_MS = Number(process.env.OLLAMA_TIMEOUT_MS || 120_000);

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;

const corsOrigin = process.env.OWNER_AI_CORS_ORIGIN;

app.use(
  cors({
    origin: corsOrigin === '*' ? true : corsOrigin || true,
    credentials: true,
  }),
);
app.use(express.json({ limit: '512kb' }));

function getBearer(req: express.Request): string | null {
  const h = req.headers.authorization;
  if (!h?.startsWith('Bearer ')) return null;
  return h.slice(7).trim() || null;
}

function stripSystemMessages(messages: Array<{ role: string; content: string }>) {
  return messages.filter((m) => m && m.role !== 'system');
}

/**
 * Normalize common owner phrasing that can confuse intent routing/model answers.
 * Example: "inactive order" in inventory context should mean "inactive product".
 */
function normalizeOwnerUserText(content: string): string {
  let s = String(content || '');
  // "inactive order(s)" is not an inventory concept in HealHub; treat as product wording.
  s = s.replace(/\binactive\s+orders?\b/gi, (m) => (m.toLowerCase().endsWith('s') ? 'inactive products' : 'inactive product'));
  return s;
}

function getLastUserContent(messages: Array<{ role: string; content: string }>): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') return messages[i].content;
  }
  return '';
}

/** Last N USER turns for tool resolution (order #, follow-up questions). Capped for token limits. */
function buildConversationContextForTools(messages: Array<{ role: string; content: string }>, maxChars = 8000): string {
  const lines: string[] = [];
  let total = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (!m?.content) continue;
    if (m.role !== 'user') continue;
    const line = `User: ${m.content}`;
    if (total + line.length + 1 > maxChars) break;
    lines.unshift(line);
    total += line.length + 1;
  }
  return lines.join('\n');
}

app.get('/api/owner-ai/health', (_req, res) => {
  res.json({
    ok: true,
    ollamaUrl: OLLAMA_URL,
    model: OLLAMA_MODEL,
    temperature: Number.isFinite(OLLAMA_TEMPERATURE) ? OLLAMA_TEMPERATURE : 0.22,
    hasSupabaseConfig: Boolean(supabaseUrl && supabaseAnonKey),
  });
});

/** Read-only API contract (no secrets). Full DB access is not exposed to the LLM — see securityModel. */
app.get('/api/owner-ai/capabilities', (_req, res) => {
  res.json({
    name: 'HealHub Owner AI bridge',
    version: '1',
    basePath: '/api/owner-ai',
    endpoints: [
      {
        method: 'GET',
        path: '/api/owner-ai/health',
        auth: false,
        description: 'Liveness + Ollama model, temperature, Supabase env presence.',
      },
      {
        method: 'GET',
        path: '/api/owner-ai/capabilities',
        auth: false,
        description: 'This contract JSON.',
      },
      {
        method: 'POST',
        path: '/api/owner-ai/chat',
        auth: 'Bearer <Supabase access_token>; user must have role=owner in public.users',
        description:
          'Loads allowlisted Supabase reads + analytics snapshot, injects as system prompt, calls Ollama /api/chat.',
      },
    ],
    chat: {
      method: 'POST',
      path: '/api/owner-ai/chat',
      headers: {
        Authorization: 'Bearer <access_token>',
        'Content-Type': 'application/json',
      },
      body: {
        messages: [
          { role: 'user | assistant | system', content: 'string (max 12000 chars each)' },
        ],
        model: 'optional string; defaults to OLLAMA_MODEL env',
      },
      response200: {
        message: { role: 'assistant', content: 'string' },
        model: 'string',
      },
      errors: [400, 401, 403, 502, 504],
    },
    securityModel: {
      supabase: 'Uses anon key + logged-in user JWT. Row Level Security applies (same as owner in the web app).',
      notSupported:
        'Arbitrary SQL, service role key, schema changes, or unconstrained table access from the LLM. That would allow prompt injection to exfiltrate or destroy data.',
      toAccessFullDb:
        'Use Supabase Dashboard SQL Editor or a private admin script with service_role on the server — never pass service_role to the browser or into the model context.',
    },
    ollama: {
      url: OLLAMA_URL,
      defaultModel: OLLAMA_MODEL,
      temperature: Number.isFinite(OLLAMA_TEMPERATURE) ? OLLAMA_TEMPERATURE : 0.22,
    },
  });
});

app.get('/api/customer-ai/health', (_req, res) => {
  res.json({
    ok: true,
    ollamaUrl: OLLAMA_URL,
    model: OLLAMA_MODEL,
    temperature: Number.isFinite(CUSTOMER_AI_TEMPERATURE) ? CUSTOMER_AI_TEMPERATURE : 0.4,
    hasSupabaseConfig: Boolean(supabaseUrl && supabaseAnonKey),
  });
});

app.get('/api/customer-ai/capabilities', (_req, res) => {
  res.json({
    name: 'HealHub Customer AI bridge',
    version: '1',
    basePath: '/api/customer-ai',
    endpoints: [
      {
        method: 'GET',
        path: '/api/customer-ai/health',
        auth: false,
        description: 'Liveness + Ollama model, customer temperature, Supabase env presence.',
      },
      {
        method: 'GET',
        path: '/api/customer-ai/capabilities',
        auth: false,
        description: 'This contract JSON.',
      },
      {
        method: 'POST',
        path: '/api/customer-ai/chat',
        auth: 'Bearer <Supabase access_token>; user must have role=customer in public.users',
        description:
          'Loads allowlisted catalog + customer orders (RLS), injects as system prompt, calls Ollama /api/chat.',
      },
    ],
    chat: {
      method: 'POST',
      path: '/api/customer-ai/chat',
      headers: {
        Authorization: 'Bearer <access_token>',
        'Content-Type': 'application/json',
      },
      body: {
        messages: [{ role: 'user | assistant | system', content: 'string' }],
        model: 'optional string; defaults to OLLAMA_MODEL env',
      },
      response200: {
        message: { role: 'assistant', content: 'string' },
        model: 'string',
      },
      errors: [400, 401, 403, 502, 504],
    },
    securityModel: {
      supabase: 'Uses anon key + customer JWT. Row Level Security applies.',
      notSupported: 'Same as owner bridge — no arbitrary SQL or service role in the model.',
    },
    ollama: {
      url: OLLAMA_URL,
      defaultModel: OLLAMA_MODEL,
      temperature: Number.isFinite(CUSTOMER_AI_TEMPERATURE) ? CUSTOMER_AI_TEMPERATURE : 0.4,
    },
  });
});

app.post('/api/owner-ai/chat', async (req, res) => {
  if (!supabaseUrl || !supabaseAnonKey) {
    return res.status(500).json({
      error: 'Server missing SUPABASE_URL and SUPABASE_ANON_KEY (or VITE_* in .env)',
    });
  }

  const token = getBearer(req);
  if (!token) {
    return res.status(401).json({ error: 'Missing Authorization: Bearer <access_token>' });
  }

  const supabaseAuth = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const {
    data: { user },
    error: userErr,
  } = await supabaseAuth.auth.getUser(token);
  if (userErr || !user) {
    return res.status(401).json({ error: 'Invalid or expired session' });
  }

  const supabaseUser = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  const { data: row, error: roleErr } = await supabaseUser
    .from('users')
    .select('role')
    .eq('auth_user_id', user.id)
    .maybeSingle();

  if (roleErr) {
    console.error('[owner-ai] role query', roleErr);
    return res.status(403).json({ error: 'Could not verify role' });
  }
  if (row?.role !== 'owner') {
    return res.status(403).json({ error: 'Owner role required' });
  }

  const body = req.body as {
    messages?: Array<{ role: string; content: string }>;
    model?: string;
  };
  const rawMessages = body.messages;
  if (!Array.isArray(rawMessages) || rawMessages.length === 0) {
    return res.status(400).json({ error: 'Body must include a non-empty messages array' });
  }

  for (const m of rawMessages) {
    if (!m || typeof m.content !== 'string' || m.content.length > MAX_MESSAGE_CHARS) {
      return res.status(400).json({ error: 'Invalid message content' });
    }
    const role = String(m.role || '');
    if (!['system', 'user', 'assistant'].includes(role)) {
      return res.status(400).json({ error: `Invalid message role: ${role}` });
    }
  }

  const chatOnly = stripSystemMessages(rawMessages).map((m) => {
    if (m.role !== 'user') return m;
    return { ...m, content: normalizeOwnerUserText(m.content) };
  });
  if (chatOnly.length === 0) {
    return res.status(400).json({ error: 'Include at least one non-system message' });
  }

  const lastUser = getLastUserContent(chatOnly);
  const conversationContext = buildConversationContextForTools(chatOnly);

  let systemContent: string;
  try {
    const out = await runOwnerAiTools(supabaseUser, lastUser, conversationContext);
    systemContent = out.systemContent;
  } catch (e) {
    console.error('[owner-ai] runOwnerAiTools', e);
    return res.status(502).json({
      error: 'Could not load Supabase context for Owner AI',
      detail: e instanceof Error ? e.message : String(e),
    });
  }

  const messagesToLlm = [{ role: 'system' as const, content: systemContent }, ...chatOnly];

  for (const m of messagesToLlm) {
    if (m.content.length > MAX_MESSAGE_CHARS) {
      return res.status(400).json({ error: 'Message too long after injecting context' });
    }
  }

  const model = typeof body.model === 'string' && body.model.trim() ? body.model.trim() : OLLAMA_MODEL;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), OLLAMA_TIMEOUT_MS);

  try {
    const r = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: messagesToLlm,
        stream: false,
        options: {
          temperature: Number.isFinite(OLLAMA_TEMPERATURE) ? OLLAMA_TEMPERATURE : 0.22,
        },
      }),
      signal: controller.signal,
    });
    if (!r.ok) {
      const t = await r.text();
      return res.status(502).json({
        error: 'Ollama returned an error',
        detail: t.slice(0, 800),
      });
    }
    const data = (await r.json()) as { message?: { role?: string; content?: string }; model?: string };
    const raw = data?.message?.content ?? '';
    const content = formatOwnerAiReply(raw);
    return res.json({
      message: { role: 'assistant' as const, content },
      model: data.model ?? model,
    });
  } catch (e: unknown) {
    const err = e as { name?: string; message?: string };
    if (err?.name === 'AbortError') {
      return res.status(504).json({ error: 'Ollama request timed out' });
    }
    return res.status(502).json({
      error: 'Failed to reach Ollama. Is it running?',
      detail: err?.message ?? String(e),
    });
  } finally {
    clearTimeout(timeout);
  }
});

app.post('/api/customer-ai/chat', async (req, res) => {
  if (!supabaseUrl || !supabaseAnonKey) {
    return res.status(500).json({
      error: 'Server missing SUPABASE_URL and SUPABASE_ANON_KEY (or VITE_* in .env)',
    });
  }

  const token = getBearer(req);
  if (!token) {
    return res.status(401).json({ error: 'Missing Authorization: Bearer <access_token>' });
  }

  const supabaseAuth = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const {
    data: { user },
    error: userErr,
  } = await supabaseAuth.auth.getUser(token);
  if (userErr || !user) {
    return res.status(401).json({ error: 'Invalid or expired session' });
  }

  const supabaseUser = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  const { data: row, error: roleErr } = await supabaseUser
    .from('users')
    .select('role')
    .eq('auth_user_id', user.id)
    .maybeSingle();

  if (roleErr) {
    console.error('[customer-ai] role query', roleErr);
    return res.status(403).json({ error: 'Could not verify role' });
  }
  if (row?.role !== 'customer') {
    return res.status(403).json({ error: 'Customer role required' });
  }

  const body = req.body as {
    messages?: Array<{ role: string; content: string }>;
    model?: string;
  };
  const rawMessages = body.messages;
  if (!Array.isArray(rawMessages) || rawMessages.length === 0) {
    return res.status(400).json({ error: 'Body must include a non-empty messages array' });
  }

  for (const m of rawMessages) {
    if (!m || typeof m.content !== 'string' || m.content.length > MAX_MESSAGE_CHARS) {
      return res.status(400).json({ error: 'Invalid message content' });
    }
    const role = String(m.role || '');
    if (!['system', 'user', 'assistant'].includes(role)) {
      return res.status(400).json({ error: `Invalid message role: ${role}` });
    }
  }

  const chatOnly = stripSystemMessages(rawMessages);
  if (chatOnly.length === 0) {
    return res.status(400).json({ error: 'Include at least one non-system message' });
  }

  const lastUser = getLastUserContent(chatOnly);
  const conversationContext = buildConversationContextForTools(chatOnly);

  let systemContent: string;
  try {
    const out = await runCustomerAiTools(supabaseUser, lastUser, conversationContext);
    systemContent = out.systemContent;
  } catch (e) {
    console.error('[customer-ai] runCustomerAiTools', e);
    return res.status(502).json({
      error: 'Could not load Supabase context for Customer AI',
      detail: e instanceof Error ? e.message : String(e),
    });
  }

  const messagesToLlm = [{ role: 'system' as const, content: systemContent }, ...chatOnly];

  for (const m of messagesToLlm) {
    if (m.content.length > MAX_MESSAGE_CHARS) {
      return res.status(400).json({ error: 'Message too long after injecting context' });
    }
  }

  const model = typeof body.model === 'string' && body.model.trim() ? body.model.trim() : OLLAMA_MODEL;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), OLLAMA_TIMEOUT_MS);

  try {
    const r = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: messagesToLlm,
        stream: false,
        options: {
          temperature: Number.isFinite(CUSTOMER_AI_TEMPERATURE) ? CUSTOMER_AI_TEMPERATURE : 0.4,
        },
      }),
      signal: controller.signal,
    });
    if (!r.ok) {
      const t = await r.text();
      return res.status(502).json({
        error: 'Ollama returned an error',
        detail: t.slice(0, 800),
      });
    }
    const data = (await r.json()) as { message?: { role?: string; content?: string }; model?: string };
    const raw = data?.message?.content ?? '';
    const content = formatCustomerAiReply(raw);
    return res.json({
      message: { role: 'assistant' as const, content },
      model: data.model ?? model,
    });
  } catch (e: unknown) {
    const err = e as { name?: string; message?: string };
    if (err?.name === 'AbortError') {
      return res.status(504).json({ error: 'Ollama request timed out' });
    }
    return res.status(502).json({
      error: 'Failed to reach Ollama. Is it running?',
      detail: err?.message ?? String(e),
    });
  } finally {
    clearTimeout(timeout);
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(
    `[ai-bridge] http://localhost:${PORT}  →  Ollama ${OLLAMA_URL}  model=${OLLAMA_MODEL}  owner_temp=${OLLAMA_TEMPERATURE}  customer_temp=${CUSTOMER_AI_TEMPERATURE}`,
  );
});
