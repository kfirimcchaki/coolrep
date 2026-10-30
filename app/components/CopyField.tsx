'use client';

import { useState } from 'react';

export default function CopyField({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      const absolute = value.startsWith('/') ? `${window.location.origin}${value}` : value;
      await navigator.clipboard.writeText(absolute);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="copy-row">
      <input className="input" readOnly value={value} onFocus={(event) => event.currentTarget.select()} />
      <button className="btn btn-sm" type="button" onClick={copy}>
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  );
}
