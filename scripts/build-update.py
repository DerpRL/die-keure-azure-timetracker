#!/usr/bin/env python3
"""Build a signed in-app update. The private Ed25519 key must stay outside this repository.
Usage: python3 scripts/build-update.py APP DELIVERY_DIR RELEASE_NOTES MANIFEST_TOOL
The manifest tool is the AzureTimetrackerRelease executable built by SwiftPM.
"""
import hashlib
import os
import plistlib
import stat
import subprocess
import sys
import zipfile
from pathlib import Path

source = Path(__file__).resolve().parent.parent
app, delivery, notes, tool = [Path(value).resolve() for value in sys.argv[1:]]
key = Path(os.environ.get('AZURE_TIME_UPDATE_KEY', str(Path.home() / 'Library/Application Support/Azure timetracker Releases/update-signing.ed25519'))).resolve()
if key.is_relative_to(source):
    raise SystemExit('The private signing key must be outside the Git repository.')
if not key.is_file() or key.stat().st_mode & 0o077:
    raise SystemExit('An existing private update-signing key with permissions 600 is required.')
if app.name != 'Azure timetracker.app':
    raise SystemExit('Expected Azure timetracker.app')
with (app / 'Contents/Info.plist').open('rb') as stream:
    version = plistlib.load(stream)['CFBundleShortVersionString']
# Publish only the known application files. Never include settings or account data.
expected = {'Contents/Info.plist', 'Contents/Resources/AppIcon.icns', 'Contents/MacOS/AzureTimetracker',
            'Contents/Helpers/AzureTimetrackerUpdater', 'Contents/_CodeSignature/CodeResources'}
files = sorted(p for p in app.rglob('*') if p.is_file())
if {str(p.relative_to(app)) for p in files} != expected or any(p.is_symlink() for p in app.rglob('*')):
    raise SystemExit('Unexpected app payload or symbolic link; inspect the bundle before publishing.')
delivery.mkdir(parents=True, exist_ok=True)
archive = delivery / f'Azure-timetracker-{version}-universal-update.zip'
with zipfile.ZipFile(archive, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as output:
    for path in files:
        info = zipfile.ZipInfo(str(Path(app.name) / path.relative_to(app)), date_time=(2026, 1, 1, 0, 0, 0))
        info.create_system = 3
        info.external_attr = (stat.S_IFREG | (0o755 if os.access(path, os.X_OK) else 0o644)) << 16
        info.compress_type = zipfile.ZIP_DEFLATED
        output.writestr(info, path.read_bytes())
manifest = delivery / 'latest.json'
subprocess.run([str(tool), str(app), str(archive), str(key), str(notes), str(manifest)], check=True)
archive.with_name(archive.name + '.sha256').write_text(hashlib.sha256(archive.read_bytes()).hexdigest() + '  ' + archive.name + '\n')
print('Update prepared in ' + str(delivery) + '. Use stage-release.py to publish it with the installers.')
