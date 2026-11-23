import type { CSSProperties } from 'react';
import type { Lang } from '@/lib/check-labels';
import type { ClientReport, RoadmapItem } from '@/lib/stage-types';
import { pick, topActionItems } from '@/lib/stage';
import { filesReadText, t } from '@/lib/stage-copy';
import type { AuditSummary } from '@/lib/types';

// The summary block of the client report (R80), above the details: the counts
// of the tables and of the website, and "Do this first". A count that is `null`
// is "not checked", never zero. Every number is the API's; the counts of the
// audit are used only when there is no client report (a 404: it is hidden, R72).
type TableCounts = { leaked: number; blocked: number; inconclusive: number };
type SiteCounts = { siteLeaked: number; headersMissing?: number };
type RepoCounts = { leaked: number };

function countsFrom(
  report: ClientReport | null,
  summary: AuditSummary | undefined,
  hasWebsite: boolean,
  hasSupabase: boolean,
  hasRepo: boolean,
): {
  tables: TableCounts | null;
  site: SiteCounts | null;
  repo: RepoCounts | null;
} {
  if (report?.findings) {
    return {
      tables: report.findings.tables ?? null,
      site: report.findings.site ?? null,
      repo: report.findings.repo ?? null,
    };
  }
  return {
    tables:
      summary && hasSupabase
        ? {
            leaked: summary.leaked,
            blocked: summary.blocked,
            inconclusive: summary.inconclusive,
          }
        : null,
    site:
      summary && hasWebsite ? { siteLeaked: summary.siteLeaked ?? 0 } : null,
    repo: summary && hasRepo ? { leaked: summary.repoLeaked ?? 0 } : null,
  };
}

function Tile({
  tone,
  value,
  label,
  index,
}: {
  tone: string;
  value: number;
  label: string;
  index: number;
}) {
  return (
    <div
      className={`stat-tile stat-${tone}`}
      style={{ '--i': index } as CSSProperties}
    >
      <span className="stat-value">{value}</span>
      <strong>{label}</strong>
    </div>
  );
}

export function ClientSummary({
  report,
  roadmapItems,
  summary,
  hasWebsite,
  hasSupabase,
  hasRepo = false,
  repoFilesRead = null,
  lang,
}: {
  report: ClientReport | null;
  roadmapItems: RoadmapItem[] | null | undefined;
  summary: AuditSummary | undefined;
  hasWebsite: boolean;
  hasSupabase: boolean;
  hasRepo?: boolean;
  /** the count the API sent for the Repo scan; null = none was sent */
  repoFilesRead?: number | null;
  lang: Lang;
}) {
  const { tables, site, repo } = countsFrom(
    report,
    summary,
    hasWebsite,
    hasSupabase,
    hasRepo,
  );
  const first = topActionItems(report, roadmapItems);
  // a group is shown when the audit asked for it, or the report has a place for it
  const showTables = hasSupabase || report?.findings?.tables !== undefined;
  const showSite = hasWebsite || report?.findings?.site !== undefined;
  const showRepo = hasRepo || report?.findings?.repo !== undefined;

  return (
    <section className="card client-summary" aria-labelledby="summary-heading">
      <h2 id="summary-heading">{t(lang, 'summaryHeading')}</h2>
      <div className="summary-groups">
        {showTables ? (
          <div className="summary-group">
            <h3>{t(lang, 'summaryTables')}</h3>
            {tables ? (
              <div className="stat-row">
                <Tile tone="leaked" value={tables.leaked} label={t(lang, 'leaked')} index={0} />
                <Tile
                  tone="inconclusive"
                  value={tables.inconclusive}
                  label={t(lang, 'inconclusive')}
                  index={1}
                />
                <Tile tone="blocked" value={tables.blocked} label={t(lang, 'blocked')} index={2} />
              </div>
            ) : (
              <p className="muted small not-checked">{t(lang, 'notChecked')}</p>
            )}
          </div>
        ) : null}
        {showSite ? (
          <div className="summary-group">
            <h3>{t(lang, 'summarySite')}</h3>
            {site ? (
              <div className="stat-row">
                <Tile
                  tone={site.siteLeaked > 0 ? 'leaked' : 'blocked'}
                  value={site.siteLeaked}
                  label={t(lang, 'siteKeys')}
                  index={3}
                />
                {site.headersMissing !== undefined ? (
                  <Tile
                    tone={site.headersMissing > 0 ? 'inconclusive' : 'blocked'}
                    value={site.headersMissing}
                    label={t(lang, 'siteHeaders')}
                    index={4}
                  />
                ) : null}
              </div>
            ) : (
              <p className="muted small not-checked">{t(lang, 'notChecked')}</p>
            )}
          </div>
        ) : null}
        {showRepo ? (
          <div className="summary-group">
            <h3>{t(lang, 'summaryRepo')}</h3>
            {repo ? (
              <div className="stat-row">
                <Tile
                  tone={repo.leaked > 0 ? 'leaked' : 'blocked'}
                  value={repo.leaked}
                  label={t(lang, 'repoKeys')}
                  index={5}
                />
                {repoFilesRead !== null ? (
                  <p className="muted small files-read">
                    {filesReadText(repoFilesRead, lang)}
                  </p>
                ) : null}
              </div>
            ) : (
              <p className="muted small not-checked">{t(lang, 'notChecked')}</p>
            )}
          </div>
        ) : null}
      </div>

      {first.length > 0 ? (
        <div className="do-first">
          <h3>{t(lang, 'doThisFirst')}</h3>
          <ol>
            {first.map((item) => (
              <li key={item.id}>
                <a href={`#roadmap-${item.id}`}>
                  <span className={`severity severity-${item.severity}`}>
                    {String(item.severity)}
                  </span>
                  <span>{pick(item.title, lang)}</span>
                </a>
              </li>
            ))}
          </ol>
          <a href="#roadmap" className="text-link">
            {t(lang, 'seeRoadmap')}
          </a>
        </div>
      ) : null}
    </section>
  );
}
