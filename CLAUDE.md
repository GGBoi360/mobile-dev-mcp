# Claude Code Project Guidelines

## Project Overview
Mobile Dev MCP - An MCP server that gives Claude real-time access to mobile development tools for Android and iOS.

## Critical Rules

### Documentation Updates (MANDATORY)
After completing ANY feature, bug fix, or significant change:
1. Update `README.md` with new/changed tools and features
2. Update `docs/ARCHITECTURE.md` with technical details and tier changes
3. Update tool counts across all files when adding tools
4. Mark completed items in ROADMAP.md

**Never leave documentation stale.** If you built it, document it.

### Plan Improvements (PROACTIVE)
When given a feature plan or architecture design, **proactively suggest improvements**:
- Point out potential issues, edge cases, or missing pieces
- Suggest alternative approaches if they might be better
- Identify dependencies or complexity that could be reduced
- Note any security, performance, or scalability concerns
- Don't just execute blindly - think critically and speak up

**Better plans = better code.** Your insights make projects better.

### Tool Development
- All tools must check license/trial status using the appropriate require function:
  - Android basic tools: Use `requireBasic(toolName)`
  - iOS basic tools: Use `requireBasicPlus(toolName)`
  - Advanced tools: Use `requireAdvanced(toolName)`
  - Pro tools (screen streaming): Use `requirePro(toolName)`
- Always include trial message in output when `check.message` exists
- Add new tools to the appropriate array in `license.ts`:
  - `ANDROID_BASIC_TOOLS` - Android-only tools (Basic tier $9/mo)
  - `IOS_BASIC_TOOLS` - iOS tools (Basic+ tier $12/mo)
  - `ADVANCED_TOOLS` - Advanced features (Advanced tier $18/mo)
  - `PRO_TOOLS` - Premium features like screen streaming (Pro tier $75/mo)

### Testing
- Run `npm test` after making changes
- Add tests for new functionality in `src/*.test.ts`
- Test files use Vitest framework

### Build & Verify
```bash
npm run build   # Compile TypeScript
npm test        # Run tests
```

## Architecture

### Tier System
- **TRIAL**: 50 requests, all 64 tools accessible, then blocked
- **BASIC** ($9/mo): Android only - 16 tools (14 Android + 2 license), unlimited requests
- **BASIC+** ($12/mo): Android + iOS - 20 tools (14 Android + 4 iOS + 2 license), unlimited requests
- **ADVANCED** ($10/wk, $18/mo, $149/yr): 59 tools (Advanced features), unlimited, multi-device (3)
- **PRO** ($75/mo): All 64 tools, screen streaming, 5 devices, premium features
- **TEAM** ($59/mo): 5 seats, all features including Pro

### File Structure
```
src/
├── index.ts      # MCP server, tool definitions & implementations
├── license.ts    # Licensing, trial tracking, feature gating
├── *.test.ts     # Test files
```

### Adding New Tools
1. Add tool definition to `coreTools` array in `index.ts`
2. Add tool name to `BASIC_TOOLS` or `ADVANCED_TOOLS` in `license.ts`
3. Implement the function with license check
4. Add case handler in the switch statement
5. Update tool counts in README.md and ARCHITECTURE.md
6. Add tests in `tools.test.ts`

## Platform Support
- **Android**: Uses ADB (Android Debug Bridge)
- **iOS**: Uses `xcrun simctl` (Xcode Command Line Tools)

## Common Commands
- `adb shell input tap X Y` - Android tap
- `adb shell input text "text"` - Android text input
- `xcrun simctl io <udid> screenshot <path>` - iOS screenshot
- `xcrun simctl spawn <udid> log stream` - iOS logs
- `adb reverse tcp:8097 tcp:8097` - React DevTools port forwarding

## React DevTools Integration
React DevTools tools connect via WebSocket (port 8097) to the standalone DevTools app.
- Start DevTools: `npx react-devtools`
- Default port: 8097
- Protocol: JSON messages over WebSocket
