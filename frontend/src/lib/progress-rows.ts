// How a row of the progress screen looks (R75). The rows are dynamic: the page
// shows the rows it receives, in the order it receives them, and adds none. A
// row's own status and progress come from the backend; nothing is counted here.
import type { Lang } from './check-labels';
import { pick } from './stage';
import type { AuditModule, AuditTarget } from './types';

export type RowTone =
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'skipped'
  | 'unknown';

export interface RowView {
  tone: RowTone;
  /** A status the UI does not know is shown as given, never a crash (R72). */
  statusLabel: string;
  /** A skipped row has no bar and no percent: it did not run, it is not at 0%. */
  showBar: boolean;
  percent: number;
  /** The reason of a skipped row (in the chosen language) or the message of a failed one. */
  note: string;
  noteKind: 'reason' | 'message' | null;
}

const LABEL: Record<Exclude<RowTone, 'unknown'>, string> = {
  queued: 'Queued',
  running: 'Running',
  completed: 'Completed',
  failed: 'Failed',
  skipped: 'Skipped',
};

function toneOf(status: string): RowTone {
  return status in LABEL ? (status as RowTone) : 'unknown';
}

export function rowView(module: AuditModule, lang: Lang): RowView {
  const status = String(module.status ?? '');
  const tone = toneOf(status);
  const raw = Number(module.progress);
  const percent = Number.isFinite(raw) ? Math.max(0, Math.min(100, raw)) : 0;

  let note = '';
  let noteKind: RowView['noteKind'] = null;
  if (tone === 'skipped') {
    note = pick(module.reason, lang);
    noteKind = note ? 'reason' : null;
  } else if (module.message) {
    // a failed row has a message (R62); any other row that has one shows it too
    note = module.message;
    noteKind = 'message';
  }

  return {
    tone,
    statusLabel: tone === 'unknown' ? status || 'Unknown' : LABEL[tone],
    showBar: tone !== 'skipped',
    percent,
    note,
    noteKind,
  };
}

/** True when any row has a reason in two languages: only then the toggle is useful. */
export function hasReasons(modules: AuditModule[] | undefined): boolean {
  return (modules ?? []).some((m) => Boolean(m.reason?.en));
}

// The activity strip: one chip for each module the backend sent, with the
// status the backend gave it and nothing else (no step, no file, no guess). Only
// the order is the page's: Planner, Repo scan, Site headers, Bundle scan,
// Evidence, Roadmap, Guide, then any other module that ran or is running (the
// Data Access Prover, the Report agent), then the skipped ones, last.
const ACTIVITY_FIRST = [
  'planner',
  'repo-secrets',
  'tls-headers',
  'bundle-secrets',
  'evidence',
  'roadmap',
  'guide',
] as const;

export function activityOrder(modules: AuditModule[] | undefined | null): AuditModule[] {
  const list = modules ?? [];
  const skipped = (m: AuditModule) => String(m.status) === 'skipped';
  const named = ACTIVITY_FIRST.flatMap((id) =>
    list.filter((m) => m.id === id && !skipped(m)),
  );
  const rest = list.filter((m) => !skipped(m) && !named.includes(m));
  return [...named, ...rest, ...list.filter(skipped)];
}

/** "Planner: completed". The name and the status are the backend's. */
export function activityText(module: AuditModule, lang: Lang): string {
  return `${module.name}: ${rowView(module, lang).statusLabel.toLowerCase()}`;
}

/** The names of the modules that are running now (empty when none is). */
export function runningNow(modules: AuditModule[] | undefined | null): string[] {
  return (modules ?? [])
    .filter((m) => String(m.status) === 'running')
    .map((m) => m.name);
}

export interface TargetLine {
  kind: 'website' | 'supabase' | 'repo';
  url: string;
}

/** What the audit looks at: a website, a Supabase project, a repository. Missing = not shown. */
export function targetLines(target: Partial<AuditTarget> | undefined): TargetLine[] {
  const lines: TargetLine[] = [];
  if (target?.websiteUrl) lines.push({ kind: 'website', url: target.websiteUrl });
  if (target?.projectUrl) lines.push({ kind: 'supabase', url: target.projectUrl });
  if (target?.repoUrl) lines.push({ kind: 'repo', url: target.repoUrl });
  return lines;
}
