import type { ColumnInfo, TableInfo } from './types.js';

const SAFE_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

interface OpenApiProperty {
  type?: string;
  format?: string;
  description?: string;
  default?: unknown;
}
interface OpenApiDefinition {
  required?: string[];
  properties?: Record<string, OpenApiProperty>;
}

/**
 * Turns the PostgREST OpenAPI document into a list of tables with columns.
 * Supports the Swagger 2 shape ("definitions") and OpenAPI 3 ("components.schemas").
 * Tables with unusual names are skipped so a name can never break a URL or SQL text.
 */
export function parseTables(doc: unknown): TableInfo[] {
  const root = (doc ?? {}) as {
    definitions?: Record<string, OpenApiDefinition>;
    components?: { schemas?: Record<string, OpenApiDefinition> };
  };
  const defs = root.definitions ?? root.components?.schemas ?? {};
  const tables: TableInfo[] = [];
  for (const [name, def] of Object.entries(defs)) {
    if (!SAFE_NAME.test(name)) continue;
    const required = new Set(def.required ?? []);
    const columns: ColumnInfo[] = [];
    for (const [colName, prop] of Object.entries(def.properties ?? {})) {
      if (!SAFE_NAME.test(colName)) continue;
      const description = prop.description ?? '';
      columns.push({
        name: colName,
        type: prop.type ?? 'string',
        format: prop.format ?? '',
        required: required.has(colName),
        hasDefault: prop.default !== undefined,
        isPrimaryKey: description.includes('Primary Key'),
        referencesUsers: /<fk table='users'/.test(description),
      });
    }
    tables.push({ name, columns });
  }
  return tables;
}

/**
 * Finds the column that says "this row belongs to user X":
 * user_id, owner_id, or id for a profile table whose primary key points at auth.users.
 * Returns null when there is none.
 */
export function findOwnerColumn(table: TableInfo): string | null {
  for (const candidate of ['user_id', 'owner_id']) {
    if (table.columns.some((c) => c.name === candidate)) return candidate;
  }
  const id = table.columns.find((c) => c.name === 'id');
  const looksLikeProfile = /^profiles?$/i.test(table.name);
  if (id && id.isPrimaryKey && (id.referencesUsers || looksLikeProfile)) {
    return 'id';
  }
  return null;
}

/** A text column the attacker can try to change (not the key, not the owner). */
export function findEditableTextColumn(
  table: TableInfo,
  ownerColumn: string,
): string | null {
  const col = table.columns.find(
    (c) =>
      c.type === 'string' &&
      !c.isPrimaryKey &&
      c.name !== ownerColumn &&
      !['uuid', 'timestamp with time zone', 'date'].includes(c.format),
  );
  return col?.name ?? null;
}

/** Harmless dummy values for every column the database insists on. */
export function buildCanaryRow(
  table: TableInfo,
  ownerColumn: string,
  ownerId: string,
  makeUuid: () => string,
): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  for (const col of table.columns) {
    if (col.name === ownerColumn) {
      row[col.name] = ownerId;
    } else if (col.required && !col.hasDefault) {
      row[col.name] = dummyValue(col, makeUuid);
    }
  }
  // Mark the canary so a human can recognise it if cleanup ever fails.
  const label = findEditableTextColumn(table, ownerColumn);
  if (label && !(label in row)) row[label] = 'vca-canary';
  return row;
}

function dummyValue(col: ColumnInfo, makeUuid: () => string): unknown {
  if (col.format === 'uuid') return makeUuid();
  if (col.format.startsWith('timestamp')) return new Date().toISOString();
  if (col.format === 'date') return new Date().toISOString().slice(0, 10);
  switch (col.type) {
    case 'integer':
    case 'number':
      return 0;
    case 'boolean':
      return false;
    case 'object':
    case 'array':
      return col.type === 'array' ? [] : {};
    default:
      return 'vca-canary';
  }
}
