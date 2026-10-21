# PWA Invite Console self-hosting bundle

The `site/` directory is a static PWA with a **synthetic demonstration app** in
`site/apps.json`. It includes the readable JavaScript and CSS source used by the
browser. The repository and corresponding source are linked in `BUILD-INFO.json`.

To preview the interface on this computer, extract the ZIP and run:

```bash
cd site
python3 -m http.server 8765 --bind 127.0.0.1
```

Open <http://127.0.0.1:8765/>. The example does **not** provide an API, so
invitation and device requests will fail until you connect a compatible backend.
Do not use a real backend on an unauthenticated preview listener.

For real administration, replace `site/apps.json` with your own app entries and
serve `site/` from an authenticated private HTTPS listener. Configure the same
listener to proxy each app's `/api/admin/*` routes to its backend and inject the
backend's secret header server-side. Block public access to those routes and
discard caller-supplied admin headers. No secret belongs in `apps.json` or any
browser file. The [repository README](https://github.com/zandaulion/pwa-invite-console#adding-an-app)
explains the API contract and a proxy example.

Serve static files with `Cache-Control: no-cache, must-revalidate`. The service
worker caches only the shell and never API responses. After changing
`apps.json`, redeploy and change the version string in `site/sw.js` so installed
offline copies do not keep the old configuration. Browser storage and installed
PWAs are bound to the exact origin and path.

Check the download with `sha256sum -c SHA256SUMS` before extraction. The ZIP is
GPL-3.0-or-later; see `LICENSE`. No live invitations, credentials, real device
records, deployment-specific routes or owner-specific app list are bundled.
