'use client';

import { useEffect, useRef, useState } from 'react';
import { copyText } from '@/lib/format';

export function CopyButton({
  text,
  label = 'Copy',
  copiedLabel = 'Copied',
  className = 'button button-small',
}: {
  text: string;
  label?: string;
  copiedLabel?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    return () => {
      if (timer.current !== undefined) window.clearTimeout(timer.current);
    };
  }, []);

  async function copy() {
    const ok = await copyText(text);
    if (!ok) return;
    setCopied(true);
    if (timer.current !== undefined) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopied(false), 2_000);
  }

  return (
    <button type="button" className={className} onClick={copy}>
      {copied ? copiedLabel : label}
    </button>
  );
}
