'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ScriptListItem } from '../../lib/types';
import ScriptCard from './ScriptCard';

type Sort = 'recent' | 'updated' | 'name';

export default function ScriptsBrowser() {
  const router = useRouter();
  const [scripts, setScripts] = useState<ScriptListItem[] | null>(null);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<Sort>('recent');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      const params = new URLSearchParams({ limit: '60', sort });
      if (search.trim()) params.set('search', search.trim());
      const response = await fetch(`/api/scripts?${params.toString()}`, {
        credentials: 'same-origin',
        signal,
      });
      if (response.status === 401) {
        router.replace(`/login?return_to=${encodeURIComponent('/scripts')}`);
        return;
      }
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? `Request failed (${response.status})`);
      setScripts(payload.scripts as ScriptListItem[]);
      setTotal(payload.total ?? 0);
    },
    [router, search, sort],
  );

  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      load(controller.signal).catch((cause) => {
        if (controller.signal.aborted) return;
        setError(cause.message ?? 'Failed to load scripts');
        setScripts([]);
      });
    }, 180);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [load]);

  const countLabel = useMemo(() => {
    if (scripts === null) return '';
    return `${total} script${total === 1 ? '' : 's'}`;
  }, [scripts, total]);

  if (scripts === null && !error) {
    return (
      <div className="loading-screen" style={{ minHeight: '40vh' }}>
        Loading...
      </div>
    );
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Scripts</h1>
          <p className="page-sub">Community scripts for friendly battles · {countLabel}</p>
        </div>
        <div className="toolbar">
          <div className="search">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden>
              <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="1.8" />
              <path d="M16.5 16.5L21 21" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
            <input
              placeholder="Search scripts…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              aria-label="Search scripts"
            />
          </div>
          <select
            className="input"
            style={{ width: 'auto', padding: '9px 12px' }}
            value={sort}
            onChange={(event) => setSort(event.target.value as Sort)}
            aria-label="Sort scripts"
          >
            <option value="recent">Newest</option>
            <option value="updated">Recently updated</option>
            <option value="name">Name</option>
          </select>
          <Link className="btn btn-primary" href="/scripts/new">
            <span aria-hidden>＋</span> New script
          </Link>
        </div>
      </div>

      {error ? <div className="form-error">{error}</div> : null}

      {scripts && scripts.length === 0 ? (
        <div className="empty">
          No scripts yet. <Link href="/scripts/new" style={{ color: 'var(--accent)' }}>Create the first one</Link>.
        </div>
      ) : (
        <div className="card-grid">
          {scripts?.map((script) => (
            <ScriptCard key={script.script_id} script={script} canInteract />
          ))}
        </div>
      )}
    </>
  );
}
