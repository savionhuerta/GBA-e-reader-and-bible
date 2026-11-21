# Exporting as a Standalone macOS `.app`

This folder packages **GBA Scripture Studio** (100% offline—ROM compiler, ARM assembler, BPE compressor, and GBA emulator included) into a native double-clickable **`GBA Scripture Studio.app`** and **`.dmg`** for macOS.

## Option A: Build on Your Mac (1 Command)
Requires [Node.js](https://nodejs.org/) (v20+) installed on your Mac.

From the exported project root in Terminal:
```bash
chmod +x macos/build-mac.sh && ./macos/build-mac.sh
```

Output is created in `dist-mac/`:
- `dist-mac/mac-universal/GBA Scripture Studio.app` (Universal: Apple Silicon M1–M4 + Intel)
- `dist-mac/GBA Scripture Studio-1.0.0-universal.dmg`
- `dist-mac/GBA Scripture Studio-1.0.0-universal-mac.zip`

Drag **`GBA Scripture Studio.app`** into **`/Applications`**.
*(Because local builds are unsigned/ad-hoc, if macOS Gatekeeper asks on first launch, right-click the app → **Open**, or run `xattr -cr "/Applications/GBA Scripture Studio.app"`.)*

## Option B: Automated GitHub Actions Build (Zero Mac Setup)
If you export this project to a GitHub repository, `.github/workflows/build-mac.yml` runs on a `macos-latest` runner and builds a **Universal (`arm64` + `x64`) `.dmg` and `.app` zip** under the repository's **Actions → Build macOS App → Artifacts** tab.
