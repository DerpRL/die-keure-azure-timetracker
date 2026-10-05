#!/bin/bash
set -euo pipefail
SOURCE_DIR="$(cd "$(dirname "$0")/.." && pwd)"
source "$SOURCE_DIR/scripts/signing-config.sh"
APP="${1:-$(dirname "$SOURCE_DIR")/Azure timetracker.app}"
DELIVERY_DIR="${2:-$(dirname "$SOURCE_DIR")}"
BUILD_DIR="${AZURE_TIME_BUILD_DIR:-$SOURCE_DIR/.build-dmg}"
mkdir -p "$BUILD_DIR" "$DELIVERY_DIR"
APP="$(cd "$(dirname "$APP")" && pwd)/$(basename "$APP")"
BUILD_DIR="$(cd "$BUILD_DIR" && pwd)"
DELIVERY_DIR="$(cd "$DELIVERY_DIR" && pwd)"

# Package the already-built universal bundle without changing its signature.
codesign --verify --deep --strict "$APP"
xcrun lipo "$APP/Contents/MacOS/AzureTimetracker" -verify_arch arm64
xcrun lipo "$APP/Contents/MacOS/AzureTimetracker" -verify_arch x86_64
VERSION="$(/usr/libexec/PlistBuddy -c 'Print CFBundleShortVersionString' "$APP/Contents/Info.plist")"
[[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "Invalid app version" >&2; exit 1; }
SIGN_LABEL="unsigned"
SIGNING_NOTE="This app has an ad-hoc development signature and is not notarized. Permission approvals may be requested again after an update."
SIGNATURE="$(codesign -dvv "$APP" 2>&1)"
if [[ "$SIGNATURE" == *'Authority=Developer ID Application:'* ]]; then
    codesign --verify --strict -R='anchor apple generic' "$APP"
    SIGN_LABEL="developer-id"
    SIGNING_NOTE="The app is Developer ID signed. Notarization is a separate release step; verify it before sharing this image. The first transition from a development build can require permission approval again."
elif [[ "$SIGNATURE" == *'Authority='* && "$SIGNATURE" != *'Signature=adhoc'* ]]; then
    SIGN_LABEL="local-signed"
    SIGNING_NOTE="The app uses a persistent local signing certificate. It is not Apple Developer ID signed or notarized. macOS may require Open Anyway on first installation and permission approval when migrating from an older signature."
fi
if [[ -n "${AZURE_TIME_SIGN_IDENTITY:-}" && "$SIGN_LABEL" == unsigned ]]; then
    echo 'Rebuild and sign the app with Developer ID before creating a signed disk image.' >&2; exit 1
fi
STAGE="$(mktemp -d "$BUILD_DIR/dmg-stage.XXXXXX")"
trap 'rm -rf "$STAGE"' EXIT
ditto "$APP" "$STAGE/Azure timetracker.app"
ln -s /Applications "$STAGE/Applications"
cat > "$STAGE/Install Azure timetracker.txt" <<EOF
Azure timetracker $VERSION

1. Quit any existing Azure timetracker using its menu-bar menu.
   Quitting does not stop a timer already running in 7pace.
2. Drag Azure timetracker.app onto the Applications shortcut.
   When upgrading, choose Replace. macOS may ask for administrator authorization.
3. Eject this disk image and open Azure timetracker from Applications.
4. Click its app icon and timer in the menu bar to open the overview or Settings.
   This app does not appear in the Dock or Command-Tab.

Your existing settings and Keychain credentials are preserved.
For a new setup, use Mobile PIN pairing (or an API token) for 7pace and your own Azure PAT in Settings.
Optional meeting detection uses local microphone status (macOS 14.2+), with no Slack IDs or tokens.

Supports Apple Silicon and Intel; requires macOS 14 or later.

$SIGNING_NOTE
Use the same app bundle ID and signing certificate for future releases.
See the source repository's Resources/Signing.md for the release steps.
EOF

IMAGE="$DELIVERY_DIR/Azure-timetracker-$VERSION-universal-$SIGN_LABEL.dmg"
hdiutil create -volname "Azure timetracker $VERSION" -srcfolder "$STAGE" \
    -fs HFS+ -format UDZO -nospotlight -ov "$IMAGE"
if [[ -n "${AZURE_TIME_SIGN_IDENTITY:-}" ]]; then
    TIMESTAMP=(--timestamp)
    if [[ "$AZURE_TIME_SIGN_KIND" == local ]]; then TIMESTAMP=(--timestamp=none); fi
    codesign --force "${TIMESTAMP[@]}" --sign "$AZURE_TIME_SIGN_IDENTITY" "$IMAGE"
    codesign --verify --strict "$IMAGE"
fi
hdiutil verify "$IMAGE"
(cd "$DELIVERY_DIR" && shasum -a 256 "$(basename "$IMAGE")" > "$(basename "$IMAGE").sha256")
echo "Disk image created: $IMAGE"
