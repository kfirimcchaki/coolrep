'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../../lib/api-client';

export interface InviteResponse {
  realm: string;
  script: string;
  bp: number[];
  payload: string;
  invite_b64: string;
  invite_url: string;
  deep_link: string;
  token: string;
  content_url: string;
  script_id: string;
  revision_id: number;
  name: string;
  expires_at: string | null;
  created_at: string | null;
}

const REALM_OPTIONS = ['experiment:scripts', 'scripts', 'experiment:maps'];

async function copyText(value: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    try {
      const area = document.createElement('textarea');
      area.value = value;
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand('copy');
      area.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

function Row({
  label,
  value,
  mono = true,
  lines,
}: {
  label: string;
  value: string;
  mono?: boolean;
  lines?: number;
}) {
  const [copied, setCopied] = useState(false);

  return (
    <div style={{ marginBottom: 10 }}>
      <div className="tiny muted" style={{ marginBottom: 4 }}>
        {label}
      </div>
      <div className="copy-row">
        {lines ? (
          <textarea
            className="input"
            readOnly
            rows={lines}
            value={value}
            onFocus={(event) => event.currentTarget.select()}
            style={{ fontFamily: mono ? 'var(--mono, monospace)' : undefined, resize: 'vertical' }}
          />
        ) : (
          <input
            className="input"
            readOnly
            value={value}
            onFocus={(event) => event.currentTarget.select()}
            style={{ fontFamily: mono ? 'var(--mono, monospace)' : undefined }}
          />
        )}
        <button
          className="btn btn-sm"
          type="button"
          onClick={async () => {
            const ok = await copyText(value);
            setCopied(ok);
            setTimeout(() => setCopied(false), 1600);
          }}
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
    </div>
  );
}

/**
 * "Invite to a friendly battle" panel.
 *
 * Mints a content token and shows the three artefacts that matter:
 *   - the invite document the game client reads (`{realm, script, bp}`),
 *   - the content URL it points at (served by this deployment),
 *   - links that open the invite here or in another install of this site.
 *
 * Shared by the Next.js page and the static SPA — `apiFetch` picks the
 * transport, so the same button works against a Node server, the in-browser
 * backend and a remote deployment alike.
 */
export default function InviteButton({ scriptId }: { scriptId: string }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [invite, setInvite] = useState<InviteResponse | null>(null);
  const [realm, setRealm] = useState(REALM_OPTIONS[0]);
  const [ttl, setTtl] = useState(15);

  const mint = useCallback(
    async (options: { realm?: string; ttlMinutes?: number } = {}) => {
      setBusy(true);
      setError(null);
      try {
        const response = await apiFetch(`/api/scripts/${scriptId}/invite`, {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            realm: options.realm ?? realm,
            expires_in: Math.round((options.ttlMinutes ?? ttl) * 60),
          }),
        });
        const payload = (await response.json().catch(() => ({}))) as Partial<InviteResponse> & { error?: string };
        if (!response.ok) {
          setError(payload.error ?? `Could not create an invite (${response.status})`);
          setInvite(null);
          return;
        }
        setInvite(payload as InviteResponse);
      } catch {
        setError('Network error — please try again');
      } finally {
        setBusy(false);
      }
    },
    [realm, scriptId, ttl],
  );

  useEffect(() => {
    if (!open) return;
    if (!invite && !busy && !error) void mint();
  }, [busy, error, invite, mint, open]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, width: '100%' }}>
      <button
        className="btn"
        type="button"
        onClick={() => {
          setOpen((value) => !value);
          if (!open) setInvite(null);
        }}
      >
        {open ? 'Hide invite' : 'Invite to friendly battle'}
      </button>

      {open ? (
        <div className="panel" style={{ padding: 14 }}>
          <div className="tiny muted" style={{ marginBottom: 10, lineHeight: 1.6 }}>
            The invite is a tiny JSON document — <span className="mono-id">{'{ realm, script, bp }'}</span> — where{' '}
            <span className="mono-id">script</span> is a signed content URL served by this deployment. Anything that
            speaks the same format (the game client, another script site) can read the source from it while the token
            lasts.
          </div>

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
            <label className="tiny muted" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              Realm
              <select
                className="input"
                value={realm}
                onChange={(event) => setRealm(event.target.value)}
                style={{ minWidth: 190 }}
              >
                {REALM_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>
            <label className="tiny muted" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              Valid for (minutes)
              <input
                className="input"
                type="number"
                min={1}
                max={43200}
                value={ttl}
                onChange={(event) => setTtl(Math.max(1, Number(event.target.value) || 15))}
                style={{ minWidth: 120 }}
              />
            </label>
            <button
              className="btn btn-primary"
              type="button"
              onClick={() => void mint()}
              disabled={busy}
              style={{ alignSelf: 'flex-end' }}
            >
              {busy ? 'Signing…' : invite ? 'Regenerate' : 'Create invite'}
            </button>
          </div>

          {error ? <div className="form-error">{error}</div> : null}

          {invite ? (
            <>
              <Row label="Invite payload (paste into the game / another site)" value={invite.payload} lines={10} />
              <Row label="Content URL (script source, token-signed)" value={invite.content_url} />
              <Row label="Base64 invite (single line)" value={invite.invite_b64} />
              <Row label="Deep link" value={invite.deep_link} />
              <Row label="Open here" value={invite.invite_url} />
              <div className="tiny muted" style={{ marginTop: 4 }}>
                revision <span className="mono-id">#{invite.revision_id}</span>
                {invite.expires_at ? (
                  <>
                    {' '}
                    · expires <span className="mono-id">{new Date(invite.expires_at).toLocaleString()}</span>
                  </>
                ) : null}
              </div>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
