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
dist/electron/Palwarden-0.1.0-windows-x64-installer.exe
```

The Electron app stores its runtime data under the app user-data folder and uses
the same `palwarden.env` format as the ZIP wrapper. The first launch generates a
base64 32-byte `PALWARDEN_MASTER_KEY`; the setup page only asks for the owner
username and password during normal local setup. The optional setup token field
is only for creating the first owner from another device.

The current installer is unsigned, so Windows SmartScreen may warn on first run
until a code-signing certificate is added.

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

Electron is the main desktop-app path. Code signing, a tray icon, and optional
Windows service mode are planned follow-up work.

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
- Windows package scripts with bundled Node runtime, generated master key, automatic migrations, and same-origin production hosting.
- Electron desktop package with bundled Palwarden runtime.
- Host Network Access setting for local-only vs LAN/Tailscale/private-network browser access.

## Known Limitations

- SteamCMD fresh installs, updates, and validation are implemented.
- Manual backups can be created, restored, and deleted from Server Control. Scheduled backups are not implemented yet.
- Process recovery after Palwarden restarts is only structurally prepared; robust process identity recovery is next.
- The Windows adapter does not force-kill during normal graceful stop.
- Settings sections for Windows startup, global start policy, and automation are still incomplete.
- Nexus mod browsing, direct download, update checks, and admin approval workflows are implemented as an initial working flow and need broader archive-shape testing.
- Guild roster is a placeholder until Palworld exposes enough supported API data for it.

## Reference and License

The behavior reference was `wch-01/PW-Server-Manager` at commit `47f45f6a26e7cbac9e3ec45e150514e6610ac5fe`. It is MIT licensed, copyright 2026 Kvitekvist. Palwarden does not copy its source code. See `docs/reference-analysis.md`.

Official Palworld REST API documentation is the source of truth for server API behavior.

## Todo: Version 1 Release

Prioritize UI fixes, release polish, and the core host workflow needed before calling Palwarden v1.

- Add a working Restart Palwarden action after Network Access changes so users do not need to restart manually.
- Settings page completion for user access, server instance management, file paths, and automation.
- Backup UI polish, restore progress, and clearer recovery messaging.
- Investigate why graceful shutdown commonly fails on the first attempt and make the first request reliable.
- Windows startup registration for Palwarden at user login.
- Global policy for starting selected servers when Palwarden launches.
- Better process recovery after Palwarden restarts.
- Investigate and normalize CPU/dashboard metrics against Windows Task Manager; Palwarden may be showing per-process or per-thread-style CPU differently than Task Manager's whole-system percentage.
- Signed Windows installer polish, uninstall entry, and app metadata cleanup.

## Todo: Ready For Test

These are implemented and should be verified in the app before being treated as accepted.

- Network Access save and restart-required messaging now use button-style actions.
- Server Control shutdown confirmation uses a proper modal before graceful stop.
- Server Update offers an explicit admin override to continue when the before-update backup fails.
- Server Control > Player Connection can attempt to detect and display the host public IP address.

## Todo: Long-Term Wish List

- Scheduled backups under Settings > Automation.
- Tray icon and background/minimize-to-tray behavior.
- Windows service mode for running before any user logs in.
- Auto-restart policy for failed servers.
- Graceful-stop timeout policy with optional force-stop escalation.
- More precise process identity validation for recovered processes.
- Linux process adapter after Windows behavior is stable.

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
