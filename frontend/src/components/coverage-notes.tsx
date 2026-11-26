import type { Lang } from '@/lib/check-labels';
import { COVERAGE, COVERAGE_UR } from '@/lib/coverage';

const WORDS = {
  summary: { en: 'Checked, not covered and limits', ur: 'Kya check hua, kya nahi, aur hadein' },
  checked: { en: 'Checked', ur: 'Check hua' },
  notCovered: { en: 'Not covered', ur: 'Shamil nahi' },
  limits: { en: 'Limits', ur: 'Hadein' },
} as const;

/** The details of the table check, closed. */
export function CoverageNotes({ lang = 'en' }: { lang?: Lang }) {
  const text = lang === 'ur' ? COVERAGE_UR : COVERAGE;
  return (
    <details className="disclosure">
      <summary>{WORDS.summary[lang]}</summary>
      <div className="disclosure-body">
        <h3>{WORDS.checked[lang]}</h3>
        <p>{text.checked}</p>
        <p>{text.inconclusive}</p>
        <h3>{WORDS.notCovered[lang]}</h3>
        <ul>
          {text.notCovered.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
        <h3>{WORDS.limits[lang]}</h3>
        <ul>
          {text.limits.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </div>
    </details>
  );
}
