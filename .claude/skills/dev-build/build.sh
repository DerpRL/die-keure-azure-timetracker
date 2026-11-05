#!/bin/bash
# Dev build of Azure timetracker for macOS: universal build, Developer ID signature, notarized and
# stapled app and DMG. Uses the release tool (tools/release, see docs/release.md); never publishes.
#
# Usage: build.sh [OUT]
#   OUT  artifact folder (default: ~/Releases/dev/<version>-<commit>[-dirty]-<yyyymmdd-hhmm>)
#
# Environment (all optional):
#   AZURE_TIME_SIGN_IDENTITY   signing identity; default: the Developer ID Application certificate
#                              of team 4M2RD85AL6 in the keychain
#   APPLE_API_KEY / APPLE_API_ISSUER / APPLE_API_KEY_PATH
#                              App Store Connect API key for notarytool; default: key 4U3DC628X5 at
#                              ~/.appstoreconnect/private_keys/AuthKey_4U3DC628X5.p8
#   TAURI_SIGNING_PRIVATE_KEY  v2 updater key (path or text); default: the release Mac's key file
set -euo pipefail
# actool fails with "Bad file descriptor" when stdin is closed (background jobs, agents, CI).
exec </dev/null

TEAM_ID="4M2RD85AL6"
REPO="$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"
cd "$REPO"

fail() {
  echo "dev-build: $*" >&2
  exit 1
}

[[ "$(uname -s)" == "Darwin" ]] || fail "macOS only"

# Signing identity: never fall back to an ad-hoc signature, which cannot be notarized.
IDENTITY="${AZURE_TIME_SIGN_IDENTITY:-$(security find-identity -v -p codesigning \
  | sed -n "s/.*\"\(Developer ID Application: .*(${TEAM_ID})\)\"/\1/p" | head -1)}"
[[ -n "$IDENTITY" ]] || fail "no \"Developer ID Application … (${TEAM_ID})\" certificate in the keychain"

NOTARY_KEY="${APPLE_API_KEY_PATH:-$HOME/.appstoreconnect/private_keys/AuthKey_${APPLE_API_KEY:-4U3DC628X5}.p8}"
[[ -f "$NOTARY_KEY" ]] || fail "notary API key missing: $NOTARY_KEY"

UPDATER_KEY="$HOME/Library/Application Support/Azure timetracker Releases/updater-v2.key"
KEY_ARGS=()
if [[ -z "${TAURI_SIGNING_PRIVATE_KEY:-}" ]]; then
  [[ -f "$UPDATER_KEY" ]] || fail "updater key missing: $UPDATER_KEY (or set TAURI_SIGNING_PRIVATE_KEY)"
  KEY_ARGS=(--key "$UPDATER_KEY")
fi

# Tauri's bundler compiles the Icon Composer icon (icons/AppIcon.icon) with `actool`, which hands
# the work to Xcode's long-lived `ibtoold` helper. That helper can get into a state where every
# call fails with "Bad file descriptor" until it is restarted, which would fail the bundle step
# after the whole Rust build. Put a wrapper first on PATH that restarts the helper and retries once.
TOOLS="$(mktemp -d)"
trap 'rm -rf "$TOOLS"' EXIT
cat > "$TOOLS/actool" <<'WRAPPER'
#!/bin/bash
output="$(/usr/bin/actool "$@" 2>&1)" && [[ "$output" != *"Bad file descriptor"* ]] && {
  printf '%s\n' "$output"
  exit 0
}
echo "dev-build: actool failed; restarting Xcode's ibtoold helper and retrying" >&2
killall ibtoold 2>/dev/null || true
sleep 1
exec /usr/bin/actool "$@"
WRAPPER
chmod +x "$TOOLS/actool"
export PATH="$TOOLS:$PATH"

# The icon needs actool from Xcode 26 or later; check before the long build.
ACTOOL_CHECK="$TOOLS/check"
mkdir "$ACTOOL_CHECK"
if ! actool "$REPO/apps/desktop/src-tauri/icons/AppIcon.icon" --compile "$ACTOOL_CHECK" \
  --platform macosx --minimum-deployment-target 14.0 --app-icon AppIcon \
  --output-partial-info-plist "$ACTOOL_CHECK/info.plist" >/dev/null 2>&1 \
  || [[ ! -f "$ACTOOL_CHECK/Assets.car" ]]; then
  fail "actool cannot compile icons/AppIcon.icon; check that \`xcode-select -p\` points at Xcode.app (26 or later)"
fi

VERSION="$(sed -n 's/^  "version": "\(.*\)",$/\1/p' apps/desktop/src-tauri/tauri.conf.json)"
COMMIT="$(git rev-parse --short HEAD)"
DIRTY=""
[[ -z "$(git status --porcelain --untracked-files=no)" ]] || DIRTY="-dirty"
OUT="${1:-$HOME/Releases/dev/${VERSION}-${COMMIT}${DIRTY}-$(date +%Y%m%d-%H%M)}"
case "$OUT" in
  "$REPO"/*) fail "the artifact folder must be outside the repository" ;;
esac

echo "==> Dev build ${VERSION} at ${COMMIT}${DIRTY}"
echo "    identity: ${IDENTITY}"
echo "    output:   ${OUT}"

release() { cargo run -q -p att-release -- "$@"; }

echo "==> Building (npm ci, vite build, tauri build universal)"
APP="$(release build-macos | tail -1)"
[[ -d "$APP" ]] || fail "build-macos did not print an app path (got: $APP)"

echo "==> Signing with Developer ID"
release sign-macos --identity "$IDENTITY" "$APP"

echo "==> Notarizing and packaging (a few minutes per submission)"
# (The `+` form keeps an empty array safe under `set -u` in macOS's bash 3.2.)
release package-macos ${KEY_ARGS[@]+"${KEY_ARGS[@]}"} "$APP" "$OUT"

# The stapled app next to the DMG, so it can be copied straight into /Applications.
ditto "$APP" "$OUT/Azure timetracker.app"

echo "==> Checking Gatekeeper"
spctl --assess --type execute --verbose=2 "$OUT/Azure timetracker.app" 2>&1
xcrun stapler validate "$OUT/Azure timetracker.app"

echo "==> Done"
echo "APP=$OUT/Azure timetracker.app"
ls "$OUT"/*.dmg | sed 's/^/DMG=/'
