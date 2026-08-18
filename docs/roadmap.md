# Palwarden Roadmap

## Current State

Palwarden currently supports the first usable Windows administration loop:

- First-run owner setup.
- Login, logout, database-backed sessions, CSRF protection, and global roles.
- Multiple server profiles with separate paths, ports, launch arguments, credentials, and backup locations.
- Encrypted Palworld AdminPassword storage using `PALWARDEN_MASTER_KEY`.
- SteamCMD deploy-new flow for fresh Palworld Dedicated Server installs.
- Dashboard cards with runtime state, REST connectivity, players, FPS, uptime, server version, host CPU/RAM, disk usage, backup size, and installed mod count.
- Server Control actions for start, graceful stop, restart, save world, broadcast, shutdown countdown, update, validate, backup save, restore, and player connection guidance.
- Live status polling, process logs, and basic per-server log files.
- Host CPU and RAM metrics for tracked Palworld processes.
- `PalWorldSettings.ini` editor with popular settings and advanced fields read from the config file.
- Player roster with kick, ban, and unban actions through the Palworld REST API.
- Manual backup records, backup creation, restore, delete, and failed-record cleanup.
- Backup-before-restart, backup-before-update, backup-before-configuration-change, and scheduled backup policies.
- Nexus Mods API key storage, Nexus browsing/search/install flows, UE4SS install/uninstall, and per-server mod inventory controls.
- Audit log UI.
- Windows ZIP installer package with bundled Node runtime, generated master key, automatic migrations, and same-origin production hosting.
- Electron desktop package with bundled Palwarden runtime, native app window, shortcuts, and local trusted desktop sessions.
- Host Network Access setting for local-only or LAN/private-network browser access.
- Host setting for current-user Windows startup registration.
- Host policy for starting selected server profiles when Palwarden launches.

## Long-Term Wish List

The long-term wishlist is tracked in `docs/wishlist.md`.

## Waiting On Palworld API Support

The Palworld API waiting list is tracked in `docs/wishlist.md`.

## Recommended Next Work

The next Palwarden-owned pass should focus on release preparation:

- Prepare the public v1 release notes and installer sanity-test checklist.
