import { afterEach, describe, expect, it, vi } from 'vitest';
import { PalworldApiClient } from '../src/features/palworld-api/clients/palworld-api.client';

describe('PalworldApiClient', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('reads info from the documented REST endpoint', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ version: 'v1', servername: 'Test', description: '', worldguid: 'abc' })),
    );
    const client = new PalworldApiClient('http://127.0.0.1:8212', 'pw');
    await expect(client.info()).resolves.toMatchObject({ version: 'v1' });
    expect(fetch).toHaveBeenCalledWith('http://127.0.0.1:8212/v1/api/info', expect.any(Object));
  });
});
