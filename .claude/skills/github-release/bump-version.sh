#!/bin/bash
# Raises Azure timetracker to a new version everywhere the release tool checks it:
# Cargo.toml ([workspace.package]), Cargo.lock (workspace crates), apps/desktop/package.json,
# apps/desktop/package-lock.json (root entries only) and tauri.conf.json (version, and
# bundle.macOS.bundleVersion + 1). Edits files only; never commits.
#
# Usage: bump-version.sh <major.minor.patch>
set -euo pipefail

NEW="${1:-}"
[[ "$NEW" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "bump-version: give a plain major.minor.patch version (got '$NEW')" >&2; exit 1; }

REPO="$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"
cd "$REPO"
CONF=apps/desktop/src-tauri/tauri.conf.json

OLD="$(node -p "require('./$CONF').version")"
[[ "$OLD" != "$NEW" ]] || { echo "bump-version: already at $NEW" >&2; exit 1; }
# The new version must be higher: the updater compares semver and ignores older or equal ones.
node -e '
const [a, b] = process.argv.slice(1).map((v) => v.split(".").map(Number));
for (let i = 0; i < 3; i++) { if (b[i] > a[i]) process.exit(0); if (b[i] < a[i]) break; }
console.error(`bump-version: ${process.argv[2]} is not newer than ${process.argv[1]}`); process.exit(1);
' "$OLD" "$NEW"

# Cargo.toml: only the version line inside [workspace.package].
node -e '
const fs = require("fs"); const [old, next] = process.argv.slice(1);
const text = fs.readFileSync("Cargo.toml", "utf8");
const re = /(\[workspace\.package\][^\[]*?\nversion = ")([^"]+)(")/;
const m = text.match(re);
if (!m || m[2] !== old) { console.error(`bump-version: Cargo.toml [workspace.package] version is not ${old}`); process.exit(1); }
fs.writeFileSync("Cargo.toml", text.replace(re, `$1${next}$3`));
' "$OLD" "$NEW"

# JSON files: change only the version fields. package.json and package-lock.json are npm's own
# 2-space JSON and are rewritten; tauri.conf.json has hand formatting, so its two fields are
# replaced in place.
node -e '
const fs = require("fs"); const [old, next, conf] = process.argv.slice(1);
const fail = (msg) => { console.error(`bump-version: ${msg}`); process.exit(1); };
const edit = (file, fn) => { const json = JSON.parse(fs.readFileSync(file, "utf8")); fn(json); fs.writeFileSync(file, JSON.stringify(json, null, 2) + "\n"); };
const expect = (file, value) => { if (value !== old) fail(`${file} has version ${value}, expected ${old}`); };

edit("apps/desktop/package.json", (j) => { expect("package.json", j.version); j.version = next; });
edit("apps/desktop/package-lock.json", (j) => {
  expect("package-lock.json", j.version); j.version = next;
  expect("package-lock.json packages[\"\"]", j.packages[""].version); j.packages[""].version = next;
});

let text = fs.readFileSync(conf, "utf8");
const json = JSON.parse(text);
expect("tauri.conf.json", json.version);
const build = Number(json.bundle.macOS.bundleVersion);
if (!Number.isInteger(build)) fail("bundle.macOS.bundleVersion is not an integer");
const versionLine = `\n  "version": "${old}",`;
const buildLine = `"bundleVersion": "${build}"`;
if (text.split(versionLine).length !== 2) fail(`expected exactly one top-level ${versionLine.trim()} in tauri.conf.json`);
if (text.split(buildLine).length !== 2) fail(`expected exactly one ${buildLine} in tauri.conf.json`);
text = text.replace(versionLine, `\n  "version": "${next}",`).replace(buildLine, `"bundleVersion": "${build + 1}"`);
const check = JSON.parse(text);
if (check.version !== next || check.bundle.macOS.bundleVersion !== String(build + 1)) fail("tauri.conf.json edit did not land");
fs.writeFileSync(conf, text);
console.log(`bundleVersion ${build} -> ${build + 1}`);
' "$OLD" "$NEW" "$CONF"

# Cargo.lock: refresh the workspace crates' versions only.
cargo update --workspace --quiet

echo "version $OLD -> $NEW"
git diff --stat
