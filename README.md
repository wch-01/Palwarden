# Palwarden

Palwarden is a self-hosted Palworld Dedicated Server Controller for Windows 11 hosts. It manages multiple Palworld Dedicated Server profiles from one local web interface, including SteamCMD deploy-new flow, encrypted per-server AdminPassword storage, dashboard monitoring, server controls, world settings editing, player operations, logs, and manual backups.

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

## Current Features

- First-run owner setup with localhost/token restriction.
- Login, logout, and session restore.
- `OWNER`, `ADMIN`, and `VIEWER` roles.
- Server profile create, read, update, delete, and SteamCMD deploy-new flow.
- Duplicate path and port validation.
- Encrypted Palworld AdminPassword storage.
- Palworld REST connection test using `/info` and `/metrics`.
- Dashboard cards with state, REST connectivity, players, FPS, uptime, and version when reachable.
- Windows process adapter using `child_process.spawn`.
- Server Control page for start, graceful stop, restart, save world, broadcast, shutdown countdown, update, validate, and manual backup.
- Graceful stop requests save and shutdown through Palworld REST.
- Live process status and log updates through SSE.
- Host CPU and RAM metrics for tracked Palworld processes.
- Palworld settings editor for `PalWorldSettings.ini`, including a popular-settings section and advanced fields discovered from the config file.
- AdminPassword can be changed from Server Configuration; Palwarden writes it to config and stores its own encrypted copy.
- Player roster with kick, ban, and unban actions through the Palworld REST API.
- Manual backup records, backup creation, restore, delete, and failed-record cleanup.
- Backup-before-restart, backup-before-update, and backup-before-configuration-change policies.
- Host-level Nexus Mods API key storage, encrypted with `PALWARDEN_MASTER_KEY`.
- Per-server local mod inventory with enable, disable, remove, and load-order actions for Pak, LogicMods, and UE4SS mod folders.
- Audit log API and UI for administrative actions.

## Known Limitations

- SteamCMD fresh installs, updates, and validation are implemented.
- Manual backups can be created, restored, and deleted from Server Control. Scheduled backups are not implemented yet.
- Process recovery after Palwarden restarts is only structurally prepared; robust process identity recovery is next.
- The Windows adapter does not force-kill during normal graceful stop.
- Settings sections for Windows startup, global start policy, automation, and user administration are still incomplete.
- Nexus mod browsing, direct download, update checks, and admin approval workflows are not implemented yet.
- Guild roster is a placeholder until Palworld exposes enough supported API data for it.

## Reference and License

The behavior reference was `wch-01/PW-Server-Manager` at commit `47f45f6a26e7cbac9e3ec45e150514e6610ac5fe`. It is MIT licensed, copyright 2026 Kvitekvist. Palwarden does not copy its source code. See `docs/reference-analysis.md`.

Official Palworld REST API documentation is the source of truth for server API behavior.

## Todo: Possible With Current APIs

- Scheduled backups under Settings > Automation.
- Better process recovery after Palwarden restarts.
- Windows startup registration and global start-servers-on-launch policy.
- Settings page completion for user access, server instance management, file paths, and automation.
- Backup UI polish, restore progress, and clearer recovery messaging.
- Nexus mod browsing, direct install, update checks, and host approval workflow modeled after PW-Server-Manager.
- Installer/package work for Windows.

## Todo: Waiting On Palworld API Support

These are intentionally separated because Palwarden should not invent unsupported behavior or scrape unstable game internals when an official API is needed.

- Real guild roster and guild management.
- Authoritative installed/loaded mod list from the running server.
- Runtime mod enable/disable or mod load-order management.
- Save-complete event or save job status beyond the current REST `/save` success response.
- Hot-apply server settings without restart, unless Palworld exposes a supported reload/update endpoint.
- Richer player details such as inventory, pals, base ownership, or complete position/state data.
- Ban list readback and richer moderation history from the server.
- World actor snapshot UI for servers that do not expose the documented snapshot endpoint.
