#!/bin/bash
set -euo pipefail
SOURCE_DIR="$(cd "$(dirname "$0")/.." && pwd)"
source "$SOURCE_DIR/scripts/signing-config.sh"
APP="${1:?Pass the app bundle to sign}"
IDENTIFIER="$(/usr/libexec/PlistBuddy -c 'Print CFBundleIdentifier' "$APP/Contents/Info.plist")"
[[ "$IDENTIFIER" == be.yarne.azure-timetracker ]] || { echo 'Unexpected bundle ID; refusing to change app identity.' >&2; exit 1; }
if [[ -n "${AZURE_TIME_SIGN_IDENTITY:-}" ]]; then
    [[ "$AZURE_TIME_SIGN_IDENTITY" != '-' ]] || { echo 'Use a Developer ID Application identity, or omit AZURE_TIME_SIGN_IDENTITY for an ad-hoc development build.' >&2; exit 1; }
    TIMESTAMP=(--timestamp)
    if [[ "$AZURE_TIME_SIGN_KIND" == local ]]; then TIMESTAMP=(--timestamp=none); fi
    codesign --force --options runtime "${TIMESTAMP[@]}" --identifier "$IDENTIFIER.updater" --sign "$AZURE_TIME_SIGN_IDENTITY" "$APP/Contents/Helpers/AzureTimetrackerUpdater"
    codesign --force --options runtime "${TIMESTAMP[@]}" --entitlements "$SOURCE_DIR/Resources/App.entitlements" \
        --identifier "$IDENTIFIER" --sign "$AZURE_TIME_SIGN_IDENTITY" "$APP"
    SIGNATURE="$(codesign -dvv "$APP" 2>&1)"
    if [[ "$AZURE_TIME_SIGN_KIND" == local ]]; then
        [[ "$SIGNATURE" == *'Authority='* && "$SIGNATURE" != *'Signature=adhoc'* ]] || { echo 'A persistent certificate is required for local signing.' >&2; exit 1; }
        REQUIREMENT="$(codesign -d -r- "$APP" 2>&1)"
        [[ "$REQUIREMENT" == *'certificate'* || "$REQUIREMENT" == *'anchor'* ]] || { echo 'Missing stable certificate requirement.' >&2; exit 1; }
    else
        [[ "$SIGNATURE" == *'Authority=Developer ID Application:'* ]] || { echo 'Use Developer ID, or explicitly set AZURE_TIME_SIGN_KIND=local for a local certificate.' >&2; exit 1; }
        codesign --verify --strict -R='anchor apple generic' "$APP"
    fi
else
    codesign --force --sign - --identifier "$IDENTIFIER.updater" "$APP/Contents/Helpers/AzureTimetrackerUpdater"
    codesign --force --sign - --identifier "$IDENTIFIER" --entitlements "$SOURCE_DIR/Resources/App.entitlements" "$APP"
    echo 'Development signature only: permission approvals may be requested again after rebuilding.'
fi
codesign --verify --deep --strict "$APP"
