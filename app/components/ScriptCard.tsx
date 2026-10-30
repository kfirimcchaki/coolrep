'use client';

import { Link, useNav } from '../../lib/app-router';
import { useState } from 'react';
import { apiFetch } from '../../lib/api-client';
import type { ScriptListItem } from '../../lib/types';

export function StarIcon({ filled }: { filled: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden>
      <path
        d="M12 3.6l2.6 5.5 6 .8-4.4 4.2 1.1 6-5.3-2.9-5.3 2.9 1.1-6L3.4 9.9l6-.8L12 3.6z"
        fill={filled ? 'currentColor' : 'none'}
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function FavoriteButton({
  scriptId,
  initial,
  canInteract,
  className = 'star',
}: {
  scriptId: string;
  initial: boolean;
  canInteract: boolean;
  className?: string;
}) {
  const [favorite, setFavorite] = useState(initial);
  const [busy, setBusy] = useState(false);
  const nav = useNav();

  async function toggle(event: React.MouseEvent) {
    event.preventDefault();
    event.stopPropagation();
    if (!canInteract || busy) return;
    setBusy(true);
    const next = !favorite;
    setFavorite(next);
    try {
      const response = await apiFetch(`/api/scripts/${scriptId}/favorite`, {
        method: next ? 'POST' : 'DELETE',
        credentials: 'same-origin',
      });
      if (!response.ok) {
        setFavorite(!next);
      } else {
        nav.refresh();
      }
    } catch {
      setFavorite(!next);
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      className={`${className}${favorite ? ' on' : ''}`}
      onClick={toggle}
      aria-label={favorite ? 'Remove from favorites' : 'Add to favorites'}
      title={
        canInteract
          ? favorite
            ? 'Remove from favorites'
            : 'Add to favorites'
          : 'Log in to favorite scripts'
      }
      type="button"
    >
      <StarIcon filled={favorite} />
    </button>
  );
}

export default function ScriptCard({
  script,
  canInteract,
}: {
  script: ScriptListItem;
  canInteract: boolean;
}) {
  const published = script.published_at
    ? new Date(script.published_at).toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      })
    : 'Draft';

  return (
    <Link href={`/scripts/${script.script_id}`} className="card">
      <div className="card-head">
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="card-title">{script.name}</div>
          <div className="tiny muted" style={{ marginTop: 3 }}>
            by {script.author_name}
          </div>
        </div>
        <FavoriteButton scriptId={script.script_id} initial={script.is_favorite} canInteract={canInteract} />
      </div>

      {script.description ? (
        <p className="card-desc">{script.description}</p>
      ) : (
        <p className="card-desc" style={{ opacity: 0.45 }}>
          No description
        </p>
      )}

      <div className="card-foot">
        <span className={script.published_at ? 'pill pill-success' : 'pill pill-warn'}>
          {script.published_at ? 'Published' : 'Draft'}
        </span>
        <span>{published}</span>
      </div>
    </Link>
  );
}
