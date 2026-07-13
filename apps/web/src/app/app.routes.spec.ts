import '@angular/compiler';
import { describe, expect, it } from 'vitest';
import { routes } from './app.routes';

describe('routes', () => {
  it('contains the first milestone entry points', () => {
    const paths = routes.map((route) => route.path);
    expect(paths).toContain('setup');
    expect(paths).toContain('login');
    expect(paths).toContain('dashboard');
    expect(paths).toContain('servers');
    expect(paths).toContain('settings/users');
  });
});
