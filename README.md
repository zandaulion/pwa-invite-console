# Consolă admin

One page for the invite and device administration of all three apps —
Întârzieri, wBP Digitizer and Termometru. Each still has its own admin page
for anything specific to it; this one covers what they have in common:
creating an invite with the message to send, and revoking or deleting devices.

It lives in its own directory because it belongs to none of the three repos.

## Security

The page carries no credential. The tailnet listener injects `X-Admin` on the
way to each API, and the public surfaces both 404 `/api/admin/*` and strip that
header. Serving this anywhere else reaches nothing.

All three servers sit behind that one listener under different prefixes —
`/api`, `/bp/api`, `/thermo/api` — so a single origin drives all of them and no
CORS is involved.

## Installable

It is a PWA, which needs a secure context, which plain HTTP on a tailnet IP is
not — the worker silently does not register there. So the tailnet terminates
TLS in front of the private listener:

```bash
tailscale serve --bg --https=443 http://127.0.0.1:80
```

That is `serve`, not `funnel`: it is reachable from the tailnet and nowhere
else. Open `https://<node>.<tailnet>.ts.net/console/` and install from there;
the plain-HTTP address keeps working as a page, minus the worker.

Only the shell is cached, and never anything under `/api/` — a stale device
list is worse than none, and those responses carry invite codes.

## Deploy

```bash
./deploy.sh          # -> /var/www/console, served at /console/ on the tailnet
```
