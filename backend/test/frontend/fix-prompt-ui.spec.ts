import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// The fix prompt in the roadmap list: English first, Roman Urdu second, each
// with a Copy button, shown only when the item has one. The frontend has no
// test runner of its own, so its files are read by path (as the other specs do).
const FRONTEND = join(__dirname, '..', '..', '..', 'frontend', 'src');
const read = (...parts: string[]) => readFileSync(join(FRONTEND, ...parts), 'utf8');

describe('the fix prompt block', () => {
  const block = read('components', 'fix-prompt.tsx');
  it('shows English before Roman Urdu, each with a Copy button', () => {
    expect(block.indexOf('label="English"')).toBeGreaterThan(-1);
    expect(block.indexOf('label="English"')).toBeLessThan(
      block.indexOf('label="Roman Urdu"'),
    );
    expect(block).toContain('navigator.clipboard.writeText(text)');
    expect(block).toContain("t(lang, 'fixPromptHeading')");
  });
  it('is used by the roadmap list only when the item has a prompt', () => {
    const list = read('components', 'roadmap-list.tsx');
    expect(list).toContain('item.fixPrompt?.en ?');
    expect(list).toContain('<FixPrompt prompt={item.fixPrompt} lang={lang} />');
  });
  it('has its words in both languages', async () => {
    const copy = (await import(
      /* @vite-ignore */ join(FRONTEND, 'lib', 'stage-copy.ts')
    )) as { COPY: Record<string, { en: string; ur: string }> };
    for (const key of ['fixPromptHeading', 'fixPromptHint', 'copyPrompt', 'copiedPrompt']) {
      expect(copy.COPY[key].en.length).toBeGreaterThan(3);
      expect(copy.COPY[key].ur.length).toBeGreaterThan(3);
    }
    expect(copy.COPY.fixPromptHint.en).toContain('until you approve');
  });
});

describe('the mock roadmaps hold prompts in both languages', () => {
  it('every prompt in the mock bundles has English and Roman Urdu, and no key', () => {
    let seen = 0;
    for (const bundle of ['both', 'repo-only', 'supabase-only', 'url-only']) {
      const roadmap = JSON.parse(
        read('lib', 'mock-bundles', bundle, 'roadmap.json'),
      ) as { items: { kind: string; fixPrompt?: { en: string; ur: string } }[] };
      for (const item of roadmap.items) {
        if (!item.fixPrompt) continue;
        seen += 1;
        expect(item.fixPrompt.en).toContain('Show me the plan first');
        expect(item.fixPrompt.ur).toContain('Pehle mujhe plan dikhao');
        expect(JSON.stringify(item.fixPrompt)).not.toMatch(
          /sb_secret_|eyJ[A-Za-z0-9_-]{8,}/,
        );
      }
    }
    expect(seen).toBeGreaterThan(3);
  });
});

describe('the evidence of a public variable name (repo-env-name)', () => {
  it('is its own group, shown as path:line, with words in both languages and no "key hidden" line', async () => {
    const groups = read('components', 'evidence-groups.tsx');
    expect(groups).toContain("'repo-env-name': 'kindRepoName'");
    expect(groups).toContain(
      "kind === 'repo-file' || kind === 'repo-test-key' || kind === 'repo-env-name'",
    );
    // the "key is not shown" line is for keys only, never for a variable name
    expect(groups).toContain("{kind === 'repo-file' || kind === 'repo-test-key' ? (");
    expect(read('lib', 'stage.ts')).toContain(
      "'repo-file', 'repo-test-key', 'repo-env-name', 'repo-migration']",
    );
    const copy = (await import(
      /* @vite-ignore */ join(FRONTEND, 'lib', 'stage-copy.ts')
    )) as { COPY: Record<string, { en: string; ur: string }> };
    expect(copy.COPY.kindRepoName.en).toBe('Repository variable names');
    expect(copy.COPY.kindRepoName.ur.length).toBeGreaterThan(5);
  });
});
