import type { ActivatedRoute, Router } from '@angular/router';
import type { ServerDashboardCard } from '@palwarden/shared';

const SELECTED_SERVER_KEY = 'palwarden.selectedServerId';

export function selectServerFromRoute(servers: ServerDashboardCard[], route: ActivatedRoute, router: Router): ServerDashboardCard | null {
  const requestedId = route.snapshot.queryParamMap.get('server') ?? routeParam(route, 'id') ?? storedSelectedServerId();
  const selected = servers.find((server) => server.id === requestedId) ?? servers[0] ?? null;
  if (selected) {
    storeSelectedServerId(selected.id);
  }
  if (selected && selected.id !== requestedId) {
    void router.navigate([], { queryParams: { server: selected.id }, queryParamsHandling: 'merge', replaceUrl: true });
  }
  return selected;
}

export function storeSelectedServerId(serverId: string): void {
  try {
    window.sessionStorage.setItem(SELECTED_SERVER_KEY, serverId);
  } catch {
    // Session storage is only a UI convenience; ignore unavailable storage.
  }
}

export function storedSelectedServerId(): string | null {
  try {
    return window.sessionStorage.getItem(SELECTED_SERVER_KEY);
  } catch {
    return null;
  }
}

function routeParam(route: ActivatedRoute, key: string): string | null {
  let current: ActivatedRoute | null = route;
  while (current) {
    const value = current.snapshot.paramMap.get(key);
    if (value) return value;
    current = current.parent;
  }
  return null;
}
