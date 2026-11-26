import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { fixRepoSecretPrompt } from '../../src/stages/fix-prompts.js';

// "A fix prompt, for example" beside the example result: the very text the
// backend makes for a secret key in a file, with a language switch and a copy
// button. Nothing of it is written by the page.
const FRONTEND = join(__dirname, '..', '..', '..', 'frontend');
const SRC = join(FRONTEND, 'src');
const requireFrontend = createRequire(join(FRONTEND, 'package.json'));
const React = requireFrontend('react') as typeof import('react');
const { renderToStaticMarkup } = requireFrontend(
  'react-dom/server',
) as typeof import('react-dom/server');
const sample = (await import(
  /* @vite-ignore */ pathToFileURL(join(SRC, 'components', 'prompt-sample.tsx')).href
)) as {
  SAMPLE_PROMPT: { en: string; ur: string };
  PromptSample: (p: { lang: 'en' | 'ur' }) => unknown;
};
const source = readFileSync(
  join(SRC, 'components', 'prompt-sample.tsx'),
  'utf8',
);

describe('the example of a fix prompt', () => {
  const made = fixRepoSecretPrompt('src/lib/supabase.ts', 'secret-key');

  it('is the text fixRepoSecretPrompt makes, in English and Roman Urdu', () => {
    expect(sample.SAMPLE_PROMPT).toEqual(made);
  });

  it('is read from the example bundle, not written in the component', () => {
    expect(source).toContain('@/lib/mock-bundles/repo-only/roadmap.json');
    expect(source).not.toContain('was found in the file');
  });

  it('shows the prompt of the chosen language, with the switch and a copy button', () => {
    for (const lang of ['en', 'ur'] as const) {
      const out = renderToStaticMarkup(
        React.createElement(sample.PromptSample as never, { lang }),
      );
      expect(out).toContain(made[lang].slice(0, 20));
      expect(out).toContain('Roman Urdu');
      expect(out).toContain(lang === 'en' ? 'Copy prompt' : 'Prompt copy karein');
    }
    expect(source).toContain('<CopyButton');
    expect(source).toContain('text={SAMPLE_PROMPT[shown]}');
  });

  it('stands beside the example result', () => {
    const page = readFileSync(join(SRC, 'app', 'page.tsx'), 'utf8');
    expect(page.indexOf('<PromptSample')).toBeGreaterThan(page.indexOf('GET.points'));
    expect(page.indexOf('<PromptSample')).toBeLessThan(page.indexOf('<HeroCard'));
  });

  it('holds no key', () => {
    expect(JSON.stringify(sample.SAMPLE_PROMPT)).not.toMatch(
      /sb_(secret|publishable)_[A-Za-z0-9]|eyJ[A-Za-z0-9_-]{10,}/,
    );
  });
});
