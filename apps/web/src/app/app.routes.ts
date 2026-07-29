import type { Routes } from '@angular/router';
import { authGuard } from './core/guards/auth.guard';
import { viewerGuard } from './core/guards/viewer.guard';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'dashboard' },
  {
    path: 'setup',
    loadComponent: () => import('./features/setup/setup.page').then((m) => m.SetupPage),
  },
  {
    path: 'login',
    loadComponent: () => import('./features/authentication/login.page').then((m) => m.LoginPage),
  },
  {
    path: 'dashboard',
    canActivate: [authGuard],
    loadComponent: () => import('./features/dashboard/dashboard.page').then((m) => m.DashboardPage),
  },
  {
    path: 'server-control',
    canActivate: [authGuard, viewerGuard],
    loadComponent: () => import('./features/server-instances/server-control.page').then((m) => m.ServerControlPage),
  },
  {
    path: 'server-configuration',
    canActivate: [authGuard, viewerGuard],
    loadComponent: () => import('./features/server-instances/server-configuration.page').then((m) => m.ServerConfigurationPage),
  },
  {
    path: 'players',
    canActivate: [authGuard],
    loadComponent: () => import('./features/server-instances/players.page').then((m) => m.PlayersPage),
  },
  {
    path: 'mods',
    canActivate: [authGuard],
    loadComponent: () => import('./features/server-instances/mods.page').then((m) => m.ModsPage),
  },
  {
    path: 'logs',
    canActivate: [authGuard],
    loadComponent: () => import('./features/logs/logs.page').then((m) => m.LogsPage),
  },
  {
    path: 'audit-log',
    canActivate: [authGuard, viewerGuard],
    loadComponent: () => import('./features/audit-log/audit-log.page').then((m) => m.AuditLogPage),
  },
  {
    path: 'host/launcher-options',
    canActivate: [authGuard],
    loadComponent: () => import('./features/settings/placeholder-settings.page').then((m) => m.PlaceholderSettingsPage),
  },
  {
    path: 'servers',
    canActivate: [authGuard],
    loadComponent: () => import('./features/server-instances/server-list.page').then((m) => m.ServerListPage),
  },
  {
    path: 'servers/new',
    canActivate: [authGuard, viewerGuard],
    loadComponent: () => import('./features/server-instances/server-form.page').then((m) => m.ServerFormPage),
  },
  {
    path: 'servers/:id',
    canActivate: [authGuard],
    loadComponent: () => import('./features/server-instances/server-detail.page').then((m) => m.ServerDetailPage),
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'overview' },
      {
        path: 'overview',
        loadComponent: () => import('./features/server-instances/server-overview.page').then((m) => m.ServerOverviewPage),
      },
      {
        path: 'players',
        loadComponent: () => import('./features/server-instances/players.page').then((m) => m.PlayersPage),
      },
      {
        path: 'logs',
        loadComponent: () => import('./features/server-instances/server-logs.page').then((m) => m.ServerLogsPage),
      },
      {
        path: 'settings',
        loadComponent: () => import('./features/server-instances/server-form.page').then((m) => m.ServerFormPage),
      },
    ],
  },
  {
    path: 'settings',
    canActivate: [authGuard],
    loadComponent: () => import('./features/settings/settings.page').then((m) => m.SettingsPage),
  },
  {
    path: 'settings/users',
    canActivate: [authGuard],
    loadComponent: () => import('./features/settings/users.page').then((m) => m.UsersPage),
  },
  {
    path: 'settings/server-instances',
    pathMatch: 'full',
    redirectTo: 'settings',
  },
  {
    path: 'settings/automation',
    pathMatch: 'full',
    redirectTo: 'settings',
  },
];
