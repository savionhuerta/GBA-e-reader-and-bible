#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
MAC_DIR="$ROOT_DIR/macos"

echo "1/4 Installing root web dependencies..."
cd "$ROOT_DIR"
npm install --legacy-peer-deps

echo "2/4 Building offline static bundle (dist/)..."
npm run build

echo "3/4 Staging web bundle into macos/app-dist..."
rm -rf "$MAC_DIR/app-dist"
cp -R "$ROOT_DIR/dist" "$MAC_DIR/app-dist"

echo "4/4 Packaging Universal macOS .app, .dmg, and .zip (Apple Silicon + Intel)..."
cd "$MAC_DIR"
npm install
npx electron-builder --mac --universal --publish never

echo ""
echo "Done! Universal macOS builds are in: $ROOT_DIR/dist-mac/"
echo "  - Installer: $ROOT_DIR/dist-mac/GBA Scripture Studio-1.0.0-universal.dmg"
echo "  - Zipped .app: $ROOT_DIR/dist-mac/GBA Scripture Studio-1.0.0-universal-mac.zip"
echo "  - App bundle: $ROOT_DIR/dist-mac/mac-universal/GBA Scripture Studio.app"
echo "Drag 'GBA Scripture Studio.app' into /Applications."
