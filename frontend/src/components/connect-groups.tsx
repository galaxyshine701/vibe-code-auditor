'use client';

import { repoUrlProblem } from '@/lib/form';
import type { ConnectCheck, ConnectFields, GroupCheck } from '@/lib/form';
import { SecretInput } from './secret-input';

// The three optional groups of the Connect form (R76): a public GitHub repo,
// the website, and the Supabase project. The repository is the first thing the
// home page asks for (RepoGroup, in the main box). The website and the Supabase
// project sit under "Add more checks (optional)" (MoreChecks). Nothing was
// removed: the same fields, the same rules (lib/form.ts), the same request.
// Each group says in a small chip where it stands: not used, still needs
// something (and what), or ready. The chip is text as well as colour.
function GroupChip({ group }: { group: GroupCheck }) {
  if (group.state === 'complete') {
    return <span className="source-chip source-ready">Ready</span>;
  }
  if (group.state === 'partial') {
    return <span className="source-chip source-needs">Needs more</span>;
  }
  return <span className="source-chip source-idle">Not used</span>;
}

type GroupProps = {
  fields: ConnectFields;
  check: ConnectCheck;
  onChange: (patch: Partial<ConnectFields>) => void;
};

/** The main box: a public GitHub repository and the box that says it may be scanned. */
export function RepoGroup({ fields, check, onChange }: GroupProps) {
  const repoProblem = repoUrlProblem(fields.repoUrl);
  return (
    <fieldset
      className="source-group"
      data-group="repo"
      data-state={check.repo.state}
      aria-describedby="repo-hint"
    >
      <legend className="source-legend">
        <span className="source-title">Public GitHub repo</span>
        <GroupChip group={check.repo} />
      </legend>
      <p className="muted small" id="repo-hint">
        Reads the text files of a public repository and looks for a Supabase
        secret key left in the code. Only the default branch, as it is now.
        The old commits are not read.
      </p>
      <label className="field">
        <span>Repository address</span>
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
          aria-describedby={repoProblem ? 'repo-url-problem' : undefined}
        />
        <small>
          https://github.com/&lt;owner&gt;/&lt;repo&gt;. A private repository
          can not be read.
        </small>
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
        <span>This repository is public and I may scan its files.</span>
      </label>
    </fieldset>
  );
}

function WebsiteGroup({ fields, check, onChange }: GroupProps) {
  return (
    <fieldset
      className="source-group"
      data-group="website"
      data-state={check.website.state}
      aria-describedby="website-hint"
    >
      <legend className="source-legend">
        <span className="source-title">Website</span>
        <GroupChip group={check.website} />
      </legend>
      <p className="muted small" id="website-hint">
        Looks at what any visitor can read: the headers and the scripts of the
        front page. No login is used.
      </p>
      <label className="field">
        <span>
          Website address <em>https</em>
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
        <small>A public https address. Only the front page is looked at.</small>
      </label>
      <label className="check-row">
        <input
          type="checkbox"
          checked={fields.confirmSiteAccess}
          onChange={(event) =>
            onChange({ confirmSiteAccess: event.target.checked })
          }
        />
        <span>
          I may test this site. It is mine, or I have permission to check it.
        </span>
      </label>
    </fieldset>
  );
}

function SupabaseGroup({ fields, check, onChange }: GroupProps) {
  return (
    <fieldset
      className="source-group"
      data-group="supabase"
      data-state={check.supabase.state}
      aria-describedby="supabase-hint"
    >
      <legend className="source-legend">
        <span className="source-title">Supabase project</span>
        <GroupChip group={check.supabase} />
      </legend>
      <p className="muted small" id="supabase-hint">
        Tries to reach a canary row as another user and as a visitor. Use a
        disposable <strong>TEST</strong> project: the secret key is only for a
        test project, never for production.
      </p>
      <label className="field">
        <span>Project URL</span>
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
        <small>Plain origin only: https://&lt;project-ref&gt;.supabase.co</small>
      </label>

      <div className="field-row">
        <label className="field">
          <span>Publishable key</span>
          <SecretInput
            value={fields.anonKey}
            onChange={(event) => onChange({ anonKey: event.target.value })}
            maxLength={4096}
          />
          <small>Never returned by the server.</small>
        </label>

        <label className="field">
          <span>Secret key</span>
          <SecretInput
            value={fields.serviceKey}
            onChange={(event) => onChange({ serviceKey: event.target.value })}
            maxLength={4096}
          />
          <small>Never returned by the server.</small>
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
        <span>
          I confirm this is a <strong>TEST project</strong>, not production. The
          auditor creates and removes temporary users and canary rows.
        </span>
      </label>
    </fieldset>
  );
}

/**
 * "Add more checks (optional)": closed at first. It opens when the visitor
 * opens it, when a chip points at it, and for as long as something is typed in
 * it (a half-filled group must never be hidden: the start button waits for it).
 */
export function MoreChecks({
  fields,
  check,
  onChange,
  open,
  onOpenChange,
}: GroupProps & { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <details
      className="more-checks"
      id="more-checks"
      open={open}
      onToggle={(event) => onOpenChange(event.currentTarget.open)}
    >
      <summary className="more-checks-summary">
        Add more checks <em>optional</em>
      </summary>
      <div className="source-groups">
        <p className="muted small source-lede">
          Anything you fill in here must be completed, or cleared, before the
          start.
        </p>
        <label className="field">
          <span>
            Label <em>optional</em>
          </span>
          <input
            type="text"
            value={fields.label}
            onChange={(event) => onChange({ label: event.target.value })}
            placeholder="Example shop (test project)"
            maxLength={120}
            autoComplete="off"
          />
          <small>Used only to name this run. Maximum 120 characters.</small>
        </label>
        <WebsiteGroup fields={fields} check={check} onChange={onChange} />
        <SupabaseGroup fields={fields} check={check} onChange={onChange} />
      </div>
    </details>
  );
}

/** What a group still needs. It stays visible while "Add more checks" is closed. */
export function GroupsNote({ check }: { check: ConnectCheck }) {
  if (
    check.website.state !== 'partial' &&
    check.supabase.state !== 'partial' &&
    check.repo.state !== 'partial'
  ) {
    return null;
  }
  return (
    <p className="source-note" role="status">
      {check.repo.state === 'partial'
        ? `Repository still needs: ${check.repo.missing.join(', ')}. `
        : ''}
      {check.website.state === 'partial'
        ? `Website still needs: ${check.website.missing.join(', ')}. `
        : ''}
      {check.supabase.state === 'partial'
        ? `Supabase still needs: ${check.supabase.missing.join(', ')}.`
        : ''}
    </p>
  );
}
