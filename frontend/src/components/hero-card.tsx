import type { CSSProperties, ReactNode } from 'react';
import type { Lang } from '@/lib/check-labels';
import { CARD, pickText } from '@/lib/hero-copy';
import { ScanBeam } from './scan-beam';
import { VerdictBadge } from './verdict';

// The example run of the hero: four evidence rows that a scan beam resolves one
// after the other, then a gate line. It shows what a report is made of: a
// website (headers, scripts), a table check, a public repository, and a gate
// with a reason and what was not provided. All of it is an example, and the
// card says so ("Example, not a real audit").
//
//   Site headers        2 missing (amber)
//   Scripts of the site a secret-looking key, masked (red, LEAKED)
//   Table data          the canary scene made small (green, BLOCKED)
//   Repository files    a table with no RLS in a migration (amber, INCONCLUSIVE)
//   Gate                "Not ready by these checks", one reason, one "Not provided"
//
// The words are always in the page; the animation only decides when each row's
// result shows (hero.css). With reduced motion, and on a phone (480 px and
// narrower, where the diagram is also left out), the card is its final state.
// The beam is the same piece as the intro's (scan-beam.tsx).
const BEAM_START = 0.5;
const BEAM_DUR = 2.4;
// where the rows are, in % of the height of the rows; the beam goes from -8 to 108
const FROM = -8;
const TO = 108;
const at = (percent: number) =>
  (BEAM_START + (BEAM_DUR * (percent - FROM)) / (TO - FROM)).toFixed(2) + 's';

const T = {
  headers: at(10),
  scripts: at(34),
  tables: at(62),
  repo: at(88),
  gate: `${(BEAM_START + BEAM_DUR + 0.25).toFixed(2)}s`,
};

function Row({
  tone,
  label,
  detail,
  resolveAt,
  extra,
  children,
  lang,
}: {
  tone: 'warn' | 'leak' | 'ok';
  label: string;
  detail: string;
  resolveAt: string;
  /** under the detail: a masked key, a small figure */
  extra?: ReactNode;
  /** at the end of the row: the result, shown when the beam has passed */
  children: ReactNode;
  lang: Lang;
}) {
  return (
    <div
      className={`hero-row hero-row-${tone}`}
      style={{ '--at': resolveAt } as CSSProperties}
    >
      <div className="hero-row-main">
        <span className="hero-row-label">{label}</span>
        <span className="hero-row-detail">{detail}</span>
        {extra}
      </div>
      <div className="hero-row-end">
        <span className="hero-wait" aria-hidden="true">
          {pickText(CARD.scanning, lang)}
        </span>
        {children}
      </div>
    </div>
  );
}

export function HeroCard({ lang }: { lang: Lang }) {
  return (
    <section className="hero-card" aria-label={pickText(CARD.tag, lang)}>
      <header className="hero-card-head">
        <span className="hero-card-tag">{pickText(CARD.tag, lang)}</span>
        <span className="hero-card-note">{pickText(CARD.tagNote, lang)}</span>
      </header>

      <div className="hero-rows">
        {/* the beam goes over the four rows, top to bottom; it is only drawn */}
        <svg
          className="hero-beam-layer"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          aria-hidden="true"
          focusable="false"
        >
          <ScanBeam
            id="hero-beam"
            axis="y"
            from={FROM}
            to={TO}
            span={[0, 100]}
            delay={`${BEAM_START}s`}
            duration={`${BEAM_DUR}s`}
            thickness={16}
          />
        </svg>

        <Row
          tone="warn"
          label={pickText(CARD.headers.label, lang)}
          detail={pickText(CARD.headers.detail, lang)}
          resolveAt={T.headers}
          lang={lang}
        >
          <span className="hero-result hero-chip-warn">
            {pickText(CARD.headers.result, lang)}
          </span>
        </Row>

        <Row
          tone="leak"
          label={pickText(CARD.scripts.label, lang)}
          detail={pickText(CARD.scripts.detail, lang)}
          resolveAt={T.scripts}
          lang={lang}
          extra={<code className="hero-key">{CARD.scripts.key}</code>}
        >
          <span className="hero-result">
            <VerdictBadge verdict="LEAKED" />
          </span>
        </Row>

        {/* the canary scene, made small (extra): three tries, a policy, one canary row */}
        <Row
          tone="ok"
          label={pickText(CARD.tables.label, lang)}
          detail={pickText(CARD.tables.detail, lang)}
          resolveAt={T.tables}
          lang={lang}
          extra={
            <svg
              className="hero-mini hero-result"
              viewBox="0 0 132 46"
              role="img"
              aria-label={pickText(CARD.figure, lang)}
            >
              {[8, 23, 38].map((y) => (
                <g key={y}>
                  <circle className="hero-mini-actor" cx="8" cy={y} r="4" />
                  <path className="hero-mini-path" d={`M14 ${y}H80`} />
                </g>
              ))}
              <path className="hero-mini-policy" d="M84 2V44" />
              <rect
                className="hero-mini-row"
                x="94"
                y="15"
                width="32"
                height="16"
                rx="5"
              />
              <circle className="hero-mini-canary" cx="104" cy="23" r="3.4" />
            </svg>
          }
        >
          <span className="hero-result">
            <VerdictBadge verdict="BLOCKED" />
          </span>
        </Row>

        {/* a public repository: a warning sign only (INCONCLUSIVE), never a proven leak */}
        <Row
          tone="warn"
          label={pickText(CARD.repo.label, lang)}
          detail={pickText(CARD.repo.detail, lang)}
          resolveAt={T.repo}
          lang={lang}
        >
          <span className="hero-result">
            <VerdictBadge verdict="INCONCLUSIVE" />
          </span>
        </Row>
      </div>

      <div
        className="hero-gate-line"
        style={{ '--at': T.gate } as CSSProperties}
      >
        <p className="hero-gate-title">{pickText(CARD.gate.label, lang)}</p>
        <p className="hero-gate-reason">{pickText(CARD.gate.reason, lang)}</p>
        <span className="hero-gate-chip">
          {pickText(CARD.gate.notProvided, lang)}
        </span>
      </div>
    </section>
  );
}
