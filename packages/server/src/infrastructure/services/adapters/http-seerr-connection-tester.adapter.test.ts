import { afterEach, describe, expect, test } from 'bun:test';
import { HttpSeerrConnectionTester } from './http-seerr-connection-tester.adapter';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function stubFetch(status: number): { calledUrl: () => string | undefined } {
  let calledUrl: string | undefined;
  globalThis.fetch = ((input: string) => {
    calledUrl = input;
    return Promise.resolve(new Response(null, { status }));
  }) as unknown as typeof fetch;
  return { calledUrl: () => calledUrl };
}

const tester = new HttpSeerrConnectionTester();

describe('HttpSeerrConnectionTester', () => {
  // /api/v1/status is public, so hitting it would report success for any API key.
  test('authenticates against /api/v1/auth/me', async () => {
    const fetchStub = stubFetch(200);

    await tester.testConnection('http://seerr.local:5055', 'key');

    expect(fetchStub.calledUrl()).toBe('http://seerr.local:5055/api/v1/auth/me');
  });

  test('succeeds when the API key is accepted', async () => {
    stubFetch(200);

    expect(await tester.testConnection('http://seerr.local:5055', 'key')).toEqual({
      success: true,
      message: 'Connection successful',
    });
  });

  test.each([401, 403])('fails on %d instead of reporting success', async (status) => {
    stubFetch(status);

    const result = await tester.testConnection('http://seerr.local:5055', 'wrong-key');

    expect(result.success).toBe(false);
    expect(result.message).toContain('API key');
  });

  test('reports unreachable hosts', async () => {
    globalThis.fetch = (() =>
      Promise.reject(new Error('Unable to connect'))) as unknown as typeof fetch;

    const result = await tester.testConnection('http://192.168.1.32:5055', 'key');

    expect(result).toEqual({ success: false, message: 'Unable to connect' });
  });
});
