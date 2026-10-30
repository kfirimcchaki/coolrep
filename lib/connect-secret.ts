/**
 * Shared HS256 secret for the bundled Null's Connect mock provider.
 * The real provider signs with RS256 and is verified through CONNECT_JWKS_URL.
 */
export const DEFAULT_MOCK_CONNECT_SECRET = 'nt-scripting-local-mock-connect-secret';

export function mockConnectSecret(): string {
  return process.env.CONNECT_JWT_SECRET || DEFAULT_MOCK_CONNECT_SECRET;
}

/** True when the built-in provider (not connect.nulls.gg) issues the tokens. */
export function usingMockProvider(): boolean {
  if (process.env.CONNECT_JWT_SECRET) return true;
  return process.env.CONNECT_MOCK !== '0';
}
