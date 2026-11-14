// What the checks cover. Taken from the Prover code (backend/src/prover):
// prover.ts checkTable, schema.ts parseTables / findEditableTextColumn.
export const COVERAGE = {
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
