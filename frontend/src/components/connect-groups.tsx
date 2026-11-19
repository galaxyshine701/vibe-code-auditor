'use client';

import type { ConnectCheck, ConnectFields, GroupCheck } from '@/lib/form';
import { SecretInput } from './secret-input';

// The two optional groups of the Connect form (R76): the website, and the
// Supabase project. Each says in a small chip where it stands: not used, still
// needs something (and what), or ready. The chip is text as well as colour.
function GroupChip({ group }: { group: GroupCheck }) {
  if (group.state === 'complete') {
    return <span className="source-chip source-ready">Ready</span>;
  }
  if (group.state === 'partial') {
    return <span className="source-chip source-needs">Needs more</span>;
  }
  return <span className="source-chip source-idle">Not used</span>;
}

export function ConnectGroups({
  fields,
  check,
  onChange,
}: {
  fields: ConnectFields;
  check: ConnectCheck;
  onChange: (patch: Partial<ConnectFields>) => void;
}) {
  return (
    <div className="source-groups">
      <p className="muted small source-lede">
        Each group is optional, but at least one must be complete.
      </p>

      <fieldset
        className="source-group"
        data-state={check.website.state}
        aria-describedby="website-hint"
      >
        <legend className="source-legend">
          <span className="source-title">Website</span>
          <GroupChip group={check.website} />
        </legend>
        <p className="muted small" id="website-hint">
          Looks at what any visitor can read: the headers and the scripts of
          the front page. No login is used.
        </p>
        <label className="field">
          <span>
            Website address <em>https</em>
          </span>
          <input
            type="url"
            value={fields.websiteUrl}
            onChange={(event) => onChange({ websiteUrl: event.target.value })}
            placeholder="https://www.example-shop.com"
            autoComplete="off"
            spellCheck={false}
            inputMode="url"
          />
          <small>
            A public https address. Only the front page is looked at.
          </small>
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

      <fieldset
        className="source-group"
        data-state={check.supabase.state}
        aria-describedby="supabase-hint"
      >
        <legend className="source-legend">
          <span className="source-title">Supabase project</span>
          <GroupChip group={check.supabase} />
        </legend>
        <p className="muted small" id="supabase-hint">
          Tries to reach a canary row as another user and as a visitor. Use a
          disposable <strong>TEST</strong> project: the secret key is only for
          a test project, never for production.
        </p>
        <label className="field">
          <span>Project URL</span>
          <input
            type="url"
            value={fields.projectUrl}
            onChange={(event) => onChange({ projectUrl: event.target.value })}
            placeholder="https://example-project.supabase.co"
            autoComplete="off"
            spellCheck={false}
            inputMode="url"
          />
          <small>
            Plain origin only: https://&lt;project-ref&gt;.supabase.co
          </small>
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
            I confirm this is a <strong>TEST project</strong>, not production.
            The auditor creates and removes temporary users and canary rows.
          </span>
        </label>
      </fieldset>

      {check.website.state === 'partial' ||
      check.supabase.state === 'partial' ? (
        <p className="source-note" role="status">
          {check.website.state === 'partial'
            ? `Website still needs: ${check.website.missing.join(', ')}. `
            : ''}
          {check.supabase.state === 'partial'
            ? `Supabase still needs: ${check.supabase.missing.join(', ')}.`
            : ''}
        </p>
      ) : null}
    </div>
  );
}
