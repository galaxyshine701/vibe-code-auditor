/**
 * Rule 1 of Repo Scan: a migration that creates a table in the public schema
 * and no migration (in any file) that turns on row level security for it.
 *
 * The answer is never "leaked": the repository does not say what the real
 * database looks like. Row level security may be enabled elsewhere (in the
 * Supabase dashboard, or by code that runs SQL), so the result is only a
 * warning sign (INCONCLUSIVE). Plain code, no model.
 *
 * How it reads a migration:
 *  - comments, string literals and dollar-quoted bodies are blanked first (same
 *    length, new lines kept), so a word inside them never counts and the line
 *    numbers stay right;
 *  - quoted names ("Orders") keep their case, plain names are lowercased, and
 *    "public.orders", "orders" and "\"public\".\"orders\"" are the same table;
 *  - a table of another schema (auth., storage., private.) is not looked at,
 *    and neither is a temporary table;
 *  - the files are read in path order (migration names start with a date), so
 *    a table that is created and later dropped is not reported, and one that is
 *    enabled in a different file than it was created in is not reported.
 */

export interface MigrationFile {
  path: string;
  text: string;
}

export interface MigrationTableHit {
  /** the table name, as SQL would compare it (no schema, no quotes) */
  table: string;
  /** the file with the first "create table" */
  path: string;
  /** the 1-based line of that "create table" */
  line: number;
}

/** The most tables that are listed (the rest are only counted as a cut). */
export const MAX_MIGRATION_HITS = 50;

/** A .sql file in a folder called "migrations". */
export function isMigrationFile(path: string): boolean {
  return /(^|\/)migrations\/.*\.sql$/i.test(path);
}

/**
 * Blank out comments, strings and dollar-quoted text. Quoted identifiers are
 * kept. The result has the same length as the input, and every new line stays.
 */
export function maskSql(sql: string): string {
  const out: string[] = [];
  const blank = (from: number, to: number) => {
    for (let k = from; k < to; k += 1) {
      out.push(sql[k] === '\n' ? '\n' : ' ');
    }
  };
  let i = 0;
  while (i < sql.length) {
    const c = sql[i];
    const next = sql[i + 1];
    if (c === '-' && next === '-') {
      let j = i;
      while (j < sql.length && sql[j] !== '\n') j += 1;
      blank(i, j);
      i = j;
    } else if (c === '/' && next === '*') {
      let depth = 1;
      let j = i + 2;
      while (j < sql.length && depth > 0) {
        if (sql[j] === '/' && sql[j + 1] === '*') {
          depth += 1;
          j += 2;
        } else if (sql[j] === '*' && sql[j + 1] === '/') {
          depth -= 1;
          j += 2;
        } else {
          j += 1;
        }
      }
      blank(i, j);
      i = j;
    } else if (c === "'") {
      // E'...' strings also escape with a backslash
      const escaped = i > 0 && /[eE]/.test(sql[i - 1]) && !/[A-Za-z0-9_]/.test(sql[i - 2] ?? ' ');
      let j = i + 1;
      while (j < sql.length) {
        if (escaped && sql[j] === '\\') {
          j += 2;
        } else if (sql[j] === "'" && sql[j + 1] === "'") {
          j += 2;
        } else if (sql[j] === "'") {
          j += 1;
          break;
        } else {
          j += 1;
        }
      }
      blank(i, j);
      i = j;
    } else if (c === '"') {
      let j = i + 1;
      while (j < sql.length) {
        if (sql[j] === '"' && sql[j + 1] === '"') j += 2;
        else if (sql[j] === '"') {
          j += 1;
          break;
        } else j += 1;
      }
      for (let k = i; k < j; k += 1) out.push(sql[k]);
      i = j;
    } else if (c === '$' && !/[A-Za-z0-9_]/.test(sql[i - 1] ?? ' ')) {
      const tag = /^\$[A-Za-z_]?[A-Za-z0-9_]*\$/.exec(sql.slice(i, i + 64));
      if (tag) {
        const close = sql.indexOf(tag[0], i + tag[0].length);
        const end = close === -1 ? sql.length : close + tag[0].length;
        blank(i, end);
        i = end;
      } else {
        out.push(c);
        i += 1;
      }
    } else {
      out.push(c);
      i += 1;
    }
  }
  return out.join('');
}

