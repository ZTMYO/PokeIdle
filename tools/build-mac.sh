#!/bin/bash
set -euo pipefail

if [[ "$(uname -s)" != Darwin ]]; then
  echo 'Build the macOS disk image on a Mac.' >&2
  exit 1
fi

cd "$(dirname "$0")/.."
node tools/sync-version.mjs
version=$(node -p 'require("./package.json").version')
product=$(node -p 'require("./src-tauri/tauri.conf.json").productName')
target_dir=$(node -p 'require("path").resolve(process.env.CARGO_TARGET_DIR || "src-tauri/target")')
export CARGO_TARGET_DIR="$target_dir"

# Skip Finder window automation. The disk image still contains the Applications shortcut.
CI=true APPLE_SIGNING_IDENTITY="${APPLE_SIGNING_IDENTITY:--}" \
  tauri build --target universal-apple-darwin --bundles app,dmg

bundle="$target_dir/universal-apple-darwin/release/bundle"
app="$bundle/macos/$product.app"
exe=$(/usr/libexec/PlistBuddy -c 'Print CFBundleExecutable' "$app/Contents/Info.plist")
lipo "$app/Contents/MacOS/$exe" -verify_arch arm64 x86_64
codesign --verify --deep --strict "$app"

dmg="$bundle/dmg/${product}_${version}_universal.dmg"
hdiutil verify "$dmg"
mkdir -p dist
download="dist/PokeIdle-$version-macOS-universal.dmg"
staged=$(mktemp "dist/.PokeIdle.XXXXXX")
trap 'rm -f "$staged"' EXIT
cp "$dmg" "$staged"
chmod 644 "$staged"
mv -f "$staged" "$download"
shasum -a 256 "$download"
