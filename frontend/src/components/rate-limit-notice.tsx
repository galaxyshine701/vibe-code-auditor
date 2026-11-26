'use client';

import { rateLimitText } from '@/lib/ui-copy';
import { useLang } from '@/lib/use-lang';
import { useApp } from './app-provider';

export function RateLimitNotice() {
  const { rateLimitSecondsLeft } = useApp();
  const [lang] = useLang();
  if (rateLimitSecondsLeft === 0) return null;
  return (
    <div className="notice notice-warning" role="status">
      {rateLimitText(rateLimitSecondsLeft, lang)}
    </div>
  );
}