const IDENT = String.raw`(?:"(?:[^"]|"")+"|[A-Za-z_][A-Za-z0-9_$]*)`;
const NAME = String.raw`${IDENT}(?:\s*\.\s*${IDENT}){0,2}`;

const CREATE = new RegExp(
  String.raw`^\s*create\s+(?:(?:unlogged)\s+)?table\s+(?:if\s+not\s+exists\s+)?(${NAME})`,
  'i',
);
const ALTER = new RegExp(
  String.raw`^\s*alter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?(${NAME})(?![A-Za-z0-9_$."])([\s\S]*)$`,
  'i',
);
const ENABLE_RLS = /\benable\s+row\s+level\s+security\b/i;
const DROP = new RegExp(
  String.raw`^\s*drop\s+table\s+(?:if\s+exists\s+)?(${NAME}(?:\s*,\s*${NAME})*)`,
  'i',
);

/** "Public"."Orders" -> ["Public", "Orders"]; plain parts are lowercased. */
function parts(name: string): string[] {
  const result: string[] = [];
  const re = new RegExp(IDENT, 'g');
  for (const m of name.matchAll(re)) {
    const raw = m[0];
    result.push(
      raw.startsWith('"') ? raw.slice(1, -1).replace(/""/g, '"') : raw.toLowerCase(),
    );
  }
  return result;
}

/** The table name when the table is in the public schema (or has no schema). */
function publicTable(name: string): string | null {
  const p = parts(name);
  if (p.length === 1) return p[0];
  if (p.length === 2 && p[0] === 'public') return p[1];
  return null;
}

/** Statements of the masked text with where each one starts. */
function statements(masked: string): { text: string; start: number }[] {
  const result: { text: string; start: number }[] = [];
  let start = 0;
  for (let i = 0; i <= masked.length; i += 1) {
    if (i === masked.length || masked[i] === ';') {
      result.push({ text: masked.slice(start, i), start });
      start = i + 1;
    }
  }
  return result;
}

const lineAt = (text: string, offset: number): number => {
  let line = 1;
  for (let i = text.indexOf('\n'); i !== -1 && i < offset; i = text.indexOf('\n', i + 1)) {
    line += 1;
  }
  return line;
};

/**
 * The tables that a migration creates (public schema) and that no migration
 * turns row level security on for. In the order they were created.
 */
export function findTablesWithoutRls(
  files: readonly MigrationFile[],
): { hits: MigrationTableHit[]; cut: boolean } {
  const created = new Map<string, MigrationTableHit>();
  const enabled = new Set<string>();
  const ordered = [...files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  for (const file of ordered) {
    const masked = maskSql(file.text);
    for (const statement of statements(masked)) {
      const create = CREATE.exec(statement.text);
      if (create) {
        const table = publicTable(create[1]);
        if (table !== null && !created.has(table)) {
          const keyword = statement.text.search(/\S/);
          created.set(table, {
            table,
            path: file.path,
            line: lineAt(file.text, statement.start + Math.max(keyword, 0)),
          });
        }
        continue;
      }
      const alter = ALTER.exec(statement.text);
      if (alter) {
        const table = publicTable(alter[1]);
        if (table !== null && ENABLE_RLS.test(alter[2])) enabled.add(table);
        continue;
      }
      const drop = DROP.exec(statement.text);
      if (drop) {
        for (const name of drop[1].match(new RegExp(NAME, 'g')) ?? []) {
          const table = publicTable(name);
          if (table !== null) {
            created.delete(table);
            enabled.delete(table);
          }
        }
      }
    }
  }
  const all = [...created.values()].filter((hit) => !enabled.has(hit.table));
  return {
    hits: all.slice(0, MAX_MIGRATION_HITS),
    cut: all.length > MAX_MIGRATION_HITS,
  };
}
