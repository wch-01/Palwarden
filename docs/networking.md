# Networking and Production Access

Palwarden binds to `127.0.0.1` by default. Keep that default for single-host administration.

## LAN binding

To make Palwarden reachable from other machines on a trusted LAN, set:

```env
PALWARDEN_HOST=0.0.0.0
PALWARDEN_CORS_ORIGINS=http://trusted-dev-host:4200
```

Use explicit origins only. Do not use wildcard CORS with credentials.

## Reverse proxy

For internet access, place Palwarden behind HTTPS through a reverse proxy or a secure private network such as Tailscale, ZeroTier, or a VPN.

Recommended reverse-proxy behavior:

- Terminate TLS at the proxy.
- Forward only Palwarden's web/API origin.
- Keep Palworld REST API ports private to the host or private LAN.
- Forward `Host`, `X-Forwarded-For`, and `X-Forwarded-Proto`.
- Set `PALWARDEN_COOKIE_SECURE=true` when served over HTTPS.

Example production environment:

```env
NODE_ENV=production
PALWARDEN_HOST=127.0.0.1
PALWARDEN_PORT=3333
PALWARDEN_COOKIE_SECURE=true
PALWARDEN_CORS_ORIGINS=https://palwarden.example.com
```

In production, serve the Angular app and backend from the same origin whenever possible.
