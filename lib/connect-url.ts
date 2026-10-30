/**
 * Isomorphic helpers for the Null's Connect authorize redirect.
 * Kept free of node: imports so it can be used from middleware (edge runtime).
 */

export const OAUTH_STATE_COOKIE = 'nts_oauth_state';

export function appUrl(fallbackOrigin?: string): string {
  const configured = process.env.APP_URL?.replace(/\/$/, '');
  if (configured) return configured;
  return (fallbackOrigin ?? 'http://localhost:3000').replace(/\/$/, '');
}

export function authorizeBaseUrl(origin?: string): string {
  if (process.env.CONNECT_AUTHORIZE_URL) return process.env.CONNECT_AUTHORIZE_URL;
  // Out of the box the platform talks to its bundled provider so the whole
  // login flow works offline. Set CONNECT_MOCK=0 to talk to the real one.
  if (process.env.CONNECT_MOCK === '0') return 'https://connect.nulls.gg/authorize';
  return `${appUrl(origin)}/mock-connect/authorize`;
}

export function buildAuthorizeUrl(returnTo: string, state: string, origin?: string): string {
  const url = new URL(authorizeBaseUrl(origin));
  url.searchParams.set('scope', 'openid email');
  url.searchParams.set('response_type', 'id_token');
  url.searchParams.set('redirect_uri', `${appUrl(origin)}/connect`);
  url.searchParams.set('client_id', process.env.CONNECT_CLIENT_ID || '9');
  url.searchParams.set('state', state);
  url.hash = `#${encodeURIComponent(returnTo)}`;
  return url.toString();
}

export function randomState(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}
