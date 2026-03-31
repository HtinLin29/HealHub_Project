# HealHub Deployment Checklist

## Platform
Recommended: **Vercel** for the frontend.

## AI bridge (Ollama) — Owner + Customer
Local dev: run **`npm run server:dev`** in `healhub` (Express on port **8787** by default). The Vite dev server proxies **`/api/*`** to that process (see `vite.config.ts`). **Ollama** must be running locally (`OLLAMA_URL`, default `http://127.0.0.1:11434`).

- **Owner AI:** `POST /api/owner-ai/chat` — requires `role=owner`. See optional env vars below for owner tuning.
- **Customer AI:** `POST /api/customer-ai/chat` — requires `role=customer`. Floating **Shopping assistant** on customer pages (when `VITE_ENABLE_CUSTOMER_AI` is not false). Injects allowlisted **product catalog** + **your orders** (RLS). Slightly higher default temperature for friendlier tone.

Shared optional env vars:

- `OLLAMA_MODEL` — default `llama3.2`
- `OLLAMA_TEMPERATURE` — default `0.22` (owner; lower = more factual)
- `CUSTOMER_AI_TEMPERATURE` — default `0.4` (customer shopping assistant)
- `OWNER_AI_PORT` — default `8787`
- `OLLAMA_TIMEOUT_MS` — default `120000`

Customer-only (optional):

- `CUSTOMER_AI_RECENT_ORDERS_LIMIT` — default `40`
- `CUSTOMER_AI_PRODUCTS_LIMIT` — default `100`
- `CUSTOMER_AI_PAYLOAD_JSON_MAX` — default `8800`

Frontend flags (optional):

- `VITE_ENABLE_OWNER_AI` — default on if unset
- `VITE_ENABLE_CUSTOMER_AI` — default on if unset

Production (Vercel + phone): the static site has **no** `/api` proxy. Set **`VITE_AI_BRIDGE_URL`** on Vercel to the **https origin** of your hosted Express bridge (no trailing slash). Deploy **`healhub/server`** on Railway, Render, Fly.io, a VPS, etc. with **`SUPABASE_URL`** / **`SUPABASE_ANON_KEY`**, **`OLLAMA_URL`** (must be reachable from that host), and **`OWNER_AI_CORS_ORIGIN`** (e.g. `https://your-app.vercel.app` or comma-separated list). Then **redeploy Vercel** so the new env is baked into the build.

Local dev: leave **`VITE_AI_BRIDGE_URL`** unset; run **`npm run server:dev`** and use the Vite proxy. Set **`OWNER_AI_CORS_ORIGIN`** on the bridge only when you want to restrict browser origins.

The Owner AI only performs **allowlisted read queries** (no arbitrary SQL, no writes). It uses the **same Supabase session as the owner** (RLS applies). If `patientsSample` is always empty in the AI but CRM shows patients, add an RLS policy allowing **owners** to `SELECT` `customer_patients` (or keep using the existing app behavior).

Customer AI uses the same security model with the **customer** JWT: only catalog + orders visible under RLS.

## Required environment variables
Set these in your deployment platform:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

Optional for **Owner/Customer AI** on the live site:

- `VITE_AI_BRIDGE_URL` — https origin of the hosted `server` (see above)

Do **not** use the service role key in frontend environment variables.

## Build settings
- Install command: `npm install`
- Build command: `npm run build`
- Output directory: `dist`

## Do **not** use this (wrong tool)
`npx plugins add vercel/vercel-plugin` is **not** for deploying HealHub. It installs an editor “plugins” helper and fails with *No supported targets detected* if `claude`/`cursor` binaries are not on your PATH.

**Deploy instead:**
1. **[vercel.com](https://vercel.com)** → import your **GitHub** repo → set **Root Directory** to `healhub`, add env vars, **Deploy**; or  
2. From `healhub`: `npx vercel` (Vercel CLI — you must be logged in).

## Before deploying
1. Confirm Supabase project URL and anon key are correct.
2. Confirm RLS policies are applied.
3. Confirm `product-images` bucket exists.
4. Confirm at least one owner user exists in `public.users` with role `owner`.
5. Test sign in, owner access, shop access, cart, and checkout locally.

## After deploying
1. Verify homepage loads.
2. Verify `/login` works.
3. Verify owner account can access `/owner`.
4. Verify customer account is blocked from owner-only pages.
5. Verify shop images load from Supabase Storage.
6. Verify checkout creates `orders` and `order_items`.
7. Verify order status changes affect stock as expected.

## Rollback
If a deployment breaks:
- restore the previous Vercel deployment
- re-check environment variables
- re-check Supabase RLS/policies
