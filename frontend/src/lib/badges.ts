import { fixProgress } from './progress';
import type { Finding } from './types';

// Three badges, earned only from real results (R64). They are kept in this
// browser (localStorage) and nowhere else. They are an encouragement, not
// proof: a person can edit them, so they are never part of the certificate or
// of its record hash.

export const BADGE_KEY = 'vca-badges-v1';
export const BADGE_IDS = ['first_audit', 'first_fix', 'no_leak_found'] as const;
export type BadgeId = (typeof BADGE_IDS)[number];

/** `at` is the time it was earned. `celebrated` is false until its animation has run. */
export interface BadgeRecord {
  at: string;
  celebrated: boolean;
}
export type BadgeState = Partial<Record<BadgeId, BadgeRecord>>;

/** The two methods of localStorage that are used. */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const MAX_STORED_CHARS = 2_000;
const MAX_DATE_CHARS = 40;

function isBadgeId(value: string): value is BadgeId {
  return (BADGE_IDS as readonly string[]).includes(value);
}

/**
 * Reads what was stored. Anything that does not have exactly the expected
 * shape is dropped: bad JSON, another version, an unknown badge, a field of
 * the wrong type, a date that is not a date, a text that is too long.
 */
export function parseBadgeState(raw: string | null): BadgeState {
  if (!raw || raw.length > MAX_STORED_CHARS) return {};
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return {};
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return {};
  const { v, badges } = data as { v?: unknown; badges?: unknown };
  if (v !== 1 || !badges || typeof badges !== 'object' || Array.isArray(badges)) {
    return {};
  }
  const state: BadgeState = {};
  for (const [key, value] of Object.entries(badges)) {
    if (!isBadgeId(key) || !value || typeof value !== 'object') continue;
    const { at, celebrated } = value as { at?: unknown; celebrated?: unknown };
    if (
      typeof at === 'string' &&
      at.length > 0 &&
      at.length <= MAX_DATE_CHARS &&
      !Number.isNaN(Date.parse(at)) &&
      typeof celebrated === 'boolean'
    ) {
      state[key] = { at, celebrated };
    }
  }
  return state;
}

/** Only the three ids with a date and a flag. No key, address, name or id of an audit. */
export function serializeBadgeState(state: BadgeState): string {
  const badges: BadgeState = {};
  for (const id of BADGE_IDS) {
    const record = state[id];
    if (record) badges[id] = { at: record.at, celebrated: record.celebrated };
  }
  return JSON.stringify({ v: 1, badges });
}

/**
 * The badges of this browser. Every read and write is allowed to fail (private
 * window, blocked storage, full storage): then the badges live in memory for
 * this page, and nothing crashes. Writing only ever adds a badge that is
 * missing, so a second tab cannot lose a badge of the first.
 */
export function createBadgeStore(getStorage: () => StorageLike | null) {
  let memory: BadgeState = {};

  function read(): BadgeState {
    try {
      const storage = getStorage();
      if (storage) memory = parseBadgeState(storage.getItem(BADGE_KEY));
    } catch {
      /* keep what is in memory */
    }
    return { ...memory };
  }

  function write(state: BadgeState): BadgeState {
    memory = { ...state };
    try {
      getStorage()?.setItem(BADGE_KEY, serializeBadgeState(memory));
    } catch {
      /* the badges stay in memory for this page */
    }
    return { ...memory };
  }

  return {
    read,
    /** Adds the badges that are missing. `celebrate` are the ones whose animation is still to run. */
    add(ids: readonly BadgeId[], at: string, celebrate: readonly BadgeId[] = []) {
      const state = read();
      for (const id of ids) {
        if (!state[id]) state[id] = { at, celebrated: !celebrate.includes(id) };
      }
      return write(state);
    },
    /** Called when the animation of a badge has ended. */
    markCelebrated(id: BadgeId) {
      const state = read();
      const record = state[id];
      if (record && !record.celebrated) state[id] = { ...record, celebrated: true };
      return write(state);
    },
  };
}

/** What the page knows when it asks which badges are earned. */
export interface AwardContext {
  /** the audit is `completed` */
  auditCompleted: boolean;
  /** a Re-test is running now */
  retestActive: boolean;
  lastRetestStatus: 'running' | 'completed' | 'failed' | null;
  /** the real findings (not the copies shown as "running"); null when not read */
  findings: readonly Finding[] | null;
  leaked: number;
  blocked: number;
  cleanup: 'ok' | 'failed' | null;
  /** The user did something (Start or Re-test) and this page has now seen its result. */
  actionObserved: boolean;
}

/**
 * Which badges are newly earned, and which of them get the animation.
 *
 * - First audit completed: the audit is completed.
 * - First leak fixed (verified by Re-test): a Re-test finished and at least one finding is verified
 *   fixed (LEAKED -> BLOCKED; INCONCLUSIVE is not a fix).
 * - Zero leaks reached: the audit could be given a certificate (no leak, at least
 *   one table BLOCKED, cleanup not failed): the same rule as the backend.
 * - Nothing is earned while a Re-test runs, and nothing from a failed Re-test.
 * - A badge is celebrated only when the user's own action produced it.
 */
export function decideAwards(state: BadgeState, context: AwardContext) {
  const none = { earn: [] as BadgeId[], celebrate: [] as BadgeId[] };
  if (!context.auditCompleted) return none;
  if (
    context.retestActive ||
    context.lastRetestStatus === 'running' ||
    context.lastRetestStatus === 'failed'
  ) {
    return none;
  }

  const holds: Record<BadgeId, boolean> = {
    first_audit: true,
    first_fix:
      context.lastRetestStatus === 'completed' &&
      fixProgress(context.findings).fixed >= 1,
    no_leak_found:
      context.leaked === 0 &&
      context.blocked >= 1 &&
      context.cleanup !== 'failed',
  };
  const earn = BADGE_IDS.filter((id) => holds[id] && !state[id]);
  return { earn, celebrate: context.actionObserved ? earn : [] };
}

/** The animation runs once: only for a badge that is earned and not celebrated yet. */
export function shouldAnimate(
  state: BadgeState,
  id: BadgeId,
  requested: boolean,
): boolean {
  const record = state[id];
  return requested && record !== undefined && !record.celebrated;
}
