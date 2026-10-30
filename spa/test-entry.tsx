/** Entry point used by `scripts/test-static.mjs` (bundled with esbuild). */
export { VirtualServer } from '../lib/virtual/server';
export { VirtualDatabase, MemoryStorage } from '../lib/virtual/db';
export {
  createGistStorage,
  emptyDocument,
  fetchGistDocument,
  flushGistSync,
  gistStatus,
  hydrateFromSharedStore,
  parseGistId,
  pushGistDocument,
  readGistConfig,
  writeGistConfig,
} from '../lib/virtual/gist-sync';
export {
  backendMode,
  getSessionToken,
  resolveApiBase,
  setStoredApiBase,
  useLocalBackend,
} from '../lib/api-client';
