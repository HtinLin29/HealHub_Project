/**
 * Owner/Customer AI calls the Express bridge (`healhub/server`).
 * - Local dev: leave `VITE_AI_BRIDGE_URL` unset → same-origin `/api/...` (Vite proxies to server:dev).
 * - Production: `VITE_AI_BRIDGE_URL` in `.env.production` or host env, or fallback below when the SPA
 *   is not served from a local/LAN host (static hosts have no `/api`, so relative URLs 404).
 */
const DEFAULT_PROD_BRIDGE_ORIGIN = 'https://healhubpharamacy-production.up.railway.app';

function isLocalOrLanHostname(hostname: string): boolean {
  if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '10.0.2.2') return true;
  if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(hostname)) return true;
  if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname)) return true;
  return false;
}

export function getAiBridgeOrigin(): string {
  const v = import.meta.env.VITE_AI_BRIDGE_URL;
  if (typeof v === 'string' && v.trim()) return v.trim().replace(/\/$/, '');

  if (import.meta.env.DEV) return '';

  if (typeof window !== 'undefined' && isLocalOrLanHostname(window.location.hostname)) return '';

  if (import.meta.env.PROD) return DEFAULT_PROD_BRIDGE_ORIGIN.replace(/\/$/, '');

  return '';
}

export function ownerAiChatEndpoint(): string {
  const o = getAiBridgeOrigin();
  return o ? `${o}/api/owner-ai/chat` : '/api/owner-ai/chat';
}

export function customerAiChatEndpoint(): string {
  const o = getAiBridgeOrigin();
  return o ? `${o}/api/customer-ai/chat` : '/api/customer-ai/chat';
}
