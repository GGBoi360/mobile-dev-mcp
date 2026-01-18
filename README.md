# Mobile Dev MCP

[![npm version](https://img.shields.io/npm/v/@ggboi360/mobile-dev-mcp.svg)](https://www.npmjs.com/package/@ggboi360/mobile-dev-mcp)
[![License: MIT (Core)](https://img.shields.io/badge/License-MIT%20(Core)-green.svg)](LICENSE-MIT)
[![License: Elastic 2.0 (Advanced)](https://img.shields.io/badge/License-Elastic%202.0%20(Advanced)-blue.svg)](LICENSE-ELASTIC)

A **read-only** MCP server that gives Claude direct access to your mobile development environment. Stop copy-pasting logs and screenshots - let Claude see your app directly!

**Open Core**: 8 free tools are MIT licensed. 13 advanced tools are source-available under Elastic License 2.0.

## Features

- **Screenshots** - Claude can see your app's current screen (Android & iOS)
- **Logs** - Metro bundler, ADB logcat, and iOS Simulator logs
- **Device Info** - List devices, check status, get detailed info
- **UI Inspection** - Get the full UI hierarchy with element details (Advanced)
- **Screen Analysis** - Find elements, suggest actions, extract text (Advanced)

## Pricing

| Tier | Price | Tools | Description |
|------|-------|-------|-------------|
| **Free** | $0 | 8 | Android debugging - screenshots, logs, device info |
| **Advanced** | $18/month | 21 | + iOS support, UI inspection, screen analysis, multi-device |

**Need automation?** Screen streaming, tapping, typing, and workflows are available in [CodeControl](https://codecontrol.dev).

## Installation

### Option 1: NPX (Recommended)
```bash
# Add to Claude Code
claude mcp add mobile-dev -- npx @ggboi360/mobile-dev-mcp
```

Or add to your `~/.claude/claude_desktop_config.json`:
```json
{
  "mcpServers": {
    "mobile-dev": {
      "command": "npx",
      "args": ["@ggboi360/mobile-dev-mcp"]
    }
  }
}
```

### Option 2: Manual Setup (Development)
```bash
git clone https://github.com/GGBoi360/mobile-dev-mcp.git
cd mobile-dev-mcp
npm install
npm run build
claude mcp add mobile-dev -- node /path/to/mobile-dev-mcp/dist/index.js
```

## Requirements

- **Node.js** >= 18.0.0
- **For Android:**
  - **ADB** (Android Debug Bridge) - Part of Android SDK Platform Tools
  - [Download Platform Tools](https://developer.android.com/tools/releases/platform-tools)
- **For iOS (macOS only, Advanced tier):**
  - **Xcode** with Command Line Tools
  - Run `xcode-select --install` if not installed

## Available Tools

### Free Tier (8 tools) - Android Only

| Tool | Description |
|------|-------------|
| `screenshot_emulator` | Capture screenshot from Android emulator/device |
| `list_devices` | List connected Android devices/emulators |
| `get_device_info` | Get detailed Android device information |
| `get_app_info` | Get info about an installed Android app |
| `get_adb_logs` | Get React Native logs from device via ADB logcat |
| `get_metro_logs` | Get recent Metro bundler logs |
| `check_metro_status` | Check if Metro bundler is running |
| `get_license_status` | Check your current license tier and limits |

### Advanced Tier (+13 tools = 21 total) - $18/month

| Tool | Description |
|------|-------------|
| `screenshot_ios_simulator` | Capture screenshot from iOS Simulator (macOS) |
| `list_ios_simulators` | List all available iOS Simulators (macOS) |
| `get_ios_simulator_info` | Get detailed iOS Simulator information (macOS) |
| `get_ios_simulator_logs` | Get logs from iOS Simulator (macOS) |
| `get_ui_tree` | Get the full UI hierarchy with element details |
| `find_element` | Find elements by text, resourceId, or contentDescription |
| `wait_for_element` | Wait for an element to appear (with configurable timeout) |
| `get_element_property` | Get specific property of an element |
| `assert_element` | Verify element exists or has expected state |
| `suggest_action` | Get AI-suggested actions based on current screen state |
| `analyze_screen` | Analyze current screen content and layout |
| `get_screen_text` | Extract all visible text from current screen |
| `set_license_key` | Activate a license key to unlock paid features |

### Tier Limits

| Feature | Free | Advanced |
|---------|------|----------|
| Tools | 8 | 21 |
| Log lines | 50 | 200 |
| Devices | 1 | 3 |

## Usage Examples

**You:** "Take a screenshot of my app"
**Claude:** *Uses screenshot_emulator* "Here's what your app looks like..." [shows image]

**You:** "Show me the recent React Native errors"
**Claude:** *Uses get_adb_logs with level='E'* "I found 3 errors in the logs..."

**You:** "What's on the screen right now?"
**Claude:** *Uses get_ui_tree* "I can see a login form with email and password fields..."

**You:** "Find the Submit button"
**Claude:** *Uses find_element* "Found a clickable button with text 'Submit' at coordinates [540, 1200]"

## Workflow

1. Start your Metro bundler: `npx expo start` or `npx react-native start`
2. Start your emulator or connect your device
3. Start Claude Code with this MCP server installed
4. Ask Claude about your app - it can now see logs and screenshots!

## License Activation

1. Purchase at https://mobiledevmcp.dev/pricing
2. You'll receive a license key via email
3. Use the `set_license_key` tool to activate

## Contributing

PRs welcome! This is an open-core project - the 8 free tools are MIT licensed.

---

Built with frustration and determination. [Website](https://mobiledevmcp.dev) | [GitHub](https://github.com/GGBoi360/mobile-dev-mcp)
