import { randomUUID } from 'node:crypto';
import type {
  Caller,
  Gateway,
  RestMethod,
  RestResult,
  RowFilter,
} from '../../src/prover/gateway.js';

type Row = Record<string, unknown>;

/**
 * off = no protection, own = owner only, public-read = anyone may read, nobody may write,
 * own-no-insert = owner may read/change/delete but not insert (like a fix without an INSERT policy),
 * deny-all = nobody at all, not even the owner
 */
export type FakePolicy =
  'off' | 'own' | 'public-read' | 'own-no-insert' | 'deny-all';

export interface FakeTable {
  name: string;
  policy: FakePolicy;
  ownerColumn: string | null;
  /** extra rows that already exist before the run */
  rows?: Row[];
  /** make inserting the canary fail with this message */
  insertError?: string;
  /** leave out the text column, so the Prover cannot test UPDATE */
  noTextColumn?: boolean;
  /** answer the owner's INSERT with 409 Conflict (a failure that says nothing about policies) */
  insertConflict?: boolean;
}

export interface FakeOptions {
  failDeleteUser?: boolean;
  throwOnRest?: boolean;
}

/** An in-memory pretend Supabase project. Never touches the network. */
export class FakeGateway implements Gateway {
  readonly users = new Map<string, { email: string; password: string }>();
  readonly tokens = new Map<string, string>();
  readonly data = new Map<string, Row[]>();
  readonly calls: string[] = [];

  constructor(
    private readonly tables: FakeTable[],
    private readonly options: FakeOptions = {},
  ) {
    for (const t of tables) this.data.set(t.name, [...(t.rows ?? [])]);
  }

  fetchOpenApi(): Promise<unknown> {
    const definitions: Record<string, unknown> = {};
    for (const t of this.tables) {
      const properties: Record<string, unknown> = {
        id: {
          type: 'string',
          format: 'uuid',
          default: 'gen_random_uuid()',
          description: 'Note:\nThis is a Primary Key.<pk/>',
        },
        note: { type: 'string' },
      };
      if (t.noTextColumn) delete properties.note;
      const required: string[] = [];
      if (t.ownerColumn && t.ownerColumn !== 'id') {
        properties[t.ownerColumn] = { type: 'string', format: 'uuid' };
        required.push(t.ownerColumn);
      }
      if (t.ownerColumn === 'id') {
        properties.id = {
          type: 'string',
          format: 'uuid',
          description:
            "Note:\nThis is a Primary Key.<pk/>\n<fk table='users' column='id'/>",
        };
        required.push('id');
      }
      definitions[t.name] = { required, properties };
    }
    return Promise.resolve({ swagger: '2.0', definitions });
  }

  countRows(table: string): Promise<number> {
    return Promise.resolve(this.data.get(table)!.length);
  }

  createUser(email: string, password: string): Promise<string> {
    const id = randomUUID();
    this.users.set(id, { email, password });
    return Promise.resolve(id);
  }

  deleteUser(userId: string): Promise<void> {
    if (this.options.failDeleteUser) return Promise.reject(new Error('nope'));
    this.users.delete(userId);
    return Promise.resolve();
  }

  userExists(userId: string): Promise<boolean> {
    return Promise.resolve(this.users.has(userId));
  }

  signIn(email: string, password: string): Promise<string> {
    for (const [id, u] of this.users) {
      if (u.email === email && u.password === password) {
        const token = `fake-token-${randomUUID()}`;
        this.tokens.set(token, id);
        return Promise.resolve(token);
      }
    }
    return Promise.reject(new Error('bad login'));
  }

  insertRow(table: string, row: Row): Promise<Row> {
    const def = this.tables.find((t) => t.name === table)!;
    if (def.insertError) return Promise.reject(new Error(def.insertError));
    const full = { id: randomUUID(), ...row };
    this.data.get(table)!.push(full);
    return Promise.resolve({ ...full });
  }

  readRows(table: string, column: string, value: string): Promise<Row[]> {
    return Promise.resolve(
      this.data
        .get(table)!
        .filter((r) => r[column] === value)
        .map((r) => ({ ...r })),
    );
  }

  deleteRows(table: string, column: string, value: string): Promise<void> {
    this.data.set(
      table,
      this.data.get(table)!.filter((r) => r[column] !== value),
    );
    return Promise.resolve();
  }

  restCall(
    method: RestMethod,
    table: string,
    filter: RowFilter | null,
    caller: Caller,
    body?: Row,
  ): Promise<RestResult> {
    this.calls.push(`${caller.kind} ${method} ${table}`);
    if (this.options.throwOnRest) {
      return Promise.reject(new Error('network broke'));
    }
    const def = this.tables.find((t) => t.name === table)!;
    const userId =
      caller.kind === 'user' ? this.tokens.get(caller.token) : undefined;
    const all = this.data.get(table)!;
    const matching = all.filter(
      (r) => !filter || r[filter.column] === filter.value,
    );
    if (method === 'POST') {
      const owner = def.ownerColumn;
      if (def.insertConflict) return Promise.resolve({ status: 409, rows: [] });
      const allowed =
        def.policy === 'off' ||
        (def.policy === 'own' &&
          !!userId &&
          !!owner &&
          body?.[owner] === userId);
      if (!allowed) return Promise.resolve({ status: 403, rows: [] });
      const row = { id: randomUUID(), ...body };
      all.push(row);
      return Promise.resolve({ status: 201, rows: [{ ...row }] });
    }
    const canSee = (r: Row) => {
      if (def.policy === 'off') return true;
      if (def.policy === 'deny-all') return false;
      if (def.policy === 'public-read') return method === 'GET';
      return !!userId && !!def.ownerColumn && r[def.ownerColumn] === userId;
    };
    const visible = matching.filter(canSee);
    // A blocked write answers 200 with no rows and changes nothing, like the real thing.
    if (method === 'PATCH') for (const r of visible) Object.assign(r, body);
    if (method === 'DELETE') {
      this.data.set(
        table,
        all.filter((r) => !visible.includes(r)),
      );
    }
    return Promise.resolve({
      status: 200,
      rows: visible.map((r) => ({ ...r })),
    });
  }
}
