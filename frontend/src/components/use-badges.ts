'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  createBadgeStore,
  decideAwards,
  type AwardContext,
  type BadgeId,
  type BadgeState,
} from '@/lib/badges';

/**
 * The badges of this browser, and the one place that decides when a badge is
 * earned. `evaluate` is called with what the page has just seen. There is no
 * sync between tabs: a tab reads the storage when it opens and when it
 * evaluates.
 */
export function useBadges() {
  const store = useRef(
    createBadgeStore(() => {
      try {
        return window.localStorage;
      } catch {
        return null;
      }
    }),
  );
  const [state, setState] = useState<BadgeState>({});
  /** earned in this page session by the user's own action */
  const [justEarned, setJustEarned] = useState<BadgeId[]>([]);
  /** their animation has not ended yet */
  const [celebrating, setCelebrating] = useState<BadgeId[]>([]);

  useEffect(() => {
    setState(store.current.read());
  }, []);

  const evaluate = useCallback((context: AwardContext) => {
    const { earn, celebrate } = decideAwards(store.current.read(), context);
    if (earn.length === 0) return;
    setState(store.current.add(earn, new Date().toISOString(), celebrate));
    if (celebrate.length > 0) {
      setJustEarned((current) => [...new Set([...current, ...celebrate])]);
      setCelebrating((current) => [...new Set([...current, ...celebrate])]);
    }
  }, []);

  const finishCelebration = useCallback((id: BadgeId) => {
    setState(store.current.markCelebrated(id));
    setCelebrating((current) => current.filter((item) => item !== id));
  }, []);

  return { state, justEarned, celebrating, evaluate, finishCelebration };
}
