import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AppRouterProvider, type AppLinkProps, type AppNav } from '../lib/app-router';
import { api } from '../lib/api-client';
import type { PublicUser } from '../lib/types';

/**
 * Client-side router for the static GitHub Pages build.
 *
 * GitHub Pages serves `404.html` for unknown paths, and that file boots this
 * SPA — so deep links such as `/scripts/<uuid>` work with their real URLs
 * while every screen is rendered on the client.
 */

export const BASE: string =
  (typeof window !== 'undefined' && (window as unknown as { __NT_BASE__?: string }).__NT_BASE__) || '';

export function stripBase(pathname: string): string {
  let path = pathname;
  if (BASE && path.startsWith(BASE)) path = path.slice(BASE.length);
  if (!path.startsWith('/')) path = `/${path}`;
  if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);
  return path || '/';
}

export function toHref(path: string): string {
  return `${BASE}${path}`;
}

/** Route key for a URL: base path stripped, query/hash removed. */
export function routeKey(href: string): string {
  try {
    return stripBase(new URL(href, window.location.origin).pathname);
  } catch {
    return stripBase(href.split(/[?#]/)[0]);
  }
}

export interface RouterState {
  path: string;
  navigate(path: string, options?: { replace?: boolean }): void;
  refresh(): void;
}

const RouterContext = createContext<RouterState | null>(null);

export function useRouterState(): RouterState {
  const value = useContext(RouterContext);
  if (!value) throw new Error('Router missing');
  return value;
}

export function StaticRouterProvider({ children }: { children: ReactNode }) {
  const [path, setPath] = useState(() => routeKey(window.location.href));
  const [tick, setTick] = useState(0);

  const navigate = useCallback((next: string, options?: { replace?: boolean }) => {
    const href = toHref(next);
    if (options?.replace) window.history.replaceState({}, '', href);
    else window.history.pushState({}, '', href);
    setPath(routeKey(href));
    try {
      window.scrollTo({ top: 0 });
    } catch {
      /* not implemented in every environment */
    }
  }, []);

  useEffect(() => {
    const onPop = () => setPath(routeKey(window.location.href));
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const nav = useMemo<AppNav>(
    () => ({
      pathname: path,
      push: (next: string) => navigate(next),
      replace: (next: string) => navigate(next, { replace: true }),
      refresh: () => setTick((value) => value + 1),
    }),
    [navigate, path],
  );

  const Link = useMemo(() => {
    const StaticLink = ({ href, children, onClick, ...rest }: AppLinkProps) => {
      const external = /^(https?:|mailto:|nullsbrawl:)/i.test(href) || href.startsWith('#');
      if (external) {
        return (
          <a href={href} {...rest} onClick={onClick as never}>
            {children}
          </a>
        );
      }
      return (
        <a
          href={toHref(href)}
          {...rest}
          onClick={(event) => {
            onClick?.(event as never);
            if (event.defaultPrevented) return;
            if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
            event.preventDefault();
            navigate(href);
          }}
        >
          {children}
        </a>
      );
    };
    return StaticLink;
  }, [navigate]);

  return (
    <RouterContext.Provider value={{ path, navigate, refresh: () => setTick((value) => value + 1) }}>
      <AppRouterProvider value={{ nav, Link }}>
        <div data-route-tick={tick}>{children}</div>
      </AppRouterProvider>
    </RouterContext.Provider>
  );
}

/* ------------------------------------------------------------------ */
/* Data fetching                                                       */
/* ------------------------------------------------------------------ */

export interface ApiState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  reload: () => void;
}

export function useApi<T>(path: string | null, deps: unknown[] = []): ApiState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(Boolean(path));
  const [nonce, setNonce] = useState(0);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (!path) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    api<T>(path)
      .then((result) => {
        if (!mounted.current) return;
        if (!result.ok) {
          setError((result.data as { error?: string } | null)?.error ?? `Request failed (${result.status})`);
          setData(null);
        } else {
          setData(result.data);
        }
      })
      .catch(() => mounted.current && setError('Network error'))
      .finally(() => mounted.current && setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, nonce, ...deps]);

  return { data, error, loading, reload: () => setNonce((value) => value + 1) };
}

export function useSession(): {
  user: PublicUser | null;
  loading: boolean;
  reload: () => void;
} {
  const { path } = useRouterState();
  const { data, loading, reload } = useApi<{ user: PublicUser | null }>('/api/auth/session', [path]);
  return { user: data?.user ?? null, loading, reload };
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  return new Date(value).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatDay(value: string | null | undefined): string {
  if (!value) return 'Draft';
  return new Date(value).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}
