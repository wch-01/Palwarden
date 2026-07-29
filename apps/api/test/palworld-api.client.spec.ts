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

  it('reads players from the documented wrapped response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ players: [{ name: 'PalUser', userId: 'steam_1', playerId: 'abc', level: 3 }] })),
    );
    const client = new PalworldApiClient('http://127.0.0.1:8212', 'pw');
    await expect(client.players()).resolves.toEqual([{ name: 'PalUser', userId: 'steam_1', playerId: 'abc', level: 3 }]);
  });

  it('sends documented player operation payloads', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(() => Promise.resolve(new Response('', { status: 200 })));
    const client = new PalworldApiClient('http://127.0.0.1:8212', 'pw');

    await client.kick('steam_1', 'Goodbye.');
    await client.ban('steam_2', 'No thanks.');
    await client.unban('steam_3');

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'http://127.0.0.1:8212/v1/api/kick',
      expect.objectContaining({ body: JSON.stringify({ userid: 'steam_1', message: 'Goodbye.' }) }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'http://127.0.0.1:8212/v1/api/ban',
      expect.objectContaining({ body: JSON.stringify({ userid: 'steam_2', message: 'No thanks.' }) }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      'http://127.0.0.1:8212/v1/api/unban',
      expect.objectContaining({ body: JSON.stringify({ userid: 'steam_3' }) }),
    );
  });
});
