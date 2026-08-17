#!/usr/bin/env bash
# Publish the console. Tailnet only -- it drives the admin APIs of all three
# apps, and those exist only on the listener that injects X-Admin.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEST="${DEST:-/var/www/console}"

sudo mkdir -p "$DEST"
sudo chown "$(id -un):$(id -gn)" "$DEST"
rsync -a --delete --exclude deploy.sh --exclude README.md "$ROOT"/ "$DEST"/
sudo restorecon -R "$DEST" 2>/dev/null || true
echo "console deployed -> ${DEST}"
