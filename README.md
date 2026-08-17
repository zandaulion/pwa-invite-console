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

## Deploy

```bash
./deploy.sh          # -> /var/www/console, served at /console/ on the tailnet
```
