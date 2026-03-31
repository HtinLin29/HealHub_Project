/**
 * Owner/Customer AI calls the Express bridge (`healhub/server`).
 * - Local / Expo Go: leave `VITE_AI_BRIDGE_URL` unset → same-origin `/api/...` (Vite proxies to `server:dev`).
 * - Optional hosted static app: set `VITE_AI_BRIDGE_URL` to the bridge’s https origin (no trailing slash).
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
