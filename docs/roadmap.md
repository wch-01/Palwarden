# Palwarden Roadmap

## Milestone 1: Existing installation control

- Monorepo setup.
- NestJS backend and Angular/Ionic frontend.
- Prisma + SQLite migrations.
- First-run owner setup.
- Login, logout, and session restore.
- Role guards.
- Server instance CRUD.
- Encrypted Palworld AdminPassword storage.
- Palworld REST connection test, info, and metrics.
- Dashboard cards.
- Start and graceful stop of existing local Palworld installs.
- Live process status and basic logs.
- Unit/integration tests for implemented behavior.

## Milestone 2: Rich operations

- Player list, kick, ban, unban, and announcements.
- Settings editor for `PalWorldSettings.ini`.
- Backup records and manual backups.
- Audit log UI.
- Better process recovery when Palwarden restarts.

## Milestone 3: SteamCMD install and update

- Locate or download SteamCMD.
- Anonymous install/update per instance.
- Validate action.
- Progress streaming.
- Backup before destructive maintenance.

## Milestone 4: Scheduling and policy

- Scheduled backups.
- Restart schedules.
- Timeout policies for graceful stop.
- Auto-start and auto-restart.

## Milestone 5: Hardening and distribution

- HTTPS reverse-proxy guide.
- Installer packaging.
- Linux process adapter.
- Per-server permissions.
- Optional mod management.
