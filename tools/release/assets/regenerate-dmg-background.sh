#!/bin/bash
# Regenerates dmg-background.tiff (1x + 2x) from draw-dmg-background.swift. Needs macOS.
set -euo pipefail
ASSETS="$(cd "$(dirname "$0")" && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

swift "$ASSETS/draw-dmg-background.swift" "$WORK"
tiffutil -cathidpicheck "$WORK/background.png" "$WORK/background@2x.png" -out "$ASSETS/dmg-background.tiff"
