/**
 * Owner/Customer AI calls the Express bridge (`healhub/server`).
 * - Local dev: leave `VITE_AI_BRIDGE_URL` unset → same-origin `/api/...` (Vite proxies to server:dev).
 * - Production: set to the bridge’s public origin (https, no trailing slash), e.g. Railway/Render URL.
 */
export function getAiBridgeOrigin(): string {
  const v = import.meta.env.VITE_AI_BRIDGE_URL;
  if (typeof v !== 'string' || !v.trim()) return '';
  return v.trim().replace(/\/$/, '');
}

export function ownerAiChatEndpoint(): string {
  const o = getAiBridgeOrigin();
  return o ? `${o}/api/owner-ai/chat` : '/api/owner-ai/chat';
}

export function customerAiChatEndpoint(): string {
  const o = getAiBridgeOrigin();
  return o ? `${o}/api/customer-ai/chat` : '/api/customer-ai/chat';
}
