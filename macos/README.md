# Exporting as a Standalone macOS `.app`

This folder packages **GBA Scripture Studio** (100% offline—ROM compiler, ARM assembler, BPE compressor, and GBA emulator included) into a native double-clickable **`GBA Scripture Studio.app`** and **`.dmg`** for macOS.

## Build on Your Mac (1 Command)
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
