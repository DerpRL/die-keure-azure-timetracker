#!/bin/bash
# Run once per release Mac. Private material is created outside the repository.
set -euo pipefail
SIGNING_DIR="$HOME/Library/Application Support/Azure timetracker Releases/local-signing"
KEYCHAIN="$HOME/Library/Keychains/login.keychain-db"
NAME='Azure timetracker Local Signing'
umask 077
mkdir -p "$SIGNING_DIR"
chmod 700 "$SIGNING_DIR"
if [[ ! -f "$SIGNING_DIR/identity.pem" ]]; then
    [[ ! -e "$SIGNING_DIR/private.key" ]] || { echo 'Existing private key without its certificate. Restore the certificate before continuing.' >&2; exit 1; }
    cat > "$SIGNING_DIR/certificate.conf" <<CONF
[req]
prompt = no
distinguished_name = identity
x509_extensions = signing
[identity]
CN = $NAME
[signing]
basicConstraints = critical,CA:FALSE
keyUsage = critical,digitalSignature
extendedKeyUsage = critical,codeSigning
subjectKeyIdentifier = hash
authorityKeyIdentifier = keyid:always
CONF
    openssl req -new -newkey rsa:3072 -nodes -x509 -sha256 -days 3650 \
        -config "$SIGNING_DIR/certificate.conf" -keyout "$SIGNING_DIR/private.key" -out "$SIGNING_DIR/identity.pem" 2> "$SIGNING_DIR/generation.log"
fi
FINGERPRINT="$(openssl x509 -in "$SIGNING_DIR/identity.pem" -noout -fingerprint -sha1 | cut -d= -f2 | tr -d :)"
if ! security find-identity -p codesigning "$KEYCHAIN" | grep -Fq "$FINGERPRINT"; then
    security import "$SIGNING_DIR/private.key" -k "$KEYCHAIN" -T /usr/bin/codesign
    security import "$SIGNING_DIR/identity.pem" -k "$KEYCHAIN"
fi
# User trust is limited to code signing; this certificate is not trusted for TLS or other policies.
security add-trusted-cert -r trustRoot -p codeSign -k "$KEYCHAIN" "$SIGNING_DIR/identity.pem"
security find-identity -v -p codesigning "$KEYCHAIN" | grep -F "$FINGERPRINT"
printf '%s\n' "$FINGERPRINT" > "$SIGNING_DIR/identity.txt"
echo "Persistent local signing configured. Back up the protected folder: $SIGNING_DIR"
echo 'This is a local signature, not Apple Developer ID or notarization.'
