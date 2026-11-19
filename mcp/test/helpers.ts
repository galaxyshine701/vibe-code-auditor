import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { Config } from '../src/config.js';
import { createServer } from '../src/server.js';

// Obviously fake values, only for tests.
export const FAKE = {
  accessCode: 'fake-access-code-424242',
  publishableKey: 'fake-publishable-key-111111',
  secretKey: 'fake-secret-key-222222',
  supabaseUrl: 'https://fakeproject.supabase.co',
};

export function makeConfig(over: Partial<Config> = {}): Config {
  return {
    apiUrl: 'https://api.example.test',
    accessCode: FAKE.accessCode,
    supabaseUrl: FAKE.supabaseUrl,
    publishableKey: FAKE.publishableKey,
    secretKey: FAKE.secretKey,
    confirmTestProject: true,
    ...over,
  };
}

export interface Call {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: unknown;
}

export interface FakeReply {
  status?: number;
  body?: unknown;
  headers?: Record<string, string>;
}

/** A fake fetch. `reply` decides the answer for each request. */
export function makeFetch(reply: (call: Call) => FakeReply | Error) {
  const calls: Call[] = [];
  const fn = (async (input: string | URL | Request, init?: RequestInit) => {
    const call: Call = {
      method: init?.method ?? 'GET',
      url: String(input),
      headers: { ...(init?.headers as Record<string, string>) },
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    };
    calls.push(call);
    const answer = reply(call);
    if (answer instanceof Error) throw answer;
    return new Response(JSON.stringify(answer.body ?? {}), {
      status: answer.status ?? 200,
      headers: { 'content-type': 'application/json', ...answer.headers },
    });
  }) as typeof fetch;
  return { fn, calls };
}

export async function connect(
  config: Config,
  fetchImpl: typeof fetch,
  sleep: (ms: number) => Promise<void> = async () => {},
) {
  const server = createServer(config, fetchImpl, sleep);
  const client = new Client({ name: 'test', version: '0.0.0' });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  await client.connect(clientSide);
  return {
    client,
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}

export function textOf(result: unknown): string {
  const content = (result as { content: { type: string; text: string }[] })
    .content;
  return content.map((c) => c.text).join('\n');
}

export function isError(result: unknown): boolean {
  return (result as { isError?: boolean }).isError === true;
}
