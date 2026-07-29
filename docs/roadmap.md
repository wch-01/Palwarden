# Palwarden Roadmap

## Current State

Palwarden currently supports the first usable Windows administration loop:

- First-run owner setup.
- Login, logout, database-backed sessions, CSRF protection, and global roles.
- Multiple server profiles with separate paths, ports, launch arguments, credentials, and backup locations.
- Encrypted Palworld AdminPassword storage using `PALWARDEN_MASTER_KEY`.
- SteamCMD deploy-new flow for fresh Palworld Dedicated Server installs.
- Dashboard cards with runtime state, REST connectivity, players, FPS, uptime, and server version when reachable.
- Server Control actions for start, graceful stop, restart, save world, broadcast, shutdown countdown, update, validate, and backup save.
- Live status polling, process logs, and basic per-server log files.
- Host CPU and RAM metrics for tracked Palworld processes.
- `PalWorldSettings.ini` editor with popular settings and advanced fields read from the config file.
- Player roster with kick, ban, and unban actions through the Palworld REST API.
- Manual backup records, backup creation, restore, delete, and failed-record cleanup.
- Backup-before-restart, backup-before-update, and backup-before-configuration-change policies.
- Audit log UI.

## Can Build With Current APIs

These items can be implemented with Palwarden's own database, Windows host capabilities, SteamCMD, filesystem access, or currently documented Palworld REST endpoints.

- Scheduled backups under Settings > Automation.
- Restore progress and stronger restore safety UX.
- Audit log filtering improvements beyond the current client-side latest-entry table.
- Better process recovery when Palwarden restarts while Palworld servers are already running.
- More precise process identity validation for recovered processes.
- Windows startup registration for Palwarden.
- Global policy for starting selected servers when Palwarden launches.
- Auto-restart policy for failed servers.
- Graceful-stop timeout policy with optional force-stop escalation.
- User access management UI for Palwarden accounts and global roles.
- Settings page completion for server instance paths, file browsing, and automation.
- Basic filesystem-based mod inventory and installed mod count.
- Windows installer or packaged executable.
- Linux process adapter after Windows behavior is stable.

## Waiting On Palworld API Support

These items need official Palworld API support, clearer documentation, or a stable server-side contract before Palwarden should treat them as reliable product features.

- Real guild roster and guild management.
- Authoritative running-server mod list.
- Runtime mod enable/disable or load-order management.
- Save-complete event, save job status, or save progress beyond the current `/save` response.
- Hot-apply server settings without a restart.
- Runtime config reload/update through a supported endpoint.
- Rich player details such as inventory, pals, base ownership, and complete position/state data.
- Ban list readback and richer server-side moderation history.
- World actor snapshot UI on server versions that do not expose the documented snapshot endpoint.
- Any destructive world or character operations not explicitly covered by the official REST API.

## Recommended Next Work

The next Palwarden-owned pass should focus on automation that does not depend on new Palworld APIs:

- Add scheduled backups.
- Improve process recovery after Palwarden restarts.
