#!/bin/bash
set -euo pipefail
SOURCE_DIR="$(cd "$(dirname "$0")/.." && pwd)"
source "$SOURCE_DIR/scripts/signing-config.sh"
DELIVERY_DIR="${1:-$(dirname "$SOURCE_DIR")}"
BUILD_DIR="${AZURE_TIME_BUILD_DIR:-$SOURCE_DIR/.build-distribution}"
mkdir -p "$BUILD_DIR" "$DELIVERY_DIR"
BUILD_DIR="$(cd "$BUILD_DIR" && pwd)"
DELIVERY_DIR="$(cd "$DELIVERY_DIR" && pwd)"
export CLANG_MODULE_CACHE_PATH="$BUILD_DIR/module-cache"
export SWIFTPM_MODULECACHE_OVERRIDE="$BUILD_DIR/module-cache"
VERSION="$(/usr/libexec/PlistBuddy -c 'Print CFBundleShortVersionString' "$SOURCE_DIR/Resources/Info.plist")"
STAGE="$(mktemp -d "$BUILD_DIR/stage.XXXXXX")"
trap 'rm -rf "$STAGE"' EXIT
APP="$STAGE/root/Applications/Azure timetracker.app"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources" "$APP/Contents/Helpers" "$STAGE/packages"
BINS=()
HELPERS=()
for ARCH in arm64 x86_64; do
    FLAGS=(--package-path "$SOURCE_DIR" --scratch-path "$BUILD_DIR/$ARCH/package" --cache-path "$BUILD_DIR/cache" --disable-sandbox --build-system native --triple "$ARCH-apple-macosx14.0" -c release)
    swift build "${FLAGS[@]}"
    BIN_DIR="$(swift build "${FLAGS[@]}" --show-bin-path)"
    BINS+=("$BIN_DIR/AzureTimetracker")
    HELPERS+=("$BIN_DIR/AzureTimetrackerUpdater")
done
xcrun lipo -create "${BINS[@]}" -output "$APP/Contents/MacOS/AzureTimetracker"
xcrun strip -S "$APP/Contents/MacOS/AzureTimetracker"
xcrun lipo -create "${HELPERS[@]}" -output "$APP/Contents/Helpers/AzureTimetrackerUpdater"
xcrun strip -S "$APP/Contents/Helpers/AzureTimetrackerUpdater"
cp "$SOURCE_DIR/Resources/Info.plist" "$APP/Contents/Info.plist"
swift "$SOURCE_DIR/scripts/draw-icon.swift" "$STAGE/AppIcon.iconset"
iconutil --convert icns "$STAGE/AppIcon.iconset" --output "$APP/Contents/Resources/AppIcon.icns"
SIGN_LABEL="unsigned"
if [[ -n "${AZURE_TIME_INSTALLER_IDENTITY:-}" && -z "${AZURE_TIME_SIGN_IDENTITY:-}" ]]; then
    echo "Set AZURE_TIME_SIGN_IDENTITY as well as the installer identity." >&2; exit 1
fi
bash "$SOURCE_DIR/scripts/sign-app.sh" "$APP"
if [[ -n "${AZURE_TIME_SIGN_IDENTITY:-}" ]]; then
    SIGN_LABEL="signed-app"
    if [[ "$AZURE_TIME_SIGN_KIND" == local ]]; then SIGN_LABEL="local-signed-app"; fi
    if [[ -n "${AZURE_TIME_INSTALLER_IDENTITY:-}" ]]; then SIGN_LABEL="signed"; fi
fi
plutil -lint "$APP/Contents/Info.plist"
xcrun lipo "$APP/Contents/MacOS/AzureTimetracker" -verify_arch arm64
xcrun lipo "$APP/Contents/MacOS/AzureTimetracker" -verify_arch x86_64
python3 - "$STAGE/components.plist" <<'PY'
import plistlib, sys
with open(sys.argv[1], 'wb') as f:
    plistlib.dump([{'RootRelativeBundlePath': 'Applications/Azure timetracker.app', 'BundleIsRelocatable': False,
                   'BundleIsVersionChecked': True, 'BundleHasStrictIdentifier': True, 'BundleOverwriteAction': 'upgrade'}], f)
PY
pkgbuild --root "$STAGE/root" --component-plist "$STAGE/components.plist" --identifier be.yarne.azure-timetracker.pkg \
    --version "$VERSION" --install-location / --ownership recommended "$STAGE/packages/AzureTimetracker-component.pkg"
python3 - "$SOURCE_DIR/Resources/Installer/Distribution.xml" "$STAGE/Distribution.xml" "$VERSION" <<'PY'
import sys
from xml.sax.saxutils import escape
with open(sys.argv[1]) as f: source = f.read()
with open(sys.argv[2], 'w') as f: f.write(source.replace('@VERSION@', escape(sys.argv[3])))
PY
PACKAGE="$DELIVERY_DIR/Azure-timetracker-$VERSION-universal-$SIGN_LABEL.pkg"
PRODUCT_ARGS=(--distribution "$STAGE/Distribution.xml" --resources "$SOURCE_DIR/Resources/Installer" --package-path "$STAGE/packages")
if [[ "$SIGN_LABEL" == signed ]]; then PRODUCT_ARGS+=(--sign "$AZURE_TIME_INSTALLER_IDENTITY" --timestamp); fi
productbuild "${PRODUCT_ARGS[@]}" "$PACKAGE"
(cd "$DELIVERY_DIR" && shasum -a 256 "$(basename "$PACKAGE")" > "$(basename "$PACKAGE").sha256")
cp "$SOURCE_DIR/Resources/Installation guide.md" "$DELIVERY_DIR/Installation guide.md"
echo "Installer created: $PACKAGE"
echo "Signing status: $SIGN_LABEL. Notarization is a separate step."
