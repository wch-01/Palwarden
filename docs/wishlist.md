# Palwarden Wishlist

This file tracks ideas that are not required for the public v1 baseline.

## Long-Term Wish List

These items can be implemented with Palwarden's own database, Windows host capabilities, SteamCMD, filesystem access, or currently documented Palworld REST endpoints.

1. Audit log filtering improvements beyond the current client-side latest-entry table.
2. Tray icon and background/minimize-to-tray behavior.
3. Windows service mode for running before any user logs in.
4. More precise process identity validation for recovered processes.
5. Auto-restart policy for failed servers.
6. Graceful-stop timeout policy with optional force-stop escalation.
7. Linux process adapter after Windows behavior is stable.

## Waiting On Palworld API Support

These items need official Palworld API support, clearer documentation, or a stable server-side contract before Palwarden should treat them as reliable product features.

1. Real guild roster and guild management.
2. Authoritative running-server mod list.
3. Runtime mod enable/disable or load-order management.
4. Save-complete event, save job status, or save progress beyond the current `/save` response.
5. Hot-apply server settings without a restart.
6. Runtime config reload/update through a supported endpoint.
7. Rich player details such as inventory, pals, base ownership, and complete position/state data.
8. Ban list readback and richer server-side moderation history.
9. World actor snapshot UI on server versions that do not expose the documented snapshot endpoint.
10. Any destructive world or character operations not explicitly covered by the official REST API.
