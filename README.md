# Zenith

A lightweight, customized Dynamic Island & HUD utility for Windows.

## Features
- **Dynamic Notch & Media Player**:
  - Live WIB time display (`Asia/Jakarta`).
  - Active audio waveform visualizer.
  - Track info & album art cover.
  - Interactive seekbar with elapsed and remaining timestamps.
  - **Live Synced Lyrics** (via LRCLIB) with auto-scroll and line-highlighting.
- **Hardware Telemetry HUD**:
  - Suhu (Weather temperature in °C)
  - CPU usage percentage
  - RAM usage percentage
  - Battery level & charging state
  - Jam presisi WIB (anti-drift)
- **Temporary Stash Shelf**:
  - Drag and drop files from Windows Explorer directly onto the notch.
  - Stash files temporarily, open them with a click, or drag them out to other apps.
- **3 Notch Modes**:
  - **Smart**: Automatically hides when any active window overlaps the notch area.
  - **Fixed**: Always pinned and visible at the top of the screen.
  - **Peek**: Hidden by default; smoothly reveals when your mouse hovers the top edge of the screen or on playback events.
- **Ultra Lightweight**:
  - Stripped redundant secondary WebView2 windows (saving ~350MB - 450MB RAM).
  - Optimized audio loopback and GSMTC polling.

## Build from Source

### Prerequisites
1. [Node.js](https://nodejs.org) (v18+) or [Bun](https://bun.sh)
2. [Rust](https://rustup.rs) with C++ Build Tools

### Compile
```powershell
# Install dependencies
npm install

# Build Windows release (.exe)
npx tauri build
```

Installer output will be located in:
`src-tauri/target/release/bundle/nsis/`

---
*Built with Tauri, Rust, React, and Tailwind CSS.*
