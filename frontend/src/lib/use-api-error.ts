import { useCallback } from 'react';
import { useApp } from '@/components/app-provider';
import { ApiError, errorMessage } from './errors';

export function useApiError() {
  const { clearAccessCode, noteRateLimit, setAccessNotice } = useApp();

  return useCallback(
    (error: unknown): string => {
      if (error instanceof ApiError) {
        if (error.status === 401) {
          clearAccessCode();
          setAccessNotice('Access denied.');
        }
        if (error.status === 429) {
          noteRateLimit(error.retryAfterSeconds ?? 30);
        }
      }
      return errorMessage(error);
    },
    [clearAccessCode, noteRateLimit, setAccessNotice],
  );
}
