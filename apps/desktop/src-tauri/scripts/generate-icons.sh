#!/bin/bash
# Regenerates the committed icons under icons/ (app icon) and icons/tray/ (tray icons).
# Needs macOS (the drawings use AppKit through `swift`) and Node (`npx`).
set -euo pipefail
SRC_TAURI="$(cd "$(dirname "$0")/.." && pwd)"
REPO="$(cd "$SRC_TAURI/../../.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# App icon: the 1.x drawing, rendered at 1024 px and fed to the Tauri icon generator.
swift "$REPO/scripts/draw-icon.swift" "$WORK/AppIcon.iconset"
npx --yes @tauri-apps/cli@2 icon "$WORK/AppIcon.iconset/icon_512x512@2x.png" -o "$SRC_TAURI/icons"
# There are no mobile targets.
rm -rf "$SRC_TAURI/icons/android" "$SRC_TAURI/icons/ios"

# Tray icons: macOS template clock and the Windows state variants.
swift "$SRC_TAURI/scripts/draw-tray-icons.swift" "$SRC_TAURI/icons/tray"
