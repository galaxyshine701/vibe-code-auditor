// The product name. This is the ONLY place that spells it: renaming the
// product is a change of this one line. (public/offline.html and public/sw.js
// are plain files that cannot import it; they do not say the name in code.)
export const PROJECT_NAME = 'Gatecheck';

// The line under the name in the header and the footer.
export const PROJECT_TAGLINE = 'Launch readiness checks';

// The description of the page (<meta>) and of the web app manifest. It names the
// three checks and the way the result is worded: "by these checks".
export const PROJECT_DESCRIPTION =
  'Checks a live site, Supabase table access (by replaying two test users) and a public GitHub repo, then gives one gate result, by these checks, with the evidence.';
