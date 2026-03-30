# AI bridge (Ollama) — Owner + Customer

The **Owner AI** floating button is controlled by `VITE_ENABLE_OWNER_AI` in `healhub/.env` (default on if unset). **Customer AI** (`VITE_ENABLE_CUSTOMER_AI`) adds the **Shopping assistant** on customer pages; same `npm run server:dev` process exposes `POST /api/customer-ai/chat` (requires `role=customer`).

```env
VITE_ENABLE_OWNER_AI=true
```

Then restart `npm run dev`.

This **Express** server serves two chat endpoints:

**Owner** (`POST /api/owner-ai/chat`):

1. Verifies the Supabase **Bearer** token and **`users.role === 'owner'`**
2. Loads **allowlisted Supabase context** in [`ownerAiTools.ts`](./ownerAiTools.ts): store-wide analytics snapshot plus optional tools from the **last user message** (order detail, orders in range, customer summary when appropriate).
3. Injects that JSON as the **system** message, then forwards user/assistant history to **Ollama** at `OLLAMA_URL` (`/api/chat`).

**Customer** (`POST /api/customer-ai/chat`):

1. Requires **`users.role === 'customer'`**
2. Loads **allowlisted** active **products** + the customer’s **recent orders** in [`customerAiTools.ts`](./customerAiTools.ts), then calls Ollama with your shopping-assistant persona in the system prompt.

The browser sends **only** user + assistant messages (no client-built giant snapshot).

## Run

From the **healhub** folder (same as `package.json`):

```bash
npm run server:dev
```

Default: `http://0.0.0.0:8787`

With **Vite** (`npm run dev`), the app proxies `/api/*` to this server (see `vite.config.ts`).

## Environment

Uses variables from **`healhub/.env`** (same file as `VITE_SUPABASE_*`):

| Variable | Default |
|----------|---------|
| `SUPABASE_URL` | falls back to `VITE_SUPABASE_URL` |
| `SUPABASE_ANON_KEY` | falls back to `VITE_SUPABASE_ANON_KEY` |
| `OLLAMA_URL` | `http://127.0.0.1:11434` |
| `OLLAMA_MODEL` | `llama3.2` (must match `ollama list`) |
| `OWNER_AI_PORT` | `8787` |

## Prerequisites

- **Ollama** installed and a model pulled, e.g. `ollama pull llama3.2`
- Supabase **RLS** must allow the signed-in user to read their row in `public.users` (same as the web app)

## Health checks

- `GET http://localhost:8787/api/owner-ai/health`
- `GET http://localhost:8787/api/customer-ai/health`

## Phone / LAN

The Vite dev server proxies `/api` to `127.0.0.1:8787` on the **same machine**. When you open the app from a phone, use your PC’s LAN IP for Vite; the proxy still runs on the PC.
