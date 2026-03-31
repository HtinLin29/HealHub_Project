# HealHub — local dev & Expo Go

Default workflow: run the **Vite** app and **AI bridge** on your PC, open the site in the browser or in **Expo Go** (see `healhub-mobile`).

## AI bridge (Ollama) — Owner + Customer

From **`healhub`**:

1. **`npm run dev`** — Vite on port **5173** (`--host` allows LAN / Expo WebView).
2. **`npm run server:dev`** — Express on **8787**; Vite proxies **`/api/*`** here (`vite.config.ts`).
3. **Ollama** running (`OLLAMA_URL`, default `http://127.0.0.1:11434`).

Leave **`VITE_AI_BRIDGE_URL`** unset so the app uses same-origin **`/api/...`**.

- **Owner AI:** `POST /api/owner-ai/chat` — requires `role=owner`.
- **Customer AI:** `POST /api/customer-ai/chat` — requires `role=customer` (shopping assistant on customer pages when enabled).

Optional server env: `OLLAMA_MODEL`, `OLLAMA_TEMPERATURE`, `CUSTOMER_AI_TEMPERATURE`, `OWNER_AI_PORT`, `OLLAMA_TIMEOUT_MS`, customer limits in `server/README.md`. Frontend toggles: `VITE_ENABLE_OWNER_AI`, `VITE_ENABLE_CUSTOMER_AI`.

**Expo Go:** in `healhub-mobile/.env` set **`EXPO_PUBLIC_HEALHUB_URL=http://YOUR_PC_LAN_IP:5173`** (or leave unset so Expo picks the dev host where possible). Run Ollama + both commands above on the same PC.

## Environment variables (`healhub/.env`)

- **`VITE_SUPABASE_URL`**, **`VITE_SUPABASE_ANON_KEY`** — required.
- **`VITE_AI_BRIDGE_URL`** — optional; only if you deploy a static build and host the Express app elsewhere.

Do **not** put the Supabase **service role** key in frontend env vars.

## Optional: production build

- **`npm run build`** → **`dist/`**; **`npm run preview`** to test locally.
- If the static files are not served from the same origin as the API, set **`VITE_AI_BRIDGE_URL`** to your bridge’s https origin before building.

## Checklist

1. Supabase URL + anon key correct; RLS applied; `product-images` bucket exists; owner user in `public.users`.
2. Sign-in, owner routes, shop, checkout, and AI (with Ollama + `server:dev`) work locally.
