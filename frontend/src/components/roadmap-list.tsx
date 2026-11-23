import type { CSSProperties } from 'react';
import type { Lang } from '@/lib/check-labels';
import type { ClientReport, RoadmapResponse } from '@/lib/stage-types';
import {
  mergeSameSteps,
  pick,
  roadmapItems,
  roadmapUnavailable,
  showsRequiredLabel,
} from '@/lib/stage';
import { kindLabel, moreSteps, t } from '@/lib/stage-copy';

// The roadmap (R81): the next steps, already in the order to follow, so they are
// never sorted again. Each item is a step on a line: its number, the kind and
// the severity of the API, the title, and (opened) why, the steps as a numbered
// list, and links to the finding and the evidence it is about, where the screen
// has them. The first three ("Do this first", R80) are open. "Required check" is
// only on fix-* and improve-header items. A roadmap of the Prover never holds
// the SQL: it points at the finding, whose card has the fix (R32).
const OPEN_FIRST = 3;

export function RoadmapList({
  roadmap,
  report,
  lang,
  findingIds,
  evidenceIds,
}: {
  roadmap: RoadmapResponse | null;
  report: ClientReport | null;
  lang: Lang;
  /** ids of the findings that are on this screen */
  findingIds: ReadonlySet<string>;
  /** ids of the evidence items that are on this screen */
  evidenceIds: ReadonlySet<string>;
}) {
  // "Roadmap not available." in the limits: say so, show no steps (R80)
  const unavailable = roadmapUnavailable(report);
  if (!roadmap && !unavailable) return null;
  // the same step is shown once (mergeSameSteps), in the order received
  const items = unavailable ? [] : mergeSameSteps(roadmapItems(roadmap?.items));
  const truncated = roadmap?.truncated ?? 0;

  return (
    <section className="card roadmap-card" id="roadmap" aria-labelledby="roadmap-heading">
      <h2 id="roadmap-heading">{t(lang, 'roadmapHeading')}</h2>
      <p className="muted small">{t(lang, 'roadmapIntro')}</p>

      {unavailable ? (
        <p className="roadmap-empty">{t(lang, 'roadmapUnavailable')}</p>
      ) : items.length === 0 ? (
        <p className="roadmap-empty">{t(lang, 'roadmapEmpty')}</p>
      ) : (
        <ol className="roadmap">
          {items.map((item, index) => {
            const steps = item.steps ?? [];
            const findingLinks = (item.refs?.findingIds ?? []).filter((id) =>
              findingIds.has(id),
            );
            const evidenceLinks = (item.refs?.evidenceIds ?? []).filter((id) =>
              evidenceIds.has(id),
            );
            return (
              <li
                key={item.id}
                id={`roadmap-${item.id}`}
                className="roadmap-item"
                style={{ '--i': Math.min(index, 12) } as CSSProperties}
              >
                <span className="roadmap-number" aria-hidden="true">
                  {index + 1}
                </span>
                <details open={index < OPEN_FIRST}>
                  <summary>
                    <span className="roadmap-chips">
                      <span className={`severity severity-${item.severity}`}>
                        {String(item.severity)}
                      </span>
                      <span className="roadmap-kind">{kindLabel(item.kind, lang)}</span>
                      {showsRequiredLabel(item) ? (
                        <span className="required-tag">{t(lang, 'requiredCheck')}</span>
                      ) : null}
                    </span>
                    <span className="roadmap-title">{pick(item.title, lang)}</span>
                  </summary>
                  <div className="roadmap-body">
                    {item.why ? (
                      <div>
                        <h3>{t(lang, 'whyHeading')}</h3>
                        <p>{pick(item.why, lang)}</p>
                      </div>
                    ) : null}
                    {steps.length > 0 ? (
                      <div>
                        <h3>{t(lang, 'stepsHeading')}</h3>
                        <ol className="roadmap-steps">
                          {steps.map((step, i) => (
                            <li key={i}>{pick(step, lang)}</li>
                          ))}
                        </ol>
                      </div>
                    ) : null}
                    {findingLinks.length > 0 || evidenceLinks.length > 0 ? (
                      <p className="roadmap-links">
                        {findingLinks.map((id) => (
                          <a key={id} href={`#finding-${id}`} className="text-link">
                            {t(lang, 'seeFinding')}
                          </a>
                        ))}
                        {evidenceLinks.map((id) => (
                          <a key={id} href={`#evidence-${id}`} className="text-link">
                            {t(lang, 'seeEvidence')}
                          </a>
                        ))}
                      </p>
                    ) : null}
                  </div>
                </details>
              </li>
            );
          })}
        </ol>
      )}

      {truncated > 0 ? (
        <p className="muted small roadmap-more">{moreSteps(truncated, lang)}</p>
      ) : null}
    </section>
  );
}
