# Palwarden Architecture

## Shape

Palwarden is a TypeScript monorepo:

```text
apps/api      NestJS backend
apps/web      Angular/Ionic frontend
packages/shared shared TypeScript contracts
docs          design and operational notes
```

The first milestone uses pnpm workspaces. Production deployments serve the Angular build from the NestJS process so browser traffic is same-origin.

## Backend

The backend is organized by feature under `apps/api/src/features`. Cross-cutting services live under `core`.

Implemented first-slice features:

- Setup and authentication.
- Database-backed server sessions.
- Role guards for `OWNER`, `ADMIN`, and `VIEWER`.
- Server instance CRUD.
- AES-256-GCM encrypted Palworld AdminPassword storage.
- Typed Palworld REST client for info and metrics in the first UI slice, with models for the wider documented API.
- Windows process adapter using `child_process.spawn`.
- In-memory runtime status and per-instance log streaming.
- Audit log records for administrative actions.

## Data

SQLite is the initial local database. Prisma owns schema migrations and typed database access. Persistent configuration lives in the database; transient runtime process state remains in memory and is refreshed by adapter discovery later.

Sensitive values are excluded from response DTOs. Server AdminPasswords are encrypted with `PALWARDEN_MASTER_KEY`.

## Frontend

The web app uses Angular standalone components, lazy-loaded feature routes, and Ionic UI primitives. The first slice contains:

- `/setup`
- `/login`
- `/dashboard`
- `/servers`
- `/servers/new`
- `/servers/:id`
- `/servers/:id/overview`
- `/servers/:id/logs`
- `/servers/:id/settings`
- `/settings`
- `/settings/users`

The dashboard is desktop-first and responsive. It talks only to Palwarden's backend.

## Process management

`ServerProcessAdapter` defines OS-neutral behavior. `WindowsServerProcessAdapter` is the first implementation.

Normal stop:

1. Request `/save`.
2. Request `/shutdown`.
3. Wait for the configured timeout.
4. Report whether the process exited.
5. Do not force-kill unless the user uses force stop or a later policy explicitly allows it.

## Palworld REST API boundary

Every Palworld server instance creates a REST client using that instance's host, port, and decrypted AdminPassword. Low-level network and HTTP failures are mapped into safe error codes before returning to the browser.

## Assumptions

- Windows 11 is the initial host target.
- Palwarden controls existing local Palworld installations in the first milestone; SteamCMD install/update comes later.
- `PALWARDEN_MASTER_KEY` is a base64-encoded 32-byte key.
- The REST username is `admin`, with the Palworld AdminPassword as the Basic Auth password.
