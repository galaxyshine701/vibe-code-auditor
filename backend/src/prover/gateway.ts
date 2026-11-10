import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { ProverConfig } from './types.js';

export type RestMethod = 'GET' | 'PATCH' | 'DELETE';
export type Caller = { kind: 'anon' } | { kind: 'user'; token: string };

export interface RowFilter {
  column: string;
  value: string;
}

export interface RestResult {
  status: number;
  rows: Record<string, unknown>[];
}

/**
 * Everything the Prover needs from the outside world.
 * The real version talks to Supabase; tests use a fake one.
 */
export interface Gateway {
  fetchOpenApi(): Promise<unknown>;
  countRows(table: string): Promise<number>;
  createUser(email: string, password: string): Promise<string>;
  deleteUser(userId: string): Promise<void>;
  userExists(userId: string): Promise<boolean>;
  signIn(email: string, password: string): Promise<string>;
  insertRow(
    table: string,
    row: Record<string, unknown>,
  ): Promise<Record<string, unknown>>;
  readRows(
    table: string,
    column: string,
    value: string,
  ): Promise<Record<string, unknown>[]>;
  deleteRows(table: string, column: string, value: string): Promise<void>;
  /** A request through the public REST API, as an anonymous visitor or a logged-in user. */
  restCall(
    method: RestMethod,
    table: string,
    filter: RowFilter | null,
    caller: Caller,
    body?: Record<string, unknown>,
  ): Promise<RestResult>;
}

const NO_SESSION = { auth: { persistSession: false, autoRefreshToken: false } };

export class SupabaseGateway implements Gateway {
  private readonly admin: SupabaseClient;

  constructor(private readonly config: ProverConfig) {
    this.admin = createClient(config.supabaseUrl, config.secretKey, NO_SESSION);
  }

  async fetchOpenApi(): Promise<unknown> {
    const res = await fetch(`${this.config.supabaseUrl}/rest/v1/`, {
      headers: {
        apikey: this.config.secretKey,
        Accept: 'application/openapi+json',
      },
    });
    if (!res.ok) {
      throw new Error(`Could not read the table list (HTTP ${res.status}).`);
    }
    return res.json();
  }

  async countRows(table: string): Promise<number> {
    const { count, error } = await this.admin
      .from(table)
      .select('*', { count: 'exact', head: true });
    if (error) throw new Error(`Could not count rows: ${error.message}`);
    return count ?? 0;
  }

  async createUser(email: string, password: string): Promise<string> {
    const { data, error } = await this.admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (error || !data.user) {
      throw new Error(`Could not create test user: ${error?.message}`);
    }
    return data.user.id;
  }

  async deleteUser(userId: string): Promise<void> {
    const { error } = await this.admin.auth.admin.deleteUser(userId);
    if (error) throw new Error(`Could not delete test user: ${error.message}`);
  }

  async userExists(userId: string): Promise<boolean> {
    const { data, error } = await this.admin.auth.admin.getUserById(userId);
    return !error && !!data.user;
  }

  async signIn(email: string, password: string): Promise<string> {
    const client = createClient(
      this.config.supabaseUrl,
      this.config.publishableKey,
      NO_SESSION,
    );
    const { data, error } = await client.auth.signInWithPassword({
      email,
      password,
    });
    if (error || !data.session) {
      throw new Error(`Test user could not sign in: ${error?.message}`);
    }
    return data.session.access_token;
  }

  async insertRow(
    table: string,
    row: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const { data, error } = await this.admin.from(table).insert(row).select();
    if (error || !data?.[0]) {
      throw new Error(`Insert failed: ${error?.message ?? 'no row returned'}`);
    }
    return data[0] as Record<string, unknown>;
  }

  async readRows(
    table: string,
    column: string,
    value: string,
  ): Promise<Record<string, unknown>[]> {
    const { data, error } = await this.admin
      .from(table)
      .select('*')
      .eq(column, value);
    if (error) throw new Error(`Re-read failed: ${error.message}`);
    return (data ?? []) as Record<string, unknown>[];
  }

  async deleteRows(
    table: string,
    column: string,
    value: string,
  ): Promise<void> {
    const { error } = await this.admin.from(table).delete().eq(column, value);
    if (error) throw new Error(`Delete failed: ${error.message}`);
  }

  async restCall(
    method: RestMethod,
    table: string,
    filter: RowFilter | null,
    caller: Caller,
    body?: Record<string, unknown>,
  ): Promise<RestResult> {
    const headers: Record<string, string> = {
      apikey: this.config.publishableKey,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    };
    if (caller.kind === 'user')
      headers.Authorization = `Bearer ${caller.token}`;
    const where = filter
      ? `${encodeURIComponent(filter.column)}=eq.${encodeURIComponent(filter.value)}&`
      : '';
    const url = `${this.config.supabaseUrl}/rest/v1/${encodeURIComponent(table)}?${where}select=*`;
    const res = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    let json: unknown = [];
    try {
      json = await res.json();
    } catch {
      // empty body (for example 204) means no rows
    }
    return {
      status: res.status,
      rows: Array.isArray(json) ? (json as Record<string, unknown>[]) : [],
    };
  }
}
