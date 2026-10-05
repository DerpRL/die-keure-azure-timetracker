#!/usr/bin/env python3
"""Copy verified installers into Git and archive the previous latest release.

Usage: python3 scripts/stage-release.py /path/to/installers /path/to/AzureTimetrackerRelease
Build/sign/notarize first, then regenerate checksums before running this script.
"""
import hashlib
import json
import plistlib
import re
import shutil
import subprocess
import sys
from pathlib import Path

source = Path(__file__).resolve().parent.parent
with (source / 'Resources/Info.plist').open('rb') as stream:
    version = plistlib.load(stream)['CFBundleShortVersionString']
artifacts = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else source.parent
release_root = source / 'releases'
latest = release_root / 'latest'
pattern = re.compile(r'Azure-timetracker-(\d+\.\d+\.\d+)-universal-[a-z-]+\.(dmg|pkg)(\.sha256)?$')
packages = sorted(p for p in artifacts.iterdir() if pattern.fullmatch(p.name) and pattern.fullmatch(p.name)[1] == version and p.suffix in {'.dmg', '.pkg'})
if {p.suffix for p in packages} != {'.dmg', '.pkg'} or len(packages) != 2:
    raise SystemExit('Expected exactly one DMG and one PKG for ' + version)
incoming = []
for package in packages:
    checksum = package.with_name(package.name + '.sha256')
    expected = hashlib.sha256(package.read_bytes()).hexdigest()
    if checksum.read_text().split() != [expected, package.name]:
        raise SystemExit('Checksum mismatch: ' + package.name)
    incoming.extend([package, checksum])
# Immutable update archives remain at their versioned URL when installers are archived.
if len(sys.argv) != 3:
    raise SystemExit('Pass the artifact folder and the AzureTimetrackerRelease executable for signature verification.')
manifest_path = artifacts / 'latest.json'
manifest = json.loads(manifest_path.read_text())
release = manifest['release']
with (source / 'Resources/Info.plist').open('rb') as stream:
    build = int(plistlib.load(stream)['CFBundleVersion'])
update = artifacts / f'Azure-timetracker-{version}-universal-update.zip'
expected_url = f'https://raw.githubusercontent.com/DerpRL/die-keure-azure-timetracker/main/releases/updates/{version}/{update.name}'
if (manifest.get('schemaVersion') != 1 or release['version'] != version or release['build'] != build
        or release['url'] != expected_url or release['size'] != update.stat().st_size
        or release['sha256'] != hashlib.sha256(update.read_bytes()).hexdigest()):
    raise SystemExit('The update manifest does not match the release archive.')
update_checksum = update.with_name(update.name + '.sha256')
if update_checksum.read_text().split() != [release['sha256'], update.name]:
    raise SystemExit('Update archive checksum mismatch.')
subprocess.run([str(Path(sys.argv[2]).resolve()), 'verify', str(manifest_path), str(update)], check=True)
update_target = release_root / 'updates' / version
for item in [update, update_checksum]:
    target = update_target / item.name
    if target.exists() and target.read_bytes() != item.read_bytes():
        raise SystemExit('Published update archives are immutable. Increment the version first.')
# Preflight everything before moving any existing release.
moves = []
for previous in sorted(latest.iterdir()) if latest.exists() else []:
    match = pattern.fullmatch(previous.name)
    if not match:
        raise SystemExit('Unexpected file in releases/latest: ' + previous.name)
    if match[1] == version:
        target = next((p for p in incoming if p.name == previous.name), None)
        if target is None or target.read_bytes() != previous.read_bytes():
            raise SystemExit('This version is already staged with different bytes. Increment the version first.')
        continue
    if tuple(map(int, match[1].split('.'))) > tuple(map(int, version.split('.'))):
        raise SystemExit('Refusing to replace a newer release with an older one.')
    archived = release_root / 'archive' / match[1] / previous.name
    if archived.exists() and archived.read_bytes() != previous.read_bytes():
        raise SystemExit('Archive collision: ' + str(archived))
    moves.append((previous, archived))
for previous, archived in moves:
    archived.parent.mkdir(parents=True, exist_ok=True)
    shutil.move(previous, archived)
latest.mkdir(parents=True, exist_ok=True)
for item in incoming:
    shutil.copy2(item, latest / item.name)
update_target.mkdir(parents=True, exist_ok=True)
for item in [update, update_checksum]:
    shutil.copy2(item, update_target / item.name)
(source / 'updates').mkdir(exist_ok=True)
shutil.copy2(manifest_path, source / 'updates/latest.json')
print('Staged ' + version + ' in releases/latest; previous release moved to releases/archive.')
