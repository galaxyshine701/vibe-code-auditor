import Link from 'next/link';
import type { CSSProperties, ReactNode } from 'react';
import { checkLabel, type Lang } from '@/lib/check-labels';
import { pick, type BucketCheck, type Buckets } from '@/lib/stage';
import { t, type CopyKey } from '@/lib/stage-copy';

// The buckets of coverage (R78), each with its own heading, never merged:
// checked, partly checked (with every name that was not read), not provided,
// not implemented yet, failed to run, and left out on purpose. "Not provided"
// and "Not implemented yet" come from the client report's scope (the reason is
// only the fallback), and a check that is required but not checked is marked
// "Required". The name of a check is written by the UI from its id (R87).
type Tone = 'ok' | 'neutral' | 'warn' | 'fail';

function Bucket({
  title,
  tone,
  count,
  index,
  children,
}: {
  title: string;
  tone: Tone;
  count: number;
  index: number;
  children: ReactNode;
}) {
  return (
    <section
      className={`bucket bucket-${tone}`}
      style={{ '--i': index } as CSSProperties}
    >
      <header>
        <h3>{title}</h3>
        <span className="bucket-count">{count}</span>
      </header>
      {children}
    </section>
  );
}

function Row({
  check,
  lang,
  withReason,
  addable,
  showRequired,
  children,
}: {
  check: BucketCheck;
  lang: Lang;
  withReason: boolean;
  addable?: boolean;
  showRequired: boolean;
  children?: ReactNode;
}) {
  const reason = withReason ? pick(check.reason, lang) : '';
  return (
    <li>
      <div className="bucket-line">
        <span className="bucket-name">{checkLabel(check.id, lang)}</span>
        {showRequired && check.required ? (
          <span className="required-tag">{t(lang, 'required')}</span>
        ) : null}
      </div>
      {reason ? <p className="bucket-reason">{reason}</p> : null}
      {children}
      {addable ? (
        <Link href="/" className="text-link bucket-add">
          {t(lang, 'addIt')}
        </Link>
      ) : null}
    </li>
  );
}

export function ScopeBuckets({
  buckets,
  lang,
}: {
  buckets: Buckets | null;
  lang: Lang;
}) {
  if (!buckets) return null;
  const sections: {
    key: string;
    title: CopyKey;
    tone: Tone;
    list: (BucketCheck & { notRead?: Buckets['partial'][number]['notRead'] })[];
    reason: boolean;
    addable?: boolean;
  }[] = [
    { key: 'checked', title: 'bucketChecked', tone: 'ok', list: buckets.checked, reason: false },
    { key: 'partial', title: 'bucketPartial', tone: 'warn', list: buckets.partial, reason: true },
    {
      key: 'notProvided',
      title: 'bucketNotProvided',
      tone: 'neutral',
      list: buckets.notProvided,
      reason: true,
      addable: true,
    },
    {
      key: 'notImplemented',
      title: 'bucketNotImplemented',
      tone: 'neutral',
      list: buckets.notImplemented,
      reason: true,
    },
    { key: 'failedToRun', title: 'bucketFailed', tone: 'fail', list: buckets.failedToRun, reason: true },
  ];

  let index = 0;
  return (
    <section className="card scope-card" id="scope" aria-labelledby="scope-heading">
      <h2 id="scope-heading">{t(lang, 'scopeHeading')}</h2>
      <p className="muted small">{t(lang, 'scopeIntro')}</p>
      <div className="bucket-grid">
        {sections.map((section) =>
          section.list.length === 0 ? null : (
            <Bucket
              key={section.key}
              title={t(lang, section.title)}
              tone={section.tone}
              count={section.list.length}
              index={index++}
            >
              <ul>
                {section.list.map((check) => (
                  <Row
                    key={check.id}
                    check={check}
                    lang={lang}
                    withReason={section.reason}
                    addable={section.addable}
                    showRequired={section.key !== 'checked'}
                  >
                    {section.key === 'partial' && (check.notRead?.length ?? 0) > 0 ? (
                      <div className="not-read">
                        <p className="not-read-title">{t(lang, 'notRead')}</p>
                        <ul>
                          {check.notRead?.map((item) => (
                            <li key={item.name}>
                              <code>{item.name}</code>
                              {item.reason ? <span> {pick(item.reason, lang)}</span> : null}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                  </Row>
                ))}
              </ul>
            </Bucket>
          ),
        )}
        {buckets.outOfScope.length > 0 ? (
          <Bucket
            title={t(lang, 'bucketOutOfScope')}
            tone="neutral"
            count={buckets.outOfScope.length}
            index={index++}
          >
            <ul>
              {buckets.outOfScope.map((item) => (
                <li key={item.name}>
                  <div className="bucket-line">
                    <span className="bucket-name">{item.name}</span>
                  </div>
                  {item.reason ? (
                    <p className="bucket-reason">{pick(item.reason, lang)}</p>
                  ) : null}
                </li>
              ))}
            </ul>
          </Bucket>
        ) : null}
      </div>

      {buckets.limits.length > 0 ? (
        <details className="limits" open>
          <summary>{t(lang, 'limitsHeading')}</summary>
          <ul>
            {buckets.limits.map((limit, i) => (
              <li key={i}>{pick(limit, lang)}</li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}
