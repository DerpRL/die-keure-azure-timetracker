#!/bin/bash
set -euo pipefail
SOURCE_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DELIVERY_DIR="${1:-$(dirname "$SOURCE_DIR")}"
BUILD_DIR="${AZURE_TIME_BUILD_DIR:-$SOURCE_DIR/.build-local}"
APP_DIR="$DELIVERY_DIR/Azure timetracker.app"
mkdir -p "$BUILD_DIR" "$DELIVERY_DIR"
export CLANG_MODULE_CACHE_PATH="$BUILD_DIR/module-cache"
export SWIFTPM_MODULECACHE_OVERRIDE="$BUILD_DIR/module-cache"
swift build --package-path "$SOURCE_DIR" --scratch-path "$BUILD_DIR/package" --cache-path "$BUILD_DIR/cache" --disable-sandbox --build-system native -c release
BIN_DIR="$(swift build --package-path "$SOURCE_DIR" --scratch-path "$BUILD_DIR/package" --cache-path "$BUILD_DIR/cache" --disable-sandbox --build-system native -c release --show-bin-path)"
mkdir -p "$APP_DIR/Contents/MacOS" "$APP_DIR/Contents/Resources"
cp "$BIN_DIR/AzureTimetracker" "$APP_DIR/Contents/MacOS/AzureTimetracker"
cp "$SOURCE_DIR/Resources/Info.plist" "$APP_DIR/Contents/Info.plist"
swift "$SOURCE_DIR/scripts/draw-icon.swift" "$BUILD_DIR/AppIcon.iconset"
iconutil --convert icns "$BUILD_DIR/AppIcon.iconset" --output "$APP_DIR/Contents/Resources/AppIcon.icns"
bash "$SOURCE_DIR/scripts/sign-app.sh" "$APP_DIR"
echo "Built $APP_DIR"
