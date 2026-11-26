import type { Lang } from '@/lib/check-labels';
import { MEANING, SECTIONS, pickText } from '@/lib/hero-copy';
import { SectionHead } from './section-head';
import { VerdictBadge } from './verdict';

// "What the words mean": the three verdict words as three coloured cards, one
// line each, and what a clean result means.
const KINDS = ['leaked', 'inconclusive', 'blocked'] as const;
const VERDICT = {
  leaked: 'LEAKED',
  inconclusive: 'INCONCLUSIVE',
  blocked: 'BLOCKED',
} as const;

export function WordMeanings({ lang }: { lang: Lang }) {
  return (
    <section className="home-section words" aria-labelledby="words-title">
      <SectionHead id="words-title" head={SECTIONS.words} lang={lang} />
      <ul className="word-cards glass-wrap">
        {KINDS.map((kind) => (
          <li className={`word-card word-${kind} glass`} key={kind}>
            <VerdictBadge verdict={VERDICT[kind]} />
            <h3>{pickText(MEANING[kind].word, lang)}</h3>
            <p>{pickText(MEANING[kind].body, lang)}</p>
          </li>
        ))}
      </ul>
      <p className="words-clean">
        {pickText(MEANING.cleanLead, lang)}{' '}
        <strong>{pickText(MEANING.clean, lang)}</strong>.
      </p>
    </section>
  );
}
