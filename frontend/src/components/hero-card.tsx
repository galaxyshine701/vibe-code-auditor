import type { CSSProperties, ReactNode } from 'react';
import type { Lang } from '@/lib/check-labels';
import { CARD, TILES, TILES_LABEL, pickText } from '@/lib/hero-copy';
import { DotNumeral } from './dot-numeral';
import { GateBar, LaneDot, LaneNode } from './checkpoint-lane';
import { ScanBeam } from './scan-beam';
import { VerdictBadge } from './verdict';

// The example result of the home page, repository first: four evidence rows that
// a scan beam resolves one after the other, then a gate line with a reason and
// what was not provided. All of it is an example, and the card says so
// ("Example result, not a real audit").
//
//   Secret key in a file       the path and a masked key (red, LEAKED)
//   Committed .env file        names and path only (amber, INCONCLUSIVE)
//   Migration without RLS      the path (amber, INCONCLUSIVE)
//   Site headers               2 missing (amber)
//   Gate                       "Not ready by these checks"
//
// The words are always in the page; the animation only decides when each row's
// result shows (hero.css). With reduced motion, and on a phone (480 px and
// narrower), the card is its final state. The beam is the same piece as the
// intro's (scan-beam.tsx). Down the left of the rows runs the checkpoint lane
// (checkpoint-lane.tsx).
const BEAM_START = 0.5;
const BEAM_DUR = 2.4;
// where the rows are, in % of the height of the rows; the beam goes from -8 to 108
const FROM = -8;
const TO = 108;
const at = (percent: number) =>
  (BEAM_START + (BEAM_DUR * (percent - FROM)) / (TO - FROM)).toFixed(2) + 's';

const T = {
  keyFile: at(10),
  envFile: at(36),
  migration: at(63),
  headers: at(88),
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
  tone: 'warn' | 'leak';
  label: string;
  detail: string;
  resolveAt: string;
  /** under the detail: a path, a masked key, variable names */
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
      <LaneNode tone={tone} />
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
        {/* the lane: a rail with a checkpoint per row, and a dot that goes down with the beam */}
        <LaneDot delay={`${BEAM_START}s`} duration={`${BEAM_DUR}s`} />
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
          tone="leak"
          label={pickText(CARD.keyFile.label, lang)}
          detail={pickText(CARD.keyFile.detail, lang)}
          resolveAt={T.keyFile}
          lang={lang}
          extra={
            <>
              <code className="hero-path">{CARD.keyFile.path}</code>
              <code className="hero-key">{CARD.keyFile.key}</code>
            </>
          }
        >
          <span className="hero-result">
            <VerdictBadge verdict="LEAKED" />
          </span>
        </Row>

        {/* names and path only: the value of a variable is never shown */}
        <Row
          tone="warn"
          label={pickText(CARD.envFile.label, lang)}
          detail={pickText(CARD.envFile.detail, lang)}
          resolveAt={T.envFile}
          lang={lang}
          extra={
            <>
              <code className="hero-path">{CARD.envFile.path}</code>
              <code className="hero-path">{CARD.envFile.names}</code>
            </>
          }
        >
          <span className="hero-result">
            <VerdictBadge verdict="INCONCLUSIVE" />
          </span>
        </Row>

        {/* a warning sign only (INCONCLUSIVE), never a proven leak */}
        <Row
          tone="warn"
          label={pickText(CARD.migration.label, lang)}
          detail={pickText(CARD.migration.detail, lang)}
          resolveAt={T.migration}
          lang={lang}
          extra={<code className="hero-path">{CARD.migration.path}</code>}
        >
          <span className="hero-result">
            <VerdictBadge verdict="INCONCLUSIVE" />
          </span>
        </Row>

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
      </div>

      {/* how many verdicts of each kind the example has (dot-matrix numerals) */}
      <ul className="hero-tiles" aria-label={pickText(TILES_LABEL, lang)}>
        {TILES.map((tile) => (
          <li
            key={tile.verdict}
            className={`hero-tile hero-tile-${tile.verdict.toLowerCase()}`}
          >
            <DotNumeral value={tile.count} />
            <span className="hero-tile-word">{tile.verdict}</span>
          </li>
        ))}
      </ul>

      <div
        className="hero-gate-line"
        style={{ '--at': T.gate } as CSSProperties}
      >
        <p className="hero-gate-title">
          <GateBar />
          <span>{pickText(CARD.gate.label, lang)}</span>
        </p>
        <p className="hero-gate-reason">{pickText(CARD.gate.reason, lang)}</p>
        <span className="hero-gate-chip">
          {pickText(CARD.gate.notProvided, lang)}
        </span>
      </div>
    </section>
  );
}
