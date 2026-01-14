# Claude Mobile Dev MCP

An MCP (Model Context Protocol) server that gives Claude real-time access to mobile development tools. Stop copy-pasting logs and screenshots - let Claude see your app directly!

## Features

- **Metro Log Streaming** - Claude can read Metro bundler output in real-time
- **ADB Logcat Integration** - Get React Native logs directly from your device/emulator
- **Screenshot Capture** - Claude can see your app's current screen
- **Device Management** - List devices, check status, restart ADB
- **App Management** - Get app info, clear data for fresh testing

## Installation

### Option 1: Claude Code Plugin (Recommended)
```bash
# In Claude Code
/plugin install GGBoi360/claude-mobile-dev-mcp
```

### Option 2: Manual MCP Setup
```bash
# Clone the repo
git clone https://github.com/GGBoi360/claude-mobile-dev-mcp.git
cd claude-mobile-dev-mcp

# Install dependencies
npm install

# Build
npm run build

# Add to Claude Code
claude mcp add mobile-dev -- node /path/to/claude-mobile-dev-mcp/dist/index.js
```

### Option 3: NPX (Coming Soon)
```bash
claude mcp add mobile-dev -- npx claude-mobile-dev-mcp
```

## Requirements

- **Node.js** >= 18.0.0
- **ADB** (Android Debug Bridge) - Part of Android SDK Platform Tools
  - [Download Platform Tools](https://developer.android.com/tools/releases/platform-tools)
  - Make sure `adb` is in your PATH

## Available Tools

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

## Workflow

1. Start your Metro bundler: `npx expo start` or `npx react-native start`
2. Start your emulator (Genymotion, Android Studio, etc.)
3. Start Claude Code with this MCP server installed
4. Ask Claude about your app - it can now see logs and screenshots!

## Roadmap

- [ ] iOS Simulator support (screenshots, logs)
- [ ] Real-time log streaming (WebSocket)
- [ ] React DevTools integration
- [ ] Expo DevTools integration
- [ ] Network request inspection
- [ ] Performance metrics

## Contributing

PRs welcome! This is an open-source project to make mobile dev with Claude actually usable.

## License

MIT

---

Built with frustration and determination by the mobile dev community.
