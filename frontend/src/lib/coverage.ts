// What the checks cover. Taken from the Prover code (backend/src/prover):
// prover.ts checkTable, schema.ts parseTables / findEditableTextColumn.
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

/** The same words in Roman Urdu. */
export const COVERAGE_UR = {
  statement:
    'Ye nateeja sirf table data ke access ka hai: doosre login user ki tarah parhna, badalna aur delete karna, aur visitor ki tarah parhna.',
  checked:
    'Project ki REST API jitne tables dikhati hai, har ek par doosra login user ek temporary canary row ko parhne, badalne aur delete karne ki koshish karta hai. Bina login wala visitor use parhne ki koshish karta hai. Owner use control ke taur par parhta hai.',
  inconclusive:
    'Jin tables mein owner column na mile wo inconclusive aate hain.',
  notCovered: [
    'Doosre users ya visitors ke inserts',
    'Database functions (RPC)',
    'Storage',
    'Realtime',
    'Edge Functions',
    'Auth settings',
    'Doosre schemas',
    'Column-level rules',
  ],
  limits: [
    'Updates sirf un tables par test hote hain jin mein text column ho.',
    'Jin tables ke naam mein harf, hindsay ya underscore ke ilawa kuch ho wo chhod diye jate hain.',
    'Kisi table mein 100 se zyada rows hon to audit ruk jata hai.',
  ],
} as const;

