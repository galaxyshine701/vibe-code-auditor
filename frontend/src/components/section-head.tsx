import type { Lang } from '@/lib/check-labels';
import { pickText } from '@/lib/hero-copy';

// The one style of a section heading on the home page: a small label, then the
// heading, both at the left edge of the container.
export function SectionHead({
  id,
  head,
  lang,
}: {
  id: string;
  head: { label: { en: string; ur: string }; title: { en: string; ur: string } };
  lang: Lang;
}) {
  return (
    <header className="section-head">
      <p className="section-label">{pickText(head.label, lang)}</p>
      <h2 id={id}>{pickText(head.title, lang)}</h2>
    </header>
  );
}
