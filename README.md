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
- Electron: `39.8.10`

## Windows Desktop Package

The preferred Windows package is the Electron desktop installer. It installs a
native Palwarden app with Start Menu and desktop shortcuts, opens Palwarden in a
native window, starts the bundled backend, generates the master key on first
launch, runs migrations, and keeps the browser-based UI available from the same
backend when network access is enabled in Settings.

Build the Electron package from a development machine:

```powershell
pnpm package:electron
```

The build creates:

```text
dist/electron/Palwarden-1.0.0-windows-x64-installer.exe
```

The Electron app stores its runtime data under the app user-data folder and uses
the same `palwarden.env` format as the ZIP wrapper. The first launch generates a
base64 32-byte `PALWARDEN_MASTER_KEY`; the setup page only asks for the owner
username and password during normal local setup. The optional setup token field
is only for creating the first owner from another device.

The current installer is unsigned, so Windows SmartScreen may warn on first run.

## Windows ZIP Package

The ZIP package remains available as a fallback and diagnostic-friendly wrapper.
The end user does not need to install Node.js, pnpm, Prisma, or manually
generate secrets.

Build the package from a development machine:

```powershell
pnpm package:windows
```

The build creates:

```text
dist/windows/Palwarden-windows-x64.zip
```

On a new Windows 11 computer:

1. Extract `Palwarden-windows-x64.zip`.
2. Run `Install-Palwarden.cmd`.
3. Use the created desktop shortcut or the browser window that opens.
4. Create the first owner account on the setup screen.

The installer copies Palwarden to `%LOCALAPPDATA%\Programs\Palwarden`.
The first launch creates `%LOCALAPPDATA%\Palwarden\data`, generates a
base64 32-byte `PALWARDEN_MASTER_KEY`, writes `palwarden.env`, runs Prisma
migrations, and serves the Angular UI and backend from
`http://127.0.0.1:3333`.

Electron is the main desktop-app path. A tray icon and optional Windows service
mode are possible follow-up work.

## Development Setup

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

For local development only, `PALWARDEN_DEV_AUTO_LOGIN=true` creates and signs in
a localhost-only owner account with username `Dev` and password `wardenDev`.
This setting is ignored outside `NODE_ENV=development` and should not be used for
packaged builds or LAN/web exposure testing.

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

Owners can switch Settings > Network Access from local-only to LAN mode. This
writes the desired bind address to `palwarden.env`; restart Palwarden afterward
for the backend to bind beyond localhost. Tailscale or another private VPN is
recommended for remote access.

## Commands

```powershell
pnpm build
pnpm lint
pnpm test
pnpm package:windows
pnpm package:electron
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
- Dashboard cards with server state, REST connectivity, players, server FPS, uptime, installed version, host CPU/RAM, disk usage, backup size, and installed mod count.
- Windows process adapter using `child_process.spawn`, hidden windows, process recovery, PID detection, and per-process CPU/RAM sampling.
- Server Control page for start, graceful stop, restart, save world, broadcast, shutdown countdown, update, validate, and manual backup.
- Server Control player connection card with LAN/public/Tailscale/playit.gg guidance, per-server game/query port editing, and public IP detection.
- Graceful stop requests save and shutdown through Palworld REST, with modal confirmation and live progress feedback.
- Live process status and log updates through SSE.
- Host CPU and RAM metrics for tracked Palworld processes.
- Palworld settings editor for `PalWorldSettings.ini`, including a popular-settings section and advanced fields discovered from the config file.
- AdminPassword can be changed from Server Configuration; Palwarden writes it to config and stores its own encrypted copy.
- Player roster with kick, ban, and unban actions through the Palworld REST API.
- Manual backup records, backup creation, restore, delete, failed-record cleanup, and visible restore progress.
- Backup-before-restart, backup-before-update, backup-before-configuration-change, and scheduled backup policies with retention cleanup.
- Host-level Nexus Mods API key storage, encrypted with `PALWARDEN_MASTER_KEY`.
- Per-server Nexus Mods browsing/search, file selection, install preview, direct install, update checks, admin request/approval workflow, and UE4SS install/uninstall support.
- Per-server local mod inventory with enable, disable, remove, rescan, and load-order actions for Pak, LogicMods, and UE4SS mod folders.
- Audit log API and UI for administrative actions.
- Windows package scripts with bundled Node runtime, generated master key, automatic migrations, and same-origin production hosting.
- Electron desktop package with bundled Palwarden runtime, installer metadata, shortcuts, native app window, and local trusted desktop session support.
- Host Network Access setting for local-only vs LAN/Tailscale/private-network browser access.
- Network Access changes show restart-required instructions instead of restarting Palwarden automatically.
- Host settings for Windows login startup and selected-server start-on-Palwarden-launch policy.
- Settings page sections for Nexus Mods, Network Access, Windows startup, server autostart, user access, server instances, and backup automation.
- WebCraftHouse creator/support links in the sidebar.

## Known Limitations

- SteamCMD fresh installs, updates, and validation are implemented, but Steam content-server failures can still require retrying later.
- Nexus mod browsing, direct download, update checks, and admin approval workflows are implemented as an initial working flow and may need broader archive-shape testing across more mods.

## License

Palwarden is released under the MIT License. See `LICENSE`.

Official Palworld REST API documentation is the source of truth for server API behavior.

## Wishlist

Long-term ideas and items waiting on Palworld API support live in `docs/wishlist.md`.
