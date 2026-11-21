import type { CSSProperties } from 'react';
import { subjectLabel, type Lang } from '@/lib/check-labels';
import type { EvidenceItem, EvidenceResponse } from '@/lib/stage-types';
import { groupEvidence, kindOf, pick } from '@/lib/stage';
import { t, type CopyKey } from '@/lib/stage-copy';
import type { Verdict } from '@/lib/types';
import { VerdictBadge } from './verdict';

// The evidence (R79), grouped by kind: Tables, Site headers, Scripts of the
// site, Repository files (path:line, the key itself is never shown). A missing kind is a table. For a site item `findingId` and `table` are
// null: the subject says what it is about (a header, or a script as host/path),
// and a subject the UI does not know is shown as given. The verdict, the proof
// and the summary are the API's; the colours and the icon of the verdict are the
// ones of R56. Site evidence has no fix and no Re-test status. The rows come in
// one after the other, so the eye follows the list (stage.css).
const KIND_TITLE: Record<string, CopyKey> = {
  table: 'kindTable',
  'site-headers': 'kindHeaders',
  'site-bundle': 'kindBundle',
  'repo-file': 'kindRepo',
  'repo-env-name': 'kindRepoName',
};

const VERDICTS: readonly string[] = ['LEAKED', 'BLOCKED', 'INCONCLUSIVE'];

function Verdictchip({ verdict }: { verdict: string }) {
  if (VERDICTS.includes(verdict)) {
    return <VerdictBadge verdict={verdict as Verdict} />;
  }
  // a verdict the UI does not know is plain text, never a crash (R72)
  return <span className="verdict-badge">{verdict || '?'}</span>;
}

function Subject({ item, lang }: { item: EvidenceItem; lang: Lang }) {
  const kind = kindOf(item);
  if (kind === 'table') {
    return <code className="evidence-subject">{item.table ?? item.subject ?? item.check}</code>;
  }
  if (kind === 'repo-file' || kind === 'repo-env-name') {
    // a path and a line, as the API gave them; never the text of the line
    return (
      <code className="evidence-subject">
        {item.subject ?? item.check}
        {typeof item.line === 'number' ? `:${item.line}` : ''}
      </code>
    );
  }
  return (
    <code className="evidence-subject">
      {item.subject ? subjectLabel(item.subject, lang) : item.check}
    </code>
  );
}

export function EvidenceGroups({
  evidence,
  lang,
  findingIds,
}: {
  evidence: EvidenceResponse | null;
  lang: Lang;
  findingIds: ReadonlySet<string>;
}) {
  if (!evidence) return null;
  const groups = groupEvidence(evidence.items);
  let row = 0;

  return (
    <section className="card evidence-card" id="evidence" aria-labelledby="evidence-heading">
      <h2 id="evidence-heading">{t(lang, 'evidenceHeading')}</h2>
      {groups.length === 0 ? (
        <p className="roadmap-empty">{t(lang, 'evidenceEmpty')}</p>
      ) : (
        groups.map((group) => (
          <div className="evidence-group" key={group.kind}>
            <h3>
              {KIND_TITLE[group.kind] ? t(lang, KIND_TITLE[group.kind]) : group.kind}
              <span className="bucket-count">{group.items.length}</span>
            </h3>
            <ul>
              {group.items.map((item) => {
                const index = Math.min(row++, 14);
                const kind = kindOf(item);
                return (
                  <li
                    key={item.id}
                    id={`evidence-${item.id}`}
                    className={`evidence-row evidence-${String(item.verdict).toLowerCase()}`}
                    style={{ '--i': index } as CSSProperties}
                  >
                    <div className="evidence-top">
                      <Verdictchip verdict={String(item.verdict)} />
                      <Subject item={item} lang={lang} />
                      {item.proof ? (
                        <span className="proof-chip">
                          {item.proof === 'PROVEN'
                            ? t(lang, 'proofProven')
                            : item.proof === 'UNVERIFIED'
                              ? t(lang, 'proofUnverified')
                              : item.proof}
                        </span>
                      ) : null}
                    </div>
                    {kind === 'site-headers' ? (
                      <p className="evidence-meaning">
                        {item.verdict === 'BLOCKED'
                          ? t(lang, 'headerThere')
                          : t(lang, 'headerWeak')}
                      </p>
                    ) : null}
                    {kind === 'repo-file' ? (
                      <p className="evidence-meaning">{t(lang, 'repoKeyHidden')}</p>
                    ) : null}
                    {item.summary ? (
                      <p className="evidence-summary">{pick(item.summary, lang)}</p>
                    ) : null}
                    {item.findingId && findingIds.has(item.findingId) ? (
                      <a href={`#finding-${item.findingId}`} className="text-link">
                        {t(lang, 'seeFinding')}
                      </a>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </div>
        ))
      )}
    </section>
  );
}
