# Claude Mobile Dev MCP

An MCP (Model Context Protocol) server that gives Claude real-time access to mobile development tools. Stop copy-pasting logs and screenshots - let Claude see your app directly!

## Features

- **Metro Log Streaming** - Claude can read Metro bundler output in real-time
- **ADB Logcat Integration** - Get React Native logs directly from your device/emulator
- **iOS Simulator Support** - Screenshots and logs from iOS Simulators (macOS only)
- **Screenshot Capture** - Claude can see your app's current screen (Android & iOS)
- **Device Management** - List devices, check status, restart ADB
- **App Management** - Get app info, clear data for fresh testing
- **React DevTools Integration** - Inspect React component trees, props, and state

## Pricing

| Tier | Price | Features |
|------|-------|----------|
| **TRIAL** | Free (50 requests) | Try all 46 tools, then purchase to continue |
| **BASIC** | $6/month | 17 core tools (Android + iOS basics), 50 log lines max, 1 device |
| **ADVANCED** | $8/week, $12/month, or $99/year | All 46 tools, unlimited logs, 3 devices, streaming, DevTools, network inspection |

Purchase at: https://mobile-dev-mcp.com

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
# Clone the repo
git clone https://github.com/GGBoi360/mobile-dev-mcp.git
cd mobile-dev-mcp

# Install dependencies
npm install

# Build
npm run build

