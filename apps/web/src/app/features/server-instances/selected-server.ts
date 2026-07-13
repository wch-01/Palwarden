import type { ActivatedRoute, Router } from '@angular/router';
import type { ServerDashboardCard } from '@palwarden/shared';

export function selectServerFromRoute(servers: ServerDashboardCard[], route: ActivatedRoute, router: Router): ServerDashboardCard | null {
  const requestedId = route.snapshot.queryParamMap.get('server');
  const selected = servers.find((server) => server.id === requestedId) ?? servers[0] ?? null;
  if (selected && selected.id !== requestedId) {
    void router.navigate([], { queryParams: { server: selected.id }, queryParamsHandling: 'merge', replaceUrl: true });
  }
  return selected;
}
