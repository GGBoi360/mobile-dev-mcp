# Claude Code Project Guidelines

## Project Overview
Mobile Dev MCP - An MCP server that gives Claude real-time access to mobile development tools for Android and iOS.

## Development Rules

### Documentation Updates
**IMPORTANT:** Every time you add, modify, or remove features:
1. Update `README.md` with new/changed tools and features
2. Update `docs/ARCHITECTURE.md` with technical details and tier changes
3. Update tool counts in both files when adding tools
4. Mark completed items in the roadmap/checklist sections

### Tool Development
- All tools must check license/trial status using `requireBasic()` or `requireAdvanced()`
- Core tools (Basic tier): Use `requireBasic(toolName)`
- Advanced tools: Use `requireAdvanced(toolName)`
- Always include trial message in output when `check.message` exists
- Add new tools to the appropriate array in `license.ts` (BASIC_TOOLS or ADVANCED_TOOLS)

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
- **TRIAL**: 50 requests, all 46 tools accessible, then blocked
- **BASIC** ($6/mo): 17 core tools, unlimited requests
- **ADVANCED** ($8/wk, $12/mo, $99/yr): All 46 tools (17 basic + 29 advanced), unlimited everything

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
