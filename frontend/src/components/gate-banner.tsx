import type { CSSProperties } from 'react';
import type { Lang } from '@/lib/check-labels';
import type { Gate } from '@/lib/stage-types';
import { pick, type Headline } from '@/lib/stage';
import { t } from '@/lib/stage-copy';
import { VerdictIcon } from './verdict';

// The gate banner (R77), at the top of the Report. It shows what the API says,
// and nothing more:
//   ready_by_these_checks  "No leak found by these checks."
//   not_ready              "Not ready: see why", with the reasons of the gate
// The headline above it is the one of the client report (R73). A missing gate
// (an old answer) shows no banner. The mark and the colours say the same as the
// words (never colour alone): a leak, a result by these checks, or "not ready".
// The reveal is one small motion: the mark lands, the headline rises, the
// reasons follow one by one (stage.css; none with reduced motion).
const MARK: Record<Headline['tone'], 'LEAKED' | 'BLOCKED' | 'INCONCLUSIVE'> = {
  leak: 'LEAKED',
  clear: 'BLOCKED',
  'not-ready': 'INCONCLUSIVE',
};

export function GateBanner({
  gate,
  headline,
  lang,
}: {
  gate: Gate | undefined;
  headline: Headline | null;
  lang: Lang;
}) {
  if (!gate) return null;
  const ready = gate.decision === 'ready_by_these_checks';
  const reasons = ready ? [] : (gate.reasons ?? []);
  const status = t(lang, ready ? 'gateReady' : 'gateNotReady');
  const headlineText = headline ? pick(headline.text, lang) : '';
  const tone = headline?.tone ?? (ready ? 'clear' : 'not-ready');
  // the headline repeats the status when they are the same sentence
  const showHeadline = headlineText !== '' && headlineText !== status;

  return (
    <section
      className={`gate-banner gate-${tone}`}
      aria-labelledby="gate-status"
      data-decision={gate.decision}
    >
      <span className="gate-mark" aria-hidden="true">
        <VerdictIcon verdict={MARK[tone]} size={26} />
      </span>
      <div className="gate-body">
        <p className="gate-eyebrow">{t(lang, 'gateEyebrow')}</p>
        {showHeadline ? <h2 className="gate-headline">{headlineText}</h2> : null}
        <p
          id="gate-status"
          className={showHeadline ? 'gate-status' : 'gate-headline gate-status-main'}
        >
          {status}
        </p>
        {reasons.length > 0 ? (
          <div className="gate-reasons">
            <p className="gate-why">{t(lang, 'gateWhy')}</p>
            <ul>
              {reasons.map((reason, index) => (
                <li key={index} style={{ '--i': index } as CSSProperties}>
                  {pick(reason, lang)}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </section>
  );
}
