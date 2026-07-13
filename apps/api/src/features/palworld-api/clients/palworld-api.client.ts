import { Injectable } from '@nestjs/common';
import type { ServerInstance } from '@prisma/client';

export interface PalworldInfo {
  version: string;
  servername: string;
  description: string;
  worldguid: string;
}

export interface PalworldMetrics {
  serverfps: number;
  currentplayernum: number;
  serverframetime: number;
  maxplayernum: number;
  uptime: number;
  basecampnum: number;
  days: number;
}

export interface PalworldPlayer {
  name?: string;
  playeruid?: string;
  steamid?: string;
  userId?: string;
  level?: number;
  location_x?: number;
  location_y?: number;
}

export class PalworldApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export class PalworldApiClient {
  constructor(
    private readonly baseUrl: string,
    private readonly adminPassword: string,
  ) {}

  info(): Promise<PalworldInfo> {
    return this.request<PalworldInfo>('GET', '/info');
  }

  metrics(): Promise<PalworldMetrics> {
    return this.request<PalworldMetrics>('GET', '/metrics');
  }

  players(): Promise<PalworldPlayer[]> {
    return this.request<PalworldPlayer[]>('GET', '/players');
  }

  announce(message: string): Promise<void> {
    return this.request<void>('POST', '/announce', { message });
  }

  save(): Promise<void> {
    return this.request<void>('POST', '/save');
  }

  shutdown(waittime: number, message: string): Promise<void> {
    return this.request<void>('POST', '/shutdown', { waittime, message });
  }

  async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    try {
      const init: RequestInit = {
        method,
        headers: {
          Authorization: `Basic ${Buffer.from(`admin:${this.adminPassword}`).toString('base64')}`,
          'content-type': 'application/json',
        },
        signal: controller.signal,
      };
      if (body) {
        init.body = JSON.stringify(body);
      }
      const response = await fetch(`${this.baseUrl}/v1/api${path}`, init);
      if (response.status === 401) {
        throw new PalworldApiError('INVALID_ADMIN_PASSWORD', 'The Palworld AdminPassword was rejected.');
      }
      if (response.status === 404) {
        throw new PalworldApiError('UNSUPPORTED_ENDPOINT', 'This Palworld server does not support that REST endpoint.');
      }
      if (!response.ok) {
        throw new PalworldApiError('REST_API_DISABLED', 'Palworld REST API rejected the request.');
      }
      if (response.status === 204) {
        return undefined as T;
      }
      const text = await response.text();
      return text ? (JSON.parse(text) as T) : (undefined as T);
    } catch (error) {
      if (error instanceof PalworldApiError) {
        throw error;
      }
      if (error instanceof SyntaxError) {
        throw new PalworldApiError('INVALID_RESPONSE', 'Palworld returned an invalid response.');
      }
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw new PalworldApiError('TIMEOUT', 'Timed out reaching the Palworld REST API.');
      }
      throw new PalworldApiError('CONNECTION_REFUSED', 'Could not reach the Palworld REST API.');
    } finally {
      clearTimeout(timeout);
    }
  }
}

@Injectable()
export class PalworldApiClientFactory {
  forInstance(instance: ServerInstance, adminPassword: string): PalworldApiClient {
    return new PalworldApiClient(`http://${instance.restApiHost}:${instance.restApiPort}`, adminPassword);
  }
}
