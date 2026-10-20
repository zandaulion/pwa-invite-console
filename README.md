# Consolă admin

One console for invitation and device administration across 12 PWAs. A
searchable app sidebar on desktop becomes an app picker on mobile, while the
selected app has separate Invitations and Devices views. Search and status
filters keep each list manageable; the invitation form opens when needed.

The console supports light and dark themes, uses the apps' own icons, and
shows each app's access options only where they apply. Plate and Magpie
create accounts; Casierul clasei adds class, role, child and access-expiry
options. Other apps keep the simple device invitation flow.

It lives in its own directory because it belongs to none of the apps it
fronts.

## Adding an app

Add the private API route, then describe the app in configuration.

1. Route its admin API on the private listener, injecting the header:

   ```caddyfile
   handle /newapp/api/* {
       uri strip_prefix /newapp
       reverse_proxy 127.0.0.1:PORT {
           header_up X-Admin 1
       }
   }
   ```

   Some apps expect a secret instead of the `X-Admin` marker. Inject that
   secret here, on the private listener, and drop the marker — the page
   itself still carries nothing:

   ```caddyfile
   handle /casierul-clasei/api/* {
       uri strip_prefix /casierul-clasei
       reverse_proxy 127.0.0.1:8118 {
           header_up -X-Admin
           header_up X-Admin-Token {env.CASIERUL_ADMIN_TOKEN}
       }
   }
   ```

   [Casierul clasei](https://github.com/zandaulion/casierul-clasei) works this
   way; its `deploy.sh` writes this route and its `apps.json` entry itself
   from `deploy/console-entry.json`, so that entry is the source of truth for
   its texts.

2. Add an entry to `apps.json`:

   ```json
   {
     "id": "newapp",
     "name": "Aplicație nouă",
     "description": "O scurtă descriere a aplicației",
     "icon": "icons/apps/newapp.svg",
     "api": "/newapp",
     "invite_kind": "device",
     "message": "Salut! …\n\n1) Deschide linkul:\n{link}\n\n… Valabil {days} zile."
   }
   ```

   Copy the app's existing icon into `icons/apps/`. `api` is the prefix on
   this listener — `""` if the app is mounted at its root. `message` is the
   invitation text, with `{link}` and `{days}` substituted; everything else
   is that app's own words.

Then `./deploy.sh`. No JavaScript changes.

### App capabilities

The form and lists derive their options from the selected app's entry in
`apps.json`:

| Field | Meaning |
|---|---|
| `description`, `icon` | Short app description and a relative local icon path |
| `invite_kind` | `device` for device activation, or `account` for a new account |
| `push` | Set to `false` to hide notification status for apps without push |
| `invite_note` | Invitation help text, with `{days}` substituted |
| `invite_profiles` | Optional role choices, described below |
| `invite_scope` | Set to `classroom` for a separate class selector |
| `invite_messages`, `invite_notes` | Role-keyed overrides of the invitation message and help text |
| `device_delete_note`, `device_revoke_note` | App-specific explanations of device actions |

Profiles use `value`, `label`, `short_label`, `description`,
`requires_child` and `requires_expiry`. An expiring profile may set
`expiry_default: "school-year-end"`. The invitation's redemption deadline
and the granted access expiry are separate values.

For Casierul clasei, choose a class first, then a role. Only the parent role
requires a child; parent and auditor roles require an access-expiry date.
The console displays each device's permissions across its classes and the
number of invitation activations used, including partially redeemed codes.
Revoking a device blocks all of its classes; deleting it removes its
permissions while preserving the class ledgers.

Casierul also carries a copy of its definition in
`../casierul-clasei/deploy/console-entry.json`. Keep that entry in sync when
changing its capabilities: a Casierul deployment merges it into the deployed
console configuration, replacing the profile array.

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

Optional role-aware extension:

| | |
|---|---|
| `GET /api/admin/invite-options` | `{children: [{id, name}]}` |
| `POST /api/admin/invites` | may also accept `{role, childId, accessExpiresAt, classroomId}` and return the selected access fields |

Apps without profiles continue to receive the original `{label}` payload.
The class-aware options adapter understands `classroom:<classroomId>`
entries and `child:<classroomId>:<childId>` entries from Casierul's existing
options endpoint. It presents them as separate class and child controls and
sends `classroomId` explicitly.

Casierul device responses include
`permissions: [{classroom_id, classroom_label, role, child_id, child_label,
access_expires_at}]`. These permissions take precedence over the device's
legacy single-role fields and can include expired access. Its invite
responses include `max_uses` and `use_count`; active codes remain available
until all allowed activations are used.

`code` and `url` become null once an invite is fully redeemed or revoked.
The console hides the copy buttons when no code is available or the
invitation is no longer usable.

Pruning is deliberately not here. `admin.sh prune` and `prune-devices` delete
in bulk with nothing to confirm per row, which is a poor fit for a page that
fronts several databases at once; typing the app's name is its own
confirmation. Anything only one app has — Termometru's push sources — stays in
its own `admin.sh` too. Growing this page into a superset would break it every
time one of them changed.

## Security

The page carries no credential. The private listener injects the admin
header required by each backend (`X-Admin` for the shared invite mechanism;
`X-Admin-Token` for Casierul). Public surfaces reject `/api/admin/*` and do not
forward client-supplied admin credentials. Serving this anywhere else
reaches nothing.

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

## Checks

`node scripts/update-check.mjs` checks that background updates preserve an
unfinished invitation, including when a phone is locked or the tab is hidden.

`node scripts/browser-check.mjs` exercises the console against synthetic
apps and records. All browser requests are intercepted, so these checks never
read or change live app data. It covers invitation payloads, class-specific
fields, device actions, switching apps during requests, dates, error recovery,
and desktop/mobile layouts. Screenshots are written to `/tmp` by default.

The browser check uses Playwright and a local Chromium CDP endpoint at
`http://127.0.0.1:9222`. Set `PLAYWRIGHT_MODULE` to its absolute module path
and `CDP_URL` to override the endpoint, or set `BROWSER_LAUNCH=1` to start a
local headless browser. This workspace also has a Playwright installation in
the neighboring `stencil-cnc` project. Check scripts are excluded from deployment.
