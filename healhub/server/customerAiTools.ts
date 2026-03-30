/**
 * Allowlisted Supabase reads for Customer AI (runs with customer JWT — RLS applies).
 */
import type { SupabaseClient } from '@supabase/supabase-js';

const CUSTOMER_AI_RECENT_ORDERS = Math.min(200, Math.max(8, Number(process.env.CUSTOMER_AI_RECENT_ORDERS_LIMIT || 40)));
const CUSTOMER_AI_PRODUCTS_LIMIT = Math.min(200, Math.max(20, Number(process.env.CUSTOMER_AI_PRODUCTS_LIMIT || 100)));
const CUSTOMER_AI_PAYLOAD_JSON_MAX = Number(process.env.CUSTOMER_AI_PAYLOAD_JSON_MAX || 8_800);
const DESC_MAX = 280;

function extractOrderIdFromText(raw: string): number | null {
  const m =
    raw.match(/\b(?:order\s*#?\s*|#)\s*(\d{1,12})\b/i)?.[1] ?? raw.match(/\border\s+(\d{1,12})\b/i)?.[1];
  if (!m) return null;
  const n = parseInt(m, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function extractOrderIdFromConversation(lastUser: string, conversationContext: string): number | null {
  return extractOrderIdFromText(lastUser) ?? extractOrderIdFromText(conversationContext);
}

function truncateDesc(s: string | null | undefined): string {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  if (t.length <= DESC_MAX) return t;
  return `${t.slice(0, DESC_MAX - 1)}…`;
}

function shrinkPayloadToLimit(base: Record<string, unknown>): Record<string, unknown> {
  let obj: Record<string, unknown> = { ...base };
  let json = JSON.stringify(obj);
  if (json.length <= CUSTOMER_AI_PAYLOAD_JSON_MAX) return obj;

  const fullProducts = Array.isArray(base.products) ? [...base.products] : [];
  let products = [...fullProducts];
  while (products.length > 5 && json.length > CUSTOMER_AI_PAYLOAD_JSON_MAX) {
    products = products.slice(0, Math.max(5, products.length - 10));
    obj = { ...obj, products, _truncated: true };
    json = JSON.stringify(obj);
  }

  if (json.length > CUSTOMER_AI_PAYLOAD_JSON_MAX && products.length > 0) {
    products = products.map((p: Record<string, unknown>) => ({
      id: p.id,
      name: p.name,
      category: p.category,
      price: p.price,
      stock: p.stock,
    }));
    obj = { ...obj, products, _truncated: true };
    json = JSON.stringify(obj);
  }

  if (json.length > CUSTOMER_AI_PAYLOAD_JSON_MAX) {
    obj = {
      generatedAt: base.generatedAt,
      source: base.source,
      notice: 'Catalog shortened for context limits; suggest browsing /shop.',
      products: (products as unknown[]).slice(0, 12),
      myOrders: base.myOrders,
      focusedOrder: base.focusedOrder,
    };
  }

  return obj;
}

const PERSONA_AND_RULES = [
  'You are a helpful virtual shopping assistant for HealHub, a mobile e-commerce platform for healthcare products.',
  'Your goal is to provide customers with friendly, accurate, and concise responses.',
  'You can answer questions about products, recommend items, track orders, explain delivery times, and guide users in using the app.',
  '',
  'Rules:',
  '1. Product recommendations: Suggest 1–3 relevant products from the HealHubData.products list when possible. Give a short description each using only facts from the data.',
  '2. Product information: Answer price, stock, usage, or benefits from HealHubData only. If a product is not in the list or stock is 0, say so politely.',
  '3. Order tracking: Use HealHubData.myOrders and focusedOrder when present. Never output literal placeholders like [ORDER_STATUS] or [DELIVERY_DATE] — use the actual status and dates from the data.',
  '4. Shopping guidance: Explain how to use My Orders, Shop, categories, cart, etc., in plain language.',
  '5. Tone: Friendly, polite, easy to read. Avoid long paragraphs.',
  '6. Fallback: If unclear, ask a short clarifying question or suggest possible actions.',
  '',
  'HealHub specifics:',
  '- Prices are Thai Baht: use ฿XXX.XX (never assume US dollars).',
  '- Only state product or order facts that appear in HealHubData. If missing, say you do not see it here and suggest opening My Orders or the product page.',
  '- Payment pipeline is order.status; shipment progress may appear as delivery_status in the data — you may mention both briefly when helpful.',
  '',
  'Example tone (adapt names/prices to real data):',
  'Customer: I want vitamins for energy.',
  'Assistant: Here are a few options from our catalog: …',
].join('\n');

export async function runCustomerAiTools(
  supabase: SupabaseClient,
  lastUserText: string,
  conversationContext: string,
): Promise<{ systemContent: string }> {
  const orderIdHint = extractOrderIdFromConversation(lastUserText, conversationContext);

  const [productsRes, ordersRes] = await Promise.all([
    supabase
      .from('products')
      .select('id, name, category, description, price, stock')
      .eq('is_active', true)
      .order('id', { ascending: false })
      .limit(CUSTOMER_AI_PRODUCTS_LIMIT),
    supabase
      .from('orders')
      .select('id, total_price, status, delivery_status, tracking_id, courier_provider, created_at')
      .order('id', { ascending: false })
      .limit(CUSTOMER_AI_RECENT_ORDERS),
  ]);

  if (productsRes.error) throw productsRes.error;
  if (ordersRes.error) throw ordersRes.error;

  let focusedRow: Record<string, unknown> | null = null;
  if (orderIdHint) {
    const fr = await supabase
      .from('orders')
      .select('id, total_price, status, delivery_status, tracking_id, courier_provider, created_at')
      .eq('id', orderIdHint)
      .maybeSingle();
    if (fr.error) throw fr.error;
    focusedRow = fr.data as Record<string, unknown> | null;
  }

  const products = (productsRes.data ?? []).map((row: Record<string, unknown>) => ({
    id: Number(row.id),
    name: String(row.name ?? ''),
    category: row.category != null ? String(row.category) : null,
    description: truncateDesc(row.description as string | null),
    price: Number(row.price ?? 0),
    stock: Number(row.stock ?? 0),
  }));

  const myOrders = (ordersRes.data ?? []).map((row: Record<string, unknown>) => ({
    id: Number(row.id),
    total: Number(row.total_price ?? 0),
    status: String(row.status ?? 'pending'),
    delivery_status: String(row.delivery_status ?? 'pending'),
    tracking_id: row.tracking_id ?? null,
    courier_provider: row.courier_provider ?? null,
    created_at: row.created_at ?? null,
  }));

  let focusedOrder: Record<string, unknown> | null = null;
  if (focusedRow) {
    focusedOrder = {
      id: Number(focusedRow.id),
      total: Number(focusedRow.total_price ?? 0),
      status: String(focusedRow.status ?? 'pending'),
      delivery_status: String(focusedRow.delivery_status ?? 'pending'),
      tracking_id: focusedRow.tracking_id ?? null,
      courier_provider: focusedRow.courier_provider ?? null,
      created_at: focusedRow.created_at ?? null,
    };
  }

  const payload = shrinkPayloadToLimit({
    generatedAt: new Date().toISOString(),
    source: 'supabase',
    products,
    myOrders,
    focusedOrder,
  });

  const dataBlock = JSON.stringify(payload);
  const systemContent = [PERSONA_AND_RULES, '', 'HealHubData (JSON):', dataBlock].join('\n');

  return { systemContent };
}
