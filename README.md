# Consolă admin

One page for the invite and device administration of every app behind the
invite mechanism. It is the only administration GUI — the apps used to carry
one each, which meant three tabs open and three places to remember.

It lives in its own directory because it belongs to none of the apps it
fronts.

## Adding an app

Two steps, neither of them here in the code.

1. Route its admin API on the private listener, injecting the header:

   ```caddyfile
   handle /newapp/api/* {
       uri strip_prefix /newapp
       reverse_proxy 127.0.0.1:PORT {
           header_up X-Admin 1
       }
   }
   ```

2. Add an entry to `apps.json`:

   ```json
   {
     "id": "newapp",
     "name": "Aplicație nouă",
     "api": "/newapp",
     "message": "Salut! …\n\n1) Deschide linkul:\n{link}\n\n… Valabil {days} zile."
   }
   ```

   `api` is the prefix on this listener — `""` if the app is mounted at its
   root. `message` is the invitation text, with `{link}` and `{days}`
   substituted; everything else is that app's own words.

Then `./deploy.sh`. No JavaScript changes.

### What an app has to expose

The console drives only what these apps have in common. An app qualifies by
answering, under its prefix:

| | |
|---|---|
| `GET /api/admin/devices` | `{devices: [{id, label, created_at, last_seen, revoked, has_push}]}` |
| `POST /api/admin/devices/{id}/revoke` | body `{revoked: bool}` |
| `POST /api/admin/devices/{id}/label` | body `{label}` |
| `DELETE /api/admin/devices/{id}` | |
| `GET /api/admin/invites` | `{invites: [{id, label, created_at, expires_at, used_at, device_id, code, url}], ttl_days}` |
| `POST /api/admin/invites` | body `{label}` → `{code, url, expires_in_days}` |
| `POST /api/admin/invites/{id}/revoke` | |

`code` and `url` are expected to be null once an invite has been redeemed —
the plaintext is wiped at that point, and the console hides the copy buttons
accordingly.

Pruning is deliberately not here. `admin.sh prune` and `prune-devices` delete
in bulk with nothing to confirm per row, which is a poor fit for a page that
fronts several databases at once; typing the app's name is its own
confirmation. Anything only one app has — Termometru's push sources — stays in
its own `admin.sh` too. Growing this page into a superset would break it every
time one of them changed.

## Security

The page carries no credential. The private listener injects `X-Admin` on the
way to each API, and the public surfaces both 404 `/api/admin/*` and strip that
header. Serving this anywhere else reaches nothing.

All the servers sit behind that one listener under different prefixes, so a
single origin drives them and no CORS is involved.

## Installable

It is a PWA, which needs a secure context, which plain HTTP on a tailnet IP is
not — the worker silently does not register there. So the tailnet terminates
TLS in front of the private listener:

```bash
tailscale serve --bg --https=443 http://127.0.0.1:80
```

That is `serve`, not `funnel`: reachable from the tailnet and nowhere else.
Open `https://<node>.<tailnet>.ts.net/invites/` and install from there; the
plain-HTTP address keeps working as a page, minus the worker.

Only the shell is cached, and never anything under `/api/` — a stale device
list is worse than none, and those responses carry invite codes.

Serve the files with `Cache-Control: no-cache, must-revalidate`. Without it
they carry only an ETag, and a browser may cache heuristically — which served
a stale stylesheet through an entire deploy here. They are a few kilobytes on
a local network; revalidating costs nothing.

## Deploy

```bash
./deploy.sh          # -> /var/www/pwa-invite-console, served at /invites/
```
