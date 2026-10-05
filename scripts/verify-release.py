#!/usr/bin/env python3
"""Validate distribution artifacts without installing or launching the application.
Usage: python3 scripts/verify-release.py ARTIFACT_DIR MANIFEST_TOOL
"""
import hashlib
import plistlib
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path

source = Path(__file__).resolve().parent.parent
artifacts, tool = [Path(value).resolve() for value in sys.argv[1:]]
with (source / 'Resources/Info.plist').open('rb') as stream:
    expected_info = plistlib.load(stream)
version = expected_info['CFBundleShortVersionString']
pkg, = artifacts.glob(f'Azure-timetracker-{version}-universal-*.pkg')
dmg, = artifacts.glob(f'Azure-timetracker-{version}-universal-*.dmg')
archive = artifacts / f'Azure-timetracker-{version}-universal-update.zip'
expected = {'Contents/Info.plist', 'Contents/Resources/AppIcon.icns', 'Contents/MacOS/AzureTimetracker',
            'Contents/Helpers/AzureTimetrackerUpdater', 'Contents/_CodeSignature/CodeResources'}

def run(*args):
    return subprocess.run(args, check=True, capture_output=True).stdout

def inventory(folder):
    return {str(p.relative_to(folder)): hashlib.sha256(p.read_bytes()).hexdigest() for p in folder.rglob('*') if p.is_file()}

for path in (pkg, dmg, archive):
    assert path.with_name(path.name + '.sha256').read_text().split() == [hashlib.sha256(path.read_bytes()).hexdigest(), path.name]
run(str(tool), 'verify', str(artifacts / 'latest.json'), str(archive))
run('hdiutil', 'verify', str(dmg))
with tempfile.TemporaryDirectory(prefix='azure-release-check-') as temporary:
    folder = Path(temporary)
    run('pkgutil', '--expand-full', str(pkg), str(folder / 'expanded'))
    app = folder / 'expanded/AzureTimetracker-component.pkg/Payload/Applications/Azure timetracker.app'
    assert set(inventory(app)) == expected, 'Unexpected app payload'
    with (app / 'Contents/Info.plist').open('rb') as stream:
        info = plistlib.load(stream)
    for key in ['CFBundleIdentifier', 'CFBundleShortVersionString', 'CFBundleVersion', 'LSUIElement', 'LSMinimumSystemVersion']:
        assert info[key] == expected_info[key], 'Metadata mismatch: ' + key
    for relative in ['Contents/MacOS/AzureTimetracker', 'Contents/Helpers/AzureTimetrackerUpdater']:
        binary = app / relative
        for architecture in ['arm64', 'x86_64']:
            run('xcrun', 'lipo', str(binary), '-verify_arch', architecture)
        assert b'--preview-update' not in binary.read_bytes(), 'Preview fixtures in production'
    run('codesign', '--verify', '--deep', '--strict', str(app))
    entitlements = run('codesign', '-d', '--entitlements', ':-', str(app))
    assert plistlib.loads(entitlements)['com.apple.security.personal-information.calendars']
    with zipfile.ZipFile(archive) as zipped:
        assert zipped.testzip() is None
        assert {name.removeprefix('Azure timetracker.app/'): hashlib.sha256(zipped.read(name)).hexdigest() for name in zipped.namelist()} == inventory(app)
    mount = folder / 'image'
    mount.mkdir()
    run('hdiutil', 'attach', '-readonly', '-nobrowse', '-mountpoint', str(mount), str(dmg))
    try:
        assert inventory(mount / 'Azure timetracker.app') == inventory(app), 'DMG app differs from PKG'
        assert (mount / 'Applications').is_symlink()
        assert (mount / 'Install Azure timetracker.txt').is_file()
    finally:
        run('hdiutil', 'detach', str(mount))
print(f'Verified {version}: universal app/helper, exact payload, signature, identity, entitlement, no preview fixtures, DMG/PKG/ZIP identical app bytes, signed manifest and all checksums. No app was launched or installed.')
