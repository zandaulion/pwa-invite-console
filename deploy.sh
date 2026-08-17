#!/usr/bin/env bash
# Publish the console. Tailnet only -- it drives the admin APIs of all three
# apps, and those exist only on the listener that injects X-Admin.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEST="${DEST:-/var/www/pwa-invite-console}"

sudo mkdir -p "$DEST"
sudo chown "$(id -un):$(id -gn)" "$DEST"
# The worker's cache name carries a build hash, or a deploy never reaches an
# installed copy: the old worker keeps serving the old shell.
VERSION="$(find "$ROOT" -type f -not -path '*/.git/*' -not -name deploy.sh \
  -exec sha256sum {} + | sort -k2 | sha256sum | cut -c1-12)"

rsync -a --delete --exclude deploy.sh --exclude README.md --exclude .git "$ROOT"/ "$DEST"/
grep -rl __BUILD_VERSION__ "$DEST" | xargs -r sed -i "s/__BUILD_VERSION__/${VERSION}/g"
sudo restorecon -R "$DEST" 2>/dev/null || true
echo "console deployed ${VERSION} -> ${DEST}"
