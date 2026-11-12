'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

interface AppContextValue {
  accessCode: string;
  setAccessCode: (code: string) => void;
  clearAccessCode: () => void;
  accessNotice: string;
  setAccessNotice: (message: string) => void;
  rateLimitedUntil: number;
  rateLimitSecondsLeft: number;
  noteRateLimit: (seconds: number) => void;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [accessCode, setAccessCodeState] = useState('');
  const [accessNotice, setAccessNoticeState] = useState('');
  const [rateLimitedUntil, setRateLimitedUntil] = useState(0);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (rateLimitedUntil <= Date.now()) return;
    const timer = window.setInterval(() => {
      const current = Date.now();
      setNow(current);
      if (current >= rateLimitedUntil) {
        window.clearInterval(timer);
      }
    }, 500);
    return () => window.clearInterval(timer);
  }, [rateLimitedUntil]);

  const setAccessCode = useCallback((code: string) => {
    setAccessCodeState(code);
    setAccessNoticeState('');
  }, []);

  const clearAccessCode = useCallback(() => {
    setAccessCodeState('');
  }, []);

  const setAccessNotice = useCallback((message: string) => {
    setAccessNoticeState(message);
  }, []);

  const noteRateLimit = useCallback((seconds: number) => {
    const safeSeconds = Number.isFinite(seconds) && seconds > 0 ? seconds : 30;
    setRateLimitedUntil(Date.now() + safeSeconds * 1_000);
    setNow(Date.now());
  }, []);

  const rateLimitSecondsLeft =
    rateLimitedUntil > now
      ? Math.max(1, Math.ceil((rateLimitedUntil - now) / 1_000))
      : 0;

  const value = useMemo(
    () => ({
      accessCode,
      setAccessCode,
      clearAccessCode,
      accessNotice,
      setAccessNotice,
      rateLimitedUntil,
      rateLimitSecondsLeft,
      noteRateLimit,
    }),
    [
      accessCode,
      accessNotice,
      clearAccessCode,
      noteRateLimit,
      rateLimitSecondsLeft,
      rateLimitedUntil,
      setAccessCode,
      setAccessNotice,
    ],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppContextValue {
  const value = useContext(AppContext);
  if (!value) {
    throw new Error('useApp must be used inside AppProvider.');
  }
  return value;
}
