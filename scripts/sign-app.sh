#!/bin/bash
set -euo pipefail
SOURCE_DIR="$(cd "$(dirname "$0")/.." && pwd)"
APP="${1:?Pass the app bundle to sign}"
IDENTIFIER="$(/usr/libexec/PlistBuddy -c 'Print CFBundleIdentifier' "$APP/Contents/Info.plist")"
[[ "$IDENTIFIER" == be.yarne.azure-timetracker ]] || { echo 'Unexpected bundle ID; refusing to change app identity.' >&2; exit 1; }
if [[ -n "${AZURE_TIME_SIGN_IDENTITY:-}" ]]; then
    [[ "$AZURE_TIME_SIGN_IDENTITY" != '-' ]] || { echo 'Use a Developer ID Application identity, or omit AZURE_TIME_SIGN_IDENTITY for an ad-hoc development build.' >&2; exit 1; }
    codesign --force --options runtime --timestamp --identifier "$IDENTIFIER.updater" --sign "$AZURE_TIME_SIGN_IDENTITY" "$APP/Contents/Helpers/AzureTimetrackerUpdater"
    codesign --force --options runtime --timestamp --entitlements "$SOURCE_DIR/Resources/App.entitlements" \
        --identifier "$IDENTIFIER" --sign "$AZURE_TIME_SIGN_IDENTITY" "$APP"
    SIGNATURE="$(codesign -dvv "$APP" 2>&1)"
    [[ "$SIGNATURE" == *'Authority=Developer ID Application:'* ]] || { echo 'A Developer ID Application certificate is required for a signed release.' >&2; exit 1; }
    codesign --verify --strict -R='anchor apple generic' "$APP"
else
    codesign --force --sign - --identifier "$IDENTIFIER.updater" "$APP/Contents/Helpers/AzureTimetrackerUpdater"
    codesign --force --sign - --identifier "$IDENTIFIER" --entitlements "$SOURCE_DIR/Resources/App.entitlements" "$APP"
    echo 'Development signature only: permission approvals may be requested again after rebuilding.'
fi
codesign --verify --deep --strict "$APP"
