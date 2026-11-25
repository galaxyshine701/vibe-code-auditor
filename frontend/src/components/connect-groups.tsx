'use client';

import type { Lang } from '@/lib/check-labels';
import { repoUrlProblem } from '@/lib/form';
import type { ConnectCheck, ConnectFields, GroupCheck } from '@/lib/form';
import { SecretInput } from './secret-input';

// The three optional groups of the start form (R76): a public GitHub repo (the
// one field of the hero), a live website (opened in place under the button) and
// the Supabase test project (the closed section at the bottom of the page).
// The same fields, the same rules (lib/form.ts), the same request. Each group
// says in a small chip where it stands: not used, still needs something (and
// what), or ready. The chip is text as well as colour.
type Pair = { en: string; ur: string };

const TEXT = {
  ready: { en: 'Ready', ur: 'Tayyar' },
  needs: { en: 'Needs more', ur: 'Aur chahiye' },
  idle: { en: 'Not used', ur: 'Use nahi hua' },
  repoTitle: { en: 'Public GitHub repo', ur: 'Public GitHub repo' },
  repoField: {
    en: 'Paste your GitHub repo link',
    ur: 'Apni GitHub repo ka link paste karein',
  },
  repoHint: {
    en: 'Public repositories only. The text files of the default branch are read; old commits are not.',
    ur: 'Sirf public repositories. Default branch ki text files parhi jati hain; purane commits nahi.',
  },
  repoBox: {
    en: 'This repository is public and I may scan its files.',
    ur: 'Ye repository public hai aur mujhe iski files scan karne ki ijazat hai.',
  },
  siteTitle: { en: 'Website', ur: 'Website' },
  siteHint: {
    en: 'Looks at what any visitor can read: the headers and the scripts of the front page. No login is used.',
    ur: 'Wohi dekhta hai jo har visitor parh sakta hai: pehle page ke headers aur scripts. Koi login use nahi hota.',
  },
  siteField: { en: 'Website address', ur: 'Website ka address' },
  siteSmall: {
    en: 'A public https address. Only the front page is looked at.',
    ur: 'Public https address. Sirf pehla page dekha jata hai.',
  },
  siteBox: {
    en: 'I may test this site. It is mine, or I have permission to check it.',
    ur: 'Mujhe is site ko test karne ki ijazat hai: ye meri hai, ya mujhe permission mili hai.',
  },
  dbTitle: { en: 'Supabase project', ur: 'Supabase project' },
  dbHint: {
    en: 'Tries to reach a canary row as another user and as a visitor. Use a disposable TEST project: the secret key is only for a test project, never for production.',
    ur: 'Doosre user aur visitor ki tarah canary row tak pahunchne ki koshish karta hai. Ek TEST project use karein jise aap hata sakein: secret key sirf test project ki dein, production ki kabhi nahi.',
  },
  dbUrl: { en: 'Project URL', ur: 'Project URL' },
  dbUrlSmall: {
    en: 'Plain origin only: https://<project-ref>.supabase.co',
    ur: 'Sirf origin: https://<project-ref>.supabase.co',
  },
  publishable: { en: 'Publishable key', ur: 'Publishable key' },
  secret: { en: 'Secret key', ur: 'Secret key' },
  never: {
    en: 'Never returned by the server.',
    ur: 'Server ise kabhi wapas nahi bhejta.',
  },
  dbBox: {
    en: 'I confirm this is a TEST project, not production. The auditor creates and removes temporary users and canary rows.',
    ur: 'Tasdeeq: ye TEST project hai, production nahi. Auditor temporary users aur canary rows banata aur hatata hai.',
  },
} as const satisfies Record<string, Pair>;

function GroupChip({ group, lang }: { group: GroupCheck; lang: Lang }) {
  if (group.state === 'complete') {
    return <span className="source-chip source-ready">{TEXT.ready[lang]}</span>;
  }
  if (group.state === 'partial') {
    return <span className="source-chip source-needs">{TEXT.needs[lang]}</span>;
  }
  return <span className="source-chip source-idle">{TEXT.idle[lang]}</span>;
}

type GroupProps = {
  fields: ConnectFields;
  check: ConnectCheck;
  onChange: (patch: Partial<ConnectFields>) => void;
  lang?: Lang;
};

