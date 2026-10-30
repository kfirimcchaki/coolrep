/**
 * Fetching script source from another site.
 *
 * Used by `POST /api/import/inspect` (and by the static build's in-browser
 * backend) to read the URL inside an invite document. The same guards run on
 * both sides, so the server route cannot be turned into an SSRF gadget:
 *
 *   - http(s) only;
 *   - loopback / private / link-local hosts refused (unless the caller itself is
 *     local, which keeps `localhost` development pleasant);
 *   - redirects re-checked against the same rules;
 *   - 8 s timeout, 1 MiB body cap.
 */

export class ImportFetchError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
    this.name = 'ImportFetchError';
  }
}

const MAX_BYTES = 1024 * 1024;
const TIMEOUT_MS = 8000;

function isPrivateHost(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost')) return true;
  if (host === '::1' || host === '0.0.0.0') return true;
  if (host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80')) return true;
  if (host.endsWith('.internal') || host === 'metadata.google.internal') return true;
  if (host === '169.254.169.254') return true;
  const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if (a === 10 || a === 127) return true;
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 169 && b === 254) return true;
  }
  return false;
}

export function assertFetchableUrl(input: string, options: { allowLocal?: boolean } = {}): URL {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new ImportFetchError('The invite does not contain a valid URL');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new ImportFetchError('Only http(s) URLs can be imported');
  }
  if (isPrivateHost(url.hostname) && !options.allowLocal) {
    throw new ImportFetchError('That host is not reachable from here (private address)');
  }
  return url;
}

export interface FetchedScript {
  content: string;
  contentType: string;
  bytes: number;
  finalUrl: string;
  status: number;
}

/** Reads a content URL, unwrapping `{content}`/`{code}` JSON responses. */
export async function fetchScriptContent(
  input: string,
  options: { allowLocal?: boolean; signal?: AbortSignal } = {},
): Promise<FetchedScript> {
  const url = assertFetchableUrl(input, options);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const onAbort = () => controller.abort();
  options.signal?.addEventListener('abort', onAbort);

  try {
    let response: Response;
    try {
      response = await fetch(url, {
        headers: { accept: 'text/plain, application/json;q=0.9, */*;q=0.5' },
        redirect: 'follow',
        signal: controller.signal,
        cache: 'no-store',
      });
    } catch (error) {
      throw new ImportFetchError(
        controller.signal.aborted ? 'The other site took too long to answer' : 'Could not reach the script URL',
        502,
      );
    }

    if (response.url) assertFetchableUrl(response.url, options);
    if (!response.ok) {
      throw new ImportFetchError(`The other site answered ${response.status}`, 502);
    }

    const declared = Number(response.headers.get('content-length') ?? 0);
    if (declared > MAX_BYTES) throw new ImportFetchError('That script is larger than 1 MiB', 413);

    const text = await response.text();
    if (text.length > MAX_BYTES) throw new ImportFetchError('That script is larger than 1 MiB', 413);

    const contentType = response.headers.get('content-type') ?? 'text/plain';
    let content = text;

    if (contentType.includes('json')) {
      try {
        const payload = JSON.parse(text) as Record<string, unknown>;
        const candidate = payload.content ?? payload.code ?? payload.source ?? payload.script;
        if (typeof candidate === 'string') content = candidate;
      } catch {
        /* the site answered JSON-ish but not JSON — keep the raw body */
      }
    }

    return {
      content,
      contentType,
      bytes: content.length,
      finalUrl: response.url || url.toString(),
      status: response.status,
    };
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', onAbort);
  }
}
