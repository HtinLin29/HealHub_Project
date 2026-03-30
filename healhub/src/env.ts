/**
 * Vite exposes env as strings at build/dev start. Be tolerant of whitespace / quotes.
 */
export function readViteBool(key: string): boolean {
  const raw = (import.meta.env as Record<string, string | undefined>)[key];
  const s = String(raw ?? '')
    .trim()
    .replace(/^["']|["']$/g, '')
    .toLowerCase();
  if (s === '' || s === 'undefined' || s === 'null') return false;
  if (s === 'false' || s === '0' || s === 'no' || s === 'off') return false;
  return s === 'true' || s === '1' || s === 'yes' || s === 'on';
}

/** When the var is missing, treat as enabled so Owner AI is visible without extra setup. */
export function readOwnerAiFeatureEnabled(): boolean {
  const raw = (import.meta.env as Record<string, string | undefined>).VITE_ENABLE_OWNER_AI;
  if (raw === undefined || String(raw).trim() === '') return true;
  return readViteBool('VITE_ENABLE_OWNER_AI');
}

/** When unset, Customer AI (shop assistant) is enabled — same Ollama bridge as owner (`npm run server:dev`). */
export function readCustomerAiFeatureEnabled(): boolean {
  const raw = (import.meta.env as Record<string, string | undefined>).VITE_ENABLE_CUSTOMER_AI;
  if (raw === undefined || String(raw).trim() === '') return true;
  return readViteBool('VITE_ENABLE_CUSTOMER_AI');
}
