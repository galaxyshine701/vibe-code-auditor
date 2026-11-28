import Link from 'next/link';
import type { Lang } from '@/lib/check-labels';
import { t } from '@/lib/stage-copy';

// The empty and special states of R83, with the way to fill them (R76):
//  - Supabase only: "Add a website address to check the site too." in place of
//    the site evidence (the website checks were not provided);
//  - website only: no table was checked. This is not "No findings" (R40 is about
//    tables), and it comes with the invitation to add Supabase details.
// Both lead to a new audit: the Connect form has the two groups. A website is
// added with a new audit, not to this one.
export function InviteWebsite({ lang }: { lang: Lang }) {
  return (
    <p className="optional-line" id="invite-website">
      {t(lang, 'noSite')}{' '}
      <Link href="/" className="text-link">
        {t(lang, 'newAudit')}
      </Link>
    </p>
  );
}

export function NoTables({ lang }: { lang: Lang }) {
  return (
    <p className="optional-line" id="no-tables">
      {t(lang, 'noTables')} {t(lang, 'inviteSupabase')}{' '}
      <Link href="/#advanced-supabase" className="text-link">
        {t(lang, 'newAudit')}
      </Link>
    </p>
  );
}