/** The one field of the hero: a public GitHub repository and the box that says it may be scanned. */
export function RepoGroup({ fields, check, onChange, lang = 'en' }: GroupProps) {
  const repoProblem = repoUrlProblem(fields.repoUrl, lang);
  return (
    <fieldset
      className="source-group"
      data-group="repo"
      data-state={check.repo.state}
    >
      <legend className="source-legend">
        <span className="source-title">{TEXT.repoTitle[lang]}</span>
        <GroupChip group={check.repo} lang={lang} />
      </legend>
      <label className="field">
        <span>{TEXT.repoField[lang]}</span>
        <input
          id="repo-url"
          type="url"
          value={fields.repoUrl}
          onChange={(event) => onChange({ repoUrl: event.target.value })}
          placeholder="https://github.com/owner/repo"
          autoComplete="off"
          spellCheck={false}
          inputMode="url"
          aria-invalid={repoProblem ? true : undefined}
          aria-describedby={repoProblem ? 'repo-url-problem' : 'repo-hint'}
        />
        <small id="repo-hint">{TEXT.repoHint[lang]}</small>
        {repoProblem ? (
          <small className="field-problem" id="repo-url-problem" role="status">
            {repoProblem}
          </small>
        ) : null}
      </label>
      <label className="check-row">
        <input
          type="checkbox"
          checked={fields.confirmRepoAccess}
          onChange={(event) =>
            onChange({ confirmRepoAccess: event.target.checked })
          }
        />
        <span>{TEXT.repoBox[lang]}</span>
      </label>
    </fieldset>
  );
}

export function WebsiteGroup({ fields, check, onChange, lang = 'en' }: GroupProps) {
  return (
    <fieldset
      className="source-group"
      data-group="website"
      data-state={check.website.state}
      aria-describedby="website-hint"
    >
      <legend className="source-legend">
        <span className="source-title">{TEXT.siteTitle[lang]}</span>
        <GroupChip group={check.website} lang={lang} />
      </legend>
      <p className="muted small" id="website-hint">
        {TEXT.siteHint[lang]}
      </p>
      <label className="field">
        <span>
          {TEXT.siteField[lang]} <em>https</em>
        </span>
        <input
          id="website-url"
          type="url"
          value={fields.websiteUrl}
          onChange={(event) => onChange({ websiteUrl: event.target.value })}
          placeholder="https://www.example-shop.com"
          autoComplete="off"
          spellCheck={false}
          inputMode="url"
        />
        <small>{TEXT.siteSmall[lang]}</small>
      </label>
      <label className="check-row">
        <input
          type="checkbox"
          checked={fields.confirmSiteAccess}
          onChange={(event) =>
            onChange({ confirmSiteAccess: event.target.checked })
          }
        />
        <span>{TEXT.siteBox[lang]}</span>
      </label>
    </fieldset>
  );
}

export function SupabaseGroup({ fields, check, onChange, lang = 'en' }: GroupProps) {
  return (
    <fieldset
      className="source-group"
      data-group="supabase"
      data-state={check.supabase.state}
      aria-describedby="supabase-hint"
    >
      <legend className="source-legend">
        <span className="source-title">{TEXT.dbTitle[lang]}</span>
        <GroupChip group={check.supabase} lang={lang} />
      </legend>
      <p className="muted small" id="supabase-hint">
        {TEXT.dbHint[lang]}
      </p>
      <label className="field">
        <span>{TEXT.dbUrl[lang]}</span>
        <input
          id="project-url"
          type="url"
          value={fields.projectUrl}
          onChange={(event) => onChange({ projectUrl: event.target.value })}
          placeholder="https://example-project.supabase.co"
          autoComplete="off"
          spellCheck={false}
          inputMode="url"
        />
        <small>{TEXT.dbUrlSmall[lang]}</small>
      </label>

      <div className="field-row">
        <label className="field">
          <span>{TEXT.publishable[lang]}</span>
          <SecretInput
            value={fields.anonKey}
            onChange={(event) => onChange({ anonKey: event.target.value })}
            maxLength={4096}
          />
          <small>{TEXT.never[lang]}</small>
        </label>

        <label className="field">
          <span>{TEXT.secret[lang]}</span>
          <SecretInput
            value={fields.serviceKey}
            onChange={(event) => onChange({ serviceKey: event.target.value })}
            maxLength={4096}
          />
          <small>{TEXT.never[lang]}</small>
        </label>
      </div>

      <label className="check-row">
        <input
          type="checkbox"
          checked={fields.confirmTestProject}
          onChange={(event) =>
            onChange({ confirmTestProject: event.target.checked })
          }
        />
        <span>{TEXT.dbBox[lang]}</span>
      </label>
    </fieldset>
  );
}