# Add to Claude Code
claude mcp add mobile-dev -- node /path/to/mobile-dev-mcp/dist/index.js
```

## Requirements

- **Node.js** >= 18.0.0
- **For Android:**
  - **ADB** (Android Debug Bridge) - Part of Android SDK Platform Tools
  - [Download Platform Tools](https://developer.android.com/tools/releases/platform-tools)
  - Make sure `adb` is in your PATH
- **For iOS (macOS only):**
  - **Xcode** with Command Line Tools
  - Run `xcode-select --install` if not installed

## Available Tools

### Core Tools - Android (All Tiers)

| Tool | Description |
|------|-------------|
| `get_metro_logs` | Get recent Metro bundler logs with optional filtering |
| `get_adb_logs` | Get React Native logs from device via ADB logcat |
| `screenshot_emulator` | Capture screenshot from Android emulator |
| `list_devices` | List connected Android devices/emulators |
| `check_metro_status` | Check if Metro bundler is running |
| `get_app_info` | Get info about an installed app |
| `clear_app_data` | Clear app data for fresh testing |
| `restart_adb` | Restart ADB server when it gets stuck |
| `get_device_info` | Get detailed device information |
| `start_metro_logging` | Start capturing Metro logs in background |
| `stop_metro_logging` | Stop Metro log capture |

### Core Tools - iOS Simulator (All Tiers, macOS only)

| Tool | Description |
|------|-------------|
| `list_ios_simulators` | List all available iOS Simulators |
| `screenshot_ios_simulator` | Capture screenshot from iOS Simulator |
| `get_ios_simulator_logs` | Get logs from iOS Simulator |
| `get_ios_simulator_info` | Get detailed simulator information |

### License Tools (All Tiers)

| Tool | Description |
|------|-------------|
| `get_license_status` | Check your current license tier and limits |
| `set_license_key` | Activate a license key to unlock paid features |

### Advanced Tools - Android (Advanced Tier Only)

| Tool | Description |
|------|-------------|
| `stream_adb_realtime` | Start real-time ADB log streaming in background |
| `stop_adb_streaming` | Stop real-time ADB log streaming |
| `screenshot_history` | Get previously captured screenshots (stores up to 20) |
| `watch_for_errors` | Monitor logs for specific error patterns |
| `multi_device_logs` | Get logs from multiple devices simultaneously |
| `tap_screen` | Tap on the screen at specific coordinates |
| `input_text` | Type text into the currently focused input field |
| `press_button` | Press hardware buttons (back, home, recent, volume, power) |
| `swipe_screen` | Swipe/scroll on the screen |
| `launch_app` | Launch an app by package name |
| `install_apk` | Install an APK file to the device |

### Advanced Tools - iOS Simulator (Advanced Tier Only, macOS)

| Tool | Description |
|------|-------------|
| `boot_ios_simulator` | Boot an iOS Simulator by UDID or name |
| `shutdown_ios_simulator` | Shutdown an iOS Simulator (or all) |
| `install_ios_app` | Install an app (.app bundle) on simulator |
| `launch_ios_app` | Launch an app by bundle identifier |
| `terminate_ios_app` | Force quit an app on simulator |
| `ios_open_url` | Open a URL (deep links, universal links) |
| `ios_push_notification` | Send a push notification to simulator |
| `ios_set_location` | Set simulated GPS location |

### Advanced Tools - React DevTools (Advanced Tier Only)

| Tool | Description |
|------|-------------|
| `setup_react_devtools` | Configure React DevTools connection and port forwarding |
| `check_devtools_connection` | Check if DevTools is connected to your app |
| `get_react_component_tree` | Get the React component hierarchy |
| `inspect_react_component` | Inspect a component's props, state, and hooks |
| `search_react_components` | Search for components by name |

### Advanced Tools - Network Inspection (Advanced Tier Only)

| Tool | Description |
|------|-------------|
| `get_network_requests` | Get recent HTTP/HTTPS requests from app logs |
| `start_network_monitoring` | Start real-time network request capture |
| `stop_network_monitoring` | Stop monitoring and get summary |
| `get_network_stats` | Get device network statistics (WiFi, data usage) |
| `analyze_request` | Analyze a specific captured request in detail |

## Usage Examples

Once installed, Claude can use these tools automatically:

**You:** "Check if my Metro bundler is running"
**Claude:** *Uses check_metro_status tool* "Metro is running on port 8081..."

**You:** "Show me the recent React Native errors"
**Claude:** *Uses get_adb_logs with filter='E'* "I found 3 errors in the logs..."

**You:** "Take a screenshot of my app"
**Claude:** *Uses screenshot_emulator* "Here's what your app looks like..." [shows image]

**You:** "What's happening with my app? It crashed"
**Claude:** *Uses get_adb_logs and screenshot_emulator* "I can see a null pointer exception in the logs, and the screen shows..."

**You:** "Show me the React component tree"
**Claude:** *Uses get_react_component_tree* "Here's your component hierarchy: App > Navigator > HomeScreen > ..."

**You:** "Inspect the UserProfile component"
**Claude:** *Uses search_react_components and inspect_react_component* "Found UserProfile with props: {userId: '123'}, state: {loading: false, data: {...}}"

**You:** "What API calls is my app making?"
**Claude:** *Uses get_network_requests* "Found 15 requests: GET /api/users (200), POST /api/login (200), GET /api/feed (500 error)..."

**You:** "Monitor network traffic while I use the app"
**Claude:** *Uses start_network_monitoring* "Network monitoring started. Make some requests, then I'll summarize them."

## Workflow

1. Start your Metro bundler: `npx expo start` or `npx react-native start`
2. Start your emulator (Genymotion, Android Studio, etc.)
3. Start Claude Code with this MCP server installed
4. Ask Claude about your app - it can now see logs and screenshots!

## Roadmap

- [x] Real-time log streaming (Advanced tier)
- [x] Screenshot history (Advanced tier)
- [x] Multi-device support (Advanced tier)
- [x] Error pattern watching (Advanced tier)
- [x] iOS Simulator support (screenshots, logs, app management)
- [x] React DevTools integration (component tree, props, state inspection)
- [x] Network request inspection (capture, monitor, analyze HTTP traffic)
- [ ] Expo DevTools integration
- [ ] Performance metrics
- [ ] Team tier with centralized license management

## License Activation

1. Purchase a license at https://mobile-dev-mcp.com
2. You'll receive a license key via email
3. Use the `set_license_key` tool to activate: `set_license_key` with your key
4. Or add to config file: `~/.mobiledev-mcp/config.json`

## Contributing

PRs welcome! Help us make mobile dev with Claude actually usable.

---

Built with frustration and determination by the mobile dev community.
