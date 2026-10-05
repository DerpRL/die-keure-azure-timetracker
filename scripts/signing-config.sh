#!/bin/bash
# Shared by builders; never contains private key material.
LOCAL_IDENTITY_FILE="$HOME/Library/Application Support/Azure timetracker Releases/local-signing/identity.txt"
if [[ -z "${AZURE_TIME_SIGN_IDENTITY:-}" && -f "$LOCAL_IDENTITY_FILE" ]]; then
    AZURE_TIME_SIGN_IDENTITY="$(cat "$LOCAL_IDENTITY_FILE")"
    AZURE_TIME_SIGN_KIND=local
fi
export AZURE_TIME_SIGN_IDENTITY="${AZURE_TIME_SIGN_IDENTITY:-}"
export AZURE_TIME_SIGN_KIND="${AZURE_TIME_SIGN_KIND:-developer-id}"
