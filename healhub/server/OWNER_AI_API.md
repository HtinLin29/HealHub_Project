# Owner AI bridge — exact HTTP API

Base URL: `http://127.0.0.1:8787` (or `OWNER_AI_PORT` / `PORT`).  
Vite dev proxies `/api/owner-ai/*` from the app to this server.

---

## `GET /api/owner-ai/health`

**Auth:** none  

**Response 200 JSON:**

```json
{
  "ok": true,
  "ollamaUrl": "http://127.0.0.1:11434",
  "model": "llama3.2",
  "temperature": 0.22,
  "hasSupabaseConfig": true
}
```

---

## `GET /api/owner-ai/capabilities`

**Auth:** none  

**Response 200 JSON:** machine-readable contract (same fields as `capabilities` in code). See `server/index.ts` — includes `chat`, `securityModel`, `endpoints`.

---

## `POST /api/owner-ai/chat`

**Auth:** required  

- Header: `Authorization: Bearer <Supabase access_token>`  
- The user must exist in `public.users` with **`role = 'owner'`** (matched via `auth_user_id`).

**Headers:**

| Header | Value |
|--------|--------|
| `Authorization` | `Bearer <access_token>` |
| `Content-Type` | `application/json` |

**Body JSON:**

```json
{
  "messages": [
    { "role": "user", "content": "What is total inventory value?" },
    { "role": "assistant", "content": "..." }
  ],
  "model": "optional — overrides OLLAMA_MODEL"
}
```

- `messages`: non-empty array. Each item: `role` ∈ `user` | `assistant` | `system`, `content` string (max **12 000** characters per message).
- `system` messages are stripped before sending to the model; the server injects its own system message with Supabase snapshot.

**Response 200 JSON:**

```json
{
  "message": {
    "role": "assistant",
    "content": "string reply from Ollama"
  },
  "model": "string (model used)"
}
```

**Error responses:**

| Status | Meaning |
|--------|--------|
| 400 | Bad body, invalid message role, message too long |
| 401 | Missing/invalid Bearer token |
| 403 | Not owner or role check failed |
| 502 | Supabase context failed, or Ollama error, or upstream |
| 504 | Ollama timeout (`OLLAMA_TIMEOUT_MS`) |

---

## Why there is no “full database access” for the AI

This API **never**:

- accepts arbitrary SQL,
- uses the **service role** key,
- bypasses **Row Level Security**,
- or lets the model choose tables/columns freely.

Doing so would let **prompt injection** (e.g. hidden instructions in data) exfiltrate or modify data.

**What it does instead:** server-side code in `ownerAiTools.ts` runs **allowlisted** `select` queries with the **owner’s JWT** (same as the app). The model only sees JSON you put in the prompt.

**If you need “full DB”** for administration: use **Supabase Dashboard → SQL**, or a **private** server script with `service_role` stored only on the server — **not** in Vite env, not in chat, not in the LLM context.

---

## Environment variables (server)

| Variable | Purpose |
|----------|--------|
| `SUPABASE_URL` or `VITE_SUPABASE_URL` | Supabase project URL |
| `SUPABASE_ANON_KEY` or `VITE_SUPABASE_ANON_KEY` | Anon key (not service role) |
| `OLLAMA_URL` | Default `http://127.0.0.1:11434` |
| `OLLAMA_MODEL` | Default `llama3.2` |
| `OLLAMA_TEMPERATURE` | Default `0.22` |
| `OLLAMA_TIMEOUT_MS` | Default `120000` |
| `OWNER_AI_PORT` / `PORT` | Default `8787` |
| `OWNER_AI_CORS_ORIGIN` | CORS origin if needed |

---

## Data shape (implementation)

Snapshot + tools are built in `server/ownerAiTools.ts` (`runOwnerAiTools`, `fetchAnalyticsSnapshot`). Not duplicated here — use `/api/owner-ai/capabilities` + source for the exact live fields.
