# Palwarden Release Checklist

Use this checklist when preparing a public Windows release.

1. Build the latest Electron Windows installer.
2. Install and test the EXE on a clean local Palwarden data set.
3. Verify first launch, setup/login, server import/deploy, start/stop, config editing, backups, mods, and network access.
4. Commit any final release fixes.
5. Tag the release version.
6. Create a GitHub Release for that tag.
7. Attach the installer EXE to the GitHub Release assets.
8. Do not commit the installer EXE into the repository unless there is a deliberate reason to store binaries in Git history.
9. Confirm the README explains both paths: download the EXE, or clone the source and build with `pnpm package:electron`.
