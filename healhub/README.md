# HealHub

HealHub is a healthcare e-commerce MVP built with:
- React + TypeScript + Vite
- TailwindCSS
- Supabase (database, auth, storage)
- Chart.js

## Scripts
- `npm run dev` — local development
- `npm run build` — production build
- `npm run preview` — preview production build locally

## Environment variables
Create a `.env` file with:

```env
VITE_SUPABASE_URL=https://your-project-id.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-public-key
```

Required files:
- `.env.example`
- `DEPLOYMENT.md`

## Current capabilities
- product catalog with categories/descriptions/images
- owner dashboard and reports
- inventory management
- cart and checkout flow
- order + order_items model
- Supabase auth and protected routes
- storage-backed product images
- **Customer shopping assistant** (Ollama): ask about products and your orders — run `npm run server:dev` + Ollama (`DEPLOYMENT.md`). Toggle with `VITE_ENABLE_CUSTOMER_AI`.

## Deployment
Local development and **Expo Go** are documented in `DEPLOYMENT.md` (Vite + `server:dev` + Ollama).
