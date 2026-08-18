# Palwarden Reference Analysis

## Sources inspected

- Reference repository: `https://github.com/wch-01/PW-Server-Manager`, commit `47f45f6a26e7cbac9e3ec45e150514e6610ac5fe`.
- Official Palworld Dedicated Server REST API docs, version `1.0.0`, read on 2026-07-12.

## License

The reference project is licensed under the MIT License, copyright 2026 Kvitekvist.

Palwarden does not copy source code from the reference implementation. If future work reuses any substantial source, the MIT copyright notice and permission notice must be included in the relevant distributed files or third-party notices.

## Features discovered

The reference application, branded AutoPalExpress, is a Windows-focused Palworld server administration app with:

- First-run administrator setup and invite-based additional admin accounts.
- Multi-server instance registration, switching, import, and SteamCMD deployment.
- Palworld server start, stop, restart, status, save, and update flows.
- Migration away from RCON toward the official Palworld REST API.
- Player roster, kick, ban, unban, announce, save, metrics, and shutdown through REST.
- World settings editing by parsing `PalWorldSettings.ini`.
- Launcher options for game port, query port, public lobby, public IP/port overrides, performance flags, and JSON logs.
- Query-port collision handling so `-queryport` does not steal the game port.
- Mods, Nexus Mods, and UE4SS workflows.
- Backups and scheduled maintenance.
- Windows startup recovery, diagnostics, firewall and UPnP helpers.
- App and activity logs, plus language selection.

## Useful behavioral patterns

- Prefer the official Palworld REST API over RCON for modern server operations.
- Keep the Palworld REST API local or LAN-only; do not expose it directly to browser clients.
- Normalize small response field differences at the Palworld API boundary.
- Treat startup as a grace period before declaring the process fully online.
- Detect already-running Palworld processes by matching executable/cwd/cmdline against the instance folder.
- Prevent duplicate server registrations by canonicalizing installation paths.
- Keep game port and query port distinct.
- Request a REST save before backups or shutdown when possible.
- Use the installed server's own default settings template instead of hardcoding the entire Palworld settings schema.
- Treat "deploy new server" and "import existing server" as separate workflows. AutoPalExpress deploys new servers by downloading/locating SteamCMD, running anonymous `app_update 2394010 validate` into a per-server folder, writing initial `PalWorldSettings.ini`, registering the instance, and streaming progress while the long-running download happens.
- Store the Nexus Mods API key once at the host/application level, not once per Palworld server. The reference validates the key against Nexus, exposes only connection state to the UI, and uses the key for privileged direct-download flows.
- Manage UE4SS mods by moving folders between the live `Pal/Binaries/Win64/Mods` folder and a disabled staging area. This keeps disabled mods available without loading them.
- Treat Nexus downloads as a privileged host action: regular admins can request mods, while the host/super-admin approves installs that use the saved Nexus key.

## Patterns Palwarden should not copy

- JSON-file persistence for users, sessions, credentials, and instance records does not meet Palwarden's auditability and migration goals.
- PBKDF2 password hashing is serviceable but Palwarden requires Argon2id.
- Server AdminPassword is read from Palworld config in the reference; Palwarden stores per-instance AdminPasswords encrypted at rest.
- Some Windows-specific logic is mixed into feature services; Palwarden keeps OS behavior behind adapters.
- The reference has a single active server concept for some features. Palwarden models every route by server instance ID.
- The reference can force-kill after stop timeouts. Palwarden's normal stop path should not force-kill unless a policy or explicit force-stop command allows it.
- The reference has Python-specific archive extraction and route code. Palwarden reimplements these behaviors in TypeScript rather than copying source.

## Current Palworld REST API details

The official docs state that REST requires `RESTAPIEnabled=True`, uses HTTP Basic Auth, and should not be exposed directly to the internet. Documented endpoints include:

- `GET /v1/api/info`
- `GET /v1/api/players`
- `GET /v1/api/settings`
- `GET /v1/api/metrics`
- `POST /v1/api/announce`
- `POST /v1/api/kick`
- `POST /v1/api/ban`
- `POST /v1/api/unban`
- `POST /v1/api/save`
- `POST /v1/api/shutdown`
- `POST /v1/api/stop`
- `GET /v1/api/game-data`

## Differences from Palwarden

Palwarden is a new Node.js/TypeScript application using NestJS, Angular, Ionic, Prisma, SQLite, database sessions, Argon2id, CSRF protection, encrypted credentials, per-instance routes, Swagger documentation, and an explicit process adapter boundary. Palwarden now includes SteamCMD deploy/update/validate flows, scheduled backups, Nexus Mods workflows, UE4SS support, player operations, and Windows desktop packaging. Deeper runtime mod control and richer player/world administration remain limited by Palworld API support.

As of the current mods milestone, Palwarden supports host-level Nexus key storage plus per-server local mod inventory and local enable, disable, remove, and reorder operations. Nexus browse/download/update and request-approval flows remain follow-up work.
