'use client';

import { useApp } from './app-provider';

export function RateLimitNotice() {
  const { rateLimitSecondsLeft } = useApp();
  if (rateLimitSecondsLeft === 0) return null;
  return (
    <div className="notice notice-warning" role="status">
      Too many wrong attempts. Try again in {rateLimitSecondsLeft}s.
    </div>
  );
}
