// Same text as frontend/src/lib/coverage.ts. A test checks that they match.
export const COVERAGE = {
  statement:
    'This result covers table data access only: read, update and delete as another signed-in user, and read as a visitor.',
  checked:
    "For each table the project's REST API lists, another signed-in user tries to read, update and delete a temporary canary row. A visitor without login tries to read it. The owner reads it as a control.",
  inconclusive:
    'Tables where no owner column can be detected are reported as inconclusive.',
  notCovered: [
    'Inserts by other users or visitors',
    'Database functions (RPC)',
    'Storage',
    'Realtime',
    'Edge Functions',
    'Auth settings',
    'Other schemas',
    'Column-level rules',
  ],
  limits: [
    'Updates are tested only on tables that have a text column.',
    'Tables whose names contain characters other than letters, digits or underscore are skipped.',
    'A table with more than 100 rows stops the audit.',
  ],
} as const;
