# Palwarden Security

## Authentication

- Palwarden has its own users. Palworld `AdminPassword` is never a Palwarden login password.
- First launch enters setup mode when no users exist.
- First setup is allowed from localhost, or with the one-time setup token printed by the API.
- User passwords are hashed with Argon2id.
- Sessions are stored server-side in SQLite.
- Session identifiers are sent only in HttpOnly cookies.
- Cookies use `SameSite=Lax`; `Secure` is enabled when configured for HTTPS production.
- Browser localStorage is not used for tokens.

## Authorization

Roles:

- `OWNER`: full access.
- `ADMIN`: manage servers and operational settings.
- `VIEWER`: read dashboards, status, logs, players, and metrics.

The authorization service currently evaluates global roles. Its API accepts the resource context so per-server permissions can be added later.

## CSRF

State-changing requests require the `x-csrf-token` header to match the CSRF cookie. Safe methods are exempt.

## Credentials

Palworld server AdminPasswords are encrypted at rest with AES-256-GCM using `PALWARDEN_MASTER_KEY`. The password is never returned after saving; response DTOs expose only `adminPasswordConfigured`.

Generate a master key:

```powershell
[Convert]::ToBase64String((1..32 | ForEach-Object { Get-Random -Maximum 256 }))
```

or:

```bash
openssl rand -base64 32
```

## Network security

- Palwarden binds to `127.0.0.1` by default.
- LAN binding requires explicit configuration.
- Production frontend/backend traffic is same-origin.
- Development CORS is restricted to configured origins and never wildcarded with credentials.
- Palworld REST API ports should not be port-forwarded or exposed through the frontend.
- Internet access should be behind HTTPS using a reverse proxy, Tailscale, ZeroTier, VPN, or another secure private network.

## Logging and audit

Logs and audit records must not include passwords, session identifiers, authorization headers, encryption keys, or complete sensitive request bodies. Credential changes are recorded as replacement events only.
