# Palwarden

Palwarden is a self-hosted Palworld Dedicated Server Controller for Windows 11 hosts. This first milestone controls existing local Palworld dedicated server installations; SteamCMD installation, updates, scheduled backups, mods, and advanced player administration are intentionally later milestones.

## Stack and Versions

- Node.js: current LTS line, tested here with `v24.14.0`
- pnpm: `11.7.0`
- NestJS: `11.1.28`
- Angular: `21.2.18`
- Ionic Angular: `8.8.13`
- Prisma: `6.19.3`
- Argon2: `0.44.0`
- SQLite: local file database through Prisma

## Setup

```powershell
pnpm install
Copy-Item .env.example .env
```

Generate a master key and place it in `.env` as `PALWARDEN_MASTER_KEY`:

```powershell
[Convert]::ToBase64String((1..32 | ForEach-Object { Get-Random -Maximum 256 }))
```

Optional for development: set `PALWARDEN_DATA_DIR` to a writable folder for
SteamCMD downloads, server installs, backups, and runtime data. When omitted,
Palwarden uses `%LOCALAPPDATA%\Palwarden\data` on Windows.

Run the database migration:

```powershell
pnpm db:generate
pnpm db:deploy
```

`pnpm db:deploy` applies a temporary `RUST_LOG=info` workaround for Prisma issue
[prisma/prisma#29355](https://github.com/prisma/prisma/issues/29355), where the
Windows SQLite schema engine can fail with a blank error unless engine logging is
enabled. The workaround is scoped only to deploy migrations.

Start development servers:

```powershell
pnpm dev
```

Backend: `http://127.0.0.1:3333`

Frontend: `http://127.0.0.1:4200`

Swagger: `http://127.0.0.1:3333/api/docs`

## Security Notes

Palwarden login passwords are separate from Palworld server AdminPasswords. Palwarden hashes user passwords with Argon2id, stores sessions in SQLite, sends session IDs only in HttpOnly cookies, and requires CSRF headers for state-changing requests.

Palworld AdminPasswords are encrypted with AES-256-GCM using `PALWARDEN_MASTER_KEY`. They are never returned to the frontend after being saved; edit forms show only whether a credential exists and require a replacement value to change it.

Palwarden binds to localhost by default. If you expose the admin panel beyond the host, use HTTPS through a reverse proxy or a secure private network. Do not expose Palworld REST API ports directly to the internet.

## Commands

```powershell
pnpm build
pnpm lint
pnpm test
pnpm db:deploy
pnpm --filter @palwarden/api dev
pnpm --filter @palwarden/web dev
pnpm exec playwright test
```

## First Milestone Features

- First-run owner setup with localhost/token restriction.
- Login, logout, and session restore.
- `OWNER`, `ADMIN`, and `VIEWER` roles.
- Server profile create, read, update, and delete.
- Duplicate path and port validation.
- Encrypted Palworld AdminPassword storage.
- Palworld REST connection test using `/info` and `/metrics`.
- Dashboard cards with state, REST connectivity, players, FPS, uptime, and version when reachable.
- Windows process adapter using `child_process.spawn`.
- Graceful stop path requests save and shutdown through Palworld REST.
- Live process status and log updates through SSE.

## Known Limitations

- SteamCMD fresh installs are implemented for the initial deploy-new flow. SteamCMD updates are not implemented yet.
- Backups have schema support but no UI/action implementation yet.
- Player administration route is reserved for the next milestone.
- Process recovery after Palwarden restarts is only structurally prepared; robust process identity recovery is next.
- The Windows adapter does not force-kill during normal graceful stop.

## Reference and License

The behavior reference was `wch-01/PW-Server-Manager` at commit `47f45f6a26e7cbac9e3ec45e150514e6610ac5fe`. It is MIT licensed, copyright 2026 Kvitekvist. Palwarden does not copy its source code. See `docs/reference-analysis.md`.

Official Palworld REST API documentation is the source of truth for server API behavior.

## Recommended Next Milestone

Implement player operations and manual backups: `/players`, announcement, kick, ban, unban, save-before-backup, backup records, and audit-log UI.
