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
- Windows ZIP installer package with bundled Node runtime, generated master key, automatic migrations, and same-origin production hosting.
- Electron desktop package with bundled Palwarden runtime and native app window.
- Host Network Access setting for local-only or LAN/private-network browser access.

## Version 1 Release

These items should be prioritized before calling Palwarden v1. The emphasis is UI clarity, release polish, and the core Windows host workflow.

- Add a working Restart Palwarden action after Network Access changes so users do not need to restart manually.
- User access management UI for Palwarden accounts and global roles.
- Settings page completion for server instance paths, file browsing, and automation.
- Restore progress and stronger restore safety UX.
- Investigate why graceful shutdown commonly fails on the first attempt and make the first request reliable.
- Windows startup registration for Palwarden at user login.
- Global policy for starting selected servers when Palwarden launches.
- Better process recovery when Palwarden restarts while Palworld servers are already running.
- Investigate and normalize CPU/dashboard metrics against Windows Task Manager; Palwarden may be showing per-process or per-thread-style CPU differently than Task Manager's whole-system percentage.
- Signed Windows installer polish, uninstall entry, and app metadata cleanup.

## Ready For Test

These are implemented and should be verified in the app before being treated as accepted.

- Network Access save and restart-required messaging use clearer button-style actions.
- Server Control shutdown confirmation uses a proper modal before graceful stop.
- Server Update offers an explicit admin override to continue when the before-update backup fails.
- Server Control > Player Connection can attempt to detect and display the host public IP address.

## Long-Term Wish List

These items can be implemented with Palwarden's own database, Windows host capabilities, SteamCMD, filesystem access, or currently documented Palworld REST endpoints, but they are not required for the first v1 release.

- Scheduled backups under Settings > Automation.
- Audit log filtering improvements beyond the current client-side latest-entry table.
- Tray icon and background/minimize-to-tray behavior.
- Windows service mode for running before any user logs in.
- More precise process identity validation for recovered processes.
- Auto-restart policy for failed servers.
- Graceful-stop timeout policy with optional force-stop escalation.
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

The next Palwarden-owned pass should focus on v1 release polish:

- Tighten Settings UI actions for Network Access, Nexus Mods, logout visibility, and restart handling.
- Improve process recovery after Palwarden restarts.
