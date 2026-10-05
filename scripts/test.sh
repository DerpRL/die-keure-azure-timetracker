#!/bin/bash
set -euo pipefail
SOURCE_DIR="$(cd "$(dirname "$0")/.." && pwd)"
BUILD_DIR="${AZURE_TIME_BUILD_DIR:-$SOURCE_DIR/.build-local}"
export CLANG_MODULE_CACHE_PATH="$BUILD_DIR/module-cache"
export SWIFTPM_MODULECACHE_OVERRIDE="$BUILD_DIR/module-cache"
SWIFT_BIN_DIR="$(dirname "$(xcrun --find swift)")"
TEST_PLUGIN="$SWIFT_BIN_DIR/../lib/swift/host/plugins/testing/libTestingMacros.dylib"
PLUGIN_FLAGS=()
if [ -f "$TEST_PLUGIN" ]; then
    PLUGIN_FLAGS=(-Xswiftc -load-plugin-library -Xswiftc "$TEST_PLUGIN")
fi
swift test --package-path "$SOURCE_DIR" --scratch-path "$BUILD_DIR/tests" --cache-path "$BUILD_DIR/cache" --disable-sandbox "${PLUGIN_FLAGS[@]}"
