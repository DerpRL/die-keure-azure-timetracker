#!/bin/bash
# Builds, signs, notarizes, packages, writes the feed and verifies an Azure timetracker release
# for macOS and Windows (docs/release.md, "Normal release"). Never publishes: run
# `att-release publish` afterwards.
#
# Usage: build.sh <version> [OUT]
#   OUT  artifact folder (default: ~/Releases/<version>); must be outside the repository
set -euo pipefail
# actool fails with "Bad file descriptor" when stdin is closed (background jobs, agents, CI).
exec </dev/null

V="${1:-}"
[[ "$V" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "release-build: give the version, e.g. build.sh 2.3.0" >&2; exit 1; }
TEAM_ID="4M2RD85AL6"
REPO="$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"
cd "$REPO"
OUT="${2:-$HOME/Releases/$V}"
KEY="$HOME/Library/Application Support/Azure timetracker Releases/updater-v2.key"
NOTARY_KEY="${APPLE_API_KEY_PATH:-$HOME/.appstoreconnect/private_keys/AuthKey_${APPLE_API_KEY:-4U3DC628X5}.p8}"

fail() {
  echo "release-build: $*" >&2
  exit 1
}

case "$OUT" in "$REPO"/*) fail "the artifact folder must be outside the repository" ;; esac
CONF_VERSION="$(node -p "require('./apps/desktop/src-tauri/tauri.conf.json').version")"
[[ "$CONF_VERSION" == "$V" ]] || fail "tauri.conf.json is at $CONF_VERSION, not $V; run bump-version.sh first"
[[ -f "releases/notes/$V.md" ]] || fail "releases/notes/$V.md is missing"
[[ -z "$(git status --porcelain --untracked-files=no)" ]] || fail "uncommitted changes to tracked files; commit or stash them (publish refuses them too)"
git fetch -q origin
[[ "$(git rev-parse HEAD)" == "$(git rev-parse origin/main)" ]] || fail "HEAD is not origin/main; push the release commit first"

security find-identity -v -p codesigning | grep -q "Developer ID Application: .*(${TEAM_ID})" \
  || fail "no \"Developer ID Application … (${TEAM_ID})\" certificate in the keychain"
[[ -f "$NOTARY_KEY" ]] || fail "notary API key missing: $NOTARY_KEY"
[[ -f "$KEY" ]] || fail "updater key missing: $KEY"
for tool in clang-cl lld-link makensis cargo-xwin gh; do
  command -v "$tool" >/dev/null 2>&1 || [[ -x "$(brew --prefix llvm 2>/dev/null)/bin/$tool" ]] \
    || fail "$tool not found (see docs/release.md, one-time setup)"
done
if pgrep -f "apps/desktop/node_modules/.bin/vit" >/dev/null; then
  fail "a Vite dev server or Vitest is using apps/desktop/node_modules, which the build reinstalls; stop it first"
fi

# Same actool safeguard as the dev-build skill: restart Xcode's ibtoold helper and retry once.
TOOLS="$(mktemp -d)"
trap 'rm -rf "$TOOLS"' EXIT
cat > "$TOOLS/actool" <<'WRAPPER'
#!/bin/bash
output="$(/usr/bin/actool "$@" 2>&1)" && [[ "$output" != *"Bad file descriptor"* ]] && {
  printf '%s\n' "$output"
  exit 0
}
echo "release-build: actool failed; restarting Xcode's ibtoold helper and retrying" >&2
killall ibtoold 2>/dev/null || true
sleep 1
exec /usr/bin/actool "$@"
WRAPPER
chmod +x "$TOOLS/actool"
export PATH="$TOOLS:$PATH"

release() { cargo run -q -p att-release -- "$@"; }

echo "==> Release $V at $(git rev-parse --short HEAD) into $OUT"
echo "==> build-macos"
APP="$(release build-macos | tail -1)"
[[ -d "$APP" ]] || fail "build-macos did not print an app path (got: $APP)"
echo "==> sign-macos"
release sign-macos "$APP"
echo "==> package-macos (notarizes app and DMG, a few minutes each)"
release package-macos "$APP" "$OUT" --key "$KEY"
echo "==> build-windows"
release build-windows --out "$OUT" --key "$KEY"
echo "==> feed"
release feed --version "$V" --notes "releases/notes/$V.md" \
  --mac-archive "$OUT/Azure-timetracker-$V-universal.app.tar.gz" \
  --windows-installer "$OUT/azure-timetracker-$V-x64.exe"
echo "==> verify"
release verify "$OUT"
echo "==> READY $OUT"
echo "PUBLISH: cargo run -q -p att-release -- publish $V --from \"$OUT\" --notes releases/notes/$V.md"
